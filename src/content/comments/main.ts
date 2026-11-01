// Native comment adapter based on BewlyCat's data access, DFS ordering and SVG guides.
// MAIN world is required to read the custom elements' public data properties.
// No fetch interception, prototype patching, native child reordering or extra account requests.
import { expandReplyPages, rememberPage, totalPages, type PaginatedRenderer, type ReplyPages } from './pagination';
import { orderReplies, type ReplyMeta, type TreeEntry } from './tree';
import { getCommentReplyBranchPath, getCommentReplyBranchToggleY, type CommentReplyAvatarAnchor, type CommentReplyTreeBranch } from './geometry';

type Renderer = PaginatedRenderer & { data?: unknown; reply?: unknown; replyItem?: unknown };
interface State {
  component: Renderer; container: HTMLElement; nodes: TreeEntry<Renderer>[];
  cache: Map<string, ReplyMeta>; collapsed: Set<string>; rootId: string;
  message: string; tools: HTMLDivElement; pages: ReplyPages; more: HTMLButtonElement; status: HTMLSpanElement;
  layer: SVGSVGElement; resize: ResizeObserver; layout: string; job: number;
}
const selector = 'bili-comment-reply-renderer, bili-comment-renderer';
const states = new Map<Renderer, State>();
const NS = 'http://www.w3.org/2000/svg';
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
:host{position:relative}
#expander-contents{display:flex;flex-direction:column;align-items:stretch}
#expander-contents>:is(bili-comment-reply-renderer,bili-comment-renderer)[data-bp-reply-depth]{box-sizing:border-box;display:block;width:100%;padding-inline-start:var(--bp-tree-indent,0px);order:var(--bp-tree-order,0)}
#expander-contents>#expander-footer{order:2147483647}
#expander-contents>[data-bp-reply-hidden]{display:none!important}
.bp-tree-guides{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}
.bp-tree-line{fill:none;stroke:var(--line_regular,#b0b4bb);stroke-width:var(--bp-tree-width,2);stroke-linejoin:round;vector-effect:non-scaling-stroke}
.bp-tree-hit{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke}
.bp-tree-toggle{fill:var(--bg1,#fff);stroke:var(--text3,#9499a0);stroke-width:1;pointer-events:all}
.bp-tree-branch{cursor:pointer;pointer-events:auto}
.bp-tree-branch:hover .bp-tree-line,.bp-tree-branch:focus .bp-tree-line{stroke:#00aeec}
.bp-tree-branch:focus{outline:none}
.bp-tree-branch:focus .bp-tree-toggle{stroke:#00aeec;stroke-width:2}
.bp-tree-tools{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 0;color:var(--text2,#61666d);font:500 14px/1.5 "Segoe UI","Microsoft YaHei",system-ui,sans-serif}
.bp-tree-tools[hidden]{display:none}
.bp-tree-tools button{font:inherit;color:var(--text_link,#0089c0);background:var(--bg1,#fff);border:1px solid var(--line_regular,#b0b4bb);border-radius:8px;padding:6px 10px;cursor:pointer}
.bp-tree-tools button:disabled{cursor:wait;opacity:.7}
.bp-tree-tools button:focus-visible{outline:2px solid var(--text_link,#0089c0);outline-offset:2px}
.bp-tree-tools span{font-size:13px}
.bp-tree-symbol{fill:var(--text2,#61666d);font:12px system-ui;text-anchor:middle;dominant-baseline:central;pointer-events:none}
`);
function preferences(): { indent: number; showGuides: boolean; batchPages: number } {
  try {
    const r=JSON.parse(document.documentElement.dataset.biliprismComments || '{}');
    return { indent: Math.max(16,Math.min(48,Number(r.indent)||32)), showGuides: r.showGuides!==false, batchPages: Math.max(1,Math.min(10,Number(r.batchPages)||5)) };
  } catch { return {indent:32,showGuides:true,batchPages:5}; }
}
const active = () => document.documentElement.dataset.biliprismCommentTree==='true' && /\/video\//i.test(location.pathname);
function dataOf(el: Renderer): Record<string, unknown> | null {
  const user = el.shadowRoot?.querySelector<Renderer>('bili-comment-user-info');
  for (const raw of [el.data, el.reply, el.replyItem, user?.data])
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return null;
}
const id = (x: unknown): string => typeof x === 'string' || typeof x === 'number' ? String(x) : '';
function metaOf(el: Renderer): ReplyMeta | null {
  const d = dataOf(el); if (!d) return null;
  const rpid = id(d.rpid_str ?? d.rpid); if (!rpid) return null;
  const time = typeof d.ctime === 'number' && Number.isFinite(d.ctime) ? d.ctime : null;
  return { id: rpid, parent: id(d.parent_str ?? d.parent), root: id(d.root_str ?? d.root), time };
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k,v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}
function nativeRoot(component: Renderer): Renderer | null {
  const root = component.getRootNode();
  return root instanceof ShadowRoot && root.host.localName === 'bili-comment-thread-renderer'
    ? root.querySelector<Renderer>('#comment, bili-comment-renderer') : null;
}
function avatar(el: Renderer | null, origin: DOMRect): CommentReplyAvatarAnchor | null {
  const target = el?.shadowRoot?.querySelector<HTMLElement>('#user-avatar, bili-avatar, #avatar');
  if (!target) return null;
  const r = target.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return null;
  const footer = el?.shadowRoot?.querySelector<HTMLElement>('#footer')?.getBoundingClientRect();
  return { left: r.left-origin.left, bottom: r.bottom-origin.top, centerX: r.left+r.width/2-origin.left,
    centerY: r.top+r.height/2-origin.top, toggleY: footer && footer.height ? footer.top+footer.height/2-origin.top : r.bottom-origin.top };
}
function author(el: Renderer | null): string {
  const member = dataOf(el ?? {} as Renderer)?.member as { uname?: unknown } | undefined;
  return typeof member?.uname === 'string' ? member.uname : '这条评论';
}
function layout(state: State): void {
  state.job = 0;
  if (!state.component.isConnected) return;
  const { nodes, component, collapsed } = state;
  const byId = new Map(nodes.map(n=>[n.meta.id,n]));
  const rootHidden = collapsed.has('thread-root');
  const width = state.container.clientWidth;
  const maxDepth = Math.max(0, ...nodes.map(n=>n.depth));
  const pref = preferences();
  const preferred = Math.min(pref.indent,width <= 640 ? 24 : 48);
  const step = maxDepth ? Math.max(16,Math.min(preferred,(width-280)/maxDepth)) : preferred;
  for (const n of nodes) {
    let hidden = rootHidden, parent = n.parentId;
    const visited = new Set([n.meta.id]);
    while (parent && !visited.has(parent)) {
      visited.add(parent); if (collapsed.has(parent)) hidden = true;
      parent = byId.get(parent)?.parentId ?? null;
    }
    if (n.item.dataset.bpReplyDepth !== String(n.depth)) n.item.dataset.bpReplyDepth = String(n.depth);
    n.item.toggleAttribute('data-bp-reply-hidden', hidden);
    const indent = n.depth*step+'px', order = String(n.order);
    if (n.item.style.getPropertyValue('--bp-tree-indent') !== indent) n.item.style.setProperty('--bp-tree-indent',indent);
    if (n.item.style.getPropertyValue('--bp-tree-order') !== order) n.item.style.setProperty('--bp-tree-order',order);
  }
  const origin = component.getBoundingClientRect();
  const rootRenderer = nativeRoot(component), rootAnchor = avatar(rootRenderer, origin);
  state.layer.style.display = pref.showGuides ? '' : 'none';
  const anchors = new Map(nodes.filter(n=>!n.item.hasAttribute('data-bp-reply-hidden')).map(n=>[n,avatar(n.item,origin)]));
  const branches: CommentReplyTreeBranch[] = [];
  const add = (key: string, parentAnchor: CommentReplyAvatarAnchor | null, children: TreeEntry<Renderer>[], name: string) => {
    if (!parentAnchor || !children.length) return;
    const childAnchors = children.map(n=>anchors.get(n)).filter((a): a is CommentReplyAvatarAnchor=>!!a);
    if (!childAnchors.length && !collapsed.has(key)) return;
    branches.push({ key, parentAnchor, childAnchors, collapsed: collapsed.has(key), collapseParentBody: false, parentAuthorName: name });
  };
  add('thread-root',rootAnchor,nodes.filter(n=>!n.parentId),author(rootRenderer));
  for (const n of nodes) if (anchors.get(n)) add(n.meta.id,anchors.get(n)!,n.children,author(n.item));
  const stamp = JSON.stringify([Math.round(origin.width),Math.round(origin.height),branches], (_key,v)=>typeof v==='number'?Math.round(v*100)/100:v);
  if (stamp === state.layout && state.layer.isConnected) return;
  state.layout = stamp;
  if (!state.layer.isConnected) component.shadowRoot?.append(state.layer);
  const focused = (component.shadowRoot?.activeElement as HTMLElement | null)?.getAttribute('data-key');
  const groups = branches.map(b=>{
    const group = svg('g', { class: 'bp-tree-branch', role: 'button', tabindex: 0, 'data-key': b.key,
      'aria-label': (b.collapsed?'展开':'收起')+b.parentAuthorName+'的回复', 'aria-expanded': String(!b.collapsed) });
    const d = getCommentReplyBranchPath(b,12,8);
    if (d) group.append(svg('path',{class:'bp-tree-line',d}),svg('path',{class:'bp-tree-hit',d}));
    const y = getCommentReplyBranchToggleY(b,8), x=b.parentAnchor.centerX;
    group.append(svg('circle',{class:'bp-tree-toggle',cx:x,cy:y,r:8}));
    const symbol = svg('text',{class:'bp-tree-symbol',x,y}); symbol.textContent=b.collapsed?'+':'−'; group.append(symbol);
    const toggle = () => { if (collapsed.has(b.key)) collapsed.delete(b.key); else collapsed.add(b.key); layout(state); };
    group.addEventListener('click',toggle);
    group.addEventListener('keydown',e=>{if (e.key==='Enter'||e.key===' ') { e.preventDefault(); toggle(); }});
    return group;
  });
  state.layer.replaceChildren(...groups);
  if (focused) [...state.layer.querySelectorAll<SVGElement>('[data-key]')].find(n=>n.getAttribute('data-key')===focused)?.focus();
}
function schedule(state: State): void { if (!state.job) state.job=requestAnimationFrame(()=>layout(state)); }
function reset(state: State): void {
  cancelAnimationFrame(state.job); state.resize.disconnect(); state.layer.remove(); state.tools.remove(); state.pages.stopped=true;
  const sr=state.component.shadowRoot; if (sr) sr.adoptedStyleSheets=sr.adoptedStyleSheets.filter(s=>s!==sheet);
  for (const n of state.nodes) {
    delete n.item.dataset.bpReplyDepth; n.item.removeAttribute('data-bp-reply-hidden');
    n.item.style.removeProperty('--bp-tree-indent'); n.item.style.removeProperty('--bp-tree-order');
  }
}
function update(component: Renderer): void {
  const root=component.shadowRoot, container=root?.querySelector<HTMLElement>('#expander-contents');
  if (!root || !container) return;
  let state=states.get(component);
  if (state && state.container!==container) { reset(state); states.delete(component); state=undefined; }
  if (!state) {
    const layer=svg('svg',{class:'bp-tree-guides','aria-label':'评论回复层级'});
    const resize=new ResizeObserver(()=>{ const s=states.get(component); if(s) schedule(s); });
    const tools=document.createElement('div'); tools.className='bp-tree-tools';
    const more=document.createElement('button');more.type='button';more.textContent='全部展开楼层';
    const collapse=document.createElement('button');collapse.type='button';collapse.textContent='收起楼层';
    const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    tools.append(more,collapse,status);
    state={component,container,nodes:[],cache:new Map(),collapsed:new Set(),rootId:'',layer,resize,layout:'',job:0,message:'',tools,more,status,pages:{pages:new Map(),busy:false,stopped:false}};
    const current=state;
    more.onclick=()=>{
      current.message='';current.collapsed.clear();layout(current);
      const pages=current.pages;
      void expandReplyPages(component,pages,preferences().batchPages,()=>active()&&states.get(component)===current&&current.pages===pages,
        ()=>current.nodes.map(n=>dataOf(n.item)).filter((x):x is Record<string,unknown>=>!!x),()=>updateTools(current))
        .then(()=>{if(active()&&states.get(component)===current)update(component);})
        .catch(e=>{current.message=(e as Error).message;updateTools(current);});
    };
    collapse.onclick=()=>{current.collapsed.add('thread-root');layout(current);};
    root.append(tools);
    states.set(component,state); root.adoptedStyleSheets=[...root.adoptedStyleSheets,sheet]; root.append(layer);
    resize.observe(container);
  }
  const entries=[...container.children].filter((n): n is Renderer=>n instanceof HTMLElement&&n.matches(selector))
    .map(item=>({item,meta:metaOf(item)})).filter((x): x is { item: Renderer; meta: ReplyMeta }=>!!x.meta);
  rememberPage(component,state.pages);
  const rootId=entries[0]?.meta.root??'';
  if (state.rootId && rootId && state.rootId!==rootId) {state.cache.clear();state.collapsed.clear();state.pages.stopped=true;state.pages={pages:new Map(),busy:false,stopped:false};}
  state.rootId=rootId;
  for(const e of entries) state.cache.set(e.meta.id,e.meta);
  while(state.cache.size>2000) state.cache.delete(state.cache.keys().next().value!);
  // 原生分页撤掉的节点不保留额外属性，复用同一元素时也能重新计算关系。
  for (const old of state.nodes) if(!entries.some(e=>e.item===old.item)) {
    old.item.removeAttribute('data-bp-reply-hidden');delete old.item.dataset.bpReplyDepth;
    old.item.style.removeProperty('--bp-tree-indent');old.item.style.removeProperty('--bp-tree-order');
  }
  state.nodes=orderReplies(entries,state.cache);
  state.nodes.forEach((n,i)=>n.order=i);
  updateTools(state);
  schedule(state);
}
function updateTools(s: State): void {
  const pages=s.pages, total=totalPages(s.component), loaded=pages.pages.size;
  s.tools.hidden=s.nodes.length===0&&!s.component.showViewMore;
  s.more.disabled=pages.busy;
  s.more.textContent=pages.busy?'正在展开…':loaded>0&&loaded<total?'继续展开剩余楼层':'全部展开楼层';
  s.status.textContent=s.message|| (pages.busy?`已加载 ${loaded} / ${total} 页`:loaded>0?`已加载 ${loaded} / ${total} 页`:'展开本页分支及更多回复');
  s.tools.setAttribute('aria-busy',String(pages.busy));
}

// Local theme declarations inside native shadow roots otherwise override html
// tokens. One adopted sheet per root; no native text or child nodes are changed.
const themeSheet=new CSSStyleSheet();
themeSheet.replaceSync(`
:host{--bg1:var(--m-surface,#fff)!important;--bg2:var(--m-canvas,#f5f4f1)!important;--bg3:var(--m-chip,#e9e9e6)!important;--bg1_float:var(--m-surface,#fff)!important;--bg2_float:var(--m-chip,#e9e9e6)!important;--text1:var(--m-ink,#202124)!important;--text2:var(--m-muted,#555b64)!important;--text3:var(--m-faint,#626873)!important;--text4:var(--m-faint,#626873)!important;--line_regular:var(--m-line,#d8d9dc)!important;--line_light:var(--m-line,#d8d9dc)!important;--graph_bg_regular:var(--m-chip,#e9e9e6)!important;color:var(--m-ink,#202124);font-family:"Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif;-webkit-font-smoothing:auto;text-rendering:auto}
#content,#contents,#message,#input,.brt-root,.brt-editor{font-size:var(--bp-font-size,15px)!important;font-weight:var(--bp-font-weight,500)!important;line-height:var(--bp-line-height,1.7)!important;font-family:inherit!important;color:var(--text1)!important}
#contents :is(p,span,a){font-family:inherit!important;font-size:inherit!important;font-weight:inherit!important;line-height:inherit!important}
#footer,#pubdate,#count,#user-name{font-family:inherit!important;font-size:var(--bp-meta-size,14px)!important;font-weight:var(--bp-font-weight,500)!important;line-height:1.5!important}
`);
const themed=new Set<ShadowRoot>();
function scan(): void {
  const enabled=active();
  const theme=document.documentElement.dataset.biliprismCommentTheme==='true';
  for(const sr of themed) if(!theme||!sr.host.isConnected){sr.adoptedStyleSheets=sr.adoptedStyleSheets.filter(s=>s!==themeSheet);themed.delete(sr);}
  for(const [c,s] of states) if(!enabled||!c.isConnected) {reset(s);states.delete(c);}
  if((!enabled&&!theme)||document.hidden) return;
  const visited=new Set<ShadowRoot>();
  const walk=(root: ParentNode,depth=0)=>{
    if(depth>12) return;
    for(const el of root.querySelectorAll<Renderer>('bili-comments,bili-comment-thread-renderer,bili-comment-replies-renderer,bili-comment-renderer,bili-comment-reply-renderer,bili-comment-user-info,bili-rich-text,bili-comment-rich-textarea,bili-comment-box,bili-comments-header-renderer,bili-comment-action-buttons-renderer')) {
      if(enabled&&el.localName==='bili-comment-replies-renderer') update(el);
      if(el.shadowRoot&&!visited.has(el.shadowRoot)) {visited.add(el.shadowRoot);if(theme&&!themed.has(el.shadowRoot)){el.shadowRoot.adoptedStyleSheets=[...el.shadowRoot.adoptedStyleSheets,themeSheet];themed.add(el.shadowRoot);}walk(el.shadowRoot,depth+1);}
    }
  };
  walk(document);
}
new MutationObserver(scan).observe(document.documentElement,{attributes:true,attributeFilter:['data-biliprism-comment-tree','data-biliprism-comment-theme','data-biliprism-comments']});
document.addEventListener('visibilitychange',scan);
setInterval(scan,900); scan();

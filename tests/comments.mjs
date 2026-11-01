import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { installMocks } from './mocks.mjs';
const EXT=resolve('dist'), dir=mkdtempSync(join(tmpdir(),'biliprism-comments-'));
const ctx=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--no-sandbox','--headless=new',`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`],viewport:{width:1100,height:1000}});
mkdirSync('tests/artifacts',{recursive:true});
const results=[];
try{
  await installMocks(ctx);
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const sw=ctx.serviceWorkers()[0]??await ctx.waitForEvent('serviceworker');
  await page.goto('https://www.bilibili.com/video/BVcomment123/');
  await page.evaluate(()=>{
    const style=document.createElement('style');style.textContent='body{margin:0;background:var(--bg1);color:var(--text2)}:root{--bg1:#fff;--text2:#333;--line_regular:#b0b4bb}@media(prefers-color-scheme:dark){:root{--bg1:#17191e;--text2:#ddd;--line_regular:#77808a}}';document.head.append(style);
    class Reply extends HTMLElement{
      constructor(){super();this.attachShadow({mode:'open'});}
      set data(value){this._data=value;this.shadowRoot.innerHTML='<style>:host{display:block;min-height:104px}#card{position:relative;min-height:104px}#user-avatar{position:absolute;top:8px;left:4px;width:24px;height:24px;border-radius:50%;background:#00aeec}#body{padding:6px 0 0 38px}#footer{margin-top:14px;font-size:12px}button{font:inherit;color:inherit}</style><div id="card"><a id="user-avatar"></a><div id="body"><b></b><p></p><div id="footer"><button>回复</button></div></div></div>';this.shadowRoot.querySelector('b').textContent=value.member.uname;this.shadowRoot.querySelector('p').textContent=value.content.message;this.shadowRoot.querySelector('button').onclick=()=>{this.dataset.nativeClicked='true';};}
      get data(){return this._data;}
    }
    customElements.define('bili-comment-reply-renderer',Reply);customElements.define('bili-comment-renderer',class extends Reply{});
    const bc=document.createElement('bili-comments');const root=bc.attachShadow({mode:'open'});document.getElementById('commentapp').append(bc);
    const thread=document.createElement('bili-comment-thread-renderer');const tr=thread.attachShadow({mode:'open'});root.append(thread);
    const main=document.createElement('bili-comment-renderer');main.id='comment';main.data={rpid_str:'10',root_str:'0',parent_str:'0',member:{uname:'主评论'},content:{message:'BewlyCat 风格树状楼层'}};tr.append(main);
    const replies=document.createElement('bili-comment-replies-renderer');const rr=replies.attachShadow({mode:'open'});rr.innerHTML='<style>:host{display:block;margin-left:36px;width:min(640px,calc(100vw - 80px))}</style><div id="expander-contents"><div id="expander-footer">原生查看更多回复</div></div>';tr.append(replies);
    const entries=[['12','11',3,'B'],['14','12',5,'D'],['11','10',1,'A'],['13','10',2,'C']];
    window.nativeReplies=[];
    for(const [id,parent,time,name]of entries){const el=document.createElement('bili-comment-reply-renderer');el.id='native-reply-'+id;el.data={rpid_str:id,parent_str:parent,root_str:'10',ctime:time,member:{uname:name},content:{message:parent==='10'?'回复主评论':'回复 @父评论：保留原生内容'}};const c=rr.querySelector('#expander-contents');c.insertBefore(document.createComment('lit-start-'+id),c.lastElementChild);c.insertBefore(el,c.lastElementChild);c.insertBefore(document.createComment('lit-end-'+id),c.lastElementChild);window.nativeReplies.push(el);}
    window.nativeReplyContainer=rr.querySelector('#expander-contents');window.originalNodes=[...window.nativeReplyContainer.childNodes];
  });
  const replies=page.locator('bili-comment-replies-renderer');
  await page.waitForFunction(()=>{const r=document.querySelector('bili-comments')?.shadowRoot.querySelector('bili-comment-thread-renderer')?.shadowRoot.querySelector('bili-comment-replies-renderer');return r?.shadowRoot.querySelector('#native-reply-14')?.dataset.bpReplyDepth==='2';});
  const state=await page.evaluate(()=>{
    const c=window.nativeReplyContainer;return {unchanged:window.originalNodes.every((n,i)=>c.childNodes[i]===n),entries:window.nativeReplies.map(n=>({id:n.id,depth:Number(n.dataset.bpReplyDepth),order:Number(n.style.getPropertyValue('--bp-tree-order')),top:n.getBoundingClientRect().top})),lines:c.getRootNode().querySelectorAll('.bp-tree-line').length};
  });
  assert.equal(state.unchanged,true);assert.deepEqual(state.entries.map(n=>n.depth),[1,2,0,0]);assert.deepEqual(state.entries.map(n=>n.order),[1,2,0,3]);assert.ok(state.lines>=2);
  assert.ok(state.entries[2].top<state.entries[0].top&&state.entries[0].top<state.entries[1].top&&state.entries[1].top<state.entries[3].top);
  results.push({name:'真实 MAIN 世界数据读取、树序、缩进、连线及 Lit 节点保留',state});console.log('PASS 树状层级与连线；原生回复及 Lit 标记节点保持原位');
  await replies.getByRole('button',{name:'收起B的回复',exact:true}).press('Enter');
  assert.equal(await page.locator('#native-reply-14').isVisible(),false);
  assert.equal(await page.locator('#native-reply-12').isVisible(),true);
  assert.equal(await page.locator('#native-reply-13').isVisible(),true);
  await replies.getByRole('button',{name:'展开B的回复',exact:true}).press('Space');
  assert.equal(await page.locator('#native-reply-14').isVisible(),true);
  await page.locator('#native-reply-11').getByRole('button',{name:'回复',exact:true}).click();
  assert.equal(await page.locator('#native-reply-11').getAttribute('data-native-clicked'),'true');
  results.push({name:'分支键盘折叠与原生回复操作',ok:true});console.log('PASS 分支折叠只影响子回复，原生回复按钮仍可用');
  await replies.getByRole('button',{name:'收起楼层',exact:true}).click();
  assert.equal(await page.locator('#native-reply-11').isVisible(),false);
  await replies.getByRole('button',{name:'全部展开楼层',exact:true}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#native-reply-14').isVisible(),true);
  console.log('PASS 全部展开及一键收起已加载楼层');
  // 评论页更换节点集合，继续利用已知 parent 链回溯当前可见祖先。
  await page.evaluate(()=>{document.getElementById('commentapp').style.marginTop='0';window.nativeReplies.filter(n=>n.id==='native-reply-12'||n.id==='native-reply-13').forEach(n=>n.remove());});
  await page.waitForFunction(()=>window.nativeReplies[1].dataset.bpReplyDepth==='1');
  assert.equal(await page.locator('#native-reply-14').isVisible(),true);
  results.push({name:'分页缺失父回复时沿已知关系回溯',ok:true});
  for(const theme of ['light','dark']){
    await page.emulateMedia({colorScheme:theme});await page.waitForTimeout(100);
    await page.screenshot({path:`tests/artifacts/comments-tree-${theme}.png`,fullPage:true});
  }
  await sw.evaluate(async()=>{const key='biliprism:settings';const s=(await chrome.storage.local.get(key))[key]||{};await chrome.storage.local.set({[key]:{...s,commentTree:false}});});
  await page.waitForFunction(()=>!window.nativeReplies[1].hasAttribute('data-bp-reply-depth'));
  assert.equal(await replies.locator('.bp-tree-guides').count(),0);
  await sw.evaluate(async()=>{const key='biliprism:settings';const s=(await chrome.storage.local.get(key))[key]||{};await chrome.storage.local.set({[key]:{...s,commentTree:true}});});
  await page.waitForFunction(()=>window.nativeReplies[1].dataset.bpReplyDepth==='0'); // 关闭后缓存清空，当前缺失父节点不再猜测。
  // Native reactive .list and pagination methods, including an in-flight request
  // and a failed page. The extension must use these methods and retain loaded data.
  await page.evaluate(()=>{
    const c=window.nativeReplyContainer,r=c.getRootNode().host;
    const initial=[...c.children].filter(n=>n.data).map(n=>n.data);
    initial.find(d=>d.rpid_str==='14').like=9;initial.find(d=>d.rpid_str==='14').action=1;
    const make=(id,parent,name)=>({rpid_str:id,parent_str:parent,root_str:'10',ctime:Number(id),member:{uname:name},content:{message:'分页回复 '+name},like:0,action:0});
    const pages=[initial,[make('12','11','B'),{...initial.find(d=>d.rpid_str==='14'),like:0,action:0},make('15','10','E')],[make('16','15','F')]];
    let list=initial,concurrent=0;r.maxConcurrent=0;r.calls=[];r.failPage3=true;
    const render=value=>{const old=new Map([...c.children].filter(n=>n.data).map(n=>[n.data.rpid_str,n]));[...c.children].filter(n=>n.data).forEach(n=>n.remove());for(const d of value){const n=old.get(d.rpid_str)||document.createElement('bili-comment-reply-renderer');n.id='native-reply-'+d.rpid_str;n.data=d;c.insertBefore(n,c.querySelector('#expander-footer'));}};
    Object.defineProperty(r,'list',{configurable:true,get:()=>list,set:value=>{list=value;render(value);}});
    r.currentPage=1;r.totalPage=3;r.pageSize=2;r.count=6;r.showPagination=true;r.showSpinner=false;
    r.handleChangePage=async({idx})=>{r.calls.push(idx+1);concurrent++;r.maxConcurrent=Math.max(concurrent,r.maxConcurrent);r.showSpinner=true;try{await new Promise(resolve=>setTimeout(resolve,80));if(idx===2&&r.failPage3){r.failPage3=false;throw new Error('模拟原生分页失败');}r.currentPage=idx+1;r.list=pages[idx];}finally{concurrent--;r.showSpinner=false;}};
    window.paginationRenderer=r;
  });
  await sw.evaluate(async()=>{const key='biliprism:settings',s=(await chrome.storage.local.get(key))[key]||{};await chrome.storage.local.set({[key]:{...s,comments:{...s.comments,batchPages:1}}});});
  await page.waitForTimeout(1000);
  await replies.getByRole('button',{name:/全部展开楼层|继续展开剩余楼层/}).click();
  await page.waitForFunction(()=>window.paginationRenderer.list.length===4);
  assert.equal(await page.evaluate(()=>window.paginationRenderer.list.find(d=>d.rpid_str==='14').like),9);
  assert.equal(await page.locator('#native-reply-14').getAttribute('data-bp-reply-depth'),'2');
  await replies.getByRole('button',{name:'继续展开剩余楼层',exact:true}).click();
  await replies.getByRole('status').filter({hasText:'模拟原生分页失败'}).waitFor();
  assert.equal(await page.evaluate(()=>window.paginationRenderer.list.length),4);
  await replies.getByRole('button',{name:'继续展开剩余楼层',exact:true}).click();
  await page.waitForFunction(()=>window.paginationRenderer.list.length===5);
  await page.waitForFunction(()=>document.querySelector('bili-comments').shadowRoot.querySelector('bili-comment-thread-renderer').shadowRoot.querySelector('bili-comment-replies-renderer').shadowRoot.querySelector('#native-reply-16').dataset.bpReplyDepth==='1');
  assert.deepEqual(await page.evaluate(()=>window.paginationRenderer.calls),[2,3,3]);
  assert.equal(await page.evaluate(()=>window.paginationRenderer.maxConcurrent),1);
  console.log('PASS 原生批量分页、跨页合树、去重、点赞保留、失败重试');
  assert.deepEqual(errors,[]);
  results.push({name:'设置关闭恢复原生布局，重新开启不猜测未知父关系',ok:true});console.log('PASS 树状设置开关与分页回退');
  writeFileSync('tests/artifacts/comments-results.json',JSON.stringify(results,null,2));
}finally{await ctx.close();rmSync(dir,{recursive:true,force:true});}

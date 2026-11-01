/** Adapted from BewlyCat src/inject/index.ts expandAllCommentReplies.
 * Use each renderer's own pagination methods, never patch prototypes or fetch. */
export type ReplyData = Record<string, unknown>;
export type PaginatedRenderer = HTMLElement & {
  list?: ReplyData[]; currentPage?: number; totalPage?: number; count?: number; pageSize?: number;
  showPagination?: boolean; showSpinner?: boolean; showViewMore?: boolean; user?: unknown;
  handleViewMore?: (event: { stopPropagation(): void }) => unknown;
  handleChangePage?: (item: { idx: number; clickable: boolean }) => unknown;
  requestUpdate?: () => void; updateComplete?: Promise<unknown>;
};
export interface ReplyPages {
  pages: Map<number, ReplyData[]>;
  merged?: ReplyData[];
  busy: boolean;
  stopped: boolean;
}
export const replyId = (d: ReplyData): string => String(d.rpid_str ?? d.rpid ?? '');
export function mergeReplies(lists: ReplyData[][]): ReplyData[] {
  const replies = new Map<string, ReplyData>();
  for (const list of lists) for (const reply of list) {
    const key = replyId(reply);
    if (key) replies.set(key, reply);
  }
  return [...replies.values()];
}
export const totalPages = (r: PaginatedRenderer): number => {
  const n = Number(r.totalPage) || Math.ceil(Number(r.count) / Number(r.pageSize));
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
};
export function rememberPage(r: PaginatedRenderer, p: ReplyPages): void {
  if (p.busy || !Array.isArray(r.list) || r.list === p.merged) return;
  // A native page change returns to the native single-page view.
  p.pages.clear(); p.merged = undefined;
  if (r.showPagination) p.pages.set(Number(r.currentPage) || 1, r.list.slice());
}
async function request(r: PaginatedRenderer, p: ReplyPages, run: () => unknown, active: () => boolean): Promise<void> {
  const before = r.list;
  const result = run();
  if (result && typeof (result as Promise<unknown>).then === 'function') await result;
  const start = Date.now();
  while (active() && !p.stopped && r.isConnected) {
    if (r.showSpinner !== true && Array.isArray(r.list) && r.list !== before) {
      await r.updateComplete; return;
    }
    if (Date.now() - start > 8000) throw new Error('原生回复加载未完成，请稍后重试');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('已停止展开');
}
export async function expandReplyPages(r: PaginatedRenderer, p: ReplyPages, limit: number,
  active: () => boolean, rendered: () => ReplyData[], progress: () => void): Promise<void> {
  if (p.busy) return;
  rememberPage(r, p);
  p.busy = true; p.stopped = false;
  const interactions = new Map<string, ReplyData>();
  const capture = () => {
    for (const d of rendered()) interactions.set(replyId(d), { action: d.action, like: d.like });
  };
  capture();
  let loaded = 0;
  const apply = () => {
    capture();
    const merged = mergeReplies([...p.pages.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v));
    for (const d of merged) {
      const interaction = interactions.get(replyId(d));
      if (interaction) for (const key of ['action','like']) if (typeof interaction[key] === 'number') d[key] = interaction[key];
    }
    if (merged.length && active() && !p.stopped) {
      r.list = merged; p.merged = merged; r.requestUpdate?.();
    }
  };
  try {
    progress();
    if (!r.showPagination && r.showViewMore && r.handleViewMore) {
      await request(r, p, () => r.handleViewMore!({ stopPropagation() {} }), active);
      p.pages.set(Number(r.currentPage) || 1, r.list!.slice()); loaded++;
    }
    if (!r.showPagination || !r.handleChangePage || !Array.isArray(r.list)) {
      if(totalPages(r)>1) throw new Error('此版原生组件未提供分页入口，请使用原生查看更多回复');
      return;
    }
    if (!p.pages.size) p.pages.set(Number(r.currentPage) || 1, r.list.slice());
    while (active() && !p.stopped && loaded < limit) {
      const next = Array.from({ length: totalPages(r) }, (_, i) => i+1).find(n => !p.pages.has(n));
      if (!next) break;
      capture();
      await request(r, p, () => r.handleChangePage!({ idx: next-1, clickable: true }), active);
      p.pages.set(next, r.list!.slice()); loaded++;
      progress();
    }
  } finally {
    // Retain successful pages if a later request fails. No native DOM manipulation.
    apply(); p.busy = false; progress();
  }
}

// Tree ordering adapted from BewlyCat inject/index.ts (buildCommentReplyTreeOrder).
// Copyright Keleus / Hakadao; see licenses/BewlyCat-LICENSE.txt.
export interface ReplyMeta { id: string; parent: string; root: string; time: number | null }
export interface TreeEntry<T> { item: T; meta: ReplyMeta; depth: number; parentId: string | null; children: TreeEntry<T>[]; order: number }
/** 父节点优先，再按时间排序；跨页只回溯已知关系，不按用户名猜父节点。 */
export function orderReplies<T>(items: { item: T; meta: ReplyMeta }[], cache = new Map<string, ReplyMeta>()): TreeEntry<T>[] {
  const nodes = items.map((x, i): TreeEntry<T> => ({ ...x, depth: 0, parentId: null, children: [], order: i }));
  const byId = new Map(nodes.map(n => [n.meta.id, n]));
  const roots: TreeEntry<T>[] = [];
  for (const n of nodes) {
    let id = n.meta.parent;
    const seen = new Set([n.meta.id]);
    while (id && id !== '0' && id !== n.meta.root && !seen.has(id)) {
      seen.add(id);
      const visible = byId.get(id);
      if (visible) { n.parentId = id; visible.children.push(n); break; }
      id = cache.get(id)?.parent ?? '';
    }
    if (!n.parentId) roots.push(n);
  }
  const cmp = (a: TreeEntry<T>, b: TreeEntry<T>) => (a.meta.time ?? Infinity) - (b.meta.time ?? Infinity) || a.order - b.order;
  roots.sort(cmp); nodes.forEach(n => n.children.sort(cmp));
  const ordered: TreeEntry<T>[] = [], visited = new Set<TreeEntry<T>>();
  const visit = (n: TreeEntry<T>, depth: number) => {
    if (visited.has(n)) return;
    visited.add(n); n.depth = Math.min(8, depth); ordered.push(n);
    n.children.forEach(c => visit(c, depth + 1));
  };
  roots.forEach(n => visit(n, 0));
  nodes.sort(cmp).forEach(n => visit(n, 0));
  return ordered;
}

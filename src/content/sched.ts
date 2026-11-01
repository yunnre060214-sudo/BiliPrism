/**
 * 共享的周期任务调度器：全页面只有一个 setTimeout。
 * - 页面隐藏（document.hidden）时暂停所有周期任务，除非任务声明 hidden: true（例如后台播放时的足迹心跳）；
 * - 切回可见时，过期的任务只补跑一次，不会连发；
 * - 到期时间相近（相差不到 max(60ms, 周期的 1/10)）的任务合并到同一次唤醒里执行。
 * 入口脚本和按需加载的页面模块各自打包一份，但都只在需要时才挂计时器。
 */
interface Task { ms: number; fn: () => void; due: number; hidden: boolean; dead: boolean }

const tasks = new Set<Task>();
let timer = 0;
let at = Infinity;
let bound = false;

const runnable = (t: Task) => !t.dead && (t.hidden || !document.hidden);

function arm(): void {
  let next = Infinity;
  for (const t of tasks) if (runnable(t) && t.due < next) next = t.due;
  if (next === at && timer) return;
  clearTimeout(timer);
  timer = 0;
  at = next;
  if (next === Infinity) return;
  timer = window.setTimeout(fire, Math.max(0, next - performance.now()));
}

function fire(): void {
  timer = 0;
  at = Infinity;
  const now = performance.now();
  for (const t of [...tasks]) {
    if (!runnable(t)) continue;
    const slack = Math.max(60, t.ms / 10);
    if (t.due - now > slack) continue;
    t.due = now + t.ms;
    try { t.fn(); } catch (e) { console.error('[BiliPrism] task', e); }
  }
  arm();
}

function bind(): void {
  if (bound) return;
  bound = true;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      // 切回来：过期的任务马上补一次
      const now = performance.now();
      for (const t of tasks) if (t.due < now) t.due = now;
    }
    arm();
  });
}

/** 每隔 ms 执行一次 fn；返回取消函数 */
export function every(ms: number, fn: () => void, o: { hidden?: boolean; immediate?: boolean } = {}): () => void {
  bind();
  const t: Task = { ms, fn, due: performance.now() + (o.immediate ? 0 : ms), hidden: !!o.hidden, dead: false };
  tasks.add(t);
  arm();
  return () => { t.dead = true; tasks.delete(t); arm(); };
}

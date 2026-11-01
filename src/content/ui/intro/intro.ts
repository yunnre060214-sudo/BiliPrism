import { setIntroActive, SESSION_KEY } from './gate';
export { BILI, BILI_TIGHT } from './logo';
export { shouldPlayIntro } from './gate';
/** 短开场仅使用有限时长的 opacity / transform 动画。 */
export function playIntro(parent: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* storage unavailable */ }
  setIntroActive(true);
  const el = document.createElement('div'); el.className = 'intro';
  el.style.background = theme === 'dark' ? '#111112' : '#f5f4f1';
  const name = document.createElement('div'); name.textContent = '映棱 BiliPrism';
  name.style.cssText = 'font:500 32px system-ui;color:#00aeec;letter-spacing:.06em';
  el.append(name); parent.append(el);
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer);
      removeEventListener('keydown', finish, true); setIntroActive(false);
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).finished.finally(() => { el.remove(); resolve(); });
    };
    el.addEventListener('pointerdown', finish, { once: true }); addEventListener('keydown', finish, true);
    name.animate([{ opacity: 0, transform: 'translateY(12px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 380, fill: 'both', easing: 'ease-out' });
    const timer = window.setTimeout(finish, 700);
  });
}

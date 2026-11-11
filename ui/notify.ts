// A message stays long enough to read a few lines; a click ends it sooner.
const LIFE = 5000;

/** What a binding says: cards in the corner of the window, newest nearest the corner, each going away on its own or
 * when it is clicked. They take no focus, so the keys stay where they were. */
export function notifications(corner: HTMLElement) {
  const stack = document.createElement('div');
  stack.className = 'notifications';
  stack.setAttribute('role', 'status');
  corner.append(stack);
  const off = window.wangcai.subscribe('core:notify', (value) => {
    const card = document.createElement('div');
    card.className = 'notification';
    card.textContent = value as string;
    const drop = () => { clearTimeout(timer); card.remove(); };
    const timer = setTimeout(drop, LIFE);
    card.onclick = drop;
    stack.append(card);
  });
  return () => {
    off();
    stack.remove();
  };
}
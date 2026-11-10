import type { Dispose } from '@lengmoxxl/sdk/channel';

/** Where a menu hangs, in client coordinates. */
export type MenuAnchor = { left: number; top: number };

// The room the sidebars must leave the main pane: style.css gives the pane a 240px minimum, and the dividers
// and the window's padding sit on top of that budget.
const MAIN_MIN_WIDTH = 248;

/** The two dividers that size the sidebars, dragged or stepped with the arrow keys. */
export function sidebarDividers(root: HTMLElement, left: HTMLElement, right: HTMLElement, disposers: Dispose[]) {
  const stored = JSON.parse(localStorage.getItem('sidebar-ratios') ?? '{}') as { left?: number; right?: number };
  const ratios = {
    left: stored.left ?? 232 / root.clientWidth,
    right: stored.right ?? Math.min(600, root.clientWidth * .4) / root.clientWidth,
  };
  for (const [side, pane, opposite, minimum] of [
    ['left', left, right, 120], ['right', right, left, 260],
  ] as const) {
    const divider = document.createElement('div');
    divider.className = `sidebar-divider divider-${side}`;
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', side === 'left' ? '调整左侧栏宽度' : '调整右侧栏宽度');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.tabIndex = 0;
    if (side === 'left') left.after(divider); else right.before(divider);
    let painted: number;
    const paint = (requested = root.clientWidth * ratios[side]) => {
      const maximum = Math.max(minimum, root.clientWidth - (opposite.hidden ? 0 : opposite.getBoundingClientRect().width) - MAIN_MIN_WIDTH);
      painted = Math.round(Math.max(minimum, Math.min(maximum, requested)));
      pane.style.width = `${painted}px`;
      divider.hidden = pane.hidden;
      divider.setAttribute('aria-valuemin', String(minimum));
      divider.setAttribute('aria-valuemax', String(Math.round(maximum)));
      divider.setAttribute('aria-valuenow', String(painted));
      return painted;
    };
    const resize = (requested: number) => {
      ratios[side] = paint(requested) / root.clientWidth;
      localStorage.setItem('sidebar-ratios', JSON.stringify(ratios));
    };
    const observer = new ResizeObserver(() => paint());
    observer.observe(root);
    observer.observe(pane);
    observer.observe(opposite);
    disposers.push(() => observer.disconnect());
    let origin: number;
    let width: number;
    divider.onpointerdown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      origin = event.clientX;
      width = painted;
      divider.setPointerCapture(event.pointerId);
    };
    divider.onpointermove = (event) => {
      if (divider.hasPointerCapture(event.pointerId)) resize(width + (event.clientX - origin) * (side === 'left' ? 1 : -1));
    };
    divider.onpointerup = (event) => { if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId); };
    divider.onkeydown = (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      resize(painted + (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1));
    };
    paint();
  }
}

// A menu is as large as its entries, so where it fits is only known once they are in the DOM.
export const clampMenu = (menu: HTMLElement, at: MenuAnchor) => {
  menu.style.left = `${Math.max(4, Math.min(at.left, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(at.top, window.innerHeight - menu.offsetHeight - 4))}px`;
};

// A child of the target is still the target, so the marker stays while the pointer crosses one.
export const onDragLeave = (element: HTMLElement) => {
  element.ondragleave = (event) => { if (!element.contains(event.relatedTarget as Node)) delete element.dataset.drop; };
};

// A drag cancelled with Escape never reaches dragleave or drop, so the target keeps its marker.
export const clearDrop = (container: HTMLElement) => {
  for (const node of container.querySelectorAll<HTMLElement>('[data-drop]')) delete node.dataset.drop;
};

// How long a press is held before it can drag: the browser starts a drag on the first pixel a press moves, and macOS
// answers a press that was only a shaky click with its copy cursor — a green plus flashing over a tab nobody meant to
// drag. A press that has not been held this long stays a click, and a click does not move anything.
const DRAG_HOLD = 200;

// An element that starts a drag hands over what is being dragged, and clears the markers off its container when the
// drag ends.
export const dragSource = (element: HTMLElement, start: () => void, end: () => void, container: HTMLElement) => {
  let armTimer = 0;
  const disarm = () => {
    window.clearTimeout(armTimer);
    armTimer = 0;
    element.draggable = false;
  };
  const arm = () => {
    disarm();
    armTimer = window.setTimeout(() => { element.draggable = true; }, DRAG_HOLD);
  };
  element.onpointerdown = (event) => { if (event.button === 0) arm(); };
  element.onpointerup = disarm;
  element.onpointercancel = disarm;
  element.ondragstart = (event) => {
    start();
    event.dataTransfer!.effectAllowed = 'move';
  };
  element.ondragend = () => {
    end();
    clearDrop(container);
    disarm();
  };
};

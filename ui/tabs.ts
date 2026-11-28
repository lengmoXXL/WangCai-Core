import type { TabContent, TabOptions, TabRecord } from '@lengmoxxl/sdk/channel';
import { call } from './bridge';
import { handKeysTo } from './keymap';
import { clampMenu, dragSource, onDragLeave, type MenuAnchor } from './layout';

export async function sidebarTabs(root: HTMLElement, mainPage: () => HTMLElement | undefined) {
  // Scroll events do not bubble, so only a capture-phase listener can see the sidebar panels scroll.
  const SCROLLBAR_IDLE = 700;
  const idleTimers = new WeakMap<Element, number>();
  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.closest('.sidebar-right')) return;
    target.dataset.scrolling = '';
    clearTimeout(idleTimers.get(target));
    idleTimers.set(target, window.setTimeout(() => delete target.dataset.scrolling, SCROLLBAR_IDLE));
  };
  document.addEventListener('scroll', onScroll, true);

  const right = document.createElement('aside');
  right.className = 'desktop-sidebar sidebar-right';
  right.setAttribute('aria-label', '右侧边栏');
  right.hidden = true;
  const header = document.createElement('header');
  header.className = 'sidebar-tabs';
  header.setAttribute('role', 'tablist');
  header.setAttribute('aria-label', '侧栏标签页');
  const content = document.createElement('div');
  content.className = 'sidebar-content';
  right.append(header, content);
  type Tab = {
    key: string; element: HTMLElement; button: HTMLButtonElement; panel: HTMLElement;
    options: TabOptions; content?: TabContent; workspaceId?: string;
  };
  type RestoreRegistration = { record: TabRecord; claimed?: true };
  let active: string | undefined;
  let current = '';
  let collapsed = false;
  const selected = new Map<string, string>();
  const tabs = new Map<string, Tab>();
  let records = new Map<string, TabRecord>();
  let dragging: string | undefined;
  let registeringRestore: RestoreRegistration | undefined;
  let knownWorkspaces = new Set<string>();
  // The key a tab is known by: the records, the open tabs and a workspace's selected tab align on it.
  const keyOf = (plugin: string, workspaceId: string | undefined, id: string) => JSON.stringify([plugin, workspaceId ?? '', id]);
  for (const record of await call<TabRecord[]>('tabs')) records.set(keyOf(record.plugin, record.workspaceId, record.id), record);
  const orderedTabs = () => [...records.keys()].flatMap((key) => tabs.get(key) ?? []);
  const save = () => { void call('save-tabs', [...records.values()]); };
  const rekey = (from: string, to: string, record: TabRecord) => {
    records = new Map([...records].map(([key, entry]) => key === from ? [to, record] : [key, entry]));
  };

  const viewPicker = document.createElement('button');
  viewPicker.className = 'view-picker';
  viewPicker.textContent = '+';
  viewPicker.setAttribute('aria-label', '新建侧栏标签页');
  const viewMenu = document.createElement('div');
  viewMenu.id = 'view-menu';
  viewMenu.className = 'view-menu';
  viewMenu.popover = 'auto';
  viewPicker.popoverTargetElement = viewMenu;
  const pickerAnchor = (): MenuAnchor => {
    const bounds = viewPicker.getBoundingClientRect();
    return { left: bounds.left, top: bounds.bottom + 4 };
  };
  viewMenu.addEventListener('beforetoggle', (event) => {
    if (event.newState !== 'open') return;
    const at = pickerAnchor();
    viewMenu.style.left = `${at.left}px`;
    viewMenu.style.top = `${at.top}px`;
  });
  viewMenu.addEventListener('toggle', (event) => {
    if (event.newState !== 'open') return;
    clampMenu(viewMenu, pickerAnchor());
  });
  header.append(viewPicker);
  const toggle = document.createElement('button');
  toggle.className = 'sidebar-toggle';
  toggle.textContent = '◧';
  toggle.setAttribute('aria-label', '切换右侧栏');
  toggle.setAttribute('aria-expanded', 'false');
  root.append(toggle, viewMenu);
  const setSidebarHidden = (hidden = collapsed || !tabs.size) => {
    right.hidden = hidden;
    toggle.setAttribute('aria-expanded', String(!hidden));
  };

  // A tab that follows no workspace is drawn in every one of them.
  const inFront = (tab: Tab) => tab.workspaceId === undefined || tab.workspaceId === active;
  const drawTab = (tab: Tab) => {
    const visible = inFront(tab);
    const isCurrent = tab.key === current;
    tab.element.hidden = !visible;
    tab.button.setAttribute('aria-selected', String(isCurrent));
    tab.panel.hidden = !visible || !isCurrent;
  };
  const drawTabs = () => { for (const tab of tabs.values()) drawTab(tab); };
  const frontTab = () => {
    const tab = right.hidden ? undefined : tabs.get(current);
    return tab && inFront(tab) ? tab : undefined;
  };
  const mount = (tab: Tab, showing = false): TabContent => {
    try {
      const mounted = tab.content ??= tab.options.mount(tab.panel);
      if (showing) mounted.onSelect?.();
      return mounted;
    } catch (error) {
      const message = document.createElement('div');
      message.className = 'plugin-error';
      message.textContent = `${tab.panel.dataset.plugin}: ${error instanceof Error ? error.message : String(error)}`;
      tab.panel.prepend(message);
      const mounted = tab.content;
      return tab.content = { dispose: () => mounted?.dispose() };
    }
  };
  const showSelected = () => {
    setSidebarHidden();
    drawTabs();
    const tab = frontTab();
    if (tab) mount(tab, true);
  };
  const selectedKey = () => selected.get(active ?? '') ?? selected.get('') ?? '';
  const takeKeys = (page?: HTMLElement) => handKeysTo(page ?? frontTab()?.panel ?? mainPage());
  // Whether the sidebar has a tab in front to hand the keys to: without one it is not a pane that can take them.
  const takesKeys = () => frontTab() !== undefined;
  const select = (key: string, restoring = false) => {
    const tab = tabs.get(key);
    if (tab) selected.set(tab.workspaceId ?? '', key);
    if (!restoring) collapsed = false;
    if (tab && !inFront(tab)) {
      setSidebarHidden();
      drawTab(tab);
      return;
    }
    current = tab ? key : '';
    // The plugin's mount and onSelect can focus controls while the user is typing elsewhere.
    const panel = restoring && document.activeElement !== document.body ? tab?.panel : undefined;
    if (panel) panel.inert = true;
    try {
      showSelected();
    } finally {
      if (panel) panel.inert = false;
    }
    if (!restoring || document.activeElement === document.body) takeKeys();
    tab?.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  toggle.onclick = () => {
    collapsed = !right.hidden;
    setSidebarHidden(collapsed);
    // Hiding the sidebar, and showing it with no tab in front, hand the keys over here: `select` goes through `showSelected`,
    // which sets the sidebar's visibility from the tab count, so it would undo the hide or hide an empty sidebar again.
    if (frontTab()) select(current);
    else takeKeys();
    viewMenu.hidePopover();
  };

  const disposeContent = (content: TabContent) => {
    try { void Promise.resolve(content.dispose()).catch(console.error); } catch (error) { console.error(error); }
  };
  const removeTab = (key: string) => {
    const tab = tabs.get(key)!;
    // Plugins can keep state from open() in the disposer returned by mount().
    const content = mount(tab);
    try { tab.options.onClose?.(); } catch (error) { console.error(error); }
    disposeContent(content);
    tab.element.remove();
    tab.panel.remove();
    tabs.delete(key);
    records.delete(key);
  };
  const settle = (activeId: string | undefined) => {
    active = activeId;
    collapsed = false;
    save();
    const wanted = selectedKey();
    current = tabs.has(wanted) ? wanted : '';
    showSelected();
  };
  const rebindTabs = (id: string) => {
    for (const tab of orderedTabs()) {
      if (tab.workspaceId !== undefined) continue;
      const key = tab.key;
      const record = records.get(key)!;
      const moved = keyOf(record.plugin, id, record.id);
      tabs.delete(key);
      tab.workspaceId = id;
      tab.key = moved;
      tabs.set(moved, tab);
      rekey(key, moved, { ...record, workspaceId: id });
      if (selected.get('') === key) selected.set(id, moved);
    }
  };
  // A tab whose workspace a provider stopped serving goes with it.
  const closeGoneTabs = (ids: string[]) => {
    const present = new Set(ids);
    let changed = false;
    for (const [key, { workspaceId }] of [...records]) {
      if (workspaceId === undefined || present.has(workspaceId)) continue;
      if (tabs.has(key)) removeTab(key);
      else if (!knownWorkspaces.has(workspaceId) || !records.delete(key)) continue;
      changed = true;
    }
    knownWorkspaces = present;
    if (changed) save();
  };

  // Closing a tab hands its place to the neighbour beside it; the window's keys close one the same way.
  const closeTab = (key: string) => {
    const tab = tabs.get(key);
    if (!tab) return;
    const siblings = orderedTabs().filter((item) => (item.workspaceId ?? '') === (tab.workspaceId ?? '')).map((item) => item.key);
    const index = siblings.indexOf(key);
    removeTab(key);
    save();
    if (current === key) select(siblings[index - 1] ?? siblings[index + 1] ?? '');
  };

  const open = (plugin: string, options: TabOptions, registration = registeringRestore) => {
    const restore = registration && !registration.claimed && registration.record.plugin === plugin
      && registration.record.id === options.id ? registration : undefined;
    const workspaceId = options.workspaceId ?? active;
    const key = keyOf(plugin, workspaceId, options.id);
    const existing = tabs.get(key);
    if (restore) {
      const { record } = restore;
      const savedKey = keyOf(plugin, record.workspaceId, record.id);
      if (records.get(savedKey) !== record || tabs.has(savedKey)) return;
      if (savedKey !== key) {
        if (records.has(key)) {
          records.delete(savedKey);
          save();
          return;
        }
        rekey(savedKey, key, { ...record, workspaceId });
        save();
      }
      restore.claimed = true;
    } else if (!records.has(key)) {
      records.set(key, { plugin, id: options.id, workspaceId });
      save();
    }
    if (existing) {
      disposeContent(mount(existing));
      existing.panel.replaceChildren();
      existing.content = undefined;
      existing.options = options;
      select(key);
      return;
    }
    const element = document.createElement('div');
    element.className = 'sidebar-tab';
    element.hidden = true;
    const button = document.createElement('button');
    button.setAttribute('role', 'tab');
    button.textContent = options.title;
    button.title = options.tooltip ?? options.title;
    const close = document.createElement('button');
    close.className = 'close-tab';
    close.textContent = '×';
    close.setAttribute('aria-label', `关闭 ${options.title}`);
    const panel = document.createElement('section');
    panel.className = 'sidebar-panel';
    panel.hidden = true;
    panel.dataset.plugin = plugin;
    // `-1`: a click focuses the pane so its local keys answer, without adding a tab stop.
    panel.tabIndex = -1;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-label', options.title);
    const tab: Tab = { key, element, button, panel, workspaceId, options };
    button.onclick = () => select(tab.key);
    close.onclick = () => closeTab(tab.key);
    element.append(button, close);
    element.draggable = true;
    // A native drag swallows the click that would have chosen the tab, so the drag chooses it.
    dragSource(element, () => {
      dragging = tab.key;
      select(tab.key);
    }, () => { dragging = undefined; }, header);
    element.ondragover = (event) => {
      if (dragging === undefined || dragging === tab.key) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      element.dataset.drop = event.clientX < box.left + box.width / 2 ? 'before' : 'after';
    };
    onDragLeave(element);
    element.ondrop = (event) => {
      event.preventDefault();
      const source = dragging!;
      const after = element.dataset.drop === 'after';
      const visible = orderedTabs().filter(inFront);
      const before = after ? visible[visible.indexOf(tab) + 1]?.key : tab.key;
      if (source === before) return;
      const record = records.get(source)!;
      records.delete(source);
      if (before === undefined) records.set(source, record);
      else {
        const entries = [...records];
        records.clear();
        for (const [item, entry] of entries) {
          if (item === before) records.set(source, record);
          records.set(item, entry);
        }
      }
      header.insertBefore(tabs.get(source)!.element, before === undefined ? viewPicker : tabs.get(before)!.element);
      save();
    };
    tabs.set(key, tab);
    const ordered = orderedTabs();
    header.insertBefore(element, ordered[ordered.indexOf(tab) + 1]?.element ?? viewPicker);
    content.append(panel);
    if (restore) {
      const scope = workspaceId ?? '';
      if (registeringRestore) {
        if (!inFront(tab) || !frontTab()) selected.set(scope, key);
        return;
      }
      if (tabs.has(selected.get(scope) ?? '')) { drawTab(tab); return; }
    }
    select(key, restore !== undefined);
  };

  return {
    element: right,
    rebind: rebindTabs,
    closeGone: closeGoneTabs,
    closeSelected() { closeTab(current); },
    /** Brings an open tab of this plugin, in the workspace in front, to the front; false when there is none. */
    reveal(plugin: string) {
      const picked = orderedTabs().find((tab) => records.get(tab.key)!.plugin === plugin && inFront(tab));
      if (!picked) return false;
      select(picked.key);
      return true;
    },
    settle,
    takeKeys,
    takesKeys,
    open,
    addView(title: string, open: () => void) {
      const item = document.createElement('button');
      item.textContent = title;
      item.onclick = () => { open(); viewMenu.hidePopover(); };
      viewMenu.append(item);
    },
    async restore(openView: (record: TabRecord, register: (options: TabOptions) => void) => Promise<void> | undefined) {
      if (!records.size) return;
      const pending: (Promise<void> | undefined)[] = [];
      try {
        for (const [key, record] of [...records]) {
          if (records.get(key) !== record || tabs.has(key)) continue;
          const registration = { record };
          // A plugin may open through the context it saved from mount().
          registeringRestore = registration;
          pending.push(openView(record, (options) => open(record.plugin, options, registration)));
        }
      } finally {
        registeringRestore = undefined;
        const key = selectedKey();
        if (key !== current && tabs.has(key)) select(key);
        else {
          setSidebarHidden();
          drawTabs();
        }
      }
      await Promise.all(pending);
    },
    dispose() {
      document.removeEventListener('scroll', onScroll, true);
      for (const tab of tabs.values()) if (tab.content) disposeContent(tab.content);
      tabs.clear();
    },
  };
}

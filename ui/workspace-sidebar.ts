import type { WorkspaceMenuItem, WorkspaceRow, WorkspaceStatus } from '@lengmoxxl/sdk';
import type { Dispose } from '@lengmoxxl/sdk/channel';
import type { WorkspaceGroup } from '@lengmoxxl/sdk/bridge';
import { call } from './bridge';
import { clampMenu, clearDrop, dragSource, onDragLeave } from './layout';
// A div with a role is not a button, so it answers a click and the keys a button would.
const onActivate = (element: HTMLElement, action: () => void) => {
  element.onclick = action;
  element.onkeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    action();
  };
};

type RenameTarget = { kind: 'workspace' | 'group'; id: string };

/** What the list asks of the tab strip, which is the one that holds every tab. */
interface WorkspaceTabs {
  /** Every tab that follows no workspace yet starts following this one. */
  rebind(id: string): void;
  /** The tabs whose workspace is not among these ids are closed. */
  closeGone(ids: string[]): void;
  /** The tab state is written down and drawn around the workspace in front. */
  settle(id: string | undefined): void;
}

/** The left sidebar: one row per workspace a provider serves, gathered under the groups the window holds. */
export async function workspaceSidebar(options: {
  root: HTMLElement;
  providers: string[];
  tabs: WorkspaceTabs;
  closing: () => boolean;
  disposers: Dispose[];
}) {
  const { root, providers, tabs, closing, disposers } = options;
  const element = document.createElement('aside');
  element.className = 'desktop-sidebar sidebar-left';
  const rowsByProvider = new Map(providers.map((id) => [id, [] as WorkspaceRow[]]));
  const providerOf = (id: string) => providers.find((provider) => rowsByProvider.get(provider)!.some((row) => row.id === id));
  const groups = await call<WorkspaceGroup[]>('groups');
  // The workspace in front.
  let active: string | undefined;
  // A group only decides which workspaces sit together.
  const groupOf = (id: string) => groups.find((group) => group.workspaces.includes(id));
  const groupById = (id: string) => groups.find((group) => group.id === id);
  const servedRows = () => providers.flatMap((provider) => rowsByProvider.get(provider)!);
  // What the list is made of, with what an agent reports left out: a status flip changes a row, not the list.
  const shapeOf = (rows: WorkspaceRow[]) => JSON.stringify(rows.map(({ status, ...rest }) => rest));
  const membersOf = (rows: WorkspaceRow[]) => JSON.stringify(rows.map((row) => row.id));
  let drawnShape = '';
  let drawnMembers = '';
  const topRows = (rows: WorkspaceRow[]) => rows.filter((row) => !groupOf(row.id));
  // A missing count reads as Infinity, so the slot comparison stays a number comparison.
  const rowsAbove = (group: WorkspaceGroup) => group.after ?? Infinity;
  // The place a group is drawn at, by the top-level rows its record counts and no further than the rows there are,
  // since the list can be shorter than the record says. Drawing a group and dropping near one both read it here.
  const drawSlot = (group: WorkspaceGroup, top: WorkspaceRow[]) => Math.min(rowsAbove(group), top.length);
  let draggingRow: string | undefined;
  let draggingGroup: string | undefined;
  // A drag is handled once, so the id it carries is taken before any branch below can return early.
  const takenRow = () => { const id = draggingRow!; draggingRow = undefined; return id; };
  const takenGroup = () => { const id = draggingGroup!; draggingGroup = undefined; return id; };
  const workspaceHeader = document.createElement('header');
  workspaceHeader.className = 'workspace-header';
  const workspaceTitle = document.createElement('span');
  workspaceTitle.textContent = '工作区';
  workspaceHeader.append(workspaceTitle);
  const workspaceList = document.createElement('nav');
  workspaceList.className = 'workspaces';
  workspaceList.setAttribute('role', 'tablist');
  workspaceList.setAttribute('aria-label', '工作区');
  workspaceList.setAttribute('aria-orientation', 'vertical');
  element.append(workspaceHeader, workspaceList);

  // A workspace row is a draggable tab and a group bar folds where it stands, so renaming either asks in a
  // dialog rather than in place.
  const renameScrim = document.createElement('div');
  renameScrim.className = 'menu-scrim rename-scrim';
  renameScrim.hidden = true;
  const renameDialog = document.createElement('form');
  renameDialog.className = 'rename-dialog';
  renameDialog.setAttribute('role', 'dialog');
  const renameInput = document.createElement('input');
  renameInput.className = 'rename-input';
  const renameNote = document.createElement('p');
  renameNote.className = 'rename-note';
  renameNote.setAttribute('role', 'alert');
  const renameCancel = document.createElement('button');
  renameCancel.type = 'button';
  renameCancel.textContent = '取消';
  const renameSubmit = document.createElement('button');
  renameSubmit.type = 'submit';
  renameSubmit.textContent = '重命名';
  const renameActions = document.createElement('div');
  renameActions.className = 'rename-actions';
  renameActions.append(renameCancel, renameSubmit);
  renameDialog.append(renameInput, renameNote, renameActions);
  renameScrim.append(renameDialog);
  root.append(renameScrim);
  let renameTarget: RenameTarget | undefined;
  const hideRename = () => { renameScrim.hidden = true; renameTarget = undefined; };
  const openRename = (target: RenameTarget) => {
    renameTarget = target;
    const forGroup = target.kind === 'group';
    renameDialog.setAttribute('aria-label', forGroup ? '重命名分组' : '重命名工作区');
    renameInput.setAttribute('aria-label', forGroup ? '分组名称' : '工作区名字');
    renameInput.placeholder = forGroup ? '' : '留空则恢复默认名字';
    renameInput.value = forGroup
      ? groupById(target.id)!.name
      : servedRows().find((row) => row.id === target.id)?.label ?? '';
    renameNote.textContent = '';
    renameScrim.hidden = false;
    renameInput.focus();
    renameInput.select();
  };
  renameScrim.onclick = (event) => { if (!renameDialog.contains(event.target as Node)) hideRename(); };
  renameCancel.onclick = hideRename;
  renameDialog.onsubmit = async (event) => {
    event.preventDefault();
    const target = renameTarget;
    if (!target) return;
    renameSubmit.disabled = true;
    try {
      if (target.kind === 'group') {
        const name = renameInput.value.trim();
        if (!name) {
          renameNote.textContent = '分组名称不能为空';
          return;
        }
        renameGroup(target.id, name);
      } else {
        const provider = providerOf(target.id);
        if (!provider) return;
        await call('request', provider, 'workspace-rename', { id: target.id, name: renameInput.value });
        await refreshRows();
      }
      hideRename();
    } catch (error) {
      renameNote.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      renameSubmit.disabled = false;
    }
  };

  const rowMenu = document.createElement('div');
  rowMenu.id = 'workspace-row-menu';
  rowMenu.className = 'view-menu';
  rowMenu.setAttribute('role', 'menu');
  rowMenu.setAttribute('aria-label', '工作区');
  const rowBackdrop = document.createElement('div');
  rowBackdrop.className = 'menu-scrim';
  rowBackdrop.hidden = true;
  rowBackdrop.append(rowMenu);
  root.append(rowBackdrop);
  const hideRowMenu = () => { rowBackdrop.hidden = true; };
  // A click on an entry belongs to the entry, which decides for itself when the menu goes away.
  rowBackdrop.onclick = (event) => { if (!rowMenu.contains(event.target as Node)) hideRowMenu(); };

  const openRowMenu = async (event: MouseEvent) => {
    event.preventDefault();
    const at = { left: event.clientX, top: event.clientY };
    const target = event.target as Element;
    const menuRow = target.closest<HTMLElement>('.workspace')?.dataset.workspace;
    // A row inside a group answers as a row, so the group is only asked when no row was hit.
    const menuGroup = menuRow === undefined ? target.closest<HTMLElement>('.workspace-group')?.dataset.group : undefined;
    rowMenu.replaceChildren();
    rowMenu.style.left = `${at.left}px`;
    rowMenu.style.top = `${at.top}px`;
    rowBackdrop.hidden = false;
    const items: HTMLElement[] = [];
    const entry = (label: string, action: () => void) => {
      const button = document.createElement('button');
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      button.onclick = action;
      return button;
    };
    // A row's menu acts on that row, a group's menu on that group, and what can be opened belongs to the space
    // around them.
    if (menuRow === undefined && menuGroup === undefined) {
      for (const provider of providers) {
        let menuItems: WorkspaceMenuItem[];
        try {
          menuItems = await call<WorkspaceMenuItem[]>('request', provider, 'workspace-menu');
        } catch (error) {
          if (!closing()) console.error(error);
          continue;
        }
        for (const item of menuItems) {
          const hint = document.createElement('span');
          hint.textContent = item.hint ?? '';
          const button = entry(`新建 ${item.label}`, async () => {
            button.disabled = true;
            hint.textContent = '连接中…';
            try {
              const created = await call<{ id: string }>('request', provider, 'workspace-create', { key: item.key });
              hideRowMenu();
              await refreshRows();
              selectWorkspace(created.id);
            } catch (error) {
              hint.textContent = error instanceof Error ? error.message : String(error);
              button.title = hint.textContent;
              button.disabled = false;
            }
          });
          button.append(hint);
          if (item.error) button.title = item.error;
          items.push(button);
        }
      }
      // A group gathers workspaces, so with no workspace at all there is nothing to make one for.
      if (servedRows().length > 0) items.push(entry('新建分组', () => { hideRowMenu(); createGroup(); }));
    } else if (menuGroup !== undefined) {
      items.push(
        entry('重命名分组', () => { hideRowMenu(); openRename({ kind: 'group', id: menuGroup }); }),
        entry('删除分组', () => { hideRowMenu(); removeGroup(menuGroup); }),
      );
    } else if (menuRow !== undefined) {
      const rowGroup = groupOf(menuRow);
      items.push(entry('重命名', () => { hideRowMenu(); openRename({ kind: 'workspace', id: menuRow }); }));
      if (rowGroup) items.push(entry('移出分组', () => { hideRowMenu(); fileRow(menuRow); }));
      for (const other of groups) {
        if (other.id !== rowGroup?.id) items.push(entry(`移入 ${other.name}`, () => { hideRowMenu(); fileRow(menuRow, other.id); }));
      }
      items.push(entry('关闭工作区', () => {
        const provider = providerOf(menuRow);
        hideRowMenu();
        if (provider) void call('request', provider, 'workspace-close', { id: menuRow }).then(refreshRows).catch(console.error);
      }));
    }
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'menu-empty';
      empty.textContent = '没有可用的工作区';
      items.push(empty);
    }
    rowMenu.replaceChildren(...items);
    clampMenu(rowMenu, at);
  };
  workspaceHeader.oncontextmenu = openRowMenu;
  workspaceList.oncontextmenu = openRowMenu;

  const escapeOverlays = (event: KeyboardEvent) => { if (event.key === 'Escape') { hideRename(); hideRowMenu(); } };
  document.addEventListener('keydown', escapeOverlays);
  disposers.push(() => document.removeEventListener('keydown', escapeOverlays));

  const selectWorkspace = (id: string) => {
    const provider = providerOf(id);
    if (!provider) return;
    active = id;
    tabs.rebind(id);
    showRows();
    tabs.settle(active);
    void call('request', provider, 'workspace-select', { id }).catch(console.error);
  };

  const refreshRows = async () => {
    // The window is going away: a plugin that already disposed itself is not a failed refresh.
    if (closing()) return;
    // What the rows said before this pull: the only way to tell a status that moved from one that did not.
    const previous = new Map(servedRows().map((row) => [row.id, row.status ?? 'idle']));
    for (const provider of providers) {
      try {
        rowsByProvider.set(provider, await call<WorkspaceRow[]>('request', provider, 'workspaces'));
      } catch (error) {
        // A provider that cannot answer keeps the rows it had: a lost reply must not close its workspaces.
        if (!closing()) console.error(error);
      }
    }
    if (closing()) return;
    const rows = servedRows();
    tabs.closeGone(rows.map((row) => row.id));
    if (!rows.some((row) => row.id === active)) {
      const first = rows[0];
      if (first) {
        selectWorkspace(first.id);
        return;
      }
      active = undefined;
    }
    // Nothing but a reported status moved: its row is patched in place.
    const shape = shapeOf(rows);
    if (shape === drawnShape) {
      for (const row of rows) if ((row.status ?? 'idle') !== previous.get(row.id)) patchState(row);
      return;
    }
    // The list itself changed: it is drawn again, and the tab in front is re-selected only when the workspaces
    // that exist, or the order they stand in, moved — the rest of a row is not what a tab stands on.
    const members = membersOf(rows);
    const sameMembers = members === drawnMembers;
    showRows();
    if (!sameMembers) tabs.settle(active);
  };

  const saveGroupsAndDraw = () => {
    void call('save-groups', groups);
    showRows();
  };
  // A row joins the group it was filed into, if any, and leaves the one it was in. The write at the end also carries
  // any slot the caller changed just before.
  const fileRow = (id: string, groupId?: string) => {
    for (const group of groups) {
      const at = group.workspaces.indexOf(id);
      if (group.id === groupId) {
        if (at < 0) group.workspaces.push(id);
        // A row filed into a folded group would otherwise leave no trace of where it went.
        group.collapsed = false;
      } else if (at >= 0) group.workspaces.splice(at, 1);
    }
    saveGroupsAndDraw();
  };
  const removeGroup = (id: string) => {
    groups.splice(groups.findIndex((group) => group.id === id), 1);
    saveGroupsAndDraw();
  };
  const renameGroup = (id: string, name: string) => {
    groupById(id)!.name = name;
    saveGroupsAndDraw();
  };
  const createGroup = () => {
    let number = groups.length + 1;
    while (groups.some((group) => group.id === `g${number}`)) number += 1;
    const group: WorkspaceGroup = { id: `g${number}`, name: '新分组', collapsed: false, workspaces: [] };
    groups.push(group);
    saveGroupsAndDraw();
    openRename({ kind: 'group', id: group.id });
  };

  // A line a drag drops on: it marks itself while a drag hangs over it, and hands the drop to the action it carries.
  const dropLine = (className: string, accepts: () => boolean, drop: () => void) => {
    const element = document.createElement('div');
    element.className = className;
    element.setAttribute('role', 'presentation');
    element.ondragover = (event) => {
      if (!accepts()) return;
      event.preventDefault();
      element.dataset.drop = 'line';
    };
    onDragLeave(element);
    element.ondrop = (event) => {
      event.preventDefault();
      clearDrop(workspaceList);
      drop();
    };
    return element;
  };
  // A dropped row takes the place its line showed: it joins the group the place belongs to, if any, and its provider
  // is asked for that place as far as the provider's own order allows.
  const takePlace = (moved: string, before: string | undefined, group?: WorkspaceGroup) => {
    fileRow(moved, group?.id);
    // A row dropped on the line in front of itself already stands there, and a provider need not know that.
    if (before === moved) return;
    const provider = providerOf(moved)!;
    if (before !== undefined && providerOf(before) !== provider) return;
    void call('request', provider, 'workspace-move', before === undefined ? { id: moved } : { id: moved, before }).then(refreshRows).catch(console.error);
  };
  // The line under a group's bar, in front of each of its rows, and after the last.
  const groupLine = (group: WorkspaceGroup, before: string | undefined) =>
    dropLine('workspace-line inside', () => draggingRow !== undefined, () => takePlace(takenRow(), before, group));
  // The line between two entries of the list, and the one that closes it.
  const listLine = (options: { slot: number; below?: WorkspaceGroup; last?: boolean }) => {
    const { slot, below, last = false } = options;
    // A row stands at the end of the list only when no provider after its own still has a top-level row.
    const endsTheList = (id: string) => {
      const provider = providerOf(id)!;
      return providers.slice(providers.indexOf(provider) + 1).every((other) => rowsByProvider.get(other)!.every((row) => groupOf(row.id) !== undefined));
    };
    // Only a row that can reach the end is dropped on the line that closes the list; a group can always take it.
    const accepts = () => {
      if (draggingGroup !== undefined) return true;
      if (draggingRow === undefined) return false;
      return !last || endsTheList(draggingRow);
    };
    const element = dropLine('workspace-line', accepts, () => {
      if (draggingGroup !== undefined) {
        const group = groupById(takenGroup())!;
        // A group dropped on a line takes the place in front of the entry under it, unless that entry is the group
        // itself. A line with no entry under it — above a row or closing the list — ends after every group at its
        // place: the array only orders the groups drawn at one place.
        if (below !== group) {
          groups.splice(groups.indexOf(group), 1);
          groups.splice(below === undefined ? groups.length : groups.indexOf(below), 0, group);
        }
        group.after = slot;
        saveGroupsAndDraw();
        return;
      }
      const moved = takenRow();
      const top = topRows(servedRows());
      const others = top.filter((row) => row.id !== moved);
      // The line counts the rows above it, the dragged one included when it is drawn up there: counting again without
      // it is both the place the row takes and what keeps a row dropped on the line under itself where it is.
      const index = top.slice(0, slot).filter((row) => row.id !== moved).length;
      // A group at a slot is drawn in front of the row that takes the slot, so each group is told where to stand by the
      // place it is drawn at: one drawn at the line and recorded after the place the row takes comes up to that place,
      // so it stays in front of the row, and one drawn at that very place steps down, to open it.
      const underLineFrom = below === undefined ? groups.length : groups.indexOf(below);
      for (const [recorded, group] of groups.entries()) {
        const at = drawSlot(group, top);
        // A group is drawn no further than the rows there are, so a record that lands on the line and one that reaches
        // past the end look alike here: only the record tells them apart.
        if (recorded < underLineFrom && at === slot && rowsAbove(group) > index) group.after = index;
        else if (recorded >= underLineFrom && at === index) group.after = index + 1;
      }
      takePlace(moved, others[index]?.id);
    });
    return element;
  };

  const acknowledged = new Set<string>();
  const agentStateLabels: Record<WorkspaceStatus, string> = { idle: '空闲', working: '工作中', finished: '已完成' };
  const paint = (element: HTMLElement, row: WorkspaceRow) => {
    const status = row.status ?? 'idle';
    // A remembered finish would hide the next one, so any other state drops it.
    if (status !== 'finished') acknowledged.delete(row.id);
    const drawn = acknowledged.has(row.id) ? 'idle' : status;
    element.dataset.state = drawn;
    element.setAttribute('aria-label', `${row.label} · ${row.machine} · ${agentStateLabels[drawn]}`);
  };
  const patchState = (row: WorkspaceRow) => {
    const element = workspaceList.querySelector<HTMLElement>(`[data-workspace="${CSS.escape(row.id)}"]`);
    if (element) paint(element, row);
  };

  const workspaceRow = (row: WorkspaceRow) => {
    const element = document.createElement('div');
    element.className = `workspace${row.id === active ? ' selected' : ''}`;
    element.setAttribute('role', 'tab');
    element.setAttribute('aria-selected', String(row.id === active));
    element.dataset.workspace = row.id;
    element.tabIndex = 0;
    element.draggable = true;
    const glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.textContent = [...row.label.trim()][0]?.toUpperCase() ?? '?';
    const text = document.createElement('span');
    text.className = 'text';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.label;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = row.machine;
    text.append(name, meta);
    element.append(glyph, text);
    paint(element, row);
    onActivate(element, () => {
      // Looking at a workspace is what clears the completion it reported, and only that one.
      if (row.status === 'finished') acknowledged.add(row.id);
      selectWorkspace(row.id);
    });
    dragSource(element, () => { draggingRow = row.id; }, () => { draggingRow = undefined; }, workspaceList);
    return element;
  };

  const groupBlock = (group: WorkspaceGroup, members: WorkspaceRow[], followedBy: string | undefined) => {
    const block = document.createElement('div');
    block.className = 'workspace-group';
    block.setAttribute('role', 'presentation');
    block.dataset.group = group.id;
    const bar = document.createElement('div');
    bar.className = 'workspace-group-bar';
    bar.setAttribute('role', 'button');
    bar.setAttribute('aria-label', `分组 ${group.name}`);
    bar.setAttribute('aria-expanded', String(!group.collapsed));
    bar.tabIndex = 0;
    bar.draggable = true;
    bar.innerHTML = '<svg class="chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z"/></svg>';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = group.name;
    bar.append(name);
    const list = document.createElement('div');
    list.className = 'workspace-group-rows';
    list.hidden = group.collapsed;
    list.append(...members.flatMap((row) => [groupLine(group, row.id), workspaceRow(row)]), groupLine(group, followedBy));
    block.append(bar, list);
    // Folding is the bar's own business: it is written down here and the list it folds is redrawn in place, where the
    // focus is.
    const fold = () => {
      group.collapsed = !group.collapsed;
      void call('save-groups', groups);
      list.hidden = group.collapsed;
      bar.setAttribute('aria-expanded', String(!group.collapsed));
    };
    onActivate(bar, fold);
    dragSource(bar, () => { draggingGroup = group.id; }, () => { draggingGroup = undefined; }, workspaceList);
    return block;
  };

  const showRows = () => {
    // A group draws the rows it holds in the order the provider served them, not the order they joined in.
    const rows = servedRows();
    const top = topRows(rows);
    const children: HTMLElement[] = [];
    // The line in front of every entry and the one that closes the list.
    for (let slot = 0; slot <= top.length; slot += 1) {
      for (const group of groups) {
        if (drawSlot(group, top) !== slot) continue;
        const members = rows.filter((row) => groupOf(row.id)?.id === group.id);
        const lastMember = members[members.length - 1];
        // The row that follows the group's last member: a row filed at the end of the group stands in front of it.
        const followedBy = lastMember === undefined ? undefined : rows[rows.indexOf(lastMember) + 1]?.id;
        children.push(listLine({ slot, below: group }), groupBlock(group, members, followedBy));
      }
      if (slot < top.length) {
        children.push(listLine({ slot }), workspaceRow(top[slot]));
      }
    }
    children.push(listLine({ slot: top.length, last: true }));
    workspaceList.replaceChildren(...children);
    drawnShape = shapeOf(rows);
    drawnMembers = membersOf(rows);
  };

  disposers.push(window.wangcai.subscribe('workspaces', () => void refreshRows()));
  // What an agent reports arrives on a topic of its own: the row drawn for that workspace is patched where it
  // stands, with no list asked for again and no tab told it is in front.
  disposers.push(window.wangcai.subscribe('workspace-status', (value) => {
    const { id, status } = value as { id: string; status: WorkspaceStatus };
    const provider = providerOf(id);
    const rows = provider === undefined ? undefined : rowsByProvider.get(provider);
    const at = rows?.findIndex((row) => row.id === id) ?? -1;
    if (!rows || at < 0 || (rows[at].status ?? 'idle') === status) return;
    rows[at] = { ...rows[at], status };
    patchState(rows[at]);
  }));
  void refreshRows();
  return { element };
}

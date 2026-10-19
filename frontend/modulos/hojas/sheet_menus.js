import { floatingMenuPosition } from '../docs/drive_helpers.js';

export function tableBlockRemovalChanges(snapshot, metadata, tableId) {
  const tables=JSON.parse(snapshot.resources?.find(item=>item.name==='SHEET_TABLE_PLUGIN')?.data || '{}');
  for (const [sheetId,data] of Object.entries(tables)) {
    const table=data.tables?.find(item=>item.id===tableId);
    if (!table) continue;
    const blocks=metadata.sheets[sheetId]?.__bold?.blocks || [];
    return blocks.filter(block=>table.meta?.boldBlock===block.id || table.range.startRow<=block.startRow+block.rowIds.length && table.range.endRow>=block.startRow && table.range.startColumn<=block.columns.length && table.range.endColumn>=1).map(block=>({kind:'block.remove',sheet:sheetId,block:block.id}));
  }
  return [];
}

export function routeSheetDialog(event, api, open) {
  const button = event.target.closest?.('[data-action="insert-chart"], [data-action="insert-pivot"], [data-testid="cs-menuitem-insert-chart"], [data-testid="cs-menuitem-insert-pivot"], [data-testid="charts-panel-empty-cta"], [data-testid="charts-panel-add"]');
  if (!button || button.disabled || !api) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.type !== 'click') return;
  const testId = button.getAttribute('data-testid') || '';
  const kind = button.getAttribute('data-action') || (testId.startsWith('charts-panel-') ? 'insert-chart' : testId.replace('cs-menuitem-', ''));
  open({kind, api});
}

export function bindSheetMenus(root) {
  const ownerDocument = root.ownerDocument, view = ownerDocument.defaultView;
  let active;
  const close = () => {
    if (!active) return;
    const details = active;
    active = null;
    details.open = false;
    const menu = details.querySelector('.sheets_context_menu');
    if (menu?.matches(':popover-open')) menu.hidePopover();
  };
  const toggle = event => {
    const details = event.target;
    if (details.matches('.sheets_context_menu[popover]')) {
      if (!details.matches(':popover-open') && details.parentElement === active) close();
      return;
    }
    if (details.tagName !== 'DETAILS') return;
    const menu = details.querySelector('.sheets_context_menu');
    if (!menu) return;
    if (!details.open) {
      if (details === active) close();
      return;
    }
    if (active && active !== details) close();
    active = details;
    menu.setAttribute('popover', 'manual');
    menu.showPopover();
    const viewport = view.visualViewport, bounds = root.getBoundingClientRect();
    const left = Math.max(bounds.left, viewport?.offsetLeft || 0);
    const right = Math.min(bounds.right, (viewport?.offsetLeft || 0) + (viewport?.width || view.innerWidth));
    const width = Math.max(0, right - left), height = viewport?.height || view.innerHeight;
    menu.style.maxWidth = `${Math.max(0, width - 16)}px`;
    menu.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const position = floatingMenuPosition(details.querySelector('summary').getBoundingClientRect(), {
      width: menu.offsetWidth, height: menu.offsetHeight
    }, {left, top: viewport?.offsetTop || 0, width, height});
    menu.style.left = `${position.left}px`;
    menu.style.top = `${position.top}px`;
  };
  const outside = event => {
    if (active && !active.contains(event.target)) close();
  };
  const click = event => {
    if (active && (!active.contains(event.target) || event.target.closest('.sheets_context_menu button:not(:disabled), .sheets_context_menu a'))) close();
  };
  const scroll = event => {
    if (active && !active.querySelector('.sheets_context_menu').contains(event.target)) close();
  };
  const escape = event => {
    if (event.key !== 'Escape' || !active) return;
    const summary = active.querySelector('summary');
    close();
    event.preventDefault();
    event.stopPropagation();
    summary.focus({preventScroll: true});
  };
  root.addEventListener('toggle', toggle, true);
  ownerDocument.addEventListener('click', click);
  ownerDocument.addEventListener('pointerdown', outside, true);
  ownerDocument.addEventListener('keydown', escape, true);
  view.addEventListener('resize', close);
  view.addEventListener('scroll', scroll, true);
  view.visualViewport?.addEventListener('resize', close);
  view.visualViewport?.addEventListener('scroll', close);
  return () => {
    close();
    root.removeEventListener('toggle', toggle, true);
    ownerDocument.removeEventListener('click', click);
    ownerDocument.removeEventListener('pointerdown', outside, true);
    ownerDocument.removeEventListener('keydown', escape, true);
    view.removeEventListener('resize', close);
    view.removeEventListener('scroll', scroll, true);
    view.visualViewport?.removeEventListener('resize', close);
    view.visualViewport?.removeEventListener('scroll', close);
  };
}

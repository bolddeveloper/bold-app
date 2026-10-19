import {floatingMenuPosition} from '../../docs/drive_helpers.js';

export function mountSheetPopover(element, position = floatingMenuPosition) {
  if (!element) return;
  const anchor = element.parentElement.querySelector('button[aria-expanded="true"]') || element.parentElement;
  const bounds = anchor.getBoundingClientRect(), view = element.ownerDocument.defaultView;
  Object.assign(element.style, {position:'fixed', inset:'auto', margin:0, maxWidth:`${view.innerWidth - 16}px`, maxHeight:`${view.innerHeight - 16}px`, overflowY:'auto'});
  // Top layer escapes the toolbar's horizontal scroll container, retaining inherited theme colors.
  element.showPopover();
  const popup = element.getBoundingClientRect();
  const point = position(bounds, popup, {width:view.innerWidth, height:view.innerHeight});
  Object.assign(element.style, {left:`${point.left}px`, top:`${point.top}px`});
}

export function patchCasualSheetsChrome(source) {
  if (!source.includes('function BordersPicker({ api })')) return source;
  if (!source.includes('// BOLD: contiguous menu panels and clickable submenu parents.')) {
    const start=source.indexOf('var SUBMENU_PANEL_STYLE ='), end=source.indexOf('function MenuBar(',start);
    if (start<0 || end<0) throw Error('Cambió el submenú superior de Hojas.');
    source=source.slice(0,start)+source.slice(start,end).replace('marginLeft: 2,','marginLeft: -1,')+source.slice(end);
    const menuStart=source.indexOf('function MenuBar('), menuEnd=source.indexOf('\n// src/',menuStart);
    const menu=source.slice(menuStart,menuEnd).replace('onMouseDown: (e) => e.preventDefault(),\n                children:', 'onMouseDown: (e) => e.preventDefault(),\n                onClick: () => setOpenSubmenu(item.id),\n                children:');
    source='// BOLD: contiguous menu panels and clickable submenu parents.\n'+source.slice(0,menuStart)+menu+source.slice(menuEnd);
  }
  if (source.includes('var boldSheetPopover =')) return source;
  let next = source;
  for (const [style, id] of [['POPOVER_STYLE','cs-color-popover'], ['POPOVER_STYLE2','cs-borders-popover'], ['POPOVER_STYLE3','cs-autosum-popover']]) {
    const target = `style: ${style}, "data-testid": "${id}"`;
    if (!next.includes(target)) throw Error('Cambió el desplegable ' + id + '. Revisa el parche antes de actualizar Casual Sheets.');
    next = next.replace(target, `style: ${style}, popover: "manual", ref: boldSheetPopover, "data-testid": "${id}"`);
  }
  for (const [name, end] of [['ColorPicker','// src/chrome/BordersPicker.tsx'], ['BordersPicker','// src/chrome/AutoSumPicker.tsx'], ['AutoSumPicker','// src/chrome/Dialog.tsx'], ['Toolbar','// src/chrome/FormulaBar.tsx']]) {
    const start = next.indexOf(`function ${name}(`), finish = next.indexOf(end, start);
    if (start < 0 || finish < 0) throw Error('Cambió la barra de Casual Sheets: ' + name);
    const component = next.slice(start, finish).replace(/onMouseDown: \(e\) => \{\s*e\.preventDefault\(\);/g, 'onMouseDown: (e) => e.preventDefault(), onClick: (e) => { e.preventDefault();');
    next = next.slice(0,start) + component + next.slice(finish);
  }
  return `var boldSheetPopover = element => (${mountSheetPopover.toString()})(element, (${floatingMenuPosition.toString()}));\n` + next;
}

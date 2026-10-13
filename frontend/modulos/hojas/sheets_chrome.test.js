import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mountSheetPopover, patchCasualSheetsChrome} from '../core/tools/casual_sheets_chrome.mjs';
import {patchSheetTableUI} from '../core/tools/sheets_table_ui.mjs';
import {sheetLocales} from '../core/sheets_locales.js';

test('colores, bordes y autosuma escapan del scroll y quedan dentro de la ventana', () => {
  const anchor = {getBoundingClientRect: () => ({left:940, top:650, bottom:680})};
  let shown = false;
  const popup = {style:{}, parentElement:{querySelector: () => anchor},
    ownerDocument:{defaultView:{innerWidth:1000, innerHeight:700}},
    showPopover() {shown = true;}, getBoundingClientRect: () => ({width:220, height:250})};
  mountSheetPopover(popup);
  assert.equal(shown, true);
  assert.equal(popup.style.position, 'fixed');
  assert.equal(popup.style.left, '772px');
  assert.equal(popup.style.top, '394px');
  assert.equal(popup.style.margin, 0);
  assert.doesNotThrow(() => mountSheetPopover(null));
});

test('el parche cubre las tres paletas y permite activar botones con teclado', () => {
  const installed = readFileSync(new URL('../core/node_modules/@casualoffice/sheets/dist/chrome.js', import.meta.url), 'utf8');
  const patched = patchCasualSheetsChrome(installed);
  for (const id of ['cs-color-popover','cs-borders-popover','cs-autosum-popover']) {
    assert.match(patched, new RegExp('popover: "manual", ref: boldSheetPopover, "data-testid": "' + id + '"'));
  }
  assert.match(patched, /onMouseDown: \(e\) => e.preventDefault\(\), onClick:/);
  assert.equal(patchCasualSheetsChrome(patched), patched);
});

test('los menús de tablas tienen nombres claros y conservan filtros y reglas del idioma original',()=>{
  const labels=Object.values(sheetLocales)[0]['sheets-table-ui'];
  assert.equal(labels.rename,'Cambiar nombre');
  assert.equal(labels.updateRange,'Cambiar celdas');
  assert.equal(labels.setTheme,'Cambiar colores');
  assert.equal(labels.tableStyle,'Colores de tabla');
  assert.equal(labels.addStyle,'Crear diseño');
  assert.equal(labels.filter['select-all'],'Seleccionar todo');
  assert.equal(labels.number.compare.between,'Entre');
  assert.ok(labels.tableRangeWithOtherTableError);
});

test('los diseños conservan sus comandos, admiten teclado y respetan el tema del editor',()=>{
  const installed=readFileSync(new URL('../core/node_modules/@univerjs/sheets-table-ui/lib/es/index.js',import.meta.url),'utf8');
  const patched=patchSheetTableUI(installed);
  assert.match(patched,/className: "bold_table_theme"/);
  assert.equal(patched.split('"aria-pressed":item===themeConfig.theme').length-1,2);
  assert.match(patched,/event\.key==="Enter" \|\| event\.key===" "/);
  assert.match(patched,/jsx\("button", \{\s+type:"button", className:"bold_table_style_add"/);
  assert.match(patched,/onClick: handleAddCustomTheme/);
  assert.match(patched,/SetSheetTableCommand\.id/);
  assert.match(patched,/document\.querySelector\("\.sheets_univer \.univer-dark"\)/);
  assert.equal(patchSheetTableUI(patched),patched);
  assert.throws(()=>patchSheetTableUI('incompatible upstream'),/Cambió el panel/);
});

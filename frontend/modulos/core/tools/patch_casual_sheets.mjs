import { readFile, writeFile, readdir } from 'node:fs/promises';
import {patchCasualSheetsLifecycle, patchCasualSheetsMount} from './casual_sheets_lifecycle.mjs';
import {patchCasualSheetsChrome} from './casual_sheets_chrome.mjs';
import {patchSheetTableUI} from './sheets_table_ui.mjs';
import {patchSheetScrollbars} from './sheets_scrollbars.mjs';
import {patchSheetContextMenus} from './sheets_context_menus.mjs';
import {patchSheetCharts} from './sheets_chart_rendering.mjs';
import {patchSheetChartSaving} from './sheets_chart_saving.mjs';
import {patchSheetChartGeometry} from './sheets_chart_geometry.mjs';
import {patchSheetChartData} from './sheets_chart_data.mjs';
import {patchSheetChartAppearance} from './sheets_chart_appearance.mjs';
import {patchSheetChartLayout} from './sheets_chart_layout.mjs';
import {patchSheetChartViewport} from './sheets_chart_viewport.mjs';
import {patchSheetSelectorRendering} from './sheets_selector_rendering.mjs';
import {patchSheetDateRendering,patchSheetDateValidator,patchSheetDropdownState} from './sheets_date_selectors.mjs';

const root = new URL('../node_modules/@casualoffice/sheets/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.version !== '0.20.0') throw Error('Revisar el parche de Casual Sheets antes de actualizar su versión.');
const labels = {'File':'Archivo','Edit':'Editar','View':'Ver','Insert':'Insertar','Format':'Formato','Data':'Datos','Help':'Ayuda','Undo':'Deshacer','Redo':'Rehacer','Cut':'Cortar','Copy':'Copiar','Paste':'Pegar','Bold':'Negrita','Italic':'Cursiva','Underline':'Subrayado','Strikethrough':'Tachado','Font':'Fuente','Font size':'Tamaño de fuente','Text color':'Color de texto','Fill color':'Color de fondo','Borders':'Bordes','Merge cells':'Combinar celdas','Horizontal alignment':'Alineación horizontal','Vertical alignment':'Alineación vertical','Wrap text':'Ajustar texto','Number format':'Formato de número','Currency':'Moneda','Percent':'Porcentaje','Increase decimals':'Aumentar decimales','Decrease decimals':'Disminuir decimales','Chart':'Gráfico','Charts':'Gráficos','Pivot table':'Tabla dinámica','PivotTable':'Tabla dinámica','Insert chart':'Insertar gráfico','Insert Chart':'Insertar gráfico','Insert pivot table':'Insertar tabla dinámica','Image':'Imagen','Insert image':'Insertar imagen','Filter':'Filtro','Clear filter':'Quitar filtro','Sort A → Z':'Ordenar A–Z','Sort Z → A':'Ordenar Z–A','Find and replace':'Buscar y reemplazar','Find & Replace':'Buscar y reemplazar','Data validation':'Validación de datos','Conditional formatting':'Formato condicional','Freeze':'Inmovilizar','Unfreeze':'Movilizar','Gridlines':'Líneas de cuadrícula','Zoom':'Zoom','Delete':'Eliminar','Cancel':'Cancelar','Apply':'Aplicar','OK':'Aceptar','Close':'Cerrar','Format cells':'Formato de celdas','Format Cells':'Formato de celdas','New sheet':'Nueva hoja','Rename':'Renombrar','Delete sheet':'Eliminar hoja','Select all':'Seleccionar todo','Clear formatting':'Borrar formato','Align left':'Alinear a la izquierda','Align center':'Centrar','Align right':'Alinear a la derecha','Table':'Tabla','Comments':'Comentarios','Notes':'Notas','Insert rows':'Insertar filas','Insert columns':'Insertar columnas','Delete rows':'Eliminar filas','Delete columns':'Eliminar columnas'};
Object.assign(labels, {
  ' Insert chart':' Insertar gráfico', 'No charts on this sheet':'No hay gráficos en esta hoja',
  'Select the data range you want to plot, then use ':'Selecciona las celdas que quieres representar y usa ',
  'Click to rename':'Haz clic para cambiar el nombre', 'Source range':'Intervalo de datos',
  'Clustered Column':'Columnas agrupadas', 'Stacked Column':'Columnas apiladas', '100% Stacked Column':'Columnas al 100 %',
  'Clustered Bar':'Barras agrupadas', 'Stacked Bar':'Barras apiladas', '100% Stacked Bar':'Barras al 100 %',
  'Line':'Líneas', 'Stacked Line':'Líneas apiladas', 'Area':'Área', 'Stacked Area':'Área apilada',
  'Pie':'Circular', 'Doughnut':'Anillo', 'Scatter':'Dispersión'
});
// The SDK references an unpublished optional mention plugin. Keep real comments; omit only mention autocomplete.
for (const name of await readdir(new URL('dist/', root))) {
  if (!name.endsWith('.js')) continue;
  const path = new URL('dist/' + name, root), source = await readFile(path, 'utf8');
  let next = source.replace('sheetsTcUi, mentionUi]', 'sheetsTcUi]')
    .replace(/\s*import\("@univerjs\/docs-mention-ui"\),/, '')
    .replace(/,\s*\[mentionUi\.UniverDocsMentionUIPlugin\]/, '');
  if (next.includes('@univerjs/docs-mention-ui') || next.includes('mentionUi.UniverDocsMentionUIPlugin')) throw Error('Cambió el cargador de comentarios de Casual Sheets.');
  next = patchCasualSheetsLifecycle(next);
  next = patchCasualSheetsMount(next);
  next = patchCasualSheetsChrome(next);
  next = patchSheetCharts(next);
  next = patchSheetChartSaving(next);
  next = patchSheetChartGeometry(next);
  next = patchSheetChartData(next);
  next = patchSheetChartAppearance(next);
  next = patchSheetChartLayout(next);
  next = patchSheetChartViewport(next);
  next = next.replaceAll('"Insert \\u2192 Chart"', '"Insertar > Gráfico"')
    .replaceAll('" \\u2014 or:"', '" o bien:"')
    .replaceAll('`Delete ${displayName}`', '`Eliminar ${displayName}`')
    .replaceAll('`Close ${title} panel`', '`Cerrar panel de ${title}`');
  next = next.replace(/"([^"\\\r\n]*)"/g,(literal,value)=>labels[value] ? JSON.stringify(labels[value]) : literal);
  // Keyboard event keys are identifiers, not translated menu labels.
  next = next.replaceAll('e.key === "Eliminar"','e.key === "Delete"');
  if (next!==source) await writeFile(path, next);
}

// Restoring a table must retain its saved theme instead of applying the default palette.
const tablesPath = new URL('../node_modules/@univerjs/sheets-table/lib/es/index.js', import.meta.url);
const tablesSource = await readFile(tablesPath, 'utf8');
const savedTheme = 'tableId: table.id,\n\t\t\t\t\ttableStyleId: table.options?.tableStyleId';
if (!tablesSource.includes(savedTheme)) {
  const target = 'tableId: table.id\n\t\t\t\t});';
  if (!tablesSource.includes(target)) throw Error('Revisar la restauración de estilos de tablas antes de actualizar Univer.');
  await writeFile(tablesPath, tablesSource.replace(target, savedTheme + '\n\t\t\t\t});'));
}

const tableUIPath = new URL('../node_modules/@univerjs/sheets-table-ui/lib/es/index.js', import.meta.url);
const tableUISource = await readFile(tableUIPath,'utf8'), tableUI = patchSheetTableUI(tableUISource);
if (tableUI !== tableUISource) await writeFile(tableUIPath,tableUI);

const renderPath = new URL('../node_modules/@univerjs/engine-render/lib/es/index.js', import.meta.url);
const renderSource = await readFile(renderPath,'utf8'), render = patchSheetScrollbars(renderSource);
if (render !== renderSource) await writeFile(renderPath,render);

const menuPath = new URL('../node_modules/@univerjs/ui/lib/es/index.js', import.meta.url);
const menuSource = await readFile(menuPath,'utf8'), menus=patchSheetContextMenus(menuSource);
if (menus!==menuSource) await writeFile(menuPath,menus);

const selectorPath = new URL('../node_modules/@univerjs/sheets-data-validation-ui/lib/es/index.js', import.meta.url);
const selectorSource = await readFile(selectorPath,'utf8'), selectors=patchSheetDateRendering(patchSheetSelectorRendering(selectorSource));
if (selectors!==selectorSource) await writeFile(selectorPath,selectors);

const dateValidatorPath = new URL('../node_modules/@univerjs/sheets-data-validation/lib/es/index.js', import.meta.url);
const dateValidatorSource = await readFile(dateValidatorPath,'utf8'), dateValidator=patchSheetDateValidator(dateValidatorSource);
if (dateValidator!==dateValidatorSource) await writeFile(dateValidatorPath,dateValidator);
const dropdownStatePath = new URL('../node_modules/@univerjs/sheets-ui/lib/es/index.js', import.meta.url);
const dropdownStateSource = await readFile(dropdownStatePath,'utf8'), dropdownState=patchSheetDropdownState(dropdownStateSource);
if (dropdownState!==dropdownStateSource) await writeFile(dropdownStatePath,dropdownState);

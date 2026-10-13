import { readFile, writeFile, readdir } from 'node:fs/promises';
import {patchCasualSheetsLifecycle, patchCasualSheetsMount} from './casual_sheets_lifecycle.mjs';
import {patchCasualSheetsChrome} from './casual_sheets_chrome.mjs';
import {patchSheetTableUI} from './sheets_table_ui.mjs';

const root = new URL('../node_modules/@casualoffice/sheets/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.version !== '0.20.0') throw Error('Revisar el parche de Casual Sheets antes de actualizar su versión.');
const labels = {'File':'Archivo','Edit':'Editar','View':'Ver','Insert':'Insertar','Format':'Formato','Data':'Datos','Help':'Ayuda','Undo':'Deshacer','Redo':'Rehacer','Cut':'Cortar','Copy':'Copiar','Paste':'Pegar','Bold':'Negrita','Italic':'Cursiva','Underline':'Subrayado','Strikethrough':'Tachado','Font':'Fuente','Font size':'Tamaño de fuente','Text color':'Color de texto','Fill color':'Color de fondo','Borders':'Bordes','Merge cells':'Combinar celdas','Horizontal alignment':'Alineación horizontal','Vertical alignment':'Alineación vertical','Wrap text':'Ajustar texto','Number format':'Formato de número','Currency':'Moneda','Percent':'Porcentaje','Increase decimals':'Aumentar decimales','Decrease decimals':'Disminuir decimales','Chart':'Gráfico','Charts':'Gráficos','Pivot table':'Tabla dinámica','PivotTable':'Tabla dinámica','Insert chart':'Insertar gráfico','Insert Chart':'Insertar gráfico','Insert pivot table':'Insertar tabla dinámica','Image':'Imagen','Insert image':'Insertar imagen','Filter':'Filtro','Clear filter':'Quitar filtro','Sort A → Z':'Ordenar A–Z','Sort Z → A':'Ordenar Z–A','Find and replace':'Buscar y reemplazar','Find & Replace':'Buscar y reemplazar','Data validation':'Validación de datos','Conditional formatting':'Formato condicional','Freeze':'Inmovilizar','Unfreeze':'Movilizar','Gridlines':'Líneas de cuadrícula','Zoom':'Zoom','Delete':'Eliminar','Cancel':'Cancelar','Apply':'Aplicar','OK':'Aceptar','Close':'Cerrar','Format cells':'Formato de celdas','Format Cells':'Formato de celdas','New sheet':'Nueva hoja','Rename':'Renombrar','Delete sheet':'Eliminar hoja','Select all':'Seleccionar todo','Clear formatting':'Borrar formato','Align left':'Alinear a la izquierda','Align center':'Centrar','Align right':'Alinear a la derecha','Table':'Tabla','Comments':'Comentarios','Notes':'Notas','Insert rows':'Insertar filas','Insert columns':'Insertar columnas','Delete rows':'Eliminar filas','Delete columns':'Eliminar columnas'};
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
  next = next.replace(/"([^"\\\r\n]*)"/g,(literal,value)=>labels[value] ? JSON.stringify(labels[value]) : literal);
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

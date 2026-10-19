import {canonical, prepareTextStyles, sameTextStyle} from './sheet_styles.js';
export {canonical} from './sheet_styles.js';
import {prepareBlockTables, styleTaskTables, taskTableCellStyle, normalizeBlockTables} from '../../../services/sheets-engine/block_tables.mjs';

export const blockTypes = [{
  id: 'tasks',
  label: 'Tareas',
  detail: 'Responsables, estados y entregas'
}, {
  id: 'costs',
  label: 'Productos y licencias',
  detail: 'Precio × cantidad, subtotal'
}, {
  id: 'comparison',
  label: 'Anterior / actual',
  detail: 'Costos y diferencias'
}, {
  id: 'summary',
  label: 'Resumen',
  detail: 'Fórmulas sobre tus datos'
}, {
  id: 'text',
  label: 'Texto',
  detail: 'Descripción y contexto'
}];
export const columnTypes = {
  text: 'Texto',
  number: 'Número',
  currency: 'Moneda',
  date: 'Fecha',
  responsible: 'Responsable',
  collaborators: 'Colaboradores',
  dropdown: 'Desplegable',
  checkbox: 'Casilla',
  file: 'Archivo / descripción',
  formula: 'Fórmula'
};
export const taskColumns = [{
  id: 'title',
  name: 'Tarea',
  type: 'text'
}, {
  id: 'responsible',
  name: 'Responsable',
  type: 'responsible'
}, {
  id: 'collaborators',
  name: 'Colaboradores',
  type: 'collaborators'
}, {
  id: 'priority',
  name: 'Prioridad',
  type: 'dropdown',
  options: [{
    value: 'low',
    label: 'Baja',
    color: '#16b889'
  }, {
    value: 'medium',
    label: 'Media',
    color: '#e7aa27'
  }, {
    value: 'high',
    label: 'Alta',
    color: '#ef3340'
  }]
}, {
  id: 'due_date',
  name: 'Entrega',
  type: 'date'
}, {
  id: 'status',
  name: 'Estado',
  type: 'dropdown',
  options: [{
    value: 'todo',
    label: 'Pendiente',
    color: '#8a96a8'
  }, {
    value: 'in_progress',
    label: 'En proceso',
    color: '#e7aa27'
  }, {
    value: 'completed',
    label: 'Terminado',
    color: '#16b889'
  }]
}, {
  id: 'description',
  name: 'Archivo / descripción',
  type: 'file'
}, {
  id: 'note',
  name: 'Última nota',
  type: 'text'
}];
export const syncLabels = {
  unbound: 'Pendiente de carpeta',
  pending: 'Drive: cambios pendientes',
  syncing: 'Sincronizando Drive…',
  current: 'Actualizado en Drive',
  error: 'Error de sincronización',
  external: 'Incorporando cambios de Drive…',
  importing: 'Incorporando cambios de Drive…'
};
export const clone = value => structuredClone(value);
export function requiredBlockColumn(block, column) {
  return ['costs','comparison'].includes(block.type) && ['product','price','quantity','total',...(block.type==='comparison'?['previous','difference']:[])].includes(column.id) || (block.task.enabled || block.type==='tasks') && ['title','responsible','status'].includes(column.id);
}
export const cell = (sheet, row, col) => sheet.cellData?.[row]?.[col] || {};
export function richCellValue(item) {
  const value = item.v ?? '', link = item.p?.body?.customRanges?.find(range => range.rangeType === 0)?.properties?.url;
  if (!link || !/^https?:\/\//i.test(link) || String(value).startsWith('<!--bold-rich-text-->')) return value;
  const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<!--bold-rich-text--><p><a href="' + escape(link) + '">' + escape(value || link) + '</a></p>';
}
export function richSummary(value) {
  if (typeof value !== 'string' || !value.startsWith('<!--bold-rich-text-->')) return value;
  const images = (value.match(/<img\b/gi) || []).length;
  return value.replace(/^<!--bold-rich-text-->/, '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&') + (images ? ` [${images} imagen${images === 1 ? '' : 'es'}]` : '');
}
export function gridRowChanges(document, sheetId, kind, range) {
  const sheet = document.sheets[sheetId];
  if (!sheet || !range) return null;
  const removing = kind.includes('remove');
  const lastRow=block=>block.startRow+block.rowIds.length+(['costs','comparison'].includes(block.type)?1:0);
  const blocks = sheet.__bold.blocks.filter(block => removing ? range.startRow <= lastRow(block) && range.endRow >= block.startRow : range.startRow > block.startRow && range.startRow <= block.startRow + block.rowIds.length + 1);
  if (!blocks.length) return null;
  if (removing) return [...blocks].sort((a,b)=>b.startRow-a.startRow).map(block=>{
    if (range.startRow<=block.startRow && range.endRow>=block.startRow+block.rowIds.length) return {kind:'block.remove',sheet:sheetId,block:block.id};
    if (range.startRow<=block.startRow || range.endRow>block.startRow+block.rowIds.length) throw Error('Selecciona el bloque completo, incluido su encabezado, para eliminarlo.');
    const count=range.endRow-range.startRow+1;
    if (count>500) throw Error('Modifica hasta 500 filas por operación.');
    return {kind:'row.remove',sheet:sheetId,block:block.id,row:block.rowIds[range.startRow-block.startRow-1],count};
  });
  const block = blocks[0],
    count = range.endRow - range.startRow + 1;
  if (blocks.length !== 1 || range.startRow <= block.startRow) throw Error('Añade filas dentro de un único bloque.');
  if (count > 500) throw Error('Modifica hasta 500 filas por operación.');
  const index = range.startRow - block.startRow - 1;
  return [{
    kind: 'row.add',
    sheet: sheetId,
    block: block.id,
    count,
    index
  }];
}
export function blockCell(sheet, block, row, column) {
  return cell(sheet, block.startRow + block.rowIds.indexOf(row) + 1, block.columns.findIndex(col => col.id === column) + 1);
}
export function columnLetter(index) {
  let result = '';
  while (index) {
    const rest = (index - 1) % 26;
    index = Math.floor((index - 1) / 26);
    result = String.fromCharCode(65 + rest) + result;
  }
  return result;
}
function gridValidationRule(rule) {
  if (rule.type !== 'custom' || !rule.formula1?.trim()) return rule;
  const formula = rule.formula1.trim();
  // Excel date checks depend on CELL("format"), which Univer always returns as "G".
  if (/^=?OR\(NOT\(ISERROR\(DATEVALUE\((\$?[A-Z]+\$?\d+)\)\)\),\s*AND\(ISNUMBER\(\1\),\s*LEFT\(CELL\("format",\s*\1\)\)="D"\)\)$/i.test(formula)) {
    const {formula1, formula2, operator, ...dateRule} = rule;
    return {...dateRule, type:'date'};
  }
  return {...rule, formula1:'=' + formula.replace(/^=/, '')};
}
export function displayGrid(document, people) {
  const next = clone(document),
    names = new Map(people.map(person => [person.id, person.name]));
  for (const sheet of Object.values(next.sheets)) for (const block of sheet.__bold.blocks) for (const row of block.rowIds) for (const column of block.columns) {
    const item = blockCell(sheet, block, row, column.id);
    if (['description', 'note'].includes(column.id) || column.type === 'file') item.v = richSummary(item.v);
    if (['responsible', 'collaborators'].includes(column.type)) {
      if (item.v) item.v = String(item.v).split(',').map(id => names.get(id.trim()) || id).join(', ');
      // Rich text from older saves must not override the selected person's name.
      delete item.p;
      delete item.si;
    }
    if (column.type === 'date' && typeof item.v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.v)) {
      const milliseconds=Date.parse(item.v+'T00:00:00Z');
      if (Number.isFinite(milliseconds)) {
        item.v=(milliseconds-Date.UTC(1899,11,30))/86400000;
        item.t=2;
        const style=typeof item.s==='string' ? next.styles?.[item.s] || {} : item.s || {};
        item.s={...style,n:style.n || {pattern:'yyyy-mm-dd'}};
        delete item.p;
        delete item.si;
      }
    }
    if (column.type === 'dropdown' && item.v) item.v = column.options?.find(option => option.value === item.v)?.label || item.v;
  }
  const resource = next.resources?.find(item => item.name === 'SHEET_DATA_VALIDATION_PLUGIN') || {name:'SHEET_DATA_VALIDATION_PLUGIN', data:'{}'};
  const rules = savedValidationRules(JSON.parse(resource.data || '{}'), document);
  for (const sheet of Object.values(next.sheets)) for (const block of sheet.__bold.blocks) for (let index=0; index<block.columns.length; index++) {
    const column = block.columns[index], type = validationType(column.type);
    if (!type || !block.rowIds.length) continue;
    const options = column.type === 'dropdown' ? (column.options || []).map(option => option.label) : type === 'checkbox' ? [] : samePerson(people, block.task.enabled && block.type !== 'tasks' ? block.task.unit : '').map(person => person.name);
    // These rules belong to the block configuration, not to each editor's save/undo history.
    (rules[sheet.id] ||= []).push({uid:`bold-validation-${block.id}-${column.id}`, type, allowBlank:true,
      ...(type === 'checkbox' ? {} : type === 'date' ? {showDropDown:true,renderMode:2} : {renderMode:2, formula1:JSON.stringify([...new Set(options)]), showDropDown:true}),
      ranges:[{startRow:block.startRow+1, endRow:block.startRow+block.rowIds.length, startColumn:index+1, endColumn:index+1}]});
  }
  resource.data = JSON.stringify(Object.fromEntries(Object.entries(rules).map(([sheet,items])=>[sheet,items.map(gridValidationRule)])));
  if (!next.resources?.includes(resource)) (next.resources ||= []).push(resource);
  prepareBlockTables(next);
  styleTaskTables(next);
  return prepareTextStyles(next);
}
const validationType = type => ({responsible:'list', collaborators:'listMultiple', dropdown:'list', checkbox:'checkbox', date:'date'})[type];
function savedValidationRules(data, document) {
  for (const [id, rules] of Object.entries(data)) data[id] = rules.filter(rule => {
    if (rule.uid?.startsWith('bold-validation-')) return false;
    // Older editors persisted randomly identified rules for these same managed columns.
    return !rule.ranges?.length || !rule.ranges.every(range => document.sheets?.[id]?.__bold.blocks.some(block =>
      block.columns.some((column,index) => validationType(column.type) === rule.type && range.startColumn === index+1 && range.endColumn === index+1 && range.startRow > block.startRow && range.endRow <= block.startRow+block.rowIds.length)));
  });
  return data;
}
function savedRowData(rows = {}) {
  return Object.fromEntries(Object.entries(rows).map(([id, data]) => [id, Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'ah'))]).filter(([,data]) => Object.keys(data).length));
}
export function normalizeSnapshot(snapshot, metadata, people = []) {
  const next = clone(snapshot);
  const taskTables=JSON.parse(next.resources?.find(item=>item.name==='SHEET_TABLE_PLUGIN')?.data || '{}');
  const restoreStyle = (item, original, taskTable=false) => {
    if (!item) return;
    if (typeof item.s === 'string') item.s = clone(next.styles?.[item.s] || {});
    const style = typeof original === 'string' ? metadata.styles?.[original] : original;
    // Keep the saved representation in operation bases, avoiding false edit conflicts.
    if (style && (sameTextStyle(item.s, style) || taskTable && sameTextStyle(item.s, taskTableCellStyle(style)))) item.s = clone(original);
  };
  for (const resource of next.resources || []) {
    if (resource.name !== 'SHEET_DATA_VALIDATION_PLUGIN') continue;
    const data = savedValidationRules(JSON.parse(resource.data || '{}'), metadata);
    const original = JSON.parse(metadata.resources?.find(item=>item.name===resource.name)?.data || '{}');
    for (const [sheet, rules] of Object.entries(data)) data[sheet] = rules.map(rule => {
      const saved = original[sheet]?.find(item=>item.uid===rule.uid);
      // Keep Excel's original rule when only its runtime representation changed.
      if (saved && JSON.stringify(canonical({...gridValidationRule(saved),ranges:[]})) === JSON.stringify(canonical({...rule,ranges:[]}))) return {...saved,ranges:rule.ranges};
      return rule;
    });
    for (const rules of Object.values(data)) for (const rule of rules) {
      if (rule.type !== 'date') continue;
      for (const key of ['formula1','formula2']) {
        const value = rule[key];
        if (value == null || value === '' || String(value).startsWith('=') || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) continue;
        const numbers = String(value).match(/\d+/g);
        let date;
        if (!Number.isNaN(Number(value))) date = new Date(Date.UTC(1899,11,30) + Number(value) * 86400000);
        else if (numbers?.length === 3) {
          const order = new Intl.DateTimeFormat().formatToParts(new Date(2001,10,22)).filter(part => ['day','month','year'].includes(part.type));
          const fields = Object.fromEntries(order.map((part,index)=>[part.type,Number(numbers[index])]));
          date = new Date(Date.UTC(fields.year,fields.month-1,fields.day));
          if (date.getUTCFullYear() !== fields.year || date.getUTCMonth()+1 !== fields.month || date.getUTCDate() !== fields.day) date = null;
        }
        if (!date || Number.isNaN(date.getTime())) throw Error('Revisa la fecha de la validación antes de guardar.');
        rule[key] = date.toISOString().slice(0,10);
      }
    }
    resource.data = JSON.stringify(data);
  }
  for (const id of next.sheetOrder) {
    const sheet = next.sheets[id];
    sheet.rowData = savedRowData(sheet.rowData);
    for (const field of ['rowData','columnData']) for (const [index,item] of Object.entries(sheet[field] || {})) restoreStyle(item, metadata.sheets[id]?.[field]?.[index]?.s);
    sheet.__bold = clone(metadata.sheets[id]?.__bold || {
      blocks: []
    });
    for (const block of sheet.__bold.blocks) {
      const header = Object.entries(sheet.cellData || {}).find(([, cells]) => cells[0]?.v === 'block:' + block.id);
      if (!header) continue;
      block.startRow = Number(header[0]);
      const columns = new Map(block.columns.map(column => [column.id, column])),
        ids = block.columns.map((_, index) => header[1][index + 1]?.custom?.boldColumn);
      if (new Set(ids).size === columns.size && ids.every(key => columns.has(key))) block.columns = ids.map((key, index) => ({
        ...columns.get(key),
        name: header[1][index + 1].v
      }));
      const known = new Set(block.rowIds),
        rows = Object.entries(sheet.cellData || {}).filter(([, cells]) => known.has(cells[0]?.v)).sort(([a], [b]) => Number(a) - Number(b));
      if (rows.length === known.size) block.rowIds = rows.map(([, cells]) => cells[0].v);
    }
    for (const [row, cells] of Object.entries(sheet.cellData || {})) for (const [col, item] of Object.entries(cells)) {
      const taskTable=taskTables[id]?.tables.some(table=>table.options?.tableStyleId==='table-bold-tasks' && +row>=table.range.startRow && +row<=table.range.endRow && +col>=table.range.startColumn && +col<=table.range.endColumn);
      restoreStyle(item, metadata.sheets[id]?.cellData?.[row]?.[col]?.s, taskTable);
    }
    for (const block of sheet.__bold.blocks) for (const row of block.rowIds) for (const column of block.columns) {
      const item = blockCell(sheet, block, row, column.id);
      if (['description', 'note'].includes(column.id) || column.type === 'file') {
        const previousBlock = metadata.sheets[id]?.__bold.blocks.find(previous => previous.id === block.id);
        const previous = previousBlock && blockCell(metadata.sheets[id], previousBlock, row, column.id);
        if (previous && item.v === richSummary(previous.v)) {
          item.v = previous.v;
          const nativeLink = entry => entry?.p?.body?.customRanges?.find(range => range.rangeType === 0)?.properties?.url || '';
          const link = nativeLink(item);
          if (typeof previous.v === 'string' && previous.v.startsWith('<!--bold-rich-text-->') && link !== nativeLink(previous)) {
            if (link && !/^https?:\/\//i.test(link)) throw Error('Los archivos de la descripción requieren enlaces HTTP o HTTPS.');
            const count = (previous.v.match(/<a\b/gi) || []).length;
            if (count > 1) throw Error('Edita esta descripción desde su editor: contiene varios enlaces.');
            const escaped = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
            item.v = link ? count ? previous.v.replace(/(<a\b[^>]*\bhref=)(["'])(.*?)\2/i, (_, start) => start + '"' + escaped + '"') : previous.v + '<p><a href="' + escaped + '">' + escaped + '</a></p>' : previous.v.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/i, '$1');
          }
        }
        item.v = richCellValue(item);
      }
      if (column.type === 'checkbox' && [0, 1, 'TRUE', 'FALSE', '1', '0'].includes(item.v)) item.v = [1, 'TRUE', '1'].includes(item.v);
      if (column.type === 'date') {
        if (typeof item.v === 'number') {
          if (!Number.isFinite(item.v)) throw Error('Selecciona una fecha válida antes de guardar.');
          item.v = new Date(Date.UTC(1899, 11, 30) + item.v * 86400000).toISOString().slice(0, 10);
        }
        if (typeof item.v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.v)) item.t=1;
      }
      if (column.type === 'dropdown' && item.v) item.v = column.options?.find(option => option.label === item.v || option.value === item.v)?.value || item.v;
      if (['responsible', 'collaborators'].includes(column.type) && item.v && people.length) {
        const previousBlock=metadata.sheets[id]?.__bold.blocks.find(previous=>previous.id===block.id);
        const previousCell=previousBlock&&blockCell(metadata.sheets[id],previousBlock,row,column.id);
        const previous=previousCell?.v;
        const originalPeople=String(previous||'').split(',').filter(Boolean).map(identity=>people.find(person=>person.id===identity));
        if(originalPeople.length&&originalPeople.every(person=>person&&(block.type==='tasks'||!block.task.enabled||person.unit===block.task.unit))&&[originalPeople.map(person=>person.name).join(', '),originalPeople.map(person=>`${person.name} <${person.email}>`).join(', ')].includes(item.v)){
          item.v=previous;
          if (previousCell.p) item.p=clone(previousCell.p);
          if (previousCell.si != null) item.si=previousCell.si;
          continue;
        }
        const choices = samePerson(people, block.task.enabled && block.type !== 'tasks' ? block.task.unit : '').map(person => originalPeople.find(original => original?.employee === person.employee && (block.type === 'tasks' || !block.task.enabled || original.unit === block.task.unit)) || person);
        let selections = null;
        if (typeof item.v === 'string' && item.v.trim().startsWith('[')) {
          try { selections = JSON.parse(item.v); }
          catch { throw Error('Selecciona personas desde el directorio.'); }
          if (!Array.isArray(selections) || selections.some(label => typeof label !== 'string' || !label.trim()) || column.type === 'responsible' && selections.length > 1) throw Error('Selección de personas inválida.');
        }
        let selected = String(item.v).trim();
        for (const person of choices) selected = selected.replaceAll(`${person.name} <${person.email}>`, person.id);
        if (column.type === 'collaborators' && !selections) {
          // Match complete labels first, including names containing commas.
          const remaining = [];
          while (selected.trim()) {
            const match = choices.filter(person => selected === person.id || selected.startsWith(person.id+',') || selected === person.name || selected.startsWith(person.name+',')).sort((a,b) => b.name.length-a.name.length);
            if (!match.length) {remaining.push(selected); break;}
            const label = selected.startsWith(match[0].id) ? match[0].id : match[0].name;
            const candidates = match.filter(person => person.id === label || person.name === label);
            if (candidates.length > 1) throw Error('Hay personas con el mismo nombre. Selecciona su perfil desde la vista Bloques.');
            remaining.push(candidates[0].id);
            selected = selected.slice(label.length).replace(/^,\s*/, '');
          }
          selected = remaining.join(',');
        }
        const labels = selections || (column.type === 'responsible' ? [selected] : selected.split(','));
        item.v = labels.map(label => {
          const value = label.trim();
          const matches = choices.filter(person => person.id === value || person.name === value || `${person.name} <${person.email}>` === value);
          if (matches.length > 1) throw Error('Hay personas con el mismo nombre. Selecciona su perfil desde la vista Bloques.');
          if (selections && !matches.length) throw Error('Selecciona personas desde el directorio.');
          return matches[0]?.id || value;
        }).join(',');
      }
    }
  }
  next.styles = {...next.styles, ...clone(metadata.styles || {})};
  normalizeBlockTables(next,metadata);
  const chartName='__casual_sheets_charts__';
  const oldCharts=JSON.parse(metadata.resources?.find(item=>item.name===chartName)?.data || '{}');
  const chartResource=next.resources?.find(item=>item.name===chartName);
  const charts=JSON.parse(chartResource?.data || '{"v":1,"charts":[]}');
  const ids=new Set((charts.charts || []).map(item=>item.id));
  const deletedParts=[...new Set([...(oldCharts.deletedParts || []),...(charts.deletedParts || []),...(oldCharts.charts || []).filter(item=>!ids.has(item.id) && item.excelPart).map(item=>item.excelPart)])];
  if (deletedParts.length) {
    const resource={name:chartName,data:JSON.stringify({...charts,deletedParts})};
    if (chartResource) chartResource.data=resource.data;
    else (next.resources ||= []).push(resource);
  }
  return next;
}
function comparableResources(document) {
  const prepared={...document,resources:clone(document.resources || [])};
  prepareBlockTables(prepared);
  return (prepared.resources || []).map(resource => {
    let data;
    try { data = JSON.parse(resource.data || '{}'); }
    catch { return resource; }
    if (resource.name === 'SHEET_DATA_VALIDATION_PLUGIN') data = savedValidationRules(data, document);
    if (resource.name === 'SHEET_RANGE_THEME_MODEL_PLUGIN') data.rangeThemeStyleRuleMap = Object.fromEntries(Object.entries(data.rangeThemeStyleRuleMap || {}).filter(([,rule]) => !rule.themeName?.startsWith('table-')));
    const populated = value => value && typeof value === 'object' ? Object.values(value).some(populated) : value != null && value !== '';
    return populated(data) ? {...resource,data:canonical(data)} : null;
  }).filter(Boolean).sort((left,right) => left.name.localeCompare(right.name));
}
export function gridChanges(before, after, {layout = true} = {}) {
  const structure = document => JSON.stringify(canonical({
    order: document.sheetOrder,
    sheets: Object.fromEntries(document.sheetOrder.map(id => {
      const sheet = document.sheets[id];
      return [id, {
        name: sheet.name,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
        defaultRowHeight: sheet.defaultRowHeight,
        defaultColumnWidth: sheet.defaultColumnWidth,
        ...(layout ? {rowData:savedRowData(sheet.rowData), columnData:sheet.columnData || {}} : {}),
        mergeData: sheet.mergeData || [],
        freeze: sheet.freeze,
        headers: sheet.__bold.blocks.map(block => Object.entries(sheet.cellData?.[block.startRow] || {}).map(([col, cell]) => [col, cell.custom?.boldColumn, ...(layout ? [cell.v] : [])])),
        markers: sheet.__bold.technicalColumn === false ? [] : Object.entries(sheet.cellData || {}).filter(([, cells]) => cells[0]?.v).map(([row, cells]) => [row, cells[0].v])
      }];
    })),
    // Idle plugins add empty resources; their registration is not a workbook edit.
    resources: comparableResources(document)
  }));
  if (structure(before) !== structure(after)) return [{
    kind: 'grid',
    document: after,
    baseDocument: before
  }];
  const result = [];
  for (const id of before.sheetOrder) {
    const previous = before.sheets[id],
      next = after.sheets[id];
    for (const row of new Set([...Object.keys(previous.cellData || {}), ...Object.keys(next.cellData || {})])) for (const col of new Set([...Object.keys(previous.cellData?.[row] || {}), ...Object.keys(next.cellData?.[row] || {})])) {
      if (+col === 0 && previous.__bold.technicalColumn !== false) continue;
      const left = cell(previous, row, col),
        right = cell(next, row, col);
      const comparable = item => JSON.stringify(canonical(Object.fromEntries(Object.entries(item).filter(([key, value]) => !['t', 'si'].includes(key) && value != null && JSON.stringify(value) !== '{}' && (key !== 'v' || !item.f)))));
      if (comparable(left) === comparable(right)) continue;
      const block = previous.__bold.blocks.find(block => +row > block.startRow && +row <= block.startRow + block.rowIds.length && +col <= block.columns.length);
      result.push(block ? {
        kind: 'cell',
        sheet: id,
        block: block.id,
        row: block.rowIds[+row - block.startRow - 1],
        column: block.columns[+col - 1].id,
        before: left,
        after: right
      } : {
        kind: 'cell',
        sheet: id,
        row: +row,
        column: +col,
        before: left,
        after: right
      });
    }
  }
  return result;
}
export function optimistic(document, changes) {
  const next = clone(document);
  for (const change of changes) {
    if (change.kind === 'grid') return clone(change.document);
    if (change.kind !== 'cell') continue;
    const sheet = next.sheets[change.sheet];
    if (!sheet) continue;
    const block = change.block && sheet.__bold.blocks.find(block => block.id === change.block);
    const row = block ? block.startRow + block.rowIds.indexOf(change.row) + 1 : change.row;
    const col = block ? block.columns.findIndex(col => col.id === change.column) + 1 : change.column;
    sheet.cellData[row] ||= {};
    sheet.cellData[row][col] = clone(change.after);
  }
  return next;
}
export function groupedRows(sheet, block, {
  search = '',
  group = '',
  status = ''
} = {}, people = []) {
  const names = new Map(people.map(person => [person.id, person.name])),
    groups = new Map();
  for (const row of block.rowIds) {
    const values = Object.fromEntries(block.columns.map(col => [col.id, blockCell(sheet, block, row, col.id).v ?? '']));
    if (status && values.status !== status || search && !Object.values(values).some(value => String(names.get(value) || value).toLocaleLowerCase().includes(search.toLocaleLowerCase()))) continue;
    const key = group === 'department' ? people.find(person => person.id === values.responsible)?.department || 'Sin departamento' : group === 'responsible' ? names.get(values.responsible) || 'Sin responsable' : group === 'status' ? block.columns.find(col => col.id === 'status')?.options?.find(option => option.value === values.status)?.label || 'Sin estado' : 'Todas las filas';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups];
}
export function costTotal(sheet, block) {
  const total = block.rowIds.reduce((sum, row) => sum + costRowTotal(sheet, block, row), 0);
  return total * (1 - Number(block.discount || 0) / 100) * (1 + Number(block.tax || 0) / 100) * (block.conversion?.currency ? Number(block.conversion.rate) : 1);
}
export function costRowTotal(sheet, block, row, key = 'total') {
  const item = blockCell(sheet, block, row, key),
    index = block.startRow + block.rowIds.indexOf(row) + 2;
  const reference = id => columnLetter(block.columns.findIndex(column => column.id === id) + 2) + index;
  const defaultFormula = key === 'difference' ? `=${reference('total')}-${reference('previous')}` : `=${reference('price')}*${reference('quantity')}`;
  if (item.f && item.f !== defaultFormula || !item.f && item.v != null && item.v !== '') return Number(item.v || 0);
  const total = Number(blockCell(sheet, block, row, 'price').v || 0) * Number(blockCell(sheet, block, row, 'quantity').v || 0);
  return key === 'difference' ? costRowTotal(sheet, block, row) - Number(blockCell(sheet, block, row, 'previous').v || 0) : total;
}
export function samePerson(people, unit = '') {
  return [...new Map(people.filter(person => !unit || person.unit === unit).map(person => [person.employee, person])).values()];
}
export const gridAdapter = {
  clone,
  displayGrid,
  gridChanges,
  gridRowChanges,
  normalizeSnapshot,
  samePerson
};
export function newerFile(next, current) {
  if (!current || Number(next.revision) > Number(current.revision)) return true;
  if (Number(next.revision) < Number(current.revision) || Number(next.calculated_revision || 0) < Number(current.calculated_revision || 0)) return false;
  return !next.updated_at || !current.updated_at || Date.parse(next.updated_at) >= Date.parse(current.updated_at);
}
export function advancePending(pending, operation, next, current) {
  const ownRevision = Number(next.revision) === Number(operation.revision) + 1 && Number(current.revision) <= Number(next.revision);
  for (const item of pending) if (!item.sent && (item.changes.every(change => change.kind === 'cell') || ownRevision)) item.revision = Number(next.revision);
}

export function repairRejectedDraft(pending, changes) {
  if (!pending[0]?.rejected) return null;
  const all=[...pending.flatMap(operation=>operation.changes),...changes];
  if (all.some(change=>!['cell','grid'].includes(change.kind))) return null;
  const firstGrid=all.findIndex(change=>change.kind==='grid');
  const cells=new Map();
  for (const change of firstGrid<0?all:all.slice(0,firstGrid)) {
    const key=JSON.stringify([change.sheet,change.block,change.row,change.column]);
    cells.set(key,cells.has(key)?{...cells.get(key),after:clone(change.after)}:clone(change));
  }
  if (firstGrid<0) return {revision:pending[0].revision,changes:[...cells.values()]};
  if (!all[firstGrid].baseDocument) return null;
  const base=optimistic(all[firstGrid].baseDocument,[...cells.values()].map(change=>({...change,after:change.before})));
  const document=all.reduce((document,change)=>optimistic(document,[change]),base);
  return {revision:pending[0].revision,changes:[{kind:'grid',baseDocument:base,document}]};
}

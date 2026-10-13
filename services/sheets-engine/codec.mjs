import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { patchExcelPackage } from './excel_package.mjs';
import { addNativeObjects } from './native_excel.mjs';
import { importNativeCharts, importNativePivots } from './import_charts.mjs';
import { importImages, exportImages } from './excel_images.mjs';
import { excelAppearance, importTables, exportTables, prepareBlockTables } from './excel_tables.mjs';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsNodeCorePreset } from '@univerjs/preset-sheets-node-core';
import enUS from '@univerjs/preset-sheets-node-core/locales/en-US';
import { UniverSheetsConditionalFormattingPlugin } from '@univerjs/sheets-conditional-formatting';
const clone = value => structuredClone(value);
const plain = value => String(value ?? '').replace(/^<!--bold-rich-text-->/, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
const safeLink = value => /^https?:\/\//i.test(value) && !/[\s<>]/.test(value);
const richLink = value => typeof value === 'string' && value.startsWith('<!--bold-rich-text-->') ? value.match(/<a\b[^>]*\bhref=(["'])(.*?)\1/i)?.[2]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#(?:39|x27);/gi, "'") : undefined;
const color = value => value?.rgb?.replace('#', '') || '000000';
const resources = document => clone(document.resources || []);
const filterName = name => /^(?:_xlnm\.)?_FilterDatabase$/i.test(name || '');
function keepResources(result, document) {
  const saved = new Map(resources(document).map(resource => [resource.name, resource]));
  for (const resource of result.resources || []) saved.set(resource.name, resource);
  result.resources = [...saved.values()];
  for (const resource of result.resources) if (['SHEET_CONDITIONAL_FORMATTING_PLUGIN', 'SHEET_DATA_VALIDATION_PLUGIN', 'SHEET_FILTER_PLUGIN', 'SHEET_TABLE_PLUGIN'].includes(resource.name)) {
    const data = JSON.parse(resource.data || '{}');
    for (const sheetId of Object.keys(data)) if (!result.sheets[sheetId]) delete data[sheetId];
    resource.data = JSON.stringify(data);
  }
  for (const resource of result.resources) if (resource.name === 'SHEET_RANGE_THEME_MODEL_PLUGIN') {
    const data = JSON.parse(resource.data || '{}');
    for (const [id, rule] of Object.entries(data.rangeThemeStyleRuleMap || {})) if (!result.sheets[rule.rangeInfo.subUnitId]) delete data.rangeThemeStyleRuleMap[id];
    resource.data = JSON.stringify(data);
  }
  for (const resource of result.resources) if (['__casual_sheets_charts__','__casual_sheets_pivots__'].includes(resource.name)) {
    const data = JSON.parse(resource.data), key = resource.name==='__casual_sheets_charts__'?'charts':'pivots';
    data[key] = data[key].filter(item=>key==='charts'?result.sheets[item.sheetId]:result.sheets[item.sourceSheetId] && result.sheets[item.targetSheetId]);
    resource.data = JSON.stringify(data);
  }
  return result;
}
function resourceData(document, name) {
  const data = document.resources?.find(resource => resource.name === name)?.data;
  return data ? JSON.parse(data) : {};
}
const validationTypes = new Set(['list', 'whole', 'decimal', 'date', 'textLength', 'custom']);
function excelValidation(rule, listValidation) {
  if (['any', 'none'].includes(rule.type)) return null;
  if (rule.type === 'checkbox') return {
    type: 'list',
    allowBlank: true,
    formulae: ['"TRUE,FALSE"']
  };
  if (['list', 'listMultiple'].includes(rule.type)) {
    if (rule.formula1?.startsWith('=')) return {
      type: 'list',
      allowBlank: !!rule.allowBlank,
      formulae: [rule.formula1.slice(1)]
    };
    let options;
    try {
      options = JSON.parse(rule.formula1);
    } catch {
      options = String(rule.formula1 || '').split(',');
    }
    if (!Array.isArray(options) || !options.length) throw Error('Desplegable sin opciones.');
    return rule.type === 'listMultiple' ? {
      type: 'custom',
      allowBlank: true,
      formulae: ['TRUE']
    } : listValidation(options);
  }
  if (!validationTypes.has(rule.type)) throw Error('Esta validación de cuadrícula no se puede exportar a Excel.');
  return {
    type: rule.type,
    operator: rule.operator,
    allowBlank: !!rule.allowBlank,
    showErrorMessage: !!rule.showErrorMessage,
    error: rule.error,
    errorTitle: rule.errorTitle,
    formulae: [rule.formula1, rule.formula2].filter(value => value != null).map(value => {
      if (rule.type !== 'date') return String(value).replace(/^=/, '');
      if (String(value).startsWith('=')) throw Error('La validación de fechas con fórmula permanece en BOLD. Usa límites de fecha fijos para exportar.');
      const date = Number.isNaN(Number(value)) ? new Date(value) : new Date(Date.UTC(1899,11,30) + Number(value) * 86400000);
      if (Number.isNaN(date.getTime())) throw Error('Fecha de validación inválida. Usa AAAA-MM-DD.');
      return date;
    })
  };
}
function engineInput(document) {
  const input = clone(document), styles = Object.values(input.styles || {});
  const normalize = style => {
    if (!style || typeof style !== 'object') return;
    // Old saved workbooks must also support structural edits and recalculation.
    for (const key of ['ul','st','ol']) if (typeof style[key] === 'number' || typeof style[key] === 'boolean') style[key] = {s: +!!style[key]};
  };
  for (const sheet of Object.values(input.sheets)) {
    styles.push(sheet.defaultStyle);
    for (const item of [...Object.values(sheet.rowData || {}), ...Object.values(sheet.columnData || {})]) styles.push(item.s);
    for (const row of Object.values(sheet.cellData || {})) for (const item of Object.values(row)) if (item) {
      styles.push(item.s);
      for (const run of item.p?.body?.textRuns || []) styles.push(run.ts);
    }
    delete sheet.__bold;
  }
  for (const resource of input.resources || []) if (resource.name === 'SHEET_CONDITIONAL_FORMATTING_PLUGIN') {
    const data = JSON.parse(resource.data || '{}');
    for (const rules of Object.values(data)) for (const item of rules) normalize(item.rule?.style);
    resource.data = JSON.stringify(data);
  }
  for (const style of styles) normalize(style);
  return input;
}
export async function calculate(document) {
  const {
    univer,
    univerAPI
  } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(enUS)
    },
    presets: [UniverSheetsNodeCorePreset()],
    plugins: [UniverSheetsConditionalFormattingPlugin]
  });
  try {
    const input = engineInput(document);
    const book = univerAPI.createWorkbook(input);
    const hasFormula = Object.values(input.sheets).some(sheet => Object.values(sheet.cellData).some(row => Object.values(row).some(cell => cell.f)));
    if (hasFormula) {
      const formula = univerAPI.getFormula();
      formula.executeCalculation();
      await formula.onCalculationResultApplied(20000);
    }
    const result = book.save();
    for (const key of document.sheetOrder) result.sheets[key].__bold = clone(document.sheets[key].__bold);
    return keepResources(result, document);
  } finally {
    univer.dispose();
  }
}
export async function shiftRows(document, {
  sheet,
  row,
  count
}) {
  if (!Number.isInteger(row) || row < 0 || !Number.isInteger(count) || !count || Math.abs(count) > 1000) throw Error('Cambio de filas inválido.');
  const {
    univer,
    univerAPI
  } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(enUS)
    },
    presets: [UniverSheetsNodeCorePreset()],
    plugins: [UniverSheetsConditionalFormattingPlugin]
  });
  try {
    const input = engineInput(document);
    const book = univerAPI.createWorkbook(input),
      worksheet = book.getSheetBySheetId(sheet);
    if (!worksheet) throw Error('Hoja desconocida.');
    if (count > 0) worksheet.insertRowsBefore(row, count);else worksheet.deleteRows(row, -count);
    const result = book.save();
    for (const key of document.sheetOrder) result.sheets[key].__bold = clone(document.sheets[key].__bold);
    return keepResources(result, document);
  } finally {
    univer.dispose();
  }
}
export function reorderBlocks(document, {
  sheet: sheetId,
  order,
  block: rowBlock
}) {
  const source = document.sheets[sheetId],
    blocks = source.__bold.blocks;
  const selected = rowBlock && blocks.find(block => block.id === rowBlock),
    identities = selected ? selected.rowIds : blocks.map(block => block.id);
  if (rowBlock && !selected || !Array.isArray(order) || order.length !== identities.length || new Set(order).size !== order.length || order.some(id => !identities.includes(id))) throw Error('Orden inválido.');
  const {
    univer,
    univerAPI
  } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(enUS)
    },
    presets: [UniverSheetsNodeCorePreset()],
    plugins: [UniverSheetsConditionalFormattingPlugin]
  });
  try {
    const input = engineInput(document);
    const book = univerAPI.createWorkbook(input),
      sheet = book.getSheetBySheetId(sheetId);
    let target = selected ? selected.startRow + 1 : Math.min(...blocks.map(block => block.startRow));
    for (const id of order) {
      const block = selected || blocks.find(block => block.id === id),
        height = selected ? 1 : block.rowIds.length + (['costs', 'comparison'].includes(block.type) ? 2 : 1);
      const snapshot = book.save().sheets[sheetId],
        start = Number(Object.entries(snapshot.cellData).find(([, cells]) => cells[0]?.v === (selected ? id : 'block:' + id))[0]);
      if (start !== target) sheet.moveRows(sheet.getRange(start, 0, height, 1), target);
      target += height;
    }
    const result = book.save();
    for (const key of document.sheetOrder) result.sheets[key].__bold = clone(document.sheets[key].__bold);
    if (selected) result.sheets[sheetId].__bold.blocks.find(block => block.id === rowBlock).rowIds = order;else result.sheets[sheetId].__bold.blocks = order.map(id => {
      const block = clone(blocks.find(block => block.id === id));
      block.startRow = Number(Object.entries(result.sheets[sheetId].cellData).find(([, cells]) => cells[0]?.v === 'block:' + id)[0]);
      return block;
    });
    return keepResources(result, document);
  } finally {
    univer.dispose();
  }
}
export function configureColumns(document, {
  sheet: sheetId,
  block: blockId,
  columns
}) {
  const source = document.sheets[sheetId],
    block = source.__bold.blocks.find(block => block.id === blockId),
    old = block.columns.map(column => column.id);
  if (!Array.isArray(columns) || !columns.length || columns.length > 100 || new Set(columns).size !== columns.length || columns.some(id => typeof id !== 'string')) throw Error('Columnas inválidas.');
  if (JSON.stringify(columns.filter(id => old.includes(id))) !== JSON.stringify(old.filter(id => columns.includes(id)))) throw Error('Reordena columnas desde la cuadrícula.');
  const {
    univer,
    univerAPI
  } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(enUS)
    },
    presets: [UniverSheetsNodeCorePreset()],
    plugins: [UniverSheetsConditionalFormattingPlugin]
  });
  try {
    const input = engineInput(document);
    const book = univerAPI.createWorkbook(input),
      sheet = book.getSheetBySheetId(sheetId),
      height = block.rowIds.length + (['costs', 'comparison'].includes(block.type) ? 2 : 1),
      current = [...old];
    for (let index = current.length - 1; index >= 0; index--) if (!columns.includes(current[index])) {
      sheet.getRange(block.startRow, index + 1, height, 1).deleteCells(univerAPI.Enum.Dimension.COLUMNS);
      current.splice(index, 1);
    }
    for (let index = 0; index < columns.length; index++) if (!current.includes(columns[index])) {
      sheet.getRange(block.startRow, index + 1, height, 1).insertCells(univerAPI.Enum.Dimension.COLUMNS);
      current.splice(index, 0, columns[index]);
    }
    const result = book.save();
    for (const key of document.sheetOrder) result.sheets[key].__bold = clone(document.sheets[key].__bold);
    return keepResources(result, document);
  } finally {
    univer.dispose();
  }
}
export function changeSheet(document, {
  sheet: sheetId,
  action,
  name
}) {
  const {
    univer,
    univerAPI
  } = createUniver({
    locale: LocaleType.EN_US,
    locales: {
      [LocaleType.EN_US]: mergeLocales(enUS)
    },
    presets: [UniverSheetsNodeCorePreset()],
    plugins: [UniverSheetsConditionalFormattingPlugin]
  });
  try {
    const input = engineInput(document);
    const book = univerAPI.createWorkbook(input),
      sheet = book.getSheetBySheetId(sheetId);
    if (!sheet) throw Error('Hoja desconocida.');
    let copied;
    if (action === 'rename') sheet.setName(name);else if (action === 'remove') book.deleteSheet(sheet);else if (action === 'copy') {
      copied = book.duplicateSheet(sheet);
      copied.setName(name);
    } else throw Error('Operación de hoja inválida.');
    const result = book.save();
    for (const key of result.sheetOrder) result.sheets[key].__bold = clone(document.sheets[key]?.__bold || document.sheets[sheetId].__bold);
    keepResources(result, document);
    if (copied) for (const resource of result.resources) if (resource.name === 'SHEET_TABLE_PLUGIN') {
      const data = JSON.parse(resource.data || '{}'), original = data[sheetId];
      if (original) {
        const duplicate = clone(original);
        for (const table of duplicate.tables) {
          table.id = randomUUID();
          table.name = table.name.slice(0, 218) + '_' + table.id.replaceAll('-', '');
          for (const column of table.columns) column.id = randomUUID();
        }
        data[copied.getSheetId()] = duplicate;
        resource.data = JSON.stringify(data);
      }
    }
    if (copied) for (const resource of result.resources) if (['__casual_sheets_charts__','__casual_sheets_pivots__'].includes(resource.name)) {
      const data = JSON.parse(resource.data), key = resource.name==='__casual_sheets_charts__'?'charts':'pivots';
      for (const model of [...data[key]]) if (key==='charts'?model.sheetId===sheetId:model.targetSheetId===sheetId) {
        const duplicate = clone(model); duplicate.id = randomUUID(); delete duplicate.excelPart;
        if (key==='charts') duplicate.sheetId = copied.getSheetId();
        else {duplicate.targetSheetId=copied.getSheetId(); if (duplicate.sourceSheetId===sheetId) duplicate.sourceSheetId=copied.getSheetId();}
        data[key].push(duplicate);
      }
      resource.data=JSON.stringify(data);
    }
    return {
      ...result,
      copiedSheet: copied?.getSheetId()
    };
  } finally {
    univer.dispose();
  }
}
function styleOf(document, cell) {
  return typeof cell.s === 'string' ? document.styles?.[cell.s] || {} : cell.s || {};
}
function cellToExcel(target, cell, style, exportedValue) {
  target.value = cell.f ? {
    formula: cell.f.replace(/^=/, ''),
    result: cell.v ?? 0
  } : exportedValue ?? cell.v ?? null;
  const rich = typeof cell.v === 'string' && cell.v.startsWith('<!--bold-rich-text-->');
  if (!rich && cell.p?.body?.dataStream) target.value = cell.p.body.dataStream.trimEnd();
  const link = rich ? richLink(cell.v) : cell.p?.body?.customRanges?.find(range => range.rangeType === 0)?.properties?.url;
  if (link) {
    if (!safeLink(link)) throw Error('Solo se exportan enlaces HTTP o HTTPS.');
    target.value = {
      text: String(target.value ?? link),
      hyperlink: link
    };
  }
  if (!cell.f && typeof target.value === 'string' && safeLink(target.value)) target.value = {
    text: target.value,
    hyperlink: target.value
  };
  target.font = {
    name: style.ff || 'Arial',
    size: style.fs || 11,
    bold: !!style.bl,
    italic: !!style.it,
    strike: !!(typeof style.st === 'object' ? style.st?.s : style.st),
    underline: typeof style.ul === 'object' ? style.ul?.s ? style.ul.t === 10 ? 'double' : true : false : !!style.ul,
    color: {
      argb: 'FF' + color(style.cl)
    }
  };
  if (style.bg) target.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: {
      argb: 'FF' + color(style.bg)
    }
  };
  if (style.n?.pattern) target.numFmt = style.n.pattern;
  target.alignment = {
    horizontal: {
      1: 'left',
      2: 'center',
      3: 'right'
    }[style.ht] || 'left',
    vertical: 'middle',
    wrapText: style.tb === 3
  };
  if (style.bd) target.border = Object.fromEntries(Object.entries(style.bd).map(([key, value]) => [{
    t: 'top',
    b: 'bottom',
    l: 'left',
    r: 'right'
  }[key] || key, {
    style: 'thin',
    color: {
      argb: 'FF' + color(value.cl)
    }
  }]));
}
export async function exportExcel(document, {
  directory = [],
  links = [],
  revision = 0,
  recalculate = true,
  source,
  sourceOnly = false
} = {}) {
  const calculated = recalculate ? await calculate(document) : clone(document);
  prepareBlockTables(calculated);
  const book = new ExcelJS.Workbook();
  book.creator = 'BOLD';
  book.modified = new Date();
  book.calcProperties.fullCalcOnLoad = true;
  const people = new Map(directory.map(person => [person.id, person]));
  const hidden = book.addWorksheet('__BOLD', {
    state: 'veryHidden'
  });
  book.views = [{
    activeTab: 1
  }];
  const lists = new Map();
  let listColumn = 1;
  const listValidation = values => {
    const key = JSON.stringify(values);
    if (lists.has(key)) return lists.get(key);
    const column = ++listColumn,
      name = '_BOLD_LIST_' + column;
    values.forEach((value, index) => {
      hidden.getCell(index + 1, column).value = value;
    });
    book.definedNames.add(`'__BOLD'!$${hidden.getColumn(column).letter}$1:$${hidden.getColumn(column).letter}$${values.length}`, name);
    const validation = {
      type: 'list',
      allowBlank: true,
      formulae: [name],
      showErrorMessage: true,
      error: 'Selecciona una opción válida.'
    };
    lists.set(key, validation);
    return validation;
  };
  const metadata = {
    format: 1,
    id: document.id,
    revision,
    links,
    resources: resources(calculated),
    sheets: {},
    cells: {}
  };
  const gridValidation = resourceData(calculated, 'SHEET_DATA_VALIDATION_PLUGIN');
  const gridFilters = resourceData(calculated, 'SHEET_FILTER_PLUGIN');
  const conditional = resourceData(calculated, 'SHEET_CONDITIONAL_FORMATTING_PLUGIN');
  for (const name of Object.values(resourceData(calculated, 'SHEET_DEFINED_NAME_PLUGIN'))) {
    // Excel's filter bookkeeping is rebuilt from filter ranges, not a formula named range.
    if (filterName(name.name)) continue;
    const reference = String(name.formulaOrRefString || '').replace(/^=/, '');
    if (name.localSheetId && name.localSheetId !== 'AllDefaultWorkbook' || !/^('?[^!']+(?:''[^!']+)*'?)!\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?$/i.test(reference)) throw Error('La exportación admite rangos con nombre globales y referencias directas. Revisa este nombre: ' + name.name);
    book.definedNames.add(reference, name.name);
  }
  for (const id of calculated.sheetOrder) {
    const sheet = calculated.sheets[id],
      output = book.addWorksheet(sheet.name);
    output.properties.defaultRowHeight = (sheet.defaultRowHeight || 28) * .75;
    output.properties.defaultColWidth = (sheet.defaultColumnWidth || 140) / 7;
    exportImages(book,output,calculated,id);
    metadata.sheets[id] = {
      id,
      name: sheet.name,
      __bold: clone(sheet.__bold)
    };
    metadata.cells[id] = {};
    const typed = new Map();
    for (const block of sheet.__bold?.blocks || []) for (let r = 0; r < block.rowIds.length; r++) for (let c = 0; c < block.columns.length; c++) {
      const row = block.startRow + r + 1,
        col = c + 1;
      typed.set(`${row}:${col}`, {
        column: block.columns[c],
        block,
        rowId: block.rowIds[r]
      });
    }
    for (const [rowKey, cells] of Object.entries(sheet.cellData)) for (const [colKey, cell] of Object.entries(cells)) {
      const row = +rowKey,
        col = +colKey,
        target = output.getCell(row + 1, col + 1),
        descriptor = typed.get(`${row}:${col}`);
      let value = cell.v;
      if (descriptor) {
        const {
          column,
          block,
          rowId
        } = descriptor;
        if (['responsible', 'collaborators'].includes(column.type)) value = String(value || '').split(',').filter(Boolean).map(id => people.get(id)?.name || id).join(', ');
        if (column.type === 'dropdown') value = column.options?.find(option => option.value === value)?.label || value;
        if (column.type === 'date' && value && !Number.isNaN(Date.parse(value))) {
          value = new Date(value);
          target.numFmt = 'dd/mm/yyyy';
        }
        if (['file', 'text'].includes(column.type) && typeof value === 'string') value = plain(value);
        if (column.type === 'currency') target.numFmt = `"${block.currency} "#,##0.00`;
        if (column.type === 'dropdown' && column.options?.length) target.dataValidation = listValidation(column.options.map(option => option.label));
        metadata.cells[id][rowId + ':' + column.id] = {
          raw: cell.v,
          formula: cell.f,
          exported: value instanceof Date ? value.toISOString().slice(0, 10) : value
        };
      }
      const exportedCell = ['responsible','collaborators'].includes(descriptor?.column.type) ? {...cell,p:null} : cell;
      cellToExcel(target, exportedCell, styleOf(calculated, cell), value);
      if (descriptor) metadata.cells[id][descriptor.rowId + ':' + descriptor.column.id].hyperlink = target.hyperlink || '';
      if (descriptor?.column.id === 'note' && value) target.note = plain(value);
    }
    for (const [index, data] of Object.entries(sheet.columnData || {})) {
      const col = output.getColumn(+index + 1);
      col.width = Math.max(.125, (data.w || 140) / 7);
      col.hidden = !!data.hd;
      col.outlineLevel = data.outlineLevel || 0;
    }
    if (sheet.__bold?.technicalColumn !== false) output.getColumn(1).hidden = true;
    for (const [index, data] of Object.entries(sheet.rowData || {})) {
      const row = output.getRow(+index + 1);
      let height=(data.h || sheet.defaultRowHeight || 28) * .75;
      // shortcut: wrapped heights use character widths; measure fonts when exact Excel line wrapping is required.
      if (data.ia === 1) row.eachCell(cell=>{
        const column=output.getColumn(cell.col);
        if (column.hidden || !cell.alignment.wrapText) return;
        const lines=String(cell.text || '').split(/\r?\n/).reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length / Math.max(1,(column.width || 20)-2))),0);
        height=Math.max(height,Math.min(240,lines*((cell.font.size || 11)+3)+6));
      });
      row.height = height;
      row.hidden = !!data.hd;
      row.outlineLevel = data.outlineLevel || 0;
    }
    for (const merge of sheet.mergeData || []) output.mergeCells(merge.startRow + 1, merge.startColumn + 1, merge.endRow + 1, merge.endColumn + 1);
    output.views = [{
      state: 'frozen',
      xSplit: sheet.freeze?.xSplit || 0,
      ySplit: sheet.freeze?.ySplit || 0
    }];
    const first = sheet.__bold?.blocks?.[0], filterRange = gridFilters[id]?.ref;
    if (filterRange || first) output.autoFilter = {
      from: {
        row: filterRange ? filterRange.startRow + 1 : first.startRow + 1,
        column: filterRange ? filterRange.startColumn + 1 : 1
      },
      to: {
        row: filterRange ? filterRange.endRow + 1 : first.startRow + first.rowIds.length + 1,
        column: filterRange ? filterRange.endColumn + 1 : first.columns.length + 1
      }
    };
    let validationCells = 0;
    for (const rule of gridValidation[id] || []) {
      const validation = excelValidation(rule, listValidation);
      if (!validation) continue;
      for (const range of rule.ranges || []) for (let row = range.startRow; row <= range.endRow; row++) for (let col = range.startColumn; col <= range.endColumn; col++) {
        if (++validationCells > 100000) throw Error('Reduce el rango de validaciones a 100 000 celdas por hoja.');
        if (!typed.has(`${row}:${col}`)) output.getCell(row + 1, col + 1).dataValidation = validation;
      }
    }
    for (const [index, rule] of (conditional[id] || []).entries()) {
      for (const range of rule.ranges) {
        const ref = output.getCell(range.startRow + 1, range.startColumn + 1).address + ':' + output.getCell(range.endRow + 1, range.endColumn + 1).address;
        output.addConditionalFormatting({
          ref,
          rules: [conditionalToExcel(rule, index + 1, ref)]
        });
      }
    }
  }
  for (const id of calculated.sheetOrder) exportTables(book.getWorksheet(calculated.sheets[id].name), calculated, id);
  const raw = JSON.stringify(metadata);
  for (let offset = 0; offset < raw.length; offset += 30000) hidden.addRow([raw.slice(offset, offset + 30000)]);
  const exported = await writeExcel(book);
  const buffer = source ? await patchExcelPackage(Buffer.from(source, 'base64'), exported, calculated, sourceOnly) : exported;
  const native = sourceOnly ? buffer : await addNativeObjects(buffer,calculated);
  if (native.length > 20_000_000) throw Error('El Excel exportado supera 20 MB. Los cambios siguen guardados en BOLD.');
  return {
    buffer: native,
    document: calculated
  };
}
async function writeExcel(book) {
  const bars = new Map();
  for (const sheet of book.worksheets) {
    const rules = sheet.conditionalFormattings.flatMap(format => format.rules).filter(rule => rule.type === 'dataBar');
    if (!rules.length) continue;
    bars.set(sheet.id, new Map(rules.map(rule => [rule.priority, {gradient: rule.gradient, showValue: rule.showValue}])));
    // ExcelJS 4 writes negative colors only in the solid-bar extension and omits showValue.
    for (const rule of rules) rule.gradient = false;
  }
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  if (!bars.size) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  for (const [sheet, rules] of bars) {
    const path = `xl/worksheets/sheet${sheet}.xml`, gradients = new Map();
    let xml = await zip.file(path).async('string');
    xml = xml.replace(/<cfRule\b[^>]*>[\s\S]*?<\/cfRule>/g, block => {
      const rule = rules.get(Number(block.match(/\bpriority="(\d+)"/)?.[1]));
      if (!rule || !/\btype="dataBar"/.test(block)) return block;
      const id = block.match(/<x14:id>([^<]+)<\/x14:id>/)?.[1];
      if (id) gradients.set(id, rule.gradient !== false);
      return block.replace(/<dataBar\b[^>]*>/, tag => tag.replace(/\s+showValue="[^"]*"/, '').replace(/>$/, ` showValue="${rule.showValue === false ? 0 : 1}">`));
    });
    xml = xml.replace(/<x14:cfRule\b[^>]*>[\s\S]*?<\/x14:cfRule>/g, block => {
      const id = block.match(/\bid="([^"]+)"/)?.[1];
      if (!gradients.has(id)) return block;
      return block.replace(/<x14:dataBar\b[^>]*>/, tag => tag.replace(/\s+gradient="[^"]*"/, '').replace(/>$/, ` gradient="${gradients.get(id) ? 1 : 0}">`));
    });
    zip.file(path, xml);
  }
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
function excelCell(cell, advanced = false, appearance) {
  const result = {};
  const value = cell.value;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    result.f = '=' + cell.formula;
    result.v = value.result ?? null;
  } else if (value instanceof Date) result.v = (value.getTime() - Date.UTC(1899,11,30)) / 86400000;else if (value && typeof value === 'object') result.v = value.text ?? value.richText?.map(part => part.text).join('') ?? value.error ?? null;else result.v = value;
  const font = cell.font || {},
    alignment = cell.alignment || {};
  result.s = {
    ff: font.name || 'Arial',
    fs: font.size || 11,
    bl: +!!font.bold,
    it: +!!font.italic,
    st: {s: +!!font.strike},
    ul: {s: +!!font.underline, ...(font.underline === 'double' || font.underline === 'doubleAccounting' ? {t:10} : {})},
    ht: {
      left: 1,
      center: 2,
      right: 3
    }[alignment.horizontal] || 1,
    tb: alignment.wrapText ? 3 : 1
  };
  const resolveColor = value => appearance?.color(value) || (value?.argb ? '#' + value.argb.slice(-6) : undefined);
  if (resolveColor(font.color)) result.s.cl = {
    rgb: resolveColor(font.color)
  };
  if (cell.fill?.pattern !== 'none' && resolveColor(cell.fill?.fgColor)) result.s.bg = {
    rgb: resolveColor(cell.fill.fgColor)
  };
  if (cell.numFmt) result.s.n = {
    pattern: cell.numFmt
  };
  if (cell.border) result.s.bd = Object.fromEntries(Object.entries(cell.border).filter(([key, value]) => ['top', 'bottom', 'left', 'right'].includes(key) && value?.style).map(([key, value]) => [{
    top: 't',
    bottom: 'b',
    left: 'l',
    right: 'r'
  }[key], {
    s: appearance?.borderStyles[value.style] || 1,
    cl: {
      rgb: resolveColor(value.color) || '#000000'
    }
  }]));
  if (cell.hyperlink && !safeLink(cell.hyperlink) && !advanced) throw Error('El archivo contiene un enlace no permitido.');
  if (cell.hyperlink && safeLink(cell.hyperlink)) {
    const text = String(result.v || cell.hyperlink);
    result.p = {
      id: 'link-' + cell.address,
      body: {
        dataStream: text + '\r\n',
        paragraphs: [{
          startIndex: text.length
        }],
        sectionBreaks: [{
          startIndex: text.length + 1
        }],
        customRanges: [{
          startIndex: 0,
          endIndex: text.length - 1,
          rangeType: 0,
          rangeId: 'link-' + cell.address,
          properties: {
            url: cell.hyperlink
          }
        }]
      }
    };
  }
  if (result.f && /\[[^]]+\]|\b(WEBSERVICE|IMPORTXML|IMPORTDATA|IMPORTRANGE|HYPERLINK)\s*\(|\|/i.test(result.f)) {
    if (!advanced) throw Error('El archivo contiene una fórmula con conexión externa.');
    result.custom = {officeFormula: result.f}; delete result.f;
  }
  if (advanced && cell.hasStyle) result.custom = {...result.custom, excelStyle:JSON.stringify(result.s)};
  return result;
}
function conditionalToExcel(item, priority, ref) {
  if (item.stopIfTrue || item.ranges.length !== 1) throw Error('Antes de exportar, separa los rangos del formato condicional y desactiva «Detener si es verdadero». La regla permanece guardada en BOLD.');
  const rule = item.rule,
    result = {
      priority
    };
  if (rule.type === 'colorScale') return {
    ...result,
    type: 'colorScale',
    cfvo: rule.config.map(part => part.value),
    color: rule.config.map(part => ({
      argb: 'FF' + part.color.replace('#', '')
    }))
  };
  if (rule.type === 'dataBar') return {
    ...result,
    type: 'dataBar',
    cfvo: [rule.config.min, rule.config.max],
    color: {
      argb: 'FF' + rule.config.positiveColor.replace('#', '')
    },
    gradient: rule.config.isGradient,
    showValue: rule.isShowValue,
    negativeBarColorSameAsPositive: false,
    negativeFillColor: {
      argb: 'FF' + rule.config.nativeColor.replace('#', '')
    }
  };
  if (rule.type !== 'highlightCell') throw Error('Los conjuntos de iconos se conservan en BOLD, pero aún no se exportan a Excel. Resuelve esta regla antes de sincronizar.');
  const style = rule.style || {},
    target = {};
  cellToExcel(target, {}, style, null);
  result.style = {};
  if (style.bg) result.style.fill = target.fill;
  if (style.cl || style.bl != null || style.it != null || style.ul != null || style.st != null || style.ff || style.fs) result.style.font = Object.fromEntries(Object.entries(target.font).filter(([key]) => ({
    name: style.ff,
    size: style.fs,
    bold: style.bl,
    italic: style.it,
    strike: style.st,
    underline: style.ul,
    color: style.cl
  })[key] != null));
  if (style.n) result.style.numFmt = target.numFmt;
  const anchor = ref.split(':')[0],
    absolute = ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2'),
    quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  const expression = value => ({
    ...result,
    type: 'expression',
    formulae: [value.replace(/^=/, '')]
  });
  if (rule.subType === 'formula') return expression(rule.value);
  if (rule.subType === 'number') return {
    ...result,
    type: 'cellIs',
    operator: rule.operator,
    formulae: Array.isArray(rule.value) ? rule.value : [rule.value]
  };
  if (['duplicateValues', 'uniqueValues'].includes(rule.subType)) return expression(`COUNTIF(${absolute},${anchor})${rule.subType === 'uniqueValues' ? '=1' : '>1'}`);
  if (rule.subType === 'rank') return {
    ...result,
    type: 'top10',
    rank: rule.value,
    percent: rule.isPercent,
    bottom: rule.isBottom
  };
  if (rule.subType === 'timePeriod') return {
    ...result,
    type: 'timePeriod',
    timePeriod: rule.operator
  };
  const operator = {
    greaterThan: '>',
    greaterThanOrEqual: '>=',
    lessThan: '<',
    lessThanOrEqual: '<=',
    equal: '=',
    notEqual: '<>'
  };
  if (rule.subType === 'average') return expression(`${anchor}${operator[rule.operator]}AVERAGE(${absolute})`);
  if (rule.subType === 'text') {
    const value = quote(rule.value),
      expressions = {
        equal: `${anchor}=${value}`,
        notEqual: `${anchor}<>${value}`,
        beginsWith: `LEFT(${anchor},LEN(${value}))=${value}`,
        endsWith: `RIGHT(${anchor},LEN(${value}))=${value}`,
        containsText: `ISNUMBER(SEARCH(${value},${anchor}))`,
        notContainsText: `ISERROR(SEARCH(${value},${anchor}))`,
        containsBlanks: `LEN(TRIM(${anchor}))=0`,
        notContainsBlanks: `LEN(TRIM(${anchor}))>0`,
        containsErrors: `ISERROR(${anchor})`,
        notContainsErrors: `NOT(ISERROR(${anchor}))`
      };
    if (expressions[rule.operator]) return expression(expressions[rule.operator]);
  }
  throw Error('Formato condicional incompatible con la exportación. Conservamos la regla en BOLD.');
}
function conditionalFromExcel(source, previous = []) {
  const result = [];
  for (const format of source.conditionalFormattings || []) {
    const ranges = format.ref.split(/\s+/).map(ref => {
      const match = ref.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
      if (!match) throw Error('Rango de formato condicional incompatible.');
      const column = value => [...value].reduce((n, l) => n * 26 + l.charCodeAt(0) - 64, 0) - 1;
      const range = {
        startRow: Number(match[2]) - 1,
        endRow: Number(match[4] || match[2]) - 1,
        startColumn: column(match[1]),
        endColumn: column(match[3] || match[1])
      };
      if (range.endRow >= 20000 || range.endColumn >= 500) throw Error('Formato condicional fuera del tamaño permitido.');
      return range;
    });
    for (const input of [...format.rules].sort((a, b) => a.priority - b.priority)) {
      const style = {},
        font = input.style?.font;
      if (input.style?.fill?.fgColor?.argb) style.bg = {
        rgb: '#' + input.style.fill.fgColor.argb.slice(-6)
      };
      if (font?.color?.argb) style.cl = {
        rgb: '#' + font.color.argb.slice(-6)
      };
      for (const [key, target] of Object.entries({
        bold: 'bl',
        italic: 'it',
        underline: 'ul',
        strike: 'st',
        name: 'ff',
        size: 'fs'
      })) if (font?.[key] != null) style[target] = ['ff', 'fs'].includes(target) ? font[key] : ['ul','st'].includes(target) ? {s: +!!font[key]} : +!!font[key];
      if (input.style?.numFmt) style.n = {
        pattern: input.style.numFmt
      };
      let rule = {
        type: 'highlightCell',
        style
      };
      if (input.type === 'expression') rule = {
        ...rule,
        subType: 'formula',
        value: '=' + input.formulae[0].replace(/^=/, '')
      };else if (input.type === 'cellIs') {
        const values = input.formulae.map(value => Number(value));
        if (values.some(value => !Number.isFinite(value))) throw Error('Revisa la regla numérica con fórmulas antes de importar.');
        rule = {
          ...rule,
          subType: 'number',
          operator: input.operator,
          value: values.length === 1 ? values[0] : values
        };
      } else if (input.type === 'top10') rule = {
        ...rule,
        subType: 'rank',
        value: input.rank,
        isPercent: !!input.percent,
        isBottom: !!input.bottom
      };else if (input.type === 'aboveAverage') rule = {
        ...rule,
        subType: 'average',
        operator: input.aboveAverage ? 'greaterThan' : 'lessThan'
      };else if (['duplicateValues', 'uniqueValues'].includes(input.type)) rule = {
        ...rule,
        subType: input.type
      };else if (input.type === 'timePeriod') rule = {
        ...rule,
        subType: 'timePeriod',
        operator: input.timePeriod
      };else if (['containsText', 'notContainsText', 'beginsWith', 'endsWith'].includes(input.type)) rule = {
        ...rule,
        subType: 'text',
        operator: input.operator || input.type,
        value: input.text
      };else if (input.type === 'colorScale') rule = {
        type: 'colorScale',
        config: input.cfvo.map((value, index) => ({
          index,
          value,
          color: '#' + input.color[index].argb.slice(-6)
        }))
      };else if (input.type === 'dataBar') rule = {
        type: 'dataBar',
        isShowValue: input.showValue !== false,
        config: {
          min: input.cfvo[0],
          max: input.cfvo[1],
          isGradient: input.gradient !== false,
          positiveColor: '#' + (input.color?.argb || 'FF16b889').slice(-6),
          nativeColor: '#' + (input.negativeFillColor?.argb || 'FFef3340').slice(-6)
        }
      };else throw Error('Formato condicional incompatible: ' + input.type + '. Resuélvelo antes de importar; no se descarta.');
      for (const value of [rule.value, ...(rule.config?.map?.(part => part.value?.type === 'formula' ? part.value.value : null) || [])]) if (typeof value === 'string' && /\[[^]]+\]|\b(WEBSERVICE|IMPORTXML|IMPORTDATA|IMPORTRANGE|HYPERLINK)\s*\(|\|/i.test(value)) throw Error('Formato condicional con referencia externa.');
      result.push({
        cfId: previous[result.length]?.cfId || 'excel-cf-' + source.id + '-' + input.priority,
        ranges,
        stopIfTrue: false,
        rule
      });
    }
  }
  return result;
}
async function loadExcel(buffer, advanced = false) {
  if (buffer.length > 20_000_000) throw Error('Máximo de 20 MB por archivo Excel.');
  const zip = await JSZip.loadAsync(buffer);
  if (Object.values(zip.files).reduce((size, file) => size + (file._data?.uncompressedSize || 0), 0) > 80_000_000) throw Error('El Excel descomprimido excede el límite.');
  const noteDrawing = /^xl\/drawings\/vmlDrawing\d+\.vml$/i;
  const incompatible = Object.entries(zip.files).filter(([name,file]) => !file.dir && /vbaProject|externalLinks\/|connections\.xml|pivotTables\/|charts\/|drawings\/|embeddings\//i.test(name) && !noteDrawing.test(name));
  if (incompatible.length && !advanced) throw Error('Este Excel necesita el editor avanzado local para conservar dibujos, gráficos, conexiones o tablas dinámicas.');
  for (const [name,file] of Object.entries(zip.files)) if (noteDrawing.test(name)) {
    const xml = await file.async('string');
    const types = [...xml.matchAll(/<(?:\w+:)?ClientData\b[^>]*\bObjectType="([^"]+)"/g)].map(match => match[1]);
    if (!advanced && (!types.length || types.some(type => type !== 'Note') || /<(?:\w+:)?imagedata\b/i.test(xml))) throw Error('Este dibujo necesita el editor avanzado local.');
  }
  let cells = 0;
  const barDisplays = new Map();
  const columnNumber = value => [...value].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);
  for (const [name, file] of Object.entries(zip.files).filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) {
    const xml = await file.async('string');
    barDisplays.set(Number(name.match(/sheet(\d+)\.xml$/)[1]), new Map([...xml.matchAll(/<cfRule\b([^>]*)>([\s\S]*?)<\/cfRule>/g)].filter(match => /\btype="dataBar"/.test(match[1])).map(match => [Number(match[1].match(/\bpriority="(\d+)"/)?.[1]), !/<dataBar\b[^>]*\bshowValue="(?:0|false)"/.test(match[2])])));
    for (const match of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)) {
      if (++cells > 200000 || columnNumber(match[1]) > 500 || Number(match[2]) > 20000) throw Error('El Excel excede los límites de celdas, filas o columnas.');
    }
    let validations = 0;
    for (const match of xml.matchAll(/<dataValidation\b[^>]*\bsqref="([^"]+)"/g)) for (const address of match[1].split(/\s+/)) {
      const range = address.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
      if (!range) throw Error('Rango de validación incompatible.');
      const lastRow = Number(range[4] || range[2]),
        lastCol = columnNumber(range[3] || range[1]);
      validations += (lastRow - Number(range[2]) + 1) * (lastCol - columnNumber(range[1]) + 1);
      if (lastRow > 20000 || lastCol > 500 || validations > 100000) throw Error('Reduce las validaciones a 100 000 celdas, 20 000 filas y 500 columnas.');
    }
    if (!advanced && /<filterColumn\b/.test(xml)) throw Error('Los filtros avanzados necesitan el editor avanzado local.');
    if (!advanced && /<(?:\w+:)?cfRule\b[^>]*\bstopIfTrue="(?:1|true)"/.test(xml)) throw Error('Esta regla necesita el editor avanzado local.');
  }
  const input = new ExcelJS.Workbook();
  await input.xlsx.load(buffer);
  for (const sheet of input.worksheets) for (const format of sheet.conditionalFormattings) for (const rule of format.rules) {
    if (rule.type === 'dataBar') rule.showValue = barDisplays.get(sheet.id)?.get(rule.priority) ?? true;
  }
  return input;
}
export async function recreateAgenda(buffer) {
  const input = await loadExcel(buffer),
    layouts = {
      Liderazgo: {
        row: 2,
        column: 2,
        keys: ['account', 'title', 'due_date', 'responsible', 'status', 'note']
      },
      Procesos: {
        row: 2,
        column: 1,
        keys: ['number', 'area', 'account', 'title', 'responsible', 'priority', 'due_date', 'status', 'description', 'note']
      },
      IT: {
        row: 2,
        column: 2,
        keys: ['account', 'title', 'priority', 'due_date', 'responsible', 'status', 'note']
      },
      Herramientas: {
        row: 2,
        column: 1,
        keys: ['number', 'tool', 'purpose', 'title', 'responsible', 'priority', 'due_date', 'status', 'description', 'note'],
        end: 21
      },
      'Copia de Procesos': {
        row: 2,
        column: 2,
        keys: ['area', 'account', 'title', 'priority', 'due_date', 'responsible', 'status', 'note']
      },
      'Bold Lab': {
        source: 'BoldLab',
        row: 3,
        column: 2,
        keys: ['topic', 'title', 'responsible', 'collaborators']
      }
    };
  const raw = {
    id: randomUUID(),
    name: 'Agenda de triunfos',
    appVersion: '1.0.3',
    locale: 'enUS',
    styles: {},
    sheetOrder: [],
    sheets: {}
  };
  for (const [name, layout] of Object.entries(layouts)) {
    const source = input.getWorksheet(layout.source || name) || input.getWorksheet(name);
    if (!source) throw Error('La referencia no contiene la hoja ' + name + '.');
    const sheet = {
      id: name,
      name,
      rowCount: Math.max(1000, source.rowCount + 1),
      columnCount: 40,
      cellData: {},
      __bold: {
        blocks: []
      }
    };
    source.eachRow((row, index) => row.eachCell((cell, col) => {
      sheet.cellData[index - 1] ||= {};
      sheet.cellData[index - 1][col - 1] = excelCell(cell);
    }));
    raw.sheetOrder.push(name);
    raw.sheets[name] = sheet;
  }
  const calculated = await calculate(raw),
    tables = {};
  const read = (name, row, column) => {
    const cell = clone(calculated.sheets[name].cellData?.[row - 1]?.[column - 1] || {});
    if (cell.f && /^#(?:VALUE!|REF!|NAME\?|DIV\/0!|NUM!|N\/A|SPILL!|CALC!)/.test(String(cell.v))) throw Error('No se pudo calcular la referencia ' + name + '!' + row + ':' + column + '.');
    delete cell.f;
    delete cell.si;
    delete cell.t;
    return cell;
  };
  for (const [name, layout] of Object.entries(layouts)) {
    const rows = [];
    for (let row = layout.row + 1; row <= (layout.end || raw.sheets[name].rowCount - 1); row++) {
      const cells = Object.fromEntries(layout.keys.map((key, index) => [key, ['responsible', 'collaborators'].includes(key) ? {
        v: ''
      } : read(name, row, layout.column + index)]));
      if (typeof cells.due_date?.v === 'number') cells.due_date.v = new Date(Date.UTC(1899,11,30) + cells.due_date.v * 86400000).toISOString().slice(0,10);
      if (Object.entries(cells).some(([key, cell]) => !['number', 'responsible', 'collaborators'].includes(key) && cell.v != null && String(cell.v).trim() !== '')) rows.push(cells);
    }
    tables[name] = rows;
  }
  const costs = [],
    comparison = [];
  for (let row = 23; row <= 26; row++) {
    const product = read('Herramientas', row, 2),
      current = read('Herramientas', row, 7);
    if (product.v) costs.push({
      product,
      price: read('Herramientas', row, 3),
      quantity: read('Herramientas', row, 4)
    });
    if (current.v) comparison.push({
      product: current,
      price: read('Herramientas', row, 8),
      quantity: read('Herramientas', row, 9),
      previous: read('Herramientas', row, 5)
    });
  }
  return {
    tables,
    costs,
    comparison
  };
}
export async function importExcel(buffer, {
  document,
  directory = [],
  newFile = false,
  advanced = false
} = {}) {
  const input = await loadExcel(buffer, advanced);
  const appearance = await excelAppearance(buffer);
  const hidden = input.getWorksheet('__BOLD');
  let metadata;
  if (newFile || !hidden && !Object.values(document.sheets).some(sheet => sheet.__bold.blocks.length)) {
    const known = Object.values(document.sheets);
    metadata = {format: 1, id: document.id, sheets: {}, cells: {}};
    for (const sheet of input.worksheets.filter(sheet => sheet.name !== '__BOLD')) {
      const id = newFile ? randomUUID() : known.find(item => item.name === sheet.name)?.id || randomUUID();
      metadata.sheets[id] = {id, name: sheet.name, __bold: {blocks: [], technicalColumn: false}};
    }
  } else try {
    if (!hidden) throw Error('Faltan identificadores BOLD. Conservamos las tareas; restaura la hoja __BOLD antes de importar.');
    metadata = JSON.parse(hidden.getColumn(1).values.slice(1).join(''));
  } catch (error) {
    throw Error(error.message.startsWith('Faltan') ? error.message : 'Identificadores BOLD dañados.');
  }
  if (metadata.id !== document.id || metadata.format !== 1) throw Error('El Excel pertenece a otro archivo BOLD.');
  const result = clone(document),
    issues = [],
    changes = [],
    seen = new Set(),
    validations = {},
    conditional = {},
    filters = {};
  const originalValidation = resourceData({
    resources: metadata.resources
  }, 'SHEET_DATA_VALIDATION_PLUGIN');
  const originalFilters = resourceData({resources: metadata.resources}, 'SHEET_FILTER_PLUGIN');
  const originalConditional = resourceData({resources: metadata.resources}, 'SHEET_CONDITIONAL_FORMATTING_PLUGIN');
  const originalNames = resourceData({resources: metadata.resources}, 'SHEET_DEFINED_NAME_PLUGIN');
  const originalAt = (sheet, row, col) => (originalValidation[sheet] || []).find(rule => rule.ranges?.some(range => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn));
  const listOptions = formula => {
    if (/^".*"$/.test(formula)) return formula.slice(1, -1).split(',');
    const ranges = input.definedNames.getRanges(String(formula).replace(/^=/, '')).ranges || [];
    const reference = ranges[0] || formula,
      match = String(reference).match(/^'?([^']+?)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
    if (!match) return null;
    const sheet = input.getWorksheet(match[1]);
    if (!sheet) return null;
    const from = sheet.getCell(match[2] + match[3]),
      to = sheet.getCell(match[4] + match[5]),
      values = [];
    if ((to.row - from.row + 1) * (to.col - from.col + 1) > 1000) throw Error('Demasiadas opciones en un desplegable.');
    for (let row = from.row; row <= to.row; row++) for (let col = from.col; col <= to.col; col++) values.push(String(sheet.getCell(row, col).value ?? ''));
    return values;
  };
  result.sheetOrder = [];
  result.sheets = {};
  result.styles = {};
  for (const source of input.worksheets.filter(sheet => sheet.name !== '__BOLD')) {
    const technical = Object.values(metadata.sheets).find(sheet => sheet.name === source.name) || Object.values(metadata.sheets).find(sheet => Object.values(sheet.__bold?.blocks || []).some(block => source.getColumn(1).values.includes('block:' + block.id)));
    if (!technical) {
      const id = randomUUID();
      metadata.sheets[id] = {id, name: source.name, __bold: {blocks: [], technicalColumn: false}};
    }
    const identified = technical || Object.values(metadata.sheets).find(sheet => sheet.name === source.name);
    if (result.sheetOrder.includes(identified.id)) throw Error('Hay hojas con identificadores repetidos.');
    const sheet = {
      id: identified.id,
      name: source.name,
      rowCount: Math.min(20000, Math.max(1000, source.rowCount + 50)),
      columnCount: Math.min(500, Math.max(40, source.columnCount + 5)),
      defaultRowHeight: (source.properties.defaultRowHeight || 15) / .75,
      defaultColumnWidth: (source.properties.defaultColWidth || 8.43) * 7,
      cellData: {},
      columnData: {
        '0': {
          hd: 1
        }
      },
      rowData: {},
      mergeData: [],
      __bold: {...clone(identified.__bold), sourceName: source.name}
    };
    if (source.autoFilter) {
      const addresses = source.autoFilter.replaceAll('$','').split(':'), from = source.getCell(addresses[0]), to = source.getCell(addresses[1] || addresses[0]);
      const ref = {startRow:from.row-1,endRow:to.row-1,startColumn:from.col-1,endColumn:to.col-1};
      const previous = originalFilters[sheet.id];
      const sameRange = previous && Object.keys(ref).every(key=>previous.ref?.[key]===ref[key]);
      // BOLD filter selections stay in technical metadata; Excel gets the same filter range.
      filters[sheet.id] = {ref,filterColumns:sameRange?clone(previous.filterColumns||[]):[]};
    }
    if (source.rowCount > 20000 || source.columnCount > 500) throw Error('El Excel excede los límites de filas o columnas.');
    if (!advanced || source.conditionalFormattings?.length) {
      try { conditional[sheet.id] = conditionalFromExcel(source, originalConditional[sheet.id]); }
      catch (error) {
        if (!advanced) throw error;
        // Unsupported rules stay in the original OOXML; keep the last renderable rules.
        conditional[sheet.id] = originalConditional[sheet.id] || [];
      }
    }
    source.eachRow((row, number) => {
      row.eachCell((cell, col) => {
        sheet.cellData[number - 1] ||= {};
        const imported = excelCell(cell, advanced, appearance), previous = document.sheets[sheet.id]?.cellData?.[number - 1]?.[col - 1];
        if (imported.p && previous?.p?.body?.dataStream === imported.p.body.dataStream && previous.p.body.customRanges?.[0]?.properties?.url === cell.hyperlink) imported.p = clone(previous.p);
        sheet.cellData[number - 1][col - 1] = imported;
      });
      if (row.height || row.hidden) sheet.rowData[number - 1] = {
        h: (row.height || 21) / .75,
        hd: +!!row.hidden,
        ...(row.outlineLevel ? {outlineLevel:row.outlineLevel} : {})
      };
    });
    for (const [address, validation] of Object.entries(source.dataValidations.model)) {
      const cell = source.getCell(address),
        number = cell.row,
        col = cell.col;
      if (!validation?.type || validation.type === 'any') continue;
      if (!validationTypes.has(validation.type)) throw Error('Una validación externa no es compatible.');
      const previous = originalAt(sheet.id, number - 1, col - 1);
      let rule = {
        type: validation.type,
        operator: validation.operator,
        allowBlank: !!validation.allowBlank,
        showErrorMessage: !!validation.showErrorMessage,
        error: validation.error,
        formula1: validation.formulae?.[0] == null ? undefined : validation.formulae[0] instanceof Date ? validation.formulae[0].toISOString().slice(0, 10) : String(validation.formulae[0]),
        formula2: validation.formulae?.[1] == null ? undefined : validation.formulae[1] instanceof Date ? validation.formulae[1].toISOString().slice(0, 10) : String(validation.formulae[1])
      };
      if (validation.type === 'list') {
        const options = listOptions(rule.formula1);
        if (options) rule.formula1 = JSON.stringify(options);else rule.formula1 = '=' + rule.formula1.replace(/^=/, '');
      }
      if (previous?.type === 'listMultiple' && validation.type === 'custom' && rule.formula1 === 'TRUE') rule = {
        ...previous,
        ranges: undefined,
        uid: undefined
      };
      if (previous?.type === 'checkbox' && validation.type === 'list' && JSON.stringify(listOptions(String(validation.formulae[0]))) === JSON.stringify(['TRUE', 'FALSE'])) rule = {
        ...previous,
        ranges: undefined,
        uid: undefined
      };
      const key = JSON.stringify(rule),
        saved = (validations[sheet.id] ||= []).find(item => item.key === key),
        range = {
          startRow: number - 1,
          endRow: number - 1,
          startColumn: col - 1,
          endColumn: col - 1
        };
      if (saved) {
        const adjacent = saved.ranges.find(previous => previous.endRow + 1 === range.startRow && previous.startColumn === range.startColumn && previous.endColumn === range.endColumn);
        if (adjacent) adjacent.endRow = range.endRow;else saved.ranges.push(range);
      } else validations[sheet.id].push({
        ...rule,
        key,
        uid: previous?.uid && !(validations[sheet.id] || []).some(item => item.uid === previous.uid) ? previous.uid : 'excel-validation-' + sheet.id + '-' + address,
        ranges: [range]
      });
    }
    source.columns.forEach((col, index) => {
      sheet.columnData[index] = {
        w: (col.width || 20) * 7,
        hd: +!!col.hidden,
        ...(col.outlineLevel ? {outlineLevel:col.outlineLevel} : {})
      };
    });
    if (sheet.__bold.technicalColumn !== false) sheet.columnData[0] = {...sheet.columnData[0], hd: 1};
    for (const range of source.model.merges || []) {
      const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
      const number = value => [...value].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      if (match) sheet.mergeData.push({
        startColumn: number(match[1]),
        startRow: +match[2] - 1,
        endColumn: number(match[3]),
        endRow: +match[4] - 1
      });
    }
    sheet.freeze = {
      xSplit: source.views?.[0]?.xSplit || 0,
      ySplit: source.views?.[0]?.ySplit || 0,
      startRow: source.views?.[0]?.ySplit || -1,
      startColumn: source.views?.[0]?.xSplit || -1
    };
    const markers = Object.entries(sheet.cellData).filter(([, cells]) => String(cells[0]?.v || '').startsWith('block:')).map(([r]) => +r).sort((a, b) => a - b);
    sheet.__bold.blocks = sheet.__bold.blocks.filter(block => Object.values(sheet.cellData).some(cells => cells[0]?.v === 'block:' + block.id));
    for (const block of sheet.__bold.blocks) {
      block.startRow = +Object.entries(sheet.cellData).find(([, cells]) => cells[0]?.v === 'block:' + block.id)[0];
      const header = sheet.cellData[block.startRow],
        known = new Map(block.columns.map(column => [column.name, column]));
      if (known.size !== block.columns.length) throw Error('Los encabezados del bloque deben ser diferentes para reconocer columnas de Excel.');
      const importedColumns = block.columns.map((_, index) => known.get(header[index + 1]?.v));
      if (importedColumns.some(column => !column) || new Set(importedColumns.map(column => column.id)).size !== block.columns.length) throw Error('Encabezados sin identificación: conserva sus nombres o cambia columnas desde BOLD antes de importar.');
      block.columns = clone(importedColumns);
      block.columns.forEach((column, index) => {
        header[index + 1].custom = {
          boldColumn: column.id,
          boldBlock: block.id
        };
      });
      const next = markers.find(row => row > block.startRow) ?? source.rowCount;
      const subtotal = Object.entries(sheet.cellData).find(([, cells]) => cells[0]?.v === 'subtotal:' + block.id);
      const end = subtotal ? +subtotal[0] : next;
      const oldIds = new Set(block.rowIds);
      block.rowIds = [];
      let last = end - 1;
      while (last > block.startRow && !Object.values(sheet.cellData[last] || {}).some(cell => cell.v !== null && cell.v !== '')) last--;
      for (let row = block.startRow + 1; row <= last; row++) {
        sheet.cellData[row] ||= {};
        let rowId = sheet.cellData[row][0]?.v;
        if (!/^[0-9a-f-]{36}$/i.test(rowId || '')) {
          rowId = randomUUID();
          issues.push({
            id: randomUUID(),
            type: 'identity',
            sheet: sheet.id,
            row,
            column: 0,
            value: rowId,
            message: 'Fila sin identificador: confirma que es nueva o selecciona la fila existente.',
            candidates: [...oldIds].filter(id => !seen.has(id))
          });
          sheet.cellData[row][0] = {
            v: rowId
          };
        } else if (!oldIds.has(rowId)) {
          issues.push({
            id: randomUUID(),
            type: 'identity',
            sheet: sheet.id,
            row,
            column: 0,
            value: rowId,
            message: 'Identificador nuevo: confirma la fila antes de generar tareas.',
            candidates: [...oldIds].filter(id => !seen.has(id))
          });
        }
        if (seen.has(rowId)) throw Error('Hay identificadores de fila duplicados. No se aplicaron cambios.');
        seen.add(rowId);
        block.rowIds.push(rowId);
        for (let col = 1; col <= block.columns.length; col++) {
          const descriptor = block.columns[col - 1],
            cell = sheet.cellData[row][col] || {
              v: ''
            },
            original = metadata.cells[sheet.id]?.[rowId + ':' + descriptor.id];
          let value = cell.v ?? '';
          if (descriptor.type === 'date' && source.getCell(row + 1,col + 1).value instanceof Date) cell.v = value = source.getCell(row + 1,col + 1).value.toISOString().slice(0,10);
          if (descriptor.id === 'note') {
            const note = source.getCell(row + 1, col).note;
            const text = typeof note === 'string' ? note : note?.texts?.map(part => part.text).join('');
            if (text != null && (original ? value === original.exported && text !== plain(original.exported) : !value)) {
              cell.v = value = text;
            }
          }
          if (original && value === original.exported) {
            cell.v = original.raw ?? '';
            const link = source.getCell(row + 1, col).hyperlink || '', beforeLink = original.hyperlink ?? richLink(original.raw) ?? '';
            if (typeof original.raw === 'string' && original.raw.startsWith('<!--bold-rich-text-->') && link !== beforeLink) {
              const count = (original.raw.match(/<a\b/gi) || []).length;
              if (count > 1) throw Error('Revisa los enlaces de esta descripción en BOLD antes de importar; contiene varios enlaces.');
              const escaped = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
              cell.v = link ? count ? original.raw.replace(/(<a\b[^>]*\bhref=)(["'])(.*?)\2/i, (_, start) => start + '"' + escaped + '"') : original.raw + '<p><a href="' + escaped + '">' + escaped + '</a></p>' : original.raw.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/i, '$1');
            }
          } else if (descriptor.type === 'dropdown' && value) {
            const option = descriptor.options?.find(option => option.label === value || option.value === value);
            if (option) cell.v = option.value;else issues.push({
              id: randomUUID(),
              type: 'dropdown',
              sheet: sheet.id,
              row,
              column: col,
              value,
              message: 'Opción de estado o prioridad no reconocida.',
              candidates: descriptor.options || []
            });
          } else if (['responsible', 'collaborators'].includes(descriptor.type) && value) {
            const ids = [];
            const labels = descriptor.type === 'responsible' ? [String(value).trim()] : String(value).split(',').map(value => value.trim()).filter(Boolean);
            for (const name of labels) {
              const candidates = directory.filter(person => (!block.task?.enabled || person.unit === block.task.unit) && [person.name, person.email, person.id].some(value => value?.toLocaleLowerCase() === name.toLocaleLowerCase()));
              const unique = [...new Map(candidates.map(person => [person.employee, person])).values()];
              if (unique.length === 1) ids.push(unique[0].id);else issues.push({
                id: randomUUID(),
                type: descriptor.type,
                unit: block.task?.enabled ? block.task.unit : '',
                sheet: sheet.id,
                row,
                column: col,
                value: name,
                message: 'Responsable ambiguo o desconocido; selección necesaria.',
                candidates: unique
              });
            }
            cell.v = ids.join(',');
          }
          sheet.cellData[row][col] = cell;
          if (['costs', 'comparison'].includes(block.type) && !cell.f && (cell.v == null || cell.v === '') && ['total', 'difference'].includes(descriptor.id)) {
            const ref = id => source.getColumn(block.columns.findIndex(column => column.id === id) + 2).letter + (row + 1);
            cell.f = descriptor.id === 'total' ? `=${ref('price')}*${ref('quantity')}` : `=${ref('total')}-${ref('previous')}`;
          }
          const before = original?.raw ?? '';
          if ((cell.v ?? '') !== before || (cell.f ?? '') !== (original?.formula ?? '')) changes.push({
            sheet: sheet.name,
            row: rowId,
            column: descriptor.name,
            before: original?.formula || before,
            after: cell.f || (cell.v ?? '')
          });
        }
      }
    }
    result.sheetOrder.push(sheet.id);
    result.sheets[sheet.id] = sheet;
    const previous = document.sheets[sheet.id];
    const managed = new Set(sheet.__bold.blocks.flatMap(block => block.rowIds.flatMap(row => block.columns.map(column => row + ':' + column.id))));
    for (const row of new Set([...Object.keys(previous?.cellData || {}), ...Object.keys(sheet.cellData)])) for (const col of new Set([...Object.keys(previous?.cellData?.[row] || {}), ...Object.keys(sheet.cellData[row] || {})])) {
      if (+col === 0) continue;
      const block = sheet.__bold.blocks.find(block => +row > block.startRow && +row <= block.startRow + block.rowIds.length && +col <= block.columns.length);
      if (block && managed.has(block.rowIds[+row - block.startRow - 1] + ':' + block.columns[+col - 1].id)) continue;
      const before = previous?.cellData?.[row]?.[col] || {},
        after = sheet.cellData[row]?.[col] || {};
      if ((before.f || before.v || '') !== (after.f || after.v || '')) changes.push({
        sheet: sheet.name,
        row: Number(row) + 1,
        column: source.getColumn(Number(col) + 1).letter,
        before: before.f || before.v || '',
        after: after.f || after.v || ''
      });
    }
  }
  if (!result.sheetOrder.length) throw Error('El archivo no contiene hojas editables.');
  result.resources = resources(document).filter(resource => !['SHEET_DATA_VALIDATION_PLUGIN', 'SHEET_FILTER_PLUGIN', 'SHEET_CONDITIONAL_FORMATTING_PLUGIN', 'SHEET_DEFINED_NAME_PLUGIN'].includes(resource.name));
  result.resources.push({
    name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN',
    data: JSON.stringify(conditional)
  });
  if (Object.keys(filters).length) result.resources.push({name:'SHEET_FILTER_PLUGIN',data:JSON.stringify(filters)});
  const names = {};
  for (const name of input.definedNames.model.filter(name => !name.name.startsWith('_BOLD_LIST_') && !filterName(name.name))) {
    if (name.ranges.length !== 1) throw Error('Revisa el rango con nombre antes de importar: ' + name.name);
    const id = Object.values(originalNames).find(item => item.name === name.name)?.id || 'excel-name-' + name.name;
    names[id] = {
      id,
      name: name.name,
      formulaOrRefString: '=' + name.ranges[0]
    };
  }
  if (Object.keys(names).length) result.resources.push({
    name: 'SHEET_DEFINED_NAME_PLUGIN',
    data: JSON.stringify(names)
  });
  if (Object.keys(validations).length) result.resources.push({
    name: 'SHEET_DATA_VALIDATION_PLUGIN',
    data: JSON.stringify(Object.fromEntries(Object.entries(validations).map(([sheet, rules]) => [sheet, rules.map(({
      key,
      ...rule
    }) => rule)])))
  });
  if (advanced) {
    importImages(input,result);
    await importNativeCharts(buffer,result);
    await importNativePivots(buffer,result);
  }
  importTables(input, result, appearance, metadata.resources || document.resources);
  const afterRows = new Set(Object.values(result.sheets).flatMap(sheet => sheet.__bold.blocks.flatMap(block => block.rowIds)));
  if(JSON.stringify(result.resources)!==JSON.stringify(document.resources)||JSON.stringify(Object.values(result.sheets).map(sheet=>[sheet.columnData,sheet.rowData,sheet.mergeData,sheet.freeze,Object.values(sheet.cellData).map(row=>Object.values(row).map(cell=>cell.s))]))!==JSON.stringify(Object.values(document.sheets).map(sheet=>[sheet.columnData,sheet.rowData,sheet.mergeData,sheet.freeze,Object.values(sheet.cellData).map(row=>Object.values(row).map(cell=>styleOf(document,cell)))])))changes.push({sheet:'Archivo',row:'',column:'Formato y configuración',before:'Configuración actual de BOLD',after:'Se aplicarán los formatos, tamaños, validaciones y reglas del Excel. Revisa la vista previa.'});
  for (const source of Object.values(document.sheets)) for (const block of source.__bold.blocks) for (const row of block.rowIds) if (!afterRows.has(row)) changes.push({
    sheet: source.name,
    row,
    column: 'Fila eliminada',
    before: 'La tarea se conserva y se desvincula',
    after: ''
  });
  return {
    document: result,
    issues,
    changes
  };
}

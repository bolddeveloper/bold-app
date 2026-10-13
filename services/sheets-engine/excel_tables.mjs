import { createHash } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const children = (node, name) => node ? [...node.childNodes].filter(item => item.nodeType === 1 && (!name || item.localName === name)) : [];
const child = (node, name) => children(node, name)[0];
const descendants = (node, name) => node ? [...node.getElementsByTagName('*')].filter(item => item.localName === name) : [];
const identity = value => 'excel-' + createHash('sha256').update(value).digest('hex').slice(0, 24);
const borderStyles = {thin:1, hair:2, dotted:3, dashed:4, dashDot:5, dashDotDot:6, double:7, medium:8, mediumDashed:9, mediumDashDot:10, mediumDashDotDot:11, slantDashDot:12, thick:13};

export async function excelAppearance(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async name => name && zip.file(name) ? new DOMParser().parseFromString(await zip.file(name).async('string'), 'application/xml') : null;
  const styles = await read('xl/styles.xml'), theme = await read('xl/theme/theme1.xml');
  const palette = children(descendants(theme, 'clrScheme')[0]).map(node => child(node)?.getAttribute('val') || child(node)?.getAttribute('lastClr'));
  // Excel theme indices start with light1/dark1, unlike the XML's dark1/light1 order.
  [palette[0], palette[1], palette[2], palette[3]] = [palette[1], palette[0], palette[3], palette[2]];
  const indexed = children(child(styles?.documentElement, 'colors') && child(child(styles.documentElement, 'colors'), 'indexedColors')).map(node => node.getAttribute('rgb'));
  const color = value => {
    if (!value) return undefined;
    const rgb = value.argb || value.rgb || (value.theme != null ? palette[value.theme] : indexed[value.indexed]);
    if (!/^[\da-f]{6,8}$/i.test(rgb || '')) return undefined;
    const tint = Math.max(-1, Math.min(1, Number(value.tint || 0)));
    return '#' + rgb.slice(-6).match(/../g).map(part => {
      const channel = parseInt(part, 16);
      return Math.round(tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint).toString(16).padStart(2, '0');
    }).join('');
  };
  const xmlColor = node => node && color(Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value])));
  const differential = node => {
    const result = {}, font = child(node, 'font'), fill = child(child(node, 'fill'), 'patternFill');
    const bg = xmlColor(child(fill, 'fgColor')), cl = xmlColor(child(font, 'color'));
    if (bg) result.bg = {rgb:bg};
    if (cl) result.cl = {rgb:cl};
    for (const [key, target] of [['b','bl'],['i','it'],['u','ul'],['strike','st']]) if (child(font, key)) {
      const value = +(child(font, key).getAttribute('val') !== '0');
      result[target] = ['ul','st'].includes(target) ? {s:value} : value;
    }
    const borders = children(child(node, 'border')).filter(item => borderStyles[item.getAttribute('style')]);
    if (borders.length) result.bd = Object.fromEntries(borders.map(item => [{top:'t',bottom:'b',left:'l',right:'r'}[item.localName], {s:borderStyles[item.getAttribute('style')], cl:{rgb:xmlColor(child(item,'color')) || '#000000'}}]).filter(([key]) => key));
    return result;
  };
  const dxfs = children(child(styles?.documentElement, 'dxfs')).map(differential);
  const customStyles = new Map(children(child(styles?.documentElement, 'tableStyles'), 'tableStyle').map(node => [node.getAttribute('name'), Object.fromEntries(children(node, 'tableStyleElement').map(element => [element.getAttribute('type'), {style:dxfs[+element.getAttribute('dxfId')] || {}, size:Number(element.getAttribute('size') || 1)}]))]));
  const relationships = async owner => {
    const xml = await read(path.posix.join(path.posix.dirname(owner), '_rels', path.posix.basename(owner) + '.rels'));
    return new Map(descendants(xml, 'Relationship').filter(item => item.getAttribute('TargetMode') !== 'External').map(item => {
      const target = item.getAttribute('Target');
      return [item.getAttribute('Id'), target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(owner), target))];
    }));
  };
  const workbook = await read('xl/workbook.xml'), links = await relationships('xl/workbook.xml'), tables = new Map();
  for (const tab of descendants(workbook, 'sheet')) {
    const part = links.get(tab.getAttribute('r:id'));
    if (!part) continue;
    const sheet = await read(part), sheetLinks = await relationships(part), items = [];
    for (const reference of descendants(sheet, 'tablePart')) {
      const table = (await read(sheetLinks.get(reference.getAttribute('r:id'))))?.documentElement;
      if (table) items.push(table);
    }
    tables.set(tab.getAttribute('name'), items);
  }
  return {color, borderStyles, tables, customStyles};
}

export function importTables(book, document, appearance, originalResources = []) {
  const previous = JSON.parse(originalResources.find(item => item.name === 'SHEET_TABLE_PLUGIN')?.data || '{}');
  const oldThemes = JSON.parse(originalResources.find(item => item.name === 'SHEET_RANGE_THEME_MODEL_PLUGIN')?.data || '{}');
  const tables = {}, themes = {rangeThemeStyleMapJson:{}, rangeThemeStyleRuleMap:{}};
  let styledCells = 0;
  for (const source of book.worksheets) {
    const sheet = Object.values(document.sheets).find(item => item.name === source.name);
    if (!sheet) continue;
    for (const table of appearance.tables.get(source.name) || []) {
      const addresses = table.getAttribute('ref').split(':'), from = source.getCell(addresses[0]), to = source.getCell(addresses[1] || addresses[0]);
      const range = {startRow:from.row-1, endRow:to.row-1, startColumn:from.col-1, endColumn:to.col-1};
      if (range.endRow >= 20000 || range.endColumn >= 500) throw Error('Tabla fuera del tamaño permitido.');
      styledCells += (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
      if (styledCells > 100000) throw Error('Máximo de 100 000 celdas de tablas por archivo.');
      const name = table.getAttribute('name'), saved = previous[sheet.id]?.tables?.find(item => item.name === name);
      const id = saved?.id || identity(sheet.id + ':table:' + name), themeName = 'table-' + id;
      const info = child(table, 'tableStyleInfo'), styleName = info?.getAttribute('name');
      const styles = appearance.customStyles.get(styleName), header = table.getAttribute('headerRowCount') !== '0';
      const theme = {name:themeName};
      const mapping = {wholeTable:'wholeStyle',headerRow:'headerRowStyle',firstRowStripe:'firstRowStyle',secondRowStripe:'secondRowStyle',firstColumn:'headerColumnStyle',lastColumn:'lastColumnStyle',totalRow:'lastRowStyle'};
      const enabled = type => !/RowStripe/.test(type) || info?.getAttribute('showRowStripes') !== '0';
      for (const [type, target] of Object.entries(mapping)) if (styles?.[type] && enabled(type)) {
        theme[target] = structuredClone(styles[type].style);
        if (type === 'wholeTable') delete theme[target].bd;
      }
      if (info?.getAttribute('showFirstColumn') !== '1') delete theme.headerColumnStyle;
      if (info?.getAttribute('showLastColumn') !== '1') delete theme.lastColumnStyle;
      if (!header) {
        delete theme.headerRowStyle;
        delete theme.firstRowStyle;
        delete theme.secondRowStyle;
      }
      // shortcut: wider stripes are baked into cells; add a range renderer when these tables must grow dynamically.
      if (styles?.firstRowStripe?.size > 1 || styles?.secondRowStripe?.size > 1) {
        delete theme.firstRowStyle;
        delete theme.secondRowStyle;
      }
      const combine = (...items) => Object.assign({}, ...items.filter(Boolean));
      for (let row = range.startRow; row <= range.endRow; row++) for (let col = range.startColumn; col <= range.endColumn; col++) {
        const isHeader = header && row === range.startRow;
        const firstSize = styles?.firstRowStripe?.size || 1, secondSize = styles?.secondRowStripe?.size || 1;
        const stripe = (row - range.startRow - +header) % (firstSize + secondSize) < firstSize ? 'firstRowStripe' : 'secondRowStripe';
        const style = combine(styles?.wholeTable?.style, !isHeader && enabled(stripe) && styles?.[stripe]?.style, isHeader && styles?.headerRow?.style,
          col === range.startColumn && info?.getAttribute('showFirstColumn') === '1' && styles?.firstColumn?.style,
          col === range.endColumn && info?.getAttribute('showLastColumn') === '1' && styles?.lastColumn?.style);
        const cell = (sheet.cellData[row] ||= {})[col] ||= {};
        const direct = cell.s || {};
        const border = styles?.wholeTable?.style.bd || {};
        style.bd = combine(row === range.startRow && {t:border.t}, row === range.endRow && {b:border.b}, col === range.startColumn && {l:border.l}, col === range.endColumn && {r:border.r}, direct.bd);
        style.bd = Object.fromEntries(Object.entries(style.bd).filter(([,value]) => value));
        cell.s = {...style, ...direct, bd:style.bd};
        if (!Object.keys(cell.s.bd).length) delete cell.s.bd;
      }
      if (styles) themes.rangeThemeStyleMapJson[themeName] = theme;
      else if (oldThemes.rangeThemeStyleMapJson?.[saved?.options?.tableStyleId]) themes.rangeThemeStyleMapJson[saved.options.tableStyleId] = oldThemes.rangeThemeStyleMapJson[saved.options.tableStyleId];
      const columns = children(child(table,'tableColumns'), 'tableColumn').map((column,index) => ({id:saved?.columns?.find(item => item.meta?.excelColumnId === column.getAttribute('id'))?.id || saved?.columns?.[index]?.id || identity(id + ':' + column.getAttribute('id')), displayName:header ? String(sheet.cellData[range.startRow]?.[range.startColumn + index]?.v ?? '').trim() || column.getAttribute('name') : column.getAttribute('name'), dataType:'string', formula:'', meta:{excelColumnId:column.getAttribute('id')}, style:{}}));
      // shortcut: built-in palettes use Univer's six themes; import full palette definitions for pixel parity.
      const tableStyleId = styles ? themeName : saved?.options?.tableStyleId || ({TableStyleMedium2:'table-default-0',TableStyleMedium3:'table-default-1',TableStyleMedium4:'table-default-2',TableStyleMedium5:'table-default-3',TableStyleMedium6:'table-default-4',TableStyleMedium7:'table-default-5'})[styleName];
      (tables[sheet.id] ||= {tables:[],tableFilteredOutRows:[]}).tables.push({id,name,range,columns,options:{showHeader:header,showFooter:false,...(tableStyleId ? {tableStyleId} : {})}, filters:saved?.filters || {tableColumnFilterList:[]}, meta:{...saved?.meta,excelStyleName:styleName || '',excelName:name,excelRef:table.getAttribute('ref'),showRowStripes:info?.getAttribute('showRowStripes') === '1',showColumnStripes:info?.getAttribute('showColumnStripes') === '1',showFirstColumn:info?.getAttribute('showFirstColumn') === '1',showLastColumn:info?.getAttribute('showLastColumn') === '1'}});
    }
  }
  document.resources = (document.resources || []).filter(item => !['SHEET_TABLE_PLUGIN','SHEET_RANGE_THEME_MODEL_PLUGIN'].includes(item.name));
  if (Object.keys(tables).length) document.resources.push({name:'SHEET_TABLE_PLUGIN',data:JSON.stringify(tables)});
  const unrelatedStyles = Object.fromEntries(Object.entries(oldThemes.rangeThemeStyleMapJson || {}).filter(([name]) => !name.startsWith('table-excel-')));
  Object.assign(themes.rangeThemeStyleMapJson, unrelatedStyles);
  themes.rangeThemeStyleRuleMap = Object.fromEntries(Object.entries(oldThemes.rangeThemeStyleRuleMap || {}).filter(([,rule]) => !rule.themeName.startsWith('table-') && document.sheets[rule.rangeInfo.subUnitId]));
  if (Object.keys(themes.rangeThemeStyleMapJson).length || Object.keys(themes.rangeThemeStyleRuleMap).length) document.resources.push({name:'SHEET_RANGE_THEME_MODEL_PLUGIN',data:JSON.stringify(themes)});
}

export function prepareBlockTables(document) {
  const resource=document.resources?.find(item=>item.name==='SHEET_TABLE_PLUGIN') || {name:'SHEET_TABLE_PLUGIN',data:'{}'};
  const data=JSON.parse(resource.data || '{}');
  for (const sheet of Object.values(document.sheets)) {
    const blocks=sheet.__bold?.blocks || [],saved=data[sheet.id];
    if (saved) saved.tables=saved.tables.filter(table=>!table.meta?.boldBlock || blocks.some(block=>block.id===table.meta.boldBlock && block.rowIds.length));
    for (const block of blocks) {
      if (['text','summary'].includes(block.type) || !block.rowIds.length) continue;
      const range={startRow:block.startRow,endRow:block.startRow+block.rowIds.length,startColumn:1,endColumn:block.columns.length};
      const tables=(data[sheet.id] ||= {tables:[],tableFilteredOutRows:[]}).tables;
      const name='BOLD_'+block.id.replace(/[^a-zA-Z0-9_]/g,'_'),existing=tables.find(table=>table.meta?.boldBlock===block.id || table.name===name);
      // Imported tables retain their own range and design; never add an overlapping table.
      if (!existing && tables.some(table=>table.range.startRow<=range.endRow && table.range.endRow>=range.startRow && table.range.startColumn<=range.endColumn && table.range.endColumn>=range.startColumn)) continue;
      const columns=block.columns.map(column=>({...(existing?.columns?.find(item=>item.id===column.id) || {id:column.id,dataType:'string',formula:'',meta:{},style:{}}),displayName:column.name}));
      if (existing) Object.assign(existing,{range,columns,meta:{...existing.meta,boldBlock:block.id}});
      else tables.push({id:'bold-table-'+block.id,name,range,columns,options:{showHeader:true,showFooter:false,tableStyleId:'table-default-0'},filters:{tableColumnFilterList:[]},meta:{boldBlock:block.id,excelStyleName:'TableStyleMedium2',showRowStripes:true}});
    }
  }
  if (!Object.keys(data).length) return;
  resource.data=JSON.stringify(data);
  if (!document.resources?.includes(resource)) (document.resources ||= []).push(resource);
}

export function exportTables(worksheet, document, sheetId) {
  const resource = document.resources?.find(item => item.name === 'SHEET_TABLE_PLUGIN');
  const data = resource ? JSON.parse(resource.data || '{}') : {};
  for (const table of data[sheetId]?.tables || []) {
    const {startRow,endRow,startColumn,endColumn} = table.range;
    const headerRow = table.options?.showHeader !== false;
    const headerValues = Array.from({length:endColumn-startColumn+1},(_,index) => worksheet.getCell(startRow+1,startColumn+index+1).value);
    const rows = [];
    for (let row = startRow + +headerRow; row <= endRow; row++) rows.push(Array.from({length:endColumn-startColumn+1},(_,index) => worksheet.getCell(row+1,startColumn+index+1).value));
    const styleIndex = table.options?.tableStyleId?.match(/^table-default-(\d)$/)?.[1];
    worksheet.addTable({name:table.name,ref:worksheet.getCell(startRow+1,startColumn+1).address,headerRow,totalsRow:false,
      columns:table.columns.map(column => ({name:column.displayName,filterButton:true})),rows,
      style:{theme:styleIndex != null ? 'TableStyleMedium' + (Number(styleIndex)+2) : table.meta?.excelStyleName || 'TableStyleMedium2',
        showRowStripes:table.meta?.showRowStripes ?? true,showColumnStripes:table.meta?.showColumnStripes ?? false,
        showFirstColumn:table.meta?.showFirstColumn ?? false,showLastColumn:table.meta?.showLastColumn ?? false}});
    if (headerRow) headerValues.forEach((value,index) => { worksheet.getCell(startRow+1,startColumn+index+1).value = value; });
  }
}

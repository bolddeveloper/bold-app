import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createHash } from 'node:crypto';
import path from 'node:path';

const serializer = new XMLSerializer();
const elements = (node, name) => [...node.childNodes].filter(item => item.nodeType === 1 && (!name || item.localName === name));
const child = (node, name) => elements(node, name)[0];
const xml = value => new DOMParser().parseFromString(value, 'application/xml');
const replace = (root, name, replacement) => {
  const previous = child(root, name);
  if (previous) root.replaceChild(replacement, previous);
  else {
    const order = ['sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','sheetCalcPr','sheetProtection','protectedRanges','scenarios','autoFilter','sortState','dataConsolidate','customSheetViews','mergeCells','phoneticPr','conditionalFormatting','dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'];
    const following = elements(root).find(item=>order.indexOf(item.localName)>order.indexOf(name));
    if (following) root.insertBefore(replacement,following); else root.appendChild(replacement);
  }
};
const target = value => value.startsWith('/') ? value.slice(1) : 'xl/' + value.replace(/^\.\//, '');
const relatedPath = owner => path.posix.join(path.posix.dirname(owner),'_rels',path.posix.basename(owner)+'.rels');
const resolvePart = (owner,value) => value.startsWith('/') ? value.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(owner),value));

async function mergeImages(original,generated,old,fresh,oldPath,freshPath,types) {
  const relationFile = relatedPath(oldPath), freshRelations = generated.file(relatedPath(freshPath));
  const rels = original.file(relationFile) ? xml(await original.file(relationFile).async('string')) : xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const freshRels = freshRelations ? xml(await freshRelations.async('string')) : null;
  const originalDrawing = child(old.documentElement,'drawing'), newDrawing = child(fresh.documentElement,'drawing');
  const originalRelation = originalDrawing && elements(rels.documentElement).find(item=>item.getAttribute('Id')===originalDrawing.getAttribute('r:id'));
  let drawingPath = originalRelation ? resolvePart(oldPath,originalRelation.getAttribute('Target')) : 'xl/drawings/drawing1.xml';
  // ExcelJS only reads drawing and media part names with alphanumeric basenames.
  if (!originalRelation) for (let index=2; original.file(drawingPath); index++) drawingPath='xl/drawings/drawing'+index+'.xml';
  const drawing = original.file(drawingPath) ? xml(await original.file(drawingPath).async('string')) : xml('<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>');
  const drawingRelsPath = relatedPath(drawingPath), drawingRels = original.file(drawingRelsPath) ? xml(await original.file(drawingRelsPath).async('string')) : xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const removed = new Set();
  for (const anchor of elements(drawing.documentElement)) if (elements(anchor).some(item=>item.localName==='pic')) {
    const embeds = [...anchor.getElementsByTagName('*')].filter(item=>item.localName==='blip').map(item=>item.getAttribute('r:embed'));
    if (!embeds.every(id=>/\.(png|jpe?g|gif)$/i.test(elements(drawingRels.documentElement).find(item=>item.getAttribute('Id')===id)?.getAttribute('Target') || ''))) continue;
    embeds.forEach(id=>removed.add(id)); drawing.documentElement.removeChild(anchor);
  }
  for (const relation of elements(drawingRels.documentElement)) if (removed.has(relation.getAttribute('Id'))) drawingRels.documentElement.removeChild(relation);
  if (newDrawing && freshRels) {
    const relation = elements(freshRels.documentElement).find(item=>item.getAttribute('Id')===newDrawing.getAttribute('r:id'));
    const newPath = resolvePart(freshPath,relation.getAttribute('Target'));
    const newXml = xml(await generated.file(newPath).async('string'));
    const newRels = xml(await generated.file(relatedPath(newPath)).async('string')), ids = new Map();
    for (const [index,item] of elements(newRels.documentElement).entries()) {
      if (!item.getAttribute('Type').endsWith('/image')) continue;
      const part = resolvePart(newPath,item.getAttribute('Target')), data = await generated.file(part).async('nodebuffer');
      const stored = 'xl/media/bold'+createHash('sha256').update(data).digest('hex')+path.posix.extname(part);
      original.file(stored,data);
      let serial = index, id = 'boldImage'+serial;
      while (elements(drawingRels.documentElement).some(item=>item.getAttribute('Id')===id)) id='boldImage'+(++serial);
      ids.set(item.getAttribute('Id'),id);
      const copy = item.cloneNode(true); copy.setAttribute('Id',id); copy.setAttribute('Target',path.posix.relative(path.posix.dirname(drawingPath),stored));
      drawingRels.documentElement.appendChild(copy);
    }
    for (const anchor of elements(newXml.documentElement)) {
      const copy = anchor.cloneNode(true);
      let nextId = Math.max(0,...[...drawing.getElementsByTagName('*')].filter(item=>item.localName==='cNvPr').map(item=>Number(item.getAttribute('id')))) + 1;
      for (const element of [...copy.getElementsByTagName('*')].filter(item=>item.localName==='cNvPr')) element.setAttribute('id',nextId++);
      for (const element of [...copy.getElementsByTagName('*')]) for (const attribute of ['r:embed','r:link']) if (ids.has(element.getAttribute(attribute))) element.setAttribute(attribute,ids.get(element.getAttribute(attribute)));
      drawing.documentElement.appendChild(copy);
    }
    if (!originalRelation) {
      const reference = newDrawing.cloneNode(true), id = 'boldDrawing'; reference.setAttribute('r:id',id); replace(old.documentElement,'drawing',reference);
      const copy = relation.cloneNode(true); copy.setAttribute('Id',id); copy.setAttribute('Target',path.posix.relative(path.posix.dirname(oldPath),drawingPath)); rels.documentElement.appendChild(copy);
      const content = types.createElementNS(types.documentElement.namespaceURI,'Override'); content.setAttribute('PartName','/'+drawingPath); content.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.drawing+xml'); types.documentElement.appendChild(content);
    }
  }
  if (originalDrawing || newDrawing) {
    original.file(drawingPath,serializer.serializeToString(drawing)); original.file(drawingRelsPath,serializer.serializeToString(drawingRels));
  }
  // Cell links use the generated targets so edits cannot leave a stale URL behind.
  const links = child(fresh.documentElement,'hyperlinks');
  for (const item of elements(freshRels?.documentElement || rels.createElement('Relationships'))) if (item.getAttribute('Type').endsWith('/hyperlink')) {
    const id = 'boldLink'+item.getAttribute('Id'), copy = item.cloneNode(true); copy.setAttribute('Id',id);
    const previous = elements(rels.documentElement).find(item=>item.getAttribute('Id')===id); if (previous) rels.documentElement.removeChild(previous);
    rels.documentElement.appendChild(copy);
    for (const link of elements(links || fresh.createElement('hyperlinks'))) if (link.getAttribute('r:id')===item.getAttribute('Id')) link.setAttribute('r:id',id);
  }
  if (links) replace(old.documentElement,'hyperlinks',links.cloneNode(true));
  else if (child(old.documentElement,'hyperlinks')) old.documentElement.removeChild(child(old.documentElement,'hyperlinks'));
  original.file(relationFile,serializer.serializeToString(rels));
}

async function mergeMissingTables(original, generated, old, fresh, oldPath, freshPath, types, sheetId) {
  const freshParts = child(fresh.documentElement,'tableParts');
  if (!freshParts) return;
  const freshRelationFile = generated.file(relatedPath(freshPath));
  if (!freshRelationFile) return;
  const freshLinks = xml(await freshRelationFile.async('string'));
  const relationFile = relatedPath(oldPath);
  const links = original.file(relationFile) ? xml(await original.file(relationFile).async('string')) : xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  let parts = child(old.documentElement,'tableParts');
  const known = new Set();
  for (const part of elements(parts || old.createElement('tableParts'))) {
    const link = elements(links.documentElement).find(item => item.getAttribute('Id') === part.getAttribute('r:id'));
    const file = link && original.file(resolvePart(oldPath,link.getAttribute('Target')));
    if (file) known.add(xml(await file.async('string')).documentElement.getAttribute('name'));
  }
  let nextId = 1;
  for (const file of original.file(/^xl\/tables\/.*\.xml$/)) nextId = Math.max(nextId,Number(xml(await file.async('string')).documentElement.getAttribute('id'))+1);
  for (const part of elements(freshParts)) {
    const link = elements(freshLinks.documentElement).find(item => item.getAttribute('Id') === part.getAttribute('r:id'));
    if (!link) continue;
    const file = generated.file(resolvePart(freshPath,link.getAttribute('Target')));
    if (!file) continue;
    const table = xml(await file.async('string')), name = table.documentElement.getAttribute('name');
    if (known.has(name)) continue;
    const id = createHash('sha256').update(sheetId + ':' + name).digest('hex').slice(0,24);
    // ExcelJS reads tableN.xml through worksheet-relative relationships.
    while (original.file('xl/tables/table' + nextId + '.xml')) nextId++;
    const tablePath = 'xl/tables/table' + nextId + '.xml', relationId = 'boldTable' + id;
    table.documentElement.setAttribute('id',String(nextId++));
    original.file(tablePath,serializer.serializeToString(table));
    const relation = links.createElement('Relationship');
    relation.setAttribute('Id',relationId); relation.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/table'); relation.setAttribute('Target',path.posix.relative(path.posix.dirname(oldPath),tablePath));
    links.documentElement.appendChild(relation);
    if (!parts) { parts = old.createElement('tableParts'); replace(old.documentElement,'tableParts',parts); }
    const reference = old.createElement('tablePart'); reference.setAttribute('xmlns:r','http://schemas.openxmlformats.org/officeDocument/2006/relationships'); reference.setAttribute('r:id',relationId); parts.appendChild(reference);
    const content = types.createElement('Override'); content.setAttribute('PartName','/' + tablePath); content.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml'); types.documentElement.appendChild(content);
    known.add(name);
  }
  if (parts) parts.setAttribute('count',String(elements(parts).length));
  original.file(relationFile,serializer.serializeToString(links));
}

// Keep original OOXML parts that the grid cannot represent instead of discarding them.
export async function patchExcelPackage(source, exported, document, sourceOnly = false) {
  const original = await JSZip.loadAsync(source), generated = await JSZip.loadAsync(exported);
  const read = async (zip, path) => xml(await zip.file(path).async('string'));
  const tableResource = document.resources?.find(item => item.name === 'SHEET_TABLE_PLUGIN');
  const tables = tableResource ? JSON.parse(tableResource.data || '{}') : null;
  const cellAddress = (row, column) => {
    let letters = '';
    for (let value = column + 1; value; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + (value - 1) % 26) + letters;
    return letters + (row + 1);
  };
  const workbook = await read(original, 'xl/workbook.xml'), fresh = await read(generated, 'xl/workbook.xml');
  const relations = await read(original, 'xl/_rels/workbook.xml.rels'), freshRelations = await read(generated, 'xl/_rels/workbook.xml.rels');
  const originalSheets = elements(child(workbook.documentElement, 'sheets'));
  const freshSheets = elements(child(fresh.documentElement, 'sheets'));
  const pathFor = (sheet, rels) => target(elements(rels.documentElement).find(item => item.getAttribute('Id') === sheet.getAttribute('r:id')).getAttribute('Target'));
  const oldStyles = await read(original, 'xl/styles.xml'), newStyles = await read(generated, 'xl/styles.xml');
  const offsets = {};
  for (const name of ['fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'dxfs']) {
    let table = child(oldStyles.documentElement, name);
    if (!table) { table = oldStyles.createElement(name); oldStyles.documentElement.appendChild(table); }
    offsets[name] = elements(table).length;
  }
  let formats = child(oldStyles.documentElement, 'numFmts');
  if (!formats) { formats = oldStyles.createElement('numFmts'); oldStyles.documentElement.insertBefore(formats, oldStyles.documentElement.firstChild); }
  let nextFormat = Math.max(163, ...elements(formats).map(item => Number(item.getAttribute('numFmtId')))) + 1;
  const formatIds = new Map();
  for (const item of elements(child(newStyles.documentElement, 'numFmts') || newStyles.createElement('numFmts'))) {
    const copy = item.cloneNode(true), id = nextFormat++;
    formatIds.set(Number(item.getAttribute('numFmtId')), id); copy.setAttribute('numFmtId', id); formats.appendChild(copy);
  }
  formats.setAttribute('count', elements(formats).length);
  for (const name of Object.keys(offsets)) {
    const table = child(oldStyles.documentElement, name);
    for (const item of elements(child(newStyles.documentElement, name) || newStyles.createElement(name))) {
      const copy = item.cloneNode(true);
      for (const [attribute, section] of Object.entries({fontId:'fonts',fillId:'fills',borderId:'borders',xfId:'cellStyleXfs'})) if (copy.hasAttribute(attribute)) copy.setAttribute(attribute, Number(copy.getAttribute(attribute)) + offsets[section]);
      if (formatIds.has(Number(copy.getAttribute('numFmtId')))) copy.setAttribute('numFmtId', formatIds.get(Number(copy.getAttribute('numFmtId'))));
      table.appendChild(copy);
    }
    table.setAttribute('count', elements(table).length);
  }
  original.file('xl/styles.xml', serializer.serializeToString(oldStyles));
  const sheetList = child(workbook.documentElement, 'sheets');
  const retained = new Set();
  let nextId = Math.max(0, ...originalSheets.map(sheet => Number(sheet.getAttribute('sheetId')))) + 1;
  const types = await read(original, '[Content_Types].xml');
  const freshTypes = await read(generated,'[Content_Types].xml');
  for (const item of elements(freshTypes.documentElement).filter(item=>item.localName==='Default')) if (!elements(types.documentElement).some(existing=>existing.localName==='Default' && existing.getAttribute('Extension')===item.getAttribute('Extension'))) types.documentElement.appendChild(item.cloneNode(true));
  const strings = generated.file('xl/sharedStrings.xml') ? [...(await read(generated, 'xl/sharedStrings.xml')).getElementsByTagName('si')] : [];
  for (const freshSheet of freshSheets) {
    const name = freshSheet.getAttribute('name'), snapshot = Object.values(document.sheets).find(sheet => sheet.name === name);
    let previous = originalSheets.find(sheet => !retained.has(sheet) && sheet.getAttribute('name') === (snapshot?.__bold.sourceName || name))
      || originalSheets.find(sheet => !retained.has(sheet) && sheet.getAttribute('name') === name);
    const freshPath = pathFor(freshSheet, freshRelations);
    const next = await read(generated, freshPath);
    for (const cell of [...next.getElementsByTagName('c')]) {
      if (cell.hasAttribute('s')) cell.setAttribute('s', Number(cell.getAttribute('s')) + offsets.cellXfs);
      if (cell.getAttribute('t') === 's') {
        const item = strings[Number(child(cell,'v').textContent)];
        cell.removeChild(child(cell, 'v')); cell.setAttribute('t','inlineStr');
        const inline = next.createElement('is');
        for (const part of [...item.childNodes]) inline.appendChild(part.cloneNode(true));
        cell.appendChild(inline);
      }
    }
    let path;
    if (previous) {
      path = pathFor(previous, relations);
      const old = await read(original, path), oldCells = new Map([...old.getElementsByTagName('c')].map(cell => [cell.getAttribute('r'),cell]));
      for (const cell of [...next.getElementsByTagName('c')]) {
        const oldCell = oldCells.get(cell.getAttribute('r'));
        const address = cell.getAttribute('r'), column = [...address.match(/^[A-Z]+/)[0]].reduce((sum,letter)=>sum*26+letter.charCodeAt(0)-64,0)-1;
        const row = Number(address.match(/\d+/)[0])-1;
        const snapshotCell = snapshot?.cellData?.[row]?.[column], style = typeof snapshotCell?.s === 'object' ? snapshotCell.s : document.styles?.[snapshotCell?.s];
        if (oldCell?.hasAttribute('s') && snapshotCell?.custom?.excelStyle === JSON.stringify(style)) cell.setAttribute('s',oldCell.getAttribute('s'));
        if (snapshot?.cellData?.[row]?.[column]?.custom?.officeFormula && child(oldCell || old.createElement('c'),'f')) {
          const formula = child(cell,'f'); if (formula) cell.removeChild(formula);
          cell.insertBefore(child(oldCell,'f').cloneNode(true),cell.firstChild);
        }
      }
      if (!sourceOnly || name === '__BOLD') replace(old.documentElement, 'sheetData', child(next.documentElement,'sheetData').cloneNode(true));
      if (!sourceOnly && child(next.documentElement,'dimension')) replace(old.documentElement,'dimension',child(next.documentElement,'dimension').cloneNode(true));
      if (!sourceOnly) for (const section of ['cols','mergeCells','sheetViews','autoFilter','dataValidations']) {
        const value = child(next.documentElement,section), previous = child(old.documentElement,section);
        if (value) replace(old.documentElement,section,value.cloneNode(true));
        else if (previous) old.documentElement.removeChild(previous);
      }
      if (!sourceOnly && name!=='__BOLD') await mergeImages(original,generated,old,next,path,freshPath,types);
      if (!sourceOnly && tables && snapshot) {
        const parts = child(old.documentElement, 'tableParts'), relationFile = relatedPath(path);
        if (parts && original.file(relationFile)) {
          const links = await read(original, relationFile);
          for (const part of elements(parts)) {
            const relation = elements(links.documentElement).find(item => item.getAttribute('Id') === part.getAttribute('r:id'));
            if (!relation) continue;
            const tablePath = resolvePart(path, relation.getAttribute('Target'));
            const table = await read(original, tablePath), root = table.documentElement;
            const current = tables[snapshot.id]?.tables?.find(item => (item.meta?.excelName || item.name) === root.getAttribute('name'));
            if (!current) {
              parts.removeChild(part);
              links.documentElement.removeChild(relation);
              original.remove(tablePath);
              original.remove(relatedPath(tablePath));
              for (const item of elements(types.documentElement)) if (item.getAttribute('PartName')==='/'+tablePath) types.documentElement.removeChild(item);
              continue;
            }
            const area = current.range, ref = cellAddress(area.startRow,area.startColumn) + ':' + cellAddress(area.endRow,area.endColumn);
            root.setAttribute('ref',ref);
            root.setAttribute('name',current.name);
            root.setAttribute('displayName',current.name);
            root.setAttribute('headerRowCount',current.options?.showHeader === false ? '0' : '1');
            if (child(root,'autoFilter')) child(root,'autoFilter').setAttribute('ref',ref);
            const columns = child(root,'tableColumns');
            if (columns) {
              const saved = new Map(elements(columns).map(column => [column.getAttribute('id'),column]));
              let nextColumnId = Math.max(0,...[...saved.keys()].map(Number))+1;
              for (const column of elements(columns)) columns.removeChild(column);
              for (const column of current.columns) {
                const previous = saved.get(column.meta?.excelColumnId);
                const node = previous?.cloneNode(true) || table.createElement('tableColumn');
                if (!previous) node.setAttribute('id',String(nextColumnId++));
                node.setAttribute('name',column.displayName);
                columns.appendChild(node);
              }
              columns.setAttribute('count',String(current.columns.length));
            }
            original.file(tablePath,serializer.serializeToString(table));
          }
          parts.setAttribute('count',String(elements(parts).length));
          if (!elements(parts).length) old.documentElement.removeChild(parts);
          original.file(relationFile,serializer.serializeToString(links));
        }
      }
      if (!sourceOnly && snapshot) await mergeMissingTables(original,generated,old,next,path,freshPath,types,snapshot.id);
      if (name === '__BOLD') original.file(path, serializer.serializeToString(next));
      else original.file(path, serializer.serializeToString(old));
      previous.setAttribute('name',name);
      if (name === '__BOLD') previous.setAttribute('state','veryHidden');
    } else {
      // Keep new worksheet parts readable by ExcelJS on the next calculation.
      while (original.file('xl/worksheets/sheet' + nextId + '.xml')) nextId++;
      const id = nextId++, relationId = 'boldSheet' + id;
      path = 'xl/worksheets/sheet' + id + '.xml';
      previous = freshSheet.cloneNode(true); previous.setAttribute('sheetId',id); previous.setAttribute('r:id',relationId);
      const relation = relations.createElement('Relationship');
      relation.setAttribute('Id',relationId); relation.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet'); relation.setAttribute('Target',path.slice(3)); relations.documentElement.appendChild(relation);
      const content = types.createElement('Override'); content.setAttribute('PartName','/'+path); content.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'); types.documentElement.appendChild(content);
      original.file(path, serializer.serializeToString(next));
      if (!sourceOnly && name!=='__BOLD') {
        await mergeImages(original,generated,next,next,path,freshPath,types);
        const copiedParts = child(next.documentElement,'tableParts');
        if (copiedParts) next.documentElement.removeChild(copiedParts);
        await mergeMissingTables(original,generated,next,await read(generated,freshPath),path,freshPath,types,snapshot.id);
        original.file(path,serializer.serializeToString(next));
      }
    }
    retained.add(previous); sheetList.appendChild(previous);
  }
  for (const sheet of originalSheets) if (!retained.has(sheet)) sheetList.removeChild(sheet);
  let names = child(workbook.documentElement,'definedNames');
  if (!names && child(fresh.documentElement,'definedNames')) { names = workbook.createElement('definedNames'); workbook.documentElement.appendChild(names); }
  if (names) for (const name of elements(child(fresh.documentElement,'definedNames') || fresh.createElement('definedNames'))) {
    const previous = elements(names).find(item=>item.getAttribute('name')===name.getAttribute('name'));
    if (previous) names.replaceChild(name.cloneNode(true),previous); else names.appendChild(name.cloneNode(true));
  }
  original.file('xl/workbook.xml',serializer.serializeToString(workbook));
  original.file('xl/_rels/workbook.xml.rels',serializer.serializeToString(relations));
  original.file('[Content_Types].xml',serializer.serializeToString(types));
  return original.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

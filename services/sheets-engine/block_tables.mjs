export function prepareBlockTables(document) {
  const resource=document.resources?.find(item=>item.name==='SHEET_TABLE_PLUGIN') || {name:'SHEET_TABLE_PLUGIN',data:'{}'};
  const data=JSON.parse(resource.data || '{}');
  for (const sheet of Object.values(document.sheets)) {
    const blocks=sheet.__bold?.blocks || [],saved=data[sheet.id];
    const eligible=block=>block.rowIds.length && (!['text','summary'].includes(block.type) || block.task?.enabled);
    if (saved) saved.tables=saved.tables.filter(table=>!table.meta?.boldBlock || blocks.some(block=>block.id===table.meta.boldBlock && eligible(block)));
    for (const block of blocks) {
      if (!eligible(block) || saved?.disabledBlocks?.includes(block.id)) continue;
      const range={startRow:block.startRow,endRow:block.startRow+block.rowIds.length,startColumn:1,endColumn:block.columns.length};
      const tables=(data[sheet.id] ||= {tables:[],tableFilteredOutRows:[]}).tables;
      let name='BOLD_'+block.id.replace(/[^a-zA-Z0-9_]/g,'_');
      const existing=tables.find(table=>table.meta?.boldBlock===block.id || table.name===name);
      // Imported tables retain their own range and design; never add an overlapping table.
      if (!existing && tables.some(table=>table.range.startRow<=range.endRow && table.range.endRow>=range.startRow && table.range.startColumn<=range.endColumn && table.range.endColumn>=range.startColumn)) continue;
      const columns=block.columns.map(column=>({...(existing?.columns?.find(item=>item.id===column.id) || {id:column.id,dataType:'string',formula:'',meta:{},style:{}}),displayName:column.name}));
      if (existing) {
        Object.assign(existing,{range,columns,meta:{...existing.meta,boldBlock:block.id}});
        if ((block.type==='tasks' || block.task?.enabled) && !existing.meta.boldTaskDesign && existing.options?.tableStyleId==='table-default-0' && existing.meta.excelStyleName==='TableStyleMedium2') {
          existing.options.tableStyleId='table-bold-tasks';
          existing.meta.boldTaskDesign=true;
        }
      }
      else {
        if (block.type==='tasks' || block.task?.enabled) {
          const names=new Set(Object.values(data).flatMap(sheet=>sheet.tables.map(table=>table.name)));
          let number=1;
          while (names.has('Tabla_'+number)) number++;
          name='Tabla_'+number;
        }
        tables.push({id:'bold-table-'+block.id,name,range,columns,options:{showHeader:true,showFooter:false,tableStyleId:block.type==='tasks' || block.task?.enabled ? 'table-bold-tasks' : 'table-default-0'},filters:{tableColumnFilterList:[]},meta:{boldBlock:block.id,...(block.type==='tasks' || block.task?.enabled ? {boldTaskDesign:true} : {}),excelStyleName:'TableStyleMedium2',showRowStripes:true}});
      }
    }
  }
  if (!Object.keys(data).length) return;
  resource.data=JSON.stringify(data);
  if (Object.values(data).some(sheet=>sheet.tables.some(table=>table.options?.tableStyleId==='table-bold-tasks'))) {
    const resource=document.resources?.find(item=>item.name==='SHEET_RANGE_THEME_MODEL_PLUGIN') || {name:'SHEET_RANGE_THEME_MODEL_PLUGIN',data:'{}'};
    const themes=JSON.parse(resource.data || '{}');
    (themes.rangeThemeStyleMapJson ||= {})['table-bold-tasks'] ||= {
      name:'table-bold-tasks',headerRowStyle:{bg:{rgb:'#535fc1'},cl:{rgb:'white'}},
      firstRowStyle:{bg:{rgb:'#ffffff'},cl:{rgb:'#252a33'}},secondRowStyle:{bg:{rgb:'#f6f8f9'},cl:{rgb:'#252a33'}}};
    resource.data=JSON.stringify(themes);
    if (!document.resources?.includes(resource)) (document.resources ||= []).push(resource);
  }
  if (!document.resources?.includes(resource)) (document.resources ||= []).push(resource);
}

const tableData=document=>JSON.parse(document.resources?.find(item=>item.name==='SHEET_TABLE_PLUGIN')?.data || '{}');
const sorted=value=>Array.isArray(value)?value.map(sorted):value && typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
const same=(left,right)=>JSON.stringify(sorted(left))===JSON.stringify(sorted(right));

export function normalizeBlockTables(snapshot, original) {
  if (!snapshot.resources?.some(item=>item.name==='SHEET_TABLE_PLUGIN')) return;
  const prepared={...original,resources:structuredClone(original.resources || [])};
  prepareBlockTables(prepared);
  const expected=tableData(prepared),saved=tableData(original),actual=tableData(snapshot);
  for (const [sheetId,data] of Object.entries(expected)) {
    const sheet=actual[sheetId] ||= {tables:[],tableFilteredOutRows:[]};
    const disabled=new Set(saved[sheetId]?.disabledBlocks || []);
    for (const table of data.tables) {
      const index=sheet.tables.findIndex(item=>item.id===table.id),previous=saved[sheetId]?.tables.find(item=>item.id===table.id);
      if (index<0) {
        if (table.meta?.boldBlock) disabled.add(table.meta.boldBlock);
        for (const block of original.sheets[sheetId]?.__bold?.blocks || []) if (table.range.startRow<=block.startRow+block.rowIds.length && table.range.endRow>=block.startRow && table.range.startColumn<=block.columns.length && table.range.endColumn>=1) disabled.add(block.id);
        continue;
      }
      const current=sheet.tables[index];
      // Runtime defaults must not become the base of a three-way save merge.
      if (same(current,table)) {
        if (previous) sheet.tables[index]=structuredClone(previous);
        else sheet.tables.splice(index,1);
      } else if (previous && current.options?.tableStyleId===table.options?.tableStyleId) {
        current.options.tableStyleId=previous.options.tableStyleId;
        if (!previous.meta?.boldTaskDesign) delete current.meta?.boldTaskDesign;
      }
    }
    if (disabled.size) sheet.disabledBlocks=[...disabled];
  }
  snapshot.resources.find(item=>item.name==='SHEET_TABLE_PLUGIN').data=JSON.stringify(actual);
  const theme=snapshot.resources?.find(item=>item.name==='SHEET_RANGE_THEME_MODEL_PLUGIN');
  if (theme) {
    const data=JSON.parse(theme.data || '{}'),before=JSON.parse(original.resources?.find(item=>item.name===theme.name)?.data || '{}');
    const automatic=JSON.parse(prepared.resources?.find(item=>item.name===theme.name)?.data || '{}').rangeThemeStyleMapJson?.['table-bold-tasks'];
    if (!before.rangeThemeStyleMapJson?.['table-bold-tasks'] && same(data.rangeThemeStyleMapJson?.['table-bold-tasks'],automatic)) delete data.rangeThemeStyleMapJson?.['table-bold-tasks'];
    theme.data=JSON.stringify(data);
  }
}

export function taskTableCellStyle(style) {
  if (!style || typeof style !== 'object') return style;
  const color=style.bg?.rgb?.toLowerCase();
  if (color==='#ef3340') {
    const {cl,...rest}=style;
    return {...rest,bg:{rgb:'#535fc1'},...(cl?.rgb?.toLowerCase()==='#ffffff'?{}:{cl})};
  }
  if (color==='#f5f7fa') return {...style,bg:{rgb:'#f6f8f9'}};
  return style;
}

export function styleTaskTables(document) {
  const tables=JSON.parse(document.resources?.find(item=>item.name==='SHEET_TABLE_PLUGIN')?.data || '{}');
  for (const [sheetId,data] of Object.entries(tables)) for (const table of data.tables) {
    if (table.options?.tableStyleId!=='table-bold-tasks') continue;
    const sheet=document.sheets[sheetId];
    if (!sheet) continue;
    for (let row=table.range.startRow;row<=table.range.endRow;row++) for (let col=table.range.startColumn;col<=table.range.endColumn;col++) {
      const cell=sheet.cellData?.[row]?.[col];
      if (cell?.s) cell.s=taskTableCellStyle(typeof cell.s==='string'?document.styles?.[cell.s]:cell.s);
    }
  }
}

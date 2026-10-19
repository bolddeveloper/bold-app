import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'vite';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {gridAdapter} from '../../hojas/sheets_model.js';

const {JSDOM}=await import(pathToFileURL(join(tmpdir(),'bold-ui-check/node_modules/jsdom/lib/api.js')));
const dom=new JSDOM('<div id="root"></div>');
for (const key of ['window','document','HTMLElement','MutationObserver']) globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.sheetSaveMounts=0;
const book={setEditable(){},setActiveSheet(){},getActiveSheet:()=>({getSheetId:()=> 'sheet'}),isCellEditing:()=>false,getId:()=> 'book'};
let mutations=0;
const executed=[];
const handlers=new Map();
const events=new Map();
globalThis.sheetSaveApi={
  snapshot:null,getContent(){return structuredClone(this.snapshot);},
  executeCommand(){return true;},setContent(snapshot){this.snapshot=structuredClone(snapshot);},emit(name){events.get(name)?.();},on(name,handler){events.set(name,handler);return ()=>events.delete(name);},
  univer:{executeCommand:(id,params)=>{executed.push({id,params});return true;},getActiveWorkbook:()=>book,Event:Object.fromEntries(['BeforeCommandExecute','BeforeSheetEditStart','CellClicked','CommandExecuted','SheetEditEnded'].map(name=>[name,name])),addEvent:(name,handler)=>{handlers.set(name,handler);return {dispose(){handlers.delete(name);}};},syncExecuteCommand(id,params){
    mutations++;
    if (id==='sheet.mutation.set-range-values') for (const [row,cells] of Object.entries(params.cellValue)) for (const [col,value] of Object.entries(cells)) {
      (globalThis.sheetSaveApi.snapshot.sheets.sheet.cellData[row] ||= {})[col]=value;
    }
    return true;
  }}
};
const server=await createServer({configFile:false,plugins:[{name:'mock-sheet-engine',enforce:'pre',transform(source,id){
  if (!id.replaceAll('\\','/').endsWith('/core/sheets_grid.jsx')) return;
  source=source.split('\n').filter(line=>!line.startsWith('import ') || line.includes("from 'react'") || line.includes('sheet_editing.js') || line.includes('sheet_menus.js')).join('\n');
  return source+`\nconst LocaleType={ES_ES:'esES'},DeviceInputEventType={PointerDown:0},sheetLocales={};
function SheetChartDialog(){return null;} function SheetPivotDialog(){return null;}
function CasualSheets({initialData,onReady}) {
  useEffect(()=>{globalThis.sheetSaveMounts++;globalThis.sheetSaveApi.snapshot=structuredClone(initialData);
    globalThis.sheetSaveApi.snapshot.resources.push({name:'RUNTIME_PLUGIN',data:'{"initialized":true}'});
    onReady(globalThis.sheetSaveApi);
  },[]);
  return <div data-testid="engine"/>;
}`;
}}],resolve:{dedupe:['react','react-dom']},optimizeDeps:{noDiscovery:true,include:[],entries:[]},esbuild:{jsx:'automatic'},server:{middlewareMode:true,hmr:false},appType:'custom'});
const root=createRoot(document.getElementById('root'));
try {
  const {default:Grid}=await server.ssrLoadModule(`/@fs/${resolve('sheets_grid.jsx').replaceAll('\\','/')}`);
  const initial={id:'book',sheetOrder:['sheet'],styles:{},resources:[],sheets:{sheet:{id:'sheet',name:'Datos',rowCount:20,columnCount:10,cellData:{},__bold:{blocks:[],technicalColumn:false}}}};
  const errors=[],changes=[];
  const render=async document=>act(async()=>{root.render(React.createElement(Grid,{document,revision:1,activeSheet:'sheet',editable:true,people:[],adapter:gridAdapter,change:items=>changes.push(...items),onError:error=>errors.push(error.message)}));});
  await render(initial);
  assert.equal(globalThis.sheetSaveMounts,1);
  await render(structuredClone(initial));
  assert.equal(globalThis.sheetSaveMounts,1,'save acknowledgement must retain the engine');
  assert.equal(mutations,0,'unchanged save must not clear or redraw cells');
  const remote=structuredClone(initial); remote.sheets.sheet.cellData={2:{2:{v:'Actualización remota'}}};
  await render(remote);
  assert.equal(globalThis.sheetSaveMounts,1,'remote cell updates must retain the engine');
  assert.equal(globalThis.sheetSaveApi.snapshot.sheets.sheet.cellData[2][2].v,'Actualización remota');
  const layout=structuredClone(remote); layout.sheets.sheet.rowData={2:{h:60}};
  const beforeLayout=mutations;
  await render(layout);
  assert.equal(globalThis.sheetSaveMounts,1,'remote row sizes must retain the engine');
  assert.ok(mutations>beforeLayout,'remote layout must still be applied');
  const chartRefresh=structuredClone(layout);
  chartRefresh.resources=[{name:'__casual_sheets_charts__',data:JSON.stringify({v:1,charts:[{id:'remote-chart',sheetId:'sheet',type:'area-stacked',pos:{startRow:3,endRow:12,startColumn:4,endColumn:10,width:625,height:375}}]})}];
  await render(chartRefresh);
  assert.equal(globalThis.sheetSaveMounts,1,'chart refresh must not remount the grid');
  assert.ok(globalThis.sheetSaveApi.snapshot.resources.some(item=>item.name==='__casual_sheets_charts__'));
  const calculated=structuredClone(chartRefresh);calculated.sheets.sheet.cellData[4]={2:{f:'=1+1',v:1}};
  await render(calculated);
  assert.equal(globalThis.sheetSaveMounts,1,'formula changes must not remount the grid');
  const recalculated=structuredClone(calculated);recalculated.sheets.sheet.cellData[4][2].v=2;
  await render(recalculated);
  assert.equal(globalThis.sheetSaveMounts,1,'recalculation acknowledgements must retain the engine');
  const structural=structuredClone(layout); structural.sheets.sheet.rowCount=30;
  await render(structural);
  assert.equal(globalThis.sheetSaveMounts,2,'real structure changes must still rebuild the engine');
  const tasks=structuredClone(initial);
  tasks.sheets.sheet.__bold={blocks:[{id:'tasks',type:'tasks',startRow:0,rowIds:['row'],columns:[{id:'title',name:'Tarea',type:'text'}],task:{enabled:false}}]};
  tasks.sheets.sheet.cellData={0:{0:{v:'block:tasks'},1:{v:'Tarea',custom:{boldColumn:'title'}}},1:{0:{v:'row'},1:{v:'Preparar propuesta'}}};
  await render(tasks);
  const command={id:'sheet.command.delete-table',params:{tableId:'bold-table-tasks'}};
  handlers.get('BeforeCommandExecute')(command);
  assert.equal(command.cancel,true,'native formatting removal must use the block operation');
  assert.deepEqual(changes,[{kind:'block.remove',sheet:'sheet',block:'tasks'}]);
  changes.length=0;
  const chart={id:'chart',sheetId:'sheet',type:'bar',source:{startRow:0,endRow:2,startColumn:0,endColumn:2},pos:{startRow:3,endRow:12,startColumn:4,endColumn:10}};
  globalThis.sheetSaveApi.snapshot.resources.push({name:'__casual_sheets_charts__',data:JSON.stringify({v:1,charts:[chart]})});
  globalThis.sheetSaveApi.emit('change');
  assert.equal(changes[0].kind,'grid','chart resource changes must enter the save queue immediately');
  const before=changes[0].document;
  chart.pos.endColumn=14;
  globalThis.sheetSaveApi.snapshot.resources.find(item=>item.name==='__casual_sheets_charts__').data=JSON.stringify({v:1,charts:[chart]});
  globalThis.sheetSaveApi.emit('change');
  assert.deepEqual(changes[1].baseDocument,before,'consecutive chart edits must retain their actual previous chart state');
  globalThis.sheetSaveApi.snapshot.sheets.sheet.cellData[1][1].v='Celda actualizada';
  globalThis.sheetSaveApi.emit('change');
  assert.equal(changes[2].kind,'cell','ordinary cell edits must not rewrite chart resources');
  const dates=structuredClone(initial);
  dates.sheets.sheet.__bold={blocks:[{id:'tasks',type:'tasks',startRow:0,rowIds:['row'],columns:[{id:'due_date',name:'Entrega',type:'date'}],task:{enabled:false}}]};
  dates.sheets.sheet.cellData={0:{0:{v:'block:tasks'},1:{v:'Entrega',custom:{boldColumn:'due_date'}}},1:{0:{v:'row'},1:{v:''}}};
  await render(dates);
  handlers.get('CellClicked')({worksheet:{getSheetId:()=> 'sheet'},row:1,column:1});
  assert.deepEqual(executed.at(-1),{id:'sheet.operation.show-data-validation-dropdown',params:{unitId:'book',subUnitId:'sheet',row:1,column:1}});
  const count=executed.length;
  handlers.get('CellClicked')({worksheet:{getSheetId:()=> 'sheet'},row:0,column:1});
  assert.equal(executed.length,count,'headers must not open the date picker');
  assert.deepEqual(errors,[]);
} finally {await act(async()=>root.unmount());await server.close();dom.window.close();delete globalThis.sheetSaveApi;delete globalThis.sheetSaveMounts;}

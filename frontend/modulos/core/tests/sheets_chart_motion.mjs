import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React,{act,useState,useRef,useEffect,useLayoutEffect,useCallback} from 'react';
import {jsx,jsxs} from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
const source=await readFile(new URL('../node_modules/@casualoffice/sheets/dist/sheets.js',import.meta.url),'utf8');
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const {JSDOM}=await import(pathToFileURL(join(tmpdir(),'bold-ui-check/node_modules/jsdom/lib/api.js')));
const dom=new JSDOM('<div id="root"></div><div id="host"><canvas></canvas></div>');
for (const key of ['window','document','HTMLElement','CustomEvent']) globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const frames=new Map();let frame=0,controls,mounts=0,disposals=0;
let observer,observedHost,observerDisconnected=false,resizes=0;
globalThis.ResizeObserver=class {constructor(callback){observer=callback;}observe(target){observedHost=target;}disconnect(){observerDisconnected=true;}};
globalThis.requestAnimationFrame=callback=>{frames.set(++frame,callback);return frame;};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
const host=document.getElementById('host'),canvas=host.querySelector('canvas');
host.getBoundingClientRect=()=>({left:0,top:0});
let canvasWidth=2000,canvasHeight=1500;
canvas.getBoundingClientRect=()=>({left:0,top:0,width:canvasWidth,height:canvasHeight});
let zoom=1;
const sheet={getZoomRatio:()=>zoom,getSheetId:()=> 'sheet',getRange:(row,column)=>({getCellRect:()=>({left:column*100,right:(column+1)*100,top:row*30,bottom:(row+1)*30})})};
const api={getActiveWorkbook:()=>({getId:()=> 'book',getActiveSheet:()=>sheet,getSheets:()=>[sheet]}),_injector:{get:()=>({getRenderById:()=>({scene:{getViewport:()=>({getScrollBar:()=>({totalSize:18})})}})})}};
const overlay=between('function ChartOverlay(', 'var CORNER_HANDLES');
const layer=between('function getChartViewport(', 'var init_ChartLayer');
const hit=new Function('MAX_SCAN',between('function rowAtY(', 'var MAX_SCAN;')+';return rectToCellPos;')(2048);
const dependencies={useCharts:()=>controls,init:()=>{mounts++;return {setOption(){},resize(){resizes++;},dispose(){disposals++;}};},
  buildEChartsOption:()=>({}),rectToCellPos:hit,getHeaderGutter:()=>({rowHeaderWidth:46,columnHeaderHeight:20}),
  ALL_HANDLES:['nw','n','ne','e','se','s','sw','w'],HANDLE_CURSORS:{},MIN_W:240,MIN_H:180,
  getUniverHost:()=>host,getUniverMainCanvas:()=>canvas,ChartContextMenu:()=>null,useChartLayoutEffect:useLayoutEffect,ChartRenderManager:{},ChartViewportKey:{VIEW_MAIN:'viewMain'}};
for(const name of new Set((overlay+layer).match(/use(?:State|Ref|Effect|Callback)\d*/g))) dependencies[name]=name.startsWith('useState')?useState:name.startsWith('useRef')?useRef:name.startsWith('useEffect')?useEffect:useCallback;
for(const name of new Set((overlay+layer).match(/\bjsx[s]?\d*/g))) dependencies[name]=name.startsWith('jsxs')?jsxs:jsx;
for(const name of new Set(layer.match(/createPortal\d*/g))) dependencies[name]=createPortal;
const Layer=new Function(...Object.keys(dependencies),overlay+layer+';return ChartLayer;')(...Object.values(dependencies));
function Harness(){
  const [charts,setCharts]=useState([{id:'chart',sheetId:'sheet',type:'area',pos:{startRow:2,endRow:6,startColumn:3,endColumn:8,width:550,height:240,offsetX:25,offsetY:7}}]);
  const update=useCallback((id,patch)=>setCharts(items=>items.map(item=>item.id===id?{...item,...patch}:item)),[]);
  controls={api:{univer:api,getDocumentMode:()=> 'editing'},charts,selectedId:'chart',select(){},remove(){},update};
  return jsx(Layer,{});
}
const root=createRoot(document.getElementById('root'));
try {
  await act(async()=>root.render(jsx(Harness,{})));
  const chart=host.querySelector('[data-testid="chart-overlay"]');
  assert.ok(chart,'the first layout must place the chart before an animation frame');
  assert.equal(host.querySelector('[data-testid="chart-layer"]').style.clipPath,'polygon(46px 20px,1982px 20px,1982px 1482px,46px 1482px)');
  assert.equal(observedHost,chart.querySelector('.chart-overlay__plot'));
  const previousResizes=resizes;observer();assert.equal(resizes,previousResizes+1);
  const pointer=(target,type,x,y)=>target.dispatchEvent(new window.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true,cancelable:true}));
  for(let index=0;index<3;index++) {
    const left=parseFloat(chart.style.left),top=parseFloat(chart.style.top);
    await act(async()=>pointer(chart,'pointerdown',100,100));
    await act(async()=>pointer(document,'pointermove',237,143));
    assert.equal(chart.style.left,`${left+137}px`);
    await act(async()=>pointer(document,'pointerup',237,143));
    assert.equal(chart.style.left,`${left+137}px`,'releasing must not paint the old position before the next animation frame');
    assert.equal(chart.style.top,`${top+43}px`);
    assert.equal(chart.style.width,'550px');assert.equal(chart.style.height,'240px');
    assert.equal(host.querySelectorAll('[data-testid="chart-overlay"]').length,1);
    assert.equal(host.querySelector('[data-testid="chart-overlay"]'),chart);
    assert.equal(mounts,1);assert.equal(disposals,0);
  }
  assert.equal(pointer(chart,'dragstart',0,0),false,'native browser drag images must be suppressed');
  const original=structuredClone(controls.charts[0].pos);
  const originalLeft=chart.style.left,originalTop=chart.style.top;
  for (const ratio of [.5,1.5,2,.75,1]) {
    zoom=ratio;
    await act(async()=>{const [id,callback]=frames.entries().next().value;frames.delete(id);callback();});
    assert.equal(chart.style.width,'550px');assert.equal(chart.style.height,'240px');
    assert.equal(chart.style.transform,`scale(${ratio})`);
    assert.equal(parseFloat(chart.style.left),(parseFloat(originalLeft)-46)*ratio+46);
    assert.equal(parseFloat(chart.style.top),(parseFloat(originalTop)-20)*ratio+20);
    assert.deepEqual(controls.charts[0].pos,original,'zoom must not persist new chart dimensions');
    assert.equal(mounts,1);
  }
  await act(async()=>pointer(chart,'pointerdown',100,100));
  await act(async()=>pointer(document,'pointermove',-10000,-10000));
  assert.equal(chart.style.left,'46px');assert.equal(chart.style.top,'20px');
  await act(async()=>pointer(document,'pointerup',-10000,-10000));
  assert.equal(chart.style.left,'46px');assert.equal(chart.style.top,'20px');
  await act(async()=>pointer(chart,'pointerdown',100,100));
  await act(async()=>pointer(document,'pointermove',10000,10000));
  assert.equal(chart.style.left,'1432px');assert.equal(chart.style.top,'1242px');
  await act(async()=>pointer(document,'pointerup',10000,10000));
  assert.equal(chart.style.left,'1432px');assert.equal(chart.style.top,'1242px');
  assert.equal(chart.style.width,'550px');assert.equal(chart.style.height,'240px');
  zoom=.5;
  await act(async()=>{const [id,callback]=frames.entries().next().value;frames.delete(id);callback();});
  const beforeMove=parseFloat(chart.style.left);
  await act(async()=>pointer(chart,'pointerdown',100,100));
  await act(async()=>pointer(document,'pointermove',137,123));
  await act(async()=>pointer(document,'pointerup',137,123));
  assert.equal(parseFloat(chart.style.left),beforeMove+37);
  assert.equal(controls.charts[0].pos.width,550);assert.equal(controls.charts[0].pos.height,240);
  const legacy={startRow:2,endRow:6,startColumn:3,endColumn:8};
  await act(async()=>controls.update('chart',{pos:legacy}));
  canvasWidth=800;canvasHeight=600;
  await act(async()=>{const [id,callback]=frames.entries().next().value;frames.delete(id);callback();});
  assert.equal(host.querySelector('[data-testid="chart-layer"]').style.clipPath,'polygon(46px 20px,782px 20px,782px 582px,46px 582px)');
  for (const ratio of [.5,1,2]) {
    zoom=ratio;
    await act(async()=>{const [id,callback]=frames.entries().next().value;frames.delete(id);callback();});
    assert.equal(chart.style.width,'600px');assert.equal(chart.style.height,'150px');
    assert.equal(chart.style.transform,`scale(${ratio})`);
    assert.deepEqual(controls.charts[0].pos,legacy);
  }
} finally {await act(async()=>root.unmount());assert.equal(observerDisconnected,true);dom.window.close();}

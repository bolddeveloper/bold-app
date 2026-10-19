import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React,{act,useState,useRef,useEffect,useCallback} from 'react';
import {jsx} from 'react/jsx-runtime';
import {createRoot} from 'react-dom/client';
import {init,use} from 'echarts/core';
import {SVGRenderer} from 'echarts/renderers';
import {LineChart,BarChart,PieChart,ScatterChart} from 'echarts/charts';
import {GridComponent,LegendComponent,TitleComponent,TooltipComponent,MarkLineComponent} from 'echarts/components';
import {patchSheetCharts} from '../tools/sheets_chart_rendering.mjs';

const source=await readFile(new URL('../node_modules/@casualoffice/sheets/dist/sheets.js',import.meta.url),'utf8');
assert.equal(patchSheetCharts(source),source);
const between=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const format={showTitle:true,legend:'right',gridlines:true,palette:'default',dataLabels:false};
const colors=['#4285f4','#ef4444','#fbbc04','#34a853','#ff6d01','#46bdc6'];
const options=new Function('mergeFormat','PALETTES',between('function buildEChartsOption(', 'var init_build_option')+';return {buildEChartsOption,buildOptionForType,legendOption,chartGrid};')(model=>({...format,...model.format}),{default:colors});
const cells=[['Producto','Precio','Licencias','Total'],['Eleven labs',5,10,30],['Envato',25,5,120],['',null,'',false],['Higsfield',50,0,200]];
const ws={getSheetId:()=> 'sheet',getRange:(row,col)=>({getValue:()=>cells[row]?.[col],getCellRect:()=>({left:col*100,right:(col+1)*100,top:row*30,bottom:(row+1)*30})}),getZoomRatio:()=>1.5};
const api={getActiveWorkbook:()=>({getSheets:()=>[ws]})};
const model={id:'chart',sheetId:'sheet',source:{startRow:0,endRow:4,startColumn:0,endColumn:3},type:'area-stacked',title:'Costos por producto',pos:{startRow:2,endRow:5,startColumn:3,endColumn:7}};
const option=options.buildEChartsOption(api,model);
assert.ok(option.series.every(series=>series.type==='line' && series.stack==='all' && series.areaStyle));
assert.deepEqual(option.xAxis.data,['Eleven labs','Envato','Higsfield']);
assert.deepEqual(option.series[0].data,[5,25,50]);
cells[0][4]='Notas';cells[1][4]='Texto';
const filtered=options.buildEChartsOption(api,{...model,source:{...model.source,endColumn:4}});
assert.equal(filtered.series.length,3);
assert.ok(option.grid.right>option.legend.width);
assert.ok(options.legendOption({...format,legend:'top'},true).top>0);
use([SVGRenderer,LineChart,BarChart,PieChart,ScatterChart,GridComponent,LegendComponent,TitleComponent,TooltipComponent,MarkLineComponent]);
for (const type of ['area','area-stacked','column','column-stacked','column-stacked-100','bar','bar-stacked','bar-stacked-100','line','line-stacked','pie','doughnut','scatter']) {
  const chart=init(null,null,{renderer:'svg',ssr:true,width:600,height:370});
  chart.setOption(options.buildEChartsOption(api,{...model,type}));
  const svg=chart.renderToSVGString();
  assert.ok(!svg.includes('NaN') && svg.includes('<path'));
  if (type==='area-stacked' && process.env.CHART_PREVIEW_PATH) await writeFile(process.env.CHART_PREVIEW_PATH,svg);
  chart.dispose();
}
for (const type of ['column','column-stacked','column-stacked-100','bar','bar-stacked','bar-stacked-100','line','line-stacked','area','area-stacked','pie','doughnut','scatter']) {
  const output=options.buildEChartsOption(api,{...model,type});
  assert.equal(output.backgroundColor,'#fff');
  assert.equal(output.textStyle.fontSize,12);
  assert.equal(output.animation,false);
  assert.equal(output.tooltip.appendTo,'body');
  assert.equal(output.tooltip.confine,false);
  assert.equal(output.tooltip.renderMode,'html');
  if (type.startsWith('line') || type.startsWith('area')) {
    assert.equal(output.xAxis.boundaryGap,false);
    assert.ok(output.series.every(series=>series.type==='line' && series.showSymbol===false));
    assert.ok(output.series.every(series=>Boolean(series.areaStyle)===type.startsWith('area')));
  }
  if (type==='column' || type==='bar') assert.ok(output.series.every(series=>series.type==='bar' && !series.stack));
  if (type.includes('stacked')) assert.ok(output.series.every(series=>series.stack==='all'));
}
const horizontal=options.buildEChartsOption(api,{...model,type:'bar'});
for (const [width,height] of [[339,164],[355,180],[240,180],[600,375]]) {
  const chart=init(null,null,{renderer:'svg',ssr:true,width,height});
  chart.setOption(options.buildEChartsOption(api,{...model,format:{showTitle:false}}));
  const plot=chart.getModel().getComponent('grid').coordinateSystem.getRect();
  assert.ok(plot.width>=width*.55,`plot is too narrow: ${plot.width}/${width}`);
  assert.ok(plot.height>=height*.5,`plot is too short: ${plot.height}/${height}`);
  chart.resize({width:600,height:375});
  assert.equal(chart.getModel().getComponent('legend').get('orient'),'vertical','growing a compact chart must restore its side legend');
  chart.dispose();
}
assert.equal(horizontal.xAxis.type,'value');assert.equal(horizontal.yAxis.type,'category');
const percent=options.buildEChartsOption(api,{...model,type:'column-stacked-100'});
assert.equal(percent.yAxis.max,100);
assert.ok(Math.abs(percent.series.reduce((sum,series)=>sum+series.data[0],0)-100)<.0001);
const customized=options.buildEChartsOption(api,{...model,format:{legend:'top',dataLabels:true,trendline:true,xAxisTitle:'Productos',yAxisTitle:'Costos',seriesTypes:{Total:'line'},seriesColors:{Total:'#aabbcc'},secondaryAxis:{Total:true}}});
assert.equal(customized.series[2].type,'line');assert.equal(customized.series[2].yAxisIndex,1);
assert.equal(customized.series[2].itemStyle.color,'#aabbcc');assert.equal(customized.series[2].label.show,true);
assert.ok(customized.series[2].markLine);assert.equal(customized.yAxis.length,2);
assert.equal(customized.xAxis.name,'Productos');assert.equal(customized.yAxis[0].name,'Costos');
assert.equal(options.buildEChartsOption(api,{...model,format:{showTitle:false,legend:'none'}}).title,undefined);
assert.ok(source.includes('DatasetComponent, MarkLineComponent'),'trendlines must be registered in the production renderer');
const hit=new Function('MAX_SCAN',between('function rowAtY(', 'var MAX_SCAN;')+';return rectToCellPos;')(2048);
const header=new Function('DEFAULT_HEADER_GUTTER',between('function getHeaderGutter(', 'var PRIMARY_CANVAS_SELECTOR')+';return getHeaderGutter;')({rowHeaderWidth:46,columnHeaderHeight:20});
assert.deepEqual(header({getActiveWorkbook:()=>({getActiveSheet:()=>({getSkeleton:()=>({rowHeaderWidthAndMarginLeft:64,columnHeaderHeightAndMarginTop:28})})})}),{rowHeaderWidth:64,columnHeaderHeight:28});
const offset={x:10,y:5},scroll={x:100,y:30},gutter={rowHeaderWidth:46,columnHeaderHeight:20};
const rectAt=zoom=>({left:(300-scroll.x)*zoom+offset.x+46,top:(60-scroll.y)*zoom+offset.y+20,width:500*zoom,height:120*zoom,zoom});
for (const zoom of [.75,1,1.5,2]) {
  const result=hit(ws,rectAt(zoom),offset,scroll,model.pos,zoom,gutter);
  assert.equal(result.width,500);assert.equal(result.height,120);
  assert.equal(result.startColumn,3);assert.equal(result.startRow,2);
  assert.equal(result.offsetX,0);assert.equal(result.offsetY,0);
  const moved=hit(ws,{...rectAt(zoom),left:rectAt(zoom).left+25*zoom,top:rectAt(zoom).top+7*zoom},offset,scroll,model.pos,zoom,gutter);
  assert.equal(moved.width,500);assert.equal(moved.height,120);
  assert.equal(moved.offsetX,25);assert.equal(moved.offsetY,7);
}

const {JSDOM}=await import(pathToFileURL(join(tmpdir(),'bold-ui-check/node_modules/jsdom/lib/api.js')));
const dom=new JSDOM('<div id="root"></div>');
for (const key of ['window','document','HTMLElement','CustomEvent']) globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {default:TooltipHTMLContent}=await import('echarts/lib/component/tooltip/TooltipHTMLContent.js');
const clippedPlot=document.createElement('div');clippedPlot.style.overflow='hidden';document.body.append(clippedPlot);
const tooltip=new TooltipHTMLContent({getDom:()=>clippedPlot,getWidth:()=>400,getHeight:()=>200,getZr:()=>({getWidth:()=>400,getHeight:()=>200})},option.tooltip);
assert.equal(tooltip.el.parentElement,document.body,'tooltip must escape the clipped plot and sheet viewport');
assert.equal(clippedPlot.contains(tooltip.el),false);
const tooltipElement=tooltip.el;tooltip.dispose();assert.equal(tooltipElement.isConnected,false);clippedPlot.remove();
const overlay=between('function ChartOverlay(', 'var CORNER_HANDLES');
let editable=true,plotHost,formulaRefresh,formulaDisposed=false,paintCount=0;
api.getFormula=()=>({calculationResultApplied:callback=>{formulaRefresh=callback;return {dispose(){formulaDisposed=true;}};}});
const updates=[];
const dependencies={useCharts:()=>({api:{univer:api,getDocumentMode:()=>editable?'editing':'viewing'},selectedId:model.id,select(){},update:(id,patch)=>updates.push({id,...patch})}),
  init:host=>{plotHost=host;host.replaceChildren(document.createElement('canvas'));return {setOption(option){paintCount++;assert.equal(option.animation,false);},resize(){},dispose(){}};},buildEChartsOption:options.buildEChartsOption,
  rectToCellPos:hit,getHeaderGutter:()=>gutter,ALL_HANDLES:['nw','n','ne','e','se','s','sw','w'],HANDLE_CURSORS:{},MIN_W:240,MIN_H:180};
for (const name of new Set(overlay.match(/use(?:State|Ref|Effect|Callback)\d*/g))) dependencies[name]=name.startsWith('useState')?useState:name.startsWith('useRef')?useRef:name.startsWith('useEffect')?useEffect:useCallback;
for (const name of new Set(overlay.match(/jsx\d*/g))) dependencies[name]=jsx;
const Overlay=new Function(...Object.keys(dependencies),overlay+';return ChartOverlay;')(...Object.values(dependencies));
const root=createRoot(document.getElementById('root'));
try {
  const props={model,rect:rectAt(1.5),canvasOffset:offset,scroll};
  await act(async()=>root.render(jsx(Overlay,props)));
  assert.equal(plotHost.className,'chart-overlay__plot');
  const paints=paintCount;
  formulaRefresh();
  assert.equal(paintCount,paints+1);
  assert.equal(document.querySelectorAll('[data-testid^="chart-handle-"]').length,8);
  const wrapper=document.querySelector('[data-testid="chart-overlay"]');
  await act(async()=>wrapper.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
  assert.equal(updates.at(-1).pos.startColumn,4);
  await act(async()=>wrapper.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true})));
  assert.equal(updates.at(-1).pos.height,180);
  const pointer=(target,type,x,y)=>target.dispatchEvent(new window.MouseEvent(type,{button:0,clientX:x,clientY:y,bubbles:true}));
  await act(async()=>pointer(wrapper,'pointerdown',100,100));
  await act(async()=>pointer(document,'pointermove',250,100));
  await act(async()=>pointer(document,'pointerup',250,100));
  assert.equal(updates.at(-1).pos.startColumn,4);
  const corner=document.querySelector('[data-testid="chart-handle-se"]');
  await act(async()=>pointer(wrapper,'pointerdown',100,100));
  await act(async()=>{pointer(document,'pointermove',325,145);pointer(document,'pointerup',325,145);});
  assert.equal(updates.at(-1).pos.width,500);
  assert.equal(updates.at(-1).pos.height,120);
  assert.equal(updates.at(-1).pos.offsetX,50);
  await act(async()=>pointer(corner,'pointerdown',100,100));
  await act(async()=>pointer(document,'pointermove',250,145));
  await act(async()=>pointer(document,'pointerup',250,145));
  assert.equal(updates.at(-1).pos.width,600);
  assert.equal(updates.at(-1).pos.height,180);
  const count=updates.length;
  await act(async()=>pointer(wrapper,'pointerdown',100,100));
  await act(async()=>pointer(document,'pointercancel',100,100));
  assert.equal(updates.length,count);
  editable=false;
  await act(async()=>root.render(jsx(Overlay,{...props})));
  assert.equal(document.querySelectorAll('[data-testid^="chart-handle-"]').length,0);
  await act(async()=>wrapper.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
  assert.equal(updates.length,count);
} finally {await act(async()=>root.unmount());assert.equal(formulaDisposed,true);const paints=paintCount;formulaRefresh();assert.equal(paintCount,paints);dom.window.close();}

// Isolated chart selector: no application APIs or workbook writes.
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {readFile} from 'node:fs/promises';
import {use} from 'echarts/core';
import {LineChart,BarChart,PieChart,ScatterChart} from 'echarts/charts';
import {GridComponent,LegendComponent,TitleComponent,TooltipComponent} from 'echarts/components';
use([LineChart,BarChart,PieChart,ScatterChart,GridComponent,LegendComponent,TitleComponent,TooltipComponent]);
const sdk=await readFile(new URL('../node_modules/@casualoffice/sheets/dist/sheets.js',import.meta.url),'utf8');
const between=(start,end)=>sdk.slice(sdk.indexOf(start),sdk.indexOf(end,sdk.indexOf(start)));
// Use the production builder while omitting Univer's browser-only initialization in SSR.
const builder='const PALETTES='+sdk.match(/PALETTES = (\{[\s\S]*?\n    \});/)[1]+';'+between('function defaultFormat(', 'function newChartId(')+between('function buildEChartsOption(', 'var init_build_option')+'export const buildChartOption=buildEChartsOption;';

const server=await createServer({configFile:false, plugins:[{name:'chart-dialog-shell',enforce:'pre',transform(code,id){
  if (id.replaceAll('\\','/').endsWith('/core/sheets_chart_preview.jsx')) return code.replace("import {buildChartOption} from '@casualoffice/sheets/sheets';",builder);
  if (id.replaceAll('\\','/').endsWith('/hojas/sheets_dialogs.jsx')) return 'import React from "react"; export function SheetDialog({title,children}) { return React.createElement("section",{"aria-label":title},children); }';
}}],resolve:{dedupe:['react','react-dom']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:join(tmpdir(),'bold-chart-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const {ChartExample}=await server.ssrLoadModule(`/@fs/${resolve('sheets_chart_preview.jsx').replaceAll('\\','/')}`);
  for (const type of ['column','column-stacked','column-stacked-100','bar','bar-stacked','bar-stacked-100','line','line-stacked','area','area-stacked','pie','doughnut','scatter']) {
    const preview=renderToStaticMarkup(React.createElement(ChartExample,{type}));
    assert.match(preview,/<svg/);
    assert.match(preview,/<path/);
    assert.doesNotMatch(preview,/NaN/);
    assert.match(preview,/#4285[Ff]4/);
  }
  const {SheetChartDialog}=await server.ssrLoadModule(`/@fs/${resolve('../hojas/sheet_charts.jsx').replaceAll('\\','/')}`);
  const snapshot={sheets:{data:{name:'Datos',cellData:{0:{0:{v:'Producto'},1:{v:'Cantidad'}},1:{0:{v:'A'},1:{v:12}}}}}};
  const api={getSelection:()=>({sheetId:'data',range:{startRow:0,endRow:1,startColumn:0,endColumn:1}}),getContent:()=>structuredClone(snapshot)};
  const html=renderToStaticMarkup(React.createElement(SheetChartDialog,{api,onClose(){}}));
  assert.equal((html.match(/aria-pressed=/g)||[]).length,15);
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,2);
  assert.equal((html.match(/<svg/g)||[]).length,15);
  for (const label of ['Editor de gráficos','Configuración','Personalizar','Columnas verticales','Circular','Anillo','Puntos (dispersión)','Intervalo de datos','Eje X','Series','Datos · A1:B2','Cantidad']) assert.ok(html.includes(label),label);
  assert.match(html,/<details class="sheets_chart_picker">/);
  assert.match(html,/<section id="[^"]+-customize" hidden=""/);
  assert.doesNotMatch(html,/<button[^>]+type="submit"[^>]+disabled/);
  const invalid=renderToStaticMarkup(React.createElement(SheetChartDialog,{api:{...api,getSelection:()=>null},onClose(){}}));
  assert.match(invalid,/<button[^>]+type="submit"[^>]+disabled/);
  assert.match(invalid,/role="alert"/);
  assert.doesNotMatch(html,/Source data|Clustered Column|First row is used/);
} finally {await server.close();}

import { createHash } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

const elements = (node,name) => node ? [...node.getElementsByTagName('*')].filter(item=>item.localName===name) : [];
const first = (node,name) => elements(node,name)[0];
const parse = text => new DOMParser().parseFromString(text,'application/xml');
const relative = (owner,target) => target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(owner),target));
const column = text => [...text].reduce((sum,item)=>sum*26+item.charCodeAt(0)-64,0)-1;
const reference = value => {
  const match = value?.match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
  return match ? {name:(match[1] || match[2]).replace(/''/g,"'"),startColumn:column(match[3]),startRow:+match[4]-1,endColumn:column(match[5] || match[3]),endRow:+(match[6] || match[4])-1} : null;
};

export async function importNativeCharts(buffer,document) {
  const zip = await JSZip.loadAsync(buffer), read = async name => name && zip.file(name) ? parse(await zip.file(name).async('string')) : null;
  const relations = async owner => {
    if (!owner) return new Map();
    const xml = await read(path.posix.join(path.posix.dirname(owner),'_rels',path.posix.basename(owner)+'.rels'));
    return new Map((xml ? elements(xml,'Relationship') : []).map(item=>[item.getAttribute('Id'),relative(owner,item.getAttribute('Target'))]));
  };
  const workbook = await read('xl/workbook.xml'), links = await relations('xl/workbook.xml');
  const saved = document.resources?.find(item=>item.name==='__casual_sheets_charts__');
  const previous = saved ? JSON.parse(saved.data).charts : [], charts = [];
  const manifest = zip.file('bold/native-objects.json') ? JSON.parse(await zip.file('bold/native-objects.json').async('string')) : {};
  for (const tab of elements(workbook,'sheet')) {
    const sheet = Object.values(document.sheets).find(item=>item.name===tab.getAttribute('name'));
    if (!sheet) continue;
    const sheetPart = links.get(tab.getAttribute('r:id')), xml = await read(sheetPart), sheetLinks = await relations(sheetPart);
    for (const drawing of elements(xml,'drawing')) {
      const drawingPart = sheetLinks.get(drawing.getAttribute('r:id')), drawingXml = await read(drawingPart), drawingLinks = await relations(drawingPart);
      if (!drawingXml) continue;
      for (const chartRef of elements(drawingXml,'chart')) {
        const part = drawingLinks.get(chartRef.getAttribute('r:id')), chart = await read(part);
        if (!chart) continue;
        const plot = first(chart,'plotArea'), typeNodes = plot ? [...plot.childNodes].filter(item=>/^(barChart|lineChart|areaChart|pieChart|doughnutChart|scatterChart)$/.test(item.localName)) : [], typeNode=typeNodes[0];
        if(typeNodes.length>2) continue;
        const series = typeNodes.flatMap(item=>elements(item,'ser')), categories = series[0] && reference(first(first(series[0],'cat') || first(series[0],'xVal') || series[0],'f')?.textContent);
        const values = series.map(item=>reference(first(first(item,'val') || first(item,'yVal') || item,'f')?.textContent));
        if (!categories || categories.name!==sheet.name || values.some(item=>!item || item.name!==sheet.name || item.startRow!==categories.startRow || item.endRow!==categories.endRow || item.startColumn!==item.endColumn) || !values.length) continue;
        const valueColumns=[...new Set(values.map(item=>item.startColumn))].sort((left,right)=>left-right);
        if(valueColumns.some((value,index)=>value!==categories.startColumn+index+1)) continue;
        let type = {barChart:first(typeNode,'barDir')?.getAttribute('val')==='bar'?'bar':'column',lineChart:'line',areaChart:'area',pieChart:'pie',doughnutChart:'doughnut',scatterChart:'scatter'}[typeNode.localName];
        const grouping = first(typeNode,'grouping')?.getAttribute('val');
        if (['stacked','percentStacked'].includes(grouping) && ['bar','column','line','area'].includes(type)) type += grouping==='percentStacked' && ['bar','column'].includes(type) ? '-stacked-100' : '-stacked';
        let anchor = chartRef;
        while (anchor.parentNode && anchor.parentNode!==drawingXml.documentElement) anchor = anchor.parentNode;
        const from = first(anchor,'from'), to = first(anchor,'to');
        const startRow = +(first(from || anchor,'row')?.textContent || 0), startColumn = +(first(from || anchor,'col')?.textContent || 0);
        const savedId = manifest.charts?.find(item=>item.part===part)?.id;
        const id = savedId || previous.find(item=>item.excelPart===part)?.id || 'excel-' + createHash('sha256').update(document.id+part).digest('hex').slice(0,24);
        const title = first(chart,'title');
        const seriesTypes={},seriesColors={},secondaryAxis={};
        for(const group of typeNodes) for(const item of elements(group,'ser')) {
          const index=series.indexOf(item), value=values[index], label=String(sheet.cellData?.[categories.startRow-1]?.[value.startColumn]?.v || '');
          if(typeNodes.length>1) seriesTypes[label]=group.localName==='lineChart'?'line':'bar';
          const color=first(first(item,'spPr'),'srgbClr')?.getAttribute('val'); if(/^[\da-f]{6}$/i.test(color || '')) seriesColors[label]='#'+color;
          const axes=elements(group,'axId').map(item=>item.getAttribute('val'));
          secondaryAxis[label]=elements(plot,'valAx').some(axis=>axes.includes(first(axis,'axId')?.getAttribute('val')) && first(axis,'axPos')?.getAttribute('val')==='r');
        }
        charts.push({id,sheetId:sheet.id,excelPart:part,type,title:title?elements(title,'t').map(item=>item.textContent).join(''):'',
          source:{startRow:Math.max(0,categories.startRow-1),endRow:categories.endRow,startColumn:categories.startColumn,endColumn:Math.max(...values.map(item=>item.endColumn))},
          pos:{startRow,startColumn,endRow:Math.min(19999,to?+(first(to,'row')?.textContent || startRow+14):startRow+14),endColumn:Math.min(499,to?+(first(to,'col')?.textContent || startColumn+8):startColumn+8)},
          format:{legend:({t:'top',b:'bottom',l:'left',r:'right'})[first(chart,'legendPos')?.getAttribute('val')] || 'none',dataLabels:elements(typeNode,'showVal').some(item=>item.getAttribute('val')==='1'),gridlines:!!first(chart,'majorGridlines'),trendline:!!first(chart,'trendline'),seriesTypes,seriesColors,secondaryAxis}});
      }
    }
  }
  if (!charts.length && !saved) return;
  // Models without native counterparts are pending BOLD edits, so keep them until the next export.
  const importedIds = new Set(charts.map(item=>item.id));
  charts.push(...previous.filter(item=>!importedIds.has(item.id) && !item.excelPart));
  document.resources = [...(document.resources || []).filter(item=>item.name!=='__casual_sheets_charts__'),{name:'__casual_sheets_charts__',data:JSON.stringify({v:1,charts})}];
}

export async function importNativePivots(buffer,document) {
  const zip=await JSZip.loadAsync(buffer), read=async name=>name && zip.file(name)?parse(await zip.file(name).async('string')):null;
  const relations=async owner=>{
    const xml=await read(path.posix.join(path.posix.dirname(owner),'_rels',path.posix.basename(owner)+'.rels'));
    return new Map(elements(xml,'Relationship').map(item=>[item.getAttribute('Id'),relative(owner,item.getAttribute('Target'))]));
  };
  const workbook=await read('xl/workbook.xml'), links=await relations('xl/workbook.xml');
  const resource=document.resources?.find(item=>item.name==='__casual_sheets_pivots__'), previous=resource?JSON.parse(resource.data).pivots:[], pivots=[];
  const manifest=zip.file('bold/native-objects.json')?JSON.parse(await zip.file('bold/native-objects.json').async('string')):{};
  for(const tab of elements(workbook,'sheet')) {
    const targetSheet=Object.values(document.sheets).find(item=>item.name===tab.getAttribute('name'));
    if(!targetSheet) continue;
    const owner=links.get(tab.getAttribute('r:id')); if(!owner) continue;
    const xml=await read(owner), sheetLinks=await relations(owner);
    for(const entry of elements(xml,'pivotTablePart')) {
      const part=sheetLinks.get(entry.getAttribute('r:id')), pivot=await read(part);
      if(!pivot) continue;
      const cacheEntry=elements(workbook,'pivotCache').find(item=>item.getAttribute('cacheId')===pivot.documentElement.getAttribute('cacheId'));
      const cache=cacheEntry && await read(links.get(cacheEntry.getAttribute('r:id')));
      const source=first(cache,'worksheetSource');
      if(!source || first(cache,'fieldGroup') || first(pivot,'calculatedFields')) continue;
      const sourceSheet=Object.values(document.sheets).find(item=>item.name===source.getAttribute('sheet'));
      const range=sourceSheet && reference("'"+sourceSheet.name.replace(/'/g,"''")+"'!"+source.getAttribute('ref'));
      const location=first(pivot,'location'), target=location && reference("'"+targetSheet.name.replace(/'/g,"''")+"'!"+location.getAttribute('ref'));
      if(!range || !target) continue;
      const agg={sum:'sum',count:'count',average:'average',min:'min',max:'max'}, showAs={normal:'normal',percentOfTotal:'pctOfGrandTotal',percentOfCol:'pctOfColumnTotal',percentOfRow:'pctOfRowTotal'};
      const values=elements(pivot,'dataField').map(item=>({column:+item.getAttribute('fld'),agg:agg[item.getAttribute('subtotal') || 'sum'],showAs:showAs[item.getAttribute('showDataAs') || 'normal']}));
      if(!values.length || values.some(item=>!item.agg || !item.showAs)) continue;
      const dimension=name=>elements(first(pivot,name),'field').filter(item=>+item.getAttribute('x')>=0).map(item=>({column:+item.getAttribute('x')}));
      const cacheFields=elements(cache,'cacheField'), pivotFields=elements(first(pivot,'pivotFields'),'pivotField'), filters=[];
      for(let column=0;column<pivotFields.length;column++) {
        const page=elements(pivot,'pageField').find(item=>+item.getAttribute('fld')===column), items=elements(pivotFields[column],'item');
        const hidden=items.some(item=>item.getAttribute('h')==='1');
        if(!page && !hidden) continue;
        const shared=first(cacheFields[column],'sharedItems');
        const values=shared?[...shared.childNodes].filter(item=>item.nodeType===1):[];
        const selected=page?.hasAttribute('item')?items[+page.getAttribute('item')]:null;
        const visible=selected?[selected]:items.filter(item=>item.getAttribute('h')!=='1' && item.hasAttribute('x'));
        if(visible.length) filters.push({column,allowedValues:visible.map(item=>values[+item.getAttribute('x')]?.getAttribute('v') || '')});
      }
      const id=manifest.pivots?.find(item=>item.part===part)?.id || previous.find(item=>item.excelPart===part)?.id || 'pivot-'+createHash('sha256').update(document.id+part).digest('hex').slice(0,24);
      pivots.push({id,excelPart:part,sourceSheetId:sourceSheet.id,source:{startRow:range.startRow,endRow:range.endRow,startColumn:range.startColumn,endColumn:range.endColumn},targetSheetId:targetSheet.id,target:{row:target.startRow,column:target.startColumn},rows:dimension('rowFields'),cols:dimension('colFields'),values,filters,lastOutputExtent:{rows:target.endRow-target.startRow+1,cols:target.endColumn-target.startColumn+1}});
    }
  }
  if(!pivots.length && !resource) return;
  const ids=new Set(pivots.map(item=>item.id)); pivots.push(...previous.filter(item=>!ids.has(item.id) && !item.excelPart));
  document.resources=[...(document.resources || []).filter(item=>item.name!=='__casual_sheets_pivots__'),{name:'__casual_sheets_pivots__',data:JSON.stringify({v:1,pivots})}];
}

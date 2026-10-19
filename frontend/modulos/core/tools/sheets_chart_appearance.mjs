export function patchSheetChartAppearance(source) {
  if (!source.includes('function ChartOverlay(')) return source;
  if (source.includes('// BOLD: shared chart appearance and previews.')) return allowTooltipOverflow(source.replace('init_types();init_build_option();return buildEChartsOption','init_types();init_build_option();init_echarts_init();return buildEChartsOption'));
  const replace=(before,after)=>{
    if (!source.includes(before)) throw Error('Cambió la apariencia de gráficos de Casual Sheets: '+before);
    source=source.replace(before,after);
  };
  replace('function buildOptionForType(type, headers, categories, rawSeries, title, format, dateCategories = null) {', `// BOLD: shared chart appearance and previews.
function buildOptionForType(...args) {
  const option=buildRawOptionForType(...args);
  option.animation=false;
  option.backgroundColor="#fff";
  option.textStyle={fontFamily:"Arial, sans-serif",fontSize:12,color:"#111"};
  if (option.title) option.title.textStyle={fontFamily:"Arial, sans-serif",fontSize:16,fontWeight:"normal",color:"#111"};
  if (option.legend) Object.assign(option.legend,{icon:"rect",itemWidth:12,itemHeight:12,itemGap:10,textStyle:{fontFamily:"Arial, sans-serif",fontSize:12,color:"#111"}});
  for (const key of ["xAxis","yAxis"]) {
    const axes=Array.isArray(option[key])?option[key]:option[key]?[option[key]]:[];
    for (const axis of axes) {
      axis.axisLabel={...axis.axisLabel,color:"#111",fontSize:12};
      axis.axisLine={show:axis.type==="category",lineStyle:{color:"#333",width:1}};
      axis.axisTick={show:false};
      axis.splitLine={...axis.splitLine,lineStyle:{color:"#ccc",width:1}};
      if (axis.type==="category" && option.series.some(series=>series.type==="line")) axis.boundaryGap=false;
    }
  }
  for (const series of option.series) {
    if (series.type==="line") {
      series.showSymbol=false;
      series.lineStyle={width:1.5,...series.lineStyle};
      if (series.areaStyle) series.areaStyle={...series.areaStyle,opacity:.3};
      if (series.yAxisIndex===1 && series.stack) series.stack="secondary";
    }
    if (series.type==="bar") {series.barMaxWidth=48;series.barGap="20%";}
    if (series.type==="pie") {
      series.center=[args[5].legend==="right"?"38%":args[5].legend==="left"?"62%":"50%",option.title?"55%":"50%"];
      series.radius=args[0]==="doughnut"?["36%","62%"]:"62%";
      series.itemStyle={borderColor:"#fff",borderWidth:1};
    }
  }
  return option;
}
function buildRawOptionForType(type, headers, categories, rawSeries, title, format, dateCategories = null) {`);
  replace('PALETTES = {','PALETTES = {\n      sheets:["#4285F4","#EA4335","#FBBC04","#34A853","#FF6D01","#46BDC6","#AB47BC","#00ACC1"],');
  replace('PALETTE_LABELS = {','PALETTE_LABELS = {\n      sheets:"Clásica",');
  replace('palette: "office",','palette: "sheets",');
  replace('legend: "bottom",','legend: "right",');
  replace('export {\n','export {\n  buildChartOption,\n');
  source+='\nfunction buildChartOption(api,model) {init_types();init_build_option();init_echarts_init();return buildEChartsOption(api,model);}\n';
  const start=source.indexOf('function ChartLayer()'),end=source.indexOf('\nfunction rectsEqual',start);
  let layer=source.slice(start,end);
  const effect=layer.match(/(useEffect\d*)\(\(\) => \{\n    if \(!api\) return;/)?.[1];
  if (!effect) throw Error('Cambió la sincronización de la capa de gráficos.');
  layer=layer.replace(effect+'(() => {\n    if (!api) return;', 'useChartLayoutEffect(() => {\n    if (!api) return;');
  layer=layer.replace('    raf = requestAnimationFrame(tick);\n    return () => cancelAnimationFrame(raf);','    recompute();\n    raf = requestAnimationFrame(tick);\n    return () => cancelAnimationFrame(raf);');
  source=source.slice(0,start)+layer+source.slice(end);
  source='import {useLayoutEffect as useChartLayoutEffect} from "react";\n'+source;
  replace('onPointerDown: onBodyPointerDown,','draggable:false, onDragStart:event=>event.preventDefault(),\n      onPointerDown: onBodyPointerDown,');
  source=source.replaceAll('if (e.button !== 0 || !editable) return;\n    e.stopPropagation();','if (e.button !== 0 || !editable) return;\n    e.preventDefault();e.stopPropagation();');
  replace('c.id === id ? { ...c, ...patch } : c','c.id === id ? { ...c, ...patch, ...(patch.type && patch.type!==c.type ? {format:{...c.format,...patch.format,seriesTypes:{}}} : {}) } : c');
  return allowTooltipOverflow(source);
}

function allowTooltipOverflow(source) {
  if (source.includes('appendTo:"body",confine:false')) return source;
  return source.replace('  option.animation=false;','  option.animation=false;\n  option.tooltip={...option.tooltip,renderMode:"html",appendTo:"body",confine:false};');
}

export function patchSheetChartLayout(source) {
  if (!source.includes('function ChartOverlay(') || source.includes('// BOLD: fixed chart size across sheet zoom.')) return source;
  const replace=(before,after)=>{
    if (!source.includes(before)) throw Error('Cambió el tamaño de gráficos de Casual Sheets: '+before);
    source=source.replace(before,after);
  };
  replace('echartRef.current = inst;','echartRef.current = inst;\n    const observer=typeof ResizeObserver!=="undefined" ? new ResizeObserver(()=>inst.resize()) : null;\n    observer?.observe(host);');
  replace('      inst.dispose();','      observer?.disconnect();\n      inst.dispose();');
  replace('function chartGrid(format, hasTitle, hasSecondaryAxis = false) {','// BOLD: fixed chart size across sheet zoom.\nfunction chartGrid(format, hasTitle, hasSecondaryAxis = false) {');
  const start=source.indexOf('function chartGrid('),end=source.indexOf('\nfunction dataLabelConfig',start);
  let grid=source.slice(start,end).replace('left: 56,','left: 12,').replace('right: hasSecondaryAxis ? 56 : 24,','right: hasSecondaryAxis ? 48 : 12,').replace('bottom: 56,','bottom: 12,').replace('grid.left = 144;','grid.left = 116;').replace('grid.right = hasSecondaryAxis ? 184 : 144;','grid.right = hasSecondaryAxis ? 148 : 112;').replace('grid.bottom = 32;','grid.bottom = 12;');
  source=source.slice(0,start)+grid+source.slice(end);
  source=source.replaceAll('pos.width=112','pos.width=96');
  replace('  return option;\n}\nfunction buildRawOptionForType', `  if (option.grid) {
    const format=args[5],hasLegend=format.legend!=="none",hasTitle=!!option.title;
    option.media=[{query:{maxWidth:420},option:{
      grid:{left:8,right:option.yAxis?.length>1?36:8,top:hasTitle?(hasLegend?66:36):(hasLegend?34:10),bottom:8},
      ...(hasLegend?{legend:{orient:"horizontal",left:"center",right:"auto",top:hasTitle?32:0,bottom:"auto",width:"95%",height:22}}:{})
    }},{option:{grid:{...option.grid},...(option.legend?{legend:{left:"auto",right:"auto",top:"auto",bottom:"auto",width:"auto",height:"auto",orient:"horizontal",...option.legend}}:{})}}];
  }
  return option;
}
function buildRawOptionForType`);
  return source;
}

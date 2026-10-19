export function patchSheetChartSaving(source) {
  if (!source.includes('function createCasualSheetsAPI(')) return source;
  if (source.includes('// BOLD: save chart resources without replacing the workbook.')) return retainChartSelection(source);
  let next=source;
  const replace=(before,after)=>{
    if (!next.includes(before)) throw Error('Cambió el guardado de gráficos de Casual Sheets.');
    next=next.replace(before,after);
  };
  replace('const setContent = (data) => {\n    captureCustom(data.resources);', `const setContent = (data) => {
    // BOLD: save chart resources without replacing the workbook.
    const current=getContent();
    const grid=snapshot=>({...snapshot,resources:(snapshot.resources || []).filter(item=>!CUSTOM_RESOURCE_NAMES.has(item.name))});
    if (current && JSON.stringify(grid(current))===JSON.stringify(grid(data))) {
      captureCustom(data.resources);
      markDirty(true);
      emitter.emit("change",getContent());
      return;
    }
    captureCustom(data.resources);`);
  replace('if (raw === "bar") return "column";', '// Horizontal bars keep the same type after reopening.');
  replace('  DatasetComponent\n} from "echarts/components";', '  DatasetComponent, MarkLineComponent\n} from "echarts/components";');
  replace('      DatasetComponent\n    ]);','      DatasetComponent, MarkLineComponent\n    ]);');
  const start=next.indexOf('function ChartsProvider('),end=next.indexOf('\nvar ',start);
  let provider=next.slice(start,end);
  const ref=provider.match(/const subsRef = (\w+)\(/)?.[1];
  if (!ref) throw Error('Cambió el estado de gráficos de Casual Sheets.');
  provider=provider.replace('const subsRef =', `const chartsRef=${ref}(charts); chartsRef.current=charts;\n  const subsRef =`);
  const updater=/setCharts\(\(prev\) => \{\n\s*const next = ([^;]+);\n\s*notifyLocal\(next\);\n\s*persist\(next\);\n\s*return next;\n\s*\}\);/g;
  if ([...provider.matchAll(updater)].length!==3) throw Error('Cambió una operación de gráfico de Casual Sheets.');
  provider=provider.replace(updater,(_,expression)=>`const next=${expression.replaceAll('prev','chartsRef.current')};\n      chartsRef.current=next;setCharts(next);notifyLocal(next);persist(next);`);
  return retainChartSelection(next.slice(0,start)+provider+next.slice(end));
}

function retainChartSelection(source) {
  const before='setCharts(readChartsFromSnapshot(snapshot));\n      setSelectedId(null);';
  return source.replace(before,'const next=readChartsFromSnapshot(snapshot);\n      chartsRef.current=next;setCharts(next);\n      setSelectedId(current=>next.some(chart=>chart.id===current)?current:null);');
}

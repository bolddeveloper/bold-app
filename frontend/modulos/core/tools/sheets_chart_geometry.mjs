export function patchSheetChartGeometry(source) {
  source=patchChartRefresh(source);
  if (!source.includes('function ChartOverlay(') || source.includes('// BOLD: chart dimensions remain independent of cell snapping.')) return source;
  let next=source;
  const replace=(before,after)=>{
    if (!next.includes(before)) throw Error('Cambió la geometría de gráficos de Casual Sheets.');
    next=next.replace(before,after);
  };
  replace('return { startRow, endRow, startColumn, endColumn };\n}\nvar MAX_SCAN;', `// BOLD: chart dimensions remain independent of cell snapping.
  const anchor=sheet.getRange(startRow,startColumn).getCellRect();
  return {startRow,endRow,startColumn,endColumn,offsetX:preLeft-anchor.left,offsetY:preTop-anchor.top,width:screenRect.width/zoom,height:screenRect.height/zoom};
}

var MAX_SCAN;`);
  replace('(Math.min(tl.left, br.left) - sx) * zoom','(Math.min(tl.left, br.left) + (c.pos.offsetX || 0) - sx) * zoom');
  replace('(Math.min(tl.top, br.top) - sy) * zoom','(Math.min(tl.top, br.top) + (c.pos.offsetY || 0) - sy) * zoom');
  replace('const right = (Math.max(tl.right, br.right) - sx) * zoom + dx + gutter.rowHeaderWidth;', 'const right = Number.isFinite(c.pos.width) ? left+c.pos.width*zoom : (Math.max(tl.right, br.right) - sx) * zoom + dx + gutter.rowHeaderWidth;');
  replace('const bottom = (Math.max(tl.bottom, br.bottom) - sy) * zoom + dy + gutter.columnHeaderHeight;', 'const bottom = Number.isFinite(c.pos.height) ? top+c.pos.height*zoom : (Math.max(tl.bottom, br.bottom) - sy) * zoom + dy + gutter.columnHeaderHeight;');
  return next;
}

function patchChartRefresh(source) {
  if (!source.includes('function ChartOverlay(') || source.includes('// BOLD: refresh calculated values without restarting charts.')) return source;
  const replace=(before,after)=>{
    if (!source.includes(before)) throw Error('Cambió la actualización de gráficos de Casual Sheets.');
    source=source.replace(before,after);
  };
  replace('const refresh = () => {\n      const opt = buildEChartsOption(api, model);', '// BOLD: refresh calculated values without restarting charts.\n    let disposed=false;\n    const refresh = () => {\n      if (disposed) return;\n      const opt = buildEChartsOption(api, model);');
  replace('echartRef.current?.setOption(opt, true);','echartRef.current?.setOption({...opt,animation:false}, true);');
  replace('if (!evName || typeof api.addEvent !== "function") return;\n    const disp = api.addEvent(evName, refresh);\n    return () => disp.dispose?.();', `const disp = evName && api.addEvent?.(evName, refresh);
    const formula=api.getFormula?.().calculationResultApplied?.(refresh);
    return () => {disposed=true;disp?.dispose?.();formula?.dispose?.();};`);
  replace('api, canvasOffset, drag, model, scroll, update','api, canvasOffset, model, scroll, update');
  replace(`      const dx = e.clientX - drag.startMouse.x;
      const dy = e.clientY - drag.startMouse.y;
      setDrag((cur) => {
        if (!cur) return cur;
        const next = computeDragRect(cur.mode, cur.startRect, dx, dy);
        const updated={ ...cur, current: next };
        dragRef.current=updated;
        return updated;
      });`, `      const cur=dragRef.current;
      if (!cur) return;
      const next=computeDragRect(cur.mode,cur.startRect,e.clientX-cur.startMouse.x,e.clientY-cur.startMouse.y);
      dragRef.current={...cur,current:next};
      setDrag(dragRef.current);`);
  replace('}, [drag, commitDrag]);','}, [!!drag, commitDrag]);');
  replace('if (newPos) update(model.id, { pos: newPos });\n    setDrag(null);','if (newPos) update(model.id, { pos: newPos });\n    dragRef.current=null;\n    setDrag(null);');
  return source;
}

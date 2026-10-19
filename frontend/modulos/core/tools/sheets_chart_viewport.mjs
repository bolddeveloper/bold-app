export function patchSheetChartViewport(source) {
  if (!source.includes('function ChartOverlay(')) return source;
  source=patchUniformChartZoom(source);
  if (source.includes('// BOLD: charts stay inside the cell viewport.')) return source;
  const replace=(before,after)=>{
    if (!source.includes(before)) throw Error('Cambió el área de gráficos de Casual Sheets: '+before);
    source=source.replace(before,after);
  };
  source='import {IRenderManagerService as ChartRenderManager,SHEET_VIEWPORT_KEY as ChartViewportKey} from "@univerjs/engine-render";\n'+source;
  replace('function getHeaderGutter(_api) {\n  return DEFAULT_HEADER_GUTTER;\n}', `function getHeaderGutter(api) {
  const skeleton=api.getActiveWorkbook?.()?.getActiveSheet?.()?.getSkeleton?.();
  return {rowHeaderWidth:skeleton?.rowHeaderWidthAndMarginLeft ?? DEFAULT_HEADER_GUTTER.rowHeaderWidth,
    columnHeaderHeight:skeleton?.columnHeaderHeightAndMarginTop ?? DEFAULT_HEADER_GUTTER.columnHeaderHeight};
}`);
  replace('function ChartLayer() {', `// BOLD: charts stay inside the cell viewport.
function getChartViewport(api,canvasRect,dx,dy) {
  const gutter=getHeaderGutter(api);
  let size=11;
  try {
    const book=api.getActiveWorkbook();
    const scene=api._injector?.get(ChartRenderManager).getRenderById(book.getId())?.scene;
    size=scene?.getViewport(ChartViewportKey.VIEW_MAIN)?.getScrollBar()?.totalSize ?? size;
  } catch {}
  return {left:dx+gutter.rowHeaderWidth,top:dy+gutter.columnHeaderHeight,right:Math.max(dx+gutter.rowHeaderWidth,dx+canvasRect.width-size),bottom:Math.max(dy+gutter.columnHeaderHeight,dy+canvasRect.height-size)};
}
function ChartLayer() {`);
  replace(`      if (dx !== canvasOffset.x || dy !== canvasOffset.y) {
        setCanvasOffset({ x: dx, y: dy });
      }`, `      const bounds=getChartViewport(api,canvasRect,dx,dy);
      setCanvasOffset(current=>current.x===dx && current.y===dy && Object.keys(bounds).every(key=>current.bounds?.[key]===bounds[key]) ? current : {x:dx,y:dy,bounds});`);
  replace('          zIndex: 60\n', '          zIndex: 60,\n          clipPath:canvasOffset.bounds ? `polygon(${canvasOffset.bounds.left}px ${canvasOffset.bounds.top}px,${canvasOffset.bounds.right}px ${canvasOffset.bounds.top}px,${canvasOffset.bounds.right}px ${canvasOffset.bounds.bottom}px,${canvasOffset.bounds.left}px ${canvasOffset.bounds.bottom}px)` : "inset(100%)"\n');
  replace('function computeDragRect(', `function constrainChartRect(rect,bounds) {
  if (!bounds) return rect;
  return {...rect,left:Math.max(bounds.left,Math.min(rect.left,bounds.right-rect.width)),top:Math.max(bounds.top,Math.min(rect.top,bounds.bottom-rect.height))};
}
function computeDragRect(`);
  replace('dragRef.current={...cur,current:next};','dragRef.current={...cur,current:cur.mode==="move" ? constrainChartRect(next,canvasOffset.bounds) : next};');
  replace('const next=computeDragRect(event.shiftKey ? "se" : "move",rect,direction[0]*(cell.right-cell.left)*zoom,direction[1]*(cell.bottom-cell.top)*zoom,zoom);','const moved=computeDragRect(event.shiftKey ? "se" : "move",rect,direction[0]*(cell.right-cell.left)*zoom,direction[1]*(cell.bottom-cell.top)*zoom,zoom);\n        const next=event.shiftKey ? moved : constrainChartRect(moved,canvasOffset.bounds);');
  return source;
}

function patchUniformChartZoom(source) {
  if (source.includes('// BOLD: zoom the complete chart without changing its saved geometry.')) return source;
  source=source.replace('rect: { left, top, width: right - left, height: bottom - top }','rect: { left, top, width: right - left, height: bottom - top,zoom }')
    .replace('  const api = sdkApi.univer;\n  const editable', '  // BOLD: zoom the complete chart without changing its saved geometry.\n  const zoom=rect.zoom ?? 1;\n  const api = sdkApi.univer;\n  const editable')
    .replace('width: `${liveRect.width}px`,','width: `${liveRect.width/zoom}px`,').replace('height: `${liveRect.height}px`,','height: `${liveRect.height/zoom}px`,\n        transform:`scale(${zoom})`,transformOrigin:"0 0",')
    .replace('e.clientY-cur.startMouse.y);','e.clientY-cur.startMouse.y,zoom);')
    .replace('}, [!!drag, commitDrag]);','}, [!!drag, commitDrag,zoom]);')
    .replace('function computeDragRect(mode, start, dx, dy) {','function computeDragRect(mode, start, dx, dy,zoom=1) {')
    .replaceAll('Math.max(MIN_W,','Math.max(MIN_W*zoom,').replaceAll('Math.max(MIN_H,','Math.max(MIN_H*zoom,')
    .replace('direction[1]*(cell.bottom-cell.top)*zoom);','direction[1]*(cell.bottom-cell.top)*zoom,zoom);')
    .replace('direction[0]*(cell.right-cell.left),direction[1]*(cell.bottom-cell.top));','direction[0]*(cell.right-cell.left)*zoom,direction[1]*(cell.bottom-cell.top)*zoom,zoom);');
  return source;
}

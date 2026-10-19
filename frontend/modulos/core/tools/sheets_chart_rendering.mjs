export function patchSheetCharts(source) {
  if (!source.includes('function ChartOverlay(') || source.includes('// BOLD: framed charts with isolated rendering.')) return source;
  const start=source.indexOf('function ChartOverlay('),end=source.indexOf('\nfunction computeDragRect(',start);
  if (end<0) throw Error('Cambió la capa de gráficos de Casual Sheets.');
  let overlay=source.slice(start,end);
  const state=overlay.match(/const \[drag, setDrag\] = (\w+)\(null\);/)?.[0];
  const ref=overlay.match(/const hostRef = (\w+)\(null\);/)?.[1];
  const jsx=overlay.match(/return \/\* @__PURE__ \*\/ (\w+)\(/)?.[1];
  if (!state || !ref || !jsx) throw Error('Cambiaron los imports del gráfico de Casual Sheets.');
  const replace=(before,after)=>{
    if (!overlay.includes(before)) throw Error('Cambió un control del gráfico: '+before);
    overlay=overlay.replace(before,after);
  };
  replace('const api = sdkApi.univer;', 'const api = sdkApi.univer;\n  const editable = sdkApi.getDocumentMode() === "editing";');
  replace(state,state+`\n  const dragRef=${ref}(null); dragRef.current=drag;`);
  replace('if (!drag || !api) return;','const drag=dragRef.current;\n    if (!drag || !api) return;');
  replace('endColumn: model.pos.endColumn\n    });','endColumn: model.pos.endColumn\n    }, ws._worksheet?.getZoomRatio?.() ?? ws.getZoomRatio?.() ?? 1, getHeaderGutter(api));');
  replace('return { ...cur, current: next };','const updated={ ...cur, current: next };\n        dragRef.current=updated;\n        return updated;');
  replace('const onUp = () => commitDrag();','const onUp = () => commitDrag();\n    const onCancel=()=>{dragRef.current=null;setDrag(null);};');
  overlay=overlay.replaceAll('"pointercancel", onUp','"pointercancel", onCancel');
  overlay=overlay.replaceAll('if (e.button !== 0) return;','if (e.button !== 0 || !editable) return;');
  replace('ref: hostRef,\n      className:', 'role: "group", tabIndex: 0, "aria-label": "Gráfico "+(model.title || "sin título")+". Flechas para mover; Mayús y flechas para cambiar tamaño.",\n      className:');
  replace('onPointerDown: onBodyPointerDown,',`onPointerDown: onBodyPointerDown,
      onKeyDown: event => {
        const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
        if (!editable || !direction || event.target!==event.currentTarget) return;
        event.preventDefault();event.stopPropagation();
        const ws=api.getActiveWorkbook()?.getSheets().find(sheet=>sheet.getSheetId()===model.sheetId);
        if (!ws) return;
        const cell=ws.getRange(model.pos.startRow,model.pos.startColumn).getCellRect(),zoom=ws._worksheet?.getZoomRatio?.() ?? ws.getZoomRatio?.() ?? 1;
        const next=computeDragRect(event.shiftKey ? "se" : "move",rect,direction[0]*(cell.right-cell.left)*zoom,direction[1]*(cell.bottom-cell.top)*zoom);
        update(model.id,{pos:rectToCellPos(ws,next,canvasOffset,scroll,model.pos,ws._worksheet?.getZoomRatio?.() ?? ws.getZoomRatio?.() ?? 1,getHeaderGutter(api))});
      },`);
  replace('children: isSelected && ALL_HANDLES.map((h)', `children: [${jsx}("div", {ref:hostRef,className:"chart-overlay__plot"}, "plot"), ...(isSelected && editable ? ALL_HANDLES.map((h)`);
  replace('      ))\n    }','      )) : [])]\n    }');
  let next=source.slice(0,start)+'// BOLD: framed charts with isolated rendering.\n'+overlay+source.slice(end);
  const replaceSource=(before,after)=>{
    if (!next.includes(before)) throw Error('Cambió el cálculo de gráficos de Casual Sheets.');
    next=next.replace(before,after);
  };
  replaceSource('function rectToCellPos(sheet, screenRect, canvasOffset, scroll, hint) {', 'function rectToCellPos(sheet, screenRect, canvasOffset, scroll, hint, zoom=1, gutter={}) {');
  replaceSource('screenRect.left - canvasOffset.x + scroll.x','(screenRect.left - canvasOffset.x - (gutter.rowHeaderWidth || 0)) / zoom + scroll.x');
  replaceSource('screenRect.top - canvasOffset.y + scroll.y','(screenRect.top - canvasOffset.y - (gutter.columnHeaderHeight || 0)) / zoom + scroll.y');
  replaceSource('preLeft + screenRect.width','preLeft + screenRect.width / zoom');
  replaceSource('preTop + screenRect.height','preTop + screenRect.height / zoom');
  replaceSource('const n = typeof v === "number" ? v : Number(v);','const n = v == null || typeof v === "boolean" || typeof v === "string" && !v.trim() ? NaN : Number(v);');
  next=next.replaceAll('v == null ? `Series ${c}` : String(v)','v == null || !String(v).trim() ? `Serie ${c}` : String(v)');
  replaceSource('const legendNode = legendOption(format);','const legendNode = legendOption(format, titleNode != null);');
  replaceSource('function legendOption(format) {','function legendOption(format, hasTitle=false) {');
  replaceSource('pos.top = 0;', 'pos.top = hasTitle ? 30 : 0;');
  replaceSource('pos.right = 0;', 'pos.right = 8; pos.top=hasTitle ? 36 : 12; pos.width=112;');
  replaceSource('pos.left = 0;', 'pos.left = 8; pos.top=hasTitle ? 36 : 12; pos.width=112;');
  replaceSource('grid.left = 96;', 'grid.left = 144;');
  replaceSource('grid.right = hasSecondaryAxis ? 128 : 96;', 'grid.right = hasSecondaryAxis ? 184 : 144;');
  replaceSource('containLabel: true','outerBoundsMode: "same", outerBoundsContain: "all"');
  replaceSource('MIN_W = 80;', 'MIN_W = 240;');
  replaceSource('MIN_H = 60;', 'MIN_H = 180;');
  return next;
}

const marker='// BOLD managed multiple selectors use the same capsule as single selectors.';
const rendering=`
${marker}
for (const method of ['drawWith','calcCellAutoHeight','calcCellAutoWidth','isHit']) {
  const original=DropdownMultipleWidget.prototype[method];
  DropdownMultipleWidget.prototype[method]=function(...args) {
    const index=method==='drawWith' || method==='isHit' ? 1 : 0;
    const info=args[index];
    const rule=this._dataValidationModel.getRuleByLocation(info.unitId,info.subUnitId,info.row,info.col);
    if (!rule?.uid?.startsWith('bold-validation-') || rule.renderMode!==DataValidationRenderMode.CUSTOM) return original.apply(this,args);
    if (method!=='isHit') {
      const validator=this._dataValidationModel.getValidator(rule.type);
      const value=validator.parseCellValue(getCellValueOrigin(info.data) ?? '').join(', ');
      args[index]={...info,data:{...info.data,v:value,p:undefined,si:undefined}};
    }
    return DropdownWidget.prototype[method].apply(this,args);
  };
}
`;

export function patchSheetSelectorRendering(source) {
  if (source.includes(marker)) return source;
  if (!source.includes('let DropdownMultipleWidget = class') || !source.includes('let DropdownWidget = class')) throw Error('Revisar el renderizador de listas antes de actualizar Univer.');
  return source+rendering;
}

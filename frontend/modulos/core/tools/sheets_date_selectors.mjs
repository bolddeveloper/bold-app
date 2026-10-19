export function patchSheetDateRendering(source) {
  if (source.includes('// BOLD: date cells use dropdown capsules.')) return source;
  const replacements=[
    ['_defineProperty(this, "id", DataValidationType.DATE);','_defineProperty(this, "id", DataValidationType.DATE);\n\t\tthis.canvasRender = this.injector.createInstance(DropdownWidget);'],
    ['validator.id.indexOf(DataValidationType.LIST) !== 0) return;', 'validator.id.indexOf(DataValidationType.LIST) !== 0 && !(rule.type === DataValidationType.DATE && rule.uid?.startsWith("bold-validation-"))) return;'],
    ['const colorMap = validator.getListWithColorMap(rule);','const colorMap = validator.getListWithColorMap?.(rule) || {};'],
    ['const valueStr = `${value !== null && value !== void 0 ? value : ""}`;', 'const valueStr = rule.type === DataValidationType.DATE && typeof value === "number" && Number.isFinite(value) ? new Date(Date.UTC(1899,11,30)+value*86400000).toISOString().slice(0,10) : `${value ?? ""}`;'],
  ];
  for (const [target,replacement] of replacements) {
    if (!source.includes(target)) throw Error('Cambió el renderizador del calendario de Univer.');
    source=source.replace(target,replacement);
  }
  return '// BOLD: date cells use dropdown capsules.\n'+source;
}

export function patchSheetDateValidator(source) {
  if (source.includes('// BOLD: managed date capsule owns its text.')) return source;
  const target='_defineProperty(this, "id", DataValidationType.DATE);';
  if (!source.includes(target)) throw Error('Cambió el validador de fechas de Univer.');
  return '// BOLD: managed date capsule owns its text.\n'+source.replace(target,target+'\n\t\tthis.skipDefaultFontRender = rule => !!rule.uid?.startsWith("bold-validation-");');
}

export function patchSheetDropdownState(source) {
  if (source.includes('// BOLD: dropdown state follows its cell.')) return source;
  const list='const [localValue, setLocalValue] = useState(defaultValue);';
  const date='const [localDate, setLocalDate] = useState(defaultValue);';
  if (!source.includes(list) || !source.includes(date)) throw Error('Cambió el estado de los selectores de Univer.');
  return '// BOLD: dropdown state follows its cell.\n'+source
    .replace(list,list+'\n\tuseEffect(() => setLocalValue(defaultValue), [defaultValue, location.unitId, location.subUnitId, location.row, location.col]);')
    .replace(date,date+'\n\tuseEffect(() => setLocalDate(defaultValue), [defaultValue, extraProps.location?.unitId, extraProps.location?.subUnitId, extraProps.location?.row, extraProps.location?.col]);');
}

export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

export function textStyle(style) {
  if (!style || typeof style !== 'object') return style;
  const next = {...style};
  // Older imports stored decorations as numbers; Univer expects ITextDecoration.
  for (const key of ['ul', 'st', 'ol']) if (typeof next[key] === 'number' || typeof next[key] === 'boolean') next[key] = {s: +!!next[key]};
  return next;
}

export function sameTextStyle(left, right) {
  const comparable = style => {
    const next = textStyle(style);
    if (!next || typeof next !== 'object') return next;
    for (const key of ['ul', 'st', 'ol']) if (next[key] && typeof next[key] === 'object') {
      next[key] = {...next[key]};
      // The engine fills inherited colors; that does not change the saved format.
      if (next[key].c !== 0) {delete next[key].c; delete next[key].cl;}
    }
    return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  };
  return JSON.stringify(canonical(comparable(left))) === JSON.stringify(canonical(comparable(right)));
}

export function prepareTextStyles(document) {
  for (const [id, style] of Object.entries(document.styles || {})) document.styles[id] = textStyle(style);
  for (const sheet of Object.values(document.sheets)) {
    if (sheet.defaultStyle) sheet.defaultStyle = textStyle(sheet.defaultStyle);
    for (const item of [...Object.values(sheet.rowData || {}), ...Object.values(sheet.columnData || {})]) if (item.s) item.s = textStyle(item.s);
    for (const row of Object.values(sheet.cellData || {})) for (const item of Object.values(row)) {
      if (!item) continue;
      if (item.s) item.s = textStyle(item.s);
      for (const run of item.p?.body?.textRuns || []) if (run.ts) run.ts = textStyle(run.ts);
    }
  }
  for (const resource of document.resources || []) {
    if (!['SHEET_CONDITIONAL_FORMATTING_PLUGIN', 'SHEET_RANGE_THEME_MODEL_PLUGIN'].includes(resource.name)) continue;
    const data = JSON.parse(resource.data || '{}');
    if (resource.name === 'SHEET_CONDITIONAL_FORMATTING_PLUGIN') {
      for (const rules of Object.values(data)) for (const item of rules) if (item.rule?.style) item.rule.style = textStyle(item.rule.style);
    } else {
      for (const theme of Object.values(data.rangeThemeStyleMapJson || {})) for (const [key, style] of Object.entries(theme)) if (key.endsWith('Style')) theme[key] = textStyle(style);
    }
    resource.data = JSON.stringify(data);
  }
  return document;
}

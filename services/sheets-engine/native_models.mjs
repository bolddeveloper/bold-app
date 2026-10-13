const CHART_TYPES = {column:'Col', 'column-stacked':'ColStacked', 'column-stacked-100':'ColPercentStacked', bar:'Bar', 'bar-stacked':'BarStacked', 'bar-stacked-100':'BarPercentStacked', line:'Line', 'line-stacked':'LineStacked', area:'Area', 'area-stacked':'AreaStacked', pie:'Pie', doughnut:'Doughnut', scatter:'Scatter'};
// Match Casual Sheets' Apache-2.0 chart palettes in native Excel series.
const palettes={office:['5B9BD5','ED7D31','A5A5A5','FFC000','4472C4','70AD47','264478','9E480E'],mono:['1F77B4','3F8FBC','5FA7C5','7FBFCD','9FD7D6','BFEFDE','5A8DAA','3D6E89'],vivid:['E63946','F1A208','06A77D','005F73','9B5DE5','F15BB5','00BBF9','00F5D4'],pastel:['A3CEF1','FFD6A5','CAFFBF','FFADAD','BDB2FF','FDFFB6','FFC6FF','9BF6FF']};
export const columnName = index => {
  let result = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
};
const address = (row, column) => `$${columnName(column)}$${row + 1}`;
const quote = name => "'" + name.replace(/'/g, "''") + "'!";
const range = value => {
  if (!value || !['startRow','endRow','startColumn','endColumn'].every(key => Number.isInteger(value[key])) || value.startRow < 0 || value.endRow >= 20000 || value.startColumn < 0 || value.endColumn >= 500 || value.endRow < value.startRow || value.endColumn < value.startColumn) throw Error('Rango de gráfico o tabla dinámica inválido.');
  return value;
};
const sheet = (document, id) => {
  if (!document.sheets[id]) throw Error('El gráfico o tabla dinámica apunta a una hoja eliminada.');
  return document.sheets[id];
};
export function readModels(document, name, key) {
  const resource = document.resources?.find(item => item.name === name);
  const models = resource ? JSON.parse(resource.data)[key] : [];
  if (!Array.isArray(models) || models.length > 100 || new Set(models.map(item => item.id)).size !== models.length) throw Error('Colección de gráficos o tablas dinámicas inválida.');
  return models;
}
export function nativeChart(document, model, excelize) {
  const source = range(model.source), pos = range(model.pos), current = sheet(document, model.sheetId);
  if (source.endRow <= source.startRow || source.endColumn <= source.startColumn || !CHART_TYPES[model.type]) throw Error('Tipo o datos de gráfico inválidos.');
  const format = model.format || {}, prefix = quote(current.name), groups = new Map();
  for (let column = source.startColumn + 1; column <= source.endColumn; column++) {
    if (['pie','doughnut'].includes(model.type) && column > source.startColumn + 1) break;
    const label = String(current.cellData?.[source.startRow]?.[column]?.v || columnName(column));
    const kind = format.seriesTypes?.[label] === 'line' ? 'Line' : format.seriesTypes?.[label] === 'bar' ? model.type.startsWith('bar') ? 'Bar' : 'Col' : CHART_TYPES[model.type];
    const secondary = !!format.secondaryAxis?.[label], key = kind + ':' + secondary;
    if (!groups.has(key)) groups.set(key, {kind, secondary, series:[]});
    const color = format.seriesColors?.[label] || '#' + (palettes[format.palette || 'office'] || palettes.office)[(column-source.startColumn-1)%8];
    if (!/^#[\da-f]{6}$/i.test(color)) throw Error('Color de gráfico inválido.');
    const fill={Type:'pattern',Pattern:1,Color:[color.slice(1)]};
    groups.get(key).series.push({Name:prefix + address(source.startRow,column), Categories:prefix + address(source.startRow + 1,source.startColumn) + ':' + address(source.endRow,source.startColumn), Values:prefix + address(source.startRow + 1,column) + ':' + address(source.endRow,column),Fill:fill,Line:{Fill:fill,Width:2},...(['pie','doughnut'].includes(model.type)?{DataPoint:Array.from({length:source.endRow-source.startRow},(_,index)=>({Index:index,Fill:{Type:'pattern',Pattern:1,Color:[(palettes[format.palette || 'office'] || palettes.office)[index%8]]}}))}:{})});
  }
  if (groups.size > 2) throw Error('Excel admite aquí dos grupos de series. Reduce la combinación de tipos y ejes antes de exportar.');
  const height = Math.max(180, Math.min(1200, (pos.endRow - pos.startRow + 1) * 24)), width = Math.max(300, Math.min(1600, (pos.endColumn - pos.startColumn + 1) * 80));
  const charts = [...groups.values()].map(group => ({Type:excelize[group.kind], Series:group.series,
    Title:{Paragraph:format.showTitle === false || !model.title ? [] : [{Text:String(model.title).slice(0,255)}]},
    Legend:{Position:format.legend === 'none' ? 'none' : format.legend || 'bottom'},
    Dimension:{Width:width,Height:height}, Format:{AltText:'BOLD ' + model.id},
    XAxis:{Title:{Paragraph:format.xAxisTitle ? [{Text:format.xAxisTitle}] : []}},
    YAxis:{Secondary:group.secondary, MajorGridLines:format.gridlines !== false, Title:{Paragraph:format.yAxisTitle ? [{Text:format.yAxisTitle}] : []}},
    PlotArea:{ShowVal:!!format.dataLabels}, HoleSize:60
  }));
  return {sheet:current.name, anchor:columnName(pos.startColumn) + (pos.startRow + 1), charts, trendline:!!format.trendline};
}
export function nativePivot(document, model, excelize) {
  const source = range(model.source), current = sheet(document, model.sourceSheetId), destination = sheet(document, model.targetSheetId);
  if (!model.target || !Number.isInteger(model.target.row) || !Number.isInteger(model.target.column)) throw Error('Destino de tabla dinámica inválido.');
  const target = range({startRow:model.target.row,endRow:model.target.row,startColumn:model.target.column,endColumn:model.target.column});
  const fields = Array.from({length:source.endColumn-source.startColumn+1}, (_,index) => String(current.cellData?.[source.startRow]?.[source.startColumn+index]?.v || ''));
  if (fields.some(value => !value) || new Set(fields).size !== fields.length) throw Error('Los encabezados de una tabla dinámica deben existir y ser distintos.');
  const field = index => {
    if (!Number.isInteger(index) || index < 0 || index >= fields.length) throw Error('Campo de tabla dinámica inválido.');
    return fields[index];
  };
  const aggregation = {sum:'Sum',count:'Count',average:'Average',min:'Min',max:'Max'};
  const showAs = {normal:'PivotTableShowValuesAsNoCalculation',pctOfGrandTotal:'PivotTableShowValuesAsPercentOfGrandTotal',pctOfColumnTotal:'PivotTableShowValuesAsPercentOfColumnTotal',pctOfRowTotal:'PivotTableShowValuesAsPercentOfRowTotal'};
  const dimensions = values => (values || []).map(item => {
    if (item.grouping && item.grouping !== 'none') throw Error('La agrupación de fechas se conserva en BOLD; desactívala para exportar esta tabla dinámica nativa.');
    const filter=model.filters?.find(filter=>filter.column===item.column);
    return {Data:field(item.column),...(filter?{SelectedItems:filter.allowedValues.map(String)}:{})};
  });
  const data = (model.values || []).map((item,index) => {
    if (!aggregation[item.agg] || !showAs[item.showAs || 'normal']) throw Error('Esta agregación de tabla dinámica no tiene equivalente nativo en el exportador.');
    return {Data:field(item.column),Name:`${aggregation[item.agg]} ${field(item.column)} ${index+1}`,Subtotal:aggregation[item.agg],ShowValuesAs:{Type:excelize[showAs[item.showAs || 'normal']]}};
  });
  if (!data.length) throw Error('La tabla dinámica necesita al menos un valor.');
  const rows = Math.max(3, Number(model.lastOutputExtent?.rows) || 10), columns = Math.max(2, Number(model.lastOutputExtent?.cols) || data.length + 1);
  if (target.startRow+rows >= 20000 || target.startColumn+columns >= 500) throw Error('La tabla dinámica excede el tamaño de la hoja.');
  return {Name:'BoldPivot_' + String(model.id).replace(/[^\da-z]/gi,'').slice(0,50),
    DataRange:quote(current.name)+address(source.startRow,source.startColumn)+':'+address(source.endRow,source.endColumn),
    PivotTableRange:quote(destination.name)+address(target.startRow,target.startColumn)+':'+address(target.startRow+rows-1,target.startColumn+columns-1),
    Rows:dimensions(model.rows),Columns:dimensions(model.cols),Data:data,
    Filter:(model.filters || []).filter(item=>![...(model.rows || []),...(model.cols || [])].some(field=>field.column===item.column)).map(item=>({Data:field(item.column),SelectedItems:item.allowedValues.map(String)})),
    RowGrandTotals:true,ColGrandTotals:true,ShowDrill:true,PivotTableStyleName:'PivotStyleMedium9'};
}

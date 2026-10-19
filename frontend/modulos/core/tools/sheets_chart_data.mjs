export function patchSheetChartData(source) {
  if (!source.includes('function buildEChartsOption(') || source.includes('// BOLD: omit empty records and nonnumeric series.')) return source;
  const target='  const format = mergeFormat(model);\n  const dates = detectDateCategories(categories);';
  if (!source.includes(target)) throw Error('Cambió la lectura de datos de gráficos de Casual Sheets.');
  return source.replace(target,`  // BOLD: omit empty records and nonnumeric series.
  if (!["scatter","pie","doughnut"].includes(model.type)) for (let index=headers.length-1;index>=0;index--) {
    if (seriesData[index].every(value=>value==null)) {headers.splice(index,1);seriesData.splice(index,1);}
  }
  for (let row=categories.length-1;row>=0;row--) if (!categories[row].trim() && seriesData.every(values=>values[row]==null)) {
    categories.splice(row,1);seriesData.forEach(values=>values.splice(row,1));
  }
  if (!seriesData.some(values=>values.some(value=>value!=null))) return {title:{text:"Sin datos numéricos en el rango",left:"center",top:"center",textStyle:{fontSize:14}}};
  const format = mergeFormat(model);
  const dates = detectDateCategories(categories);`);
}

export function pivotSummary(sheet,source,group,value,aggregation) {
  const headers=Array.from({length:source.endColumn-source.startColumn+1},(_,index)=>String(sheet.cellData?.[source.startRow]?.[source.startColumn+index]?.v ?? ''));
  if(headers.some(item=>!item) || new Set(headers).size!==headers.length) throw Error('Selecciona una tabla con encabezados distintos.');
  if(!Number.isInteger(group) || !Number.isInteger(value) || !headers[group] || !headers[value] || !['sum','count','average','min','max'].includes(aggregation)) throw Error('Selecciona campos y cálculo válidos.');
  const groups=new Map();
  for(let row=source.startRow+1;row<=source.endRow;row++) {
    const key=String(sheet.cellData?.[row]?.[source.startColumn+group]?.v ?? '');
    if(!groups.has(key)) groups.set(key,{numbers:[],count:0});
    const bucket=groups.get(key), raw=sheet.cellData?.[row]?.[source.startColumn+value]?.v;
    if(raw!==null && raw!==undefined && raw!=='') {
      bucket.count++;
      if(typeof raw==='number' && Number.isFinite(raw)) bucket.numbers.push(raw);
    }
  }
  const labels={sum:'Suma',count:'Conteo',average:'Promedio',min:'Mínimo',max:'Máximo'};
  return [[headers[group],labels[aggregation]+' de '+headers[value]],...[...groups].map(([key,bucket])=>{
    const sum=bucket.numbers.reduce((total,item)=>total+item,0), numbers=bucket.numbers;
    return [key,aggregation==='count'?bucket.count:!numbers.length?0:aggregation==='sum'?sum:aggregation==='average'?sum/numbers.length:aggregation==='min'?Math.min(...numbers):Math.max(...numbers)];
  })];
}

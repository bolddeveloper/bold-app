import {useMemo} from 'react';
import {buildChartOption} from '@casualoffice/sheets/sheets';
import {init,use} from 'echarts/core';
import {SVGRenderer} from 'echarts/renderers';
use([SVGRenderer]);
export function ChartExample({type}) {
  const svg=useMemo(()=>{
    const cells=[['Producto','Precio','Licencias'],['A',12,8],['B',35,21],['C',18,12],['D',62,32],['E',47,24]];
    const api={getActiveWorkbook:()=>({getSheets:()=>[{getSheetId:()=> 'preview',getRange:(row,column)=>({getValue:()=>cells[row]?.[column]})}]})};
    const option=buildChartOption(api,{sheetId:'preview',type,source:{startRow:0,endRow:5,startColumn:0,endColumn:2},format:{legend:'none',showTitle:false}});
    option.grid={left:28,right:12,top:12,bottom:24};
    const chart=init(null,null,{renderer:'svg',ssr:true,width:360,height:210});
    try {chart.setOption(option);return chart.renderToSVGString();} finally {chart.dispose();}
  },[type]);
  return <span className="sheets_chart_thumbnail" aria-hidden="true" dangerouslySetInnerHTML={{__html:svg}}/>;
}

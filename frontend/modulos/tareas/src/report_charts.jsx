import {useId} from 'react';
import {chartRows,reportNumber} from './reports_data.js';

export default function ReportChart({result,onGroup,selectedGroup}){
    const id=useId(),rows=chartRows(result),kind=result.definition.visualization;
    const maximum=Math.max(1,...rows.map(row=>Number(row.value)||0));
    const unit=result.unit;
    if(!rows.length)return <div className="report_empty"><h3>No hay registros para este conjunto</h3><p>Amplía las fechas o revisa los filtros y permisos. La ausencia de datos no representa un tiempo de cero horas.</p></div>;
    if(kind==='number')return <div className="report_number"><output>{reportNumber(result.summary.value,unit)}</output><p>{result.label}</p></div>;
    if(kind==='table')return <GroupTable rows={rows} unit={unit} onGroup={onGroup} selectedGroup={selectedGroup}/>;
    if(kind==='line'){
        const x=index=>42+index*674/Math.max(1,rows.length-1),y=value=>180-Number(value)/maximum*150;
        let continuing=false;const path=rows.map((row,index)=>{if(row.value===null){continuing=false;return '';}const command=continuing?'L':'M';continuing=true;return `${command}${x(index)},${y(row.value)}`;}).join(' ');
        return <><svg className="report_line" viewBox="0 0 760 220" role="img" aria-labelledby={id}><title id={id}>{result.label}. Los valores por fecha aparecen en la tabla siguiente.</title>{[0,.5,1].map(fraction=><g key={fraction}><line x1="42" x2="716" y1={y(maximum*fraction)} y2={y(maximum*fraction)} className="report_axis"/><text x="36" y={y(maximum*fraction)+4} textAnchor="end">{reportNumber(maximum*fraction,unit)}</text></g>)}<path d={path} className="report_line_path"/>{rows.filter(row=>row.value!==null).length<60&&rows.map((row,index)=>row.value===null?null:<circle key={row.key} cx={x(index)} cy={y(row.value)} r="3" className="report_point"/>)}<text x="42" y="208">{rows[0]?.label}</text><text x="716" y="208" textAnchor="end">{rows.at(-1)?.label}</text></svg><GroupTable rows={rows} unit={unit} onGroup={onGroup} selectedGroup={selectedGroup}/></>;
    }
    if(kind==='distribution'){
        const total=rows.reduce((sum,row)=>sum+(Number(row.value)||0),0);
        return <><div className="report_distribution" aria-hidden="true">{rows.map((row,index)=><span key={row.key} style={{flexGrow:Number(row.value)||0,background:`color-mix(in srgb,var(--bold_red) ${Math.max(18,100-index*12)}%,var(--bold_surface_soft))`}}/>)}</div><p>Distribución de {reportNumber(total,unit)} · selecciona una fila para consultar su origen.</p><GroupTable rows={rows} unit={unit} onGroup={onGroup} selectedGroup={selectedGroup}/></>;
    }
    return <div className="report_bars" role="group" aria-label={result.label}>{rows.map(row=><button type="button" key={row.key} className={selectedGroup===row.key?'is_selected':''} onClick={()=>onGroup(row.key)} aria-pressed={selectedGroup===row.key}><span className="report_bar_label">{row.label}</span><span className="report_bar_track" aria-hidden="true"><i style={{width:`${Math.max(0,(Number(row.value)||0)/maximum*100)}%`}}/></span><strong>{reportNumber(row.value,unit)}</strong></button>)}</div>;
}

function GroupTable({rows,unit,onGroup,selectedGroup}){return <div className="report_table_scroll"><table className="report_group_table"><caption>Valores del gráfico y acceso a sus registros</caption><thead><tr><th scope="col">Grupo</th><th scope="col">Resultado</th><th scope="col">Casos conocidos</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th scope="row"><button type="button" aria-pressed={selectedGroup===row.key} onClick={()=>onGroup(row.key)}>{row.label}</button></th><td>{reportNumber(row.value,unit)}</td><td>{row.sample_size}</td></tr>)}</tbody></table></div>;}

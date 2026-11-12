export const reportGroups=[['none','Sin agrupar'],['day','Día'],['week','Semana'],['month','Mes'],['project','Proyecto'],['department','Departamento'],['employee','Empleado'],['status','Estado'],['phase','Etapa']].map(([value,label])=>({value,label}));
export const reportVisuals=[['number','Indicador'],['bar','Barras'],['line','Línea temporal'],['distribution','Distribución'],['table','Tabla']].map(([value,label])=>({value,label}));
export const basisLabels={created:'Fecha de creación',completed:'Fecha real de finalización',due:'Fecha objetivo',activity:'Trabajo abierto o actividad en el período',start:'Horario de la reunión'};
export function reportKey(value){
    if(Array.isArray(value))return `[${value.map(reportKey).join(',')}]`;
    if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${reportKey(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
export function newReportDefinition(now=new Date()){
    const day=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const start=new Date(now);start.setDate(start.getDate()-29);
    return {metric:'tasks.completed',group_by:'week',visualization:'bar',date_basis:'completed',from:day(start),to:day(now),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,filters:{},scope:'accessible',include_subtasks:false};
}
export function metricDefaults(metric,definition){
    const source=metric.split('.')[0],date_basis=source==='meetings'?'start':metric.endsWith('completed')||metric.endsWith('lead_hours')||metric.endsWith('on_time')||metric.endsWith('cycle_hours')?'completed':source==='projects'?'created':'activity';
    return {...definition,metric,date_basis,scope:source==='meetings'?'accessible':definition.scope,
        group_by:source==='meetings'&&!['none','day','week','month','project'].includes(definition.group_by)||source!=='phases'&&definition.group_by==='phase'?'week':definition.group_by,
        filters:Object.fromEntries(Object.entries(definition.filters||{}).filter(([key])=>source==='meetings'?['tasks','projects','calendars'].includes(key):key!=='calendars'&&(source==='phases'||!['phases','phase_states'].includes(key))))};
}
export function reportNumber(value,unit='count'){
    if(value===null||value===undefined||!Number.isFinite(Number(value)))return 'Sin datos';
    return `${new Intl.NumberFormat('es',{maximumFractionDigits:unit==='count'?0:2}).format(Number(value))}${unit==='percent'?' %':unit==='hours'?' h':''}`;
}
export function chartRows(result){
    const definition=result.definition,groups=result.groups||[],kind=definition.group_by;
    if(!['day','week','month'].includes(kind))return [...groups].sort((a,b)=>a.label.localeCompare(b.label,'es'));
    const current=new Date(`${definition.from}T12:00:00Z`),end=new Date(`${definition.to}T12:00:00Z`);
    if(kind==='week')current.setUTCDate(current.getUTCDate()-(current.getUTCDay()+6)%7);
    if(kind==='month')current.setUTCDate(1);
    const byKey=new Map(groups.map(row=>[row.key,row])),rows=[];
    while(current<=end&&rows.length<370){const key=current.toISOString().slice(0,10);rows.push(byKey.get(key)||{key,label:key,value:result.unit==='count'?0:null,sample_size:0});if(kind==='month')current.setUTCMonth(current.getUTCMonth()+1);else current.setUTCDate(current.getUTCDate()+(kind==='week'?7:1));}
    return rows;
}

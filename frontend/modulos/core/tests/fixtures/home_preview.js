export function homePreviewData(now = new Date()) {
    const date = offset => {const value=new Date(now);value.setDate(value.getDate()+offset);return value;};
    const tasks=Array.from({length:24},(_,index)=>({id:`task-${index}`,title:["Preparar propuesta de campaña","Revisar piezas de producción","Actualizar el calendario editorial","Compartir resultados del proyecto"][index%4],assignee_id:"home-preview",due:date(index%7-2),priority:["Alta","Media","Baja"][index%3],project_id:`p${index%3}`,completed:index%3===0,statusCategory:index%3===0?"completed":index%2===0?"in_progress":"pending"}));
    const projects=[{id:"p0",label:"Campaña de crecimiento",color:"#e73535"},{id:"p1",label:"Producción audiovisual",color:"#568de5"},{id:"p2",label:"Experiencia BOLD",color:"#20a77b"}];
    const meetings=[0,40,100,160].map((offset,index)=>{const start=new Date(now.getTime()+offset*60000),end=new Date(start.getTime()+30*60000);return {id:`event-${index}`,summary:["Revisión de diseño","Plan de producción","Seguimiento de campaña","Cierre del día"][index],calendar_name:index%2?"Producción":"Equipo BOLD",start:{dateTime:start.toISOString()},end:{dateTime:end.toISOString()},hangoutLink:index===0?"https://meet.google.com/abc-defg-hij":""};});
    return {tasks,projects,meetings};
}

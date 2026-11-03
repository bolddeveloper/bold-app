import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {NotificationPanel} from "../../notification_panel.jsx";
import "../../../tareas/src/styles.css";
import "../../app_shell.css";
import "../../design_v3.css";
import "../../workspace_v3.css";
const now=Date.now();
const avatar="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#7a3d70"/><text x="20" y="25" text-anchor="middle" fill="white" font-family="Arial" font-size="16">AL</text></svg>');
function Preview(){
 const [rows,setRows]=useState([
  {id:'mention',title:'Te mencionaron en un comentario',actor_name:'Alex López',actor_avatar_url:avatar,type:'comment.mentioned',task:'sample',body:'Alex López en “Revisar propuesta”: @equipo ¿podemos revisar esta entrega?',created_at:new Date(now-3*60000).toISOString(),is_read:false},
  {id:'assigned',title:'Te asignó una tarea',actor_name:'María Pérez',type:'task.assigned',body:'Preparar la presentación de la próxima campaña.',created_at:new Date(now-26*60000).toISOString(),is_read:false},
  {id:'system',title:'Recordatorio de calendario',type:'calendar.reminder',body:'La reunión de producción comienza en 15 minutos.',created_at:new Date(now-3600000).toISOString(),is_read:true},
 ]),[action,setAction]=useState('');
 const dark=new URLSearchParams(location.search).get('theme')!=='light';
 return <div className={`app_shell bold_v3${dark?' theme_dark':''}`} style={{display:'block',minHeight:'100dvh',background:'var(--bold_canvas)',color:'var(--bold_text)'}}>
 <div className="notification_surface" style={{position:'absolute',top:24,right:0}}><NotificationPanel notifications={rows} onClose={()=>setAction('Cerrado')} onSelect={item=>setAction(`Abierto: ${item.id}`)} onSettings={()=>setAction('Configuración')} onRead={async(id,is_read)=>setRows(current=>current.map(row=>row.id===id?{...row,is_read}:row))} onReadAll={async()=>setRows(current=>current.map(row=>({...row,is_read:true})))} onDismiss={async id=>setRows(current=>current.filter(row=>row.id!==id))} onClear={async()=>setRows([])}/></div><output style={{position:'fixed',bottom:0,left:0}}>{action}</output></div>;
}
createRoot(document.getElementById('root')).render(<Preview/>);

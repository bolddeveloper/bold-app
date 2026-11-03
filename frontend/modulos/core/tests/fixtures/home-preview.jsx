import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import HomeModule from "../../../tareas/src/home_module.jsx";
import {homePreviewData} from "./home_preview.js";
import "../../../tareas/src/styles.css";
import "../../app_shell.css";
import "../../design_v3.css";
import "../../workspace_v3.css";
import "../../motion_v3.css";
const data=homePreviewData();
globalThis.__homeCore={account:{id:"home-preview"},activeAssignment:{id:"home-preview"},authorizationRevision:1,securityUncertain:false};
globalThis.__homeShell={navigation_items:[{id:"calendar",label:"Calendario"},{id:"inbox",label:"Bandeja de entrada"},{id:"reports",label:"Reportes"}]};
globalThis.__homeCalendar={connection:async()=>({connected:true}),events:async()=>({events:[]})};
globalThis.__homeLocal={agenda:async()=>({events:data.meetings})};
document.documentElement.classList.toggle("theme_dark",new URLSearchParams(location.search).get("theme")!=="light");
function Preview(){
 const [tasks,setTasks]=useState(data.tasks),[action,setAction]=useState("");
 return <div className="bold_v3" style={{display:"block",minHeight:"100dvh"}}><header style={{height:44,padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid var(--bold_line)"}}><strong style={{fontSize:12}}>BOLD · Datos de prueba</strong><button type="button" style={{fontSize:12,background:"none",border:0,color:"var(--bold_muted)"}} onClick={()=>document.documentElement.classList.toggle("theme_dark")}>Cambiar tema</button></header><HomeModule currentUser={{id:"home-preview"}} tasks={tasks} projects={data.projects} notifications={[]} parseDueDate={task=>task.due} onCreateTask={()=>setAction("Crear tarea")} onCreateProject={()=>setAction("Crear proyecto")} onNavigate={setAction} onOpenTasks={()=>setAction("Mis tareas")} onOpenTask={id=>setAction(`Abrir ${id}`)} onOpenProject={id=>setAction(`Proyecto ${id}`)} onToggleTask={id=>setTasks(items=>items.map(row=>row.id===id?{...row,completed:true}:row))}/><output style={{fontSize:12,padding:16}}>{action}</output></div>;
}
createRoot(document.getElementById("root")).render(<Preview/>);

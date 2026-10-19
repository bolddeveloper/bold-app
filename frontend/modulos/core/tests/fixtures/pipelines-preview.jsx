import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {CoreContext} from "../../core_provider.jsx";
import {render_tasks_module} from "../../../tareas/src/task_app.jsx";
import {useTeamSharing} from "../../../tareas/src/team.jsx";
import {PipelineFields,TaskPipelineState} from "../../../tareas/src/pipelines.jsx";
import "../../../tareas/src/styles.css";
import "../../../administrativo/admin.css";
import "../../../tareas/src/tasks_mobile.css";
import "../../app_shell.css";
const projects=[{id:'project-a',label:'Proyecto comercial con un nombre largo'},{id:'project-b',label:'Proyecto B'}];
function Preview(){const sharing=useTeamSharing('fixture',true);const [section,setSection]=useState('states'),[scope,setScope]=useState('mine'),[project,setProject]=useState(''),[value,setValue]=useState(null);return <>
<button id="scope" onClick={()=>{setScope(scope==='mine'?'project':'mine');setSection('states');}}>Cambiar ámbito</button>
<div style={{maxWidth:400,padding:12}}><label>Proyecto de formulario<select id="form-project" value={project} onChange={e=>{setProject(e.target.value);setValue(null);}}><option value="">Personal</option><option value="project-a">Proyecto A</option></select></label><PipelineFields key={project} projectId={project} value={value} onChange={setValue}/><output id="form-value">{JSON.stringify(value)}</output></div>
<TaskPipelineState taskId="project-task"/>{render_tasks_module({task_scope:scope,active_section:section,set_active_section:setSection,selected_project:{id:'project-a',label:'Proyecto A'},pipeline_projects:projects,selected_task:null,filtered_tasks:[],tasks:[],active_filters:{},team_sharing:sharing,handle_close_task_tool:()=>{},handle_toggle_quick_popover:()=>{},handle_task_select:()=>{},visible_fields:{}})}</>}
createRoot(document.getElementById('root')).render(<CoreContext.Provider value={{activeAssignment:{id:'fixture',personId:'person'},account:{id:'person'},directory:[],permissions:{can:()=>true}}}><Preview/></CoreContext.Provider>);

import React,{useState} from "react";
import {createRoot} from "react-dom/client";
import {CoreContext} from "../../core_provider.jsx";
import {render_board_view} from "../../../tareas/src/task_app.jsx";
import "../../../tareas/src/styles.css";
import "../../../tareas/src/tasks_mobile.css";
import "../../app_shell.css";
const noop=()=>{};
const initial=[{id:'task-1',title:'Preparar propuesta',description:'Descripción de la tarea',section:'a',position:1,status:'Pend.',priority:'Media',completed:false},{id:'task-2',title:'Revisar entregables',section:'b',position:2,status:'Pend.',priority:'Baja',completed:false}];
function Preview(){const [scope,setScope]=useState('mine'),[tasks,setTasks]=useState(initial),[dragged,setDragged]=useState(null),[readonly,setReadonly]=useState(false);return <><button id="scope" onClick={()=>{setScope(scope==='mine'?'project':'mine');setTasks(initial);}}>Cambiar ámbito</button><button id="readonly" onClick={()=>setReadonly(!readonly)}>Solo lectura</button><div style={{padding:20,minWidth:0,maxWidth:'100%',boxSizing:'border-box'}}>{render_board_view({readOnly:readonly,task_scope:scope,sort_field:'position',sort_direction:'asc',board_columns:[{id:'a',label:'Sección A'},{id:'b',label:'Sección B'},{id:'c',label:'Sección vacía'}],filtered_tasks:tasks,dragged_task_id:dragged,handle_drag_start:(id,event)=>{setDragged(id);event.dataTransfer.setData('text/plain',id);},handle_drag_end:()=>setDragged(null),handle_column_drop:(section,id)=>{window.moves=(window.moves||0)+1;setTasks(rows=>rows.map(row=>row.id===id?{...row,section,...(scope==='project'?{position:3}:{})}:row));setDragged(null);},handle_section_drag_start:noop,handle_section_drag_end:noop,handle_section_key_down:noop,handle_task_select:noop,handle_toggle_task:noop,handle_start_edit_column:noop,set_quick_task_section:noop,set_quick_task_open:noop,handle_delete_column:noop})}</div></>}
createRoot(document.getElementById('root')).render(<CoreContext.Provider value={{directory:[],permissions:{can:()=>true}}}><Preview/></CoreContext.Provider>);

import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {CoreContext} from "../../core_provider.jsx";
import {render_tasks_module,render_tasks_workspace_menu} from "../../../tareas/src/task_app.jsx";
import {TeamCalendarSharing,useTeamSharing} from "../../../tareas/src/team.jsx";
import "../../../tareas/src/styles.css";
import "../../../tareas/src/tasks_tablet.css";
import "../../../tareas/src/tasks_mobile.css";
import "../../app_shell.css";
const noop = () => {};
function Preview() {
    const sharing = useTeamSharing("preview", true);
    const [section, setSection] = useState("team"), [scope, setScope] = useState("mine");
    const [activeView,setActiveView] = useState("board");
    return <><aside style={{width:230,maxWidth:'100%',padding:12,boxSizing:'border-box'}}>{render_tasks_workspace_menu(()=>setSection('states'),noop,noop,[],'',noop,noop,null,null,scope,true,false,{pinnedIds:[],teamActive:section==='team',onTeamSelect:()=>{setScope('mine');setSection('team');},onManage:noop,onTotal:noop})}</aside><button id="test-project" onClick={() => setScope(scope === "mine" ? "project" : "mine")}>Cambiar ámbito de prueba</button><div className="bold_calendar"><TeamCalendarSharing assignmentId="preview"/></div>{render_tasks_module({
        task_scope: scope, active_section: section, set_active_section: setSection, team_sharing: sharing, assignment_id: "preview",
        pipeline_projects:[], active_filters: {}, selected_project: {id:"my_tasks",label: "Mis tareas"}, filtered_tasks: [], tasks: [], active_view: activeView, set_active_view:setActiveView, visible_fields:{},
        handle_add_column:noop,set_is_adding_column:noop,handle_close_task_tool: noop, handle_toggle_quick_popover: noop, handle_task_select: noop,
    })}</>;
}
globalThis.teamPreviewRoot ||= createRoot(document.getElementById("root"));
globalThis.teamPreviewRoot.render(<CoreContext.Provider value={{directory:[],permissions:{can:()=>true}}}><Preview/></CoreContext.Provider>);

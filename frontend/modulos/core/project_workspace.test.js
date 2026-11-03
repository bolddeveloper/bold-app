import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("projects search, menus and task views preserve callbacks and share the Mis tareas layout",async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const keys=["window","document","navigator","HTMLElement","Element","Event","CustomEvent","KeyboardEvent","MutationObserver","sessionStorage","localStorage","ResizeObserver","DOMParser","BroadcastChannel"];
    const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==="ResizeObserver" ? class {observe(){}disconnect(){}} : dom.window[key]});
    dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
    dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});
    const server=await createServer({configFile:false,logLevel:"error",define:{"import.meta.env.VITE_USE_REAL_BACKEND":'"false"'},resolve:{dedupe:["react","react-dom","lucide-react","sweetalert2","qrcode","driver.js"]},esbuild:{jsx:"automatic"},cacheDir:path.join(os.tmpdir(),"bold-project-workspace-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    let root;
    try {
        const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
        const {ProjectsModule,render_tasks_module,ProjectSidebarItem}=await server.ssrLoadModule(path.resolve("../tareas/src/task_app.jsx"));
        const {CoreProvider}=await server.ssrLoadModule(path.resolve("core_provider.jsx"));
        const {TaskActionsContext}=await server.ssrLoadModule(path.resolve("../tareas/src/comment_item.jsx"));
        const wrap=element=>React.createElement(CoreProvider,{mockIdentity:{activeAssignment:{id:"me"},account:{id:"account"},directory:[],units:[]}},React.createElement(TaskActionsContext.Provider,{value:{saveProjectMembers(){}}},element));
        const calls=[],project={id:"p",label:"Campaña",unitId:"u",priority:"Alta",color:"#ef1f2d",member_ids:[]};
        const task={id:"t",title:"Preparar piezas",project_id:"p",section:"todo",priority:"Media",completed:false,tags:["Diseño"],subtasks:[],comments:[],taskProjects:[],collaborator_ids:[]};
        const actions={onEdit:id=>calls.push(["edit",id]),onShare:id=>calls.push(["share",id]),onDelete:id=>calls.push(["delete",id]),onWorkspace:item=>calls.push(["workspace",item.id]),onBack:()=>calls.push(["back"])};
        root=createRoot(document.getElementById("root"));
        const wait=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(predicate());};
        const button=name=>[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===name);
        root.render(wrap(React.createElement(ProjectsModule,{projects:[project,{id:"q",label:"Otro proyecto",unitId:"u"}],tasks:[task,{id:"done",taskProjects:[{projectId:"p"}],completed:true}],group_by_unit:true,units:[{id:"u",name:"Equipo"}],onCreate:()=>calls.push(["create"]),onOpen:id=>calls.push(["open",id]),onPreview:()=>{},...actions})));
        await wait(()=>document.querySelectorAll(".project_summary_card").length===2);
        assert.equal(document.querySelector('[aria-label="Progreso de Campaña"]').getAttribute("aria-valuenow"),"50");
        const search=document.querySelector('[aria-label="Buscar proyectos"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value").set.call(search,"campana");search.dispatchEvent(new Event("input",{bubbles:true}));
        await wait(()=>document.querySelectorAll(".project_summary_card").length===1);
        document.querySelector('[aria-label="Abrir tareas de Campaña"]').click();assert.deepEqual(calls.at(-1),["open","p"]);
        for(const [label,action] of [["Editar proyecto","edit"],["Compartir proyecto","share"],["Organizar en Workspace","workspace"],["Eliminar proyecto","delete"]]){
            document.querySelector('[aria-label="Opciones de proyecto Campaña"]').click();await wait(()=>document.querySelector(".project_options_menu"));
            button(label).click();await wait(()=>!document.querySelector(".project_options_menu"));assert.deepEqual(calls.at(-1),[action,"p"]);
        }
        document.querySelector('[aria-label="Opciones de proyecto Campaña"]').click();await wait(()=>document.querySelector(".project_options_menu"));
        document.querySelector(".project_options_menu").dispatchEvent(new dom.window.KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
        await wait(()=>!document.querySelector(".project_options_menu"));assert.equal(document.activeElement.getAttribute("aria-label"),"Opciones de proyecto Campaña");
        const props={task_scope:"project",selected_project:project,project_actions:actions,active_section:"tasks",active_view:"list",active_filters:{},board_columns:[{id:"todo",label:"Pendiente"}],collapsed_sections:[],filtered_tasks:[task],tasks:[task],selected_task_ids:[],visible_fields:{date:true,priority:true,subtasks:true},quick_task_text:"",team_sharing:{error:null}};
        root.render(wrap(React.createElement(render_tasks_module,props)));
        await wait(()=>document.querySelector(".project_tasks_workspace.bold_tasks .task_row"));
        assert.ok(document.querySelector(".bold_task_tags_cell"),"Project list uses the compact task columns");
        assert.equal(document.querySelectorAll('.main_section_nav_tabs [role="tab"]').length,3);
        assert.equal(document.querySelector(".project_tasks_context"),null,"Project tabs start without a second heading row");
        root.render(wrap(React.createElement(render_tasks_module,{...props,active_view:"board"})));
        await wait(()=>document.querySelector(".bold_tasks .board_card .bold_board_context"));
        assert.match(document.querySelector(".board_card").textContent,/Preparar piezas/);
        root.render(wrap(React.createElement(render_tasks_module,{...props,task_scope:"mine"})));
        await wait(()=>document.querySelector(".bold_tasks .task_row")&&!document.querySelector(".project_tasks_context"));
        assert.ok(document.querySelector(".bold_task_tags_cell"),"Mis tareas keeps the same compact list");
        function SidebarPreview(){
            const [id,setId]=React.useState(null);
            return React.createElement(ProjectSidebarItem,{project_item:project,selected_project_id:'p',active_project_menu_id:id,handle_project_select(){},handle_project_menu_toggle:(key,action)=>{if(action==='toggle')setId(key);else if(action==='close')setId(null);else{calls.push([action,key]);setId(null);}},onAssignWorkspace:item=>calls.push(['workspace',item.id])});
        }
        root.render(wrap(React.createElement(SidebarPreview)));await wait(()=>document.querySelector('.project_more_button'));
        for(const [label,action] of [['Anclar al acceso rápido','pin'],['Asignar a Workspace','workspace'],['Editar proyecto','edit'],['Eliminar proyecto','delete']]){
            document.querySelector('.project_more_button').click();await wait(()=>document.querySelector('.bold_project_overflow'));
            button(label).click();await wait(()=>!document.querySelector('.bold_project_overflow'));assert.deepEqual(calls.at(-1),[action,'p']);
        }
        document.querySelector('.project_more_button').click();await wait(()=>document.querySelector('.bold_project_overflow'));
        document.querySelector('.bold_project_overflow').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        await wait(()=>!document.querySelector('.bold_project_overflow'));assert.equal(document.activeElement.getAttribute('aria-label'),'Opciones de Campaña');

    } finally {
        root?.unmount();await new Promise(resolve=>setTimeout(resolve,30));await server.close();dom.window.close();
        for(const key of keys){if(originals[key])Object.defineProperty(globalThis,key,originals[key]);else delete globalThis[key];}
    }
});

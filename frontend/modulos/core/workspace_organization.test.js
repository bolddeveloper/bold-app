import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("workspace retains cross-tab selections, loads Drive on demand, moves branches and searches people",async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
    const keys=['window','document','navigator','HTMLElement','Element','Event','CustomEvent','MutationObserver','localStorage','sessionStorage','BroadcastChannel'];
    const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
    dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
    const server=await createServer({root:process.cwd(),configFile:false,logLevel:'error',resolve:{dedupe:['react','react-dom','lucide-react','sweetalert2']},esbuild:{jsx:'automatic'},cacheDir:path.join(os.tmpdir(),'bold-workspace-organization-ui'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'workspace-fixture',enforce:'pre',transform(source,id){
        const file=id.replaceAll('\\','/');
        if(file.endsWith('/core/app_shell.jsx'))return 'export const useShell=()=>({open_drive_folder(){}});';
        if(file.endsWith('/core/core_provider.jsx'))return 'export const useCore=()=>({activeAssignment:{id:"me",personId:"owner",name:"Responsable"},account:{id:"account",email:"owner@example.test"},directory:[{id:"ana",name:"Ána",email:"ana@example.test",initials:"A"}]});';
        if(file.endsWith('/docs/drive_module.jsx'))return 'export const DriveFolderPicker=()=>null;';
        if(file.endsWith('/docs/workspace_api.js'))return 'export const workspaceApi={connection:async()=>{globalThis.workspaceDriveReads++;return {services:{drive:{status:"disconnected"}}};}};';
        if(file.endsWith('/docs/google_connection.jsx'))return 'export default function Connection(){return null;}';
        if(file.endsWith('/tareas/src/task_text_editor.jsx'))return 'export const TaskText=({value})=>value;export const TextEditorField=()=>null;';
    }}]});
    let root;globalThis.workspaceDriveReads=0;
    try{
        const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
        const {default:WorkspacesModule}=await server.ssrLoadModule(path.resolve('../tareas/src/workspaces_module.jsx'));
        const saves=[],shares=[];let failNext=false;
        const initial=[{id:'a',name:'Campaña',parentId:null,projectIds:['p'],taskIds:[],ownerId:'account'},{id:'child',name:'Piezas',parentId:'a',projectIds:[],taskIds:[],ownerId:'account'},{id:'b',name:'Destino',parentId:null,projectIds:[],taskIds:[],ownerId:'account'}];
        function Harness(){const [folders,setFolders]=React.useState(initial),[active,setActive]=React.useState('a');return React.createElement(WorkspacesModule,{workspaces:folders,activeId:active,onOpen:setActive,accountId:'account',projects:[{id:'p',label:'Existente'},{id:'q',label:'Proyecto nuevo'}],tasks:[{id:'t',title:'Revisar diseño',priority:'Media'}],allTasks:[{id:"t",title:"Revisar diseño",subtasks:[]},{id:"u",title:"Otra tarea",subtasks:[]}],TaskSelect:props=>React.createElement("select",{"aria-label":props.aria_label,value:props.value,onChange:event=>props.on_change?.(event.target.value)},props.options.map(option=>React.createElement("option",{key:option.value,value:option.value},option.label))),CalendarDateField:props=>React.createElement("input",{type:"date",value:props.value||"",onChange:event=>props.onChange?.(event.target.value)}),onBulk:async()=>true,sections:[],statuses:[],members:[],units:[],searchQuery:'',onProject:()=>{},onProjectPreview:()=>{},onEditProject:()=>{},onShareProject:()=>{},onSave:async rows=>{if(failNext){failNext=false;return false;}saves.push(rows);setFolders(rows);return true;},onShare:async(folder,ids)=>shares.push({folder,ids})});}
        root=createRoot(document.getElementById('root'));root.render(React.createElement(Harness));
        const waitFor=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(predicate());};
        const button=text=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text);
        const input=(element,value)=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};
        await waitFor(()=>button('Agregar contenido'));button('Agregar contenido').click();await waitFor(()=>document.querySelector('.folder_picker'));
        assert.equal(globalThis.workspaceDriveReads,0);
        button('Proyecto nuevo').click();await waitFor(()=>document.querySelector('.folder_picker input:checked'));
        [...document.querySelectorAll('.folder_picker_tabs button')].find(e=>e.textContent.startsWith('Tareas')).click();await waitFor(()=>button('Revisar diseño'));
        button('Revisar diseño').click();
        [...document.querySelectorAll('.folder_picker_tabs button')].find(e=>e.textContent.startsWith('Drive')).click();await waitFor(()=>globalThis.workspaceDriveReads===1);
        [...document.querySelectorAll('.folder_picker_tabs button')].find(e=>e.textContent.startsWith('Proyectos')).click();await waitFor(()=>button('Proyecto nuevo'));
        await waitFor(()=>button('Agregar (2)'));button('Agregar (2)').click();await waitFor(()=>saves.length===1&&!document.querySelector('.folder_dialog'));
        assert.deepEqual(saves[0].find(row=>row.id==='a').projectIds,['p','q']);
        assert.deepEqual(saves[0].find(row=>row.id==='a').taskIds,['t']);assert.equal(globalThis.workspaceDriveReads,1);
        button('Mover').click();await waitFor(()=>document.querySelector('[aria-label="Destino de la carpeta"]'));
        document.querySelector('[aria-label="Destino de la carpeta"]').click();await waitFor(()=>document.querySelector('[role="option"]'));
        assert.ok(![...document.querySelectorAll('[role="option"]')].some(e=>e.textContent.includes('Campaña')),'Exclude source and descendants');
        [...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Destino').click();await waitFor(()=>button('Mover carpeta')&&!button('Mover carpeta').disabled);
        button('Mover carpeta').click();await waitFor(()=>saves.length===2&&!document.querySelector('.folder_dialog'));
        assert.equal(saves[1].find(row=>row.id==='a').parentId,'b');assert.equal(saves[1].find(row=>row.id==='child').parentId,'a');
        assert.deepEqual(saves[1].find(row=>row.id==='a').taskIds,['t']);
        document.querySelector('[aria-label="Compartir carpeta del workspace"]').click();await waitFor(()=>document.querySelector('.folder_share_dialog'));
        assert.ok(document.querySelector('[aria-label="Agregar a Ána a la carpeta"]'),'Candidates visible without typing');
        input(document.querySelector('[aria-label="Buscar personas de BOLD"]'),'ana');await waitFor(()=>document.querySelectorAll('button.folder_share_person').length===1);
        document.querySelector('[aria-label="Agregar a Ána a la carpeta"]').click();await waitFor(()=>shares.length===1);assert.deepEqual(shares[0].ids,['ana']);
        await waitFor(()=>!button('Listo').disabled);button('Listo').click();await waitFor(()=>!document.querySelector('.folder_dialog'));
        button('Todas las tareas').click();await waitFor(()=>document.querySelector('[aria-label="Seleccionar Revisar diseño"]'));
        document.querySelector('[aria-label="Seleccionar Revisar diseño"]').click();await waitFor(()=>button('Agregar a carpeta'));
        button('Agregar a carpeta').click();await waitFor(()=>document.querySelector('[aria-label="Carpeta destino"]'));
        document.querySelector('[aria-label="Carpeta destino"]').click();await waitFor(()=>document.querySelector('[role="option"]'));
        [...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Destino').click();await waitFor(()=>button('Agregar tareas')&&!button('Agregar tareas').disabled);
        failNext=true;button('Agregar tareas').click();await waitFor(()=>document.querySelector('.folder_dialog [role="alert"]'));
        assert.equal(saves.length,2,'Failed save keeps prior folders intact');
        button('Agregar tareas').click();await waitFor(()=>saves.length===3&&!document.querySelector('.folder_dialog'));
        assert.deepEqual(saves[2].find(row=>row.id==='b').taskIds,['t']);
        assert.deepEqual(saves[2].find(row=>row.id==='a').taskIds,['t'],'Other folder memberships survive');
    }finally{root?.unmount();await new Promise(resolve=>setTimeout(resolve,30));await server.close();dom.window.close();delete globalThis.workspaceDriveReads;for(const key of keys){if(originals[key])Object.defineProperty(globalThis,key,originals[key]);else delete globalThis[key];}}
});

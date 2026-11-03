import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {JSDOM} from "jsdom";
import {createServer} from "vite";

test("task detail tabs retain comment drafts, open subtasks and preserve folded form values",async()=>{
    const dom=new JSDOM('<div id="detail-root"></div>',{url:'http://localhost',pretendToBeVisual:true});
    const names=['window','document','navigator','HTMLElement','Element','Event','KeyboardEvent','MutationObserver','sessionStorage','ResizeObserver','DOMParser','BroadcastChannel'];
    const descriptors=Object.fromEntries(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of names)Object.defineProperty(globalThis,key,{configurable:true,value:key==='ResizeObserver' ? class {observe(){}disconnect(){}} : dom.window[key]});
    const server=await createServer({root:process.cwd(),configFile:false,logLevel:'error',define:{'import.meta.env.VITE_USE_REAL_BACKEND':'"false"'},resolve:{dedupe:['react','react-dom','lucide-react','sweetalert2','qrcode','driver.js']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-task-detail-ui'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
    let root;
    try {
    const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
    const {TaskDetailPanel,CreateTaskModal,EditTaskModal,CollaboratorsSelector}=await server.ssrLoadModule(path.resolve('../tareas/src/task_app.jsx'));
    const {CoreProvider}=await server.ssrLoadModule(path.resolve('core_provider.jsx'));
    const {TaskActionsContext}=await server.ssrLoadModule(path.resolve('../tareas/src/comment_item.jsx'));
    root=createRoot(document.getElementById('detail-root'));
    const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
    const waitFor=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await settle();assert.ok(predicate());};
    const parent={id:'parent',title:'Campaña',description:'Contexto',subtasks:[{id:'child',title:'Preparar piezas',completed:false},{id:'done',title:'Brief',completed:true}],comments:[]};
    const opened=[],back=[],created=[];
    const people=[{id:'ana',name:'Ana',email:'ana@example.test',unitId:'design'},{id:'sofia',name:'Sofía',email:'sofia@example.test',unitId:'operations'}];
    const wrap=child=>React.createElement(CoreProvider,{mockIdentity:{activeAssignment:{id:'me'},account:{id:'account'},directory:people,units:[]}},React.createElement(TaskActionsContext.Provider,{value:{findTask:id=>id==='parent'?parent:null,openTask:id=>back.push(id),deleteSubtask:()=>{}}},child));
    const detail=task=>wrap(React.createElement(TaskDetailPanel,{key:task.id,selected_task:task,on_workspace:()=>{},on_close:()=>{},on_followers_change:()=>{},handle_open_edit_task:()=>{},handle_delete_task:()=>{},handle_toggle_task:()=>{},handle_toggle_subtask:()=>{},handle_open_subtask:(_parent,id)=>opened.push(id),handle_add_quick_subtask:async()=> 'created-child',handle_add_comment:async()=>false}));
    const tab=name=>[...document.querySelectorAll('.task_detail_tabs [role="tab"]')].find(e=>e.textContent.startsWith(name));
        root.render(detail(parent));await waitFor(()=>tab('Detalles'));
        assert.match(document.querySelector('.detail_meta_grid').textContent,/Sin proyecto/);
        assert.equal(document.querySelectorAll('[role="tabpanel"]:not([hidden])').length,1);
        tab('Subtareas').click();await waitFor(()=>tab('Subtareas').getAttribute('aria-selected')==='true');
        assert.equal(document.querySelector('[aria-label="Subtareas completadas"]').getAttribute('aria-valuenow'),'50');
        document.querySelector('[aria-label="Abrir detalles de Preparar piezas"]').click();assert.deepEqual(opened,['child']);
        const field=document.querySelector('[aria-label="Nombre de la nueva subtarea"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,'Siguiente paso');field.dispatchEvent(new Event('input',{bubbles:true}));
        await waitFor(()=>!document.querySelector('.quick_subtask_more').disabled);document.querySelector('.quick_subtask_more').click();
        await waitFor(()=>opened.includes('created-child'));
        tab('Comentarios').click();await waitFor(()=>tab('Comentarios').getAttribute('aria-selected')==='true');
        const editor=document.querySelector('[role="textbox"][aria-label="Comentario"]');
        editor.textContent='Borrador sin enviar';editor.dispatchEvent(new Event('input',{bubbles:true}));await settle();
        tab('Detalles').click();await settle();tab('Comentarios').click();await settle();
        assert.equal(document.querySelector('[role="textbox"][aria-label="Comentario"]'),editor);
        assert.equal(editor.textContent,'Borrador sin enviar');
        tab('Comentarios').focus();tab('Comentarios').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));
        await waitFor(()=>tab('Detalles').getAttribute('aria-selected')==='true');assert.equal(document.activeElement,tab('Detalles'));
        root.render(detail({...parent.subtasks[0],parentTaskId:'parent'}));await waitFor(()=>document.querySelector('.task_parent_link'));
        document.querySelector('.task_parent_link').click();assert.deepEqual(back,['parent']);
        function People(){const [ids,setIds]=React.useState(['ana']);return React.createElement(CollaboratorsSelector,{members:[{id:'ana',name:'Ana',email:'ana@example.test'},{id:'sofia',name:'Sofía',email:'sofia@example.test'}],selected_ids:ids,on_change:setIds});}
        root.render(wrap(React.createElement(People)));await waitFor(()=>!document.querySelector('.task_detail_rework') && document.querySelector('[aria-label="Agregar colaboradores"]'));
        document.querySelector('[aria-label="Agregar colaboradores"]').click();await waitFor(()=>document.querySelector('[aria-label="Buscar colaboradores"]'));
        const search=document.querySelector('[aria-label="Buscar colaboradores"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(search,'sofia');search.dispatchEvent(new Event('input',{bubbles:true}));
        await waitFor(()=>document.querySelectorAll('.task_collaborators_results>button').length===1);
        document.querySelector('.task_collaborators_results>button').click();await waitFor(()=>document.querySelectorAll('.task_collaborator_token').length===2);
        document.querySelector('[aria-label="Cerrar selector de colaboradores"]').click();await settle();
        document.querySelector('[aria-label="Quitar a Ana"]').click();await waitFor(()=>document.querySelectorAll('.task_collaborator_token').length===1);
        assert.match(document.querySelector('.task_collaborator_token').textContent,/Sofía/);
        sessionStorage.setItem('detail-form-test',JSON.stringify({title:'Revisar propuesta',start_date:'2026-11-02',due_day:4,due_month:10,due_year:2026,description:'Texto conservado',subtasks:[{id:'draft-child',title:'Revisar presupuesto',completed:false}]}));
        root.render(wrap(React.createElement(CreateTaskModal,{draft_storage_key:'detail-form-test',projects:[],board_columns:[{id:'todo',label:'Pendiente'}],on_cancel:()=>{},on_create:async value=>{created.push(value);return false;},drawer:{width:600}})));
        await waitFor(()=>document.querySelector('[aria-label="Nueva tarea"]'));
        assert.equal(document.querySelector('label[for]').control.value,'Revisar propuesta');
        assert.ok([...document.querySelectorAll('details.task_form_disclosure')].every(e=>!e.open));
        document.querySelector('[aria-label="Elegir inicio y fin"]').click();await waitFor(()=>document.querySelector('.bold_date_presets'));
        [...document.querySelectorAll('.bold_date_presets button')].find(button=>button.textContent==='1 semana').click();await settle();
        document.querySelector('.bold_date_apply').click();await waitFor(()=>!document.querySelector('.bold_date_picker'));
        const subtaskSection=[...document.querySelectorAll('details.task_form_disclosure')].find(e=>e.querySelector('summary').textContent.startsWith('Subtareas'));
        subtaskSection.open=true;
        document.querySelector('.subtask_draft_toggle').click();await waitFor(()=>document.querySelector('.subtask_draft_details'));
        document.querySelector('[aria-label="Responsable de la subtarea"]').click();await waitFor(()=>document.querySelector('[aria-label="Buscar responsable de la subtarea"]'));
        const assigneeSearch=document.querySelector('[aria-label="Buscar responsable de la subtarea"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(assigneeSearch,'sofia@example.test');assigneeSearch.dispatchEvent(new Event('input',{bubbles:true}));
        await waitFor(()=>document.querySelectorAll('[role="option"]').length===1);
        document.querySelector('[role="option"]').click();await waitFor(()=>!document.querySelector('[role="option"]'));
        const childDescription=document.querySelector('[aria-label="Descripción de la subtarea"][contenteditable]');
        childDescription.textContent='Detalles conservados de la subtarea';childDescription.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('[aria-label="Prioridad de la subtarea"]').click();await waitFor(()=>document.querySelector('[role="option"]'));
        [...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Alta').click();await waitFor(()=>!document.querySelector('[role="option"]'));
        document.querySelector('.subtask_draft_toggle').click();await waitFor(()=>!document.querySelector('.subtask_draft_details'));
        document.querySelector('.subtask_draft_toggle').click();await waitFor(()=>document.querySelector('.subtask_draft_details'));
        assert.match(document.querySelector('[aria-label="Descripción de la subtarea"][contenteditable]').textContent,/Detalles conservados/);
        document.querySelector('.subtask_draft_details [aria-label="Elegir inicio y fin"]').click();await waitFor(()=>document.querySelector('.bold_date_presets'));
        [...document.querySelectorAll('.bold_date_presets button')].find(button=>button.textContent==='1 semana').click();await settle();
        document.querySelector('.bold_date_apply').click();await waitFor(()=>!document.querySelector('.bold_date_picker'));
        document.querySelector('.bold_modal_body').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        await waitFor(()=>created.length===1);assert.equal(created[0].description,'Texto conservado');assert.equal(created[0].subtasks[0].title,'Revisar presupuesto');
        assert.equal(created[0].start_date,'2026-11-02');assert.equal(created[0].due_date,'2026-11-09');
        assert.equal(created[0].subtasks[0].priority,'Alta');assert.match(created[0].subtasks[0].description,/Detalles conservados/);
        assert.equal(created[0].subtasks[0].assignee_id,'sofia');
        assert.equal(created[0].subtasks[0].start_date,'2026-11-02');assert.equal(created[0].subtasks[0].due_date,'2026-11-09');
        assert.equal(JSON.parse(sessionStorage.getItem('detail-form-test')).subtasks[0].priority,'Alta');
        assert.ok(sessionStorage.getItem('detail-form-test'),'failed saves retain the draft');
        let edited;
        function EditSubtasks(){
            const [draft,setDraft]=React.useState({id:'parent',title:'Campaña',subtasks:[{id:'child',title:'Preparar piezas',assignee_id:'ana',description:'Conservar contexto',completed:false},{id:'other',title:'Revisión',assignee_id:'ana',completed:true}]});
            return React.createElement(EditTaskModal,{drawer:{width:600},edit_draft:draft,edit_attachments:[],projects:[],board_columns:[],status_options:[],handle_edit_field_change:(field,value)=>setDraft(current=>({...current,[field]:value})),on_save:event=>{event.preventDefault();edited=draft;},on_cancel:()=>{}});
        }
        root.render(wrap(React.createElement(EditSubtasks)));await waitFor(()=>document.querySelector('[aria-label="Editar tarea"]'));
        [...document.querySelectorAll('details.task_form_disclosure')].find(e=>e.querySelector('summary').textContent.startsWith('Subtareas')).open=true;
        const assigneeLabel='Responsable de la subtarea Preparar piezas';
        assert.match(document.querySelector(`[aria-label="${assigneeLabel}"]`).textContent,/Ana/);
        document.querySelector(`[aria-label="${assigneeLabel}"]`).click();await waitFor(()=>document.querySelector('[role="option"]'));
        [...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.includes('Sofía')).click();
        await waitFor(()=>document.querySelector(`[aria-label="${assigneeLabel}"]`).textContent.includes('Sofía'));
        document.querySelector('.subtask_edit_item .bold_date_trigger_btn').click();await waitFor(()=>document.querySelector('.bold_date_presets'));
        [...document.querySelectorAll('.bold_date_presets button')].find(e=>e.textContent==='1 semana').click();await settle();
        document.querySelector('.bold_date_apply').click();await waitFor(()=>!document.querySelector('.bold_date_picker'));
        document.querySelector('.bold_modal_body').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        assert.equal(edited.subtasks[0].assignee_id,'sofia');assert.equal(edited.subtasks[0].description,'Conservar contexto');assert.equal(edited.subtasks[1].assignee_id,'ana');
        assert.equal(edited.subtasks[0].due_date,new Date(new Date(`${edited.subtasks[0].start_date}T12:00:00`).getTime()+7*86400000).toISOString().slice(0,10));
        assert.equal(edited.subtasks[1].due_date,undefined);
        document.querySelector('.subtask_edit_item .bold_date_trigger_btn span').click();await waitFor(()=>document.querySelector('.bold_date_clear'));
        document.querySelector('.bold_date_clear').click();await waitFor(()=>!document.querySelector('.bold_date_picker'));
        document.querySelector('.bold_modal_body').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        assert.equal(edited.subtasks[0].start_date,null);assert.equal(edited.subtasks[0].due_date,null);assert.equal(edited.subtasks[0].assignee_id,'sofia');
        document.querySelector(`[aria-label="${assigneeLabel}"]`).click();await waitFor(()=>document.querySelector('[role="option"]'));
        [...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Sin responsable').click();
        await waitFor(()=>document.querySelector(`[aria-label="${assigneeLabel}"]`).textContent.includes('Sin responsable'));
        document.querySelector('.bold_modal_body').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
        assert.equal(edited.subtasks[0].assignee_id,'');assert.equal(edited.subtasks[1].assignee_id,'ana');
    }finally{
        root?.unmount();await new Promise(resolve=>setTimeout(resolve,30));await server.close();dom.window.close();
        for(const key of names){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else delete globalThis[key];}
    }
});

test("task views keep real progress, date selection and safe quick creation",async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:"http://localhost",pretendToBeVisual:true});
    const names=["window","document","navigator","HTMLElement","Element","Event","KeyboardEvent","MutationObserver"];
    const descriptors=Object.fromEntries(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of names)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
    const server=await createServer({root:path.resolve("."),configFile:false,resolve:{dedupe:["react","react-dom","lucide-react"]},esbuild:{jsx:"automatic",jsxImportSource:"react"},cacheDir:path.join(os.tmpdir(),"bold-task-progress-ui"),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:"custom"});
    const {default:React}=await import("react"),{createRoot}=await import("react-dom/client");
    const {DailyTaskProgress,TaskCardProgress,TaskQuickComposer,TaskListDetails,TaskActionsMenu}=await server.ssrLoadModule(path.resolve("../tareas/src/task_progress.jsx"));
    const {localDay}=await server.ssrLoadModule(path.resolve("../tareas/src/task_progress.js"));
    const root=createRoot(document.getElementById("root")), settle=()=>new Promise(resolve=>setTimeout(resolve,25));
    const waitFor=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await settle();assert.ok(predicate());};
    const today=localDay(new Date()),task={id:"one",due_date:today,assignee_id:"me",completed:true};
    function Daily(){const [value,setValue]=React.useState(null);return React.createElement(DailyTaskProgress,{tasks:[task,{...task,id:"two",completed:false}],assignmentId:"me",value,onChange:setValue});}
    try{
        root.render(React.createElement(Daily));await waitFor(()=>document.querySelector('.bold_daily_filters'));
        assert.equal(document.querySelector('.bold_daily_filters button').getAttribute('aria-pressed'),'true');
        const current=document.querySelector('[aria-current="date"]');assert.match(current.getAttribute('aria-label'),/50%/);current.click();
        await waitFor(()=>document.querySelector('[aria-current="date"]').getAttribute('aria-pressed')==='true');
        document.querySelector('.bold_daily_filters button').click();await waitFor(()=>document.querySelector('.bold_daily_filters button').getAttribute('aria-pressed')==='true');
        assert.ok([...document.querySelectorAll('.bold_daily_ring.is_empty')].every(e=>e.textContent==='—'));
        root.render(React.createElement(TaskCardProgress,{task:{subtasks:[]}}));await waitFor(()=>!document.querySelector('.bold_daily'));
        assert.equal(document.querySelector('.bold_card_progress'),null);
        root.render(React.createElement(TaskCardProgress,{task:{pipeline_progress:[{project:"a",label:"Revisión",percent:75}],subtasks:[{completed:true},{completed:false}]}}));
        await waitFor(()=>document.querySelector('[role="progressbar"]'));assert.equal(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'75');
        assert.match(document.querySelector('.bold_subtask_count').getAttribute('aria-label'),/1 de 2/);
        root.render(React.createElement(TaskCardProgress,{task:{pipeline_progress:[{project:"a",label:"Revisión",percent:75}],subtasks:[{completed:true},{completed:false}]},showSubtasks:false}));
        await waitFor(()=>!document.querySelector('.bold_subtask_count'));
        assert.equal(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'75');
        root.render(React.createElement(TaskCardProgress,{task:{subtasks:[{completed:true}]},showSubtasks:false}));
        await waitFor(()=>!document.querySelector('.bold_card_progress'));
        root.render(React.createElement(TaskCardProgress,{task:{pipeline_progress:[{project:"a",label:"A",percent:75},{project:"b",label:"B",percent:25}]},children:React.createElement('span',null,'Persona')}));
        await waitFor(()=>document.querySelector('.bold_progress_empty'));assert.match(document.body.textContent,/Varios flujos/);assert.equal(document.querySelector('[role="progressbar"]'),null);assert.doesNotMatch(document.body.textContent,/0\/0/);
        root.render(React.createElement(TaskListDetails,{task:{tags:['Diseño'],comments:[{},{}],attachmentCount:1},showTags:false}));
        await waitFor(()=>document.querySelector('[aria-label="2 comentarios"]'));assert.doesNotMatch(document.body.textContent,/Diseño/);
        root.render(React.createElement(TaskListDetails,{task:{tags:['Diseño'],comments:[{},{}]},showActivity:false}));
        await waitFor(()=>document.querySelector('.bold_task_tag'));assert.equal(document.querySelector('[aria-label="2 comentarios"]'),null);
        let edited=0,deleted=0;
        root.render(React.createElement(TaskActionsMenu,{label:'Ejemplo',section:true,onEdit:()=>edited++,onDelete:()=>deleted++}));
        await waitFor(()=>document.querySelector('[aria-label="Opciones de sección Ejemplo"]'));
        document.querySelector('[aria-label="Opciones de sección Ejemplo"]').click();await waitFor(()=>document.querySelector('.bold_section_menu'));
        document.querySelector('.bold_section_menu button').click();await waitFor(()=>!document.querySelector('.bold_section_menu'));assert.equal(edited,1);assert.equal(deleted,0);
        root.render(React.createElement(TaskActionsMenu,{label:'Ejemplo',onEdit:()=>edited++,onDelete:()=>deleted++}));
        await waitFor(()=>document.querySelector('[aria-label="Opciones de tarea Ejemplo"]'));document.querySelector('[aria-label="Opciones de tarea Ejemplo"]').click();
        await waitFor(()=>document.querySelector('.bold_section_menu'));assert.match(document.querySelector('.bold_section_menu').textContent,/Editar tarea/);
        document.querySelector('.bold_section_menu').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        await waitFor(()=>!document.querySelector('.bold_section_menu'));assert.equal(document.activeElement.getAttribute('aria-label'),'Opciones de tarea Ejemplo');assert.equal(deleted,0);
        let saved=0,cancelled=0;
        const composer=value=>React.createElement(TaskQuickComposer,{label:"Nueva tarea en Producción",value,onChange:()=>{},onSave:()=>saved++,onCancel:()=>cancelled++});
        root.render(composer(''));await waitFor(()=>document.querySelector('textarea'));assert.equal(document.querySelector('[type="submit"]').disabled,true);
        root.render(composer('Prueba'));await waitFor(()=>!document.querySelector('[type="submit"]').disabled);
        const field=document.querySelector('textarea');field.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));assert.equal(saved,0);
        field.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(saved,0);
        field.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(saved,1);assert.equal(field.value,'Prueba');
        field.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(cancelled,1);
        const {TaskTimeline}=await server.ssrLoadModule(path.resolve("../tareas/src/task_timeline.jsx"));
        const schedule=[{id:"scheduled",title:"Entrega de campaña",assignee_id:"person",start_date:"2026-10-01",due_date:"2026-10-05"},{id:"no-date",title:"Revisar propuesta"}];
        const original=structuredClone(schedule),opened=[];
        root.render(React.createElement(TaskTimeline,{tasks:schedule,members:[{id:"person",name:"Responsable"}],onSelect:id=>opened.push(id)}));
        await waitFor(()=>document.querySelector('.bold_timeline_bar'));assert.equal(document.querySelector('.bold_timeline_person strong').textContent,'Responsable');
        document.querySelector('.bold_timeline_bar').click();assert.deepEqual(opened,['scheduled']);
        document.querySelector('[aria-label="Período siguiente del cronograma"]').click();await waitFor(()=>document.querySelector('.bold_timeline_empty_period'));
        assert.equal(document.querySelector('.bold_timeline_bar'),null);
        document.querySelector('.bold_timeline_empty_period button').click();await waitFor(()=>document.querySelector('.bold_timeline_bar'));
        const scale=document.querySelector('[aria-label="Período del cronograma"]');scale.value='month';scale.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
        await waitFor(()=>document.querySelectorAll('.bold_month_cell[data-day]').length===31);
        document.querySelector('.bold_timeline_undated button').click();assert.deepEqual(opened,['scheduled','no-date']);assert.deepEqual(schedule,original);
        assert.equal(document.querySelector('.bold_timeline_header'),null);
        const status=document.querySelector('[aria-label="Estado de tareas del cronograma"]');status.value='completed';status.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
        await waitFor(()=>document.querySelectorAll('.bold_month_task').length===0);
        status.value='all';status.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await waitFor(()=>document.querySelector('.bold_month_task'));
        const crowded=Array.from({length:10},(_,i)=>({id:`crowd-${i}`,title:`Tarea ${i}`,due_date:'2026-10-08'}));
        root.render(React.createElement(TaskTimeline,{tasks:crowded,onSelect:id=>opened.push(id)}));
        await waitFor(()=>document.querySelector('.bold_month_overflow'));assert.equal(document.querySelectorAll('.bold_month_task').length,3);
        document.querySelector('.bold_month_overflow').click();await waitFor(()=>document.querySelector('.bold_month_day_popup'));
        assert.equal(document.querySelectorAll('.bold_month_day_task').length,10);document.querySelectorAll('.bold_month_day_task')[9].click();
        assert.equal(opened.at(-1),'crowd-9');

        const currentSchedule=[{id:'current',title:'Entrega de hoy',due_date:today}];
        root.render(React.createElement(TaskTimeline,{key:'today',tasks:currentSchedule,onSelect:id=>opened.push(id)}));
        await waitFor(()=>document.querySelector('.bold_timeline_today'));
        assert.equal(document.querySelectorAll('.bold_timeline_today').length,1);
        assert.equal(document.querySelector('.bold_timeline_today').getAttribute('aria-hidden'),'true');
        const currentBar=document.querySelector('.bold_timeline_bar');
        root.render(React.createElement(TaskTimeline,{key:'today',tasks:[{...currentSchedule[0],title:'Entrega actualizada'}],onSelect:id=>opened.push(id)}));
        await waitFor(()=>currentBar.textContent==='Entrega actualizada');
        assert.equal(document.querySelector('.bold_timeline_bar'),currentBar,'background updates preserve the mounted bar');
        const currentScale=document.querySelector('[aria-label="Período del cronograma"]');
        currentScale.value='7';currentScale.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
        await waitFor(()=>document.querySelectorAll('.bold_timeline_day').length===7);
        assert.notEqual(document.querySelector('.bold_timeline_bar'),currentBar,'changing view replays the bar entrance');
        document.querySelector('.bold_timeline_bar').click();assert.equal(opened.at(-1),'current');
        document.querySelector('[aria-label="Período siguiente del cronograma"]').click();
        await waitFor(()=>!document.querySelector('.bold_timeline_today'));
        assert.deepEqual(currentSchedule,[{id:'current',title:'Entrega de hoy',due_date:today}]);

        const {TaskMotion,SectionCollapse}=await server.ssrLoadModule(path.resolve('../tareas/src/task_motion.jsx'));
        const preference=new dom.window.EventTarget();preference.matches=false;
        dom.window.matchMedia=()=>preference;
        const animations=[];
        dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
            if(!this.dataset.taskId || this.hidden)return {width:0,height:0,left:0,top:0};
            return {width:200,height:50,left:Number(this.parentElement.dataset.x||0),top:[...this.parentElement.children].indexOf(this)*50+Number(this.parentElement.dataset.y||0)};
        };
        dom.window.HTMLElement.prototype.animate=function(frames,options){
            const animation={id:this.dataset.taskId,frames,options,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.();}};
            animations.push(animation);return animation;
        };
        const motion=(ids,key)=>React.createElement(TaskMotion,{motionKey:key,className:'motion-test'},
            ids.map(id=>React.createElement('div',{key:id,'data-task-id':id},id)),
            React.createElement('div',{'data-task-id':'hidden',hidden:true}));
        root.render(motion(['a','b','c'],'pending'));await waitFor(()=>document.querySelector('.motion-test'));
        assert.equal(animations.length,0);
        root.render(motion(['b','c','a'],'completed'));await waitFor(()=>animations.length===3);
        assert.deepEqual([...document.querySelectorAll('.motion-test div:not([hidden])')].map(e=>e.dataset.taskId),['b','c','a']);
        assert.equal(animations.find(a=>a.id==='a').frames[0].translate,'0px -100px');
        assert.equal(animations.find(a=>a.id==='b').frames[0].translate,'0px 50px');
        assert.equal(animations[0].options.duration,320);
        // Rapid reopen (or a rejected save rollback) replaces the running motion.
        root.render(motion(['a','b','c'],'pending'));await waitFor(()=>animations.length===6);
        assert.ok(animations.slice(0,3).every(a=>a.cancelled));
        assert.equal(animations.at(-3).frames[0].translate,'0px 100px');
        root.render(motion(['a','b','c'],'pending'));await settle();assert.equal(animations.length,6);
        preference.matches=true;preference.dispatchEvent(new dom.window.Event('change'));
        assert.ok(animations.every(a=>a.cancelled));

        root.render(motion(['b','c','a'],'completed'));await settle();assert.equal(animations.length,6);
        preference.matches=false;
        root.render(motion(['a','b','c'],'pending'));await waitFor(()=>animations.length===9);
        root.render(React.createElement('div',null,'Final'));await waitFor(()=>!document.querySelector('.motion-test'));
        assert.ok(animations.every(a=>a.cancelled));

        let dragEnded=0;
        const grouped=destination=>React.createElement(TaskMotion,{motionKey:destination,onDragEndCapture:()=>dragEnded++},
            ['a','b'].map((section,index)=>React.createElement('section',{key:section,className:'task_group','data-section-id':section,'data-y':index*200},
                React.createElement('header',null,section),
                section===destination && React.createElement('article',{draggable:true,'data-task-id':'moving'},'Moving'))));
        root.render(grouped('a'));await waitFor(()=>document.querySelector('[data-task-id="moving"]'));
        let moving=document.querySelector('[data-task-id="moving"]');
        const source=document.querySelector('[data-section-id="a"]'),target=document.querySelector('[data-section-id="b"]');
        moving.dispatchEvent(new Event('dragstart',{bubbles:true}));
        target.dispatchEvent(new Event('dragover',{bubbles:true}));
        assert.equal(target.dataset.taskDrop,'true');assert.equal(source.dataset.taskDrop,undefined);
        source.dispatchEvent(new Event('dragover',{bubbles:true}));assert.equal(target.dataset.taskDrop,undefined);
        target.dispatchEvent(new Event('dragover',{bubbles:true}));
        const inside=new Event('dragleave',{bubbles:true});Object.defineProperty(inside,'relatedTarget',{value:target.firstChild});target.dispatchEvent(inside);
        assert.equal(target.dataset.taskDrop,'true','crossing child nodes retains the same destination');
        const outside=new Event('dragleave',{bubbles:true});Object.defineProperty(outside,'relatedTarget',{value:source});target.dispatchEvent(outside);
        assert.equal(target.dataset.taskDrop,undefined);
        target.dispatchEvent(new Event('dragover',{bubbles:true}));moving.dispatchEvent(new Event('dragend',{bubbles:true}));
        assert.equal(target.dataset.taskDrop,undefined);assert.equal(dragEnded,1,'cancelled dragging cleans up and preserves the caller');
        source.firstChild.dispatchEvent(new Event('dragstart',{bubbles:true}));target.dispatchEvent(new Event('dragover',{bubbles:true}));
        assert.equal(target.dataset.taskDrop,undefined,'section reordering does not zoom task destinations');
        moving.dispatchEvent(new Event('dragstart',{bubbles:true}));target.dispatchEvent(new Event('dragover',{bubbles:true}));
        target.dispatchEvent(new Event('drop',{bubbles:true}));assert.equal(target.dataset.taskDrop,undefined);
        const beforeMove=animations.length;
        root.render(grouped('b'));await waitFor(()=>animations.length>beforeMove);
        assert.equal(document.querySelector('[data-task-id="moving"]').parentElement.dataset.sectionId,'b');
        assert.equal(animations.at(-1).frames[0].translate,'0px -200px','a task moves smoothly between different sections');
        moving=document.querySelector('[data-task-id="moving"]');moving.draggable=false;
        moving.dispatchEvent(new Event('dragstart',{bubbles:true}));source.dispatchEvent(new Event('dragover',{bubbles:true}));
        assert.equal(source.dataset.taskDrop,undefined,'read-only cards cannot start destination effects');
        root.render(React.createElement('div',null,'Final'));await waitFor(()=>!document.querySelector('[data-task-id="moving"]'));

        const taskRect=dom.window.HTMLElement.prototype.getBoundingClientRect;
        dom.window.HTMLElement.prototype.getBoundingClientRect=function(){
            if(this.classList.contains('task_section_collapse'))return {width:200,height:this.style.height==='0px'?0:this.querySelectorAll('[data-task-id]').length*50};
            return taskRect.call(this);
        };
        const collapse=open=>React.createElement(SectionCollapse,{open},()=>['a','b','c'].map(id=>React.createElement('button',{key:id,'data-task-id':id},id)));
        root.render(collapse(false));await waitFor(()=>document.querySelector('.task_section_collapse'));
        assert.equal(document.querySelector('.task_section_content').children.length,0);
        const beforeExpand=animations.length;
        root.render(collapse(true));await waitFor(()=>animations.length>beforeExpand);
        assert.deepEqual(animations.at(-1).frames,[{height:'0px'},{height:'150px'}]);
        assert.equal(document.querySelector('.task_section_collapse').hasAttribute('inert'),false);
        const expanding=animations.at(-1);
        root.render(collapse(false));await waitFor(()=>animations.at(-1)!==expanding);
        assert.equal(expanding.cancelled,true);
        assert.deepEqual(animations.at(-1).frames,[{height:'150px'},{height:'0px'}]);
        assert.equal(document.querySelector('.task_section_content').children.length,3,'closing retains visible content until motion finishes');
        assert.equal(document.querySelector('.task_section_collapse').getAttribute('aria-hidden'),'true');
        assert.equal(document.querySelector('.task_section_collapse').hasAttribute('inert'),true);
        const closing=animations.at(-1);
        root.render(collapse(true));await waitFor(()=>animations.at(-1)!==closing);
        assert.equal(closing.cancelled,true,'rapid reopen replaces closing motion');
        animations.at(-1).onfinish();await settle();
        assert.equal(document.querySelector('.task_section_collapse').style.overflow,'','expanded popovers are not clipped');
        root.render(collapse(false));await waitFor(()=>document.querySelector('[inert]'));
        animations.at(-1).onfinish();await waitFor(()=>document.querySelector('.task_section_content').children.length===0);
        preference.matches=true;preference.dispatchEvent(new dom.window.Event('change'));
        const reducedCount=animations.length;
        root.render(collapse(true));await waitFor(()=>document.querySelector('.task_section_content').children.length===3);
        root.render(collapse(false));await waitFor(()=>document.querySelector('.task_section_content').children.length===0);
        assert.equal(animations.length,reducedCount,'reduced motion applies the open state immediately');
        preference.matches=false;
        root.render(collapse(true));await waitFor(()=>animations.length>reducedCount);
        const unmounting=animations.at(-1);
        root.render(React.createElement('div',null,'Final'));await waitFor(()=>!document.querySelector('.task_section_collapse'));
        assert.equal(unmounting.cancelled,true);


    }finally{
        root.unmount();await settle();await server.close();dom.window.close();
        for(const key of names){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else delete globalThis[key];}
    }
});


test("date picker keeps ranges, shortcuts, keyboard and form dates without changing times", async () => {
    const dom = new JSDOM('<!doctype html><html><body><div id="date-root"></div></body></html>', {url:'http://localhost/',pretendToBeVisual:true});
    const names=['window','document','navigator','HTMLElement','Element','Node','Event','KeyboardEvent','MouseEvent','requestAnimationFrame','cancelAnimationFrame'];
    const descriptors=Object.fromEntries(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of names) Object.defineProperty(globalThis,key,{configurable:true,value:typeof dom.window[key]==='function' && key.includes('AnimationFrame') ? dom.window[key].bind(dom.window) : dom.window[key]});
    const server=await createServer({configFile:false,root:process.cwd(),logLevel:'error',resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-date-picker-ui'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
    const {default:React}=await import('react'), {createRoot}=await import('react-dom/client');
    const {DatePicker,CalendarDateRangeField}=await server.ssrLoadModule(path.resolve('shared/date_picker.jsx'));
    const {pickerDate,pickerDay,shiftPickerDay,mergeDateRange}=await server.ssrLoadModule(path.resolve('shared/date_picker_data.js'));
    const root=createRoot(document.getElementById('date-root'));
    const settle=()=>new Promise(resolve=>setTimeout(resolve,25)), waitFor=async predicate=>{const end=Date.now()+4000;while(!predicate()&&Date.now()<end)await settle();assert.ok(predicate());};
    const render=props=>root.render(React.createElement('div',null,React.createElement('button',{id:'date-anchor'},'Fecha'),React.createElement(DatePicker,props)));
    const day=value=>document.querySelector(`[data-day="${value}"]`);
    try {
        assert.equal(pickerDate('2026-02-30'),null); assert.equal(shiftPickerDay('2028-02-28',1),'2028-02-29');
        assert.equal(shiftPickerDay('2026-12-31',1),'2027-01-01');
        assert.deepEqual(mergeDateRange('2026-09-05T09:30','2026-09-08T11:45',{start:'2026-10-01',end:'2026-10-04'}),{start:'2026-10-01T09:30',end:'2026-10-04T11:45'});
        let applied=[],closed=0;
        render({range:true,start:'2026-09-05',end:'2026-09-08',onApply:value=>applied.push(value),onClose:()=>closed++});
        await waitFor(()=>day('2026-09-05')); assert.match(document.querySelector('.bold_date_duration').textContent,/3 días/);
        assert.equal(document.querySelectorAll('.bold_date_range_fill').length,5);
        day('2026-09-08').click();await settle();day('2026-09-05').click();await settle();
        assert.equal(applied.length,0); document.querySelector('.bold_date_apply').click();
        assert.deepEqual(applied.pop(),{start:'2026-09-05',end:'2026-09-08'});
        [...document.querySelectorAll('.bold_date_presets button')].find(e=>e.textContent==='2 semanas').click();await settle();
        document.querySelector('.bold_date_apply').click(); assert.deepEqual(applied.pop(),{start:'2026-09-05',end:'2026-09-19'});
        assert.equal(document.querySelector('.bold_date_clear').disabled,true);
        day('2026-09-30').focus();day('2026-09-30').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'PageDown',bubbles:true,cancelable:true}));
        await waitFor(()=>document.activeElement?.getAttribute('data-day')==='2026-10-30');
        document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
        assert.equal(closed,1);assert.equal(document.activeElement.id,'date-anchor');
        root.render(React.createElement('form',null,React.createElement(CalendarDateRangeField,{startName:'start',endName:'end',defaultStart:'2026-09-05'})));
        await waitFor(()=>document.querySelector('.bold_date_range_field'));document.querySelector('.bold_date_range_field button').click();await waitFor(()=>document.querySelector('.bold_date_apply'));
        assert.equal(document.querySelector('.bold_date_apply').disabled,false); // A project's finish remains optional.
        [...document.querySelectorAll('.bold_date_presets button')].find(e=>e.textContent==='1 semana').click();await settle();document.querySelector('.bold_date_apply').click();
        await waitFor(()=>!document.querySelector('.bold_date_picker'));
        assert.equal(document.querySelector('[name=start]').value,'2026-09-05');assert.equal(document.querySelector('[name=end]').value,'2026-09-12');
        document.querySelector('form').reset();await waitFor(()=>document.querySelector('[name=end]').value==='');assert.equal(document.querySelector('[name=start]').value,'2026-09-05');
        root.unmount();await settle();
        const single=createRoot(document.getElementById('date-root'));
        single.render(React.createElement('div',null,React.createElement('button',null,'Fecha'),React.createElement(DatePicker,{value:'2026-09-05',onApply:value=>applied.push(value),onClear:()=>closed++})));
        await waitFor(()=>document.querySelector('.bold_date_presets'));
        [...document.querySelectorAll('.bold_date_presets button')].find(e=>e.textContent==='Mañana').click();await settle();document.querySelector('.bold_date_apply').click();
        assert.equal(applied.pop(),shiftPickerDay(pickerDay(new Date()),1));document.querySelector('.bold_date_clear').click();assert.equal(closed,2);
        single.unmount();await settle();
    } finally {
        if(document.querySelector('.bold_date_picker'))root.unmount();await server.close();dom.window.close();
        for(const key of names){if(descriptors[key])Object.defineProperty(globalThis,key,descriptors[key]);else delete globalThis[key];}
    }
});

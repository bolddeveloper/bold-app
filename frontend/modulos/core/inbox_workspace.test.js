import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';

test('inbox search, true mentions, selection, context and reply drafts keep the correct task',async()=>{
    const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
    const keys=['window','document','navigator','HTMLElement','Element','Node','DOMParser','Event','CustomEvent','KeyboardEvent','MutationObserver','BroadcastChannel'];
    const originals=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
    dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    dom.window.HTMLElement.prototype.attachEvent=function(){};dom.window.HTMLElement.prototype.detachEvent=function(){};
    const server=await createServer({configFile:false,logLevel:'error',define:{'import.meta.env.VITE_USE_REAL_BACKEND':'"false"'},resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic'},cacheDir:path.join(os.tmpdir(),'bold-inbox-workspace-ui'),optimizeDeps:{noDiscovery:true,entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
    let root;
    try {
        const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
        const {default:Inbox}=await server.ssrLoadModule(path.resolve('../tareas/src/inbox_module.jsx'));
        const calls=[],tasks=[{id:'one',title:'Tarea uno',comments:[]},{id:'two',title:'Tarea dos',comments:[]}];let fail=false;
        function Preview(){
            const [rows,setRows]=React.useState([{id:'mention',title:'Mención real',body:'Revisa la entrega',type:'comment.mentioned',task:'one',actor_name:'Álex Gómez'}, {id:'comment',title:'Comentario simple',type:'comment.created',task:'two',actor_name:'Bea'}, {id:'other',title:'Tarea uno',body:'Sin vínculo explícito',actor_name:'BOLD'}]);
            const [tab,setTab]=React.useState('activity'),[query,setQuery]=React.useState(''),[filters,setFilters]=React.useState({state:'all',type:'all',project_id:'all',sort:'recent'}),[selected,setSelected]=React.useState(null),[checked,setChecked]=React.useState([]),[saved,setSaved]=React.useState([]),[archived,setArchived]=React.useState([]),[detail,setDetail]=React.useState(false);
            return React.createElement(Inbox,{notifications:rows,tasks,projects:[],directory:[],inbox_tab:tab,set_inbox_tab:setTab,inbox_query:query,set_inbox_query:setQuery,inbox_filters:filters,set_inbox_filters:setFilters,selected_inbox_id:selected,inbox_selected_ids:checked,set_inbox_selected_ids:setChecked,saved_inbox_ids:saved,archived_inbox_ids:archived,
                inbox_detail_open:detail,close_inbox_detail:()=>setDetail(false),handle_inbox_activity_select:id=>{setDetail(true);setSelected(id);setRows(items=>items.map(item=>item.id===id?{...item,is_read:true}:item));},handle_toggle_inbox_saved:id=>setSaved(items=>items.includes(id)?items.filter(value=>value!==id):[...items,id]),handle_toggle_inbox_archive:id=>setArchived(items=>items.includes(id)?items.filter(value=>value!==id):[...items,id]),handle_toggle_inbox_read:id=>setRows(items=>items.map(item=>item.id===id?{...item,is_read:!item.is_read}:item)),handle_inbox_bulk_read_state:(read,ids)=>calls.push(['bulk',read,ids]),handle_mark_notifications_read(){},onSettings(){},onOpenContext:item=>calls.push(['context',item.id,item.taskId]),onReply:async(id,body)=>{calls.push(['reply',id,body]);if(fail)throw new Error('Sin conexión');return true;}});
        }
        root=createRoot(document.getElementById('root'));root.render(React.createElement(Preview));
        const wait=async predicate=>{const end=Date.now()+3500;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(predicate());};
        const button=name=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===name||node.getAttribute('aria-label')===name);
        const search=value=>{const input=document.querySelector('[aria-label="Buscar en la bandeja"]');Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
        const edit=value=>{const node=document.querySelector('[contenteditable="true"]');node.innerHTML=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
        await wait(()=>document.querySelectorAll('.inbox_v3_item').length===3);
        assert.match(document.querySelector('.inbox_v3_item').textContent,/Álex Gómez/);button('Abrir detalles de Tarea uno').click();assert.deepEqual(calls.at(-1),['context','mention','one']);
        button('Sin leer3').click();button('Ver aviso: Mención real').click();await wait(()=>document.querySelectorAll('.inbox_v3_item').length===2);assert.match(document.querySelector('.inbox_v3_task_context').textContent,/Tarea uno/,'Marking read must not switch the reply target');button('Todas3').click();
        button('Menciones1').click();await wait(()=>document.querySelectorAll('.inbox_v3_item').length===1);
        button('Todas3').click();await wait(()=>document.querySelectorAll('.inbox_v3_item').length===3);
        edit('Borrador uno');button('Ver aviso: Comentario simple').click();await wait(()=>document.querySelector('.inbox_v3_task_context').textContent.includes('Tarea dos'));
        edit('Borrador dos');button('Ver aviso: Mención real').click();await wait(()=>document.querySelector('[contenteditable="true"]').textContent==='Borrador uno');
        fail=true;button('Enviar comentario').click();await wait(()=>document.querySelector('[role="alert"]'));assert.equal(document.querySelector('[contenteditable="true"]').textContent,'Borrador uno');
        fail=false;button('Enviar comentario').click();await wait(()=>!document.querySelector('[contenteditable="true"]').textContent);assert.deepEqual(calls.at(-1),['reply','one','<!--bold-rich-text-->Borrador uno']);
        button('Ver aviso: Tarea uno').click();await wait(()=>!document.querySelector('[contenteditable="true"]'));assert.equal(button('Abrir contexto').disabled,true,'Missing IDs cannot open a guessed context');
        search('alex');await wait(()=>document.querySelectorAll('.inbox_v3_item').length===1);
        document.querySelector('[aria-label="Seleccionar avisos visibles"]').click();await wait(()=>document.querySelector('.inbox_v3_bulk'));button('Leer').click();assert.deepEqual(calls.at(-1),['bulk',true,['mention']]);
        search('');await wait(()=>document.querySelectorAll('.inbox_v3_item').length===3);button('Archivar: Mención real').click();await wait(()=>document.querySelectorAll('.inbox_v3_item').length===2);
        button('Archivadas1').click();await wait(()=>document.querySelectorAll('.inbox_v3_item').length===1);button('Restaurar: Mención real').click();await wait(()=>document.querySelectorAll('.inbox_v3_item').length===0);
    } finally {root?.unmount();await new Promise(resolve=>setTimeout(resolve,30));await server.close();dom.window.close();for(const key of keys){if(originals[key])Object.defineProperty(globalThis,key,originals[key]);else delete globalThis[key];}}
});

import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<button id="trigger">Enlazar</button><div id="root"></div>',{url:'http://localhost:5192',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','Event','CustomEvent'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const server=await createServer({configFile:false,resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-page-links-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {pageApi}=await load('../mensajeria/page_api.js'),{PageLinkPicker,PageBacklinks}=await load('../mensajeria/page_link_controls.jsx'),{ReadBlocks}=await load('../mensajeria/page_blocks.jsx');
const {default:CollaborativeField}=await load('../mensajeria/collaborative_field.jsx');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,root=createRoot(document.getElementById('root'));
const pause=()=>new Promise(resolve=>setTimeout(resolve,25)),waitFor=async predicate=>{const end=Date.now()+5000;while(!predicate() && Date.now()<end)await pause();assert.ok(predicate(),'expected page links UI state');};
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
const input=(label,value)=>{const field=[...document.querySelectorAll('input')].find(node=>node.closest('label')?.textContent===label);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));};
const target={available:true,id:id(3),title:'Manual <script>literal</script>',channel_id:id(4),channel_name:'Canal permitido',block_ids:[id(5)]};
let chosen=null,queries=0,backReads=0,deny=0,opened=null,hold=false,release,lateSignal,failed=true;
pageApi.linkOptions=async(channel,page,query,_,options)=>{queries++;assert.equal(channel,id(1));assert.equal(page,id(2));assert.equal(query,'Manual');lateSignal=options.signal;if(hold)return new Promise(resolve=>release=resolve);if(failed)throw {status:503};return {results:[target],next:null};};
pageApi.backlinks=async()=>{backReads++;return {results:[target],next:null};};
const mountPicker=key=>root.render(React.createElement(PageLinkPicker,{key,channelId:id(1),pageId:id(2),onClose:()=>root.render(null),onSelect:(row,alias)=>{chosen={row,alias};root.render(null);},onDenied:()=>deny++}));
const submit=()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
try{
    root.render(React.createElement('div',null,
        React.createElement(CollaborativeField,{as:'input',field:'title',value:'Documento',editorRef:{current:null},onChange(){}}),
        React.createElement(CollaborativeField,{as:'input',field:id(8),value:'Alias',editorRef:{current:null},onChange(){}})));
    await waitFor(()=>document.querySelectorAll('input').length===2);
    assert.equal(document.querySelectorAll('.slack_collab_field.is_title').length,1,'aliases must not inherit the title size or intrinsic width');
    assert.equal(document.querySelectorAll('.slack_collab_field.is_single_line').length,2);
    root.render(null);await pause();
    document.getElementById('trigger').focus();mountPicker('one');await waitFor(()=>document.querySelector('input'));await pause();assert.equal(queries,0,'no automatic corpus lookup');
    input('Buscar página por título','Manual');submit();await waitFor(()=>document.querySelector('[role="alert"]'));assert.equal(chosen,null);
    failed=false;submit();await waitFor(()=>document.querySelector('.slack_task_results button'));
    assert.equal(document.querySelector('script'),null);document.querySelector('.slack_task_results button').click();await pause();
    const alias=[...document.querySelectorAll('input')].find(node=>node.closest('label')?.textContent==='Nombre opcional del enlace');assert.equal(alias.value,'','do not copy protected title to user-authored alias');
    input('Nombre opcional del enlace','Proceso acordado');await pause();button('Insertar enlace').click();await waitFor(()=>chosen);
    assert.equal(chosen.row.id,target.id);assert.equal(chosen.alias,'Proceso acordado');assert.equal(document.activeElement,document.getElementById('trigger'));
    root.render(React.createElement(ReadBlocks,{blocks:[{id:id(7),type:'page',text:'',page:target}],onPage:value=>opened=value}));await waitFor(()=>document.querySelector('.slack_page_link'));
    document.querySelector('.slack_page_link').click();assert.equal(opened.page_id,target.id);assert.equal(opened.channel_id,target.channel_id);
    root.render(React.createElement(ReadBlocks,{blocks:[{id:id(7),type:'page',text:'',page:{available:false}}],onPage:()=>assert.fail('hidden link clicked')}));await pause();assert.equal(document.querySelector('.slack_page_link'),null);assert.equal(document.body.textContent.includes(target.title),false);
    root.render(React.createElement(ReadBlocks,{blocks:[{id:id(7),type:'page',page_id:target.id,text:'',page:{available:false}}]}));await pause();assert.match(document.body.textContent,/Enlace pendiente de validar/);
    root.render(React.createElement(PageBacklinks,{channelId:id(1),pageId:id(2),onOpen:value=>opened=value,onDenied:()=>deny++}));await waitFor(()=>button('Páginas que enlazan aquí'));assert.equal(backReads,0);
    button('Páginas que enlazan aquí').click();await waitFor(()=>document.querySelector('.slack_page_backlinks li button'));assert.equal(backReads,1);document.querySelector('.slack_page_backlinks li button').click();assert.equal(opened.block_id,id(5));
    const idle=backReads;await pause();assert.equal(backReads,idle,'no idle polling');window.dispatchEvent(new CustomEvent('bold:slack-event',{detail:{payload:{channel_id:id(1),kind:'page.links_changed'}}}));await waitFor(()=>backReads>idle);
    root.render(React.createElement(PageBacklinks,{channelId:id(1),pageId:id(2),disabled:true,onOpen:()=>{},onDenied:()=>deny++}));await pause();assert.equal(document.querySelector('.slack_page_backlinks li'),null);
    hold=true;mountPicker('two');await waitFor(()=>document.querySelector('input'));input('Buscar página por título','Manual');submit();await waitFor(()=>release);root.render(null);await pause();assert.equal(lateSignal.aborted,true);release({results:[target],next:null});await pause();assert.equal(document.querySelector('.slack_task_results'),null);assert.equal(deny,0);
    console.log('Page links UI passed: deliberate lookup, retry, literal titles, non-copied alias, navigation, hidden references, lazy live backlinks, no idle polling and cancellation.');
}finally{root.unmount();await server.close();dom.window.close();}

// Synthetic document rendering/download contract. Native browser proof is separate.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5192',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','Element','MutationObserver','CustomEvent','Event','location'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const server=await createServer({configFile:false,resolve:{dedupe:['react','react-dom','lucide-react']},esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-document-media-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const {MessageMedia,MediaDraft}=await server.ssrLoadModule(`/@fs/${path.resolve('../mensajeria/message_media.jsx').replaceAll('\\','/')}`);
const root=createRoot(document.getElementById('root')),downloads=[],revoked=[];
let calls=[],pending=null,denied=false;
URL.createObjectURL=()=>`blob:document-${calls.length}`;URL.revokeObjectURL=url=>revoked.push(url);
dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push({url:this.href,name:this.download});};
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const message={id:b,conversation_id:a,media:{id:b,kind:'document',mime_type:'application/pdf',filename:'Informe <script>.pdf',size_bytes:100}};
const fetchMedia=async(container,id,options)=>{calls.push({container,id,signal:options.signal});if(pending)return new Promise(resolve=>{pending=resolve;});if(denied)throw {status:403};return new Blob(['synthetic PDF'],{type:'application/pdf'});};
const settle=()=>new Promise(resolve=>setTimeout(resolve,25));
async function waitFor(predicate){const end=Date.now()+5000;while(!predicate() && Date.now()<end)await settle();assert.ok(predicate(),'expected document UI state');}
const button=label=>[...document.querySelectorAll('button')].find(node=>node.textContent===label);
const mount=key=>root.render(React.createElement(MessageMedia,{key,message,fetchMedia}));
try{
    mount('one');await waitFor(()=>button('Descargar documento'));assert.equal(calls.length,0);
    assert.equal(document.querySelectorAll('img,audio,iframe,object,embed,script').length,0,'documents must never use an image/audio or active preview');
    assert.match(document.body.textContent,/<script>/);assert.match(document.body.textContent,/sin análisis antivirus/);
    button('Descargar documento').click();await waitFor(()=>downloads.length===1);assert.equal(downloads[0].name,'Informe script.pdf');
    button('Descargar documento').click();await waitFor(()=>downloads.length===2);assert.equal(calls.length,2,'every download reauthorizes, even after a previous success');
    assert.equal(calls[0].container,a);assert.equal(calls[0].id,b);assert.ok(revoked.includes('blob:document-1'));
    denied=true;button('Descargar documento').click();await waitFor(()=>document.querySelector('[role="alert"]'));assert.equal(downloads.length,2);denied=false;
    pending=true;button('Descargar documento').click();await waitFor(()=>typeof pending==='function');const last=calls.at(-1),release=pending;
    root.render(React.createElement(MediaDraft,{file:new File(['PDF bytes'],'plan.pdf',{type:'application/pdf'}),onRemove:()=>{},disabled:false}));
    await waitFor(()=>document.querySelector('.messaging_media_draft'));assert.equal(last.signal.aborted,true);release(new Blob(['late']));pending=null;await settle();assert.equal(downloads.length,2);
    assert.equal(document.querySelectorAll('img,audio,iframe,object,embed').length,0);assert.match(document.body.textContent,/plan.pdf/);
    assert.match(document.body.textContent,/Aún no enviado · 1 KB/,'non-empty small documents must not appear as zero KB');
    root.unmount();await settle();assert.ok(revoked.includes('blob:document-2'));
    console.log('Document UI passed: passive metadata, explicit authenticated downloads, no inline content, safe names, fresh ACLs, cancellation and draft display.');
}finally{await server.close();dom.window.close();}

import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5174'});
for(const key of ['window','document','navigator','HTMLElement','Event'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const server=await createServer({configFile:false,esbuild:{jsx:'automatic'},resolve:{dedupe:['react','react-dom']},cacheDir:path.join(os.tmpdir(),'bold-file-transfer-ui'),server:{middlewareMode:true,hmr:false},appType:'custom',optimizeDeps:{noDiscovery:true,include:[],entries:[]}});
const React=await import('react'),{createRoot}=await import('react-dom/client');
const {useFileTransfer,FileDropHint}=await server.ssrLoadModule(`/@fs/${path.resolve('shared/use_file_transfer.jsx').replaceAll('\\','/')}`);
const received=[],root=createRoot(document.getElementById('root')),settle=()=>new Promise(resolve=>setTimeout(resolve,25));
const image=new dom.window.File(['pixels'],'imagen.png',{type:'image/png'});
function Harness({disabled=false,context='one'}){
    const field=React.useRef(null),transfer=useFileTransfer({disabled,field,context,onFiles:files=>received.push(files)});
    return React.createElement('section',{id:'target',...transfer.bindings},
        transfer.dragging && React.createElement(FileDropHint),
        React.createElement('textarea',{ref:field,id:'composer'}),React.createElement('input',{id:'search'}),
        React.createElement('div',{id:'body'},'Mensajes'),
        React.createElement('div',{id:'child',onDrop:event=>{event.preventDefault();event.stopPropagation();}},'Editor que ya maneja su archivo'),
        React.createElement('div',{role:'dialog'},React.createElement('span',{id:'modal'},'Otro formulario')));
}
function transfer(type,target='#body',data={files:[image],types:['Files']}){
    const event=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,type==='paste' ? 'clipboardData':'dataTransfer',{value:data});document.querySelector(target).dispatchEvent(event);return event;
}
try{
    root.render(React.createElement(Harness));await settle();
    const over={types:['Files'],files:[],dropEffect:''};
    assert.ok(transfer('dragenter','#body',over).defaultPrevented);await settle();assert.ok(document.querySelector('.bold_file_drop_hint'));
    transfer('dragover','#body',over);assert.equal(over.dropEffect,'copy');
    transfer('dragenter','#composer',over);transfer('dragleave','#composer',over);await settle();assert.ok(document.querySelector('.bold_file_drop_hint'),'nested drag movement keeps the hint');
    assert.ok(transfer('drop').defaultPrevented);await settle();assert.equal(received.length,1);assert.equal(document.querySelector('.bold_file_drop_hint'),null);
    transfer('paste','#composer',{files:[image],items:[{kind:'file',getAsFile:()=>image}]});await settle();assert.equal(received.length,2);assert.equal(received[1].length,1,'files/items do not duplicate a clipboard image');
    transfer('paste','#composer',{items:[{kind:'file',getAsFile:()=>image}]});assert.equal(received.length,3,'clipboard items work when files is absent');
    assert.equal(transfer('paste','#composer',{files:[],getData:()=> 'Texto normal'}).defaultPrevented,false,'ordinary text keeps native paste');
    transfer('paste','#search');transfer('paste','#modal');transfer('drop','#modal');assert.equal(received.length,3,'another field or modal cannot attach to this composer');
    assert.equal(transfer('dragover','#body',{types:['application/x-bold-slack-organization']}).defaultPrevented,false,'channel/category moves are not file uploads');
    transfer('dragenter');await settle();transfer('drop','#child');await settle();assert.equal(document.querySelector('.bold_file_drop_hint'),null,'a child editor consuming the drop still clears the hint');assert.equal(received.length,3,'a consumed child event is not processed twice');
    transfer('dragenter');await settle();window.dispatchEvent(new Event('dragend'));await settle();assert.equal(document.querySelector('.bold_file_drop_hint'),null);
    transfer('dragenter');await settle();root.render(React.createElement(Harness,{context:'two'}));await settle();assert.equal(document.querySelector('.bold_file_drop_hint'),null,'changing channel clears a previous drag');
    root.render(React.createElement(Harness,{disabled:true}));await settle();const rejected={types:['Files'],files:[image],dropEffect:''};transfer('dragover','#body',rejected);assert.equal(rejected.dropEffect,'none');assert.ok(transfer('drop').defaultPrevented,'blocked files cannot navigate the page');transfer('paste','#composer');await settle();assert.equal(received.length,3,'locked or read-only composers accept no files');assert.equal(document.querySelector('.bold_file_drop_hint'),null);
    console.log('File transfers passed: scoped paste/drop, clipboard variants, no duplicates, nested drag feedback, locks, modal isolation and context changes.');
}finally{root.unmount();await server.close();dom.window.close();}

// Real React + WebCrypto, synthetic HTTP and storage. Native IndexedDB/browser
// and real-clock worker acceptance remain separate; this never contacts Google.
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {JSDOM} from 'jsdom';
import {createServer} from 'vite';
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:5193',pretendToBeVisual:true});
globalThis.BroadcastChannel=undefined;
for(const key of ['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','MutationObserver','Element','CustomEvent','Event'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);
const id='11111111-2222-4333-8444-555555555551',ruleId='11111111-2222-4333-8444-555555555552',projectId='11111111-2222-4333-8444-555555555553',statusId='11111111-2222-4333-8444-555555555554',templateId='11111111-2222-4333-8444-555555555555';
const channel={id,name:'Pruebas',can_read_automations:true,can_manage_automations:true,archived_at:null};
globalThis.__automationCore={account:{id:'11111111-2222-4333-8444-555555555556'},activeAssignment:{id:'11111111-2222-4333-8444-555555555557',chat_enabled:true},authorizationRevision:0,securityUncertain:false};
const rows=new Map(),receipts=new Map(),writes=[],projectCalls=[],confirmations=[];
let loseCreate=true,loseAction=true,sequence=1,dirty=false,denied=0;
const failure=status=>Object.assign(Error('Fallo sintético'),{status});
const clone=value=>structuredClone(value);
const rowFor=(values,identity)=>({id:identity,name:values.name,kind:values.kind,body:values.body || '',project_id:values.project_id || null,
    to_status_id:values.to_status_id || null,from_status_id:values.from_status_id || null,template_id:values.template_id || null,
    template_version:values.template_version || null,next_at:values.next_at || null,interval_days:values.interval_days || null,
    version:1,active:false,source_available:true,can_manage:true,pause_reason:'',created_at:new Date().toISOString()});
globalThis.__automationApi={
    list:async()=>({results:[...rows.values()].map(clone),next:null}),
    get:async(_,rule)=>{if(!rows.has(rule))throw failure(404);return clone(rows.get(rule));},
    create:async(_,values)=>{
        writes.push({action:'create',values:clone(values)});const prior=receipts.get(values.client_id);if(prior)return clone(rows.get(prior));
        const identity=sequence++===1 ? ruleId:crypto.randomUUID(),row=rowFor(values,identity);rows.set(identity,row);receipts.set(values.client_id,identity);
        if(loseCreate){loseCreate=false;throw failure(0);}return clone(row);
    },
    action:async(_,rule,values)=>{
        writes.push({action:'toggle',values:clone(values)});const row=rows.get(rule);if(receipts.has(values.client_id))return clone(row);
        if(row.version!==values.version)throw failure(409);row.active=values.active;row.version++;receipts.set(values.client_id,rule);
        if(loseAction){loseAction=false;throw failure(0);}return clone(row);
    },
    replace:async(_,rule,values)=>{writes.push({action:'replace',values:clone(values)});const row=rows.get(rule);if(row.version!==values.version)throw failure(409);Object.assign(row,rowFor(values,rule),{version:row.version+1});return clone(row);},
    projects:async(_,query)=>{projectCalls.push(query);return {results:[{id:projectId,name:'Proyecto visible',unit_name:'IT'}],next:null};},
    project:async()=>({id:projectId,name:'Proyecto visible',unit_name:'IT',statuses:[{id:statusId,name:'Completada',is_final:true}]}),
    runs:async()=>({results:[{id:crypto.randomUUID(),rule_version:2,state:'skipped',reason:'source_permission',attempts:1,created_at:new Date().toISOString(),task:{available:false}}],next:null}),
    audit:async()=>({results:[{id:crypto.randomUUID(),version:1,action:'created',created_at:new Date().toISOString()}],next:null}),
};
globalThis.__automationTemplates={list:async()=>({results:[{id:templateId,name:'Plantilla revisable',version:1}],next:null}),
    get:async()=>({id:templateId,name:'Plantilla revisable',title:'Página periódica',version:1,blocks:[{id,status:'',type:'paragraph',text:'Texto <script>literal</script>'}]})};
globalThis.__automationConfirm=async message=>{confirmations.push(message);return true;};
const replacements=[['/core/core_provider.jsx','export const useCore=()=>globalThis.__automationCore;'],
    ['/mensajeria/automation_api.js','export const automationApi=globalThis.__automationApi;'],
    ['/mensajeria/page_template_api.js','export const templateApi=globalThis.__automationTemplates;'],
    ['/core/shared/bold_dialog.js','export const confirmBold=globalThis.__automationConfirm;'],
    ['/core/http_client.js','export const http={request:async()=>{throw Error("Unexpected network");}};']];
const server=await createServer({configFile:false,plugins:[{name:'automation-fixture',enforce:'pre',transform(_,file){return replacements.find(([suffix])=>file.replaceAll('\\','/').endsWith(suffix))?.[1];}}],resolve:{dedupe:['react','react-dom','lucide-react']},
    esbuild:{jsx:'automatic',jsxImportSource:'react'},cacheDir:path.join(os.tmpdir(),'bold-automations-ui'),optimizeDeps:{noDiscovery:true,include:[],entries:[]},server:{middlewareMode:true,hmr:false},appType:'custom'});
const load=file=>server.ssrLoadModule(`/@fs/${path.resolve(file).replaceAll('\\','/')}`);
const {default:React}=await import('react'),{createRoot}=await import('react-dom/client');
const {createDraftVault}=await load('../mensajeria/draft_vault.js'),{draftService}=await load('../mensajeria/draft_service.js'),{protectPrivateWork}=await load('./shared/private_work.js');
const records=new Map(),vault=createDraftVault({storage:{get:async key=>records.get(key),put:async row=>records.set(row.id,row),remove:async key=>records.delete(key),purge:async()=>records.clear()}});
draftService.open=async resource=>{const scope={...resource,account_id:__automationCore.account.id,assignment_id:__automationCore.activeAssignment.id};return vault.open(scope,async()=>({scope,key:btoa('a'.repeat(32)),key_id:'a'.repeat(32),can_write:true,retention_seconds:604800}));};
draftService.purge=async()=>vault.purge();
const {default:Automations}=await load('../mensajeria/channel_automations.jsx'),{localSchedule}=await load('../mensajeria/automation_model.js');
let root;
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));
const wait=async(predicate,label)=>{const end=Date.now()+7000;while(!predicate() && Date.now()<end)await tick();assert.ok(predicate(),label || 'expected automation UI state');};
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent===text);
const input=(name,value)=>{const field=document.getElementById('auto-'+name);assert.ok(field,name);const prototype=field.tagName==='SELECT' ? HTMLSelectElement.prototype:field.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,value);field.dispatchEvent(new Event(field.tagName==='SELECT' ? 'change':'input',{bubbles:true}));};
const consent=()=>document.getElementById('auto-share_confirmed').click();
const submit=()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const mount=async()=>{root=createRoot(document.getElementById('root'));root.render(React.createElement(Automations,{channel,onDirty:value=>{dirty=value;},onDenied:()=>{denied++;}}));await wait(()=>document.querySelector('.slack_automations') && (channel.can_manage_automations ? button('Nueva regla') && !button('Nueva regla').disabled || button('Recuperar revisión de automatización'):true));await tick();};
const unmount=async()=>{root.unmount();await tick();};
try{
    await mount();button('Nueva regla').click();await wait(()=>document.querySelector('form'));submit();await wait(()=>document.querySelector('[role=alert]'));assert.equal(writes.length,0);assert.equal(document.activeElement,document.querySelector('[role=alert]'));
    input('kind','reminder');await tick();input('name','Recordatorio protegido');input('body','Texto privado de revisión');input('next_at',localSchedule(Date.now()+900000));await tick();consent();await tick();submit();
    await wait(()=>document.querySelector('[aria-label="Operación sin confirmar"]') && button('Reintentar el mismo intento') && !button('Reintentar el mismo intento').disabled);
    assert.equal(rows.size,1);assert.equal([...rows.values()][0].active,false);assert.equal(writes.length,1);assert.equal(dirty,true);
    assert.equal(await protectPrivateWork(),true);assert.ok(records.size);assert.equal(JSON.stringify([...records.values()]).includes('Texto privado de revisión'),false);
    const createToken=writes[0].values.client_id;await unmount();await mount();await wait(()=>button('Recuperar revisión de automatización'));
    assert.equal(writes.length,1,'mount/recovery prompt never sends');button('Recuperar revisión de automatización').click();await wait(()=>button('Reintentar el mismo intento') && !button('Reintentar el mismo intento').disabled);
    assert.equal(writes.length,1);button('Reintentar el mismo intento').click();await wait(()=>button('Revisar y activar') && !button('Revisar y activar').disabled);
    assert.equal(writes.length,2);assert.equal(writes[1].values.client_id,createToken);assert.equal(rows.size,1);
    button('Revisar y activar').click();await wait(()=>button('Reintentar el mismo intento') && !button('Reintentar el mismo intento').disabled);assert.equal(rows.get(ruleId).active,true);
    const actionToken=writes.at(-1).values.client_id;assert.equal(await protectPrivateWork(),true);await unmount();
    rows.get(ruleId).active=false;rows.get(ruleId).version++;rows.get(ruleId).pause_reason='worker_error';
    await mount();await wait(()=>button('Recuperar revisión de automatización'));button('Recuperar revisión de automatización').click();await wait(()=>button('Reintentar el mismo intento') && !button('Reintentar el mismo intento').disabled);
    const writesBefore=writes.length;await tick();assert.equal(writes.length,writesBefore);button('Reintentar el mismo intento').click();await wait(()=>button('Revisar configuración') && !button('Revisar configuración').disabled);
    assert.equal(writes.at(-1).values.client_id,actionToken);assert.equal(rows.get(ruleId).active,false,'old receipt must not reactivate a newer pause');assert.equal(writes.at(-1).values.version,1);
    button('Revisar configuración').click();await wait(()=>document.querySelector('form'));input('body','Mi revisión conservada');await tick();assert.equal(await protectPrivateWork(),true);const originalVersion=rows.get(ruleId).version;
    await unmount();rows.get(ruleId).version++;rows.get(ruleId).body='Cambio de otra pestaña';await mount();await wait(()=>button('Recuperar revisión de automatización'));button('Recuperar revisión de automatización').click();await wait(()=>document.getElementById('auto-body')?.value==='Mi revisión conservada');await tick();consent();await tick();submit();
    await wait(()=>writes.at(-1).action==='replace' && document.querySelector('[role=alert]'));
    assert.equal(writes.at(-1).values.version,originalVersion,'fresh read must not silently upgrade a recovered configuration version');assert.equal(rows.get(ruleId).body,'Cambio de otra pestaña');assert.equal(document.getElementById('auto-body').value,'Mi revisión conservada');
    button('Cancelar revisión').click();await wait(()=>button('Nueva regla') && !document.querySelector('form'));button('Nueva regla').click();await wait(()=>document.querySelector('form'));
    input('kind','recurring_page');await tick();button('Cargar plantillas del canal').click();await wait(()=>document.querySelector('#auto-template_id option[value="'+templateId+'"]'));input('template_id',templateId);await wait(()=>document.querySelector('[aria-label="Contenido de plantilla"]'));
    assert.equal(document.querySelector('script'),null);assert.ok(document.body.textContent.includes('Texto <script>literal</script>'));
    input('name','Página recurrente');input('interval_days','7');await tick();button('Dentro de cinco minutos').click();await tick();
    assert.equal(document.getElementById('auto-next_at').value,localSchedule(Date.now()+300000));
    assert.equal(document.getElementById('auto-share_confirmed').checked,false,'schedule presets require renewed consent');
    consent();await tick();submit();await wait(()=>writes.at(-1).values.kind==='recurring_page' && button('Revisar y activar'));
    assert.equal(writes.at(-1).values.template_version,1);assert.equal(writes.at(-1).values.body,undefined);
    button('Nueva regla').click();await wait(()=>document.querySelector('form'));input('name','Estado revisado');input('project-search','Proyecto');await tick();assert.equal(projectCalls.length,0,'typing does not poll');button('Buscar proyecto').click();await wait(()=>document.querySelector('#auto-project_id option[value="'+projectId+'"]'));input('project_id',projectId);await wait(()=>document.querySelector('#auto-to_status_id option[value="'+statusId+'"]'));input('to_status_id',statusId);await tick();consent();await tick();submit();await wait(()=>writes.at(-1).values.kind==='task_status' && button('Ver ejecuciones'));
    assert.equal(writes.at(-1).values.body,undefined);button('Ver ejecuciones').click();await wait(()=>document.querySelector('[aria-label="Registro de ejecuciones"]'));assert.ok(document.body.textContent.includes('Tarea no disponible con tus permisos actuales.'));
    button('Ver cambios de regla').click();await wait(()=>document.querySelector('[aria-label="Registro de cambios"]'));assert.ok(document.body.textContent.includes('Creada en pausa'));
    window.dispatchEvent(new Event('bold:permissions-invalidated'));await wait(()=>!document.querySelector('.slack_automations'));assert.equal(document.body.textContent.includes('Estado revisado'),false);await tick();assert.equal(records.size,0);await unmount();
    channel.can_manage_automations=false;await mount();assert.equal(button('Nueva regla'),undefined);
    console.log('Automation UI passed: accessible errors, encrypted create/action recovery, exact nonces, no auto-send, stale-version conflict, three forms, private history, revocation and read-only controls.');
}finally{if(root)root.unmount();await server.close();dom.window.close();}

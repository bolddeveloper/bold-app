// Synthetic browser contract only. No authentication, backend or provider access.
import React,{StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '../../../tareas/src/styles.css';
import '../../../administrativo/admin.css';
import '../../design_v3.css';
globalThis.__assistantCore={account:{id:'synthetic'},activeAssignment:{id:'it',assistant_enabled:true},authorizationRevision:1,securityUncertain:false};
const clone=value=>JSON.parse(JSON.stringify(value));
let store=JSON.parse(sessionStorage.getItem('synthetic-assistant-fixture')||'{"job":null,"writes":0}');
const persist=()=>sessionStorage.setItem('synthetic-assistant-fixture',JSON.stringify(store));
const changed=()=>window.dispatchEvent(new CustomEvent('bold:assistant-changed',{detail:{request_id:store.job.id}}));
const step=(id,title)=>({id,capability:'tasks.create',target:'',arguments:{title,priority:'Media'},depends_on:[]});
const proposal=()=>({version:store.job.version,summary:'Crear dos tareas en su departamento.',digest:'digest-'+store.job.version,steps:[step('one','Revisar texto'),step('two','Revisar diseño')],answer:'',labels:{},options:{}});
globalThis.__assistantApi={
    list:async()=>({results:store.job?[clone(store.job)]:[]}),get:async()=>clone(store.job),
    create:async body=>{store.job={id:body.client_id,text:body.text,state:'intent_queued',version:1,summary:'Preparar dos tareas.',scope:{modules:['tasks']},sources_available:true,receipts:[],proposal:null};persist();setTimeout(()=>{store.job.state='awaiting_scope';persist();changed();},50);return clone(store.job);},
    change:async(id,body)=>{if(body.version!==store.job.version)throw Error('La solicitud cambió.');store.job.version++;store.job.proposal={...store.job.proposal,version:store.job.version,steps:clone(body.steps),digest:'digest-'+store.job.version};persist();return clone(store.job);},
    act:async(id,action,body)=>{
        if(action==='prepare'){store.job.state='awaiting_approval';store.job.proposal=proposal();}
        if(action==='execute'){if(body.version!==store.job.version||body.digest!==store.job.proposal.digest)throw Error('Revisión no aprobada.');store.writes++;store.job.state='completed';store.job.execution_started=true;store.job.receipts=store.job.proposal.steps.map((s,index)=>({step_id:s.id,capability:s.capability,state:'completed',result:{id:'task-'+index}}));}
        if(action==='simulate')return {simulated:true,before:{tasks:0,completed:0,progress_percent:null,unknown_status:0},after:{tasks:2,completed:0,progress_percent:0,unknown_status:0},agenda:[],coverage:'Datos sintéticos del recorrido.',note:'No se aplicaron cambios.'};
        if(action==='cancel')store.job.state='cancelled';persist();return clone(store.job);
    },
    record:async(id,step)=>({capability:'tasks.create',record:{id:step,title:store.job.proposal.steps.find(row=>row.id===step).arguments.title,description:'Registro sintético autorizado'}}),
    activity:async()=>({requests:1,inferences:2,unknown_usage:1,usage:{input_tokens:120,cached_input_tokens:null,output_tokens:30},states:[{state:'completed',count:1}],note:'No mide productividad.'}),
};
window.__assistantStore=()=>store;
window.__revokeAssistantSource=()=>{store.job.proposal=null;store.job.receipts=[];store.job.sources_available=false;store.job.error='El acceso a las fuentes cambió.';persist();changed();};
const {default:Host,AssistantLauncher}=await import('../../../asistente/assistant_host.jsx');
createRoot(document.getElementById('root')).render(<StrictMode><div className="bold_v3"><AssistantLauncher label="Abrir asistente"/><Host/></div></StrictMode>);

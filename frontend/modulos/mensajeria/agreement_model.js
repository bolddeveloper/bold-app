import {agreementId} from './agreement_api.js';
export const initialAgreement=()=>({stage:'selection',selected:[],entries:[],title:'Acuerdos de conversación',introduction:'',destination:'',confirmed:false,touched:false});
export function agreementAttempt(form,clientId=crypto.randomUUID()){
    if(form.stage!=='review' || !agreementId(form.destination) || !form.confirmed || !form.title.trim() || !form.entries.length || form.entries.length>20)throw Error('Revisa los mensajes, el canal y la confirmación antes de crear la página.');
    return {client_id:clientId,destination_channel_id:form.destination,title:form.title.trim(),introduction:form.introduction,
        entries:form.entries.map(({message_id,source_version,text})=>({message_id,source_version,text})),share_confirmed:true};
}
export const agreementDraft=(form,attempt)=>form.touched || attempt ? {payload:{version:1,purpose:'message-agreement',form,attempt},files:[]}:null;
export function restoreAgreement(payload,files=[]){
    if(payload?.version!==1 || payload.purpose!=='message-agreement' || files.length || !payload.form || typeof payload.form!=='object')throw Error('La revisión conservada no es válida.');
    const form={...initialAgreement(),...payload.form},keys=new Set(Object.keys(initialAgreement()));
    if(Object.keys(payload.form).some(key=>!keys.has(key)) || !['selection','review'].includes(form.stage) || typeof form.title!=='string' || !form.title.trim() || form.title.length>160 || typeof form.introduction!=='string' || form.introduction.length>4000 || typeof form.destination!=='string' || form.destination && !agreementId(form.destination) || typeof form.confirmed!=='boolean' || typeof form.touched!=='boolean' || !Array.isArray(form.selected) || form.selected.length>20 || form.selected.some(value=>!agreementId(value)) || new Set(form.selected).size!==form.selected.length || !Array.isArray(form.entries) || form.entries.length>20)throw Error('La revisión conservada no está completa.');
    for(const row of form.entries)if(!row || Object.keys(row).some(key=>!['message_id','source_version','text','source_text'].includes(key)) || !agreementId(row.message_id) || !Number.isSafeInteger(row.source_version) || row.source_version<1 || typeof row.text!=='string' || row.text.length>10000 || typeof row.source_text!=='string' || row.source_text.length>5000)throw Error('El texto conservado de un mensaje no es válido.');
    if(form.stage==='review' && (!form.entries.length || form.entries.length!==form.selected.length || form.entries.some((row,index)=>row.message_id!==form.selected[index])))throw Error('La selección no coincide con la revisión.');
    const attempt=payload.attempt;
    if(attempt){if(!agreementId(attempt.client_id))throw Error('El intento conservado no es válido.');const rebuilt=agreementAttempt({...form,confirmed:true},attempt.client_id);if(JSON.stringify(Object.entries(rebuilt).sort())!==JSON.stringify(Object.entries(attempt).sort()))throw Error('El intento no coincide con el texto aprobado.');}
    return {form:{...form,confirmed:false},attempt:attempt || null};
}
export function toggleAgreement(selected,identity){
    if(!agreementId(identity))throw Error('Mensaje no válido.');
    if(selected.includes(identity))return selected.filter(value=>value!==identity);
    if(selected.length>=20)throw Error('Puedes seleccionar hasta veinte mensajes por página.');
    return [...selected,identity];
}

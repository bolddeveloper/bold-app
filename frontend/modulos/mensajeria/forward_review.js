// A private, encrypted review, not a copy of the loaded conversation history.
import {canForward,createForwardBatch,MAX_FORWARD_MESSAGES} from './message_forwarding.js';
import {imageFileError} from './media_helpers.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const source=row=>({id:row.id,conversation_id:row.conversation_id,version:row.version,created_at:row.created_at,body:row.body || '',...(row.media ? {media:{kind:'image'}}:{})});
export const forwardAttemptKey=(row,employee)=>`${row.conversation_id}:${row.id}:${row.version}:${employee}`;
export function createForwardReview(rows){
    if(!Array.isArray(rows) || rows.some(row=>!canForward(row)))throw Error('Selecciona mensajes de texto o imágenes para revisar su reenvío.');
    return {batch:createForwardBatch(rows.map(source)),attempts:new Map()};
}
export function captureForwardReview(review){
    if(!review?.batch.pending.length)return {payload:null,files:[]};
    const files=[];
    const attempts=[...review.attempts.entries()].map(([key,row])=>({key,id:row.id,body:row.body,source:source(row.source),write_started:!!row.writeStarted,destination_id:row.destinationId || null,file_index:row.file ? files.push(row.file)-1:null}));
    return {payload:{version:1,pending:review.batch.pending.map(source),total:review.batch.total,confirmed:review.batch.confirmed,discarded:review.batch.discarded || 0,employee_id:review.batch.employeeId,attempts},files};
}
export function restoreForwardReview(payload,files=[],conversationId){
    const fail=()=>{throw Error('La revisión de reenvío conservada no es válida. No se ha enviado ningún mensaje.');};
    if(payload?.version!==1 || !Array.isArray(payload.pending) || !Array.isArray(payload.attempts) || payload.attempts.length>MAX_FORWARD_MESSAGES || !Number.isInteger(payload.total) || payload.total<1 || payload.total>MAX_FORWARD_MESSAGES || !Number.isInteger(payload.confirmed) || payload.confirmed<0 || !Number.isInteger(payload.discarded) || payload.discarded<0 || payload.confirmed+payload.discarded+payload.pending.length!==payload.total || payload.employee_id!==null && !UUID.test(payload.employee_id))fail();
    for(const row of payload.pending)if(!UUID.test(row.id) || row.conversation_id!==conversationId || !Number.isInteger(row.version) || row.version<1 || typeof row.body!=='string' || row.body.length>5000 || !canForward(row) || row.media && row.media.kind!=='image')fail();
    if(new Set(payload.pending.map(row=>row.id)).size!==payload.pending.length || files.length>MAX_FORWARD_MESSAGES)fail();
    const review=createForwardReview(payload.pending);review.batch.total=payload.total;review.batch.confirmed=payload.confirmed;review.batch.discarded=payload.discarded;review.batch.employeeId=payload.employee_id;
    const nonces=new Set();let bytes=0;
    for(const row of payload.attempts){
        const original=review.batch.pending.find(item=>item.id===row.source?.id);
        if(!original || !payload.employee_id || row.key!==forwardAttemptKey(original,payload.employee_id) || review.attempts.has(row.key) || !UUID.test(row.id) || nonces.has(row.id) || row.body!==original.body || JSON.stringify(source(row.source))!==JSON.stringify(source(original)) || typeof row.write_started!=='boolean' || row.destination_id!==null && !UUID.test(row.destination_id) || row.write_started && !row.destination_id)fail();
        nonces.add(row.id);let file;
        if(row.file_index!==null){
            if(!original.media || !Number.isInteger(row.file_index) || row.file_index<0 || row.file_index>=files.length)fail();
            file=files[row.file_index];if(imageFileError(file))fail();bytes+=file.size;
        }
        if(original.media && row.write_started && !file)fail();
        review.attempts.set(row.key,{id:row.id,body:row.body,source:source(original),file,writeStarted:row.write_started,destinationId:row.destination_id});
    }
    if(bytes>50*1024*1024)fail();
    return review;
}

// Resolve each uncertain nonce before dropping the review. Published messages
// are reported, never removed. A failed/unknown stop keeps that item recoverable.
export async function discardForwardReview(review,api,{signal,checkpoint=async()=>{},onPublished=()=>{}}={}){
    if(review.batch.running)throw Error('Detén la espera antes de descartar el reenvío.');
    let cancelled=0,published=0;
    while(review.batch.pending.length){
        signal?.throwIfAborted();const row=review.batch.pending[0],key=forwardAttemptKey(row,review.batch.employeeId),attempt=review.attempts.get(key);
        let wasPublished=false;
        if(attempt?.writeStarted){
            const result=await api.discardMedia(attempt.destinationId,attempt.id,{signal});signal?.throwIfAborted();
            if(result?.outcome==='published' && result.message?.client_id===attempt.id){published++;wasPublished=true;onPublished(result,row);}
            else if(result?.outcome==='cancelled')cancelled++;
            else throw Error('No se pudo confirmar el descarte del reenvío. Conservamos su intento.');
        }else cancelled++;
        review.attempts.delete(key);review.batch.pending.shift();
        if(wasPublished)review.batch.confirmed++;else review.batch.discarded=(review.batch.discarded || 0)+1;
        await checkpoint();
    }
    return {cancelled,published};
}

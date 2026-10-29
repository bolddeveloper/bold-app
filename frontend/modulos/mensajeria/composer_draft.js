// Only own draft text, opaque references and immutable sending attempts.
// Never persist task/person projections or already-loaded message histories.
import {imageFileError,MAX_CHAT_FILE} from "./media_helpers.js";
import {documentFileError} from './document_files.js';
const clone=value=>JSON.parse(JSON.stringify(value));
export function captureComposer({text="",items=[],attempt=null,taskId=null,edit=null,selectedId=null}={}){
    if(!text && !items.length && !attempt && !taskId && !edit)return {payload:null,files:[]};
    const files=[],indices=new Map();
    function index(file){if(!file)return null;if(!indices.has(file)){indices.set(file,files.length);files.push(file);}return indices.get(file);}
    return {payload:{version:1,text,task_id:taskId,selected_id:selectedId,
        items:items.map(item=>({id:item.id,file_index:index(item.file),caption:item.caption || "",attempted:!!item.attempted,...(item.attempt ? {attempt:clone(item.attempt)}:{})})),
        attempt:attempt ? {...clone(Object.fromEntries(Object.entries(attempt).filter(([key])=>key!=="file"))),file_index:index(attempt.file)}:null,
        edit:edit ? {id:edit.id,body:edit.body,version:edit.version}:null},files};
}
export function restoreComposer(payload,files=[]){
    if(payload?.version!==1 || typeof payload.text!=="string" || payload.text.length>5000 || !Array.isArray(payload.items) || payload.items.length>10)throw Error("El borrador conservado no tiene un formato válido.");
    function file(index){if(!Number.isInteger(index) || index<0 || index>=files.length)throw Error("Falta un archivo del borrador conservado.");const value=files[index];if(!value?.size || value.size>MAX_CHAT_FILE)throw Error("El adjunto conservado excede el límite de 10 MB.");return value;}
    const ids=new Set(),items=payload.items.map(item=>{
        if(typeof item.id!=="string" || ids.has(item.id) || typeof item.caption!=="string" || item.caption.length>5000)throw Error("La cola de archivos conservada no es válida.");ids.add(item.id);
        const attachment=file(item.file_index);
        if(attachment.type.startsWith("image/")){const error=imageFileError(attachment);if(error)throw Error(error);}else if(!/^audio\/(webm|mp4|ogg|mpeg|wav)(;|$)/.test(attachment.type)){const error=documentFileError(attachment);if(error)throw Error(error);}
        return {id:item.id,file:attachment,caption:item.caption,attempted:!!item.attempted,...(item.attempt ? {attempt:clone(item.attempt)}:{})};
    });
    if(items.reduce((sum,item)=>sum+item.file.size,0)>50*1024*1024)throw Error("La cola conservada supera 50 MB.");
    const attempt=payload.attempt ? {...clone(payload.attempt),...(payload.attempt.file_index!==null ? {file:file(payload.attempt.file_index)}:{})}:null;
    if(attempt)delete attempt.file_index;
    if(payload.edit && (typeof payload.edit.body!=="string" || payload.edit.body.length>5000 || !Number.isInteger(payload.edit.version)))throw Error("La edición conservada no es válida.");
    return {text:payload.text,items,attempt,taskId:payload.task_id,edit:payload.edit,selectedId:payload.selected_id};
}

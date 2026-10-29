import {useEffect,useRef,useState} from "react";
import {flushSync} from "react-dom";
import {draftService} from "./draft_service.js";
import {createDraftCheckpoint} from "./draft_checkpoint.js";
import {registerPrivateWork} from "../core/shared/private_work.js";
import {confirmBold} from "../core/shared/bold_dialog.js";

// Keep one checkpoint per visited conversation/thread. Switching views cannot
// move a file or an uncertain sending attempt to a different destination.
export function useComposerDrafts({context,resource,read,restore,onDenied,volatile=false}){
    const entries=useRef(new Map()),callbacks=useRef({}),alive=useRef(false);
    const [,render]=useState(0),[readyContext,setReadyContext]=useState(context),identity=resource ? JSON.stringify(resource):null;
    callbacks.current={read,restore,onDenied,volatile};
    const notify=()=>{if(alive.current)render(value=>value+1);};
    useEffect(()=>{
        alive.current=true;
        setReadyContext(context);
        const guard=registerPrivateWork(async()=>{
            if(callbacks.current.volatile)return false;
            const checkpoints=[...entries.current.values()];
            await Promise.all(checkpoints.map(entry=>entry.checkpoint.changed()));
            return (await Promise.all(checkpoints.map(entry=>entry.checkpoint.flush()))).every(Boolean);
        });
        const leave=event=>{
            if(callbacks.current.volatile || [...entries.current.values()].some(entry=>callbacks.current.read(entry.resource)?.payload && !entry.checkpoint.isProtected())){
                event.preventDefault();event.returnValue="";
            }
        };
        window.addEventListener("beforeunload",leave);
        return()=>{alive.current=false;guard();window.removeEventListener("beforeunload",leave);for(const entry of entries.current.values())entry.checkpoint.close();entries.current.clear();};
    },[context]);
    useEffect(()=>{
        if(!context || readyContext!==context)return;
        if(resource && !entries.current.has(identity)){
            const entry={resource:{...resource},status:"opening",recovery:null,error:null};entries.current.set(identity,entry);
            entry.checkpoint=createDraftCheckpoint({
                open:()=>draftService.open(entry.resource),
                snapshot:()=>callbacks.current.read(entry.resource)?.payload || null,
                attachments:()=>callbacks.current.read(entry.resource)?.files || [],
                onRecovery:value=>{entry.recovery=value;notify();},
                onStatus:(status,error)=>{entry.status=status;entry.error=error;notify();},
                onDenied:error=>{for(const current of entries.current.values())current.checkpoint.close();entries.current.clear();draftService.purge();callbacks.current.onDenied(error);},
            });
            notify();
        }
        for(const entry of entries.current.values())entry.checkpoint.changed();
    });
    const entry=identity && entries.current.get(identity);
    async function decide(useDraft){
        if(!entry?.recovery)return;
        if(useDraft && callbacks.current.read(entry.resource)?.payload && !await confirmBold("Recuperar reemplazará el borrador actual de esta conversación. ¿Continuar con la copia conservada?"))return;
        if(!useDraft && !await confirmBold("¿Descartar la copia conservada de este borrador en este dispositivo?"))return;
        try{await entry.checkpoint.decide(useDraft ? (payload,files)=>{let applied;flushSync(()=>{applied=callbacks.current.restore(entry.resource,payload,files);});return applied;}:null);}
        catch(error){entry.error=error;notify();}
    }
    return {status:entry?.status,recovery:entry?.recovery,error:entry?.error,
        blocked:!!context && !!resource && (readyContext!==context || !entry || entry.status==="opening" || !!entry.recovery),
        recover:()=>decide(true),discard:()=>decide(false),retry:()=>entry?.checkpoint.retry(),
        flush:async()=>{if(!entry || entry.recovery)return false;await entry.checkpoint.changed();return entry.checkpoint.flush();}};
}

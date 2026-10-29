// UI-independent bridge: never overwrite an unread recovery with a clean
// editor's initial state; never restore or send without the user's decision.
export function createDraftCheckpoint({open,snapshot,attachments=()=>[],onRecovery=()=>{},onStatus=()=>{},onDenied=()=>{}}){
    let handle=null,closed=false,loaded=false,recovery=null,opening=null,serial=Promise.resolve(),lastError=null,revision=0,protectedRevision=-1,lastFingerprint;
    const report=(status,error=null)=>{lastError=error;if(!closed)onStatus(status,error);};
    const fileIds=new WeakMap();let nextFile=0;
    function fingerprint(value,files){return JSON.stringify(value)+files.map(file=>{if(!fileIds.has(file))fileIds.set(file,++nextFile);return fileIds.get(file);}).join(',');}
    function changed(){
        if(closed || !loaded || !handle || recovery)return serial;
        const value=snapshot(),files=attachments(),nextFingerprint=fingerprint(value,files);
        if(lastFingerprint===nextFingerprint)return serial;
        lastFingerprint=nextFingerprint;const version=++revision;report(value ? "saving":"empty");
        const operation=value ? handle.save(value,files):handle.clear();
        serial=operation.then(result=>{if(result===false)throw new Error("El contexto del borrador ya no está activo.");if(version===revision){protectedRevision=version;report(value ? "protected":"empty");}return true;}).catch(error=>{report("error",error);return false;});
        return serial;
    }
    async function start(){
        if(opening || closed)return opening;
        opening=(async()=>{
            try{
                const next=await open();if(closed){next?.close();return;}handle=next;
                if(!next){report("unavailable");return;}
                recovery=await next.recover();if(closed)return;loaded=true;
                if(recovery){report("recoverable");onRecovery(recovery);}else await changed();
            }catch(error){loaded=false;handle?.close();handle=null;if(!closed && error.name!=="AbortError"){if([401,403,404].includes(error.status)){onDenied(error);return;}report("error",error);}}
            finally{opening=null;}
        })();return opening;
    }
    async function decide(restore){
        if(!handle || !recovery || closed)return false;
        if(restore){if(!restore(recovery.payload,recovery.files || []))return false;}
        else await handle.clear();
        recovery=null;onRecovery(null);lastFingerprint=undefined;await changed();return true;
    }
    async function flush(){await opening;for(let attempt=0;attempt<3;attempt++){const before=revision;await serial;if(before===revision)return !lastError && handle?.isActive?.()!==false && (!snapshot() || isProtected());}return false;}
    function close(){if(closed)return;closed=true;revision++;const next=handle;serial.finally(()=>next?.close());}
    start();
    function retry(){
        if(handle?.isActive?.()===false){handle=null;loaded=false;}
        if(!handle)return start();lastFingerprint=undefined;return changed();
    }
    // A previous render, in-flight encryption or suspended key is not protection
    // of NOW. Check synchronously even before React's changed() effect can run.
    function isProtected(){
        try{return !closed && loaded && !recovery && !!handle && handle.isActive?.()!==false && !lastError && protectedRevision===revision && lastFingerprint===fingerprint(snapshot(),attachments());}
        catch{return false;}
    }
    return {changed,decide,flush,close,retry,isProtected};
}

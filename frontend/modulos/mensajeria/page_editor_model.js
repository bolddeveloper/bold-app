const copy=value=>JSON.parse(JSON.stringify(value));
export const documentContent=page=>({title:page.title,icon:page.icon,blocks:(page.blocks || []).map(({task,...row})=>row)});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// One request in flight, immutable retry receipts and explicit revision conflicts.
// Drafts are memory-only and destroyed on authorization changes, never cached by PWA.
export function createPageEditor({page,save,onChange,onDenied=()=>{},delay=1200,maxDelay=10_000,now=()=>Date.now(),id=()=>crypto.randomUUID()}) {
    let base=copy(page),draft=documentContent(page),saved=copy(draft),status="saved",error=null,conflict=null,pending=null;
    let timer=null,firstEdit=0,closed=false,running=null;
    const controller=new AbortController();
    function dirty(){return !same(draft,saved) || !!pending;}
    function emit(){if(!closed)onChange({base:copy(base),draft:copy(draft),dirty:dirty(),status,error,conflict:conflict && copy(conflict),pending:!!pending});}
    function schedule(){
        clearTimeout(timer);
        if(closed || status==="error" || conflict || !dirty() || running)return;
        firstEdit ||= now();
        timer=setTimeout(flush,Math.min(delay,Math.max(0,maxDelay-(now()-firstEdit))));
    }
    function edit(value){
        if(closed || !base.can_edit)return;
        draft=copy(value);
        if(status!=="error" && !conflict)status=running ? "saving" : dirty() ? "unsaved":"saved";
        emit();schedule();
    }
    async function flush(){
        clearTimeout(timer);
        if(closed || running || conflict || !dirty() || !base.can_edit)return running;
        if(error?.retryAfterMs && now()<error.retryAt)return;
        pending ||= {...copy(draft),version:base.version,client_id:id()};
        const attempt=pending;
        status="saving";error=null;emit();
        running=(async()=>{
            try {
                const result=await save(copy(attempt),{signal:controller.signal});
                if(closed)return;
                pending=null;firstEdit=0;
                const accepted=result.accepted_version || result.version;
                if(result.version>accepted){conflict=result;status="conflict";emit();return;}
                const latest=draft;
                base=copy(result);saved=documentContent(result);
                // Keep edits made while the previous snapshot was travelling.
                draft=same(latest,{title:attempt.title,icon:attempt.icon,blocks:attempt.blocks}) ? copy(saved):latest;
                if(conflict?.version<=result.version)conflict=null;
                status=conflict ? "conflict":dirty() ? "unsaved":"saved";emit();
            } catch(err){
                if(closed || err.name==="AbortError")return;
                if([401,403,404].includes(err.status)){onDenied(err);return;}
                if(err.status===409 && err.fields?.current){conflict=err.fields.current;pending=null;status="conflict";}
                else {if(err.status===400)pending=null;error=err;error.retryAt=now()+(err.retryAfterMs || 0);status="error";}
                emit();
            } finally {running=null;if(!closed && status!=="error" && !conflict)schedule();}
        })();
        return running;
    }
    function remote(value){
        if(closed || value.version<base.version || (conflict && value.version<=conflict.version))return;
        if(value.version===base.version){
            const clean=!dirty() && !running;
            base=copy(value); // Access and task projections can change without a document revision.
            if(clean){draft=documentContent(value);saved=copy(draft);}
            if(!base.can_edit)clearTimeout(timer);
            emit();return;
        }
        if(dirty() || running){conflict=copy(value);status="conflict";clearTimeout(timer);}
        else {base=copy(value);draft=documentContent(value);saved=copy(draft);status="saved";}
        emit();
    }
    function resolve(useMine){
        if(!conflict || running)return;
        const own=copy(draft),remoteValue=copy(conflict);
        base=remoteValue;saved=documentContent(remoteValue);pending=null;error=null;conflict=null;
        draft=useMine ? own:copy(saved);firstEdit=0;status=dirty() ? "unsaved":"saved";emit();
        if(useMine)flush();
        return own;
    }
    emit();
    return {edit,flush,remote,resolve,dispose(){closed=true;clearTimeout(timer);controller.abort();draft={};saved={};pending=null;conflict=null;}};
}

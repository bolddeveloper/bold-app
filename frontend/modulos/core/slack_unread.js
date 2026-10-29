// Entry/recovery reads and coalesced invalidations on the existing session
// socket. No extra socket, periodic poll, or background retry timer.
export function createSlackUnread({fetchSummary,onChange=()=>{},now=Date.now,visible=()=>true}={}) {
    let closed=false,running=null,dirty=true,last=-Infinity,retryAt=0;
    const controller=new AbortController();
    function run() {
        if (closed || running || !visible() || now()<retryAt) return running || Promise.resolve();
        running=(async()=>{
            while(dirty && !closed && visible()) {
                dirty=false;last=now();
                try {
                    const value=await fetchSummary({signal:controller.signal});
                    if(closed) return;
                    if(!Number.isSafeInteger(value.total) || value.total<0 || !value.by_channel || typeof value.by_channel!=="object") throw Error("Resumen de Slack no válido");
                    const entries=Object.entries(value.by_channel).filter(([id,count])=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && Number.isSafeInteger(count) && count>=0);
                    onChange({total:value.total,byChannel:Object.fromEntries(entries),truncated:!!value.truncated});retryAt=0;
                } catch(error) {
                    if(closed || error.name==="AbortError") return;
                    dirty=true;retryAt=now()+Math.max(60_000,error.retryAfterMs || 0);
                    if([401,403].includes(error.status)) onChange({total:0,byChannel:{},truncated:false});
                    break;
                }
            }
        })().finally(()=>{running=null;});
        return running;
    }
    return {
        receive(event) {if(closed || event?.event_version!==2 || event.event_type!=="slack.changed" || event.payload?.kind?.startsWith("page.") || event.payload?.kind==='reactions.updated') return Promise.resolve();dirty=true;return run();},
        invalidate() {if(closed)return Promise.resolve();dirty=true;return run();},
        recover() {if(closed || running || !dirty && now()-last<15_000) return running || Promise.resolve();dirty=true;return run();},
        dispose() {closed=true;controller.abort();},
    };
}

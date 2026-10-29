// A monotone, per-view acknowledgement queue, never a timer or another
// participant's read receipt. Uncertain requests retry idempotently on activity.
export function visibleChannelBounds(host,{height=globalThis.window?.innerHeight || Infinity,style=node=>globalThis.window.getComputedStyle(node)}={}) {
    const box=host.getBoundingClientRect(),bounds={top:Math.max(0,box.top),bottom:Math.min(height,box.bottom)};
    for(let node=host.parentElement;node;node=node.parentElement){
        const css=style(node);
        if(/^(auto|scroll|hidden|clip)$/.test(css.overflowY || css.overflow)){
            const clip=node.getBoundingClientRect();bounds.top=Math.max(bounds.top,clip.top);bounds.bottom=Math.min(bounds.bottom,clip.bottom);
        }
    }
    return bounds;
}

export function createChannelReader({mark,onRead=()=>{},onError=()=>{},now=Date.now}) {
    let wanted=null,last=0,running=null,closed=false,retryAt=0;
    const controller=new AbortController();
    function observe(message) {
        if(closed || !message || !Number.isSafeInteger(message.sequence) || message.sequence<=last) return running || Promise.resolve();
        if(!wanted || message.sequence>wanted.sequence) wanted=message;
        if(running || now()<retryAt) return running || Promise.resolve();
        running=(async()=>{
            while(wanted && !closed) {
                const attempt=wanted;wanted=null;
                try {
                    const value=await mark(attempt.id,{signal:controller.signal});
                    if(closed) return;
                    last=Math.max(last,attempt.sequence);retryAt=0;onRead(value);
                    if(wanted?.sequence<=last) wanted=null;
                } catch(error) {
                    if(!closed && error.name!=="AbortError") {if(!wanted || attempt.sequence>wanted.sequence) wanted=attempt;retryAt=now()+Math.max(60_000,error.retryAfterMs || 0);onError(error);}
                    break;
                }
            }
        })().finally(()=>{running=null;});return running;
    }
    return {observe,dispose(){closed=true;controller.abort();}};
}

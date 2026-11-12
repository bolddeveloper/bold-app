// One bounded refresh for a burst of socket hints. Hidden tabs reconcile on
// return; there is no timer that polls the server while work is unchanged.
export function createReportRefresh({refresh,visible=()=>!document.hidden,setTimer=setTimeout,clearTimer=clearTimeout,delay=500,maxWait=2000}){
    let timer=null,deadline=null,pending=new Set(),stopped=false,running=false;
    function clear(){if(timer!==null)clearTimer(timer);if(deadline!==null)clearTimer(deadline);timer=deadline=null;}
    async function flush(){clear();if(stopped||running||!pending.size||!visible())return;const scopes=[...pending];pending.clear();running=true;try{await refresh(scopes);}finally{running=false;if(pending.size&&!stopped&&visible())schedule();}}
    function schedule(){if(timer!==null)clearTimer(timer);timer=setTimer(flush,delay);if(deadline===null)deadline=setTimer(flush,maxWait);}
    function request(scope='work'){if(stopped)return;pending.add(scope);if(visible())schedule();}
    return {request,wake(){request('recover');},stop(){stopped=true;pending.clear();clear();}};
}

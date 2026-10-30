import {http} from "../core/http_client.js";
import {getCoreState,subscribeCore} from "../core/core_store.js";
import {createDraftVault} from "./draft_vault.js";
import {permissionDraftAction,cacheDraftAction} from "./draft_lifecycle.js";

const vault=createDraftVault();
let context="";
const currentScope=()=>{const state=getCoreState();return state.sessionStatus==="ready" && !state.securityUncertain && state.account?.id && state.activeAssignment?.id ? {account_id:state.account.id,assignment_id:state.activeAssignment.id}:null;};
const purge=()=>vault.purge().catch(()=>{});
// Only lifecycle hints travel between tabs; never private content or keys.
const bus=typeof window!=="undefined" && typeof BroadcastChannel!=="undefined" ? new BroadcastChannel("bold-private-draft-lifecycle"):null;
bus?.addEventListener("message",event=>{if(event.data==="purge")purge();else if(event.data==="suspend")vault.suspend();});
function invalidate(clear){vault.suspend();if(clear)purge();bus?.postMessage(clear ? "purge":"suspend");}
globalThis.addEventListener?.("bold:private-cache-clear",()=>invalidate(true));
globalThis.addEventListener?.("bold:private-cache-suspend",()=>invalidate(cacheDraftAction("bold:private-cache-suspend")==="purge"));
globalThis.addEventListener?.("bold:permissions-revision",event=>invalidate(permissionDraftAction(event.detail)==="purge"));
subscribeCore(()=>{
    const scope=currentScope(),next=scope ? JSON.stringify(scope):"";
    if(context && context!==next)vault.suspend();context=next;
});

export const draftService={
    async open(resource){
        const identity=currentScope();if(!identity)return null;
        const scope={...resource,...identity};
        return vault.open(scope,async()=>{
            const grant=await http.request("/api/v2/messaging/draft-grants/",{method:"POST",body:resource,timeoutMs:15000});
            if(JSON.stringify(currentScope())!==JSON.stringify(identity))throw new DOMException("Contexto cancelado","AbortError");
            return grant;
        });
    },
    purge,
};

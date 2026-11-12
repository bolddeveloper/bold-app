// Short-lived navigation recovery only. No source records or browser storage;
// reload still warns, and security transitions erase every prepared edit.
import {registerPrivateWork} from '../../core/shared/private_work.js';
const preparations=new Map();
const lifetime=60*60*1000;
export function preservePreparation(key,value,now=Date.now()){
    preparations.delete(key);
    if(value!==null){preparations.set(key,{value:structuredClone(value),at:now});while(preparations.size>20)preparations.delete(preparations.keys().next().value);}
}
export function recoverPreparation(key,now=Date.now()){
    const row=preparations.get(key);if(!row)return null;
    if(now-row.at>lifetime){preparations.delete(key);return null;}
    return structuredClone(row.value);
}
export function clearPreparations(){preparations.clear();}
for(const event of ['bold:private-cache-clear','bold:private-cache-suspend','bold:permissions-revision'])globalThis.addEventListener?.(event,clearPreparations);
registerPrivateWork(async()=>preparations.size===0);
globalThis.addEventListener?.('beforeunload',event=>{if(preparations.size){event.preventDefault();event.returnValue='';}});

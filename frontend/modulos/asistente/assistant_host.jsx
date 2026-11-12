import {lazy,Suspense,useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {useCore} from '../core/core_provider.jsx';
import {openAssistant} from './model.js';
const Panel=lazy(()=>import('./assistant_panel.jsx'));
export function AssistantLauncher({context={},label='Asistente privado',tab='request'}){
    const core=useCore();
    if(!core.activeAssignment?.assistant_enabled||core.securityUncertain)return null;
    return <button type="button" className="secondary_button assistant_launcher" onClick={()=>openAssistant({context,tab})}>{label}</button>;
}
export default function AssistantHost(){
    const core=useCore(),[entry,setEntry]=useState(null);
    const identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    useEffect(()=>{setEntry(null);},[identity,core.securityUncertain]);
    useEffect(()=>{const open=event=>setEntry({...event.detail,openedAt:Date.now()});window.addEventListener('bold:assistant-open',open);return()=>window.removeEventListener('bold:assistant-open',open);},[]);
    if(!entry||!core.activeAssignment?.assistant_enabled||core.securityUncertain)return null;
    return createPortal(<div className="bold_v3 assistant_portal"><Suspense fallback={<p role="status">Abriendo asistente privado…</p>}><Panel key={`${identity}:${entry.openedAt}`} entry={entry} onClose={()=>setEntry(null)}/></Suspense></div>,document.body);
}

import {useEffect,useRef,useState} from "react";
import {Bookmark,BookmarkCheck} from "lucide-react";
import {useCore} from "../core/core_provider.jsx";
import {historyApi,savedError} from "./history_api.js";
import "./save_resource.css";

export default function SaveResource(props){
    const core=useCore(),identity=`${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}`;
    if(core.securityUncertain || core.activeAssignment?.chat_enabled!==true)return null;
    return <SaveControl key={`${identity}:${props.kind}:${props.sourceId}`} {...props}/>;
}

function SaveControl({kind,sourceId,initialSaved=false,documentId=null,onChange,compact=false,disabled=false}){
    const [value,setValue]=useState({saved:initialSaved,documentId}),[busy,setBusy]=useState(false),[error,setError]=useState("");
    const request=useRef(null),active=useRef(true);
    useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
    useEffect(()=>{setValue({saved:initialSaved,documentId});},[initialSaved,documentId]);
    async function toggle(){
        const controller=new AbortController();request.current=controller;setBusy(true);setError("");
        try{
            let next;
            if(value.saved && value.documentId){await historyApi.unsave(value.documentId,{signal:controller.signal});next={...value,saved:false};}
            else{const result=await historyApi.save(kind,sourceId,{signal:controller.signal});next={saved:true,documentId:result.document_id};}
            if(active.current && !controller.signal.aborted){setValue(next);onChange?.(next);}
        }catch(err){if(active.current && !controller.signal.aborted)setError(savedError(err));}
        finally{if(active.current && !controller.signal.aborted)setBusy(false);}
    }
    const label=busy ? "Guardando referencia…":value.saved ? "Quitar de mis guardados":"Guardar para mí";
    return <span className={`saved_resource_control ${compact ? "is_compact":""}`}>
        <button type="button" disabled={disabled || busy} aria-label={label} title={label} aria-pressed={value.saved} onClick={toggle}>
            {value.saved ? <BookmarkCheck size={16} aria-hidden="true"/>:<Bookmark size={16} aria-hidden="true"/>}{!compact && <span>{label}</span>}
        </button>{error && <span role="alert">{error}</span>}
    </span>;
}

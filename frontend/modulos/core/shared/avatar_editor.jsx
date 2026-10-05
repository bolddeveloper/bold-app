import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {RotateCw, X} from "lucide-react";
import {useDialog} from "./use_dialog.js";
import {cropAvatar} from "./avatar_image.js";
import {drawAvatar} from "./image_controls.js";
import "./image_controls.css";
export default function AvatarEditor({file,onApply,onClose}) {
    const canvas=useRef(null), drag=useRef(null), [image,setImage]=useState(null), [options,setOptions]=useState({zoom:1,x:0,y:0,rotation:0}), [error,setError]=useState(""), [busy,setBusy]=useState(false);
    useDialog(true,".bold_avatar_editor",()=>{if(!busy)onClose();});
    useEffect(()=>{
        if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>10*1024*1024){setError("Selecciona PNG, JPG o WebP de hasta 10 MB.");return;}
        const url=URL.createObjectURL(file), img=new Image();let alive=true;img.onload=()=>{if(alive)setImage(img);};img.onerror=()=>{if(alive)setError("No se pudo leer la imagen.");};img.src=url;return()=>{alive=false;URL.revokeObjectURL(url);};
    },[file]);
    useEffect(()=>{if(image&&canvas.current)drawAvatar(canvas.current,image,options);},[image,options]);
    const change=(field,value)=>setOptions(old=>({...old,[field]:value}));
    return createPortal(<div className={`bold_image_overlay ${document.documentElement.dataset.boldTheme === "dark" ? "theme_dark" : ""}`}><section className="bold_avatar_editor" role="dialog" aria-modal="true" aria-label="Editar imagen"><header><h2>Editar imagen</h2><button type="button" disabled={busy} aria-label="Cerrar editor de imagen" onClick={onClose}><X/></button></header>
        <div className="bold_avatar_crop" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={clientX:e.clientX,clientY:e.clientY,...options};}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId)||!drag.current)return;const start=drag.current;setOptions(old=>({...old,x:Math.max(-1,Math.min(1,start.x-(e.clientX-start.clientX)/150)),y:Math.max(-1,Math.min(1,start.y-(e.clientY-start.clientY)/150))}));}}><canvas ref={canvas} width={256} height={256}/><div className="bold_avatar_mask"/></div>
        <label>Zoom<input type="range" min="1" max="4" step="0.01" value={options.zoom} onChange={e=>change("zoom",Number(e.target.value))}/></label>
        <div className="bold_avatar_position"><label>Horizontal<input type="range" min="-1" max="1" step="0.01" value={options.x} onChange={e=>change("x",Number(e.target.value))}/></label><label>Vertical<input type="range" min="-1" max="1" step="0.01" value={options.y} onChange={e=>change("y",Number(e.target.value))}/></label><button type="button" aria-label="Girar imagen 90 grados" onClick={()=>change("rotation",(options.rotation+90)%360)}><RotateCw size={20}/></button></div>
        {error&&<p role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={()=>setOptions({zoom:1,x:0,y:0,rotation:0})}>Restablecer</button><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button className="bold_control_primary" type="button" disabled={busy||!image} onClick={async()=>{setBusy(true);try{onApply(await cropAvatar(file,options));}catch(problem){setError(problem.message);setBusy(false);}}}>{busy?"Aplicando…":"Aplicar"}</button></footer>
    </section></div>,document.body);
}

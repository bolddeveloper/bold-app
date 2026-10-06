import {useLayoutEffect, useRef, useState, useId} from "react";
import {createPortal} from "react-dom";
import {Pipette, X} from "lucide-react";
import {useDialog} from "./use_dialog.js";
import {hexToHsv, hsvToHex} from "./image_controls.js";
import "./image_controls.css";
export default function ColorPicker({value = "#ef1f2d", onChange, name, label = "Elegir color", disabled = false, commitOnly = false, onOpen, children}) {
    const pending = useRef(value);
    const trigger = useRef(null), [open,setOpen] = useState(false);
    return <><button ref={trigger} type="button" className="bold_color_trigger" aria-label={label} aria-expanded={open} disabled={disabled} onPointerDown={() => onOpen?.()} onClick={event => {if(event.detail===0)onOpen?.();pending.current=value;setOpen(v => !v);}}>{children || <span style={{background:value}}/>}</button>{name && <input type="hidden" name={name} value={value}/>}{open && <ColorPanel anchor={trigger.current} value={value} onChange={color => {pending.current=color;if(!commitOnly)onChange(color);}} close={() => {setOpen(false);if(commitOnly && pending.current!==value)onChange(pending.current);}} label={label}/>}</>;
}
function ColorPanel({anchor,value,onChange,close,label}) {
    const id = useId().replace(/:/g,""), panel = useRef(null), [position,setPosition] = useState({top:12,left:12});
    const [hsv,setHsv] = useState(() => hexToHsv(value)), [hex,setHex] = useState(value), [error,setError] = useState("");
    useDialog(true,`[data-color-id="${id}"]`,close);
    useLayoutEffect(() => {
        const place = () => {const r=anchor.getBoundingClientRect(), w=panel.current.offsetWidth, h=panel.current.offsetHeight; setPosition({left:Math.max(12,Math.min(r.left,innerWidth-w-12)),top:Math.max(12,Math.min(r.bottom+8,innerHeight-h-12))});};
        place(); window.addEventListener("resize",place); window.addEventListener("scroll",place,true); return () => {window.removeEventListener("resize",place); window.removeEventListener("scroll",place,true);};
    },[anchor]);
    function change(next) {setHsv(next); const color=hsvToHex(...next);setHex(color);onChange(color);setError("");}
    function choose(color) {setHsv(hexToHsv(color));setHex(color);onChange(color);setError("");}
    function square(event) {const r=event.currentTarget.getBoundingClientRect();change([hsv[0],Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),1-Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]);}
    return createPortal(<div className={`bold_control_overlay ${document.documentElement.dataset.boldTheme === "dark" ? "theme_dark" : ""}`} onPointerDown={event => {if(event.target===event.currentTarget) close();}}><section ref={panel} data-color-id={id} className="bold_color_panel" role="dialog" aria-modal="true" aria-label={label} style={position}>
        <header><strong>{label}</strong><button type="button" aria-label="Cerrar selector de color" onClick={close}><X size={16}/></button></header>
        <div className="bold_color_square" style={{backgroundColor:hsvToHex(hsv[0],1,1)}} onPointerDown={event => {event.currentTarget.setPointerCapture(event.pointerId);square(event);}} onPointerMove={event => {if(event.currentTarget.hasPointerCapture(event.pointerId)) square(event);}}><i style={{left:`${hsv[1]*100}%`,top:`${(1-hsv[2])*100}%`}}/></div>
        <input className="bold_color_hue" aria-label="Tono" type="range" min="0" max="359" value={hsv[0]} onChange={e=>change([Number(e.target.value),hsv[1],hsv[2]])}/>
        <div className="bold_color_hex"><input aria-label="Color hexadecimal" maxLength={7} value={hex} onChange={e=>{const next=e.target.value;setHex(next);if(/^#[0-9a-f]{6}$/i.test(next))choose(next.toLowerCase());}} onBlur={()=>{if(!/^#[0-9a-f]{6}$/i.test(hex)){setHex(value);setError("Usa un color HEX de seis caracteres.");}}}/>{typeof window.EyeDropper === "function" && <button type="button" aria-label="Tomar color de pantalla" onClick={async()=>{try{choose((await new window.EyeDropper().open()).sRGBHex);}catch{/* Cancelar conserva el color. */}}}><Pipette size={18}/></button>}</div>
        <label className="bold_color_accessible">Saturación<input aria-label="Saturación" type="range" min="0" max="100" value={Math.round(hsv[1]*100)} onChange={e=>change([hsv[0],Number(e.target.value)/100,hsv[2]])}/></label>
        <label className="bold_color_accessible">Brillo<input aria-label="Brillo" type="range" min="0" max="100" value={Math.round(hsv[2]*100)} onChange={e=>change([hsv[0],hsv[1],Number(e.target.value)/100])}/></label>
        <div className="bold_color_presets">{["#ef1f2d","#f1db8c","#813782","#3d6489","#318246"].map(color=><button key={color} type="button" aria-label={`Usar ${color}`} style={{background:color}} onClick={()=>choose(color)}/>)}</div>{error&&<p role="alert">{error}</p>}
    </section></div>,document.body);
}

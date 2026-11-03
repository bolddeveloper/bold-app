import {useLayoutEffect, useRef, useState, useId} from "react";
import {createPortal} from "react-dom";
import {Check, Palette, Pipette, X} from "lucide-react";
import {useDialog} from "./use_dialog.js";
import {hexToHsv, hsvToHex} from "./image_controls.js";
import "./image_controls.css";
import "./color_picker.css";

const presets=["#ef1f2d","#f1db8c","#813782","#3d6489","#318246"];
const validHex=value=>/^#[0-9a-f]{6}$/i.test(value);

export default function ColorPicker({value="#ef1f2d",onChange,name,label="Elegir color",disabled=false,commitOnly=false,onOpen,children}) {
    const pending=useRef(value),trigger=useRef(null),[open,setOpen]=useState(false);
    return <><button ref={trigger} type="button" className="bold_color_trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onPointerDown={()=>onOpen?.()} onClick={event=>{if(event.detail===0)onOpen?.();pending.current=value;setOpen(v=>!v);}}>{children || <span className="bold_color_swatch" style={{background:value}}/>}</button>{name && <input type="hidden" name={name} value={value}/>}{open && <ColorPanel anchor={trigger.current} value={value} commitOnly={commitOnly} onChange={color=>{pending.current=color;if(!commitOnly)onChange(color);}} close={()=>{setOpen(false);if(commitOnly && pending.current!==value)onChange(pending.current);}} label={label}/>}</>;
}

function ColorPanel({anchor,value,onChange,close,label,commitOnly}) {
    const id=useId().replace(/:/g,""),panel=useRef(null),[position,setPosition]=useState({top:12,left:12});
    const [hsv,setHsv]=useState(()=>hexToHsv(value)),[hex,setHex]=useState(value),[error,setError]=useState("");
    const selected=hsvToHex(...hsv),saturation=Math.round(hsv[1]*100),brightness=Math.round(hsv[2]*100);
    useDialog(true,`[data-color-id="${id}"]`,close);
    useLayoutEffect(()=>{
        const viewport=window.visualViewport;
        const place=()=>{
            const r=anchor.getBoundingClientRect(),w=panel.current.offsetWidth;
            const left=(viewport?.offsetLeft||0)+12,top=(viewport?.offsetTop||0)+12;
            const right=left+(viewport?.width||window.innerWidth)-24,bottom=top+(viewport?.height||window.innerHeight)-24;
            const maxHeight=Math.max(0,bottom-top),h=Math.min(panel.current.offsetHeight,maxHeight);
            const below=r.bottom+8,above=r.top-h-8;
            const next={left:Math.max(left,Math.min(r.left,right-w)),top:Math.max(top,Math.min(below+h<=bottom ? below : above>=top ? above : bottom-h,bottom-h)),maxHeight};
            setPosition(old=>old.left===next.left && old.top===next.top && old.maxHeight===next.maxHeight ? old : next);
        };
        place();
        const observer=typeof ResizeObserver==="undefined" ? null : new ResizeObserver(place);
        observer?.observe(panel.current);
        window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
        viewport?.addEventListener("resize",place);viewport?.addEventListener("scroll",place);
        return ()=>{observer?.disconnect();window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);viewport?.removeEventListener("resize",place);viewport?.removeEventListener("scroll",place);};
    },[anchor]);
    function change(next) {setHsv(next);const color=hsvToHex(...next);setHex(color);onChange(color);setError("");}
    function choose(color) {setHsv(hexToHsv(color));setHex(color);onChange(color);setError("");}
    function square(event) {const r=event.currentTarget.getBoundingClientRect();change([hsv[0],Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),1-Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))]);}
    return createPortal(<div className="bold_control_overlay" onPointerDown={event=>{if(event.target===event.currentTarget)close();}}>
        <section ref={panel} data-color-id={id} className="bold_color_panel" role="dialog" aria-modal="true" aria-label={label} style={position}>
            <header><Palette size={17} aria-hidden="true"/><strong>{label}</strong><button className="bold_color_close" type="button" aria-label="Cerrar selector de color" onClick={close}><X size={17} aria-hidden="true"/></button></header>
            <div className="bold_color_square" aria-hidden="true" title="Arrastra para ajustar saturación y brillo" style={{backgroundColor:hsvToHex(hsv[0],1,1)}} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);square(event);}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))square(event);}}><i style={{left:`${hsv[1]*100}%`,top:`${(1-hsv[2])*100}%`}}/></div>
            <label className="bold_color_accessible" htmlFor={`${id}-hue`}><span>Tono</span><input id={`${id}-hue`} className="bold_color_hue" aria-label="Tono" type="range" min="0" max="359" value={hsv[0]} onChange={e=>change([Number(e.target.value),hsv[1],hsv[2]])}/><output htmlFor={`${id}-hue`}>{Math.round(hsv[0])}°</output></label>
            <div className="bold_color_hex_group"><label htmlFor={`${id}-hex`}>Código HEX</label><div className="bold_color_hex"><span className="bold_color_preview" aria-hidden="true" style={{background:selected}}/><input id={`${id}-hex`} aria-label="Color hexadecimal" aria-invalid={Boolean(error) && !validHex(hex)} aria-describedby={error ? `${id}-error` : undefined} maxLength={7} value={hex} autoComplete="off" spellCheck={false} onChange={e=>{const next=e.target.value;setHex(next);if(validHex(next))choose(next.toLowerCase());}} onBlur={()=>{if(!validHex(hex)){setHex(selected);setError("Usa # y seis caracteres: 0–9 o A–F.");}}}/>{typeof window.EyeDropper==="function" && <button type="button" aria-label="Tomar color de pantalla" title="Tomar color de pantalla" onClick={async()=>{try{const color=(await new window.EyeDropper().open()).sRGBHex;if(panel.current)choose(color);}catch{/* Cancelar conserva el color. */}}}><Pipette size={17} aria-hidden="true"/></button>}</div>{error && <p id={`${id}-error`} className="bold_color_error" role="alert">{error}</p>}</div>
            <div className="bold_color_fine_controls">
                <label className="bold_color_accessible" htmlFor={`${id}-sat`}><span>Saturación</span><input id={`${id}-sat`} aria-label="Saturación" type="range" min="0" max="100" value={saturation} style={{"--range-fill":`${saturation}%`}} onChange={e=>change([hsv[0],Number(e.target.value)/100,hsv[2]])}/><output htmlFor={`${id}-sat`}>{saturation}%</output></label>
                <label className="bold_color_accessible" htmlFor={`${id}-brightness`}><span>Brillo</span><input id={`${id}-brightness`} aria-label="Brillo" type="range" min="0" max="100" value={brightness} style={{"--range-fill":`${brightness}%`}} onChange={e=>change([hsv[0],hsv[1],Number(e.target.value)/100])}/><output htmlFor={`${id}-brightness`}>{brightness}%</output></label>
            </div>
            <div className="bold_color_palette"><span>Colores rápidos</span><div className="bold_color_presets">{presets.map(color=><button key={color} type="button" aria-label={`Usar ${color}`} aria-pressed={selected===color} title={color} style={{"--preset-color":color}} onClick={()=>choose(color)}><span>{selected===color && <Check size={14} aria-hidden="true"/>}</span></button>)}</div></div>
            <footer><small>{commitOnly ? "Se aplica al cerrar." : "Vista previa en tiempo real."}</small><button type="button" className="bold_color_done" onClick={close}><Check size={14} aria-hidden="true"/>Listo</button></footer>
        </section>
    </div>,anchor.closest("dialog[open]") || document.body);
}

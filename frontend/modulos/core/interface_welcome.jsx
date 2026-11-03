import {useEffect, useRef, useState} from "react";
import {Moon, Sun, ArrowRight, Check} from "lucide-react";
import {http, is_using_real_backend} from "./http_client.js";
import {useDialog} from "./shared/use_dialog.js";

export function InterfaceWelcome({account,dark,onTheme,connectionContent}) {
    const [settings,setSettings]=useState(null), [error,setError]=useState(""), [busy,setBusy]=useState(false);
    const hydrated=useRef(false), ready=useRef(false), theme=useRef(dark);
    useEffect(()=>{
        hydrated.current=false;ready.current=false;setSettings(null);
        if(!account || !is_using_real_backend())return;
        let alive=true;
        http.request("/api/v2/auth/interface-settings/").then(value=>{
            if(!alive)return;
            if(value.theme) {theme.current=value.theme==="dark";onTheme(theme.current);}
            else theme.current=dark;
            hydrated.current=true;setSettings(value);ready.current=true;
        }).catch(()=>{});
        return ()=>{alive=false;ready.current=false;};
    },[account]);
    useEffect(()=>{
        if(!ready.current || !hydrated.current || dark===theme.current)return;
        theme.current=dark;
        const timer=setTimeout(()=>http.request("/api/v2/auth/interface-settings/",{method:"PATCH",body:{theme:dark ? "dark" : "light"}}).catch(()=>setError("El tema se conserva en este navegador; no se pudo sincronizar con tu cuenta.")),400);
        return ()=>clearTimeout(timer);
    },[dark,account]);
    const open=Boolean(settings && !settings.onboarding_completed);
    useDialog(open,".bold_welcome",()=>{});
    async function save(patch){
        if(busy)return;setBusy(true);setError("");
        try {setSettings(await http.request("/api/v2/auth/interface-settings/",{method:"PATCH",body:{theme:dark ? "dark" : "light",...patch}}));}
        catch(problem){setError(problem.message);}finally{setBusy(false);}
    }
    if(!open)return null;
    return <div className="bold_welcome_backdrop"><section className="bold_welcome" role="dialog" aria-modal="true" aria-labelledby="bold_welcome_title">
        <span className="bold_eyebrow">BOLD · TU ESPACIO DE TRABAJO</span>
        <div className="bold_welcome_steps" aria-label="Progreso"><span data-active={settings.onboarding_step!=="google"}>01 Apariencia</span><span data-active={settings.onboarding_step==="google"}>02 Conexión</span></div>
        <h1 id="bold_welcome_title">{settings.onboarding_step==="google" ? "Conecta tu espacio." : "Hazlo tuyo."}</h1>
        <p>{settings.onboarding_step==="google" ? "Conecta Google para trabajar con tus archivos y agenda. También puedes hacerlo después desde Perfil." : "Elige cómo quieres ver BOLD. Puedes cambiar el tema cuando quieras."}</p>
        {settings.onboarding_step!=="google" ? <><div className="bold_theme_options">{[false,true].map(candidate=><button type="button" key={String(candidate)} aria-pressed={dark===candidate} onClick={()=>onTheme(candidate)}><span className={`bold_theme_preview ${candidate ? "is_dark" : ""}`}><i/><i/><i/></span>{candidate ? <Moon size={17}/> : <Sun size={17}/>} {candidate ? "Oscuro" : "Claro"}{dark===candidate && <Check size={16}/>}</button>)}</div><button className="bold_welcome_next" disabled={busy} onClick={()=>save({onboarding_step:"google"})}>Continuar <ArrowRight size={17}/></button></> : <>{connectionContent}<button className="bold_welcome_next" disabled={busy} onClick={()=>save({onboarding_completed:true})}>Entrar a BOLD <ArrowRight size={17}/></button><button className="bold_welcome_skip" disabled={busy} onClick={()=>save({onboarding_completed:true})}>Ahora no</button></>}
        {error && <p role="alert">{error}</p>}
    </section></div>;
}

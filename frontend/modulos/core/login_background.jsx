import {useEffect,useId,useState} from "react";
import {useMediaQuery} from "./shared/use_media_query.js";

export function LoginBackground({dark}) {
    const mobile=useMediaQuery("(max-width:600px)");
    const [paused,setPaused]=useState(()=>document.hidden);
    const id=useId().replaceAll(":","");
    const paint=name=>`url(#${id}-${name})`;
    const [width,height]=mobile ? [432,936] : [1280,720];
    const [ax,ay,ar,bx,by,br,thickness]=mobile ? [-15,-45,170,445,955,205,66] : [-50,140,275,1310,680,305,100];
    useEffect(()=>{
        const update=()=>setPaused(document.hidden);
        update();document.addEventListener("visibilitychange",update);
        return ()=>document.removeEventListener("visibilitychange",update);
    },[]);
    return <div className={`core_login_background ${dark ? "is_dark" : ""} ${paused ? "is_paused" : ""}`} aria-hidden="true">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" focusable="false" style={{"--dot-x":`${width*.03}px`,"--dot-y":`${height*.025}px`}}>
            <defs>
                <linearGradient id={`${id}-red`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff715c"/><stop offset=".32" stopColor="#e73535"/><stop offset=".72" stopColor="#bf202b"/><stop offset="1" stopColor="#740e1d"/></linearGradient>
                <linearGradient id={`${id}-rim`} x1="1" y1="0" x2="0" y2="1"><stop stopColor="#ffb2a0"/><stop offset=".35" stopColor="#f04b45"/><stop offset="1" stopColor="#9a1826"/></linearGradient>
                <radialGradient id={`${id}-shade`}><stop stopColor="var(--login-base)" stopOpacity="0"/><stop offset="1" stopColor="var(--login-edge)" stopOpacity=".25"/></radialGradient>
                <pattern id={`${id}-dots`} width={mobile ? 9 : 6} height={mobile ? 9 : 6} patternUnits="userSpaceOnUse"><circle className="core_login_dot" cx="2" cy="2" r={mobile ? 1.2 : .85}/></pattern>
                <radialGradient id={`${id}-fade`}><stop stopColor="#fff"/><stop offset=".55" stopColor="#fff" stopOpacity=".8"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></radialGradient>
                <mask id={`${id}-mask`}><rect width={width} height={height} fill={paint("fade")}/></mask>
            </defs>
            <rect className="core_login_base" width="100%" height="100%"/>
            <g className="core_login_dots" mask={paint("mask")}><rect x={-width*.15} y={-height*.15} width={width*1.3} height={height*1.3} fill={paint("dots")}/></g>
            {/* Keep each anchor outside its animated group so the lower ring stays below. */}
            <g transform={`translate(${ax} ${ay})`}><g className="core_login_orbit_a">
                <circle className="core_login_guide" r={ar+thickness*.8}/>
                <circle cy="16" r={ar} fill="none" stroke="#7d1521" strokeWidth={thickness}/>
                <circle r={ar} fill="none" stroke={paint("red")} strokeWidth={thickness}/>
                <circle r={ar-thickness/2} fill="none" stroke={paint("rim")} strokeWidth="2"/>
            </g></g>
            <g transform={`translate(${bx} ${by})`}><g className="core_login_orbit_b">
                <circle r={br} fill="none" stroke="#801423" strokeWidth={thickness} transform="translate(0 16)"/>
                <circle r={br} fill="none" stroke={paint("red")} strokeWidth={thickness}/>
                <circle r={br-thickness/2} fill="none" stroke={paint("rim")} strokeWidth="2"/>
                <circle className="core_login_guide" r={br+thickness*.8}/>
            </g></g>
            <rect width="100%" height="100%" fill={paint("shade")}/>
        </svg>
    </div>;
}

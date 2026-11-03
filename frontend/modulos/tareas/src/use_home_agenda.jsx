import {useCallback,useEffect,useRef,useState} from "react";
import {useCore} from "../../core/core_provider.jsx";
import {calendarApi,localCalendarsApi} from "../../calendario/calendar_api.js";
import {agendaDay} from "./home_agenda_data.js";

export function useHomeAgenda(now, enabled) {
    const core = useCore(), day = agendaDay(now), scope = `${core.account?.id}:${core.activeAssignment?.id}:${core.authorizationRevision}:${core.securityUncertain}:${day.start}`;
    const [state,setState] = useState({scope:null,events:[],loading:true}), [revision,setRevision] = useState(0);
    const checked = useRef(0), controller = useRef(null);
    const refresh = useCallback(() => {controller.current?.abort();setRevision(value => value+1);},[]);
    useEffect(() => {
        if (!enabled || core.securityUncertain) return;
        const request = new AbortController(), options = {signal:request.signal}; controller.current = request;
        setState({scope,events:[],loading:true});
        const google = async () => {
            const connection = await calendarApi.connection(options);
            return connection.connected ? {...await calendarApi.events(day.start,day.end,options),connected:true} : {events:[],connected:false};
        };
        Promise.allSettled([localCalendarsApi.agenda(day.start,day.end,options),google()]).then(([local,external]) => {
            if (request.signal.aborted) return;
            checked.current = Date.now();
            const rows = local.status === "fulfilled" ? local.value.events || [] : [];
            const googleRows = external.status === "fulfilled" ? external.value.events || [] : [];
            setState({scope,events:[...rows.map(event => ({...event,source:"local",key:`local:${event.id}`})),...googleRows.map(event => ({...event,source:"google",calendar_name:"Google",key:`google:${event.id}`}))],loading:false,
                connected:external.status === "fulfilled" && external.value.connected,
                error:local.status === "rejected" || external.status === "rejected" ? "No se pudo actualizar toda tu agenda." : ""});
        });
        return () => request.abort();
    },[scope,enabled,revision]);
    useEffect(() => {
        const focus = () => {if (document.visibilityState !== "hidden" && Date.now()-checked.current > 300000) refresh();};
        const connection = () => refresh();
        const clear = () => {controller.current?.abort();setState({scope,events:[],loading:true});refresh();};
        window.addEventListener("focus",focus); document.addEventListener("visibilitychange",focus);
        window.addEventListener("bold:google-connection-changed",connection); window.addEventListener("bold:google-cache-cleared",clear);
        return () => {window.removeEventListener("focus",focus);document.removeEventListener("visibilitychange",focus);window.removeEventListener("bold:google-connection-changed",connection);window.removeEventListener("bold:google-cache-cleared",clear);};
    },[refresh,scope]);
    return {...(state.scope === scope && !core.securityUncertain ? state : {events:[],loading:true}),refresh};
}

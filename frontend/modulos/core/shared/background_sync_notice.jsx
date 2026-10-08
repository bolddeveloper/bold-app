import {NoticeLayer} from "./notice_layer.jsx";
import {useEffect, useId, useSyncExternalStore} from "react";

const notices = new Map(), listeners = new Set();
const subscribe = listener => {listeners.add(listener); return () => listeners.delete(listener);};
const current = () => notices.keys().next().value || "";
const publish = () => {for (const listener of listeners) listener();};

export function BackgroundSyncNotice({active, label = "Actualizando datos…"}) {
    const id = useId(), visible = useSyncExternalStore(subscribe, current, current);
    useEffect(() => {
        if (active) notices.set(id, label); else notices.delete(id);
        publish();
        return () => {notices.delete(id); publish();};
    }, [id, active, label]);
    return active && visible === id ? <NoticeLayer><div className="task_saving_indicator" role="status" aria-live="polite"><span className="task_action_spinner" aria-hidden="true" />{label}</div></NoticeLayer> : null;
}

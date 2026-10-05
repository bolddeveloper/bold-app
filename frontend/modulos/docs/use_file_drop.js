import {useEffect, useRef, useState} from "react";
import {hasDroppedFiles} from "./drive_upload.js";

// Recibe archivos del sistema en toda la vista; ignora los movimientos internos.
export function useFileDrop(receive) {
    const [dragging, setDragging] = useState(false);
    const handler = useRef(receive); handler.current = receive;
    useEffect(() => {
        let depth = 0;
        const enter = event => {if (hasDroppedFiles(event.dataTransfer)) {event.preventDefault(); depth++; setDragging(true);}};
        const over = event => {if (hasDroppedFiles(event.dataTransfer)) {event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true);}};
        const leave = () => {depth = Math.max(0, depth - 1); if (!depth) setDragging(false);};
        const drop = event => {
            if (!hasDroppedFiles(event.dataTransfer)) return;
            event.preventDefault(); event.stopPropagation(); depth = 0; setDragging(false);
            const items = Array.from(event.dataTransfer.files || []);
            if (items.length) handler.current(items);
        };
        const reset = () => {depth = 0; setDragging(false);};
        const events = {dragenter: enter, dragover: over, dragleave: leave, drop, dragend: reset, blur: reset};
        for (const [name, listener] of Object.entries(events)) window.addEventListener(name, listener, true);
        return () => {for (const [name, listener] of Object.entries(events)) window.removeEventListener(name, listener, true);};
    }, []);
    return dragging;
}

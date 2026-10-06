import {useEffect, useRef} from "react";
import {GripVertical} from "lucide-react";

// Pointer-based grip also works on touch screens; native task dragging remains independent.
export default function SectionDragHandle({id, label, view, disabled, onStart, onOver, onDrop, onEnd, onKeyDown}) {
    const cleanup = useRef(() => {});
    const handlers = useRef({onStart, onOver, onDrop, onEnd});
    handlers.current = {onStart, onOver, onDrop, onEnd};
    useEffect(() => () => cleanup.current(), []);
    function begin(event) {
        if (disabled || event.button !== 0) return;
        event.stopPropagation(); event.preventDefault(); cleanup.current();
        const source = event.currentTarget.closest("[data-section-id]");
        const container = source?.parentElement;
        if (!container) return;
        const origin = {x: event.clientX, y: event.clientY}, pointerId = event.pointerId;
        const data = new Map();
        const transfer = {setData: (key, value) => data.set(key, value), getData: key => data.get(key)};
        let started = false, ghost, target, last;
        const synthetic = (point, element) => ({clientX: point.clientX, clientY: point.clientY, currentTarget: element, dataTransfer: transfer, preventDefault() {}, stopPropagation() {}});
        function move(point) {
            if (point.pointerId !== pointerId) return;
            last = point;
            if (!started && Math.hypot(point.clientX - origin.x, point.clientY - origin.y) < 6) return;
            if (!started) {
                started = true;
                handlers.current.onStart(synthetic(point, source), id);
                const heading = source.querySelector(view === "list" ? ".task_group_header, .mobile_section_header" : "header");
                ghost = document.createElement("div"); ghost.className = "section_drag_ghost";
                ghost.textContent = label; ghost.style.width = `${Math.min(360, heading?.getBoundingClientRect().width || 240)}px`;
                ghost.setAttribute("aria-hidden", "true"); document.body.appendChild(ghost);
            }
            point.preventDefault();
            ghost.style.transform = `translate3d(${point.clientX + 12}px, ${point.clientY + 12}px, 0)`;
            const candidate = document.elementFromPoint(point.clientX, point.clientY)?.closest("[data-section-id]");
            target = candidate?.parentElement === container && candidate !== source ? candidate : null;
            if (target) handlers.current.onOver(synthetic(point, target), target.dataset.sectionId, view);
            const scroll = container.closest(".task_list, .task_board") || container;
            const rect = scroll.getBoundingClientRect();
            if (view === "list") scroll.scrollTop += point.clientY < rect.top + 40 ? -12 : point.clientY > rect.bottom - 40 ? 12 : 0;
            else scroll.scrollLeft += point.clientX < rect.left + 40 ? -12 : point.clientX > rect.right - 40 ? 12 : 0;
        }
        function finish(point) {
            if (point.pointerId !== pointerId) return;
            if (started && target) handlers.current.onDrop(synthetic(last || point, target), target.dataset.sectionId, view);
            cleanup.current();
        }
        function cancel(point) {if (point.type === "keydown" && point.key !== "Escape" || point.type === "pointercancel" && point.pointerId !== pointerId) return; cleanup.current();}
        cleanup.current = () => {
            document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", finish);
            document.removeEventListener("pointercancel", cancel); document.removeEventListener("keydown", cancel);
            ghost?.remove(); if (started) handlers.current.onEnd(); cleanup.current = () => {};
        };
        document.addEventListener("pointermove", move, {passive: false}); document.addEventListener("pointerup", finish);
        document.addEventListener("pointercancel", cancel); document.addEventListener("keydown", cancel);
    }
    return <button type="button" className="section_drag_grip" disabled={disabled} aria-label={`Mover sección ${label}`} title="Arrastra para ordenar. También Alt + flechas." onClick={event => event.stopPropagation()} onPointerDown={begin} onKeyDown={event => {event.stopPropagation(); onKeyDown(event, id, view);}}><GripVertical size={17}/></button>;
}

import { useEffect, useRef } from "react";
const dialogs = [];
let originalOverflow = "";
// Shared focus/scroll behavior; callers supply their own domain-free container selector.
export function useDialog(open, selector, onClose) {
    const close = useRef(onClose); close.current = onClose;
    useEffect(() => {
        if (!open) return;
        const panel = document.querySelector(selector);
        if (!panel) return;
        const previous = document.activeElement;
        if (!dialogs.length) originalOverflow = document.body.style.overflow;
        dialogs.push(panel);
        document.body.style.overflow = "hidden";
        const controls = () => [...panel.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')].filter(el => !el.closest('[inert]') && el.getClientRects().length);
        panel.setAttribute("tabindex", "-1");
        (controls()[0] || panel).focus({ preventScroll: true });
        const keydown = event => {
            if (dialogs.at(-1) !== panel) return;
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.current(); }
            if (event.key !== "Tab") return;
            const items = controls(), first = items[0], last = items.at(-1);
            if (!first) { event.preventDefault(); panel.focus(); }
            else if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement) || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement) || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener("keydown", keydown);
        return () => {
            document.removeEventListener("keydown", keydown);
            dialogs.splice(dialogs.lastIndexOf(panel), 1);
            if (!dialogs.length) document.body.style.overflow = originalOverflow;
            if (previous?.isConnected) previous.focus({ preventScroll: true });
        };
    }, [open, selector]);
}

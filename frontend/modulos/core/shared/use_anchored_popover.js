import {useLayoutEffect} from "react";

// Keep menus above scroll containers and inside the visible viewport, including the keyboard.
export function useAnchoredPopover(open, anchorRef, panelRef, {minWidth = 0, maxHeight = 250, gap = 7} = {}) {
    useLayoutEffect(() => {
        const panel = panelRef.current, anchor = anchorRef.current;
        if (!open || !panel || !anchor) return;
        panel.showPopover?.();
        const viewport = window.visualViewport;
        const place = () => {
            const rect = anchor.getBoundingClientRect();
            const left = (viewport?.offsetLeft || 0) + 12, top = (viewport?.offsetTop || 0) + 12;
            const right = left + (viewport?.width || window.innerWidth) - 24;
            const bottom = top + (viewport?.height || window.innerHeight) - 24;
            const width = Math.min(Math.max(rect.width, minWidth), right - left);
            Object.assign(panel.style, {boxSizing: "border-box", position: "fixed", inset: "auto", margin: "0", minWidth: "0", width: `${width}px`, maxWidth: `${right - left}px`, maxHeight: `${Math.min(maxHeight, bottom - top)}px`});
            const height = panel.offsetHeight;
            const below = bottom - rect.bottom - gap, above = rect.top - top - gap;
            const openAbove = below < height && above > below;
            panel.style.maxHeight = `${Math.max(0, Math.min(maxHeight, openAbove ? above : below, bottom - top))}px`;
            panel.style.left = `${Math.max(left, Math.min(rect.left, right - width))}px`;
            panel.style.top = `${Math.max(top, Math.min(openAbove ? rect.top - panel.offsetHeight - gap : rect.bottom + gap, bottom - panel.offsetHeight))}px`;
        };
        place();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
        observer?.observe(anchor);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        viewport?.addEventListener("resize", place);
        viewport?.addEventListener("scroll", place);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", place);
            window.removeEventListener("scroll", place, true);
            viewport?.removeEventListener("resize", place);
            viewport?.removeEventListener("scroll", place);
        };
    }, [open, anchorRef, panelRef, minWidth, maxHeight, gap]);
}

import {useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import "./notice_layer.css";

const noticeHost = () => document.querySelector(".task_image_viewer_overlay[open]") || [...document.querySelectorAll("dialog[open]")].at(-1) || document.body;
function observeHost(update) {
    const observer = new MutationObserver(update);
    observer.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ["open"]});
    return () => observer.disconnect();
}

// Popovers stay above modal dialogs without blocking the current work.
export function NoticeLayer({children}) {
    const [host, setHost] = useState(noticeHost);
    const layer = useRef(null);
    useLayoutEffect(() => observeHost(() => setHost(noticeHost())), []);
    useLayoutEffect(() => {
        const element = layer.current;
        element.showPopover?.();
        return () => { if (element.matches(":popover-open")) element.hidePopover(); };
    }, [host]);
    return createPortal(<div ref={layer} popover="manual" className="bold_notice_layer">{children}</div>, host);
}

// SweetAlert owns its container, so moving it into the active dialog is safe.
export function floatToast(popup) {
    const element = popup.closest(".swal2-container");
    element.setAttribute("popover", "manual");
    element.classList.add("bold_floating_toast");
    let previous;
    const update = () => {
        const host = noticeHost();
        if (host !== previous) {
            if (element.matches(":popover-open")) element.hidePopover();
            host.appendChild(element);
            previous = host;
        }
        if (element.isConnected && !element.matches(":popover-open")) element.showPopover?.();
    };
    update();
    return observeHost(update);
}

import { createPortal } from "react-dom";
import { useMediaQuery } from "./use_media_query.js";
// Portals keep fixed panels outside animated/scrolling module containers.
export function ResponsiveOverlay({ children, onClose, query = "(max-width: 760px)" }) {
    const mobile = useMediaQuery(query);
    const target = document.getElementById("bold-overlay-root");
    return mobile && target ? createPortal(<>{onClose && <button type="button" className="responsive_overlay_backdrop" aria-label="Cerrar panel" onClick={onClose} />}{children}</>, target) : children;
}

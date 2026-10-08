import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./onboarding_tour.css";
import { useCore } from "./core_provider.jsx";
import { useShell } from "./app_shell.jsx";
import { writeOnboardingState } from "./onboarding_state.js";
import { ONBOARDING_GUIDES, onboardingGuideId } from "./onboarding_guides.js";

function visibleElement(selector) {
    return [...document.querySelectorAll(selector)].find(element => {
        if (element.closest('[inert], [aria-hidden="true"]')) return false;
        const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth
            && style.visibility !== "hidden" && style.display !== "none";
    });
}

export function OnboardingTour({ modal = null, detail = false }) {
    const core = useCore(), shell = useShell();
    const identity = core.activeAssignment || core.account;
    const identityKey = identity?.id || identity?.personId || "demo";
    const guideId = onboardingGuideId(shell.active_module, { modal, detail });
    const sidebarOpen = shell.is_sidebar_open;

    useEffect(() => {
        if (!guideId || sidebarOpen) return;
        const guide = ONBOARDING_GUIDES[guideId];
        let disposed = false, closing = false, tour, timer, waitObserver, waitDeadline;
        let highlight, resizeObserver, frame, geometryTimer;
        const storage = () => { try { return window.localStorage; } catch { return null; } };
        const stopWaiting = () => {
            clearTimeout(timer); clearTimeout(waitDeadline); waitObserver?.disconnect(); waitObserver = null;
        };
        const updateHighlight = () => {
            frame = null;
            if (!highlight) return;
            const element = tour?.getActiveElement();
            highlight.hidden = !element || !element.isConnected;
            if (!highlight.hidden) {
                const rect = element.getBoundingClientRect();
                Object.assign(highlight.style, {
                    left: `${rect.left - 6}px`, top: `${rect.top - 6}px`,
                    width: `${rect.width + 12}px`, height: `${rect.height + 12}px`,
                });
            }
        };
        const scheduleHighlight = () => {
            if (!frame) frame = requestAnimationFrame(updateHighlight);
        };
        const cleanHighlight = () => {
            cancelAnimationFrame(frame); clearTimeout(geometryTimer); resizeObserver?.disconnect();
            window.removeEventListener("resize", scheduleHighlight);
            document.removeEventListener("scroll", scheduleHighlight, true);
            highlight?.remove(); highlight = null;
        };
        const destroy = () => {
            closing = true;
            tour?.destroy(); tour = null;
            cleanHighlight();
        };
        const finish = status => {
            if (disposed || closing) return;
            writeOnboardingState(storage(), { id: identityKey }, status, guideId);
            destroy();
        };
        const start = (waiting = false) => {
            clearTimeout(timer);
            if (!waiting) stopWaiting();
            if (disposed) return;
            const root = visibleElement(guide.root);
            const blockingDialog = [...document.querySelectorAll('[role="dialog"][aria-modal="true"], .swal2-container')]
                .some(element => element.getClientRects().length && element !== root && !root?.contains(element) && !element.contains(root));
            if (!root || blockingDialog) {
                if (!waitObserver) {
                    // Bounded, mutation-driven readiness: no idle polling or requests.
                    waitObserver = new MutationObserver(() => {
                        clearTimeout(timer); timer = setTimeout(() => start(true), 300);
                    });
                    waitObserver.observe(document.body, { childList: true, subtree: true });
                    waitDeadline = setTimeout(stopWaiting, 10000);
                }
                return;
            }
            stopWaiting(); waitObserver = null;
            if (tour?.isActive()) return;
            closing = false;
            const steps = guide.steps.flatMap(step => {
                const element = visibleElement(step.element);
                return element ? [{ ...step, element }] : [];
            });
            steps.unshift({ popover: { title: `Conoce ${guide.title}`, description: "Recorre esta vista paso a paso. Siguiente y Anterior permiten avanzar a tu ritmo; puedes cerrar u omitir cuando quieras. La guía no guarda ni cambia datos." } });
            steps.push({ popover: { title: "Ahora puedes probarlo", description: "El recorrido terminó sin modificar registros. Usa el botón de ayuda para repetir esta guía. Las opciones disponibles siguen dependiendo de tu cargo y tus permisos." } });
            highlight = document.createElement("div");
            highlight.className = "bold_tour_highlight";
            highlight.setAttribute("aria-hidden", "true"); highlight.hidden = true;
            document.body.append(highlight);
            resizeObserver = new ResizeObserver(scheduleHighlight);
            window.addEventListener("resize", scheduleHighlight);
            document.addEventListener("scroll", scheduleHighlight, true);
            const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            const previousFocus = document.activeElement;
            tour = driver({
                steps, animate: !reduced, duration: 240, smoothScroll: !reduced,
                allowClose: true, allowScroll: true, allowKeyboardControl: true,
                disableActiveInteraction: true,
                overlayColor: "#11151d", overlayOpacity: 0.78,
                stagePadding: 8, stageRadius: 12, popoverOffset: 16,
                popoverClass: "bold_onboarding_popover", showProgress: true,
                progressText: "Paso {{current}} de {{total}}",
                nextBtnText: "Siguiente", prevBtnText: "Anterior", doneBtnText: "Finalizar",
                onHighlighted: element => {
                    resizeObserver.disconnect();
                    if (element) resizeObserver.observe(element);
                    scheduleHighlight(); clearTimeout(geometryTimer);
                    geometryTimer = setTimeout(scheduleHighlight, 280);
                },
                onPopoverRender: popover => {
                    popover.closeButton.setAttribute("aria-label", "Cerrar tutorial");
                    const skip = document.createElement("button");
                    skip.type = "button"; skip.className = "bold_tour_skip";
                    skip.textContent = "Omitir guía";
                    skip.addEventListener("click", () => finish("skipped"));
                    popover.footerButtons.prepend(skip);
                },
                onCloseClick: () => finish("skipped"), onDoneClick: () => finish("completed"),
                onDestroyStarted: () => { if (!closing) finish("skipped"); },
                onDestroyed: () => {
                    cleanHighlight();
                    if (!disposed && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
                },
            });
            tour.drive();
        };
        const handleStart = () => start();
        window.addEventListener("bold:onboarding:start", handleStart);
        return () => {
            disposed = true; stopWaiting(); destroy();
            window.removeEventListener("bold:onboarding:start", handleStart);
            // Navigation/unmount is not a completed or deliberately skipped guide.
        };
    }, [identityKey, guideId, sidebarOpen]);
    return null;
}

import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./onboarding_tour.css";
import { useCore } from "./core_provider.jsx";
import { useShell } from "./app_shell.jsx";
import { readOnboardingState, writeOnboardingState } from "./onboarding_state.js";

const pause = (callback, milliseconds = 320) => window.setTimeout(callback, milliseconds);

function availableSteps(steps) {
    return steps.filter(step => !step.element || document.querySelector(step.element));
}

function createSteps({ compact, openSidebar, closeSidebar, moveNext }) {
    const welcome = {
        popover: {
            title: "Bienvenido a Bold",
            description: "En unos minutos conocerás las áreas esenciales para organizar tu trabajo. Puedes avanzar con los botones o las flechas del teclado y omitir el recorrido cuando quieras.",
            side: "bottom",
            align: "center",
            ...(compact ? { onNextClick: () => { openSidebar(); pause(moveNext); } } : {}),
        },
    };
    const navigation = [
        {
            element: '[data-tour="sidebar"]',
            popover: { title: "Tu espacio de trabajo", description: "La barra lateral reúne las herramientas disponibles para tu rol. En pantallas pequeñas puedes abrirla desde el botón de menú.", side: "right", align: "start" },
        },
        {
            element: '[data-tour="nav-home"]',
            popover: { title: "Inicio", description: "Este es tu resumen diario: prioridades, indicadores, proyectos y actividad reciente en una sola vista.", side: "right", align: "center" },
        },
        {
            element: '[data-tour="nav-tasks"]',
            popover: { title: "Tareas y proyectos", description: "Aquí puedes consultar tus tareas, entrar a un proyecto y alternar entre lista, tablero y cronograma. El menú desplegable mantiene a mano tus espacios recientes.", side: "right", align: "center" },
        },
        {
            element: '[data-tour="nav-inbox"]',
            popover: { title: "Bandeja de entrada", description: "Revisa menciones, cambios y actividad del equipo sin perder el contexto de cada tarea o proyecto.", side: "right", align: "center" },
        },
        {
            element: '[data-tour="nav-reports"]',
            popover: { title: "Informes", description: "Consulta el avance general, las tareas completadas, el trabajo en curso y el progreso de cada proyecto.", side: "right", align: "center" },
        },
        {
            element: '[data-tour="nav-permissions"]',
            popover: { title: "Permisos", description: "Si tu rol lo permite, desde aquí administras quién puede ver o modificar cada parte del espacio de trabajo.", side: "right", align: "center" },
        },
        {
            element: '[data-tour="nav-administration"]',
            popover: { title: "Administración", description: "Los administradores pueden gestionar personas, estructura organizativa, catálogos y configuración general desde este módulo.", side: "right", align: "center" },
        },
        {
            element: '[data-tour="profile"]',
            popover: {
                title: "Tu perfil y seguridad",
                description: "Consulta tu identidad y rol activo. El menú de perfil también permite administrar MFA y cerrar la sesión de forma segura.",
                side: "right",
                align: "end",
                ...(compact ? { onNextClick: () => { closeSidebar(); pause(moveNext); } } : {}),
            },
        },
    ];
    const workspace = [
        {
            element: compact ? '[data-tour="mobile-header"]' : '[data-tour="home-header"]',
            popover: { title: "Tu día de un vistazo", description: "Bold reúne lo que requiere atención hoy. La información cambia con tus proyectos, tareas y fechas de vencimiento.", side: compact ? "bottom" : "bottom", align: "start" },
        },
        {
            element: '[data-tour="home-toolbar"]',
            popover: { title: "Un inicio a tu medida", description: "Agrega, elimina, mueve o cambia el tamaño de los widgets. Si quieres volver al diseño original, usa Restaurar.", side: "bottom", align: "end" },
        },
        {
            element: '[data-tour="home-dashboard"]',
            popover: { title: "Widgets interactivos", description: "Cada tarjeta resume una parte del trabajo. Puedes abrir tareas y proyectos directamente, cambiar pestañas y usar atajos sin abandonar Inicio.", side: "top", align: "center" },
        },
        {
            element: '[data-tour="search"]',
            popover: { title: "Búsqueda contextual", description: "Busca tareas, proyectos o personas. Los resultados y el texto de ayuda se adaptan al módulo que estés utilizando.", side: "bottom", align: "start" },
        },
        {
            element: '[data-tour="theme"]',
            popover: { title: "Modo claro u oscuro", description: "Cambia el tema visual cuando lo necesites. Bold recordará tu preferencia en este dispositivo.", side: "bottom", align: "center" },
        },
        {
            element: '[data-tour="notifications"]',
            popover: { title: "Notificaciones", description: "El punto indicador avisa cuando hay novedades. Desde aquí puedes revisar la actividad y marcarla como leída.", side: "bottom", align: "center" },
        },
        {
            element: '[data-tour="help"]',
            popover: { title: "Vuelve cuando quieras", description: "Este botón reinicia el tutorial completo. Puedes repetirlo después de una pausa o usarlo para orientar a otra persona.", side: "bottom", align: "end" },
        },
        {
            popover: { title: "Todo listo para comenzar", description: "Empieza desde Inicio, abre un proyecto o crea tu primera tarea. El tutorial no modificó ningún dato y siempre podrás volver a consultarlo.", side: "bottom", align: "center" },
        },
    ];
    return availableSteps([welcome, ...navigation, ...workspace]);
}

export function OnboardingTour() {
    const core = useCore();
    const shell = useShell();
    const tourRef = useRef(null);
    const autoStartedForRef = useRef("");
    const closingRef = useRef(false);
    const identity = core.activeAssignment || core.account;
    const identityKey = identity?.id || identity?.personId || "demo";

    useEffect(() => {
        const finish = status => {
            writeOnboardingState(localStorage, identity, status);
            closingRef.current = true;
            tourRef.current?.destroy();
            tourRef.current = null;
        };
        const start = ({ manual = false } = {}) => {
            if (tourRef.current?.isActive()) tourRef.current.destroy();
            closingRef.current = false;
            shell.set_active_module("home");
            shell.set_is_sidebar_open(false);
            pause(() => {
                const compact = window.matchMedia("(max-width: 1023px)").matches;
                const steps = createSteps({
                    compact,
                    openSidebar: () => shell.set_is_sidebar_open(true),
                    closeSidebar: () => shell.set_is_sidebar_open(false),
                    moveNext: () => tourRef.current?.moveNext(),
                });
                let tour;
                tour = driver({
                    steps,
                    animate: true,
                    duration: 280,
                    smoothScroll: true,
                    allowClose: true,
                    allowScroll: true,
                    allowKeyboardControl: true,
                    overlayColor: "#20242b",
                    overlayOpacity: 0.68,
                    stagePadding: 10,
                    stageRadius: 14,
                    popoverOffset: 14,
                    popoverClass: "bold_onboarding_popover",
                    showProgress: true,
                    progressText: "Paso {{current}} de {{total}}",
                    nextBtnText: "Siguiente",
                    prevBtnText: "Anterior",
                    doneBtnText: "Comenzar",
                    skipMissingElement: true,
                    waitForElement: 2500,
                    onPopoverRender: popover => {
                        if (popover.footerButtons.querySelector(".bold_tour_skip")) return;
                        const skip = document.createElement("button");
                        skip.type = "button";
                        skip.className = "bold_tour_skip";
                        skip.textContent = "Omitir tutorial";
                        skip.addEventListener("click", () => finish("skipped"));
                        popover.footerButtons.prepend(skip);
                    },
                    onCloseClick: () => finish("skipped"),
                    onDoneClick: () => finish("completed"),
                    onDestroyStarted: () => {
                        if (!closingRef.current) finish("skipped");
                    },
                    onDestroyed: () => {
                        shell.set_is_sidebar_open(false);
                        tourRef.current = null;
                        closingRef.current = false;
                    },
                });
                tourRef.current = tour;
                tour.drive();
                if (manual) document.querySelector('[data-tour="help"]')?.blur();
            });
        };
        const handleStart = () => start({ manual: true });
        window.addEventListener("bold:onboarding:start", handleStart);
        if (autoStartedForRef.current !== identityKey && !readOnboardingState(localStorage, identity)) {
            const timer = pause(() => {
                if (autoStartedForRef.current === identityKey) return;
                autoStartedForRef.current = identityKey;
                start();
            }, 850);
            return () => {
                window.clearTimeout(timer);
                window.removeEventListener("bold:onboarding:start", handleStart);
                tourRef.current?.destroy();
            };
        }
        return () => {
            window.removeEventListener("bold:onboarding:start", handleStart);
            tourRef.current?.destroy();
        };
    }, [identityKey]);

    return null;
}

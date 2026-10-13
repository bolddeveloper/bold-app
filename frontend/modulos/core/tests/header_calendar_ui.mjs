// Local visual fixture: real TimeGrid and application CSS, no accounts/network APIs.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createServer as httpServer} from "node:http";
import path from "node:path";
import os from "node:os";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {Bell, Moon, CircleHelp, UsersRound} from "lucide-react";
import {createServer} from "vite";

const vite = await createServer({configFile: false, plugins: [{name: "isolated-calendar", enforce: "pre", transform(_, id) {
    const file = id.replaceAll("\\", "/");
    if (file.endsWith("/tareas/src/task_app.jsx")) return "export const CalendarDateField = () => null;";
    if (file.endsWith("/core/core_provider.jsx")) return "export const useCore = () => ({});";
}}], resolve: {dedupe: ["react", "react-dom", "lucide-react", "sweetalert2"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"},
    cacheDir: path.join(os.tmpdir(), "bold-header-calendar-ui"), optimizeDeps: {noDiscovery: true, include: [], entries: []}, server: {middlewareMode: true, hmr: false}, appType: "custom"});
try {
    const {TimeGrid} = await vite.ssrLoadModule(`/@fs/${path.resolve("../calendario/calendar_module.jsx").replaceAll("\\", "/")}`);
    const {fromDay, upcomingWeekDays} = await import("../../calendario/calendar_data.js");
    const now = new Date("2026-10-13T18:30:00Z");
    const grid = (count, date = "2026-10-13") => renderToStaticMarkup(React.createElement(TimeGrid, {
        days: date === "2026-10-13" && count === 5 ? upcomingWeekDays(fromDay(date), fromDay(date)) : Array.from({length: count}, (_, i) => { const day = fromDay(date); day.setDate(day.getDate() + i); return day; }),
        events: [], tasks: [], zone: "America/Guatemala", now, onEvent() {}, onTask() {}, onCreate() {},
    }));
    const week = grid(5), day = grid(1), historical = grid(7, "2026-10-04");
    assert.equal((week.match(/class="bold_calendar_now_line"/g) || []).length, 1);
    assert.match(week, /bold_calendar_time_scroll/);
    assert.match(week, /top:650px/);
    assert.match(day, /bold_calendar_now_line/);
    assert.doesNotMatch(historical, /bold_calendar_now_line/);
    assert.equal((week.match(/bold_calendar_time_column/g) || []).length, 5);
    assert.match(week, /Crear evento el 2026-10-13[^>]*><div class="bold_calendar_now_line"/);
    assert.doesNotMatch(week, /Crear evento el 2026-10-1[12]/);
    assert.doesNotMatch(week, /Crear evento el 2026-10-14[^>]*><div class="bold_calendar_now_line"/);
    console.log("TimeGrid UI: marker only in today, current week without past days, correct time, day/week, no historical marker passed.");
    if (!process.argv.includes("--serve")) process.exitCode = 0;
    else {
        const styles = ["../tareas/src/styles.css", "app_shell.css", "../calendario/calendar.css"].map(file => readFileSync(file, "utf8")).join("\n");
        const icons = [CircleHelp, Moon, Bell, UsersRound].map((Icon, i) => renderToStaticMarkup(React.createElement("button", {
            className: i === 2 ? "bell_button bell_has_unread" : "theme_toggle_button", "aria-label": ["Ayuda", "Tema", "Notificaciones", "Miembros"][i],
        }, React.createElement(Icon, {size: 18}), i === 2 && React.createElement("span", {className: "bell_unread_dot"})))).join("");
        const server = httpServer((request, response) => {
            const query = new URL(request.url, "http://localhost").searchParams;
            const dark = query.has("dark"), single = query.has("day");
            response.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
            response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\nbody{margin:0;padding:20px;background:var(--bold_bg,#f7f6f5)}.top_bar_actions{justify-content:flex-end;margin-bottom:18px}.bold_calendar{padding:0}.bold_calendar_time_scroll{max-height:420px}</style></head><body class="${dark ? "theme_dark" : ""}"><div class="top_bar_actions">${icons}</div><section class="bold_calendar">${single ? day : week}</section><script>const pane=document.querySelector('.bold_calendar_time_scroll');const marker=document.querySelector('.bold_calendar_now_line');if(marker)pane.scrollTop=parseFloat(marker.style.top)-140;</script></body></html>`);
        });
        server.listen(5178, "127.0.0.1", () => console.log("Visual fixture http://127.0.0.1:5178/ (?dark, ?day); no application APIs"));
        await new Promise(resolve => { for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(resolve)); });
    }
} finally { await vite.close(); }

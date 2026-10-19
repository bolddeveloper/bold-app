import assert from "node:assert/strict";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import Swal from "sweetalert2";
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {createServer} from "vite";

const {JSDOM} = await import(pathToFileURL(join(tmpdir(), "bold-ui-check/node_modules/jsdom/lib/api.js")));
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5174"});
for (const key of ["window", "document", "HTMLElement", "Event"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Browser cache channels have no purpose in this isolated DOM fixture.
globalThis.BroadcastChannel = undefined;
dom.window.HTMLElement.prototype.attachEvent = function () {};
dom.window.HTMLElement.prototype.detachEvent = function () {};
const originalFire = Swal.fire, originalStorage = globalThis.localStorage;
const noticeCalls = [], noticeAnswers = [], preferences = new Map();
globalThis.localStorage = {getItem: key => preferences.get(key) || null, setItem: (key, value) => preferences.set(key, value)};
Swal.fire = async options => {noticeCalls.push(options); return noticeAnswers.shift() || {isConfirmed: true};};
let published = [], requests = [], deferredPerson, shareCalendar = false, failCalendarSave = false;
const person = {id: "person", name: "Samuel"}, second = {id: "second", name: "David Urbina"};
const task = {id: "task", title: "Preparar campaña", description: "Descripción", assignee_name: "Samuel", status_name: "En curso", priority: "high", subtasks: [], attachments: []};
globalThis.teamRequest = async (url, options = {}) => {
    requests.push({url, ...options});
    if (url.endsWith("directory/")) return {departments: [{id: "marketing", name: "Marketing", people: [person, second]}]};
    if (url.endsWith("self/")) {
        if (options.method === "PUT") published = options.body.visible ? [...options.body.task_ids] : [];
        if (options.method === "PATCH") {
            if (failCalendarSave) throw new Error("No se pudo guardar la agenda");
            shareCalendar = options.body.share_calendar;
        }
        return {employee_id: person.id, task_ids: published, inherited_ids: [], share_calendar: shareCalendar};
    }
    if (url.endsWith("second/board/")) return {board_name: "Mis tareas", tasks: [{...task, id: "second-task", title: "Tarea de David"}], sections: []};
    if (url.endsWith("person/board/")) {
        if (deferredPerson) return deferredPerson;
        return {board_name: "Personal", tasks: [{...task,stage:"review",stage_name:"En revisión",stage_color:"#f59e0b"}], stages: [{id:"review",label:"En revisión"}], sections: [{id: "unsectioned", label: "Sin sección"}]};
    }
    if (url.includes("meetings/")) return {state: "hidden", meetings: []};
    if (url.endsWith("tasks/task/")) return task;
    throw new Error(`Unexpected request: ${url}`);
};
const server = await createServer({configFile: false, plugins: [{name: "team-ui-fixtures", enforce: "pre", transform(source, id) {
    const path = id.replaceAll("\\", "/");
    if (path.endsWith("/tareas/src/team.jsx")) return source.replace('import {Eye, EyeOff, Users, CalendarDays, RefreshCw} from "lucide-react";', 'const Eye = () => null, EyeOff = Eye, Users = Eye, CalendarDays = Eye, RefreshCw = Eye;');
    if (path.endsWith("/core/http_client.js")) return "export const http = {request: (...args) => globalThis.teamRequest(...args)};";
    if (path.endsWith("/tareas/src/task_text_editor.jsx")) return "export function TaskText({value}) {return value;}";
    if (path.endsWith("/tareas/src/voice_notes.jsx")) return "export function VoiceNotes() {return null;}";
    if (path.endsWith("/tareas/src/image_gallery.jsx")) return "export function ImageGallery() {return null;}";
}},], resolve: {dedupe: ["react", "react-dom"]}, optimizeDeps: {noDiscovery: true, entries: [], include: []}, esbuild: {jsx: "automatic"}, server: {middlewareMode: true, hmr: false}, appType: "custom"});
const root = createRoot(document.getElementById("root"));
const click = async element => act(async () => element.click());
const button = text => [...document.querySelectorAll("button")].find(item => item.textContent.endsWith(text));
try {
    const {default: TeamPanel, TeamCalendarSharing, TeamSharingContext, SharingEye, useTeamSharing} = await server.ssrLoadModule(`/@fs/${resolve("../tareas/src/team.jsx").replaceAll("\\", "/")}`);
    let sharing;
    function Harness() {
        sharing = useTeamSharing("assignment", true);
        return React.createElement(TeamSharingContext.Provider, {value: sharing},
            React.createElement(SharingEye, {ids: ["task"], label: task.title}),
            React.createElement("div", {className: "bold_calendar"}, React.createElement(TeamCalendarSharing, {assignmentId: "assignment"})),
            React.createElement(TeamPanel, {sharing, assignmentId: "assignment", enabled: true, CalendarDateField: props => React.createElement("button", {"aria-label": props.ariaLabel, "data-date": props.value, onClick: () => props.onChange("2026-01-01")}, props.value), renderBoard: props => {
                assert.equal(props.readOnly, true);
                assert.equal(props.handle_task_select, undefined);
                if(props.filtered_tasks[0]?.id === "task") {
                    assert.equal(props.board_columns[0].label,"En revisión","Render personal stage instead of legacy section");
                    assert.equal(props.filtered_tasks[0].section,"review");
                    assert.equal(props.filtered_tasks[0].status,"En revisión");
                }
                return React.createElement("div", {className: "board_view"}, props.filtered_tasks.map(item => React.createElement("span", {key: item.id}, item.title)));
            }}));
    }
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(document.querySelector('.team_panel [role="switch"]'), null, "Agenda preference belongs only to Calendar");
    await click(document.querySelector('.bold_calendar [role="switch"]'));
    assert.equal(shareCalendar, true);
    assert.equal(document.querySelector('.bold_calendar [role="switch"]').checked, true);
    failCalendarSave = true;
    await click(document.querySelector('.bold_calendar [role="switch"]'));
    assert.equal(document.querySelector('.bold_calendar [role="switch"]').checked, true, "Failed save must restore the previous preference");
    assert.ok(document.querySelector('.bold_calendar [role="alert"]'));
    failCalendarSave = false;
    assert.equal(document.querySelector(".team_share_eye").getAttribute("aria-pressed"), "false");
    noticeAnswers.push({isConfirmed: false});
    await click(document.querySelector(".team_share_eye"));
    assert.deepEqual(published, [], "Cancel does not publish");
    await click(document.querySelector(".team_share_eye"));
    assert.deepEqual(published, ["task"]);
    assert.ok(noticeCalls.at(-1).text.includes("toda la empresa"));
    assert.ok(noticeCalls.at(-1).text.includes("comentarios"));
    await click(document.querySelector(".team_share_eye"));
    assert.equal(noticeCalls.length, 2, "Hiding does not require publishing confirmation");
    noticeAnswers.push({isDenied: true});
    await click(document.querySelector(".team_share_eye"));
    assert.deepEqual(published, ["task"], "Do not show again also confirms sharing");
    await click(document.querySelector(".team_share_eye"));
    await click(document.querySelector(".team_share_eye"));
    assert.equal(noticeCalls.length, 3, "Saved preference suppresses later notices");
    assert.equal(document.querySelector(".team_share_eye").getAttribute("aria-pressed"), "true");
    await click(button("Samuel"));
    assert.equal(document.querySelector(".team_named_board h3").textContent, "Personal");
    assert.equal(document.querySelector(".team_task_detail"), null);
    assert.equal(requests.some(item => item.url.includes("/tasks/task/")), false, "Equipo must not fetch a removed detail panel");
    await click(button("Reuniones"));
    const dateField = document.querySelector('[aria-label="Día de reuniones"]');
    const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    assert.equal(dateField.dataset.date, today);
    await click(dateField);
    assert.ok(requests.at(-1).url.includes("date=2026-01-01"));
    await click(button("Tareas"));
    await click(button("Reuniones"));
    assert.equal(document.querySelector('[aria-label="Día de reuniones"]').dataset.date, today, "Reopening meetings resets to today");
    assert.ok(document.querySelector(".team_meetings").textContent.includes("no comparte su agenda"));
    let resolveOld;
    deferredPerson = new Promise(resolve => {resolveOld = resolve;});
    await click(button("Tareas"));
    await click(button("David Urbina"));
    assert.ok(document.querySelector(".board_view").textContent.includes("Tarea de David"));
    await act(async () => resolveOld({tasks: [task], sections: []}));
    assert.ok(document.querySelector(".board_view").textContent.includes("Tarea de David"), "Old person response must not replace the selected person");
    assert.equal(document.querySelector(".team_profile_header h2").textContent, "David Urbina");
    assert.ok(requests.some(item => item.method === "PUT"));
    console.log("Equipo UI: eyes, named board, read-only board, calendar and stale requests OK");
} finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    delete globalThis.teamRequest;
    Swal.fire = originalFire;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
}

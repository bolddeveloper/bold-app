import assert from "node:assert/strict";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {createServer} from "vite";
import {entranceModule} from "../shell_navigation_state.js";
const {JSDOM} = await import(pathToFileURL(join(tmpdir(), "bold-ui-check/node_modules/jsdom/lib/api.js")));
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost:5174"});
for (const key of ["window", "document", "Event", "CustomEvent"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let resolvePermission;
globalThis.navigationCore = {account: {id: "account"}, activeAssignment: {id: "employee"}, permissions: {can: () => new Promise(resolve => {resolvePermission = resolve;})}};
const mounted = [];
globalThis.navigationShell = ({children, contextId, navigation}) => {
    const module = entranceModule(navigation, "sheets");
    mounted.push({contextId, module});
    return React.createElement("div", {"data-module": module}, children);
};
const server = await createServer({configFile: false, plugins: [{name: "navigation-fixtures", enforce: "pre", transform(source, id) {
    const path = id.replaceAll("\\", "/");
    if (path.endsWith("/core/app.jsx")) return source + "\nexport {ApplicationWorkspace};";
    if (path.endsWith("/core/core_provider.jsx")) return "export const useCore = () => globalThis.navigationCore; export const CoreProvider = ({children}) => children;";
    if (path.endsWith("/core/app_shell.jsx")) return "export const ShellProvider = props => globalThis.navigationShell(props);";
    if (path.endsWith("/core/core_models.js")) return "export const canUseManagementModule = () => false;";
    if (path.endsWith("/tareas/src/data/task_data.js")) return "export const team_members = [];";
    if (path.endsWith("/hojas/sheets_cache.js")) return "export const sheetsCache = {clear: async () => {}};";
    if (/\/(task_app|admin_module|permissions_module|calendar_module|profile_module|workspace_module|suggestions_module|sheets_module)\.jsx(?:\?|$)/.test(path)) return "export default function Module() {return null;}";
}}], resolve: {dedupe: ["react", "react-dom"]}, optimizeDeps: {noDiscovery: true, entries: [], include: []}, esbuild: {jsx: "automatic"}, server: {middlewareMode: true, hmr: false}, appType: "custom"});
const root = createRoot(document.getElementById("root"));
try {
    const {ApplicationWorkspace} = await server.ssrLoadModule(`/@fs/${resolve("app.jsx").replaceAll("\\", "/")}`);
    await act(async () => root.render(React.createElement(ApplicationWorkspace)));
    assert.equal(mounted.length, 0, "Do not restore against incomplete permissions");
    await act(async () => resolvePermission(true));
    assert.equal(mounted.at(-1).module, "sheets", "Allowed saved module survives startup");
    const count = mounted.length;
    globalThis.navigationCore = {...globalThis.navigationCore, activeAssignment: {id: "other"}};
    await act(async () => root.render(React.createElement(ApplicationWorkspace)));
    assert.equal(mounted.length, count, "Old department permission cannot restore a new department");
    await act(async () => resolvePermission(false));
    assert.equal(mounted.at(-1).contextId, "other");
    assert.equal(mounted.at(-1).module, "home", "Denied saved module must still be rejected");
    console.log("Navigation startup: waits for permissions, restores allowed module, isolates departments, rejects denied module OK");
} finally {
    await act(async () => root.unmount());
    await server.close(); dom.window.close();
    delete globalThis.navigationCore; delete globalThis.navigationShell;
}

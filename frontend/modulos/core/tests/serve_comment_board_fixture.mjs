import {createServer} from "vite";
import {readFileSync} from "node:fs";
import path from "node:path";
import os from "node:os";
const taskSource = readFileSync("../tareas/src/task_app.jsx", "utf8");
const fixturePath = path.resolve("../../testing/comment_board_fixture.jsx").replaceAll("\\", "/");
const card = taskSource.slice(taskSource.indexOf("function render_board_card(props)"), taskSource.indexOf("// Renders the timeline/Gantt view")).trim().replace("function render_board_card", "export function RenderBoardCard");
const server = await createServer({configFile: false, plugins: [{name: "board-fixture", resolveId(id) {if (id === "virtual:bold-board-preview.jsx") return id;}, load(id) {
    if (id === "virtual:bold-board-preview.jsx") return `import React from 'react'; import {plainRichText} from '/@fs/${path.resolve("../tareas/src/rich_text.js").replaceAll("\\", "/")}'; const get_member=()=>({}); const get_project=()=>({label:'BOLD'}); const render_project_dot=()=>null; const render_icon=()=>null; const check_icon=null; const render_days_badge=()=>null; const render_avatar=()=>null; const get_priority_class=()=>''; const TaskMobileActions=()=>null; ${card}`;
}, configureServer(server) {server.middlewares.use((request, response, next) => {if (request.url?.split("?")[0] !== "/") return next(); response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${fixturePath}"></script></body></html>`);});}}],
    resolve: {dedupe: ["react", "react-dom", "lucide-react", "sweetalert2"]}, esbuild: {jsx: "automatic", jsxImportSource: "react"}, cacheDir: path.join(os.tmpdir(), "bold-comment-board-fixture"), optimizeDeps: {noDiscovery: true, include: ["react", "react-dom", "sweetalert2", "react-dom/client", "react/jsx-dev-runtime", "react/jsx-runtime", "lucide-react"], entries: []}, server: {host: "127.0.0.1", port: 5178, strictPort: true, fs: {allow: [path.resolve("../../.."), path.join(os.tmpdir(), "bold-comment-board-fixture")]}, hmr: false}});
await server.listen(); console.log("Local visual fixture: http://127.0.0.1:5178/ (?dark); synthetic data only.");

// Actual application/sidebar, fresh synthetic demo session; no backend or real account.
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {createRequire} from "node:module";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const {chromium} = require(path.join(process.env.LOCALAPPDATA, "BOLDApp/validation/runtime/node_modules/playwright"));
const server = await createServer({configFile: false, root: path.resolve("."), plugins: [react()],
    resolve: {dedupe: ["react", "react-dom", "lucide-react", "sweetalert2", "qrcode"]},
    define: {"import.meta.env.VITE_USE_REAL_BACKEND": JSON.stringify("false")},
    cacheDir: path.join(os.tmpdir(), "bold-team-navigation-browser"),
    optimizeDeps: {entries: ["index.html"]},
    server: {host: "127.0.0.1", port: 0, fs: {allow: [path.resolve("..")]}}});
let browser;
try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch();
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: "reduce"});
    await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        if (url.pathname.startsWith("/api/")) return route.fulfill({status: 503, json: {detail: "Isolated UI test: no backend"}});
        return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin, {waitUntil: "domcontentloaded", timeout: 60000});
    await page.getByRole("button", {name: "Inicio", exact: true}).waitFor({timeout: 60000});
    const mine = page.getByRole("button", {name: "Mis tareas", exact: true});
    const team = page.locator(".team_sidebar_button");
    if (!await mine.isVisible()) await page.getByRole("button", {name: "Tareas", exact: true}).click();
    await mine.click(); await team.click(); await page.locator(".team_module").waitFor(); await mine.click();
    if (process.argv.includes("--expect-bug")) {
        await page.locator(".team_module").waitFor();
        assert.equal(await team.getAttribute("aria-current"), "page");
        console.log("Reproduced: clicking Mis tareas leaves the actual application in Equipo.");
    } else {
        await page.locator(".team_module").waitFor({state: "hidden"});
        assert.match(await mine.getAttribute("class"), /my_tasks_button_active/);
        const personalKey = await page.evaluate(() => Object.keys(localStorage).find(key => key.startsWith("bold_task_navigation:") && key.endsWith(":mine:view")));
        assert.ok(personalKey);
        for (const view of ["board", "states", "timeline", "list"]) {
            await page.getByRole("tab", {name: view === "states" ? "Estados" : view === "timeline" ? "Cronograma" : "Tareas", exact: true}).click();
            if (["board", "list"].includes(view)) await page.getByTitle(view === "board" ? "Vista en columnas" : "Vista en lista", {exact: true}).click();
            await team.click(); await page.locator(".team_module").waitFor();
            assert.equal(await page.evaluate(key => localStorage.getItem(key), personalKey), view);
            await page.reload(); await team.waitFor(); await page.locator(".team_module").waitFor();
            await mine.click(); await page.locator(".team_module").waitFor({state: "hidden"});
            if (["board", "list"].includes(view)) assert.equal(await page.getByTitle(view === "board" ? "Vista en columnas" : "Vista en lista", {exact: true}).getAttribute("aria-pressed"), "true");
            else assert.equal(await page.getByRole("tab", {name: view === "states" ? "Estados" : "Cronograma", exact: true}).getAttribute("aria-selected"), "true");
        }
        await team.click(); await page.evaluate(key => localStorage.setItem(key, "team"), personalKey);
        await page.reload(); await page.locator(".team_module").waitFor(); await mine.click();
        await page.locator(".team_module").waitFor({state: "hidden"});
        assert.equal(await page.getByRole("tab", {name: "Tareas", exact: true}).getAttribute("aria-selected"), "true");
        await page.getByRole("button", {name: "+ Agregar tarea", exact: true}).click();
        const composer = page.locator(".bold_task_composer textarea");
        await composer.fill("Borrador de prueba sin enviar"); await composer.click();
        assert.equal(await composer.inputValue(), "Borrador de prueba sin enviar");
        await page.keyboard.press("Escape"); await composer.waitFor({state: "hidden"});
        await page.getByRole("button", {name: /^Novedades(?: sin leer)?$/}).click();
        const note = page.locator(".header_news_card").first(); await note.waitFor();
        const noteTitle = await note.locator("strong").innerText(); await note.click();
        assert.equal(await page.locator("#bold_news_title").innerText(), noteTitle);
        await page.getByRole("button", {name: "Cerrar notas de parche", exact: true}).click();
        assert.deepEqual(errors, []);
        console.log("Actual app: Equipo → Mis tareas, four personal views, reload/legacy recovery, quick composer clicks/Escape and header release-note reader passed.");
    }
} finally {await browser?.close(); await server.close();}

// Opt-in, isolated real-browser acceptance. No production origin/account allowed.
import assert from "node:assert/strict";
import path from "node:path";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
const root = path.resolve(process.env.BOLD_MULTITASKING_ACCEPTANCE_DIR || "");
const parent = path.resolve(process.env.LOCALAPPDATA || "", "BOLDApp", "validation");
assert.equal(path.dirname(root), parent);
assert.match(path.basename(root), /^pwa-multitasking-[a-f0-9]{32}$/);
const fixture = JSON.parse(readFileSync(path.join(root, "fixture.json"), "utf8"));
assert.equal(fixture.local_only, true); assert.equal(fixture.url, "http://127.0.0.1:5195");
const require = createRequire(import.meta.url);
const playwright = require(path.join(parent, "runtime", "node_modules", "playwright"));
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const mode = process.argv.includes("--notifications-only") ? "notifications" : process.argv.includes("--navigation-only") ? "navigation" : "full";
const reportFile = path.join(root, `${engine}-${mode}-browser-result.json`);
let nativeTestProcess, nativeTestBrowser;
const launch = async () => {
    if (engine === "chromium" && mode === "notifications") {
        // Playwright's ordinary context forces pages visible. Use an owned local
        // browser with no focus override so background behavior is real, not a
        // mocked document.hidden getter. Never attach to the user's browser.
        const profile = mkdtempSync(path.join(root, "notification-browser-"));
        nativeTestProcess = spawn(playwright.chromium.executablePath(), ["--headless=new", "--window-size=1365,900", "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, "about:blank"],
        {windowsHide: true, stdio: ["ignore", "ignore", "pipe"]});
        try {
            const endpoint = await new Promise((resolve, reject) => {
                let text = "";
                const timer = setTimeout(() => reject(Error("Owned notification browser startup timed out")), 15000);
                nativeTestProcess.stderr.on("data", value => {
                    text = (text + value.toString()).slice(-32768);
                    const match = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/);
                    if (match) {clearTimeout(timer); resolve(match[1]);}
                });
                nativeTestProcess.once("error", error => {clearTimeout(timer); reject(error);});
                nativeTestProcess.once("exit", () => {clearTimeout(timer); reject(Error("Owned notification browser exited"));});
            });
            nativeTestBrowser = await playwright.chromium.connectOverCDP(endpoint, {noDefaults: true});
            const context = nativeTestBrowser.contexts()[0];
            await context.grantPermissions(["notifications"], {origin: fixture.url});
            return context;
        } catch (error) {nativeTestProcess.kill(); throw error;}
    }
    const context = await playwright[engine].launchPersistentContext(path.join(root, `browser-${engine}`), {
        headless: true, viewport: {width: 1365, height: 900}, serviceWorkers: "allow",
        // Full Chromium headless supports the notification runtime; headless-shell
        // reports Permissions granted while Notification.permission stays denied.
        ...(engine === "chromium" ? {channel: "chromium"} : {}),
    });
    if (engine === "chromium") await context.grantPermissions(["notifications"], {origin: fixture.url});
    return context;
};
let context = await launch();
let page = context.pages()[0] || await context.newPage();
await page.setViewportSize({width: 1365, height: 900});
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", error => errors.push(error.message.replace(/\?[^\s'"]+/g, "?[redacted]")));
const report = {engine, stages: [], errors, installedDisplayMode: false, production: false};
const checkpoint = (stage, details = {}) => {
    report.stages.push({stage, ...details});
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`${engine}: ${stage}`);
};
async function request(ctx, target, method = "GET", data, assignment = fixture.accounts[0].assignment_id) {
    assert.ok(target.startsWith("/api/v2/"));
    const cookies = await ctx.cookies(fixture.url), csrf = cookies.find(row => row.name === "csrftoken")?.value;
    const response = await ctx.request.fetch(fixture.url + target, {method, ...(data !== undefined ? {data} : {}),
        headers: {Origin: fixture.url, "X-Assignment-ID": assignment, ...(csrf ? {"X-CSRFToken": csrf} : {})}});
    assert.ok(response.ok(), `${method} ${target.split("?")[0]} returned ${response.status()}`);
    return response.status() === 204 ? null : await response.json();
}
async function ready() {
    await page.waitForFunction(() => document.querySelector('#core_auth_email:not([disabled])') || document.querySelector('[aria-label="Abrir ajustes rápidos del perfil"]'));
}
async function loginAs(index) {
    await ready();
    const current = await (await context.request.get(fixture.url + "/api/v2/auth/session/")).json();
    if (current.authenticated && current.account.email !== fixture.accounts[index].email) await logoutUI();
    const email = page.locator("#core_auth_email");
    if (await email.isVisible().catch(() => false)) {
        await email.fill(fixture.accounts[index].email); await page.locator("#core_auth_password").fill(fixture.accounts[index].password);
        await page.getByRole("button", {name: "Iniciar sesión", exact: true}).click();
    }
    await page.getByRole("button", {name: "Abrir ajustes rápidos del perfil", exact: true}).waitFor();
    const session = await (await context.request.get(fixture.url + "/api/v2/auth/session/")).json();
    assert.equal(session.account.email, fixture.accounts[index].email);
    const later = page.getByRole("button", {name: "Más tarde", exact: true});
    if (await later.isVisible().catch(() => false)) await later.click();
}
async function closeDrawer() {
    const cancel = page.locator('[data-task-drawer="true"]').getByRole("button", {name: "Cancelar", exact: true});
    if (await cancel.isVisible().catch(() => false)) {await cancel.click(); await cancel.waitFor({state: "hidden"});}
    const detail = page.getByRole("button", {name: "Cerrar panel", exact: true});
    if (await detail.isVisible().catch(() => false)) {await detail.click(); await detail.waitFor({state: "hidden"});}
}
async function logoutUI() {
    await closeDrawer();
    await page.getByRole("button", {name: "Abrir ajustes rápidos del perfil", exact: true}).click();
    await page.getByRole("button", {name: "Cerrar sesión", exact: true}).click();
    await page.locator("#core_auth_email:not([disabled])").waitFor();
}
async function openCreation() {
    await closeDrawer();
    await page.getByRole("button", {name: "Inicio", exact: true}).click();
    await page.getByRole("button", {name: "Crear una tarea", exact: true}).click();
    await page.getByPlaceholder("¿Qué hay que hacer?").waitFor();
}
const description = () => page.getByRole("textbox", {name: "Descripción", exact: true});
const protectedDraft = () => page.locator(".task_draft_status").getByText(/Borrador cifrado guardado|Borrador recuperado/).waitFor();
async function discardCreation() {
    await page.getByRole("button", {name: "Descartar borrador", exact: true}).click();
    await page.getByRole("button", {name: "Aceptar", exact: true}).click();
    await page.getByPlaceholder("¿Qué hay que hacer?").waitFor({state: "hidden"});
}
async function longDescription(suffix) {
    await description().evaluate(node => {
        node.innerHTML = Array.from({length: 350}, (_, index) => `<p><b>Bloque ${index}</b> con descripción y <a href="https://example.com/${index}">Guía ${index}</a></p>`).join("") + "<p>Final</p>";
        node.focus(); const range = document.createRange(); range.selectNodeContents(node.lastChild); range.collapse(false);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        node.dispatchEvent(new InputEvent("input", {bubbles: true, inputType: "insertFromPaste"}));
    });
    const start = Date.now(); await page.keyboard.type(suffix, {delay: 3});
    return Date.now() - start;
}
async function runFlow() {
    const nonce = randomUUID().slice(0, 8), title = `Borrador ${engine} ${nonce}`, suffix = ` Últimas letras ${nonce}`;
    await loginAs(0); await openCreation();
    await page.getByPlaceholder("¿Qué hay que hacer?").fill(title);
    const typingMs = await longDescription(suffix);
    await closeDrawer();
    await page.getByRole("button", {name: "Calendario", exact: true}).click();
    await page.getByPlaceholder("¿Qué hay que hacer?").waitFor({state: "hidden"});
    await openCreation();
    assert.equal(await page.getByPlaceholder("¿Qué hay que hacer?").inputValue(), title);
    assert.ok((await description().innerText()).endsWith(suffix));
    assert.equal(await description().locator("a").count(), 350);
    checkpoint("draft retained across drawer close and real module navigation", {blocks: 350, typingMs, engineIsPhysicalMac: false});
    await protectedDraft(); await page.reload(); await ready(); await openCreation();
    assert.equal(await page.getByPlaceholder("¿Qué hay que hacer?").inputValue(), title);
    assert.ok((await description().innerText()).endsWith(suffix));
    await protectedDraft(); await context.close();
    context = await launch(); page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", error => errors.push(error.message.replace(/\?[^\s'"]+/g, "?[redacted]")));
    await page.goto(fixture.url); await loginAs(0); await openCreation();
    assert.equal(await page.getByPlaceholder("¿Qué hay que hacer?").inputValue(), title);
    assert.ok((await description().innerText()).endsWith(suffix));
    checkpoint("draft retained across page reload and full browser restart");
    const raw = await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {const query = indexedDB.open("bold-task-drafts", 1); query.onsuccess = () => resolve(query.result); query.onerror = () => reject(query.error);});
        const rows = await new Promise((resolve, reject) => {const query = db.transaction("drafts").objectStore("drafts").getAll(); query.onsuccess = () => resolve(query.result); query.onerror = () => reject(query.error);});
        db.close(); return rows.map(row => ({...row, ciphertext: [...new Uint8Array(row.ciphertext)]}));
    });
    assert.ok(raw.length); assert.ok(!JSON.stringify(raw).includes(title)); assert.ok(!JSON.stringify(raw).includes(suffix));
    await closeDrawer(); await logoutUI(); await loginAs(1); await openCreation();
    assert.notEqual(await page.getByPlaceholder("¿Qué hay que hacer?").inputValue(), title, "Account B must never inherit account A's private draft");
    assert.ok(!(await description().innerText()).includes(suffix));
    await page.getByPlaceholder("¿Qué hay que hacer?").fill(`Privado B ${nonce}`); await protectedDraft();
    await closeDrawer(); await logoutUI(); await loginAs(0); await openCreation();
    assert.equal(await page.getByPlaceholder("¿Qué hay que hacer?").inputValue(), title);
    assert.ok((await description().innerText()).endsWith(suffix));
    checkpoint("logout/relogin recovery, account isolation and ciphertext verified");
    await discardCreation(); await openCreation(); assert.equal(await page.getByPlaceholder("¿Qué hay que hacer?").inputValue(), "");
    const createdTitle = `Creada ${engine} ${nonce}`;
    await page.getByPlaceholder("¿Qué hay que hacer?").fill(createdTitle);
    await description().fill("Descripción enviada con último carácter X");
    const submit = page.getByRole("button", {name: "Crear tarea", exact: true});
    await submit.waitFor(); await submit.click();
    await page.getByPlaceholder("¿Qué hay que hacer?").waitFor({state: "hidden"});
    const titleButton = page.getByRole("button", {name: createdTitle, exact: true});
    await titleButton.waitFor(); await page.locator(".task_row").filter({has: titleButton}).click({position: {x: 2, y: 2}});
    await page.getByText("Creada el", {exact: true}).waitFor();
    let task;
    for (let attempt = 0; attempt < 40; attempt++) {
        const rows = await request(context, "/api/v2/tasks/"); task = rows.results.find(row => row.title === createdTitle);
        if (task) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(task, "Real task creation must be confirmed by the API");
    const originalDate = task.created_at;
    const time = page.locator('.detail_meta_grid time[title="Fecha y hora originales · zona horaria de este dispositivo"]');
    for (let attempt = 0; attempt < 40; attempt++) {
        if (new Date(await time.getAttribute("datetime")).toISOString() === new Date(originalDate).toISOString()) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(new Date(await time.getAttribute("datetime")).toISOString(), new Date(originalDate).toISOString());
    await page.getByRole("button", {name: "Editar tarea", exact: true}).first().click();
    await page.getByRole("button", {name: "Guardar cambios", exact: true}).waitFor();
    const editSuffix = ` Guardado inmediato ${nonce}`; const editTypingMs = await longDescription(editSuffix);
    await page.getByRole("button", {name: "Guardar cambios", exact: true}).click();
    await page.getByRole("button", {name: "Guardar cambios", exact: true}).waitFor({state: "hidden"});
    let saved;
    for (let attempt = 0; attempt < 40; attempt++) {
        saved = await request(context, `/api/v2/tasks/${task.id}/`);
        if (saved.description.includes(editSuffix)) break;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(saved.description.includes(editSuffix)); assert.equal(saved.created_at, originalDate);
    checkpoint("real task creation/edit retains final input and original timestamp", {editTypingMs, blocks: 350});
    await closeDrawer();
    if (engine === "chromium") await notificationFlow(task.id, false);
    assert.deepEqual(errors, []);
    checkpoint("functional browser acceptance passed");
}

async function notificationFlow(taskId, testHidden = true) {
    await page.evaluate(async () => {await navigator.serviceWorker.ready;});
    await context.grantPermissions(["notifications"], {origin: fixture.url});
    assert.equal(await page.evaluate(() => Notification.permission), "granted");
    const owner = await context.browser().newContext();
    let background;
    try {
        await request(owner, "/api/v2/auth/session/");
        await request(owner, "/api/v2/auth/login/", "POST", {email: fixture.accounts[2].email, password: fixture.accounts[2].password}, fixture.accounts[2].assignment_id);
        await page.evaluate(async () => {for (const notice of await (await navigator.serviceWorker.ready).getNotifications()) notice.close();});
        await page.evaluate(() => {
            window.__acceptanceAudio = [];
            const play = HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play = function (...args) {
                const result = play.apply(this, args);
                result.then(() => window.__acceptanceAudio.push({played: true, paused: this.paused}), () => window.__acceptanceAudio.push({played: false}));
                return result;
            };
        });
        const marker = `Aviso privado de aceptación ${randomUUID()}`;
        await request(owner, "/api/v2/comments/", "POST", {task: taskId, body: marker}, fixture.accounts[2].assignment_id);
        await page.getByRole("button", {name: "Notificaciones", exact: true}).first().click();
        await page.locator(".bold_owner_notice").first().waitFor();
        const notices = await waitNotices(row => row.title === "BOLD · Propietario");
        assert.ok(notices.some(row => row.title === "BOLD · Propietario"));
        assert.ok(!JSON.stringify(notices).includes(marker));
        checkpoint("owner notice and private generic system alert received through real API/socket/worker");
        await page.waitForFunction(() => window.__acceptanceAudio.some(row => row.played && !row.paused));
        checkpoint("foreground notification audio reaches real media playback", {audibleHardwareVerified: false});
        if (!testHidden) return;
        const oldTags = notices.map(row => row.tag);
        background = await context.newPage(); await background.goto("about:blank"); await background.bringToFront();
        await page.waitForFunction(() => document.hidden);
        await request(owner, "/api/v2/comments/", "POST", {task: taskId, body: `${marker} en segundo plano`}, fixture.accounts[2].assignment_id);
        const hiddenNotice = await waitNotices(row => !oldTags.includes(row.tag));
        assert.ok(hiddenNotice.some(row => row.title === "BOLD · Propietario" && row.silent === false));
        assert.ok(!JSON.stringify(hiddenNotice).includes(marker));
        checkpoint("hidden page receives a real worker system notice with system sound enabled", {audibleHardwareVerified: false, providerTransport: "open-page socket; no external push provider"});
        await page.bringToFront(); await page.waitForFunction(() => !document.hidden);
    } finally {await background?.close(); await owner.close();}
}
async function waitNotices(predicate) {
    let rows;
    for (let attempt = 0; attempt < 80; attempt++) {
        rows = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(row => ({title: row.title, body: row.body, tag: row.tag, silent: row.silent})));
        if (rows.some(predicate)) return rows.filter(predicate);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(`No matching system notice received (${rows.length} unrelated notices)`);
}
async function navigationFlow() {
    async function mine(target = page) {
        const button = target.getByRole("button", {name: "Mis tareas", exact: true});
        if (!await button.isVisible()) await target.getByRole("button", {name: "Tareas", exact: true}).click();
        await button.click();
        await target.getByRole("tab", {name: "Tareas", exact: true}).waitFor();
    }
    async function expanded(target, id, expected) {
        await target.waitForFunction(({id, expected}) => document.querySelector(`[data-section-id="${id}"] .task_group_header`)?.getAttribute("aria-expanded") === expected, {id, expected});
    }
    await closeDrawer(); await mine(); await page.getByRole("tab", {name: "Tareas", exact: true}).click();
    await page.getByTitle("Vista en lista", {exact: true}).click();
    const header = page.locator(".task_group_header").first(); await header.waitFor();
    const id = await header.evaluate(node => node.parentElement.dataset.sectionId);
    if (await header.getAttribute("aria-expanded") === "true") await header.click({position: {x: 8, y: 8}});
    await expanded(page, id, "false"); await page.reload(); await loginAs(0); await mine(); await expanded(page, id, "false");
    const sibling = await context.newPage();
    try {
        await sibling.goto(fixture.url); await sibling.getByRole("button", {name: "Abrir ajustes rápidos del perfil", exact: true}).waitFor();
        await mine(sibling); await expanded(sibling, id, "false");
        await page.locator(`[data-section-id="${id}"] .task_group_header`).click({position: {x: 8, y: 8}});
        await expanded(sibling, id, "true");
        checkpoint("section collapse survives reload and a sibling tab follows real storage events");
    } finally {await sibling.close();}
    await page.getByRole("tab", {name: "Estados", exact: true}).click();
    await page.getByRole("button", {name: "Calendario", exact: true}).click(); await mine();
    assert.equal(await page.getByRole("tab", {name: "Estados", exact: true}).getAttribute("aria-selected"), "true");
    await page.reload(); await loginAs(0); await mine();
    assert.equal(await page.getByRole("tab", {name: "Estados", exact: true}).getAttribute("aria-selected"), "true");
    await logoutUI(); await loginAs(0); await mine();
    assert.equal(await page.getByRole("tab", {name: "Estados", exact: true}).getAttribute("aria-selected"), "true");
    await page.getByRole("tab", {name: "Tareas", exact: true}).click(); await page.getByTitle("Vista en columnas", {exact: true}).click();
    await page.getByRole("button", {name: "Calendario", exact: true}).click(); await mine();
    assert.equal(await page.getByTitle("Vista en columnas", {exact: true}).getAttribute("aria-pressed"), "true");
    await page.reload(); await loginAs(0); await mine();
    assert.equal(await page.getByTitle("Vista en columnas", {exact: true}).getAttribute("aria-pressed"), "true");
    checkpoint("Estados and board preference survive module changes, reload and logout/relogin");
    await page.getByTitle("Vista en lista", {exact: true}).click();
}
try {
    await page.goto(fixture.url, {waitUntil: "domcontentloaded"});
    const email = page.locator("#core_auth_email");
    await page.waitForFunction(() => document.querySelector('#core_auth_email:not([disabled])') || document.querySelector('[aria-label="Abrir ajustes rápidos del perfil"]'));
    if (await email.isVisible().catch(() => false) && await email.isEnabled()) {
        await email.fill(fixture.accounts[0].email);
        await page.locator("#core_auth_password").fill(fixture.accounts[0].password);
        await page.getByRole("button", {name: "Iniciar sesión", exact: true}).click();
    }
    await page.getByRole("button", {name: "Abrir ajustes rápidos del perfil", exact: true}).waitFor();
    const session = await (await context.request.get(fixture.url + "/api/v2/auth/session/")).json();
    assert.equal(session.authenticated, true, "Acceptance must use the real isolated cookie API, never mockIdentity");
    assert.equal(session.account.email, fixture.accounts[0].email);
    console.log(`${engine}: authenticated UI ready`);
    if (process.argv.includes("--inspect-task")) {
        const later = page.getByRole("button", {name: "Más tarde", exact: true});
        if (await later.isVisible().catch(() => false)) await later.click();
        await page.getByRole("button", {name: "Inicio", exact: true}).click();
        await page.getByRole("button", {name: "Crear una tarea", exact: true}).click();
        await page.getByPlaceholder("¿Qué hay que hacer?").waitFor();
        console.log("TASK_FORM", (await page.locator("body").innerText()).slice(-5500));
        console.log("TASK_COMBOBOXES", await page.getByRole("combobox").evaluateAll(nodes => nodes.map(node => ({label: node.getAttribute("aria-label"), text: node.textContent}))));
        await page.screenshot({path: path.join(root, `${engine}-task-form.png`)});
    }
    if (process.argv.includes("--inspect")) {
        console.log((await page.locator("body").innerText()).slice(0, 5000));
        console.log("BUTTONS", await page.getByRole("button").allTextContents());
        console.log("RUNTIME", await page.evaluate(() => ({crypto: !!crypto.subtle, indexedDB: !!window.indexedDB,
            worker: "serviceWorker" in navigator, notification: "Notification" in window,
            push: "PushManager" in window, display: matchMedia("(display-mode: standalone)").matches})));
        await page.screenshot({path: path.join(root, `${engine}-initial.png`)});
    }
    if (process.argv.includes("--notifications-only")) await notificationFlow(fixture.task_id);
    else if (process.argv.includes("--navigation-only")) await navigationFlow();
    else if (!process.argv.includes("--inspect") && !process.argv.includes("--inspect-task")) await runFlow();
    assert.deepEqual(errors, []);
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
} catch (error) {
    report.failure = error.message.replace(/\?[^\s'"]+/g, "?[redacted]");
    writeFileSync(reportFile, JSON.stringify(report, null, 2));
    await page.screenshot({path: path.join(root, `${engine}-failure.png`)}).catch(() => {});
    throw error;
} finally {
    await context.close();
    await nativeTestBrowser?.close(); nativeTestProcess?.kill();
}

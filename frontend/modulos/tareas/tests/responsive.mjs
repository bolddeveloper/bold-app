import { createServer } from "vite";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const { chromium } = await import(pathToFileURL(path.join(os.tmpdir(), "bold-v2-dom/node_modules/playwright/index.mjs")));
const real = process.env.BOLD_REAL === "true";
process.env.VITE_USE_REAL_BACKEND = String(real);
if (real) process.env.VITE_API_BASE_URL = "http://localhost:5178";
const server = await createServer({ server: { port: 5178, strictPort: true, proxy: real ? {
    "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    "/ws": { target: "ws://127.0.0.1:8000", ws: true, headers: { origin: "http://localhost:5173" } }
} : undefined } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.BOLD_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const artifacts = path.join(os.tmpdir(), "bold-responsive"); await fs.mkdir(artifacts, { recursive: true });
const errors = [];
async function noOverflow(page, label) {
    const sizes = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(sizes.document <= sizes.width + 1 && sizes.body <= sizes.width + 1, `${label}: ${JSON.stringify(sizes)}`);
}
async function fits(page, locator, label) {
    const box = await locator.boundingBox(), viewport = page.viewportSize();
    assert.ok(box && box.x >= -1 && box.x + box.width <= viewport.width + 1, `${label}: ${JSON.stringify(box)}`);
}
async function isDarkSurface(locator, label) {
    const color = await locator.evaluate(element => getComputedStyle(element).backgroundColor);
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    assert.equal(channels.length, 3, `${label}: invalid background ${color}`);
    assert.ok(channels.reduce((sum, channel) => sum + channel, 0) / 3 < 100, `${label}: light background ${color}`);
}
try {
    for (const width of (process.env.BOLD_WIDTHS || "320,360,375,390,414,480,768,820,1023,1024,1280,1440,1920").split(",").map(Number)) {
        const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: width < 1024 });
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") { errors.push(message.text().replace(/token=[^&\s]+/g, "token=[redacted]")); console.log(message.text().replace(/token=[^&\s]+/g, "token=[redacted]")); } });
        page.setDefaultTimeout(8000);
        await page.goto("http://localhost:5178");
        if (real) {
            await fits(page, page.getByRole("dialog", { name: "Iniciar sesión" }), "login");
            await page.locator('[name="email"]').fill("ana@bold.gt");
            await page.locator('[name="password"]').fill("bolddemo123");
            await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
        }
        await page.locator(width < 1024 ? ".task_card" : ".task_row").first().waitFor();
        await page.screenshot({ path: path.join(artifacts, `tasks-${width}.png`), fullPage: true, animations: "disabled" });
        await noOverflow(page, `tasks ${width}`);
        if (width < 1024) {
            await page.getByRole("button", { name: "Abrir navegacion", exact: true }).click();
            await page.locator(".sidebar_shell_open").waitFor();
            await page.keyboard.press("Escape");
            await page.locator(".sidebar_shell[inert]").waitFor({ state: "attached" });
        }
        await page.locator('button[aria-label="Notificaciones"]:visible').click();
        await fits(page, page.locator(".notifications_panel"), "notifications");
        await page.getByRole("button", { name: "Cerrar notificaciones", exact: true }).first().click();
        await page.getByRole("button", { name: /^Filtrar/ }).first().click();
        await fits(page, page.locator(".task_options_panel"), "filters");
        await page.getByRole("button", { name: "Aplicar", exact: true }).click();
        if (width < 1024) {
            await page.locator(".task_card_content").first().click();
            await fits(page, page.locator(".task_detail_sidebar"), "detail");
            await page.screenshot({ path: path.join(artifacts, `detail-${width}.png`), animations: "disabled" });
            await page.getByTitle("Cerrar panel", { exact: true }).click();
            await page.getByRole("button", { name: "Agregar tarea", exact: true }).click();
            await fits(page, page.getByRole("dialog", { name: "Nueva tarea", exact: true }), "create");
            await page.screenshot({ path: path.join(artifacts, `create-${width}.png`), animations: "disabled" });
            if (width <= 760) {
                await page.getByRole("button", { name: "Seleccionar fecha", exact: true }).click();
                await page.locator('.native_date_picker input').fill("2026-10-12");
                await page.getByRole("button", { name: "Aplicar fecha", exact: true }).click();
            }
            await page.getByRole("button", { name: real ? "Agregar seguidor" : "Agregar colaborador", exact: true }).click();
            await fits(page, page.locator(".collaborator_picker_dropdown"), "collaborators");
            await page.locator(".picker_done_btn").click();
            await page.setViewportSize({ width, height: 430 });
            const footer = await page.locator(".bold_modal_footer").boundingBox();
            assert.ok(footer && footer.y >= 0 && footer.y + footer.height <= 431, "footer must remain above keyboard-sized viewport");
            await page.keyboard.press("Escape");
            await page.setViewportSize({ width, height: 850 });
        }
        await page.getByTitle("Vista en columnas", { exact: true }).click();
        await page.locator(".board_view").waitFor();
        await noOverflow(page, `board ${width}`);
        await page.screenshot({ path: path.join(artifacts, `board-${width}.png`), fullPage: true, animations: "disabled" });
        if (width < 1024 && !real) {
            const first = page.locator(".board_card").first();
            await first.locator("summary").click();
            const select = first.locator("select");
            const target = await select.locator("option").last().getAttribute("value");
            await select.selectOption(target);
            assert.ok(await page.locator(".board_card").count());
        }
        await page.getByTitle("Vista en lista", { exact: true }).click();
        for (const tab of ["Cronograma", "Calendario"]) {
            await page.getByRole("tab", { name: tab, exact: true }).click();
            await noOverflow(page, `${tab} ${width}`);
        }
        await page.getByRole("tab", { name: "Tareas", exact: true }).click();
        for (const module of ["Bandeja de entrada", "Inicio", "Informes"]) {
            if (width < 1024) await page.getByRole("button", { name: "Abrir navegacion", exact: true }).click();
            await page.locator(".navigation_list").getByRole("button", { name: module, exact: true }).click();
            await noOverflow(page, `${module} ${width}`);
            await page.screenshot({ path: path.join(artifacts, `${module.split(" ")[0]}-${width}.png`), fullPage: true, animations: "disabled" });
            if (module === "Bandeja de entrada") {
                await page.locator(".inbox_toolbar").getByRole("button", { name: /^Filtrar/ }).click();
                await fits(page, page.locator(".inbox_dropdown"), "inbox filters");
                await page.getByRole("button", { name: "Cerrar opciones", exact: true }).click();
            }
            if (module === "Bandeja de entrada" && width < 900 && await page.locator(".inbox_activity_main").count()) {
                await page.locator(".inbox_activity_main").first().click();
                await fits(page, page.locator(".inbox_detail_panel_open"), "inbox detail");
                await page.getByRole("button", { name: "Volver a la bandeja", exact: true }).click();
            }
        }
        if (width < 1024) await page.getByRole("button", { name: "Abrir navegacion", exact: true }).click();
        await page.getByRole("button", { name: "Crear proyecto", exact: true }).click();
        await fits(page, page.getByRole("dialog", { name: "Crear proyecto", exact: true }), "project modal");
        await page.screenshot({ path: path.join(artifacts, `project-${width}.png`), animations: "disabled" });
        await page.keyboard.press("Escape");
        if (width < 1024) await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Activar modo oscuro", exact: true }).click();
        await page.screenshot({ path: path.join(artifacts, `dark-${width}.png`), animations: "disabled" });
        if (process.env.BOLD_DARK_AUDIT === "true") {
            await isDarkSurface(page.locator(".main_workspace"), `dark workspace ${width}`);
            if (width < 1024) await page.getByRole("button", { name: "Abrir navegacion", exact: true }).click();
            await page.locator(".navigation_list").getByRole("button", { name: "Mis tareas", exact: true }).click();
            const taskSurface = page.locator(width < 1024 ? ".task_card" : ".task_table_card").first();
            await taskSurface.waitFor();
            await isDarkSurface(taskSurface, `dark tasks ${width}`);
            await page.screenshot({ path: path.join(artifacts, `dark-tasks-${width}.png`), fullPage: true, animations: "disabled" });
            await page.locator('button[aria-label="Notificaciones"]:visible').click();
            await isDarkSurface(page.locator(".notifications_panel"), `dark notifications ${width}`);
            await page.screenshot({ path: path.join(artifacts, `dark-notifications-${width}.png`), animations: "disabled" });
            await page.getByRole("button", { name: "Cerrar notificaciones", exact: true }).first().click();
            await page.locator(width < 1024 ? ".task_card_content" : ".task_name_button").first().click();
            await isDarkSurface(page.locator(".task_detail_panel_card"), `dark detail ${width}`);
            await page.screenshot({ path: path.join(artifacts, `dark-detail-${width}.png`), animations: "disabled" });
            await page.getByTitle("Cerrar panel", { exact: true }).click();
            await page.getByRole("button", { name: "Agregar tarea", exact: true }).click();
            await isDarkSurface(page.locator(".bold_modal_window"), `dark task modal ${width}`);
            await page.screenshot({ path: path.join(artifacts, `dark-create-${width}.png`), animations: "disabled" });
            await page.keyboard.press("Escape");
            if (width < 1024) await page.getByRole("button", { name: "Abrir navegacion", exact: true }).click();
            await page.locator(".navigation_list").getByRole("button", { name: "Bandeja de entrada", exact: true }).click();
            await isDarkSurface(page.locator(".inbox_card"), `dark inbox ${width}`);
            await page.screenshot({ path: path.join(artifacts, `dark-inbox-${width}.png`), fullPage: true, animations: "disabled" });
        }
        await noOverflow(page, `after interactions ${width}`);
        console.log(`RESPONSIVE PASS ${width}px`);
        await page.close();
    }
    assert.deepEqual(errors, []);
    console.log("Screenshots:", artifacts);
} finally { await browser.close(); await server.close(); }

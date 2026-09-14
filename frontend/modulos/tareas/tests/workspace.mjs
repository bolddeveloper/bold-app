import { createServer } from "vite";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const { chromium } = await import(pathToFileURL(path.join(os.tmpdir(), "bold-v2-dom/node_modules/playwright/index.mjs")));
const real = process.env.BOLD_REAL === "true";
process.env.VITE_USE_REAL_BACKEND = String(real);
const server = await createServer({ server: { port: 5182, strictPort: true, proxy: real ? { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } } : undefined } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.BOLD_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
try {
    for (const width of (process.env.BOLD_WIDTHS || "320,390,768,1024,1440").split(",").map(Number)) {
        const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: width < 1024 });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto("http://localhost:5182");
        if (real) {
            await page.locator('[name="email"]').fill("ana@bold.gt");
            await page.locator('[name="password"]').fill("bolddemo123");
            await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
        }
        await page.locator(".task_card:visible, .task_row:visible").first().waitFor();
        if (width < 1024) await page.getByRole("button", { name: "Abrir navegacion" }).click();
        await page.getByRole("button", { name: "Ver Workspaces" }).click();
        await page.getByRole("heading", { name: "BOLD Workspace" }).waitFor();
        await page.getByRole("table", { name: "Tareas de Workspace" }).waitFor();
        const filters = page.locator(".workspace_toolbar details").first();
        await filters.locator("summary").click();
        const filterBox = await page.locator(".workspace_filter_panel").boundingBox();
        assert.ok(filterBox && filterBox.x >= -1 && filterBox.x + filterBox.width <= width + 1, `${width}: filtros fuera del viewport`);
        await page.getByRole("button", { name: "Cerrar filtros" }).click();
        if (width === 320) { await filters.locator("summary").click(); await page.keyboard.press("Escape"); assert.equal(await filters.getAttribute("open"), null); }
        if (width === 390 || width === 1440) { const dir = path.join(os.tmpdir(), "bold-workspace"); await fs.mkdir(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, `workspace-${real ? "real" : "mock"}-${width}.png`), fullPage: true, animations: "disabled" }); }
        const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
        assert.ok(dimensions.document <= dimensions.viewport + 1, `${width}: ${JSON.stringify(dimensions)}`);
        assert.deepEqual(errors, [], `${width}: errores de consola`);
        if (width === 390) {
            await page.getByRole("button", { name: "Crear varias" }).click();
            await page.getByRole("dialog", { name: "Crear varias tareas" }).waitFor();
            await page.keyboard.press("Escape");
            await page.getByRole("dialog", { name: "Crear varias tareas" }).waitFor({ state: "detached" });
            if (!real) {
            await page.getByRole("textbox", { name: "Nombre de la nueva tarea" }).fill("Nueva tarea Workspace");
            await page.getByRole("button", { name: "Crear", exact: true }).click();
            await page.getByRole("button", { name: "Nueva tarea Workspace", exact: true }).waitFor();
            await page.getByRole("button", { name: "Completar Nueva tarea Workspace" }).click();
            await page.getByRole("button", { name: "Reabrir Nueva tarea Workspace" }).waitFor();
            await page.getByRole("button", { name: "Nueva tarea Workspace", exact: true }).click();
            await page.getByRole("dialog", { name: "Detalle de tarea" }).waitFor();
            }
        }
        if (width === 390 || width === 1440) {
            await page.getByRole("button", { name: "Activar modo oscuro" }).click();
            const color = await page.locator(".workspace_toolbar").evaluate(element => getComputedStyle(element).backgroundColor);
            const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number);
            assert.ok(channels.reduce((sum, channel) => sum + channel, 0) / 3 < 100, `${width}: Workspace oscuro ${color}`);
            const dir = path.join(os.tmpdir(), "bold-workspace");
            await page.screenshot({ path: path.join(dir, `workspace-dark-${real ? "real" : "mock"}-${width}.png`), fullPage: true, animations: "disabled" });
        }
        await page.close();
        console.log(`Workspace ${width}px: OK`);
    }
} finally {
    await browser.close();
    await server.close();
}

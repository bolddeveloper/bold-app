import { createServer } from "vite";
import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import assert from "node:assert/strict";

const { chromium } = await import(pathToFileURL(path.join(os.tmpdir(), "bold-v2-dom/node_modules/playwright/index.mjs")));
const real = process.env.BOLD_REAL === "true";
process.env.VITE_USE_REAL_BACKEND = String(real);
const server = await createServer({ server: { port: 5179, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.BOLD_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const artifacts = path.join(os.tmpdir(), "bold-theme-login");
await fs.mkdir(artifacts, { recursive: true });
const errors = [];
async function fits(page, selector) {
    const box = await page.locator(selector).first().boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1, `${selector}: ${JSON.stringify(box)}`);
}
async function darkSurface(page, selector) {
    const color = await page.locator(selector).first().evaluate(element => getComputedStyle(element).backgroundColor);
    const rgb = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [];
    assert.ok(rgb.length === 3 && rgb.reduce((a, b) => a + b, 0) / 3 < 100, `${selector} is ${color}`);
}
async function noOverflow(page) {
    const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(size.document <= size.viewport + 1, JSON.stringify(size));
}
async function noLargeLightSurfaces(page) {
    const surfaces = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(element => {
        const box = element.getBoundingClientRect();
        if (box.width * box.height < 5000 || box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) return false;
        const color = getComputedStyle(element).backgroundColor;
        const rgb = color.match(/[\d.]+/g)?.map(Number) || [];
        return rgb.length >= 3 && (rgb[3] ?? 1) > .7 && rgb.slice(0, 3).every(channel => channel > 200);
    }).slice(0, 8).map(element => ({ tag: element.tagName, className: String(element.className).slice(0, 100) })));
    assert.deepEqual(surfaces, [], JSON.stringify(surfaces));
}
try {
    for (const width of [320, 390, 768, 1024, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 850 }, hasTouch: width < 1024 });
        page.setDefaultTimeout(10000);
        page.on("pageerror", error => errors.push(error.message));
        await page.goto("http://localhost:5179");
        if (real) {
            await page.getByRole("heading", { name: "Bienvenido de nuevo" }).waitFor();
            await fits(page, ".core_auth_form_wrap");
            await noOverflow(page);
            if (width === 390) {
                assert.equal(await page.locator(".core_auth_form_wrap").evaluate(element => getComputedStyle(element).animationName), "core_auth_enter");
                await page.emulateMedia({ reducedMotion: "reduce" });
                assert.equal(await page.locator(".core_auth_form_wrap").evaluate(element => getComputedStyle(element).animationName), "none");
                await page.emulateMedia({ reducedMotion: "no-preference" });
            }
            await page.locator('[name="password"]').fill("prueba");
            await page.getByRole("button", { name: "Mostrar contraseña" }).click();
            assert.equal(await page.locator('[name="password"]').getAttribute("type"), "text");
            await page.getByRole("button", { name: "¿Olvidaste tu contraseña?" }).click();
            await page.locator("#core_auth_recovery_email").waitFor();
            await page.screenshot({ path: path.join(artifacts, `login-light-${width}.png`), animations: "disabled" });
            await page.getByRole("button", { name: "Activar modo oscuro" }).click();
            await darkSurface(page, ".core_auth_content");
            await page.screenshot({ path: path.join(artifacts, `login-dark-${width}.png`), animations: "disabled" });
            await noOverflow(page);
            if (width === 1024) {
                await page.reload();
                await page.getByRole("button", { name: "Activar modo claro" }).waitFor();
                await darkSurface(page, ".core_auth_content");
                await page.getByRole("button", { name: "Activar modo claro" }).click();
                await page.reload();
                await page.getByRole("button", { name: "Activar modo oscuro" }).waitFor();
            }
            if (width === 390) {
                await page.route("**/api/v2/auth/login/", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Credenciales incorrectas." }) }));
                await page.locator('[name="email"]').fill("prueba@bold.gt");
                await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
                await page.getByRole("alert").getByText("Credenciales incorrectas.").waitFor();
                await page.screenshot({ path: path.join(artifacts, "login-error-390.png"), animations: "disabled" });
            }
        } else {
            await page.locator(width < 1024 ? ".task_card" : ".task_row").first().waitFor();
            await page.getByRole("button", { name: "Activar modo oscuro" }).click();
            await darkSurface(page, ".main_workspace");
            await darkSurface(page, width < 1024 ? ".task_card" : ".task_table_card");
            await noLargeLightSurfaces(page);
            await page.screenshot({ path: path.join(artifacts, `tasks-dark-${width}.png`), animations: "disabled" });
            for (const [name, selector] of [["Inicio", ".home_card"], ["Informes", ".reports_card"], ["Bandeja de entrada", ".inbox_card"]]) {
                if (width < 1024) await page.getByRole("button", { name: "Abrir navegacion" }).click();
                await page.locator(".navigation_list").getByRole("button", { name, exact: true }).click();
                await page.locator(selector).first().waitFor();
                await darkSurface(page, selector);
                await noLargeLightSurfaces(page);
                await noOverflow(page);
                await page.screenshot({ path: path.join(artifacts, `${name.replaceAll(" ", "-")}-dark-${width}.png`), animations: "disabled" });
            }
            if (width === 390 || width === 1440) {
                if (width < 1024) await page.getByRole("button", { name: "Abrir navegacion" }).click();
                await page.getByRole("button", { name: "Ver Workspaces" }).click();
                await page.getByRole("button", { name: "Crear carpeta" }).click();
                await page.getByRole("dialog", { name: "Crear carpeta" }).waitFor();
                assert.equal(await page.locator(".folder_dialog").evaluate(element => getComputedStyle(element).animationName), "folder_dialog_enter");
                await page.emulateMedia({ reducedMotion: "reduce" });
                assert.equal(await page.locator(".folder_dialog").evaluate(element => getComputedStyle(element).animationName), "none");
                await page.emulateMedia({ reducedMotion: "no-preference" });
                await noOverflow(page);
                await page.getByRole("dialog", { name: "Crear carpeta" }).getByRole("button", { name: "Cerrar" }).click();
            }
        }
        console.log(`${real ? "LOGIN" : "THEME"} PASS ${width}px`);
        await page.close();
    }
    assert.deepEqual(errors, []);
    console.log(`Screenshots: ${artifacts}`);
} finally { await browser.close(); await server.close(); }

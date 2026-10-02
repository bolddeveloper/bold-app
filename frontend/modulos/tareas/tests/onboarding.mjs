import { pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

process.env.VITE_USE_REAL_BACKEND = "false";
const { chromium } = await import(pathToFileURL(path.join(os.tmpdir(), "bold-v2-dom/node_modules/playwright/index.mjs")));
const { createServer } = await import(pathToFileURL(path.resolve("node_modules/vite/dist/node/index.js")));
const server = await createServer({ server: { port: 5182, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.BOLD_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });

async function openApp(viewport) {
    const page = await browser.newPage({ viewport, hasTouch: viewport.width < 1024 });
    await page.goto("http://localhost:5182");
    await page.locator(".driver-popover.bold_onboarding_popover").waitFor();
    return page;
}

try {
    const desktop = await openApp({ width: 1440, height: 900 });
    assert.equal(await desktop.locator(".bold_tour_skip").textContent(), "Omitir guía");
    let safety = 20;
    while (safety-- > 0) {
        const button = desktop.locator(".driver-popover-next-btn");
        const label = (await button.textContent()).trim();
        await button.click();
        if (label === "Finalizar") break;
        await desktop.waitForTimeout(340);
    }
    assert.ok(safety > 0, "El tutorial debe finalizar en menos de 20 pasos.");
    await desktop.locator(".driver-popover").waitFor({ state: "detached" });
    const completed = await desktop.evaluate(() => Object.entries(localStorage).map(([, value]) => value).find(value => value.includes('"completed"')));
    assert.ok(completed, "El estado completado debe persistirse.");
    await desktop.getByRole("button", { name: "Abrir tutorial de este módulo" }).click();
    await desktop.locator(".bold_tour_skip").waitFor();
    await desktop.locator(".bold_tour_skip").click();
    await desktop.locator(".driver-popover").waitFor({ state: "detached" });
    const skipped = await desktop.evaluate(() => Object.entries(localStorage).map(([, value]) => value).find(value => value.includes('"skipped"')));
    assert.ok(skipped, "El estado omitido debe persistirse.");
    await desktop.close();

    const mobile = await openApp({ width: 390, height: 844 });
    await mobile.locator(".driver-popover-next-btn").click();
    await mobile.waitForTimeout(400);
    assert.equal(await mobile.locator(".sidebar_shell_open").count(), 0, "La guía de Inicio no fuerza la navegación móvil.");
    await mobile.locator(".bold_tour_skip").click();
    await mobile.locator(".driver-popover").waitFor({ state: "detached" });
    await mobile.close();
    console.log("ONBOARDING PASS desktop + mobile");
} finally {
    await browser.close();
    await server.close();
}

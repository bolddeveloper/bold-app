import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

import worker from "./index.js";

test("permite solicitar microfono en el propio sitio sin habilitar otros dispositivos", () => {
    const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
    assert.match(headers, /Permissions-Policy: camera=\(\), geolocation=\(\), microphone=\(self\), payment=\(\), usb=\(\)/);
});


function create_environment() {
    const calls = { assets: [], backend: [] };
    return {
        calls,
        env: {
            ASSETS: {
                async fetch(request) {
                    calls.assets.push(request);
                    return new Response("asset");
                },
            },
            BACKEND: {
                async fetch(request) {
                    calls.backend.push(request);
                    return new Response("backend");
                },
            },
        },
    };
}


test("envia API y query string al servicio VPC", async () => {
    const { calls, env } = create_environment();
    const request = new Request("https://boldapp.example.workers.dev/api/v2/session/?next=1", {
        headers: { Origin: "https://boldapp.example.workers.dev" },
    });

    const response = await worker.fetch(request, env);

    assert.equal(await response.text(), "backend");
    assert.equal(calls.assets.length, 0);
    assert.equal(calls.backend[0].url, "http://backend/api/v2/session/?next=1");
    assert.equal(calls.backend[0].headers.get("x-forwarded-host"), "boldapp.example.workers.dev");
    assert.equal(calls.backend[0].headers.get("x-forwarded-proto"), "https");
});


test("preserva la solicitud de upgrade WebSocket", async () => {
    const { calls, env } = create_environment();
    const request = new Request("https://boldapp.example.workers.dev/ws/unit/7/?ticket=one-use", {
        headers: { Upgrade: "websocket", Connection: "Upgrade" },
    });

    await worker.fetch(request, env);

    assert.equal(calls.backend[0].url, "http://backend/ws/unit/7/?ticket=one-use");
    assert.equal(calls.backend[0].headers.get("upgrade"), "websocket");
});


test("sirve los archivos de la PWA desde Assets", async () => {
    const { calls, env } = create_environment();
    const request = new Request("https://boldapp.example.workers.dev/proyectos");

    const response = await worker.fetch(request, env);

    assert.equal(await response.text(), "asset");
    assert.equal(calls.backend.length, 0);
    assert.equal(calls.assets.length, 1);
});


test("oculta los detalles internos cuando el VPC no responde", async () => {
    const env = {
        ASSETS: { fetch: () => new Response("asset") },
        BACKEND: { fetch: () => { throw new Error("private detail"); } },
    };

    const response = await worker.fetch(new Request("https://boldapp.example.workers.dev/health/"), env);

    assert.equal(response.status, 502);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { detail: "El backend no esta disponible temporalmente." });
});


test("Sheets conserva cookies, revisión y Excel binario al atravesar el Worker", async () => {
    const {calls, env} = create_environment();
    const data = new Uint8Array([80, 75, 3, 4, 0, 255]);
    const request = new Request("https://boldapp.example.workers.dev/api/v2/sheets/files/book/import/", {
        method: "POST", headers: {Cookie: "bold_session=test-only", "X-Assignment-Id": "assignment", "Content-Type": "application/octet-stream", "If-Match": "revision-7"}, body: data,
    });
    env.BACKEND.fetch = async forwarded => {calls.backend.push(forwarded);return new Response(data,{headers:{"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","Content-Disposition":"attachment; filename=test.xlsx"}});};
    const response = await worker.fetch(request,env);
    assert.equal(calls.assets.length,0);
    assert.equal(calls.backend[0].headers.get("cookie"),"bold_session=test-only");
    assert.equal(calls.backend[0].headers.get("x-assignment-id"),"assignment");
    assert.equal(calls.backend[0].headers.get("if-match"),"revision-7");
    assert.deepEqual(new Uint8Array(await calls.backend[0].arrayBuffer()),data);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()),data);
    assert.match(response.headers.get("content-disposition"),/test.xlsx/);
});

test("Sheets conserva la conexión de colaboración WebSocket", async () => {
    const {calls,env}=create_environment();
    await worker.fetch(new Request("https://boldapp.example.workers.dev/ws/sheets/book/?ticket=one-use",{headers:{Upgrade:"websocket",Connection:"Upgrade"}}),env);
    assert.equal(calls.backend[0].url,"http://backend/ws/sheets/book/?ticket=one-use");
    assert.equal(calls.backend[0].headers.get("upgrade"),"websocket");
    assert.equal(calls.assets.length,0);
});

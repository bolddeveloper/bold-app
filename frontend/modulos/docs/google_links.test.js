import test from "node:test";
import assert from "node:assert/strict";
import { googleHomeUrl, googleFileUrl } from "./google_links.js";
import { createHttpClient } from "../core/http_client.js";
import { http } from "../core/http_client.js";
import { workspaceApi } from "./workspace_api.js";

test("Office Google editors receive the original ID", () => {
    for (const [extension, route] of [["docx", "document"], ["xlsx", "spreadsheets"], ["pptx", "presentation"]]) {
        const url = new URL(googleFileUrl({id: "original", name: `test.${extension}`, mimeType: "application/octet-stream"}, "samueloyy@gmail.com"));
        assert.equal(url.pathname, `/${route}/d/original/edit`);
    }
});

test("download export parameter never overrides DRF renderers", async () => {
    const original = http.request; let requested;
    http.request = async (path, options) => {requested = {path, options}; return new Blob(["download"]);};
    try {
        await workspaceApi.download("file_1", "docx");
        const url = new URL(requested.path, "http://localhost:8000");
        assert.equal(url.searchParams.get("export_format"), "docx");
        assert.equal(url.searchParams.has("format"), false);
        assert.equal(requested.options.responseType, "blob");
        assert.equal(url.searchParams.has("editor_export"), false);
        await workspaceApi.download("file_1", "pdf", true);
        assert.equal(new URL(requested.path, "http://localhost:8000").searchParams.get("editor_export"), "true");
    } finally {http.request = original;}
});

test("all editors open official Google pages with the connected account", () => {
    for (const kind of ["docs", "sheets", "slides", "drive"]) {
        const url = new URL(googleHomeUrl(kind, "samueloyy@gmail.com"));
        assert.equal(url.searchParams.get("authuser"), "samueloyy@gmail.com");
        assert.ok(["docs.google.com", "drive.google.com"].includes(url.hostname));
    }
    assert.match(googleFileUrl({ id: "file_1", mimeType: "application/vnd.google-apps.document" }, "luis@bold.gt"), /document\/d\/file_1\/edit/);
    assert.match(googleFileUrl({ id: "folder_1", mimeType: "application/vnd.google-apps.folder" }, "samueloyy@gmail.com"), /drive\/folders\/folder_1/);
});

test("Drive upload preserves FormData and authenticated CSRF headers", async () => {
    let sent;
    const client = createHttpClient({ fetchImpl: async (url, options) => { sent = options; return Response.json({ id: "file" }); } });
    const body = new FormData(); body.append("file", new Blob(["Demo"]), "demo.txt");
    await client.request("/api/v2/workspace/upload/", { method: "POST", body, headers: { "X-CSRFToken": "test" } });
    assert.equal(sent.body, body);
    assert.equal(sent.credentials, "include");
    assert.equal(sent.headers["Content-Type"], undefined);
    assert.equal(sent.headers["X-CSRFToken"], "test");
});

test("download returns binary data and still rejects API errors", async () => {
    const client = createHttpClient({ fetchImpl: async () => new Response("file", { headers: { "Content-Type": "application/pdf" } }) });
    assert.equal(await (await client.request("/api/v2/workspace/files/one/download/", { responseType: "blob" })).text(), "file");
    const denied = createHttpClient({ fetchImpl: async () => Response.json({ detail: "Sin permiso" }, { status: 403 }) });
    await assert.rejects(denied.request("/api/v2/workspace/files/one/download/", { responseType: "blob" }), { status: 403 });
});

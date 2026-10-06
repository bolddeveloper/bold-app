import test from "node:test";
import assert from "node:assert/strict";
import {hasDroppedFiles, uploadDriveFiles} from "./drive_upload.js";

test("system file drags are recognized without interfering with internal Drive moves", () => {
    assert.equal(hasDroppedFiles({types: ["Files"]}), true);
    assert.equal(hasDroppedFiles({types: [], items: [{kind: "file"}]}), true);
    assert.equal(hasDroppedFiles({types: [], files: [new Blob(["demo"])]}), true);
    assert.equal(hasDroppedFiles({types: ["application/x-bold-drive"], items: [{kind: "string"}]}), false);
    assert.equal(hasDroppedFiles(null), false);
});

test("Office files upload unchanged into the chosen destination; individual errors do not stop the batch", async () => {
    const received = [], results = [];
    const files = ["demo.docx", "demo.xlsx", "demo.pptx"].map(name => new File(["content"], name));
    const api = {upload: async body => {received.push([body.get("file").name, body.get("parent"), body.has("convert")]); if (body.get("file").name.endsWith("xlsx")) throw new Error("Temporary error");}};
    await uploadDriveFiles(files, "selected_folder", {signal: new AbortController().signal, status: (id, state) => results.push([id, state]), api});
    assert.deepEqual(received, files.map(file => [file.name, "selected_folder", false]));
    assert.ok(results.some(([id, state]) => id === 1 && state === "error"));
    assert.ok(results.some(([id, state]) => id === 2 && state === "listo"));
    received.length = 0;
    const controller = new AbortController(); controller.abort();
    await uploadDriveFiles(files, "selected_folder", {signal: controller.signal, status: () => {}, api});
    assert.equal(received.length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {selectDriveFile, optimisticMove, previewable, uploadPath, canMove, floatingMenuPosition} from "./drive_helpers.js";
import {createHttpClient} from "../core/http_client.js";

test("selection supports replacement, toggling and ranges in displayed order", () => {
    const files = [{id: "c"}, {id: "a"}, {id: "b"}];
    assert.deepEqual(selectDriveFile(["a"], "c"), ["c"]);
    assert.deepEqual(selectDriveFile(["a"], "c", {toggle: true}), ["a", "c"]);
    assert.deepEqual(selectDriveFile(["a"], "a", {toggle: true}), []);
    assert.deepEqual(selectDriveFile([], "b", {range: true, anchor: "c", files}), ["c", "a", "b"]);
    assert.deepEqual(selectDriveFile([], "b", {range: true, anchor: "absent", files}), ["b"]);
});
test("optimistic moves remove folder members but preserve cross-folder views", () => {
    const files = [{id: "a"}, {id: "b"}];
    assert.deepEqual(optimisticMove(files, ["a"]), [{id: "b"}]);
    assert.equal(optimisticMove(files, ["a"], {view: "recent"}), files);
    assert.equal(canMove({trashed: true, capabilities: {canMoveItemWithinDrive: true}}), false);
    assert.equal(canMove({capabilities: {canMoveItemWithinDrive: true}}), true);
});
test("folder upload paths and preview boundaries", () => {
    assert.deepEqual(uploadPath({webkitRelativePath: "demo/sub/file.txt"}), ["demo", "sub"]);
    assert.deepEqual(uploadPath({name: "file.txt"}), []);
    const file = {mimeType: "application/pdf", size: 20 * 1024 * 1024, capabilities: {canDownload: true}};
    assert.equal(previewable(file), true);
    assert.equal(previewable({...file, size: file.size + 1}), false);
    assert.equal(previewable({...file, mimeType: "image/svg+xml"}), false);
    assert.equal(previewable({...file, capabilities: {}}), false);
});
test("cancelled uploads do not submit another request", async () => {
    let calls = 0;
    const controller = new AbortController(); controller.abort();
    const client = createHttpClient({fetchImpl: async () => {calls++; return Response.json({});}});
    await assert.rejects(client.request("/api/v2/workspace/upload/", {method: "POST", body: new FormData(), signal: controller.signal}), {name: "AbortError"});
    assert.equal(calls, 0);
});
test("floating menus fit right and bottom edges, tall lists and resized viewports", () => {
    for (const viewport of [{width: 1200, height: 800}, {width: 360, height: 300}, {width: 200, height: 150, left: 20, top: 30}]) {
        for (const size of [{width: 235, height: 500}, {width: 235, height: 180}]) {
            const actual = {width: Math.min(size.width, viewport.width - 16), height: Math.min(size.height, viewport.height - 16)};
            const position = floatingMenuPosition({left: 1190, top: 790, bottom: 810}, size, viewport);
            assert.ok(position.left >= (viewport.left || 0) + 8);
            assert.ok(position.top >= (viewport.top || 0) + 8);
            assert.ok(position.left + actual.width <= (viewport.left || 0) + viewport.width - 8);
            assert.ok(position.top + actual.height <= (viewport.top || 0) + viewport.height - 8);
        }
    }
});

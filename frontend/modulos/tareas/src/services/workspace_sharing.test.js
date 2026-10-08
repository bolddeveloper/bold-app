import test from "node:test";
import assert from "node:assert/strict";
import {sharedWorkspaceFolders} from "./workspace_sharing.js";

test("shared trees stay separate from local folders and disappear after revocation", () => {
    const root = {id: "root", name: "Equipo", parentId: null};
    const child = {id: "child", name: "Subcarpeta", parentId: "root"};
    const local = [{...root, name: "Mi carpeta"}];
    const records = [{id: "share1", folder_id: "root", owner_id: "other", mine: false, folders: [root, child]}];
    const folders = sharedWorkspaceFolders(local, records);
    assert.equal(folders[0].name, "Mi carpeta");
    assert.equal(folders[1].id, "shared:share1:root");
    assert.equal(folders[1].parentId, null);
    assert.equal(folders[2].parentId, folders[1].id);
    assert.equal(folders[2].shared, true);
    assert.deepEqual(sharedWorkspaceFolders(local, []), local);
});

test("owner recovers server folders while newer local edits take precedence", () => {
    const remote = {id: "root", name: "Servidor", parentId: null};
    const records = [{id: "share1", folder_id: "root", owner_id: "me", mine: true, folders: [remote]}];
    assert.equal(sharedWorkspaceFolders([], records)[0].ownerId, "me");
    assert.equal(sharedWorkspaceFolders([{...remote, name: "Local"}], records)[0].name, "Local");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
const require = createRequire(new URL("../../core/package.json", import.meta.url));
const { parse } = require("@babel/parser");
const source = readFileSync(new URL("./task_app.jsx", import.meta.url), "utf8");
const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
function find(node, predicate) {
    if (!node || typeof node !== "object") return null;
    if (predicate(node)) return node;
    for (const value of Object.values(node)) for (const child of Array.isArray(value) ? value : [value]) {
        const found = find(child, predicate); if (found) return found;
    }
    return null;
}
function handler(name, context) {
    const node = find(ast, item => item.type === "FunctionDeclaration" && item.id.name === name);
    return runInNewContext(`(${source.slice(node.start, node.end)})`, context);
}
// Prepared only: respect the user's instruction not to run tests.
test("quick creation keeps clicks in either form and closes outside", () => {
    const node = find(ast, item => item.type === "VariableDeclarator" && item.id?.name === "close" && source.slice(item.start, item.end).includes("set_quick_task_open"));
    let closed = false;
    const close = runInNewContext(`(${source.slice(node.init.start, node.init.end)})`, {
        set_quick_task_text: () => {}, set_quick_task_open: value => {closed = !value;}, set_quick_task_section: () => {},
    });
    for (const name of ["quick_task_form", "board_quick_task_form"]) {
        close({type:"pointerdown", target:{closest: selectors => selectors.split(",").some(selector => selector.trim() === `.${name}`)}});
        assert.equal(closed, false);
    }
    close({type:"pointerdown", target:{closest: () => null}});
    assert.equal(closed, true);
});
test("subtask arrow opens details without opening an editor", () => {
    let selected;
    handler("handle_open_subtask", {handle_task_select: id => {selected = id;}, handle_open_edit_task: () => assert.fail("Unexpected editor")})("parent", "child");
    assert.equal(selected, "child");
});
test("subtask edit authorizes the child and loads its own complete attachment baseline", async () => {
    const child = {id:"child",unitId:"unit",parentTaskId:"parent",title:"Child",attachmentsLoaded:false};
    const context = {
        tasks:[{id:"parent"}], all_workspace_tasks:[child], real:true, mutation_generation:{current:1}, edit_open_generation:{current:0}, task_activity:{current:true}, task_crud_mutations:{current:new Map()},
        session:{permissions:{can:async (_, unit, id) => {assert.equal(unit,"unit");assert.equal(id,"child");return true;}}}, pagedAttachmentsEnabled:()=>false,
        edit_loader:{current:{load:async task => {assert.equal(task,child);return {...task,attachments:[{id:"file"}],attachmentBaseline:[{id:"file"}],attachmentsLoaded:true};}}},
        set_api_error: message => assert.fail(message), set_opening_edit:()=>{}, set_editing_subtask_parent_id:()=>{}, set_selected_task_id:()=>{},
        set_edit_draft: draft => {context.draft=draft;}, set_edit_attachments: files => {context.files=files;}, set_active_modal: mode => {context.modal=mode;},
    };
    await handler("handle_open_edit_task",context)("child");
    assert.equal(context.modal,"edit_task");assert.equal(context.draft.parentTaskId,"parent");
    assert.equal(context.draft.attachmentBaseline[0].id,"file");assert.equal(context.files[0].id,"file");
});

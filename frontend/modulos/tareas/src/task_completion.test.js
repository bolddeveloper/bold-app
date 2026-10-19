import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {applyOptimisticTaskStatus} from "./services/task_models.js";

// Execute the real handlers with deferred network calls, without mounting the entire app.
const source = await readFile(new URL("./task_app.jsx", import.meta.url), "utf8");
const handlers = source.slice(source.indexOf("    function task_status_snapshot("), source.indexOf("    function queue_notification_read("))
    + source.slice(source.indexOf("    function handle_toggle_task("), source.indexOf("    function handle_request_delete_task("));
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve=yes; reject=no;}); return {promise, resolve, reject};};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({catalog=true,completed=false}={}) {
    const task = {id:"t",unitId:"u",statusId:completed ? "done" : "open",status:completed ? "Lista" : "Pendiente",statusCategory:completed ? "done" : "todo",completed};
    const data = {tasks:[task],statuses:catalog ? [{id:completed ? "open" : "done",unitId:"u",label:completed ? "Pendiente" : "Lista",category:completed ? "todo" : "done",isFinal:!completed}] : []};
    const network=deferred(), refreshes=[], errors=[], mutations={current:new Map()};
    let calls=0, rows=[task];
    const dependencies={data,real:true,task_scope:"mine",selected_project_id:null,task_crud_mutations:{current:new Map()},task_status_mutations:mutations,
        apply_optimistic_task_status:(id,status)=>{rows=applyOptimisticTaskStatus(rows,id,status);},
        togglePipelineCompletion:()=>{calls++;return network.promise;},api:{updateTask:()=>assert.fail("Unexpected extra write")},
        refresh:{current:async resources=>{refreshes.push(resources);}},set_api_error:message=>errors.push(message),report_background_mutation_error:async error=>errors.push(error.message)};
    const run=new Function(...Object.keys(dependencies),`${handlers};return handle_toggle_task;`)(...Object.values(dependencies));
    return {run,network,refreshes,errors,mutations,get row(){return rows[0];},get calls(){return calls;}};
}

test("completion changes before network response, ignores duplicate clicks and refreshes only the task",async()=>{
    const f=fixture();
    f.run("t");
    assert.equal(f.row.completed,true);
    assert.equal(f.mutations.current.get("t").running,true);
    f.run("t");assert.equal(f.calls,1);
    assert.deepEqual(f.refreshes,[]);
    f.network.resolve({status:"done",status_name:"Lista",status_category:"done",status_is_final:true});
    await tick();
    assert.equal(f.row.completed,true);
    assert.deepEqual(f.refreshes,[["tasks@t"]]);
    assert.equal(f.mutations.current.size,0);
});

test("rejected writes restore original mark and report failure",async()=>{
    const f=fixture();f.run("t");assert.equal(f.row.completed,true);
    f.network.reject(new Error("Sin permiso"));await tick();
    assert.equal(f.row.completed,false);assert.equal(f.row.statusId,"open");
    assert.deepEqual(f.errors,["Sin permiso"]);assert.equal(f.mutations.current.size,0);
});

test("reopening clears the mark immediately and restores completion if rejected",async()=>{
    const f=fixture({completed:true});f.run("t");assert.equal(f.row.completed,false);
    f.network.reject(new Error("No guardado"));await tick();
    assert.equal(f.row.completed,true);assert.equal(f.row.statusId,"done");
});

test("missing department catalog still previews immediately; aggregate pipeline result remains authoritative",async()=>{
    const f=fixture({catalog:false});f.run("t");assert.equal(f.row.completed,true);
    f.network.resolve({status:"open",status_name:"Pendiente",status_category:"todo",status_is_final:false});await tick();
    assert.equal(f.row.completed,false);assert.equal(f.calls,1);assert.deepEqual(f.errors,[]);
});

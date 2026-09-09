// Run against a seeded local backend: node tests/v2_live.mjs
import assert from "node:assert/strict";
import { createApiClient } from "../src/services/api_client.js";
import { createRealtimeAdapter } from "../src/services/realtime_adapter.js";
const A = createApiClient(), B = createApiClient();
// Unlike Node fetch, browsers require CORS even when credentials are valid.
for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
    const preflight = await fetch("http://127.0.0.1:8000/api/v2/core/auth/token/", { method: "OPTIONS", headers: {
        Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization,x-assignment-id"
    } });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    assert.ok(preflight.headers.get("access-control-allow-headers")?.includes("x-assignment-id"));
}
await assert.rejects(A.login("ana@bold.gt", "incorrect-password"));
await A.login("ana@bold.gt", "bolddemo123");
const account = await A.getCurrentAccount();
const own = await A.listOwnAssignments(account);
assert.ok(own.length);
A.setAssignment(own[0].id);
B.setToken(A.getSession().token, account.email); B.setAssignment(own[0].id);
const directory = await A.listAssignmentDirectory();
const origin = directory.find(item => item.id === own[0].id);
const destination = directory.find(item => item.unit !== origin.unit);
const project = (await A.listProjects()).find(item => item.unit === origin.unit);
const sections = await A.listSections(project.id);
const originStatuses = await A.listStatuses(origin.unit);
const destinationStatuses = await A.listStatuses(destination.unit);
const read = async api => (await api.listTasks()).find(item => item.id === taskId);
let taskId, stateA, stateB, eventsA = 0, eventsB = 0, reloadsB = 0, failure;
class BrowserWebSocket extends WebSocket {
    constructor(url) { super(url, { headers: { Origin: "http://localhost:5173" } }); }
}
const adapters = [createRealtimeAdapter({ WebSocketImpl: BrowserWebSocket }), createRealtimeAdapter({ WebSocketImpl: BrowserWebSocket })];
const synchronize = async (client, index) => {
    try { const task = await read(client); if (index === 0) stateA = task; else { stateB = task; reloadsB++; } } catch (error) { failure = error; }
};
function connectB() {
    for (const unitId of [origin.unit, destination.unit]) adapters[1].connect({ unitId, ...B.getSession(), onEvent: () => { eventsB++; synchronize(B, 1); }, onReconnect: () => synchronize(B, 1) });
}
for (const unitId of [origin.unit, destination.unit]) adapters[0].connect({ unitId, ...A.getSession(), onEvent: () => { eventsA++; synchronize(A, 0); }, onReconnect: () => synchronize(A, 0) });
connectB();
async function until(check) {
    const deadline = Date.now() + 10000;
    while (!check()) {
        if (failure) throw failure;
        if (Date.now() > deadline) throw new Error("Timed out waiting for client synchronization");
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
try {
    await until(() => reloadsB > 0);
    const task = await A.createTask({ title: "V2 automated two-client test", unit: origin.unit, assignee_assignment: origin.id, status: originStatuses[0].id, priority: "high", project: project.id, section: sections[0]?.id || null, project_position: "1000", due_date: "2030-01-01" });
    taskId = task.id;
    await until(() => stateB?.id === taskId);
    const links = (await A.listTaskProjectLinks(project.id)).filter(link => link.task === taskId);
    assert.equal(links.length, 1);
    await B.updateTask(taskId, { title: "Edited in B", due_date: null });
    await until(() => stateA?.title === "Edited in B");
    const beforeMove = eventsB;
    await A.updateTaskProjectLink(links[0].id, { section: sections[1]?.id || null, position: "2000" });
    await until(() => eventsB > beforeMove);
    assert.equal((await B.listTaskProjectLinks(project.id)).find(link => link.id === links[0].id).section, sections[1]?.id || null);
    assert.equal((await read(B)).status, originStatuses[0].id);
    await A.moveTask(taskId, { unit: destination.unit, assignee_assignment: destination.id, status: destinationStatuses[0].id });
    await until(() => stateB?.unit === destination.unit);
    const comment = await B.createComment(taskId, "Persistent comment");
    await until(() => eventsA >= 5);
    assert.ok((await A.listComments()).some(item => item.id === comment.id));
    const child = await A.createTask({ title: "Persistent subtask", unit: destination.unit, status: destinationStatuses[0].id, parent_task: taskId, priority: "medium" });
    assert.equal((await B.listTasks()).find(item => item.id === child.id).parent_task, taskId);
    await A.deleteTask(child.id);
    adapters[1].disconnect();
    await A.updateTask(taskId, { title: "Changed while B was disconnected" });
    const beforeReconnect = reloadsB;
    connectB();
    await until(() => reloadsB > beforeReconnect && stateB?.title === "Changed while B was disconnected");
    const refreshed = createApiClient(); refreshed.setToken(A.getSession().token, account.email); refreshed.setAssignment(own[0].id);
    assert.equal((await read(refreshed)).title, stateB.title);
    await A.deleteTask(taskId);
    await until(() => stateB === undefined);
    console.log("PASS: invalid/valid login, atomic create, edit, column movement, handoff, comment, subtask, two clients, disconnect/refetch, persisted refresh and delete.");
} finally {
    for (const adapter of adapters) adapter.disconnect();
    if (taskId && await read(A)) await A.deleteTask(taskId);
}

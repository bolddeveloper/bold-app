import {http} from "../../core/http_client.js";
import {getCoreState, subscribeCore} from "../../core/core_store.js";
import {createDraftVault, indexedDraftStorage} from "../../mensajeria/draft_vault.js";

const vault = createDraftVault({storage: indexedDraftStorage(globalThis.indexedDB, "bold-task-drafts")});
const resource = assignmentId => ({kind: "task-create", resource_id: assignmentId});
const currentScope = () => {
    const core = getCoreState();
    return core.sessionStatus === "ready" && !core.securityUncertain && core.account?.id && core.activeAssignment?.id
        ? {account_id: core.account.id, assignment_id: core.activeAssignment.id} : null;
};
let context = "";
const bus = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("bold-task-draft-lifecycle") : null;
const suspend = () => vault.suspend();
const purge = () => vault.purge().catch(() => {});
bus?.addEventListener("message", event => {if (event.data === "purge") void purge(); else suspend();});
const invalidate = () => {suspend(); bus?.postMessage("suspend");};
globalThis.addEventListener?.("bold:private-cache-clear", () => {void purge(); bus?.postMessage("purge");});
globalThis.addEventListener?.("bold:private-cache-suspend", invalidate);
globalThis.addEventListener?.("bold:permissions-revision", invalidate);
subscribeCore(() => {const next = JSON.stringify(currentScope()); if (context && context !== next) suspend(); context = next;});

export async function openTaskCreationDraft(assignmentId) {
    const identity = currentScope();
    if (!identity || identity.assignment_id !== assignmentId) throw new DOMException("Contexto cancelado", "AbortError");
    const target = resource(assignmentId);
    return vault.open({...target, ...identity}, async () => {
        const grant = await http.request("/api/v2/task-drafts/grant/", {method: "POST", body: target, timeoutMs: 10000});
        if (JSON.stringify(currentScope()) !== JSON.stringify(identity)) throw new DOMException("Contexto cancelado", "AbortError");
        return grant;
    });
}

export async function completeTaskCreationDraft(assignmentId, draftId) {
    if (!draftId) return false;
    let handle;
    try {
        handle = await openTaskCreationDraft(assignmentId);
        const saved = await handle.recover();
        if (saved?.payload?._draft_id !== draftId) return false;
        return await handle.clear() !== false;
    } catch {return false;}
    finally {handle?.close();}
}

// Debounced encrypted writes, with an explicit flush before logout/send/close.
// No JSON serialization of a long description or image per ordinary keypress.
export function createTaskDraftController({open, onStatus = () => {}, schedule = setTimeout, cancel = clearTimeout}) {
    let handle, payload = null, revision = 0, saved = -1, protectedRevision = -1, timer, closed = false, discarded = false, closing = null, renewing = null, writing = Promise.resolve(true);
    const ready = Promise.resolve().then(open).then(async value => {
        if (closed) {value?.close(); return null;}
        handle = value;
        const recovered = await handle.recover();
        if (closed) return null;
        if (!handle.isActive()) throw new DOMException("Contexto cancelado", "AbortError");
        payload = recovered?.payload || null;
        saved = protectedRevision = revision;
        onStatus(payload ? "recovered" : "ready");
        return payload;
    }).catch(error => {if (!closed) onStatus("error", error); throw error;});
    function update(value) {
        if (closed || closing || discarded) return;
        if (payload && value && Object.keys(payload).length === Object.keys(value).length && Object.keys(value).every(key => Object.is(payload[key], value[key]))) return;
        payload = value; revision++;
        cancel(timer); timer = schedule(() => {void flush();}, 250);
    }
    async function flush() {
        cancel(timer);
        try {
            await ready;
            if (discarded) return await writing;
            if (closed) return false;
            if (!handle?.isActive()) {
                renewing ||= Promise.resolve().then(open).then(next => {
                    if (closed || discarded) {next?.close(); return null;}
                    handle = next; saved = protectedRevision = -1; return next;
                }).finally(() => {renewing = null;});
                await renewing;
                if (!handle?.isActive()) return false;
            }
            if (revision === saved) return writing;
            const version = revision, snapshot = payload;
            saved = version;
            onStatus("saving");
            writing = (snapshot ? handle.save(snapshot) : handle.clear()).then(ok => {
                if (ok === false) throw new Error("La sesión del borrador ya no está activa.");
                protectedRevision = version;
                if (version === revision && !closed) onStatus("protected"); return true;
            }).catch(error => {if (saved === version) saved = -1; if (!closed) onStatus("error", error); return false;});
            return await writing;
        } catch (error) {if (!closed) onStatus("error", error); return false;}
    }
    async function discard() {
        cancel(timer); discarded = true;
        const previous = writing;
        writing = (async () => {await ready; await previous.catch(() => {}); if (!handle || await handle.clear() === false) throw new Error("No se pudo descartar el borrador."); protectedRevision = revision; return true;})();
        return writing;
    }
    return {ready, update, flush, discard,
        isProtected: () => !!handle?.isActive() && protectedRevision === revision,
        close() {
            if (!closing) {cancel(timer); closing = flush().finally(() => {closed = true; handle?.close();});}
            return closing;
        },
    };
}

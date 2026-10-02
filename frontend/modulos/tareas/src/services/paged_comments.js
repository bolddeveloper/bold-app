export function commentQueries({ scope, projectId, taskIds = [] } = {}) {
    if (scope === "project") return projectId ? [{ recent: "1", project: projectId }] : [];
    if (scope === "mine") return [{ recent: "1", mine: "1" }];
    const ids = [...new Set(taskIds.map(String))].filter(id => /^[0-9a-f-]{36}$/i.test(id)).sort();
    return Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ({ recent: "1", tasks: ids.slice(i * 50, (i + 1) * 50).join(",") }));
}
export const pagedCommentsEnabled = () => import.meta.env?.VITE_USE_REAL_BACKEND === "true" && import.meta.env?.VITE_TASK_INCREMENTAL_SYNC === "true" && import.meta.env?.VITE_TASK_PAGED_COMMENTS === "true";
export function notifyCommentViews(tasks = null, purge = false) {
    globalThis.window?.dispatchEvent(new CustomEvent("bold:task-comments", { detail: { tasks, purge } }));
}

// One page per disjoint scope, at most two reads in flight; no automatic traversal.
export function createPagedComments({ queries, listPage, emit = () => {}, canRun = () => true,
    resource = "comments", errorMessage = "No se pudieron cargar los comentarios. Puedes reintentar sin perder el texto escrito.",
    now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    let groups = [], generation = 0, disposed = false, inFlight = null, timer = null, pending = false, controller = new AbortController(), retryAt = 0, updatedAt = -Infinity;
    let state = { rows: [], count: 0, loading: false, error: "", hasMore: false, dirty: true };
    const publish = patch => { state = { ...state, ...patch }; emit(state); };
    function suspend() {
        generation++; controller.abort(); controller = new AbortController();
        clearTimer(timer); timer = null; pending = false; inFlight = null; groups = [];
        publish({ rows: [], count: 0, loading: false, hasMore: false, error: "", dirty: true });
    }
    function schedule() {
        if (disposed || !canRun() || timer !== null || now() < retryAt) return;
        timer = setTimer(() => { timer = null; refresh(); }, 400);
    }
    function invalidate({ purge = false } = {}) {
        if (disposed) return;
        if (purge) suspend();
        publish({ dirty: true });
        if (inFlight) pending = true; else schedule();
    }
    async function read(append) {
        if (disposed || inFlight || !canRun() || now() < retryAt) return;
        clearTimer(timer); timer = null;
        const epoch = generation, signal = controller.signal;
        const indices = queries.map((_, i) => i).filter(i => !append || groups[i]?.next);
        if (!indices.length) { publish({ dirty: false }); return; }
        publish({ loading: true, error: "" });
        const work = (async () => {
            const nextGroups = append ? [...groups] : [];
            let cursor = 0;
            const worker = async () => {
                while (cursor < indices.length) {
                    if (signal.aborted) throw new DOMException("Comentarios cancelados", "AbortError");
                    const i = indices[cursor++], previous = append ? groups[i] : null;
                    const path = previous?.next || "first";
                    if (previous?.seen.has(path)) throw new Error("Paginación circular del servidor.");
                    const page = await listPage(resource, queries[i], { next: previous?.next || null, signal });
                    const rows = new Map((previous?.rows || []).map(row => [String(row.id), row]));
                    page.results.forEach(row => rows.set(String(row.id), row));
                    nextGroups[i] = { rows: [...rows.values()], count: page.count, next: page.next,
                        seen: new Set([...(previous?.seen || []), path]) };
                }
            };
            await Promise.all(Array.from({ length: Math.min(2, indices.length) }, worker));
            if (disposed || epoch !== generation || signal.aborted) return;
            groups = nextGroups; updatedAt = now();
            const rows = [...new Map(groups.flatMap(group => group.rows).map(row => [String(row.id), row])).values()]
                .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
            publish({ rows, count: groups.reduce((total, group) => total + group.count, 0), hasMore: groups.some(group => group.next), dirty: false });
        })();
        inFlight = work;
        try { await work; }
        catch (error) {
            if (disposed || epoch !== generation || signal.aborted || error.name === "AbortError") return;
            controller.abort(); controller = new AbortController(); // stop sibling batch reads after a failed round
            retryAt = now() + Math.max(0, error.retryAfterMs || 0);
            if ([401, 403].includes(error.status)) { groups = []; publish({ rows: [], count: 0, hasMore: false }); }
            publish({ error: errorMessage, dirty: true });
        } finally {
            if (!disposed && epoch === generation) {
                inFlight = null; publish({ loading: false });
                if (pending) { pending = false; schedule(); }
            }
        }
    }
    const refresh = () => read(false);
    return { refresh, more: () => read(true), invalidate, suspend,
        resume() { if (state.dirty || now() - updatedAt >= 300000) schedule(); },
        snapshot: () => state,
        dispose() { suspend(); disposed = true; } };
}

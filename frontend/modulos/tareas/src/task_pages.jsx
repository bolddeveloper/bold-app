import { useEffect, useRef, useState } from "react";
import { useCore } from "../../core/core_provider.jsx";
import { api } from "./services/tasks_api.js";
import { createPagedComments } from "./services/paged_comments.js";
import { contentCanRefresh } from "../../core/refresh_coordinator.js";

// Shared lifecycle for authorized task relations, not a cross-session cache.
export function useTaskPages({ queries, resource = "comments", eventName = "bold:task-comments", errorMessage }) {
    const session = useCore(), controller = useRef(null);
    const security = useRef(session.securityUncertain); security.current = session.securityUncertain;
    const [state, setState] = useState({ rows: [], count: 0, loading: true, error: "", hasMore: false });
    const scope = JSON.stringify(queries);
    useEffect(() => {
        let mounted = true;
        const scopedQueries = JSON.parse(scope);
        const store = createPagedComments({ queries: scopedQueries, resource, errorMessage, listPage: api.listPage,
            emit: next => { if (mounted) setState({ ...next, scope, assignment: session.activeAssignment?.id }); }, canRun: () => !security.current && contentCanRefresh() });
        controller.current = store;
        store.refresh();
        const changed = event => {
            const tasks = event.detail?.tasks;
            const ids = scopedQueries.flatMap(query => query.tasks?.split(",") || []);
            if (tasks?.length && ids.length && !tasks.some(id => ids.includes(String(id)))) return;
            store.invalidate({ purge: Boolean(event.detail?.purge) });
        };
        const invalidateSecurity = event => {
            security.current = Boolean(event.detail?.uncertain);
            store.suspend();
            if (!security.current) store.resume();
        };
        const resume = () => store.resume();
        window.addEventListener(eventName, changed);
        window.addEventListener("bold:permissions-revision", invalidateSecurity);
        window.addEventListener("focus", resume); window.addEventListener("online", resume);
        document.addEventListener("visibilitychange", resume);
        return () => {
            mounted = false; store.dispose(); controller.current = null;
            window.removeEventListener(eventName, changed);
            window.removeEventListener("bold:permissions-revision", invalidateSecurity);
            window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
            document.removeEventListener("visibilitychange", resume);
        };
    }, [scope, session.activeAssignment?.id, resource, eventName, errorMessage]);
    const current = state.scope === scope && state.assignment === session.activeAssignment?.id;
    const rows = security.current || !current ? [] : state.rows;
    return { session, state, current, rows, blocked: security.current, controller };
}

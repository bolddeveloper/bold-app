import {useEffect, useRef, useState} from "react";
import {http} from "../../core/http_client.js";
import {backgroundRefresh} from "../../core/google_cache.js";
import {moduleCache} from "../../core/module_cache.js";

const empty = () => ({sections: [], task_sections: {}});
const endpoint = "/api/v2/personal-board/";

export function usePersonalBoard(assignmentId, enabled, onError, cacheScope) {
    const restore = () => {
        const saved = enabled ? moduleCache.read(cacheScope, "personal-board") : null;
        return {scope: assignmentId, ready: Boolean(saved), board: saved || empty()};
    };
    const [state, setState] = useState(restore);
    const current = useRef(state), scope = useRef(assignmentId), busy = useRef(false), revision = useRef(0), error = useRef(onError);
    scope.current = assignmentId; error.current = onError;
    useEffect(() => {
        let alive = true;
        revision.current++;
        busy.current = false;
        current.current = restore();
        setState(current.current);
        if (!enabled || !assignmentId) return;
        const refresh = async () => {
            if (busy.current) return;
            const ticket = revision.current;
            const cacheGeneration = moduleCache.generation;
            try {
                const board = await http.request(endpoint);
                if (alive && ticket === revision.current && !busy.current) {current.current = {scope: assignmentId, ready: true, board}; setState(current.current); moduleCache.write(cacheScope, "personal-board", board, cacheGeneration);}
            } catch (problem) {if (alive) error.current(problem.message);}
        };
        refresh(); const stop = backgroundRefresh(refresh, {interval: 300000});
        return () => {alive = false; stop();};
    }, [assignmentId, enabled, cacheScope]);
    async function update(change) {
        if (!current.current.ready || busy.current || current.current.scope !== assignmentId) {error.current("Espera a que termine de cargar o guardar tus secciones."); return false;}
        const previous = current.current;
        const board = change(previous.board);
        busy.current = true;
        const ticket = ++revision.current;
        const valid = () => scope.current === assignmentId && ticket === revision.current;
        current.current = {...previous, board}; setState(current.current);
        try {
            const saved = await http.request(endpoint, {method: "PUT", body: board});
            if (valid()) {current.current = {...previous, board: saved}; setState(current.current); moduleCache.write(cacheScope, "personal-board", saved);}
            return true;
        } catch (problem) {
            if (valid()) {current.current = previous; setState(previous); error.current(problem.message);}
            return false;
        } finally {if (valid()) busy.current = false;}
    }
    return {board: state.scope === assignmentId ? state.board : empty(), update};
}

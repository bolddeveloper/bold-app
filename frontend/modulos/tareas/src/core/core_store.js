// Identity projections are live bindings of this single Core snapshot.
export let directory = [];
export let activeAssignment = null;
export let activeAssignmentId = "";
let state = { account: null, employee: null, assignments: [], units: [], directory, activeAssignment, activeUnit: null, sessionStatus: "loading", error: "" };
const listeners = new Set();
export const getCoreState = () => state;
export const subscribeCore = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function updateCore(patch) {
    state = { ...state, ...patch };
    directory = state.directory;
    activeAssignment = state.activeAssignment;
    activeAssignmentId = activeAssignment?.id || "";
    state.activeUnit = state.units.find(unit => unit.id === activeAssignment?.unitId) || null;
    for (const listener of listeners) listener();
}
export function clearCore() {
    updateCore({ account: null, employee: null, assignments: [], units: [], directory: [], activeAssignment: null, sessionStatus: "anonymous", error: "" });
}

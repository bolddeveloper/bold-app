// Estado de pestañas de archivos durante la sesión de BOLD.
export const emptyWorkspaceTabs = () => ({ tabs: [], active: null, account: null });
export function workspaceTabs(state, action) {
    if (action.type === "account") return state.account === action.key ? state : { ...emptyWorkspaceTabs(), account: action.key };
    if (action.type === "open") return { ...state, tabs: state.tabs.some(file => file.id === action.file.id) ? state.tabs.map(file => file.id === action.file.id ? action.file : file) : [...state.tabs, action.file], active: action.file.id };
    if (action.type === "select") return { ...state, active: action.id === null || state.tabs.some(file => file.id === action.id) ? action.id : state.active };
    if (action.type === "close") {
        const index = state.tabs.findIndex(file => file.id === action.id);
        return { ...state, tabs: state.tabs.filter(file => file.id !== action.id), active: state.active === action.id ? state.tabs[index - 1]?.id || null : state.active };
    }
    return state;
}

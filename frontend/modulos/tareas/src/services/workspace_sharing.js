import {http} from "../../../core/http_client.js";
import {folderBranch} from "./workspace_store.js";
const endpoint = "/api/v2/workspace-sharing/";
export const workspaceSharing = {
    list: () => http.request(endpoint),
    save: (folders, id, members) => http.request(endpoint, {method: "POST", body: {folder_id: id, folders: folderBranch(folders, id), member_ids: members}}),
    remove: id => http.request(`${endpoint}?folder_id=${encodeURIComponent(id)}`, {method: "DELETE"}),
};
export function sharedWorkspaceFolders(local, records) {
    const owned = records.filter(row => row.mine).flatMap(row => row.folders.map(folder => ({...folder, ownerId: row.owner_id})));
    const byId = new Map([...owned, ...local].map(folder => [folder.id, folder]));
    const shared = records.filter(row => !row.mine).flatMap(row => row.folders.map(folder => ({...folder,
        id: `shared:${row.id}:${folder.id}`,
        parentId: folder.id === row.folder_id ? null : `shared:${row.id}:${folder.parentId}`,
        shared: true, ownerId: row.owner_id, shareRecordId: row.id,
    })));
    return [...byId.values(), ...shared];
}

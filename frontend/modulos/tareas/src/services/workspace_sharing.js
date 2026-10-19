import {http} from "../../../core/http_client.js";
import {folderBranch} from "./workspace_store.js";
const endpoint = "/api/v2/workspace-sharing/";
export const workspaceSharing = {
    list: () => http.request(endpoint),
    save: (folders, id, members, revision) => http.request(endpoint, {method: "POST", body: {folder_id: id, folders: folderBranch(folders, id), member_ids: members, revision}}),
    edit: (record, folders) => http.request(endpoint, {method: "PATCH", body: {id: record.id, folder_id: record.folder_id, revision: record.revision, folders}}),
    library: () => http.request("/api/v2/workspace-library/"),
    saveLibrary: (folders, revision, records) => http.request("/api/v2/workspace-library/", {method: "PUT", body: {folders, revision, share_revisions: Object.fromEntries(records.filter(row => row.mine).map(row => [row.id, row.revision]))}}),
    remove: id => http.request(`${endpoint}?folder_id=${encodeURIComponent(id)}`, {method: "DELETE"}),
};
export function sharedWorkspaceFolders(local, records) {
    const owned = records.filter(row => row.mine).flatMap(row => row.folders.map(folder => ({...folder, ownerId: row.owner_id})));
    const byId = new Map([...local, ...owned].map(folder => [folder.id, folder]));
    const shared = records.filter(row => !row.mine).flatMap(row => row.folders.map(folder => ({...folder,
        id: `shared:${row.id}:${folder.id}`,
        parentId: folder.id === row.folder_id ? null : `shared:${row.id}:${folder.parentId}`,
        shared: true, ownerId: row.owner_id, shareRecordId: row.id, sourceFolderId: folder.id,
    })));
    return [...byId.values(), ...shared];
}

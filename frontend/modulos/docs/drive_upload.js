import {workspaceApi} from "./workspace_api.js";
import {uploadPath} from "./drive_helpers.js";

export function hasDroppedFiles(transfer) {
    return !!transfer && (Array.from(transfer.types || []).includes("Files") || Array.from(transfer.items || []).some(item => item.kind === "file") || !!transfer.files?.length);
}

// Cargas compartidas: conserva el archivo original y la carpeta elegida.
export async function uploadDriveFiles(items, destination, {signal, status, api = workspaceApi}) {
    const folders = new Map([["", destination]]);
    for (let index = 0; index < items.length; index++) {
        if (signal.aborted) {status(index, "cancelado"); continue;}
        const file = items[index];
        status(index, "subiendo");
        try {
            let key = "", target = destination;
            for (const part of uploadPath(file)) {
                key += "/" + part;
                if (!folders.has(key)) {if (signal.aborted) throw new DOMException("Cancelado", "AbortError"); const created = await api.create({type: "folder", name: part, parent: target}); folders.set(key, created.id);}
                target = folders.get(key);
            }
            const body = new FormData(); body.append("file", file); body.append("parent", target);
            await api.upload(body, {signal}); status(index, "listo");
        } catch (problem) {status(index, problem.name === "AbortError" ? "cancelado" : "error", problem.name === "AbortError" ? "Comprueba Drive: una carga ya recibida puede terminar en Google." : problem.message);}
    }
}

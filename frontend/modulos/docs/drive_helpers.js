export const folderMime = "application/vnd.google-apps.folder";
export const isDriveFolder = file => file.mimeType === folderMime;
export const canMove = file => !file.trashed && !!(file.capabilities?.canMoveItemWithinDrive || file.capabilities?.canMoveItemOutOfDrive);
export function bytesLabel(value) {
    const bytes = Number(value || 0);
    if (!bytes) return "0 B";
    const index = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${new Intl.NumberFormat("es", { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${["B", "KB", "MB", "GB"][index]}`;
}
export function selectDriveFile(current, id, { toggle = false, range = false, anchor, files = [] } = {}) {
    if (range && anchor) {
        const start = files.findIndex(file => file.id === anchor), end = files.findIndex(file => file.id === id);
        if (start >= 0 && end >= 0) return files.slice(Math.min(start, end), Math.max(start, end) + 1).map(file => file.id);
    }
    return toggle ? current.includes(id) ? current.filter(value => value !== id) : [...current, id] : [id];
}
export function uploadPath(file) {
    const parts = (file.webkitRelativePath || file.name).split("/");
    return parts.slice(0, -1);
}
export function optimisticMove(files, ids, { home = false, view = "my" } = {}) {
    return home || ["all", "recent", "starred", "storage"].includes(view) ? files : files.filter(file => !ids.includes(file.id));
}
export function previewable(file) {
    return Number(file.size || 0) <= 20 * 1024 * 1024 && !!file.capabilities?.canDownload && (file.mimeType === "application/pdf" || file.mimeType?.startsWith("image/") && file.mimeType !== "image/svg+xml");
}
export function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = name; link.hidden = true;
    document.body.appendChild(link); link.click(); link.remove();
    return {url, name};
}
export function floatingMenuPosition(anchor, size, viewport) {
    const margin = 8, left = viewport.left || 0, top = viewport.top || 0;
    const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
    const height = Math.min(size.height, Math.max(0, viewport.height - margin * 2));
    const x = Math.max(left + margin, Math.min(anchor.left, left + viewport.width - width - margin));
    const below = anchor.bottom + 6;
    const preferredY = below + height <= top + viewport.height - margin ? below : anchor.top - height - 6;
    const y = Math.max(top + margin, Math.min(preferredY, top + viewport.height - height - margin));
    return {left: x, top: y};
}

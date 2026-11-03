export function transferredFiles(transfer) {
    const files = Array.from(transfer?.files || []);
    return files.length ? files : Array.from(transfer?.items || []).filter(item => item.kind === "file").map(item => item.getAsFile()).filter(Boolean);
}

export const editorImageTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export function transferredFiles(transfer) {
    const files = Array.from(transfer?.files || []);
    return files.length ? files : Array.from(transfer?.items || []).filter(item => item.kind === "file").map(item => item.getAsFile()).filter(Boolean);
}
export function validateEditorImages(files) {
    if (!files.length || files.some(file => !editorImageTypes.includes(file.type))) throw new Error("Usa imágenes PNG, JPEG, GIF o WebP.");
}

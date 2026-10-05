// Tipos Office reconocidos por los editores BOLD.
const mimes = {
    "application/msword": "docs",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docs",
    "application/vnd.ms-excel": "sheets",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheets",
    "application/vnd.ms-powerpoint": "slides",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slides",
};
const extensions = {doc: "docs", docx: "docs", xls: "sheets", xlsx: "sheets", ppt: "slides", pptx: "slides"};
export function officeFileKind(file) {
    return mimes[file.mimeType] || (["", undefined, "application/octet-stream", "application/zip"].includes(file.mimeType) ? extensions[file.name?.split(".").at(-1).toLowerCase()] : undefined);
}

// El backend convierte formatos antiguos una sola vez y reutiliza el archivo actual.
export function officeInBold(file) {
    return Boolean(officeFileKind(file));
}

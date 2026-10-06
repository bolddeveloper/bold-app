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
export const officeUploadAccept = Object.keys(extensions).map(extension => `.${extension}`).join(",");

// Docs accepts Office uploads; Drive keeps its unrestricted upload flow.
export function officeUploadError(files) {
    const rejected = files.filter(file => !officeFileKind({name: file.name, mimeType: file.type}));
    return rejected.length
        ? `Estos archivos no están permitidos desde Docs: ${rejected.map(file => file.name).join(", ")}. Solo se permiten Word (.doc, .docx), Excel (.xls, .xlsx) y PowerPoint (.ppt, .pptx). Para otros archivos, usa Drive.`
        : "";
}
export function officeFileKind(file) {
    return mimes[file.mimeType] || (["", undefined, "application/octet-stream", "application/zip"].includes(file.mimeType) ? extensions[file.name?.split(".").at(-1).toLowerCase()] : undefined);
}

// El backend convierte formatos antiguos una sola vez y reutiliza el archivo actual.
export function officeInBold(file) {
    return Boolean(officeFileKind(file));
}

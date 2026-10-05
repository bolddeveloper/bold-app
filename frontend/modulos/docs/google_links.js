import { officeFileKind } from "./office_files.js";
const homes = { docs: "https://docs.google.com/document/", sheets: "https://docs.google.com/spreadsheets/", slides: "https://docs.google.com/presentation/", drive: "https://drive.google.com/drive/" };
export function googleHomeUrl(kind, email) {
    const url = new URL(homes[kind] || homes.drive);
    url.searchParams.set("authuser", email);
    return url.href;
}
export function googleFileUrl(file, email) {
    const types = { "application/vnd.google-apps.document": "document", "application/vnd.google-apps.spreadsheet": "spreadsheets", "application/vnd.google-apps.presentation": "presentation" };
    const type = types[file.mimeType] || {docs: "document", sheets: "spreadsheets", slides: "presentation"}[officeFileKind(file)];
    const url = new URL(file.mimeType === "application/vnd.google-apps.folder" ? `https://drive.google.com/drive/folders/${encodeURIComponent(file.id)}` : type ? `https://docs.google.com/${type}/d/${encodeURIComponent(file.id)}/edit` : `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`);
    url.searchParams.set("authuser", email);
    return url.href;
}

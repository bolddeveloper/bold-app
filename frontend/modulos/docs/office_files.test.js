import test from "node:test";
import assert from "node:assert/strict";
import { officeFileKind, officeInBold, officeUploadAccept, officeUploadError } from "./office_files.js";

test("Office types route to the matching editor with extension fallback", () => {
    for (const [extension, kind] of Object.entries({doc: "docs", docx: "docs", xls: "sheets", xlsx: "sheets", ppt: "slides", pptx: "slides"})) {
        assert.equal(officeFileKind({name: `test.${extension.toUpperCase()}`, mimeType: "application/octet-stream"}), kind);
    }
    assert.equal(officeFileKind({mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "Budget"}), "sheets");
    assert.equal(officeFileKind({name: "fake.docx", mimeType: "application/pdf"}), undefined);
    assert.equal(officeFileKind({name: "folder.docx", mimeType: "application/vnd.google-apps.folder"}), undefined);
    assert.equal(officeFileKind({name: "unknown.zip", mimeType: "application/zip"}), undefined);
});

test("BOLD opens modern originals and converts legacy Office once through the backend", () => {
    for (const extension of ["docx", "xlsx", "pptx"]) assert.equal(officeInBold({name: `test.${extension}`, mimeType: "application/octet-stream"}), true);
    for (const extension of ["doc", "xls", "ppt"]) assert.equal(officeInBold({name: `test.${extension}`, mimeType: "application/octet-stream"}), true);
});

test("Docs uploads allow Office and reject unsupported or mixed selections before uploading", () => {
    for (const extension of ["doc", "docx", "xls", "xlsx", "ppt", "pptx"]) {
        assert.equal(officeUploadError([{name: `Archivo.${extension.toUpperCase()}`, type: ""}]), "");
        assert.ok(officeUploadAccept.includes(`.${extension}`));
    }
    assert.equal(officeUploadError([{name: "Informe", type: "application/msword"}]), "");
    for (const file of [{name: "foto.png", type: "image/png"}, {name: "informe.pdf", type: "application/pdf"}, {name: "falso.docx", type: "application/pdf"}]) {
        const message = officeUploadError([{name: "válido.docx", type: ""}, file]);
        assert.ok(message.includes(file.name));
        assert.ok(message.includes("no están permitidos desde Docs"));
    }
});

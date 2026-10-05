import test from "node:test";
import assert from "node:assert/strict";
import { officeFileKind, officeInBold } from "./office_files.js";

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

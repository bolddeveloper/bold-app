import assert from "node:assert/strict";
import {test} from "node:test";
import {cellInput, cellText, columnName, documentChanges, documentTabs, editorKind, sheetChanges, sheetRange, slideTextChanges} from "./editor_helpers.js";

test("document edits use descending UTF-16 indices and preserve table and embedded content", () => {
    const paragraph = (startIndex, text) => ({startIndex, endIndex: startIndex + text.length, paragraph: {elements: [{textRun: {content: text}}]}});
    const elements = [paragraph(1, "hola\n"), {table: {tableRows: [{tableCells: [{content: [paragraph(10, "😀\n")]}]}]}}, {startIndex: 20, paragraph: {elements: [{inlineObjectElement: {inlineObjectId: "image"}}]}}];
    const requests = documentChanges(elements, {1: [{text: "nuevo", style: {bold: true}}], 10: [{text: "otro"}], 20: [{text: "no"}]}, "tab1");
    assert.equal(requests[0].deleteContentRange.range.startIndex, 10);
    assert.equal(requests[0].deleteContentRange.range.endIndex, 12);
    assert.equal(requests[0].deleteContentRange.range.tabId, "tab1");
    assert.equal(requests[3].deleteContentRange.range.startIndex, 1);
    assert.equal(requests.length, 6);
    assert.deepEqual(documentChanges(elements, {}, "tab1"), []);
});

test("nested Docs tabs retain separate body and ID", () => {
    const tabs = documentTabs({tabs: [{tabProperties: {tabId: "one", title: "Uno"}, documentTab: {body: {content: []}}, childTabs: [{tabProperties: {tabId: "two", title: "Dos"}, documentTab: {body: {content: []}}}]}]});
    assert.deepEqual(tabs.map(tab => tab.id), ["one", "two"]);
    assert.equal(editorKind("application/vnd.google-apps.presentation"), "slides");
    assert.equal(editorKind("application/pdf"), undefined);
});

test("Sheets saves only changed cells, formulas, numbers and intentional strings", () => {
    assert.equal(columnName(26), "AA");
    assert.equal(columnName(701), "ZZ");
    assert.equal(sheetRange("O'Brien", 100), "'O''Brien'!A101:Z200");
    assert.deepEqual(cellInput("=SUM(A1:A3)"), {formulaValue: "=SUM(A1:A3)"});
    assert.deepEqual(cellInput("12.5"), {numberValue: 12.5});
    assert.deepEqual(cellInput("001"), {stringValue: "001"});
    assert.deepEqual(cellInput("'123"), {stringValue: "123"});
    assert.deepEqual(cellInput("FALSE"), {boolValue: false});
    assert.deepEqual(cellInput(""), {});
    const result = sheetChanges(7, {"100:2": "42", "101:3": ""});
    assert.deepEqual(result[0].updateCells.start, {sheetId: 7, rowIndex: 100, columnIndex: 2});
    assert.equal(result[0].updateCells.fields, "userEnteredValue");
    assert.deepEqual(result[1].updateCells.rows[0].values[0].userEnteredValue, {});
    assert.equal(cellText({userEnteredValue: {formulaValue: "=1+1"}, formattedValue: "2"}), "=1+1");
});

test("Slides replace only edited shape text including clearing text", () => {
    const result = slideTextChanges({one: "nuevo", two: ""});
    assert.equal(result.length, 3);
    assert.deepEqual(result[0], {deleteText: {objectId: "one", textRange: {type: "ALL"}}});
    assert.equal(result[1].insertText.text, "nuevo");
    assert.equal(result[2].deleteText.objectId, "two");
    const patch = slideTextChanges({one: "Hola 😁 mundo"}, {one: "Hola 😀 mundo"});
    assert.deepEqual(patch[0].deleteText.textRange, {type: "FIXED_RANGE", startIndex: 5, endIndex: 7});
    assert.deepEqual(patch[1].insertText, {objectId: "one", text: "😁", insertionIndex: 5});
    assert.deepEqual(slideTextChanges({one: "Igual"}, {one: "Igual"}), []);
});

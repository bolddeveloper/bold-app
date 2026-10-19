import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "../../core/node_modules/jsdom/lib/api.js";
import {linkifyElement, linkifyEditor, linkMarkup, normalizedLink} from "./editor_links.js";
import {editorDisplayHTML, saveRichText, richTextPrefix} from "./rich_text.js";
import {transferredFiles, validateEditorImages} from "./editor_media.js";

const dom = new JSDOM("<!doctype html><body></body>");
globalThis.DOMParser = dom.window.DOMParser; globalThis.document = dom.window.document;

test("plain and pasted URLs become links without interpreting HTML or punctuation", () => {
    const value = 'Ver https://example.com/a?x=1&y=2, y (https://example.com/b). www.bold.gt <script>bad()</script>';
    const body = new DOMParser().parseFromString(editorDisplayHTML(value), "text/html").body;
    assert.deepEqual([...body.querySelectorAll("a")].map(a => a.getAttribute("href")), ["https://example.com/a?x=1&y=2", "https://example.com/b", "https://www.bold.gt/"]);
    assert.equal(body.textContent, value);
    assert.equal(body.querySelector("script"), null);
    for (const a of body.querySelectorAll("a")) { assert.equal(a.rel, "noopener noreferrer"); assert.equal(a.target, "_blank"); }
});

test("aliases remain escaped, clickable and intact through saving and editing", () => {
    const html = linkMarkup("https://example.com/very/long", 'Guía <img onerror="bad()">');
    const saved = saveRichText(html);
    const body = new DOMParser().parseFromString(editorDisplayHTML(saved, true), "text/html").body;
    assert.equal(body.querySelector("a").textContent, 'Guía <img onerror="bad()">');
    assert.equal(body.querySelector("img"), null);
    assert.equal(body.querySelector("a").getAttribute("href"), "https://example.com/very/long");
    assert.throws(() => normalizedLink("javascript:alert(1)"));
    assert.throws(() => linkMarkup("data:text/html,bad", "Guía"));
    assert.throws(() => normalizedLink("file:///private"));
});

test("live recognition preserves caret, repeated input and URL editing without nested anchors", () => {
    const root = document.createElement("div"); document.body.append(root);
    root.textContent = "Hola https://example.com";
    const range = document.createRange(); range.selectNodeContents(root); range.collapse(false);
    const selection = dom.window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    linkifyEditor(root);
    assert.equal(selection.anchorNode.parentElement.tagName, "A");
    assert.equal(selection.anchorOffset, "https://example.com".length);
    const a = root.querySelector("a"); a.textContent += "/demo";
    linkifyElement(root); linkifyElement(root);
    assert.equal(root.querySelector("a").getAttribute("href"), "https://example.com/demo");
    assert.equal(root.querySelectorAll("a").length, 1);
    root.querySelector("a").append(". Texto posterior");
    linkifyElement(root);
    assert.equal(root.querySelector("a").textContent, "https://example.com/demo");
    assert.match(root.textContent, /demo\. Texto posterior$/);
    root.textContent = "https://e"; linkifyElement(root);
    root.querySelector("a").after(document.createTextNode("xample.com/demo"));
    linkifyElement(root);
    assert.equal(root.querySelector("a").getAttribute("href"), "https://example.com/demo");
    assert.ok(saveRichText(root.innerHTML).startsWith(richTextPrefix));
    root.remove();
});

test("clipboard and drop accept image files, fall back to items and reject unsupported formats", () => {
    const image = {type: "image/png", name: "capture.png"};
    assert.deepEqual(transferredFiles({files: [image], items: [{kind: "file", getAsFile: () => image}]}), [image]);
    assert.deepEqual(transferredFiles({items: [{kind: "string"}, {kind: "file", getAsFile: () => image}]}), [image]);
    assert.deepEqual(transferredFiles({items: [{kind: "file", getAsFile: () => null}]}), []);
    validateEditorImages([image]);
    assert.throws(() => validateEditorImages([{type: "image/svg+xml"}]));
    assert.throws(() => validateEditorImages([image, {type: "application/pdf"}]));
});

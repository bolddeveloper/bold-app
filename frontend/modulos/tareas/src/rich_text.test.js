import assert from "node:assert/strict";
import test from "node:test";
import { editorHTML, plainRichText, richImageSources, editorDisplayHTML, saveRichText, richTextPrefix } from "./rich_text.js";

test("existing task text stays literal, including HTML, quotes and newlines", () => {
    const legacy = '<img src=x onerror="alert(1)">\nA & B <script>evil()</script> \'literal\'';
    assert.equal(editorHTML(legacy), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;<br>A &amp; B &lt;script&gt;evil()&lt;/script&gt; &#39;literal&#39;');
    assert.equal(plainRichText(legacy), legacy);
    assert.equal(editorHTML(""), "");
    assert.equal(editorHTML("A &lt; B"), "A &amp;lt; B");
});

test("literal legacy image markup never becomes a carousel image", () => {
    assert.deepEqual(richImageSources('<img src="https://example.com/private.png">'), []);
    assert.deepEqual(richImageSources("Texto sin imágenes"), []);
    assert.deepEqual(richImageSources(""), []);
});


test("hidden editor images do not fetch and survive editing without trusting arbitrary URLs", {skip: !globalThis.DOMParser}, () => {
    const src = '/api/v2/media/images/12345678-1234-1234-1234-123456789abc/';
    const value = richTextPrefix + `<p>Text</p><img src="${src}">`;
    const display = editorDisplayHTML(value);
    assert.equal(display.includes('<img'), false);
    const editor = editorDisplayHTML(value, true);
    assert.equal(new DOMParser().parseFromString(editor, 'text/html').querySelector('img').hasAttribute('src'), false);
    assert.deepEqual(richImageSources(saveRichText(editor)), [src]);
    assert.deepEqual(richImageSources(saveRichText('<img data-bold-image="https://evil.example/image.png">')), []);
});

import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "../../core/node_modules/jsdom/lib/api.js";
import {cleanHTML,saveRichText,richTextPrefix} from "./rich_text.js";
import {linkifyEditor} from "./editor_links.js";

const dom=new JSDOM("<!doctype html><body></body>");
globalThis.document=dom.window.document;
globalThis.DOMParser=dom.window.DOMParser;

test("a long document is sanitized with one parse, preserving the previous serialization contract",()=>{
    const html=Array.from({length:350},(_,i)=>`<p><b>Bloque ${i}</b> con una descripción larga y <a href="https://example.com/${i}">guía</a>.</p>`).join("")+
        '<script>bad()</script><img data-bold-image="data:image/png;base64,aQ=="><font size="5" onclick="bad()">Título</font><a href="javascript:bad()">No ejecutar</a>';
    let parses=0;
    class CountedParser extends dom.window.DOMParser{parseFromString(...args){parses++;return super.parseFromString(...args);}}
    globalThis.DOMParser=CountedParser;
    let result;
    try{result=saveRichText(html);assert.equal(parses,1);}finally{globalThis.DOMParser=dom.window.DOMParser;}
    // Independent reconstruction of the old three-parse flow checks output, not speed.
    const draft=new DOMParser().parseFromString(html,"text/html");
    for(const image of draft.body.querySelectorAll("img[data-bold-image]"))image.setAttribute("src",image.getAttribute("data-bold-image"));
    const old=richTextPrefix+cleanHTML(draft.body.innerHTML);
    assert.equal(result,old);
    assert.doesNotMatch(result,/<script|onclick=|href="javascript:/);
    assert.match(result,/task_text_title/);
    assert.match(result,/src="data:image\/png;base64,aQ=="/);
});

test("typing changes only the current block and preserves unrelated link nodes and caret",()=>{
    const root=document.createElement("div");document.body.append(root);
    root.innerHTML=Array.from({length:250},(_,i)=>`<p>Bloque <a data-bold-autolink="true" href="https://example.com/${i}">https://example.com/${i}</a></p>`).join("")+"<p>Ahora https://bold.gt</p>";
    const first=root.querySelector("a"),current=root.lastElementChild;
    const range=document.createRange();range.selectNodeContents(current);range.collapse(false);
    const selection=dom.window.getSelection();selection.removeAllRanges();selection.addRange(range);
    linkifyEditor(root);
    assert.equal(root.querySelector("a"),first,"Do not recreate the other 250 links per keystroke");
    assert.equal(current.querySelector("a").href,"https://bold.gt/");
    assert.equal(selection.toString(),"");assert.ok(current.contains(selection.anchorNode));
    const before=document.createRange();before.selectNodeContents(current);before.setEnd(selection.anchorNode,selection.anchorOffset);
    assert.equal(before.toString(),current.textContent);
    root.remove();
});

test("multi-paragraph paste still recognizes every link, not just the caret block",()=>{
    const root=document.createElement("div");document.body.append(root);
    root.innerHTML="<p>https://one.example</p><p>https://two.example</p>";
    const range=document.createRange();range.selectNodeContents(root.lastChild);range.collapse(false);
    const selection=dom.window.getSelection();selection.removeAllRanges();selection.addRange(range);
    linkifyEditor(root,{wholeDocument:true});assert.equal(root.querySelectorAll("a").length,2);
    root.remove();
});

import {isStoredImageUrl} from "../../core/shared/media_urls.js";
import {linkifyElement, normalizedLink} from "./editor_links.js";
export const richTextPrefix = "<!--bold-rich-text-->";
export const inlineTextClasses = { 2: "task_text_quote", 3: "task_text_normal", 4: "task_text_subtitle", 5: "task_text_title" };

export function cleanHTML(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    cleanDocument(doc);
    return doc.body.innerHTML;
}

function cleanDocument(doc) {
    for (let node of [...doc.body.querySelectorAll("*")]) {
        if (node.tagName === "FONT") {
            const span = doc.createElement("span");
            if (inlineTextClasses[node.getAttribute("size")]) span.className = inlineTextClasses[node.getAttribute("size")];
            span.append(...node.childNodes); node.replaceWith(span); node = span;
        }
        if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "TEMPLATE"].includes(node.tagName)) { node.remove(); continue; }
        if (!["P", "DIV", "SPAN", "BR", "HR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "H2", "H3", "A", "TABLE", "TBODY", "TR", "TD", "TH", "IMG"].includes(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
        for (const attribute of [...node.attributes]) {
            const safe = node.tagName === "A" && attribute.name === "href" && /^https?:\/\//i.test(attribute.value)
                || node.tagName === "IMG" && attribute.name === "src" && (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(attribute.value) || isStoredImageUrl(attribute.value))
                || node.tagName === "SPAN" && attribute.name === "class" && Object.values(inlineTextClasses).includes(attribute.value);
            if (!safe) node.removeAttribute(attribute.name);
        }
    }
}

export function editorHTML(value = "") {
    if (value.startsWith(richTextPrefix)) return cleanHTML(value.slice(richTextPrefix.length));
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;").replaceAll("\n", "<br>");
}

// Keep gallery images in the document without making hidden editor images fetch again.
export function editorDisplayHTML(value, editable = false) {
    const doc = new DOMParser().parseFromString(editorHTML(value), "text/html");
    if (editable) for (const anchor of doc.body.querySelectorAll("a")) {
        try { if (normalizedLink(anchor.textContent) === normalizedLink(anchor.getAttribute("href"))) anchor.dataset.boldAutolink = "true"; } catch { /* El alias manual se conserva. */ }
    }
    linkifyElement(doc.body);
    for (const anchor of doc.body.querySelectorAll("a")) { anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; }
    for (const image of doc.body.querySelectorAll("img")) {
        if (editable) {image.setAttribute("data-bold-image", image.getAttribute("src") || ""); image.removeAttribute("src");}
        else image.remove();
    }
    return doc.body.innerHTML;
}

export function saveRichText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const image of doc.body.querySelectorAll("img[data-bold-image]")) image.setAttribute("src", image.getAttribute("data-bold-image"));
    cleanDocument(doc);
    linkifyElement(doc.body);
    return doc.body.textContent.trim() || doc.body.querySelector("img") ? richTextPrefix + doc.body.innerHTML : "";
}

export function appendRichImages(value, images = []) {
    if (!images.length) return value;
    const doc = new DOMParser().parseFromString(editorHTML(value), "text/html");
    for (const image of images) {
        const element = doc.createElement("img");
        element.src = image.url;
        doc.body.append(element);
    }
    return saveRichText(doc.body.innerHTML);
}

export function plainRichText(value = "") {
    if (!value.startsWith(richTextPrefix)) return value;
    const doc = new DOMParser().parseFromString(cleanHTML(value.slice(richTextPrefix.length)), "text/html");
    doc.body.querySelectorAll("br, p, div, li, h2, h3, blockquote, pre").forEach(node => node.append("\n"));
    return doc.body.textContent.trim();
}

export function richImageSources(value = "") {
    if (!value.startsWith(richTextPrefix) || !/<img\b/i.test(value)) return [];
    return [...new DOMParser().parseFromString(editorHTML(value), "text/html").body.querySelectorAll("img[src]")].map(image => image.getAttribute("src"));
}

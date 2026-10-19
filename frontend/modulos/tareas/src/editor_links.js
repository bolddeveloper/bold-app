const pattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

export function normalizedLink(value) {
    const url = new URL(/^www\./i.test(value) ? `https://${value}` : value);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Usa http:// o https://.");
    return url.href;
}

function trimLink(value) {
    value = value.replace(/[.,;:!?]+$/, "");
    while (value.endsWith(")") && (value.match(/\)/g) || []).length > (value.match(/\(/g) || []).length) value = value.slice(0, -1);
    return value.replace(/[\]}]+$/, "");
}

// Work only on text nodes: do not interpret pasted markup or overwrite aliases.
export function linkifyElement(root) {
    const doc = root.ownerDocument;
    for (const anchor of root.querySelectorAll('a[data-bold-autolink]')) {
        anchor.replaceWith(doc.createTextNode(anchor.textContent));
    }
    // Browsers may place the next typed character outside the current anchor.
    root.normalize();
    const walker = doc.createTreeWalker(root, 4), nodes = [];
    while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest("a, code, pre")) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const text = node.data, matches = [...text.matchAll(pattern)];
        if (!matches.length) continue;
        const fragment = doc.createDocumentFragment(); let offset = 0, changed = false;
        for (const match of matches) {
            const label = trimLink(match[0]); let href;
            try { href = normalizedLink(label); } catch { continue; }
            fragment.append(doc.createTextNode(text.slice(offset, match.index)));
            const anchor = doc.createElement("a"); anchor.href = href; anchor.textContent = label;
            anchor.dataset.boldAutolink = "true"; fragment.append(anchor);
            offset = match.index + label.length; changed = true;
        }
        if (changed) { fragment.append(doc.createTextNode(text.slice(offset))); node.replaceWith(fragment); }
    }
}

export function linkifyEditor(root) {
    const selection = root.ownerDocument.defaultView.getSelection();
    const offsets = selection?.rangeCount && root.contains(selection.anchorNode) && root.contains(selection.focusNode)
        ? [selection.anchorNode, selection.focusNode].map((node, i) => { const range = root.ownerDocument.createRange(); range.selectNodeContents(root); range.setEnd(node, i ? selection.focusOffset : selection.anchorOffset); return range.toString().length; }) : null;
    linkifyElement(root);
    if (!offsets) return;
    const locate = offset => { const walker = root.ownerDocument.createTreeWalker(root, 4); let last = root;
        while (walker.nextNode()) { last = walker.currentNode; if (offset <= last.length) return [last, offset]; offset -= last.length; }
        return [last, last === root ? root.childNodes.length : last.length]; };
    const start = locate(offsets[0]), end = locate(offsets[1]);
    selection.setBaseAndExtent(start[0], start[1], end[0], end[1]);
}

export function linkMarkup(url, alias) {
    const anchor = document.createElement("a"); anchor.href = normalizedLink(url); anchor.textContent = alias.trim() || anchor.href;
    return anchor.outerHTML;
}

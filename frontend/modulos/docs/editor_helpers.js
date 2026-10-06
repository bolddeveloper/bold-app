/* Google editor models and targeted batch operations. Indices use UTF-16, as Google does. */
export const editorKind = mime => ({
    "application/vnd.google-apps.document": "docs",
    "application/vnd.google-apps.spreadsheet": "sheets",
    "application/vnd.google-apps.presentation": "slides",
}[mime]);

export function documentTabs(content) {
    const flatten = tabs => tabs.flatMap(tab => [tab, ...flatten(tab.childTabs || [])]);
    return content.tabs?.length ? flatten(content.tabs).map(tab => ({
        id: tab.tabProperties.tabId,
        name: tab.tabProperties.title,
        ...tab.documentTab,
    })) : [{id: "", name: "Documento", body: content.body, inlineObjects: content.inlineObjects}];
}

export function documentParagraphs(elements = []) {
    return elements.flatMap(element => element.paragraph ? [element] :
        element.table ? element.table.tableRows.flatMap(row => row.tableCells.flatMap(cell => documentParagraphs(cell.content))) : []);
}

export const paragraphText = element => (element.paragraph.elements || []).map(run => run.textRun?.content || "").join("").replace(/\n$/, "");

export function documentChanges(elements, drafts, tabId) {
    const requests = [];
    for (const element of [...documentParagraphs(elements)].sort((a, b) => b.startIndex - a.startIndex)) {
        const draft = drafts[element.startIndex];
        if (!draft) continue;
        const startIndex = element.startIndex, oldText = paragraphText(element);
        // Paragraphs with embedded objects are read-only here, so objects cannot be flattened or deleted.
        if (element.paragraph.elements.some(run => !run.textRun)) continue;
        if (oldText.length) requests.push({deleteContentRange: {range: {startIndex, endIndex: startIndex + oldText.length, ...(tabId ? {tabId} : {})}}});
        const text = draft.map(run => run.text).join("");
        if (!text.length) continue;
        requests.push({insertText: {text, location: {index: startIndex, ...(tabId ? {tabId} : {})}}});
        let offset = startIndex;
        for (const run of draft) {
            if (run.text.length) requests.push({updateTextStyle: {
                range: {startIndex: offset, endIndex: offset + run.text.length, ...(tabId ? {tabId} : {})},
                textStyle: run.style || {},
                fields: "bold,italic,underline,strikethrough,fontSize,weightedFontFamily,foregroundColor,backgroundColor,link,baselineOffset",
            }});
            offset += run.text.length;
        }
    }
    return requests;
}

export function columnName(index) {
    let name = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
    return name;
}

export const sheetRange = (title, start, rows = 100, columns = 26) => `'${title.replaceAll("'", "''")}'!A${start + 1}:${columnName(columns - 1)}${start + rows}`;
export function cellInput(value) {
    if (value.startsWith("=")) return {formulaValue: value};
    if (!value) return {};
    if (value.startsWith("'")) return {stringValue: value.slice(1)};
    if (/^[-+]?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(value) && Number.isFinite(Number(value))) return {numberValue: Number(value)};
    if (/^(true|false)$/i.test(value)) return {boolValue: value.toLowerCase() === "true"};
    return {stringValue: value};
}
export const cellText = cell => cell?.userEnteredValue?.formulaValue ?? cell?.userEnteredValue?.stringValue ??
    cell?.userEnteredValue?.numberValue?.toString() ?? cell?.userEnteredValue?.boolValue?.toString() ?? "";

export function sheetChanges(sheetId, drafts) {
    return Object.entries(drafts).map(([key, value]) => {
        const [rowIndex, columnIndex] = key.split(":").map(Number);
        return {updateCells: {start: {sheetId, rowIndex, columnIndex}, rows: [{values: [{userEnteredValue: cellInput(value)}]}], fields: "userEnteredValue"}};
    });
}

export const shapeText = element => (element.shape?.text?.textElements || []).map(run => run.textRun?.content || "").join("").replace(/\n$/, "");
export function slideTextChanges(drafts, originals = {}) {
    return Object.entries(drafts).flatMap(([objectId, text]) => {
        if (!(objectId in originals)) return [
            {deleteText: {objectId, textRange: {type: "ALL"}}},
            ...(text ? [{insertText: {objectId, text, insertionIndex: 0}}] : []),
        ];
        // Preserve styling on untouched characters; never split a surrogate pair.
        const old = Array.from(originals[objectId]), next = Array.from(text);
        let prefix = 0, suffix = 0;
        while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
        while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
        const startIndex = old.slice(0, prefix).join("").length;
        const endIndex = old.slice(0, old.length - suffix).join("").length;
        const inserted = next.slice(prefix, next.length - suffix).join("");
        return [
            ...(endIndex > startIndex ? [{deleteText: {objectId, textRange: {type: "FIXED_RANGE", startIndex, endIndex}}}] : []),
            ...(inserted ? [{insertText: {objectId, text: inserted, insertionIndex: startIndex}}] : []),
        ];
    });
}

export const googleRgb = hex => ({red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255});
export const cssRgb = value => value ? `rgb(${Math.round((value.red || 0) * 255)},${Math.round((value.green || 0) * 255)},${Math.round((value.blue || 0) * 255)})` : undefined;
export const pointValue = dimension => dimension?.magnitude * (dimension?.unit === "EMU" ? 1 / 12700 : 1) || 0;

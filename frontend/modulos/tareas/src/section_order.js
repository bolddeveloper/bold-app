export function reorderSections(sections, sourceId, targetId, after = false) {
    const from = sections.findIndex(section => section.id === sourceId);
    const target = sections.findIndex(section => section.id === targetId);
    if (from < 0 || target < 0 || from === target) return sections;
    const next = [...sections], [section] = next.splice(from, 1);
    next.splice(next.findIndex(item => item.id === targetId) + Number(after), 0, section);
    return next.every((item, index) => item === sections[index]) ? sections : next;
}

export function insertUnsectioned(sections, column, position) {
    const next = [...sections];
    next.splice(Number.isInteger(position) ? Math.max(0, Math.min(position, next.length)) : next.length, 0, column);
    return next;
}

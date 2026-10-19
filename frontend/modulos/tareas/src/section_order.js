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

export function materializePersonalSection(board, section, taskIds) {
    const sections = insertUnsectioned(board.sections, section, board.unsectioned_index);
    const task_sections = {...board.task_sections};
    for (const id of taskIds) if (!task_sections[id]) task_sections[id] = section.id;
    return {...board, sections, task_sections, unsectioned_index: null, unsectioned_hidden: true};
}

export function visibleSections(sections, hidden = false, position = null, column = {id: "unsectioned", label: "Sin sección", manageable: true}) {
    return hidden ? sections : insertUnsectioned(sections, column, position);
}

export function projectSectionOptions(data, projectId) {
    const sections = (data?.sections || []).filter(row => row.projectId === projectId).sort((a, b) => Number(a.position) - Number(b.position) || String(a.id).localeCompare(String(b.id)));
    const project = data?.projects?.find(row => row.id === projectId);
    return visibleSections(sections, project?.unsectioned_hidden, project?.unsectioned_index);
}

export function preferredSection(sections, lastId) {
    return sections.find(row => row.id === lastId)?.id || sections[0]?.id || "unsectioned";
}

export function removePersonalSection(board, id) {
    const columns = visibleSections(board.sections, board.unsectioned_hidden, board.unsectioned_index);
    const remaining = columns.filter(row => row.id !== id);
    if (!remaining.length) return board;
    const target = remaining[0].id;
    const task_sections = {...board.task_sections};
    for (const [taskId, sectionId] of Object.entries(task_sections)) {
        if (sectionId === id) { if (target === "unsectioned") delete task_sections[taskId]; else task_sections[taskId] = target; }
    }
    const virtualIndex = remaining.findIndex(row => row.id === "unsectioned");
    return {...board, sections: remaining.filter(row => row.id !== "unsectioned"), task_sections,
        unsectioned_hidden: board.unsectioned_hidden || id === "unsectioned", unsectioned_index: virtualIndex < 0 ? null : virtualIndex};
}

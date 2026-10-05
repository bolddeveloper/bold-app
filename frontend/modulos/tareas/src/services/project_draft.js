// Live directory/project refreshes must not overwrite an open, edited form.
export function createProjectDraftInitializer() {
    let initializedKey = null;
    return {
        reset() { initializedKey = null; },
        initialize(key, applyDraft) {
            if (key === initializedKey) return false;
            applyDraft();
            initializedKey = key;
            return true;
        },
    };
}

export function initialProjectMemberIds(project, unitPeople) {
    const available = new Set(unitPeople.map(person => String(person.id)));
    return [...new Set(project?.member_ids || [])].filter(id => available.has(String(id)));
}

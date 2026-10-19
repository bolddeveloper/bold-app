export function sharingSelection(ids, state) {
    const explicit = new Set(state?.task_ids || []), inherited = new Set(state?.inherited_ids || []);
    const unique = [...new Set(ids)];
    const selected = unique.length > 0 && unique.every(id => explicit.has(id) || inherited.has(id));
    return {
        targets: unique.filter(id => !inherited.has(id)), selected,
        partial: !selected && unique.some(id => explicit.has(id) || inherited.has(id)),
    };
}

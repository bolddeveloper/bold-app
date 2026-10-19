export function defaultStages() {
    return [["Pendiente", "#6b7280", "open"], ["En curso", "#3b82f6", "open"], ["En revisión", "#f59e0b", "open"], ["Completada", "#16a34a", "completed"]]
        .map(([name, color, kind], i) => ({id: crypto.randomUUID(), name, color, kind, description: "", manual: false, probability: kind === "completed" ? 100 : (i + 1) * 25}));
}

export function distributeStages(stages) {
    const normal = stages.filter(stage => stage.kind === "open").map(stage => ({...stage}));
    const anchors = [{index: -1, probability: 0}, ...normal.flatMap((stage, index) => stage.manual ? [{index, probability: stage.probability}] : []), {index: normal.length, probability: 100}];
    for (let i = 1; i < anchors.length; i++) {
        const before = anchors[i - 1], after = anchors[i];
        for (let index = before.index + 1; index < after.index; index++) normal[index].probability = Math.min(99, Math.round(before.probability + (after.probability - before.probability) * (index - before.index) / (after.index - before.index)));
    }
    return [...normal, ...["completed", "failed"].flatMap(kind => stages.filter(stage => stage.kind === kind).map(stage => ({...stage, probability: kind === "completed" ? 100 : 0})))];
}

export function reorderStages(stages, from, to) {
    const normal = stages.filter(stage => stage.kind === "open");
    if (!normal[from] || !normal[to]) return stages;
    const slots = normal.map(({probability, manual}) => ({probability, manual}));
    const [moved] = normal.splice(from, 1); normal.splice(to, 0, moved);
    return [...normal.map((stage, index) => ({...stage, ...slots[index]})), ...stages.filter(stage => stage.kind !== "open")];
}

export function validateStages(stages) {
    if (!stages.some(stage => stage.kind === "open")) return "Conserva al menos una etapa normal.";
    const names = stages.map(stage => stage.name.trim().toLocaleLowerCase("es"));
    if (names.some(name => !name) || new Set(names).size !== names.length) return "Cada etapa necesita un nombre diferente.";
    let previous = -1;
    for (const stage of stages.filter(stage => stage.kind === "open")) {
        if (!Number.isInteger(stage.probability) || stage.probability < previous || stage.probability < 0 || stage.probability > 99) return "Los porcentajes normales deben mantenerse de menor a mayor, entre 0% y 99%.";
        previous = stage.probability;
    }
    return "";
}

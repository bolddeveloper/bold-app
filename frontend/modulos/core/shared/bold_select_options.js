export function filterSelectOptions(options, query, searchable = false) {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase("es");
    if (!searchable || !normalizedQuery) return options;
    return options.filter(option =>
        `${option.label ?? ""} ${option.value ?? ""}`
            .toLocaleLowerCase("es")
            .includes(normalizedQuery)
    );
}

export function mentionAtCaret(text = "") {
    const match = text.match(/(?:^|\s)@([\p{L}\p{N}_ -]{0,60})$/u);
    return match ? {query: match[1], length: match[1].length + 1} : null;
}
export function mentionPeople(people, query = "") {
    const clean = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
    const needle = clean(query.trim()), seen = new Set();
    return people.filter(person => {
        const key = person.privateAssistant ? person.employee_id : person.email?.toLowerCase();
        const aliases=Array.isArray(person.aliases) ? person.aliases.join(' '):'';
        if (!key || seen.has(key) || !clean(`${person.name} ${person.email || ''} ${aliases}`).includes(needle)) return false;
        seen.add(key); return true;
    }).slice(0, 6);
}

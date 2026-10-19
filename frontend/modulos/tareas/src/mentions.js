export function mentionAtCaret(text = "") {
    const match = text.match(/(?:^|\s)@([\p{L}\p{N}_ -]{0,60})$/u);
    return match ? {query: match[1], length: match[1].length + 1} : null;
}
export function mentionPeople(people, query = "") {
    const clean = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
    const needle = clean(query.trim()), seen = new Set();
    return people.filter(person => {
        const email = person.email?.toLowerCase();
        if (!email || seen.has(email) || !clean(`${person.name} ${email}`).includes(needle)) return false;
        seen.add(email); return true;
    }).slice(0, 6);
}

export function personIdentity(person) {
    const employee = person?.personId || person?.employee_id || person?.employee;
    if (employee) return `employee:${employee}`;
    if (person?.email) return `email:${person.email.trim().toLowerCase()}`;
    return person?.id != null ? `assignment:${person.id}` : person;
}

// Keep assignment IDs for writes; a search result represents the person once.
export function uniquePeople(people, preferredIds = []) {
    const rank = new Map();
    preferredIds.forEach((id, index) => {if (!rank.has(String(id))) rank.set(String(id), index);});
    const selected = new Map();
    for (const person of people || []) {
        const key = personIdentity(person), previous = selected.get(key);
        if (!previous || (rank.get(String(person.id)) ?? Infinity) < (rank.get(String(previous.id)) ?? Infinity)) selected.set(key, person);
    }
    return [...selected.values()];
}

export function removePersonAssignments(ids, selectedId, people) {
    const key = personIdentity(people.find(person => String(person.id) === String(selectedId)) || {id: selectedId});
    return ids.filter(id => personIdentity(people.find(person => String(person.id) === String(id)) || {id}) !== key);
}

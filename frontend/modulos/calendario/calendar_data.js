export const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const fromDay = key => new Date(`${key}T12:00:00`);
export const addDays = (date, count) => { const next = new Date(date); next.setDate(next.getDate() + count); return next; };
export const weekStart = date => addDays(date, -((date.getDay() + 6) % 7));
export const zoneDay = (value, zone) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
};
export const eventDay = (event, zone) => event.start?.date || zoneDay(event.start.dateTime, zone);
export const endDay = (event, zone) => event.end?.date ? dayKey(addDays(fromDay(event.end.date), -1)) : zoneDay(new Date(new Date(event.end.dateTime).getTime() - 1), zone);
export const matchesDay = (event, key, zone) => eventDay(event, zone) <= key && endDay(event, zone) >= key;

const minutesInZone = (value, zone) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return Number(parts.hour) * 60 + Number(parts.minute);
};

export const timedEventLayout = (events, key, zone) => {
    const rows = events.filter(event => event.start?.dateTime && matchesDay(event, key, zone)).map(event => {
        const start = eventDay(event, zone) === key ? minutesInZone(event.start.dateTime, zone) : 0;
        const end = zoneDay(event.end.dateTime, zone) === key ? minutesInZone(event.end.dateTime, zone) : 1440;
        return { event, start, end: Math.max(start + 30, end), lane: 0 };
    }).sort((a, b) => a.start - b.start || b.end - a.end);
    const lanes = [];
    for (const row of rows) {
        row.lane = lanes.findIndex(end => end <= row.start);
        if (row.lane < 0) row.lane = lanes.length;
        lanes[row.lane] = row.end;
    }
    return rows.map(row => ({ ...row, columns: lanes.length }));
};

export const selectedTimeRange = (first, last) => ({ start: Math.min(first, last), end: Math.max(first, last) + 30 });

export function guestSuggestions(query, previous, contacts) {
    if (!query) return [];
    const used = new Set(previous.map(email => email.trim().toLowerCase()));
    const known = [...new Map(contacts.filter(person => person.email && !used.has(person.email.toLowerCase()) && `${person.name} ${person.email}`.toLowerCase().includes(query)).map(person => [person.email.toLowerCase(), person])).values()];
    return [...known.slice(0, 6), ...(/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(query) && !known.some(person => person.email.toLowerCase() === query) && !used.has(query) ? [{ email: query, name: "Invitar a este correo" }] : [])];
}

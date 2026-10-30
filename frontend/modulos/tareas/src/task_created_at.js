// The server owns created_at. Never fabricate a date from updated_at or now().
export function taskCreationTime(value, {locale = "es", timeZone} = {}) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const calendar = new Date(`${value.slice(0,10)}T00:00:00Z`);
    if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== value.slice(0,10)) return null;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const formatter = new Intl.DateTimeFormat(locale, {year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit", timeZoneName:"short", ...(timeZone ? {timeZone} : {})});
    return {iso:date.toISOString(), label:formatter.format(date)};
}

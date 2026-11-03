export function pickerDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const [year, month, day] = value.split("-").map(Number), date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
export const pickerDay = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
export function shiftPickerDay(value, days) {const date = pickerDate(value); if (!date) return ""; date.setDate(date.getDate()+days); return pickerDay(date);}
export function mergeDateRange(start, end, range) {
    const merge = (old, next) => next ? next + (old?.includes("T") ? old.slice(10) : "") : "";
    return {start:merge(start, range.start), end:merge(end, range.end)};
}

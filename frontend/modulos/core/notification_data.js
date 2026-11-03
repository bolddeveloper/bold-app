export const isMention = item => /(?:^|\.)(?:mention|mentioned)$/.test(item.type || "") || item.is_mention === true;
export const notificationTaskId = item => {
    const task = item.task_id || item.task || item.route?.task_id;
    return task && typeof task === "object" ? task.id || null : task || null;
};
export function notificationActor(item, directory = []) {
    const identity=item.actor_assignment || item.actor_id;
    const person = identity ? directory.find(person => String(person.id) === String(identity)) : null;
    const name = item.actor_name || item.actor?.name || person?.name || "";
    return {name, avatar_url:item.actor_avatar_url || item.actor?.avatar_url || person?.avatar_url, initials:name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join(""), color:person?.color};
}
export function notificationTime(value, fallback = "") {
    const date = new Date(value);
    if (!value || Number.isNaN(+date)) return fallback;
    const minutes = Math.max(0, Math.floor((Date.now() - date) / 60000));
    if (minutes < 1) return "Ahora";
    if (minutes < 60) return `Hace ${minutes} min`;
    if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} h`;
    return date.toLocaleDateString("es", {day:"numeric", month:"short"});
}

export const notificationSounds = [["samsung", "Silbido Samsung"], ["post", "Nueva publicación"], ["melody", "SMS melódico"], ["delivered", "Mensaje entregado"], ["facebook", "Mensaje Facebook"]];
export const defaultNotificationSettings = {enabled: true, sound: "samsung", volume: 60, custom_audio: "", custom_name: "", desktop_enabled: false};
let audio, customTimer;
export function stopNotificationSound() {clearTimeout(customTimer); if (audio) {audio.pause(); audio = null;}}
export async function playNotificationSound(settings = defaultNotificationSettings) {
    if (!settings.enabled || !settings.volume) return;
    stopNotificationSound();
    const preset = notificationSounds.some(([id]) => id === settings.sound) ? settings.sound : "samsung";
    const url = settings.sound === "custom" && settings.custom_audio ? settings.custom_audio : `/notification-sounds/${preset}.mp3`;
    const current = new Audio(url); audio = current; current.volume = settings.volume / 100;
    await current.play();
    if (audio === current) customTimer = setTimeout(stopNotificationSound, 15000);
}

export function showDesktopNotification(row, settings) {
    if (!settings.desktop_enabled || !globalThis.Notification || Notification.permission !== "granted") return;
    const notice = new Notification(row.title || "BOLD", {body: row.body || "Tienes una nueva notificación.", tag: `bold-${row.id}`, icon: "/logo-bold.svg", silent: true});
    notice.onclick = () => {window.focus(); notice.close();};
}

export function containsNewUnreadNotification(previous, next) {
    if (!previous) return false;
    const ids = new Set(previous.map(row => String(row.id)));
    return next.some(row => !row.is_read && !ids.has(String(row.id)));
}

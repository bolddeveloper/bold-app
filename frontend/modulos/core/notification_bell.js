export function startNotificationBellReminder(intervalMinutes, ring, visible = () => !document.hidden) {
    let stopTimer;
    const timer = setInterval(() => {
        if (!visible()) return;
        ring(true);
        clearTimeout(stopTimer);
        stopTimer = setTimeout(() => ring(false), 2_000);
    }, intervalMinutes * 60_000);
    return () => {
        clearInterval(timer);
        clearTimeout(stopTimer);
    };
}

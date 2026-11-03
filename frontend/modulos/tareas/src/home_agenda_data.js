export function agendaDay(now) {
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(end.getDate()+1);
    return {start:start.toISOString(),end:end.toISOString()};
}

export function upcomingMeetings(events, now) {
    const {start,end} = agendaDay(now), lower = Date.parse(start), upper = Date.parse(end);
    return events.filter(event => {
        const begin = Date.parse(event.start?.dateTime), finish = Date.parse(event.end?.dateTime);
        return event.kind !== "task" && event.status !== "cancelled" && !event.attendees?.some(person => person.self && person.responseStatus === "declined")
            && Number.isFinite(begin) && Number.isFinite(finish) && finish > begin && finish > now.getTime() && begin < upper && finish > lower;
    }).sort((a,b) => Date.parse(a.start.dateTime)-Date.parse(b.start.dateTime)).slice(0,3);
}

export function meetingLink(event) {
    const value = event.hangoutLink || event.conferenceData?.entryPoints?.find(point => point.entryPointType === "video")?.uri;
    try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "meet.google.com" ? url.href : null; } catch { return null; }
}

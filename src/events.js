const MAX_EVENTS_PER_TOKEN = 50;

// token -> [{ ts: number, payload: any }]
const events = new Map();

export function addEvent(token, payload) {
    if (!events.has(token)) events.set(token, []);
    const list = events.get(token);
    list.push({ ts: Date.now(), payload });
    if (list.length > MAX_EVENTS_PER_TOKEN) {
        list.splice(0, list.length - MAX_EVENTS_PER_TOKEN);
    }
}

export function listEvents(token) {
    return [...(events.get(token) || [])];
}

export function deleteEvents(token) {
    events.delete(token);
}

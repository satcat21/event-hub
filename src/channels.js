const channels = new Map();

export function getChannel(token) {
    if (!channels.has(token)) channels.set(token, new Set());
    return channels.get(token);
}

// Read-only lookup: does not allocate an empty channel for tokens without listeners.
export function peekChannel(token) {
    return channels.get(token);
}

export function removeClient(token, ws) {
    const ch = channels.get(token);
    if (!ch) return;
    ch.delete(ws);
    if (ch.size === 0) channels.delete(token);
}

export function deleteChannel(token) {
    const ch = channels.get(token);
    if (ch) {
        for (const ws of ch) ws.close(4004, 'Channel deleted');
        channels.delete(token);
    }
}

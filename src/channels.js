const channels = new Map();

export function getChannel(token) {
    if (!channels.has(token)) channels.set(token, new Set());
    return channels.get(token);
}

export function removeClient(token, ws) {
    channels.get(token)?.delete(ws);
}

export function deleteChannel(token) {
    const ch = channels.get(token);
    if (ch) {
        for (const ws of ch) ws.close(4004, 'Channel deleted');
        channels.delete(token);
    }
}
import session from 'express-session';

// In-memory session store that actually evicts expired sessions.
// express-session's default MemoryStore only drops a session when it is read
// after expiry, so abandoned sessions accumulate for the lifetime of the process.
export class PruningMemoryStore extends session.Store {
    constructor({ pruneIntervalMs = 15 * 60 * 1000 } = {}) {
        super();
        this.sessions = new Map(); // sid -> { json: string, expiresAt: number }
        this.pruneTimer = setInterval(() => this.prune(), pruneIntervalMs);
        this.pruneTimer.unref();
    }

    static expiryOf(sess) {
        const expires = sess?.cookie?.expires;
        return expires ? new Date(expires).getTime() : Infinity;
    }

    prune(now = Date.now()) {
        for (const [sid, entry] of this.sessions) {
            if (entry.expiresAt <= now) this.sessions.delete(sid);
        }
    }

    get(sid, cb) {
        const entry = this.sessions.get(sid);
        if (!entry) return cb(null, null);
        if (entry.expiresAt <= Date.now()) {
            this.sessions.delete(sid);
            return cb(null, null);
        }
        cb(null, JSON.parse(entry.json));
    }

    set(sid, sess, cb) {
        this.sessions.set(sid, {
            json: JSON.stringify(sess),
            expiresAt: PruningMemoryStore.expiryOf(sess),
        });
        cb?.(null);
    }

    touch(sid, sess, cb) {
        const entry = this.sessions.get(sid);
        if (entry) {
            const stored = JSON.parse(entry.json);
            stored.cookie = sess.cookie;
            this.set(sid, stored);
        }
        cb?.(null);
    }

    destroy(sid, cb) {
        this.sessions.delete(sid);
        cb?.(null);
    }

    length(cb) {
        cb(null, this.sessions.size);
    }

    clear(cb) {
        this.sessions.clear();
        cb?.(null);
    }
}

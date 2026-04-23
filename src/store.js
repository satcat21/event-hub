import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname } from 'path';

// token -> { createdAt: number, label: string }
const tokens = new Map();
const tokensFile = process.env.TOKENS_FILE || '/app/data/tokens.json';

let persistQueue = Promise.resolve();

function serializeTokens() {
    return JSON.stringify({
        tokens: [...tokens.entries()].map(([token, meta]) => ({ token, ...meta })),
    }, null, 2);
}

async function persistTokens() {
    await mkdir(dirname(tokensFile), { recursive: true });
    const tmpFile = `${tokensFile}.tmp`;
    await writeFile(tmpFile, serializeTokens(), 'utf8');
    await rename(tmpFile, tokensFile);
}

function queuePersist() {
    persistQueue = persistQueue
        .catch(() => {})
        .then(() => persistTokens());
    return persistQueue;
}

function loadTokenRows(raw) {
    if (!raw || typeof raw !== 'object') return [];
    if (Array.isArray(raw.tokens)) return raw.tokens;
    if (Array.isArray(raw)) return raw;
    return [];
}

export async function initStore() {
    try {
        const content = await readFile(tokensFile, 'utf8');
        const parsed = JSON.parse(content);
        const rows = loadTokenRows(parsed);
        for (const row of rows) {
            const token = typeof row?.token === 'string' ? row.token : '';
            if (!token) continue;
            const createdAt = Number(row.createdAt);
            tokens.set(token, {
                createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
                label: typeof row.label === 'string' ? row.label : '',
            });
        }
    } catch (err) {
        // Missing file on first start is expected.
        if (err?.code !== 'ENOENT') throw err;
    }
}

export async function createToken(label = '') {
    const token = randomUUID();
    tokens.set(token, { createdAt: Date.now(), label });
    await queuePersist();
    return token;
}

export function hasToken(token) {
    return tokens.has(token);
}

export function listTokens() {
    return [...tokens.entries()].map(([token, meta]) => ({ token, ...meta }));
}

export async function deleteToken(token) {
    const deleted = tokens.delete(token);
    if (deleted) await queuePersist();
    return deleted;
}

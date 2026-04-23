import { Router } from 'express';
import {
    getConfig,
    randomState,
    randomNonce,
    randomPKCECodeVerifier,
    calculatePKCECodeChallenge,
    buildAuthorizationUrl,
    authorizationCodeGrant,
    fetchUserInfo,
    requireAuth,
} from './oidc.js';
import { createToken, listTokens, deleteToken } from './store.js';
import { deleteChannel } from './channels.js';
import { listEvents, deleteEvents } from './events.js';

const router = Router();

// ── Auth flow ────────────────────────────────────────────────────────────────

router.get('/auth/login', async (req, res) => {
    const state = randomState();
    const nonce = randomNonce();
    const pkceCodeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(pkceCodeVerifier);
    req.session.oidcState = state;
    req.session.oidcNonce = nonce;
    req.session.oidcPkceVerifier = pkceCodeVerifier;
    const url = buildAuthorizationUrl(getConfig(), {
        redirect_uri: `${process.env.BASE_URL}/auth/callback`,
        scope: 'openid profile email',
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
    });
    res.redirect(url.href);
});

router.get('/auth/callback', async (req, res) => {
    try {
        const currentUrl = new URL(`${process.env.BASE_URL}${req.url}`);
        const tokens = await authorizationCodeGrant(getConfig(), currentUrl, {
            expectedState: req.session.oidcState,
            expectedNonce: req.session.oidcNonce,
            pkceCodeVerifier: req.session.oidcPkceVerifier,
        });
        const claims = tokens.claims();
        const userinfo = await fetchUserInfo(getConfig(), tokens.access_token, claims.sub);
        req.session.user = { sub: userinfo.sub, email: userinfo.email, name: userinfo.name };
        delete req.session.oidcState;
        delete req.session.oidcNonce;
        delete req.session.oidcPkceVerifier;
        const returnTo = req.session.returnTo || '/admin';
        delete req.session.returnTo;
        res.redirect(returnTo);
    } catch (err) {
        const oauthError = err?.cause?.error || err?.error;
        const oauthErrorDescription = err?.cause?.error_description || err?.error_description;
        console.error('OIDC callback error:', {
            message: err?.message,
            error: oauthError,
            error_description: oauthErrorDescription,
        });
        res.status(500).json({ error: 'Authentication failed' });
    }
});

router.get('/auth/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
});

router.get('/auth/me', requireAuth, (req, res) => {
    res.json(req.session.user);
});

// ── Admin API (OIDC protected) ───────────────────────────────────────────────

router.use('/admin', requireAuth);

router.get('/admin', (req, res) => {
    const userNameRaw = req.session?.user?.name || req.session?.user?.email || 'authenticated user';
    const userName = String(userNameRaw)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
        res.type('html').send(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
    <title>Event Hub Admin</title>
    <style>
        :root {
            --bg: #f7f8fc;
            --panel: #ffffff;
            --text: #111827;
            --muted: #6b7280;
            --line: #e5e7eb;
            --primary: #0f766e;
            --primary-ink: #ffffff;
            --danger: #b91c1c;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            color: var(--text);
            background: radial-gradient(1200px 700px at 100% -10%, #d1fae5 0%, var(--bg) 60%);
        }
        .wrap {
            max-width: 980px;
            margin: 2.5rem auto;
            padding: 0 1rem;
        }
        .card {
            background: var(--panel);
            border: 1px solid var(--line);
            border-radius: 14px;
            box-shadow: 0 8px 32px rgba(17, 24, 39, 0.06);
            padding: 1rem;
            margin-bottom: 1rem;
        }
        h1 { margin: 0 0 .35rem; }
        p { margin: .25rem 0; color: var(--muted); }
        .row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: .65rem;
            margin-top: 1rem;
        }
        input {
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 10px;
            padding: .65rem .75rem;
            font: inherit;
        }
        button {
            border: 1px solid transparent;
            border-radius: 10px;
            font: inherit;
            cursor: pointer;
            padding: .6rem .95rem;
        }
        .primary {
            background: var(--primary);
            color: var(--primary-ink);
        }
        .ghost {
            background: #fff;
            border-color: var(--line);
            color: var(--text);
        }
        .danger {
            background: #fff;
            border-color: #fecaca;
            color: var(--danger);
        }
        .toolbar { display: flex; gap: .5rem; margin-top: .8rem; }
        .status { min-height: 1.2rem; margin-top: .5rem; }
        .monitor-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: .6rem;
            flex-wrap: wrap;
        }
        .monitor-meta {
            color: var(--muted);
            font-size: .92rem;
        }
        .events {
            margin-top: .8rem;
            max-height: 300px;
            overflow: auto;
            border: 1px solid var(--line);
            border-radius: 10px;
            background: #fbfffd;
            padding: .6rem;
            font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
            font-size: .86rem;
        }
        .event {
            border-bottom: 1px solid var(--line);
            padding: .45rem 0;
        }
        .event:last-child { border-bottom: 0; }
        .event-time { color: var(--muted); margin-bottom: .2rem; }
        .event pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .table {
            width: 100%;
            border-collapse: collapse;
            margin-top: .5rem;
            font-size: .95rem;
        }
        .table th, .table td {
            border-top: 1px solid var(--line);
            padding: .75rem .5rem;
            text-align: left;
            vertical-align: top;
        }
        .mono {
            font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
            word-break: break-all;
        }
        .stack {
            display: flex;
            flex-direction: column;
            gap: .35rem;
        }
        @media (max-width: 800px) {
            .table thead { display: none; }
            .table, .table tbody, .table tr, .table td { display: block; width: 100%; }
            .table tr {
                border-top: 1px solid var(--line);
                padding: .45rem 0;
            }
            .table td { border: 0; padding: .35rem 0; }
            .row { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <main class="wrap">
        <section class="card">
            <h1>Event Hub Tokens</h1>
            <p>Signed in as ${userName}</p>
            <div class="row">
                <input id="label" type="text" placeholder="Token label (optional)" />
                <button id="create" class="primary" type="button">Create Token</button>
            </div>
            <div class="toolbar">
                <button id="refresh" class="ghost" type="button">Refresh</button>
                <button id="logout" class="ghost" type="button">Logout</button>
            </div>
            <p id="status" class="status"></p>
        </section>

        <section class="card">
            <div class="monitor-header">
                <div>
                    <h2 style="margin:0">Webhook Monitor</h2>
                    <div id="monitorMeta" class="monitor-meta">Choose a token to watch incoming webhook payloads.</div>
                </div>
                <button id="clearEvents" class="ghost" type="button" disabled>Clear View</button>
            </div>
            <div id="events" class="events" aria-live="polite"></div>
        </section>

        <section class="card">
            <table class="table" aria-label="Token list">
                <thead>
                    <tr>
                        <th>Label</th>
                        <th>Token</th>
                        <th>Webhook</th>
                        <th>WebSocket</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody id="tokens"></tbody>
            </table>
        </section>
    </main>

    <script>
        const statusEl = document.getElementById('status');
        const tokensEl = document.getElementById('tokens');
        const labelEl = document.getElementById('label');
        const eventsEl = document.getElementById('events');
        const monitorMetaEl = document.getElementById('monitorMeta');
        const clearEventsEl = document.getElementById('clearEvents');
        const ACTIVE_TOKEN_KEY = 'eventHub.activeToken';
        let activeToken = null;
        let ws = null;
        let reconnectTimer = null;
        let shouldReconnect = false;
        const seenEventTimestamps = new Set();

        function setStatus(msg, isError = false) {
            statusEl.textContent = msg;
            statusEl.style.color = isError ? '#b91c1c' : '#065f46';
        }

        function td(content, className = '') {
            const cell = document.createElement('td');
            if (className) cell.className = className;
            if (typeof content === 'string') {
                cell.textContent = content;
            } else {
                cell.appendChild(content);
            }
            return cell;
        }

        function formatTs(ts) {
            return new Date(ts).toLocaleString();
        }

        function appendEvent(evt) {
            const normalized = {
                ts: typeof evt?.ts === 'number' ? evt.ts : Date.now(),
                payload: (evt && Object.prototype.hasOwnProperty.call(evt, 'payload')) ? evt.payload : evt,
            };
            if (seenEventTimestamps.has(normalized.ts)) return;
            seenEventTimestamps.add(normalized.ts);
            const item = document.createElement('div');
            item.className = 'event';

            const time = document.createElement('div');
            time.className = 'event-time';
            time.textContent = formatTs(normalized.ts);
            item.appendChild(time);

            const pre = document.createElement('pre');
            pre.textContent = JSON.stringify(normalized.payload, null, 2);
            item.appendChild(pre);

            eventsEl.prepend(item);
        }

        function clearMonitorView() {
            eventsEl.innerHTML = '';
            seenEventTimestamps.clear();
        }

        function getSavedActiveToken() {
            try {
                return localStorage.getItem(ACTIVE_TOKEN_KEY);
            } catch {
                return null;
            }
        }

        function setSavedActiveToken(token) {
            try {
                if (token) localStorage.setItem(ACTIVE_TOKEN_KEY, token);
                else localStorage.removeItem(ACTIVE_TOKEN_KEY);
            } catch {
                // ignore localStorage errors
            }
        }

        function disconnectMonitor() {
            shouldReconnect = false;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (ws) {
                ws.close();
                ws = null;
            }
            activeToken = null;
            setSavedActiveToken(null);
            monitorMetaEl.textContent = 'Choose a token to watch incoming webhook payloads.';
            clearEventsEl.disabled = true;
        }

        function connectLiveSocket(token) {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            ws = new WebSocket(wsProtocol + '//' + window.location.host + '/ws/' + encodeURIComponent(token));
            ws.addEventListener('open', () => {
                monitorMetaEl.textContent = 'Watching token ' + token + ' (live).';
            });
            ws.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    appendEvent(data);
                } catch {
                    appendEvent({ ts: Date.now(), payload: { raw: String(event.data) } });
                }
            });
            ws.addEventListener('error', () => {
                ws?.close();
            });
            ws.addEventListener('close', () => {
                ws = null;
                if (!shouldReconnect || activeToken !== token) return;
                monitorMetaEl.textContent = 'Live monitor disconnected. Reconnecting...';
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    if (shouldReconnect && activeToken === token) connectLiveSocket(token);
                }, 2000);
            });
        }

        async function startMonitor(token) {
            disconnectMonitor();
            clearMonitorView();
            activeToken = token;
            setSavedActiveToken(token);
            shouldReconnect = true;
            monitorMetaEl.textContent = 'Loading recent events for token ' + token;
            clearEventsEl.disabled = false;

            const historyRes = await fetch('/admin/events/' + encodeURIComponent(token));
            if (!historyRes.ok) {
                monitorMetaEl.textContent = 'Failed to load recent events.';
                return;
            }
            const history = await historyRes.json();
            for (const evt of history) appendEvent(evt);

            connectLiveSocket(token);
        }

        async function loadTokens() {
            setStatus('Loading tokens...');
            const res = await fetch('/admin/tokens');
            if (!res.ok) throw new Error('Failed to load tokens');
            const tokens = await res.json();
            tokensEl.innerHTML = '';

            const existingTokens = new Set(tokens.map(t => t.token));
            const rememberedToken = getSavedActiveToken();

            if (!tokens.length) {
                disconnectMonitor();
                const tr = document.createElement('tr');
                tr.appendChild(td('No tokens yet. Create your first token.', 'mono'));
                tr.appendChild(td(''));
                tr.appendChild(td(''));
                tr.appendChild(td(''));
                tr.appendChild(td(''));
                tokensEl.appendChild(tr);
                setStatus('No tokens found.');
                return;
            }

            for (const t of tokens) {
                const tr = document.createElement('tr');
                tr.appendChild(td(t.label || '-'));
                tr.appendChild(td(t.token, 'mono'));

                const webhookWrap = document.createElement('div');
                webhookWrap.className = 'stack';
                const webhookLink = document.createElement('a');
                webhookLink.href = t.webhook;
                webhookLink.target = '_blank';
                webhookLink.rel = 'noopener noreferrer';
                webhookLink.textContent = t.webhook;
                webhookWrap.appendChild(webhookLink);
                tr.appendChild(td(webhookWrap, 'mono'));

                const wsWrap = document.createElement('div');
                wsWrap.className = 'stack';
                const wsCode = document.createElement('code');
                wsCode.textContent = t.websocket;
                wsWrap.appendChild(wsCode);
                tr.appendChild(td(wsWrap, 'mono'));

                const actions = document.createElement('div');
                actions.className = 'stack';
                const watchBtn = document.createElement('button');
                watchBtn.type = 'button';
                watchBtn.className = 'ghost';
                watchBtn.textContent = 'Watch';
                watchBtn.addEventListener('click', () => startMonitor(t.token).catch(err => {
                    console.error(err);
                    setStatus('Failed to start monitor', true);
                }));
                actions.appendChild(watchBtn);
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'danger';
                delBtn.textContent = 'Delete';
                delBtn.addEventListener('click', async () => {
                    if (!confirm('Delete this token?')) return;
                    const delRes = await fetch('/admin/tokens/' + encodeURIComponent(t.token), { method: 'DELETE' });
                    if (!delRes.ok) {
                        setStatus('Failed to delete token', true);
                        return;
                    }
                    await loadTokens();
                    if (activeToken === t.token) {
                        disconnectMonitor();
                        clearMonitorView();
                    }
                    setStatus('Token deleted');
                });
                actions.appendChild(delBtn);
                tr.appendChild(td(actions));

                tokensEl.appendChild(tr);
            }

            if (!activeToken && rememberedToken && existingTokens.has(rememberedToken)) {
                startMonitor(rememberedToken).catch(err => {
                    console.error(err);
                    setStatus('Failed to resume live monitor', true);
                });
            } else if (!activeToken && tokens.length === 1) {
                startMonitor(tokens[0].token).catch(err => {
                    console.error(err);
                    setStatus('Failed to start live monitor', true);
                });
            }

            setStatus('Token list updated');
        }

        document.getElementById('create').addEventListener('click', async () => {
            const label = labelEl.value.trim();
            const res = await fetch('/admin/tokens', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label }),
            });
            if (!res.ok) {
                setStatus('Failed to create token', true);
                return;
            }
            labelEl.value = '';
            await loadTokens();
            setStatus('Token created');
        });

        document.getElementById('refresh').addEventListener('click', loadTokens);

        document.getElementById('logout').addEventListener('click', async () => {
            disconnectMonitor();
            await fetch('/auth/logout');
            window.location.href = '/';
        });

        clearEventsEl.addEventListener('click', () => clearMonitorView());

        loadTokens().catch(err => {
            console.error(err);
            setStatus('Could not load tokens', true);
        });
    </script>
</body>
</html>`);
});

router.get('/admin/tokens', (_req, res) => {
    const base = process.env.BASE_URL ?? '';
    const wsBase = base.replace(/^http/, 'ws');
    const tokens = listTokens().map(t => ({
        ...t,
        webhook: `${base}/hook/${t.token}`,
        websocket: `${wsBase}/ws/${t.token}`,
    }));
    res.json(tokens);
});

router.get('/admin/events/:token', (req, res) => {
    const { token } = req.params;
    const tokenExists = listTokens().some(t => t.token === token);
    if (!tokenExists) return res.sendStatus(404);
    res.json(listEvents(token));
});

router.post('/admin/tokens', async (req, res) => {
    try {
        const label = String(req.body?.label ?? '');
        const token = await createToken(label);
        const base = process.env.BASE_URL ?? '';
        const wsBase = base.replace(/^http/, 'ws');
        res.status(201).json({
            token,
            label,
            webhook: `${base}/hook/${token}`,
            websocket: `${wsBase}/ws/${token}`,
        });
    } catch (err) {
        console.error('Failed to persist new token:', err?.message || err);
        res.status(500).json({ error: 'Failed to create token' });
    }
});

router.delete('/admin/tokens/:token', async (req, res) => {
    try {
        const { token } = req.params;
        if (!(await deleteToken(token))) return res.sendStatus(404);
        deleteChannel(token);
        deleteEvents(token);
        res.sendStatus(204);
    } catch (err) {
        console.error('Failed to persist token deletion:', err?.message || err);
        res.status(500).json({ error: 'Failed to delete token' });
    }
});

export default router;

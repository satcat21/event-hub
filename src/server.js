import http from 'http';
import express from 'express';
import session from 'express-session';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { getChannel, removeClient } from './channels.js';
import { hasToken, initStore } from './store.js';
import { addEvent } from './events.js';
import { initOIDC } from './oidc.js';
import adminRouter from './admin.js';

const app = express();
const staticDir = fileURLToPath(new URL('./static', import.meta.url));

// Deduplication for webhook broadcasts (3-second window per token)
const recentWebhooks = new Map(); // token -> Map<payloadHash, timestamp>

function getPayloadHash(payload) {
    return JSON.stringify(payload);
}

function shouldBroadcast(token, payload) {
    const hash = getPayloadHash(payload);
    const now = Date.now();
    const dedup = recentWebhooks.get(token) || new Map();
    const lastSeen = dedup.get(hash);
    
    if (lastSeen && (now - lastSeen) < 3000) {
        // Duplicate within 3-second window, skip broadcast
        return false;
    }
    
    // New or old webhook, allow broadcast and update timestamp
    dedup.set(hash, now);
    recentWebhooks.set(token, dedup);
    
    // Cleanup old entries periodically
    const expired = Array.from(dedup.entries()).filter(([_, ts]) => (now - ts) > 3000);
    expired.forEach(([h, _]) => dedup.delete(h));
    
    return true;
}

// Required when TLS is terminated by a reverse proxy (nginx/traefik/caddy).
// Without this, secure session cookies may not be set and OIDC state is lost.
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(staticDir));
app.use(session({
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
    },
}));

app.use(adminRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/', (_req, res) => {
        const githubUrlRaw = process.env.GITHUB_URL?.trim();
        const githubUrl = (githubUrlRaw && /^https?:\/\//.test(githubUrlRaw))
                ? githubUrlRaw
                : 'https://github.com/your-org/event-hub';

        res.type('html').send(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
    <title>Event Hub</title>
    <style>
        :root {
            --bg-1: #f8fbff;
            --bg-2: #eef4ff;
            --ink: #13213f;
            --muted: #4d5d86;
            --line: #d6def2;
            --brand: #789de5;
            --brand-dark: #4e77c8;
            --white: #ffffff;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            color: var(--ink);
            font-family: "Segoe UI", Arial, sans-serif;
            background:
                radial-gradient(1200px 700px at -10% -10%, #dbe8ff 0%, transparent 55%),
                radial-gradient(1000px 600px at 110% 0%, #d2e2ff 0%, transparent 55%),
                linear-gradient(160deg, var(--bg-1), var(--bg-2));
            display: grid;
            place-items: center;
            padding: 1rem;
        }
        .card {
            width: min(920px, 100%);
            background: rgba(255, 255, 255, 0.9);
            border: 1px solid var(--line);
            border-radius: 18px;
            box-shadow: 0 20px 65px rgba(19, 33, 63, 0.13);
            padding: clamp(1.2rem, 2vw, 2rem);
            backdrop-filter: blur(4px);
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: .5rem;
            border: 1px solid #c6d6f6;
            border-radius: 999px;
            padding: .35rem .8rem;
            color: #26457d;
            background: #eef4ff;
            font-size: .86rem;
            font-weight: 600;
            letter-spacing: .02em;
        }
        .dot {
            width: .5rem;
            height: .5rem;
            border-radius: 50%;
            background: #2ea96f;
            box-shadow: 0 0 0 5px rgba(46, 169, 111, .15);
        }
        h1 {
            margin: .9rem 0 .55rem;
            font-size: clamp(1.8rem, 3.4vw, 2.8rem);
            line-height: 1.12;
            letter-spacing: -.02em;
        }
        p {
            margin: 0;
            color: var(--muted);
            font-size: 1rem;
            line-height: 1.6;
            max-width: 62ch;
        }
        .cta {
            display: flex;
            flex-wrap: wrap;
            gap: .7rem;
            margin-top: 1.2rem;
        }
        .btn {
            text-decoration: none;
            border-radius: 11px;
            padding: .72rem 1rem;
            font-weight: 600;
            border: 1px solid transparent;
            transition: transform .12s ease, box-shadow .12s ease;
            display: inline-flex;
            align-items: center;
            gap: .45rem;
        }
        .btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 26px rgba(19, 33, 63, 0.14);
        }
        .btn-primary {
            background: var(--brand);
            border-color: var(--brand);
            color: var(--white);
        }
        .btn-primary:hover {
            background: var(--brand-dark);
            border-color: var(--brand-dark);
        }
        .btn-ghost {
            background: var(--white);
            border-color: var(--line);
            color: #254279;
        }
        .grid {
            margin-top: 1.2rem;
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: .7rem;
        }
        .tile {
            border: 1px solid var(--line);
            border-radius: 12px;
            background: var(--white);
            padding: .85rem;
        }
        .tile h2 {
            margin: 0 0 .25rem;
            font-size: .98rem;
        }
        .tile p {
            font-size: .9rem;
            margin: 0;
        }
        code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
            background: #f4f7ff;
            border: 1px solid #dce5f9;
            border-radius: 7px;
            padding: .1rem .35rem;
            color: #27437a;
            white-space: nowrap;
            word-break: normal;
        }
        @media (max-width: 780px) {
            .grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <main class="card">
        <div class="badge"><span class="dot"></span> Event Hub is running</div>
        <h1>Receive webhooks, stream events, and monitor everything live</h1>
        <p>
            Event Hub provides tokenized webhook endpoints and forwards incoming payloads to WebSocket clients.
            Sign in to create tokens, test integrations, and watch events in real time.
        </p>

        <div class="cta">
            <a class="btn btn-primary" href="/auth/login">Open Admin</a>
            <a class="btn btn-ghost" href="${githubUrl}" target="_blank" rel="noopener noreferrer">View Source on GitHub</a>
            <a class="btn btn-ghost" href="/health">Health JSON</a>
        </div>

        <section class="grid" aria-label="Quick links">
            <article class="tile">
                <h2>Admin UI</h2>
                <p>Manage webhook tokens and monitor live messages at <code>/admin</code>.</p>
            </article>
            <article class="tile">
                <h2>Webhook Endpoint</h2>
                <p>Publish events to <code>/hook/&lt;token&gt;</code> using HTTP POST.</p>
            </article>
            <article class="tile">
                <h2>WebSocket Stream</h2>
                <p>Consume live events from <code>/ws/&lt;token&gt;</code> clients.</p>
            </article>
        </section>
    </main>
</body>
</html>`);
});

// ── Webhook ingestion ────────────────────────────────────────────────────────

app.get('/hook/:token', (req, res) => {
    const { token } = req.params;
    if (!hasToken(token)) return res.sendStatus(404);
    res.json({
        ok: true,
        info: 'Webhook endpoint is active. Send HTTP POST requests with JSON payload to this URL.',
    });
});

app.post('/hook/:token', (req, res) => {
    const { token } = req.params;
    if (!hasToken(token)) return res.sendStatus(404);

    console.log(`[WEBHOOK] POST /hook/${token}`, JSON.stringify(req.body));
    addEvent(token, req.body);
    
    // Only broadcast to WebSocket clients if not a duplicate within 3-second window
    if (shouldBroadcast(token, req.body)) {
        const ts = Date.now();
        const payload = req.body;
        const msgData = {
            ts,
            payload,
            ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}),
        };
        const msg = JSON.stringify(msgData);
        const clients = getChannel(token);
        for (const ws of clients) {
            if (ws.readyState === ws.OPEN) ws.send(msg);
        }
    }
    
    res.sendStatus(200);
});

// ── Server + WebSocket ───────────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
    const match = req.url?.match(/^\/ws\/([^/?]+)/);
    const token = match?.[1];

    if (!token || !hasToken(token)) {
        ws.close(4004, 'Unknown token');
        return;
    }

    const channel = getChannel(token);
    channel.add(ws);
    ws.on('close', () => removeClient(token, ws));
});

async function start() {
    await initStore();
    await initOIDC();
    const port = process.env.PORT ?? 4000;
    server.listen(port, () => console.log(`Event hub running on :${port}`));
}

start().catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
});

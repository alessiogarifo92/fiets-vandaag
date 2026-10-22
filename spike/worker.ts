// T3 spike (#4): CPU cost of a web-push batch on Workers Free. Throwaway, never merged.
// A temporary cron sends N pushes per run (plan below) to the owner's own subscriptions; CPU per run
// is read afterwards from Workers Logs ($workers.cpuTimeMs, outcome exceededCpu).
// Storage is KV (the session token has no D1 access); one key per subscription, so devices never race.
// The run index comes from the clock (START_MS var), not a stored counter: KV reads can be ~60 s stale.
import { encryptNotification, vapidHeaders } from '@block65/webcrypto-web-push';
import type { PushSubscription } from '@block65/webcrypto-web-push';

interface Env {
  KV: KVNamespace;
  START_MS: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  VAPID_PRIVATE_KEY: string;
  SPIKE_KEY: string;
  ROUNDS: string;
}

// Interleaved so drift over time (cold isolates, push-service latency) spreads over every N.
// N = 0 is the baseline: the same KV reads and write, no push.
const NS = [0, 1, 2, 4, 8];
const ALLOWED_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /\.notify\.windows\.com$/,
];

type Sub = { endpoint: string; p256dh: string; auth: string };

async function sendBatch(env: Env, subs: Sub[], n: number, label: string): Promise<(number | string)[]> {
  const vapid = {
    subject: env.VAPID_SUBJECT,
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  // VAPID headers once per push-service origin per run (architecture §4 step 5).
  const authByOrigin = new Map<string, Promise<string>>();
  const encoder = new TextEncoder();
  const jobs: Promise<number | string>[] = [];
  for (let i = 0; i < n; i++) {
    const s = subs[i % subs.length];
    const sub: PushSubscription = {
      endpoint: s.endpoint,
      expirationTime: null,
      keys: { p256dh: s.p256dh, auth: s.auth },
    };
    jobs.push(
      (async () => {
        try {
          const origin = new URL(s.endpoint).origin;
          let auth = authByOrigin.get(origin);
          if (!auth) {
            auth = vapidHeaders(sub, vapid).then((h) => h.headers.authorization);
            authByOrigin.set(origin, auth);
          }
          // Payload shaped like the real one: verdict, score, reason codes, forecast time.
          const payload = JSON.stringify({
            v: 1,
            title: `Spike ${label} · push ${i + 1}/${n}`,
            verdict: 'bike',
            score: 7,
            reasons: ['tailwind', 'dry_window'],
            slot: 1,
            window: { start: 480, end: 525 },
            forecastAt: new Date().toISOString(),
          });
          const body = await encryptNotification(sub, encoder.encode(payload), { pad: false });
          const res = await fetch(s.endpoint, {
            method: 'POST',
            headers: {
              authorization: await auth,
              ttl: '600',
              urgency: 'high',
              topic: 'route-1',
              'content-encoding': 'aes128gcm',
              'content-type': 'application/octet-stream',
            },
            body,
          });
          return res.status;
        } catch (e) {
          return `err:${(e as Error).name}`;
        }
      })(),
    );
  }
  return Promise.all(jobs);
}

async function subKey(endpoint: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'sub:' + [...new Uint8Array(h).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadSubs(kv: KVNamespace): Promise<Sub[]> {
  const { keys } = await kv.list({ prefix: 'sub:' });
  const subs = await Promise.all(keys.map((k) => kv.get<Sub & { at: number }>(k.name, 'json')));
  return subs.filter((x): x is Sub & { at: number } => x !== null).sort((a, b) => a.at - b.at);
}

async function dropGone(kv: KVNamespace, subs: Sub[], statuses: (number | string)[]) {
  const gone = new Set<string>();
  statuses.forEach((st, i) => {
    if (st === 404 || st === 410) gone.add(subs[i % subs.length].endpoint);
  });
  await Promise.all([...gone].map(async (e) => kv.delete(await subKey(e))));
}

async function scheduled(env: Env, scheduledTime: number) {
  const rounds = Number(env.ROUNDS) || 4;
  const plan = Array.from({ length: rounds }, () => NS).flat();
  const start = Number(env.START_MS) || 0;
  const idx = start > 0 ? Math.round((scheduledTime - start) / 60_000) : -1;
  const subs = await loadSubs(env.KV);
  if (idx < 0 || idx >= plan.length || subs.length === 0) {
    console.log(JSON.stringify({ spike: 'idle', idx, subs: subs.length }));
    return;
  }
  const n = plan[idx];
  const statuses = n > 0 ? await sendBatch(env, subs, n, `#${idx}`) : [];
  await env.KV.put(
    `run:${String(idx).padStart(2, '0')}`,
    JSON.stringify({ n, subs: subs.length, statuses, at: Date.now() }),
  );
  await dropGone(env.KV, subs, statuses);
  console.log(JSON.stringify({ spike: 'run', idx, n, subs: subs.length, statuses }));
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const page = (env: Env, key: string) => `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiets spike</title>
<link rel="manifest" href="/manifest.webmanifest?k=${encodeURIComponent(key)}">
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-icon" href="/icon.svg">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 16px}button{font:inherit;padding:.75rem 1.25rem;margin:.25rem 0;width:100%}#log{white-space:pre-wrap;background:#f2f2f2;padding:.5rem;font-size:14px}</style>
</head><body>
<h1>Fiets Vandaag · spike T3</h1>
<p>Pagina temporanea per misurare il costo CPU dei push. Su iPhone: prima <b>Condividi → Aggiungi alla schermata Home</b>, poi apri l'app dalla Home e premi il pulsante.</p>
<button id="sub">1 · Attiva notifiche</button>
<button id="test">2 · Invia un push di prova</button>
<div id="log"></div>
<script>
const K=${JSON.stringify(key)},PUB=${JSON.stringify(env.VAPID_PUBLIC_KEY)};
const log=(m)=>{document.getElementById('log').textContent+=m+'\\n'};
const b64=(s)=>{s=s.replace(/-/g,'+').replace(/_/g,'/');const r=atob(s+'='.repeat((4-s.length%4)%4));return Uint8Array.from(r,c=>c.charCodeAt(0))};
log('standalone: '+(matchMedia('(display-mode: standalone)').matches||navigator.standalone===true)+' · push: '+('PushManager' in window));
document.getElementById('sub').onclick=async()=>{try{
  const reg=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;
  const perm=await Notification.requestPermission();log('permesso: '+perm);if(perm!=='granted')return;
  const s=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(PUB)});
  const r=await fetch('/subscribe?k='+encodeURIComponent(K),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(s)});
  log('registrazione: HTTP '+r.status+' '+await r.text());
}catch(e){log('errore: '+e)}};
document.getElementById('test').onclick=async()=>{const r=await fetch('/test?k='+encodeURIComponent(K),{method:'POST'});log('prova: '+await r.text())};
</script></body></html>`;

const SW = `self.addEventListener('push',(e)=>{let d={};try{d=e.data.json()}catch{}
e.waitUntil(self.registration.showNotification(d.title||'Fiets spike',{body:'Misura CPU T3 · '+(d.forecastAt||''),tag:'spike',renotify:false,silent:true}))});
self.addEventListener('notificationclick',(e)=>e.notification.close());`;

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" fill="#1f5f4a"/><text x="90" y="118" font-size="96" text-anchor="middle" fill="#fff" font-family="sans-serif">F</text></svg>`;

async function fetchHandler(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const key = url.searchParams.get('k') ?? '';
  if (url.pathname === '/sw.js')
    return new Response(SW, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' } });
  if (url.pathname === '/icon.svg')
    return new Response(ICON, { headers: { 'content-type': 'image/svg+xml' } });
  if (key !== env.SPIKE_KEY) return new Response('Not found', { status: 404 });
  if (url.pathname === '/manifest.webmanifest') {
    return json({
      name: 'Fiets spike',
      short_name: 'Fiets spike',
      start_url: `/?k=${encodeURIComponent(key)}`,
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#1f5f4a',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
  }
  if (url.pathname === '/' && req.method === 'GET')
    return new Response(page(env, key), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (url.pathname === '/subscribe' && req.method === 'POST') {
    const text = await req.text();
    if (text.length > 2048) return json({ error: 'too_large' }, 413);
    const s = JSON.parse(text) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const host = s.endpoint ? new URL(s.endpoint).hostname : '';
    if (
      !s.endpoint?.startsWith('https://') ||
      !ALLOWED_HOSTS.some((r) => r.test(host)) ||
      !s.keys?.p256dh ||
      !s.keys?.auth
    ) {
      return json({ error: 'invalid_subscription', host }, 400);
    }
    await env.KV.put(
      await subKey(s.endpoint),
      JSON.stringify({
        endpoint: s.endpoint,
        p256dh: s.keys.p256dh,
        auth: s.keys.auth,
        ua: (req.headers.get('user-agent') ?? '').slice(0, 120),
        at: Date.now(),
      }),
    );
    return json({ ok: true, host });
  }
  if (url.pathname === '/test' && req.method === 'POST') {
    const subs = await loadSubs(env.KV);
    if (subs.length === 0) return json({ error: 'no_subscriptions' }, 409);
    const statuses = await sendBatch(env, subs, subs.length, 'prova');
    console.log(JSON.stringify({ spike: 'test', subs: subs.length, statuses }));
    return json({ subs: subs.length, statuses });
  }
  if (url.pathname === '/status') {
    const subs = await loadSubs(env.KV);
    const runs = await env.KV.list({ prefix: 'run:' });
    return json({ subs: subs.map((x) => new URL(x.endpoint).hostname), runs: runs.keys.map((k) => k.name) });
  }
  return new Response('Not found', { status: 404 });
}

export default {
  fetch: fetchHandler,
  async scheduled(c: ScheduledController, env: Env) {
    await scheduled(env, c.scheduledTime);
  },
} satisfies ExportedHandler<Env>;

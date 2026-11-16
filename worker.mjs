import webPush from 'web-push';

const minute = 60_000;
const day = 24 * 60 * minute;

// Push subscriptions are credentials. Never log or return them.
function validSubscription(value) {
  try {
    const url = new URL(value.endpoint);
    const host = url.hostname;
    const supported = host === 'web.push.apple.com' ||
      host.endsWith('.web.push.apple.com') || host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com';
    return supported && url.protocol === 'https:' && !url.port &&
      !url.username && !url.password && url.href.length <= 2048 &&
      /^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh) &&
      /^[A-Za-z0-9_-]{22}$/.test(value.keys.auth);
  } catch {
    return false;
  }
}

async function authorize(request, secret) {
  if (!secret || secret.length < 32) return false;
  const candidate = request.headers.get('Authorization') || '';
  if (candidate.length > 512) return false;
  const encoder = new TextEncoder();
  const digest = value => crypto.subtle.digest('SHA-256', encoder.encode(value));
  const [actual, expected] = await Promise.all([digest(candidate), digest('Bearer ' + secret)]);
  return crypto.subtle.timingSafeEqual(actual, expected);
}

async function register(request, env) {
  if (!await authorize(request, env.PAIRING_KEY)) return new Response(null, {status: 401});
  const raw = await request.text();
  if (raw.length > 200_000) return new Response(null, {status: 413});
  let data;
  try { data = JSON.parse(raw); } catch { return new Response(null, {status: 400}); }
  const {subscription, jobs} = data ?? {};
  const now = Date.now();
  if (!validSubscription(subscription) || !Array.isArray(jobs) || jobs.length > 1000 ||
      jobs.some(job => !job || !/^[a-zA-Z0-9:_-]{1,150}$/.test(job.id) ||
        !Number.isSafeInteger(job.at) || job.at <= now || job.at > now + 370 * day ||
        typeof job.title !== 'string' || job.title.length > 100 ||
        typeof job.body !== 'string' || job.body.length > 180)) {
    return new Response(null, {status: 400});
  }
  const device = subscription.endpoint;
  // An atomic replacement keeps deleted reminders from being sent.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM jobs WHERE device = ? AND sent = 0').bind(device),
    env.DB.prepare(`
      INSERT OR IGNORE INTO jobs (device, id, due, subscription, title, body, available)
      SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.at'), ?,
        json_extract(value, '$.title'), json_extract(value, '$.body'), json_extract(value, '$.at')
      FROM json_each(?)
    `).bind(device, JSON.stringify(subscription), JSON.stringify(jobs)),
  ]);
  return Response.json({registered: jobs.length});
}

async function deliver(env, now) {
  const {results} = await env.DB.prepare(`
    UPDATE jobs SET available = ?, attempt = attempt + 1
    WHERE rowid IN (
      SELECT rowid FROM jobs WHERE sent = 0 AND available <= ? AND due >= ?
      ORDER BY available LIMIT 20
    ) RETURNING *
  `).bind(now + 5 * minute, now, now - 15 * minute).all();
  for (const job of results) {
    try {
      const subscription = JSON.parse(job.subscription);
      if (!validSubscription(subscription)) continue;
      const details = webPush.generateRequestDetails(subscription,
        JSON.stringify({title: job.title || 'DAYMO', body: job.body, tag: job.id}), {
          TTL: 300,
          vapidDetails: {
            subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY,
          },
        });
      const response = await fetch(details.endpoint, {
        method: 'POST', headers: details.headers, body: details.body,
        redirect: 'error', signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        await env.DB.prepare('UPDATE jobs SET sent = 1 WHERE device = ? AND id = ? AND available = ?')
          .bind(job.device, job.id, job.available).run();
      } else if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('DELETE FROM jobs WHERE device = ?').bind(job.device).run();
      }
    } catch {
      // The lease allows transient failures to retry while the reminder is fresh.
    }
  }
  await env.DB.prepare('DELETE FROM jobs WHERE due < ?').bind(now - day).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      const ready = Boolean(env.DB && env.PAIRING_KEY && env.VAPID_SUBJECT &&
        env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
      return Response.json({ready}, {status: ready ? 200 : 503});
    }
    if (request.headers.get('Origin') !== env.DAYMO_ORIGIN) return new Response(null, {status: 403});
    const headers = {
      'Access-Control-Allow-Origin': env.DAYMO_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    let response;
    if (url.pathname === '/api/push/public-key' && request.method === 'GET') {
      response = env.VAPID_PUBLIC_KEY ? Response.json({publicKey: env.VAPID_PUBLIC_KEY}) :
        new Response(null, {status: 503});
    } else if (url.pathname === '/api/push/register' && request.method === 'POST') {
      response = env.DB ? await register(request, env) : new Response(null, {status: 503});
    } else {
      response = new Response(null, {status: 404});
    }
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  },
  async scheduled(_event, env) {
    await deliver(env, Date.now());
  },
};

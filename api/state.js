// Vercel serverless function: cross-device state sync via Upstash Redis (REST).
// GET  /api/state?key=ID        -> { data: <saved blob or null> }
// PUT  /api/state  {key, data}  -> { ok: true }
//
// Env vars (set in Vercel). The Upstash/Vercel integration provides these automatically;
// this reads either naming so it works with the Vercel KV integration or a raw Upstash DB:
//   UPSTASH_REDIS_REST_URL  / KV_REST_API_URL
//   UPSTASH_REDIS_REST_TOKEN / KV_REST_API_TOKEN
// If they're missing, sync is simply disabled (the app keeps working from local storage).

const URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(cmd) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("Redis " + r.status);
  return r.json(); // { result: ... }
}

module.exports = async (req, res) => {
  if (!URL || !TOKEN) { res.status(501).json({ error: "sync not configured" }); return; }
  try {
    if (req.method === "GET") {
      const key = (req.query && req.query.key) || "";
      if (!key) { res.status(400).json({ error: "key required" }); return; }
      const j = await redis(["GET", "state:" + key]);
      let data = null;
      if (j && j.result) { try { data = JSON.parse(j.result); } catch (e) {} }
      res.status(200).json({ data });
      return;
    }
    if (req.method === "PUT" || req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body || "{}");
      const key = body && body.key;
      const data = body && body.data;
      if (!key) { res.status(400).json({ error: "key required" }); return; }
      await redis(["SET", "state:" + key, JSON.stringify(data || {})]);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};

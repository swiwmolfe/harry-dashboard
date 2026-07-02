// GET /api/export?key=ID  -> a clean, read-only HTML page of Harry's Sharon Buddies
// project notebook and the full mentor conversation. Defaults to the dashboard's SYNC_ID,
// so visiting /api/export with no params just works. Reads the same Upstash store as sync.

function pickEnv(suffix) {
  if (process.env[suffix]) return process.env[suffix];
  for (const k in process.env) {
    if (k.endsWith(suffix) && !k.includes("READ_ONLY") && process.env[k]) return process.env[k];
  }
  return undefined;
}
const URL = pickEnv("UPSTASH_REDIS_REST_URL") || pickEnv("KV_REST_API_URL");
const TOKEN = pickEnv("UPSTASH_REDIS_REST_TOKEN") || pickEnv("KV_REST_API_TOKEN");
const DEFAULT_KEY = "harry-2026-sww";

function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

module.exports = async (req, res) => {
  if (!URL || !TOKEN) { res.status(501).send("sync not configured"); return; }
  try {
    const key = (req.query && req.query.key) || DEFAULT_KEY;
    const r = await fetch(URL, {
      method: "POST",
      headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
      body: JSON.stringify(["GET", "state:" + key]),
    });
    const j = await r.json();
    let mem = {};
    if (j && j.result) { try { mem = JSON.parse(j.result); } catch (e) {} }

    const notebook = (mem.notes && mem.notes["sharon-notebook"]) || "";
    const chat = (mem.chats && mem.chats["sharon"]) || [];
    const updated = mem.updatedAt ? new Date(mem.updatedAt).toLocaleString() : "unknown";

    let chatHtml = "";
    chat.forEach(m => {
      const who = m.role === "assistant" ? "Mentor" : "Harry";
      chatHtml += "<div class='msg " + (m.role === "assistant" ? "bot" : "me") + "'><b>" + who + ":</b> " + esc(m.content) + "</div>";
    });

    const html = "<!doctype html><html><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>Sharon Buddies - export</title><style>" +
      "body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;color:#1f2937;line-height:1.5}" +
      "h1{color:#C8102E}h2{color:#1F3A5F;border-bottom:2px solid #eef2f7;padding-bottom:4px;margin-top:28px}" +
      ".nb{white-space:pre-wrap;background:#fbfdff;border:1px solid #e2e8f0;border-radius:10px;padding:14px}" +
      ".msg{padding:8px 12px;border-radius:10px;margin:8px 0;white-space:pre-wrap}" +
      ".msg.me{background:#1F3A5F;color:#fff}.msg.bot{background:#eef4fb}" +
      ".meta{color:#94a3b8;font-size:13px}.empty{color:#94a3b8}" +
      "</style></head><body>" +
      "<h1>Sharon Buddies - Harry's work</h1><div class='meta'>Last saved: " + esc(updated) + "</div>" +
      "<h2>Project notebook</h2>" + (notebook ? ("<div class='nb'>" + esc(notebook) + "</div>") : "<div class='empty'>No notebook entries yet.</div>") +
      "<h2>Mentor conversation (" + chat.length + " messages)</h2>" + (chatHtml || "<div class='empty'>No mentor conversation yet.</div>") +
      "</body></html>";

    res.setHeader("content-type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (e) {
    res.status(500).send("error: " + esc((e && e.message) || e));
  }
};

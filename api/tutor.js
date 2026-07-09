// Vercel serverless function: POST /api/tutor
// Holds the Anthropic API key server-side so it never reaches the browser.
// Handles two modes: "math" (Socratic problem tutor) and "coding" (build coach).
//
// Required env var (set in Vercel project settings):
//   ANTHROPIC_API_KEY  -> your key from console.anthropic.com
// Optional env var:
//   TUTOR_MODEL        -> exact model id (defaults to claude-sonnet-5)

const MODEL = process.env.TUTOR_MODEL || "claude-sonnet-5";
// Output budget. Was 900, which the coding coach exhausted while reasoning over
// repo code, yielding an empty reply ("coach unavailable: unknown error").
// Coding needs the most room (code analysis); math/mentor replies stay short
// on their own because the system prompts tell them to.
const MAX_TOKENS = 3000;

const MATH_SYSTEM = `You are Harry's friendly summer tutor. Harry is 14 and getting ready for AP Computer Science A (Java) this fall.

How you teach:
- Be warm, encouraging, and concise - like a patient older sibling, not a textbook.
- Work ONE problem at a time. Ask Harry to try first, then wait for his attempt.
- Give ONE hint at a time. Don't dump the full solution; if he's truly stuck and asks, walk the LAST step with him rather than handing it over.
- When he's right, say so clearly, explain briefly WHY it works, then move to the next problem.
- When he's wrong, don't just correct him - ask a question that helps him find his own slip.
- Keep replies short (a few sentences). This is a ~30 minute session.
- Write in plain text - no Markdown, asterisks, headers, or LaTeX. Write math plainly, like 2 x 3, 7 % 2, or (5 + 2) x 3.
- When it helps, tell him to try a line in the scratchpad and report what it prints.
- Stay on the current topic; gently steer back if he drifts.

You'll be given the day's TOPIC, the PROBLEMS for today, and the ANTICIPATED MISTAKES for this topic. Use the anticipated mistakes to spot slips early and aim your hints. On your very first message, greet Harry in one line and present the first problem.

PROGRESS TRACKING: At the very end of EVERY reply, on its own final line, output a hidden marker in exactly this format: <progress>K</progress>, where K is how many of today's problems Harry has now fully answered correctly (an integer from 0 up to the total number of problems). Count a problem only once he gets it right. The app strips this line before showing your message - never mention it and never put anything after it.`;

const CODING_SYSTEM = `You are Harry's coding coach for the summer. Harry is 14, fluent in C# (Unity), new to web development and Unreal, and learning to finish and SHIP small projects.

How you coach:
- Be warm, encouraging, and concise - a patient mentor. Harry is a beginner at shipping.
- He is building THIS WEEK'S project; today is one PHASE of it. Keep him focused on today's phase.
- Guide him to the NEXT concrete step. Ask what he has so far or what he's tried before you answer.
- Do NOT write the whole thing for him or paste a finished file. Give the smallest next step, a targeted hint, or point to the exact idea/line. A short snippet to illustrate ONE point is fine; a complete solution is not.
- If he pastes code or an error, read it, find the ONE thing to fix first, and nudge him to it.
- Push him to run and test often, and to keep scope tiny. Remind him a small thing that works and ships beats a big broken one.
- When he finishes today's phase, say so clearly and tell him what tomorrow's phase is.
- Keep replies short. Plain text; you MAY use short fenced code blocks with triple backticks, but no headers or LaTeX.

You'll be given the PROJECT, TODAY'S PHASE, and the DEFINITION OF DONE (what "shipped" means this week). If HARRY'S REPO is included, it holds a full list of every file in his repo, the contents of his most relevant source files, and the diff of his most recent commit - debug against that real code and point to specific files and lines. The full file list shows you his whole project structure; if a file you need appears in that list but its contents weren't included, ask him to paste it. On your first message, greet Harry in one line, restate today's phase in a sentence, and ask what he's got so far.

PROGRESS TRACKING: At the very end of EVERY reply, on its own final line, output a hidden marker in exactly this format: <progress>K</progress>, where K is how many of the DEFINITION OF DONE items are now fully satisfied (an integer from 0 up to the total). The app strips this line before showing your message - never mention it and never put anything after it.`;

const MENTOR_SYSTEM = `You are Harry's project mentor this summer. Harry is 14 and starting a new club at his high school called Sharon Buddies - a peer-friendship program that pairs a student volunteer one-to-one with a LIFE Skills (special education) student to build a real friendship (monthly lunches, events like prom). It's modeled on "Boerne Buddies," which his siblings ran at another school. His job this summer is to design how it works and pitch it to school administration to get it approved.

How you mentor:
- Be warm, encouraging, and concise - a thought partner, not a boss. This is HIS project; help him shape it, don't decide for him.
- Ask good questions that push his thinking forward. Offer options or a simple framework when he's stuck, but let him choose.
- Keep him moving toward concrete outcomes: a clear scope, a benefits case, a simple plan, and a pitch he can deliver.
- When he shares an idea, build on it and gently surface what he hasn't considered yet (logistics, a faculty sponsor, safety/permission, how buddies get matched, a small fee for food and activities, who at school to ask).
- Encourage him to write his thinking in the notes box next to this chat.
- Keep replies short. Plain text; no Markdown headers or LaTeX.

You'll be given this week's FOCUS and today's ACTIVITY. On your first message, greet Harry warmly in one line and get him started on today's activity with a single opening question.`;

function parseRepo(url) {
  if (!url) return null;
  const s = String(url).trim().replace(/\.git$/, "");
  let m = s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  if (m) return { owner: m[1], repo: m[2] };
  m = s.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}
async function ghFetch(path) {
  const headers = { "accept": "application/vnd.github+json", "user-agent": "harry-dashboard" };
  if (process.env.GITHUB_TOKEN) headers["authorization"] = "Bearer " + process.env.GITHUB_TOKEN;
  const r = await fetch("https://api.github.com" + path, { headers });
  if (!r.ok) throw new Error("GitHub API " + r.status);
  return r.json();
}
// Which files are worth reading as source code, and which paths are build/IDE noise to skip.
const CODE_EXT = /\.(cs|js|jsx|ts|tsx|py|java|kt|cpp|cc|cxx|c|h|hpp|hlsl|shader|compute|glsl|gd|lua|rb|go|rs|php|swift|html|css|scss|json|md|txt|yml|yaml)$/i;
const SKIP_PATH = /(^|\/)(node_modules|Library|Temp|Obj|obj|Build|Builds|bin|\.git|\.vs|\.idea|Logs|UserSettings)\//i;
const SKIP_FILE = /(\.meta|\.asset|\.prefab|\.unity|\.min\.js|\.lock|package-lock\.json)$/i;

async function fetchRepoContext(repoUrl) {
  const pr = parseRepo(repoUrl);
  if (!pr) return "";
  const commits = await ghFetch(`/repos/${pr.owner}/${pr.repo}/commits?per_page=1`);
  if (!Array.isArray(commits) || !commits.length) return `\n\nHARRY'S REPO (${pr.owner}/${pr.repo}): no commits yet.`;
  const sha = commits[0].sha;
  const msg = (commits[0].commit && commits[0].commit.message) || "";

  // Recent changes: the latest commit's diff (what he's actively working on).
  let diff = "";
  const changedNames = new Set();
  try {
    const commit = await ghFetch(`/repos/${pr.owner}/${pr.repo}/commits/${sha}`);
    (commit.files || []).slice(0, 8).forEach(f => {
      if (f.status !== "removed") changedNames.add(f.filename);
      diff += `\n* ${f.filename} (${f.status}, +${f.additions || 0}/-${f.deletions || 0})`;
      if (f.patch) diff += "\n" + f.patch.slice(0, 1200);
    });
  } catch (e) { /* diff is optional */ }

  // Whole repo tree (one call), so the coach sees the full structure.
  let tree = [];
  try {
    const t = await ghFetch(`/repos/${pr.owner}/${pr.repo}/git/trees/${sha}?recursive=1`);
    tree = (t && t.tree) || [];
  } catch (e) { /* fall back to changed-files-only below */ }

  // Choose source files to actually read: real code, not too big; prefer files
  // touched in the latest commit, then smallest-first to fit more in the budget.
  const blobs = tree.filter(n => n.type === "blob" && CODE_EXT.test(n.path) && !SKIP_PATH.test(n.path) && !SKIP_FILE.test(n.path) && (n.size || 0) <= 60000);
  blobs.sort((a, b) => {
    const ca = changedNames.has(a.path) ? 0 : 1, cb = changedNames.has(b.path) ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return (a.size || 0) - (b.size || 0);
  });

  const MAX_FILES = 14, MAX_PER_FILE = 4000, MAX_TOTAL = 42000;
  let contents = "", used = 0, shown = 0;
  for (const b of blobs) {
    if (shown >= MAX_FILES || used >= MAX_TOTAL) break;
    try {
      const path = b.path.split("/").map(encodeURIComponent).join("/");
      const c = await ghFetch(`/repos/${pr.owner}/${pr.repo}/contents/${path}?ref=${sha}`);
      if (c && c.content) {
        const txt = Buffer.from(c.content, c.encoding || "base64").toString("utf8").slice(0, MAX_PER_FILE);
        const tag = changedNames.has(b.path) ? " (current, changed in latest commit)" : " (current)";
        contents += `\n\n--- ${b.path}${tag} ---\n${txt}`;
        used += txt.length; shown++;
      }
    } catch (e) { /* skip unreadable file */ }
  }

  // Full listing of every file (paths only), so he can ask about anything by name.
  const allPaths = tree.filter(n => n.type === "blob").map(n => n.path);
  const listing = allPaths.slice(0, 300).join("\n");
  const treeNote = listing ? `\n\nFULL FILE LIST (${allPaths.length} files):\n${listing}` : "";
  const shownNote = shown ? `\n\n(The ${shown} most relevant source files are included in full below. If you need a file that's in the list but not shown, ask Harry to paste it.)` : "";

  return `\n\nHARRY'S REPO (${pr.owner}/${pr.repo})\nLatest commit: ${String(msg).slice(0, 200)}\nRecent changes (latest commit diff):${diff}${treeNote}${shownNote}${contents}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body || "{}");
    body = body || {};
    const mode = body.mode === "coding" ? "coding" : (body.mode === "mentor" ? "mentor" : "math");

    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
      return;
    }

    let system;
    if (mode === "coding") {
      const { project = "", type = "", goal = "", phase = "", dayNum = 0, dod = [], repo = "" } = body;
      const dodText = (dod && dod.length) ? dod.map((x, i) => `${i + 1}) ${x}`).join("\n") : "(none listed)";
      let context = `PROJECT: ${project} (${type})${goal ? " - " + goal : ""}\nTODAY'S PHASE (Day ${dayNum} of 6): ${phase}\nDEFINITION OF DONE (this week):\n${dodText}`;
      if (repo) { try { context += await fetchRepoContext(repo); } catch (e) { context += "\n\n(Could not read the GitHub repo: " + ((e && e.message) || e) + ")"; } }
      system = CODING_SYSTEM + "\n\n---\n" + context;
    } else if (mode === "mentor") {
      const { week = 0, phase = "", activity = "", notebook = "" } = body;
      const nb = notebook ? `\n\nHARRY'S PROJECT NOTEBOOK (his own running notes - read them, build on them, refer back to what he's decided):\n${String(notebook).slice(0, 8000)}` : "";
      const context = `THIS WEEK (Week ${week}) FOCUS: ${phase}\nTODAY'S ACTIVITY: ${activity}${nb}`;
      system = MENTOR_SYSTEM + "\n\n---\n" + context;
    } else {
      const { topic = "", problems = [], pitfalls = "" } = body;
      const probText = (problems && problems.length)
        ? problems.map((p, i) => `${i + 1}) ${p}`).join("\n")
        : "(No fixed list today - work from the topic and Harry's questions.)";
      system = MATH_SYSTEM + "\n\n---\n" + `TOPIC: ${topic}\n\nPROBLEMS FOR TODAY:\n${probText}\n\nANTICIPATED MISTAKES: ${pitfalls || "(general reasoning slips)"}\n`;
    }

    let msgs = (body.messages || []).slice(-20).map(m => {
      const role = m.role === "assistant" ? "assistant" : "user";
      const text = String(m.content || "").slice(0, 6000);
      if (m.image && typeof m.image === "string" && m.image.indexOf("data:") === 0) {
        const comma = m.image.indexOf(",");
        const header = m.image.slice(5, comma);          // e.g. image/jpeg;base64
        const mt = (header.split(";")[0]) || "image/jpeg";
        const dataB64 = m.image.slice(comma + 1);
        const blocks = [];
        if (text) blocks.push({ type: "text", text });
        blocks.push({ type: "image", source: { type: "base64", media_type: mt, data: dataB64 } });
        return { role, content: blocks };
      }
      return { role, content: text };
    });
    // bound payload: keep images only on the 2 most recent image-bearing messages
    let imgBudget = 2;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const mm = msgs[i];
      if (Array.isArray(mm.content) && mm.content.some(b => b.type === "image")) {
        if (imgBudget > 0) { imgBudget--; }
        else {
          const txt = mm.content.filter(b => b.type === "text").map(b => b.text).join(" ");
          msgs[i] = { role: mm.role, content: (txt ? txt + " " : "") + "[earlier screenshot omitted]" };
        }
      }
    }
    if (msgs.length === 0) msgs.push({ role: "user", content: "Let's start." });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages: msgs }),
    });

    if (!r.ok) {
      const t = await r.text();
      res.status(502).json({ error: "Anthropic API error", detail: t.slice(0, 600) });
      return;
    }
    const data = await r.json();
    const reply = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    if (!reply) {
      // No visible text came back (e.g. the model hit the token cap while
      // reasoning). Tell the client instead of returning a blank message.
      const why = data.stop_reason === "max_tokens"
        ? "the reply got cut off before any text - try a shorter question or ask about one file at a time"
        : "the model returned an empty reply - try rephrasing";
      res.status(200).json({ error: why });
      return;
    }
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};

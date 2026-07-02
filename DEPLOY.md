# Harry's Dashboard - deploy guide

This folder is a small Vercel project: a static dashboard (`index.html`) plus one
serverless function (`api/tutor.js`) that talks to the Claude API for the math tutor.

## What you need
- A free Vercel account (vercel.com)
- An Anthropic API key (console.anthropic.com -> API Keys)

## Deploy (easiest path)
1. Push this `Harry_Dashboard_App` folder to a GitHub repo, **or** use the Vercel CLI
   (`npm i -g vercel`, then run `vercel` inside this folder).
2. In Vercel, import the project. It will auto-detect `index.html` (served at `/`) and
   the function at `/api/tutor`.
3. In the project's **Settings -> Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your key  (required)
   - `TUTOR_MODEL` = your preferred Sonnet model id  (optional; defaults to `claude-sonnet-5` in `api/tutor.js`)
   - `GITHUB_TOKEN` = a read-only GitHub token  (optional). The coach reads Harry's **public** repos with no token; adding one raises the GitHub API rate limit from 60/hr to 5000/hr. A fine-grained token with public read access is plenty.
4. Deploy. Open the URL. On the **Math** card, "Work through today with your tutor" now runs.

## Notes
- The tutor only works once deployed (or on `vercel dev` locally). Opening `index.html`
  straight from disk will show the dashboard, but the tutor call will fail gracefully
  because there's no `/api/tutor` server.
- **Set the start date:** near the top of `index.html`, change
  `const START_DATE = "2026-07-06";` to the real Monday Harry begins.
- **Model:** `api/tutor.js` uses Sonnet via `TUTOR_MODEL` (or a default constant). If the
  default id is out of date, set `TUTOR_MODEL` to the exact current Sonnet model string.
- **Cost:** one learner doing ~30 min/day on Sonnet is a few dollars for the summer. You
  can add a spend limit in the Anthropic console.
- **Privacy:** the key lives only in Vercel's env vars, never in the browser or the repo.

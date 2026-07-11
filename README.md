# ⚡ WikiRace Arena

**Speedrun the encyclopedia.** Race from one Wikipedia article to another using only the links inside articles — against a ghost, against your friends live, or against a friend's recorded run baked into a share link.

Built solo in 12 hours for **JecHacks 2026**.

## 🏁 How to play

1. Pick a matchup — a curated absurd pair (*Pizza → Black hole*), full random chaos, or your own custom articles.
2. You spawn on the start article. Reach the target clicking **only in-article links**. No search bar. No back button. No mercy.
3. Fewer clicks + faster time = bragging rights.

## 🎮 Three ways to race

| Mode | What it is |
|---|---|
| 👻 **Ghost race** | Race a bot pacer with 3 difficulties: Chill Carl, Sweaty Sam, GOAT-9000 |
| 🔗 **Challenge link** | Finish a run → get a link with your *entire run encoded inside it*. Friends open it and race your live ghost — they see which article you were reading at every moment. Zero backend involved. |
| ⚔️ **Live rooms** | Create a room, share the invite link, up to 8 friends race the same matchup simultaneously with a synced countdown and live progress bars |

## 🛠️ Tech

- **Next.js 16 + React 19 + Tailwind 4**, TypeScript
- **Wikipedia REST API fetched directly from the browser** — article HTML is sanitized client-side (scripts stripped, links rewritten and intercepted, non-article namespaces disabled)
- **Challenge links are 100% serverless state**: the run (path + timestamps) is compressed into the URL fragment — no database row anywhere
- **Live rooms** run on Vercel serverless functions + Upstash Redis with light polling — no websocket server to babysit
- Win detection handles Wikipedia redirects by comparing canonical titles

## 🚀 Run locally

```bash
npm install
npm run dev
```

That's it for solo + challenge modes. For live rooms in production, set `KV_REST_API_URL` / `KV_REST_API_TOKEN` (Upstash Redis via Vercel Marketplace); in local dev rooms use an in-memory store automatically.

## 📋 Judging notes

- **Creativity**: the classic WikiRace party game, but with ghosts, URL-encoded replay racing, and live multiplayer
- **Technical excellence**: client-side HTML sanitization of live Wikipedia content, redirect-aware win detection, replay encoding, synced multiplayer over stateless functions
- **Real-world impact**: it's a game you genuinely learn from — every race is a forced tour through human knowledge (and the fastest players are the best lateral thinkers)
- **Working & testable**: deployed, no account needed, works in any browser

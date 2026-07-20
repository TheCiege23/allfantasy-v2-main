# Player value reference docs

Drop player-value / ranking reference docs in this folder. They are read at runtime
by `lib/player-values/playerValuesLoader.ts` and injected into AI prompts as grounding.

Accepted extensions: `.md`, `.txt`, `.csv`, `.json`. This `README.md` is explicitly
skipped by the loader so it is never injected into a prompt as if it were data.

Sport and format are inferred from the **filename**, so name files accordingly:

- sport: `nba`, `mlb`, `nhl`, `ncaab`/`cbb`, `ncaaf`/`cfb`, `soccer`/`epl`/`mls` — otherwise `NFL`
- format: `dynasty`, `bestball`/`best-ball`, `redraft` — otherwise `general`

e.g. `2026-dynasty-superflex.md` → sport `NFL`, format `dynasty`.

## These files MUST be committed

This is the part that has bitten this repo before. Every layer swallows failure —
the loader returns `[]`, `getPlayerValuesContext()` returns `''`, and
`/api/player-values` returns `[]` — so a missing or empty folder is
indistinguishable from "no docs." It fails **silently and only in production**.

Four conditions must all hold, or docs load in dev and read empty on Vercel:

1. **Under `data/`** — required for condition 4.
2. **Committed to git** — files ignored by `.gitignore` never reach Vercel.
   These docs were gitignored from the feature's first commit (`948b86a0b`,
   2026-04-04), which is why this grounding never once loaded in production.
3. **Survives `.vercelignore`** — it has a blanket `*.txt` rule; a `!data/**/*.txt`
   negation keeps `.txt` docs in the deployment. Check before adding new extensions.
4. **Covered by `outputFileTracingIncludes`** in `next.config.js` — currently
   `"/api/**": ["./data/**"]`. This only traces files into routes under `app/api/**`.
   If a **server** component, server action, or non-`/api` route ever calls
   `getPlayerValuesContext()`, add a tracing key for it or it will read empty.

## Consumers

`getPlayerValuesContext()` grounds these AI paths — all currently under `app/api/**`:

- `app/api/dynasty-trade-analyzer/route.ts`
- `app/api/instant/trade/route.ts`
- `app/api/trade-evaluator/route.ts`
- `app/api/waiver-ai/grok/route.ts`
- `lib/ai-coach/AICoachService.ts` (via `/api/ai/coaching/plan`, `/api/coach/advice`, `/api/legacy/[...path]`)
- `lib/global-fantasy-intelligence/GlobalFantasyIntelligenceEngine.ts` (via `/api/global-fantasy-intelligence`)
- `lib/trade-value-console/runTradeConsoleAnalysis.ts` (via `/api/trade-value/analyze`)

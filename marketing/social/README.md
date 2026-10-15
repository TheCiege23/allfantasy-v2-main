# AllFantasy social posts

Code-rendered social graphics, so posting does not depend on image-generation credits.
Every image is 1080×1350 (4:5): Instagram, Facebook, LinkedIn, TikTok photo mode.

```bash
node marketing/social/render-daily.mjs marketing/social/posts/2026-10-15.json
node marketing/social/render-carousels.mjs
```

Output lands in `marketing/social/out/` (git-ignored). Each daily run also writes `CAPTIONS.md`
beside the PNGs. Needs Playwright + Chromium (preinstalled in Claude Code cloud sessions) and
network access to Google Fonts (Anton + Inter).

## Daily playbook: 5 posts

A day's spec is one JSON file in `posts/`, named for the date. `posts/` is also the history:
read the last 7 days of it before writing, so topics and hooks are not repeated.

| slot (ET) | post | source |
|---|---|---|
| 9 AM | Site update, **only if something big enough shipped** | `git log origin/main --since="25 hours ago" --no-merges` |
| 11 AM | Sport of the moment (whatever is starting, peaking, or ending) | web search for dates |
| 2 PM | Second site update, or a fantasy tip | either |
| 5 PM | A different sport from 11 AM | web search |
| 8 PM | Engagement: poll, hot take, "tag your commish" | none needed |

**"Big enough" means a user would notice it.** Feature commits (`feat(...)`) that change what a
manager or commissioner can do. Not fixes, refactors, tests, infra, copy tweaks or anything
behind a flag. Read the full commit body before describing it. If nothing qualifies, use a
fantasy tip or a feature that already exists. Never make an update sound bigger than it is.

Sports AllFantasy can **create** leagues for: NFL, NBA, NHL, MLB, NCAAF, NCAAB, Soccer
(`lib/sport-scope.ts`). **Imports** are football only today (plus ESPN/Fantrax MLB): read
`lib/league-import/provider-ui-config.ts` before claiming an import. Yahoo is not live.

## Fact rules

- **Dates and schedules: verify with a web search the same day.** Note when a date-based hook
  (a "5 days until" countdown) goes stale if it is posted late.
- **No claims about real players' injuries, trades or stats** unless verified that day. Mock UI
  uses invented teams ("Dynasty Dragons") and generic slots ("your RB1"), labelled "Example".
- **No gambling or DFS language.** The site is 100% season-long fantasy. No odds, no "lock",
  no "bet".
- **Pricing:** creating, importing and running leagues is free. Free accounts get 2 Chimmy
  questions a day (`lib/tokens/freeChimmyQuestions.ts`). Check before quoting a number.
- **Do not use `public/{Football,Basketball,Hockey,Baseball,Soccer}.png` in public posts.**
  They carry DraftKings, FanDuel, NBA.com, NHL.com and Premier League branding. The
  `public/league-type-*.png` art is fine.

## Spec format

```json
{ "slot": "9 AM · Site update", "kind": "shipped", "accent": "green", "pill": "Just shipped",
  "title": "Free-agent day?\n[Add him now.]", "lead": "...", "bullets": [["Main", "sub"]],
  "cta": "LINK IN BIO →", "caption": "..." }
```

- `kind`: `shipped` (✓ bullets), `list` (numbered bullets), `hero`, `poll` (`options: [[emoji, text]]`)
- `accent`: `cyan` (brand), `green` (shipped), `orange` (NBA), `ice` (NHL), `red` (MLB),
  `gold` (college), `purple` (engagement), or any hex
- `title`: `\n` breaks a line, `[brackets]` color words with the accent
- `big`: a huge number or a single emoji above the title; `art`: a `public/` image as background

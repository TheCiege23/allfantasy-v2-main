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

## Accounts

| platform | handle | caption style |
|---|---|---|
| Instagram | [@allfantasyos](https://www.instagram.com/allfantasyos/) | full caption, 5–8 hashtags, "link in bio" |
| TikTok (photo mode) | @allfantasyos | 1–3 punchy lines, 3–4 hashtags, "link in bio" |
| Facebook | [AllFantasy page](https://www.facebook.com/profile.php?id=61584227235673) | conversational, a clickable `https://allfantasy.ai` link, few or no hashtags |
| X | [@AFSportsApp](https://x.com/AFSportsApp) | **280 max** (the renderer warns; emoji count double), `allfantasy.ai`, 1–2 hashtags |
| YouTube | [@AllFantasyHQ](https://www.youtube.com/@AllFantasyHQ) | Community-tab post: lead with a question; polls fit natively |

Every post's `caption` is an object with one entry per platform (`instagram`, `tiktok`,
`facebook`, `x`, `youtube`). The graphics stay the same everywhere and carry the website, not a
handle, because the handles differ by platform. YouTube Shorts need video, which this generator
does not make, so YouTube gets Community posts.

## Publishing through Buffer (via Zapier)

Images are hosted in the public repo `TheCiege23/allfantasy-social` at
`posts/<YYYY-MM-DD>/post-N.png`; Buffer fetches them from
`https://raw.githubusercontent.com/TheCiege23/allfantasy-social/main/posts/<date>/post-N.png`.

Each post goes to Buffer as a **scheduled draft** (`method: schedule_draft`): it sits at its
time slot and publishes only after the owner approves it in Buffer. Never use `share_now`,
`queue` or `schedule`; those publish without approval.

| platform | Buffer channel id | extra fields |
|---|---|---|
| Instagram | `6ad0ce6d778b240e2f18515d` | `ig_post_type: post` |
| TikTok | `6ad0cea2778b240e2f185ccd` | `image_alttext` |
| Facebook | `6ad0cee5778b240e2f186784` | `image_alttext` |
| X | `6ad0cf0f778b240e2f186b95` | `image_alttext` |

Organization `655cbba41f7fd95c8c81df0e`. Zapier connection "Buffer" (numeric id `66868387`).
All four take `attachment: image`, `image: <raw url>`, `scheduled_at` (UTC ISO),
`scheduling_type: direct` and `text`, nested under `dynamic_properties`.

⚠ **Cost:** every draft is one Zapier task, so a full day is 5 posts × 4 platforms = 20 tasks
(~600 a month). Check the plan has room before a run; Zapier stops mid-batch when it runs out.

## Brown Pig LLC: one post a day

> ⏸ **PAUSED (owner's call, 2026-10-15): the daily run makes AllFantasy posts only.** Keep this
> section for when Brown Pig posts resume; do not make them until the owner says so.

Alongside the 5 AllFantasy posts, the daily run makes **one** post for a Brown Pig LLC
product, in `posts/brownpig/<YYYY-MM-DD>.json` with `"date": "brownpig-<YYYY-MM-DD>"`,
`"theme": "brownpig"` and `"title": "Brown Pig LLC posts"`.

**Rotate** through the products in this order, picking the one posted least recently (read
`posts/brownpig/*.json`): StoryVault, PetPass, Parent Playbook, Gooby, SideQuest, Cafe Con
Chimmy, and every seventh day a Brown Pig LLC family post.

| product | accent | site (unverified: no fetch from the cloud box reaches it) | flavor |
|---|---|---|---|
| StoryVault | `amber` | storyvault.chimaura.com | most heart, never salesy |
| PetPass | `teal` | petpass.chimaura.com | warmest, everyday-relatable |
| Parent Playbook | `field` | playbook.chimaura.com | dad-to-dad, learning together |
| Gooby | `dog` | gogooby.com | playful |
| SideQuest | `quest` | sidequest.chimaura.com | builder, competitive |
| Cafe Con Chimmy | `coffee` | cafeconchimmy.com | playful, family, food-love |
| Brown Pig LLC | `pig` | (link in bio) | the family / the why |

**Voice:** load the `brown-pig-brand-voice` skill and pass its quick test before shipping.
Rotate its pillars (Workshop, Autopsy, Playbook, Why, Scoreboard) so posts don't repeat a shape.

**Facts:** describe a product only with its one-liner from `lib/i18n/landing-copy.ts`
(`network.cards`) or what the owner has told you. Never invent features, user counts, prices or
launch status. Personal story lines come only from the brand-voice skill. Never make up a
number: ask a question instead of quoting a statistic. Handles are not known yet, so `accounts`
uses "(your handle)" placeholders until the owner provides them.

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
  "cta": "LINK IN BIO →",
  "caption": { "instagram": "...", "tiktok": "...", "facebook": "...", "x": "...", "youtube": "..." } }
```

- `kind`: `shipped` (✓ bullets), `list` (numbered bullets), `hero`, `poll` (`options: [[emoji, text]]`)
- `accent`: `cyan` (brand), `green` (shipped), `orange` (NBA), `ice` (NHL), `red` (MLB),
  `gold` (college), `purple` (engagement), or any hex
- `title`: `\n` breaks a line, `[brackets]` color words with the accent
- `big`: a huge number or a single emoji above the title; `art`: a `public/` image as background

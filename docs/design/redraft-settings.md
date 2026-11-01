# Redraft League Settings — "how your season works" (wave-2 A5)

The League Settings page of a **native redraft** league on `/league/[id]`, restyled on the redraft identity
tokens ([`redraft-identity.md`](./redraft-identity.md)). Approved mock: `Settings.dc.html` (with
`Main.dc.html` for the overall language). Every other league type renders the page unchanged.

## Which surface this is

The tab inventory lists `LeagueSettingsTab.tsx` for the `settings` tab; that is no longer what a native
workspace renders. `LeagueShell` renders **`LeagueSettingsHomeContainer`** for `nativeWorkspace && activeTab
=== 'settings'` (and the header's "League settings" button lands there too), which draws one of:

| viewer | width | component |
|---|---|---|
| commissioner | ≥1024px | `CommissionerCenter` — section nav, the open section's existing editor, tools, managers |
| commissioner | <1024px | `LeagueSettingsHome` — the list; a row opens its editor as a sub-page |
| member | any | `LeagueSettingsHome`, read-only |

`LeagueSettingsModal.tsx` (the inventory's "modal") is not reached from a native workspace; it was left
alone, which also keeps this batch off `league-admin.css` (A3).

## What changed

| | default page | redraft |
|---|---|---|
| accent (buttons, links, focus, copy chip, setup card) | /core teal — **even inside a redraft workspace**, because `.lsh-root` is a second `.af-core` that re-declares /core's palette | the sport accent: `--accent` re-pointed to `--rd-*` on the settings root |
| sections | grey uppercase labels over flat lists | a season timeline: rail + dot per season section, an eyebrow saying *when* it acts, an 18px title, rounded cards |
| current season section | — | accent border, `--rd-surface-elev` card, accent eyebrow, ringed dot |
| values | muted grey | `--rd-accent-text`, bold, tabular numbers (pending values stay `--faint`) |
| league name | small grey subtitle | mono eyebrow in the sport colour |
| Commissioner center | — | active nav item gets the rail mark; season nav items get done/now/next dots; the pane card is lifted and its label reads "Rules · Weeks 1–14 · trade deadline Wk 12" |

Mechanics: `lib/league-media/redraftSettings.ts` → `buildRedraftSettingsView(league, phase, language)`
returns `null` (default page) unless `resolveRedraftIdentity` themes the league — the same call that stamps
the workspace root. The container passes the view to both components, which then render
`data-rd-settings`, `data-rd-sport`, `data-rd-stage` and the `.lsh-rd-when` / `.cc-rd-when` eyebrows. With no
view they render byte-for-byte what they did before (asserted in
`__tests__/league-settings/redraft-settings-render.test.tsx`). No testid was changed, no save path touched,
no route added.

`components/league-settings/home/redraft-settings.css`: every selector needs **both**
`.nl-workspace[data-format=redraft]` and `.lsh-root[data-rd-settings]`; tokens only; one top-level `@media`;
nothing under 11px (`__tests__/league-media/redraftSettingsCss.test.ts`, with positive controls).

### Eyebrows are data, not decoration

| section | eyebrow | source |
|---|---|---|
| General, Roster & scoring | Before the draft | — |
| Draft | Draft day | — |
| Waivers & trades | Weeks 1–{playoffs − 1} · trade deadline Wk {n} | `readChosenPlayoffStartWeek`, `League.tradeDeadlineWeek` |
| Playoffs | From Week {n} | `readChosenPlayoffStartWeek` |
| Members / Commissioner tools | All year / Commissioner only | — |

- A week appears only when the league chose it — **never** the sport default (`resolvePlayoffStartWeek`'s
  fallback). No chosen start → "All season" / "Season's end".
- A deadline at or after the playoff start is dropped (it is no deadline in practice).
- ⚠ `League.playoffStartWeek` has a Prisma default of 14, so on a real row the column is practically always
  set and counts as "chosen". That is the same reading the header's season track makes; it is not new here.
- Stage (done / now / next) comes from `nativeLeaguePhase`: Setup → the two "before" sections are *now*;
  Regular season → Waivers & trades is *now*; Offseason → all *done*. Members and Commissioner tools have no
  stage (not a point in the season) and no dot.
- Spanish (`language === 'es'`): «Antes del draft», «Día del draft», «Semanas 1–14 · fecha límite de
  intercambios Sem 12», «Desde la semana 15». No eyebrow names claims, so «reclamo»/«waiver» never arises.
  The rest of this page (section titles, row labels) is English-only today, as it was before this batch.

## Dropped from the mock, and why

| mock element | why it is not here |
|---|---|
| Sport pills (NFL / NBA / NHL / MLB) in the header | a mock-only preview switch; a league has one sport |
| Accordion sections (one open at a time) | a behaviour change — every row is a button that opens its editor today, and collapsing them would hide values members read |
| "Your season at a glance" sidebar | it restates the rows in sentences; the mock's sentences carry facts the page does not hold (overnight pick pause, "queue then best", "pending trades cancelled", bye count, tiebreak, third-place game). Composing it only from real rows would duplicate the list beside itself |
| "Members see this same summary in the League rules popup" + "Preview the rules popup" | no such popup is reachable from this page; a link to nothing is worse than no link |
| Row hints ("Locked after the draft", "Order reverses each round", "Never skips a team") | not in the settings data; inventing them is exactly what the brief forbids |
| Median game, overnight pause, clock-runs-out behaviour, playoff byes / tiebreak / third place rows | `buildLeagueSettingsHome` has no row for them; adding rows means reading new fields, which is a settings-data change rather than a visual one |
| Section title "How your season works" | the page keeps its title "League Settings" (copy, not identity — out of scope for a visual batch); the timeline carries the idea |

## Visual review

DB-free harness: `/e2e/redraft-league/settings?sport=<S>[&role=member][&leagueType=dynasty]` (404 in
production via `app/e2e/layout.tsx` and the page itself). It renders the real `NativeLeagueWorkspace` around
the real `LeagueSettingsHomeContainer`, answering only the two GETs the page makes (roster settings, draft
settings) and refusing every write.

`node scripts/redraft-settings-capture.mjs --base-url <local dev> --out <dir> --phase before|after
[--expect-redraft-settings]` shoots commissioner (1440 + 390) and member (1440) × 7 sports × light/dark, plus
a dynasty control at 1440/390 × light/dark. Before each frame it reads back `<html data-mode>`, the
workspace's `data-format`/`data-sport`, the workspace `--accent` and the settings root's `--accent`, the
page testid and (after) the `[data-rd-settings]` marker; a control frame must have none of them. For the
control it digests the settings root's markup and computed styles and the PNG, and the second phase compares
them against the first — any difference fails the run. No baselines are committed.

# Public demo league (`/demo`)

A live, anonymized, read-only view of ONE real league you commission. It is **not a copy**:
every request reads the source league's synced rows from Postgres and passes them through an
anonymization layer, so standings, scores, rosters, trades and alerts move as the source syncs.

## Set or change the source league

1. Sign in to AllFantasy **with your admin account** (an app session; the shared admin password
   cookie alone is refused for this write because the route needs to know whose league it is).
2. Open **`/admin/demo-league`** (also linked from `/admin` → "Public demo league").
3. Paste the AllFantasy league id (the `League.id` uuid) of a league **you commission** and press
   **Use as demo source**. "Turn the demo off" clears it; `/demo` then shows "unavailable".

API equivalent: `PUT /api/admin/demo-league { "leagueId": "<uuid>" }`, `GET` to read, `DELETE` to clear.

Write gates (all required): `requireAdmin()` → a real admin user id → that user commissions the
league. Optional: set `DEMO_LEAGUE_ADMIN_EMAILS=you@domain` to allow only that admin email to write.

Storage (no migration): `platform_config` rows
- `demo_league.source.v1` → `{ leagueId, setByUserId, setAt }`
- `demo_league.aliases.v1.<leagueId>` → `{ next, teams: { <LeagueTeam.id>: <aliasIndex> } }`

The alias map is what keeps fake names stable. An index is never reassigned or reused. Changing
the source league starts a separate map for the new league; switching back reuses the old one.

## How anonymization works

`lib/demo-league/service.ts`: config → `loadDemoSource` (DB only, never a provider) →
`ensureTeamAliases` → `buildDemoLeagueView` (**allowlist**: every output field built by name,
types in `lib/demo-league/types.ts`) → `DemoRedactor` (safety net: every real identifier of the
source replaced) → **leak assertion** on the serialized bytes; any surviving identifier fails
closed (503 / "unavailable"). Every API response is re-scrubbed and re-asserted at the final
bytes (`demoJsonBody`). Logs carry counts only.

Never shown: league chat, trade notes/messages, DMs, commissioner alert summaries, avatars/logos,
emails, usernames, any user/team/roster/league/platform id. Kept: player names, rosters, scores,
standings, schedule, trades (with fake team names), settings.

## Surfaces

Pages: `/demo`, `/demo/teams/[slot]`, `/demo/trades`, `/demo/chimmy`, `/demo/players`,
`/demo/trade-evaluator` — all inside `app/demo/layout.tsx` (banner "Demo league — live sample
data", `noindex`). No account needed. APIs under `/api/demo/*` are GET-only except the two
compute-only POSTs (Chimmy, trade evaluator); writes return 405. Per-IP rate limits; demo Chimmy
also has a per-process daily cap (`DEMO_CHIMMY_DAILY_CAP`, default 300).

## Tests

`__tests__/demo-league/` — the leak suite requests every demo page and API route against a
fixture full of distinctive real identifiers and fails if any appears in a response, page, the
Chimmy prompt, or a log line. It also fails if a new `app/demo/**/page.tsx` or
`app/api/demo/**/route.ts` is added without being listed in it.

DB-free visual harness (dev only): `/e2e/demo-league`, `/e2e/demo-league/teams/1`,
`/e2e/demo-league/trades`, `/e2e/demo-league/trade-evaluator`.

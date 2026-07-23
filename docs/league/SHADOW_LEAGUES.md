# Shadow Leagues & Write Authority

## The problem this solves

Before this change, an imported league rendered the *same* write-capable shell as a native
AllFantasy league, and several mutations reported success in language that implied the source
platform had been updated. Concretely, on `origin/main`:

- **Lineups** — `TeamTab.tsx` gated editing on `!isSleeper` only. An ESPN or Yahoo import
  (both `available: true` in `lib/league-import/provider-ui-config.ts`) was fully editable and
  showed a green **"Lineup saved"** toast. ESPN never heard about it.
- **Trades** — no platform gate at all, *including Sleeper*. A manager could send an offer to a
  partner who plays on Sleeper and will never receive it.
- **Waivers** — claims, add/drops, deletes and reorders all persisted, disclosed only by a hedge
  ("you *may* be required to finalize moves directly on the host platform").
- **Commissioner settings** — `execute-league-settings-patch.ts` had zero platform awareness.

The tab set is chosen by sport and variant (`LeagueShell.tsx`), never by platform, so every
imported league gets the full shell by construction.

## The decision

**Imported leagues are NOT read-only.** Making them read-only would remove the thing that makes
Decision OS useful — the ability to ask "what if I bench Josh Allen?" against your real league
without touching it. Instead an imported league is a **Shadow League**: a complete digital twin
that is fully editable, clearly labeled, and never propagated upstream.

```
Native AF league                    Imported league
AllFantasy → Database → League      ESPN → Import → AF Shadow League → Decision OS → Suggestions
(the write IS the real thing)       (never: AF → ESPN)
```

## Write Authority

One predicate replaces every scattered `platform === 'sleeper'` check.
`lib/league/write-authority.ts`:

| Authority   | Meaning                                                        | Today                    |
|-------------|----------------------------------------------------------------|--------------------------|
| `NATIVE`    | League lives on AF. AF's DB is the system of record.            | `manual`/`allfantasy`/`af`/`native` |
| `SHADOW`    | Imported twin. Writes are real in AF, never sent upstream.       | every external platform  |
| `CONNECTED` | External AND a write-back adapter exists, so writes propagate.   | **nothing** — no adapter |

An unrecognised platform resolves to `SHADOW`. An empty-string platform also resolves to
`SHADOW`, unlike null/undefined which resolve to `NATIVE` — the fail-safe direction, since a
spurious banner is cosmetic but a false "your change reached ESPN" is the exact harm this exists
to prevent.

### Enabling write-back later

Add the platform to `WRITE_BACK_CONNECTED_PLATFORMS` and build the adapter. Every surface then
flips itself: `"Save shadow lineup"` becomes `"Save to Sleeper"`, `"Shadow trade created"`
becomes `"Trade offer sent"`, the banner and badge disappear. No call site changes.

## Wiring

Server (`lib/league/write-authority-server.ts` for the DB-backed resolver; the pure module is
client-safe and has no Prisma import):

| Route | Emits |
|---|---|
| `app/api/leagues/roster/save/route.ts` | `writeAuthority` (lineup) |
| `app/api/league/roster/route.ts` (GET) | `writeAuthority` — lets the client label before saving |
| `app/api/leagues/[leagueId]/trades/route.ts` (GET + POST) | `writeAuthority` (trade) |
| `app/api/waiver-wire/leagues/[leagueId]/claims/route.ts` | `writeAuthority` (waiver_claim) |
| `app/api/waiver-wire/leagues/[leagueId]/add-drop/route.ts` | `writeAuthority` (waiver_add_drop) |
| `app/api/waiver-wire/leagues/[leagueId]/settings/route.ts` (GET) | `writeAuthority` — banner before the first claim |
| `lib/league/execute-league-settings-patch.ts` | `writeAuthority` (settings) |

Client copy, shadow vs native:

| Action | Shadow | Native |
|---|---|---|
| Lineup | "Shadow lineup saved — saved in AllFantasy only, your ESPN lineup is unchanged." | "Lineup saved" |
| Trade | "Shadow trade created — send this offer in ESPN to make it real." | "Trade offer sent" |
| Waiver claim | "Waiver recommendation saved — submit it in ESPN before your league's waiver deadline." | "Claim submitted" |
| Add/drop | "Shadow add/drop recorded — make the move in ESPN to apply it to your real roster." | "Roster move complete" |
| Settings | "Shadow rules updated — your ESPN league settings are unchanged." | "League settings saved" |

Waiver copy deliberately does **not** name a weekday. AF does not reliably know the source
league's waiver run day, and "before Wednesday" would trade one honesty problem for another.

Markers: `ShadowLeagueBanner` at the top of the league shell, a `SHADOW` badge on
`LeagueSidebarCard`, and inline notices on the roster, trade builder and waiver surfaces.

### The badge that never rendered

`LeagueSidebarCard` previously gated an "IMP" badge on `league.importedAt && !league.lifecycleState`.
Both operands were always falsy: `/api/league/list` does not select `importedAt`, and
`lifecycleState` is non-nullable with a default of `in_season`. Import marking was effectively
zero. The `SHADOW` badge derives from `platform`, which that payload always sets.

## Known gap — Sleeper lineups

`/api/league/roster` serves Sleeper leagues from a **live fetch of Sleeper's own roster**
(`platform !== 'sleeper'` branch), not from the AF twin. So Sleeper lineups stay read-only here,
with the pre-existing accurate copy: *"Lineups for Sleeper leagues are managed in the Sleeper
app."* Sleeper trades, waivers and settings are full Shadow surfaces like any other import — only
the lineup view differs.

Making Sleeper lineups shadow-editable means switching that view from live-mirror to twin, which
is a data-source change, not a Write Authority change. Left out deliberately; it is not blocked
on write-back.

## Tests

`__tests__/league/write-authority.test.ts` covers the predicate, per-action copy for all six
importable providers, the fail-safe defaults, the envelope, a regression guard that every
mutation route still emits `writeAuthority`, and a guard against reintroducing a marker gated on
`importedAt`/`lifecycleState`.

# Redraft native screens — batch A2

The `/league/[id]` native screens for a native redraft league, restyled on the foundation's tokens
([`redraft-identity.md`](./redraft-identity.md)); batch A2 of [`redraft-tab-inventory.md`](./redraft-tab-inventory.md).
Other formats are unchanged: every new element is behind `useRedraftScreen(league)` (null for any other
format) and every new rule in `redraft-native-screens.css` is scoped to the workspace's `data-format=redraft`.

| file | role |
|---|---|
| `lib/league-media/redraftScreens.ts` | pure mappings; each returns `null` when the data does not say |
| `components/league/native/screens/RedraftScreenParts.tsx` | the gate (`useRedraftScreen`), the sport context for `PosPill`, score bug, waiver header, deadline bar, bracket |
| `components/league/native/screens/redraft-native-screens.css` | all redraft rules; tokens only; two top-level `@media` blocks (≤1199, ≤767) |
| `app/e2e/redraft-league/screens/[tab]` | DB-free harness (404 in production) answering the screens' own fetches from fixtures |
| `scripts/redraft-native-screens-capture.mjs` | tab × 7 sports × light/dark × 1440/390, refusing a frame whose mode/sport/accent/screen it cannot vouch for |

## Per screen — what shows, and what is dropped without data

| screen | redraft adds | dropped when |
|---|---|---|
| My team | sport position chips on every slot; bench / IR / taxi rows chip the player's own position; **Bye** (weekly) and **Off day** (daily) badges; day strip with today filled | Off day: the day's schedule was not read (every row's `periodOpponent` null) — a null only counts when another row names an opponent. Bye: no BYE opponent and no matching `byeWeek` |
| Matchup | broadcast score bug — state (Live / Final / Upcoming), totals, records, per-side "playing · done · to play", win-probability meter; a live / final dot per starter | odds and meter: `winProbabilityLeft` null, or the matchup is final. Projected line: either side used a fallback projection. A starter's dot: state `unknown` |
| Players & waivers | header: claim type, FAAB balance against budget (meter), next run, priority; claim state chips | each cell independently: unknown `waiverType`, no FAAB mode, no balance; the meter needs a positive `faabBudget` (a balance alone shows without a bar) |
| Trades | deadline bar from `League.tradeDeadlineWeek` vs the current week (weeks left / deadline week / passed / none); proposal cards with the grade as a letter block and the open-offer state | grade: the panel's `leagueGrade` is not graded. State chip: an unknown `status` |
| Standings & playoffs | labelled playoff line; viewer row in the sport tint; **Clinched / Eliminated / Champion** chips; bracket view on *Playoff picture* | chips and bracket: the bracket is not GENERATED (`/api/redraft/playoff-runtime`). Before that, seeds are "if the season ended today" and nothing is mathematical — so nothing is claimed |
| Players (More tools) | sport position filters; position chips; /core tokens in light and dark | football stat columns outside NFL / NCAAF; the Sleeper player map outside NFL / NBA (it answered every other sport with NFL players) — those sports list the league's own pool |

## Sport handling

| sport | lineup | positions (chip colour) |
|---|---|---|
| NFL | weekly, Bye badge | QB red · RB green · WR blue · TE amber · K violet · DEF slate · FLEX dashed |
| NCAAF | weekly, Bye badge | as NFL; no DEF |
| NBA / NCAAB | daily, day strip, Off day | guards blue · forwards green · C amber · UTIL dashed |
| NHL | daily, day strip, Off day | C blue · wings green · D amber · G red |
| MLB | daily, day strip, Off day | C violet · infield green · OF blue · SP red · RP amber · DH/UTIL dashed |
| Soccer | weekly | GK amber · DEF blue · MID green · FWD red |

`C`, `G`, `SF` and `DEF` mean different jobs by sport, which is why the tone is read per sport
(`redraftPositionTone`) and never from the football-only `positionTone`.

## Not in scope

- `RedraftStandingsPlayoffsView` is unreachable for a native league (LeagueShell routes every native
  `standings` to `NativeStandingsScreen` first); it serves imported NFL redraft leagues, which never carry
  the identity. Left unchanged.
- `af-matchup.css` and `af-standings.css` are `/core` (surface B) stylesheets — not used by these screens.
- `native-screens.css` is unchanged; the redraft layer sits on top at higher specificity.

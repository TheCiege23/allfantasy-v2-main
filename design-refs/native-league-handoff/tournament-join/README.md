# Tournament join flow

This is the first thing every player sees. It works for both formats and uses the division identity system (`../division-identity`).

## Screens

| File | What | States in `screens/` |
|---|---|---|
| `TournamentJoin` | Invite landing page | Open (default), Full, Already in. Almost full and Closed are in the preview toggle |
| `TournamentReveal` | League reveal after registration closes | Before reveal, Revealed (divisions format), Revealed (points race) |
| `MobileJoin` | Phone version of the invite | — |
| `MobileReveal` | Phone version of the revealed league | — |

### `TournamentJoin`

- **Header:** both division badges, the tournament name and who invited you.
- **Key facts:** draft window, season weeks, bracket weeks, entry fee, scoring, roster, league size, trades.
- **How it works:** a short rules summary for the format.
- **League crests:** every conference crest in both divisions.
- **Join card**, which changes with registration state:

| State | Card shows |
|---|---|
| Open | Spots-filled bar, optional division preference (Any / Angelic / Demonic, not guaranteed), "Join tournament" |
| Almost full | Orange bar, "Only 4 spots left" |
| Full | "Join the waitlist · you'd be #4", with notify-when-open copy |
| Closed | "Follow the tournament" (spectator) |
| Already in | Your league's crest and draft time, plus "Go to my league" |

### `TournamentReveal`

1. Before the reveal, a pulsing "?" card and a "Reveal my league" button.
2. On reveal, the division badge rises, the crest pops in, and the league name and blurb fade in.
3. Your league mates then appear one by one (you are ringed in the division colour), with the draft time and calls to action. A Replay button repeats it for QA.

A format toggle shows both versions:

- **Divisions format:** Smoke Angelic, 12 teams.
- **Points race:** Grizz Rookie, an 8-team stage 1 league.

## Build notes

- **League assignment.** It happens when registration closes. The reveal plays once per user; store `revealSeenAt`.
- **Division preference.** It's an optional commissioner setting. Honour it only while divisions stay balanced, and say so in the UI ("not guaranteed").
- **Waitlist.** Strict first in, first out until registration closes, with a push notification when a spot opens.
- **Personal invite links.** These only bring friends in. Placement stays random unless the commissioner allows grouping.

## Update: scoring and roster on the invite

- **`TournamentJoin`:** a scoring and roster card (the Half PPR plate, "Half PPR · Standard roster", and the roster chips) now sits above "How it works", so players see the rules before joining. The facts row now shows Tiebreakers and Ends (week 17) instead.
- **`MobileJoin`:** shows the HALF pill and the roster chips under the spots bar.
- **Labels and colours:** come from `../scoring-roster-labels/rules.json`.

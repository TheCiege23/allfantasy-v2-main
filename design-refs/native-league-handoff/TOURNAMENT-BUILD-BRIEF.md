# Tournament build brief (for Codex)

This document says what to build for AllFantasy tournaments and in what order. Every phase points to a design folder in `design-refs/native-league-handoff/`, and each folder has a README, the screens as PNGs (`screens/`), and interactive source boards (`source/*.dc.html`). The READMEs hold the detailed rules. This brief gives the order, the data model and what "done" means.

## Ground rules (apply to every phase)

- **Provider data:** never call provider APIs to learn response shapes. Use the shapes in `contracts/`.
- **Secrets:**
  - Secrets (`RSC_token`, the TheSportsDB key) must never appear in logs, errors, fixtures, notifications or share links.
  - Never log full Rolling Insights URLs.
- **Calculations on the backend only:**
  - The backend calculates cut lines, seeds, tiebreaks, wildcard pools and bracket placement.
  - The UI only displays them, and AI copy only explains them.
- **Irreversible actions:** commit cut, commit seeding and advance round. Each one is a single guarded action that writes to the audit log.
- **Missing scores:** a missing score is not a zero. Block any commit while a required score is missing or provisional.
- **Art and names:**
  - No emoji as UI glyphs.
  - Original names and art only.
  - The "created by KB" signature appears only on tournament and conference art, not on labels.
- **Fonts:** Archivo (UI), JetBrains Mono (numbers), Caveat (signature only).

## The rules in one place

| Topic | Rule |
|---|---|
| **Formats** | The commissioner picks one: **Points race** (global points, mass cuts, redrafts, one bracket) or **Divisions & conferences** (two named divisions, conference leagues, record standings, auto bids plus a wildcard pool, regional brackets) |
| **Tiebreakers** | 1. Higher seed<br>2. Better record<br>3. Best single week<br>4. Commissioner review<br><br>Before the bracket there are no seeds, so ties start at record. In bracket games the higher seed advances |
| **Calendar** | The tournament ends one week before the season ends: last week = season length − 1. NFL is week 17. NBA comes from the calendar adapter |
| **Redrafts (points race)** | Default order is by seed (the best seed picks first). The commissioner can choose Random (logged) or Set manually |
| **Buffer week (points race)** | One week with no scoring per redraft. In it: load leagues by seed, the commissioner sets the draft date and time, run the draft, post the next week's matchups |
| **Divisions format** | Ranks 1–52 get auto bids (seeds 1–13). The wildcard pool is ranks 53–64 plus the top 12 scorers from ranks 65–120, ranked on points. The top 12 take seeds 14–16. Four regions of 16. Odd seed lines go N, E, S, W and even lines go W, S, E, N. Weeks 11–17 are R64, R32, S16, region final, division final four, division final, then the championship |
| **Scoring and roster** | 12 scoring options and 9 rosters (`scoring-roster-labels/rules.json`). Defaults: NFL Half PPR with the Standard roster, NBA Points with the Standard roster. The same rules apply in every league and stage, and they lock when registration opens |
| **Spelling** | King Buffalo |

## Data model (minimum)

```
Tournament  { id, name, sport, season, format: 'points'|'divisions', status: 'blueprint'|'registration'|'live'|'complete',
              scoringId, rosterId, scoringOverrides?, tiebreakers[], redraftOrder: 'seed'|'random'|'manual',
              seasonLength, lastWeek (= seasonLength - 1), createdBy }
Division    { id, tournamentId, name, sideId, emblem }                 // divisions format; cosmetic in the points race
Conference  { id, divisionId, name, image }                            // one league per conference per division
Stage       { id, tournamentId, kind: 'stage'|'buffer'|'bracket', index, startWeek, endWeek, status }
League      { id, stageId, conferenceId?, name, draftAt, draftOrder[] }
Entry       { id, tournamentId, userId, leagueId, seed?, status: 'active'|'eliminated'|'waitlist', joinedAt }
Standing    { entryId, stageId, points, wins, losses, bestWeek, rank }  // calculated on the backend
Tiebreak    { stageId, entryIds[], decidedBy: 1|2|3|4, winnerId, loggedAt }
BracketSlot { tournamentId, divisionId?, region?, round, slot, seed, entryId, score?, advancedId? }
AuditLog    { tournamentId, actor, action, payload, at }
```

## Build order

### Phase 1: Setup and rules

**Folders:**
- `tournament-formats/` (`TournamentFormat`)
- `division-identity/` (`TournamentIdentity`, `DivisionPresets`, `manifest.json`)
- `scoring-roster-labels/` (`ScoringRoster`, `RulesLabels`, `rules.json`)
- `specialty-leagues/tournament/` (`TournamentCreate`)

**Build:**
1. Format chooser (step 1 of the planner).
2. Names and art (step 2): 20 presets, custom names, the 50-image library, conference images.
3. Scoring and roster (step 3).
4. The planner calendar calculated from season length.
5. Save as a blueprint.

**Done when:**
- A commissioner can save a blueprint for either format.
- Names are unique and pass the team-name content filter.
- The planner calendar matches the formula in the tournament README (NFL 64 points race: weeks 1–6, buffer 7, weeks 8–12, buffer 13, weeks 14–17).

### Phase 2: Join and league reveal

**Folder:** `tournament-join/` (`TournamentJoin`, `TournamentReveal`, `MobileJoin`, `MobileReveal`)

**Build:**
1. Invite page states: open, almost full, full (waitlist), closed and already in.
2. Division preference.
3. League placement when registration closes.
4. League reveal for both formats.

**Done when:**
- The waitlist promotes in join order.
- Placement is deterministic and logged.
- Scoring and roster labels show before joining.

### Phase 3: Standings and the regular season

**Folders:**
- `specialty-leagues/tournament/` (`TournamentHub`, `MobileTournament`)
- `tournament-formats/` (`DivisionStandings`, `DivisionWildcard`, `MobileDivision`)

**Build:**
1. Global points standings with the cut line and bubble tags (points race).
2. Division standings by record, then points.
3. The auto-bid line and the wildcard pool (divisions).
4. Conference points.

**Done when:**
- Standings match a backend fixture, including ties.
- Every tiebreak shows its reason on the row.

### Phase 4: Cuts, redrafts and seeding

**Folders:**
- `specialty-leagues/tournament/` (`TournamentCutDay`, `TournamentRedraft`, `TournamentControl`, `MobileTournamentCut`)
- `tournament-extras/` (`DivisionControl`)

**Build:**
1. Commissioner checklists.
2. Tie review.
3. Commit cut, with snake seeding into new leagues.
4. Buffer week jobs: create leagues, the commissioner sets the draft time, the draft, posting matchups.
5. Commit seeding for divisions.

**Done when:**
- Commits are blocked until scores are final and stat corrections are closed.
- Jobs retry up to 3 times and alert after that.
- Everything is in the audit log.

### Phase 5: Brackets and championship

**Folders:**
- `specialty-leagues/tournament/` (`TournamentBracket`)
- `tournament-formats/` (`DivisionBracket`, `DivisionChampionship`)
- `tournament-extras/` (`DivisionControl` in rounds mode)

**Build:**
1. Bracket views with "my path".
2. Region brackets.
3. The cross-division final.
4. Round advancement, with tied games going to the higher seed.

**Done when:**
- Byes are calculated as 2^weeks − finalists.
- The final lands on season length − 1.

### Phase 6: Share card and notifications

**Folder:** `tournament-extras/` (`TournamentChampion`, `TournamentNotifications`)

**Build:**
1. Share card in three sizes (post 1080×1350, story 1080×1920, square 1080×1080), drawn from data and exported as a PNG.
2. A public trophy page.
3. Seven notification moments across push, in-app, email and league chat, using the default channel matrix.

**Done when:**
- Non-champions get their own headline.
- Managers can turn off any notification channel.
- No secrets or provider URLs appear in any payload.

## Art reference

| Folder | What's in it |
|---|---|
| `specialty-leagues/tournament/assets/` | Tournament emblem, banner and 8 icons |
| `kbi-art-pack/` | 20 crests and 20 banners for the Black & Gold example, plus 10 marks. The signature is outlined, so it renders the same everywhere |
| `division-identity/` | 40 medallions, rings and blank crest frames, the 50-image library and `manifest.json` |
| `scoring-roster-labels/` | 12 scoring plates, 9 roster strips, 23 position chips and `rules.json` |

## Still open

- **NBA season length:** comes from the calendar adapter. The screens use 25 periods as a placeholder.
- **Phone layouts:** the share card, notifications and the scoring and roster picker have desktop layouts only so far.

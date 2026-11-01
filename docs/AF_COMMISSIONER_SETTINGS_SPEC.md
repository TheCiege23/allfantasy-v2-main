# AF Commissioner Settings Spec

Many modules cite this file by section (`§2.1`, `§3, idea 7`, …), but it was never committed.
This version was put back together on 2026-10-26 from those citations, so every section number
already used in the code means what that code says it means. It also records the owner's
dynasty decisions from the same day (§5).

Plans named below come from `lib/monetization/catalog.ts`: **Free**, **AF Commissioner**
($14.99), AF Pro, AF Legacy and AF Supreme. When something says "Commissioner", it means the
AF Commissioner plan held by the league's commissioner.

## 1. League structure

### 1.1 Rookie / future draft order
- **Free:** the app works out the order from the commissioner's chosen rule (reverse
  standings, max-PF, lottery, or playoff-results-based) and shows it.
- **Commissioner:** when the season ends, the app fills next season's rookie draft
  automatically from that rule, with no work from the commissioner.

### 1.2 Keeper rules
Keeper counts, round costs and deadlines are free settings. Imported leagues bring their
keeper settings across where the provider exposes them (see §3, idea 4).

### 1.3 Playoffs and byes
- **Free:** any playoff team count, odd counts included; the top seeds get the byes the
  bracket needs.
- **Commissioner:** custom byes, where the commissioner chooses how many seeds sit out.

## 2. Commissioner tools

### 2.1 Free tools
Every commissioner gets these:
- **Settings lock:** lock areas of the league (scoring, rosters, draft) so they cannot be
  changed during the season without an announced unlock.
- **Scheduled announcements.**
- **Co-commissioners:** up to two, each with scopes.
- **League log:** every commissioner action, readable by members.
- **Score adjustments:** a manual point change with a required reason, written to the log.
- **Trade deadline:** a day and a time.
- **Custom tiebreakers.**

## 3. Ideas, numbered as cited in code

Which plan unlocks each idea is decided in `lib/monetization/entitlements.ts`, not here.

| # | idea |
|---|---|
| 3 | League constitution: the settings as plain-language rules |
| 4 | Imported-league assist: settings converted as closely as possible, with every gap named |
| 6 | Weekly recap review: the commissioner approves the recap before it posts |
| 7 | Lineup integrity audit: empty, injured, bye-week and inactive starters |
| 8 | Scenario explainer: playoff and seeding odds in words, for any member |
| 9 | Draft-day kit: the order reveal, the printable board, the absent-manager rule |
| 10 | Commissioner reputation |
| 11 | Rule templates: rule sets other leagues use, applied in one step |

### 3.1 Commissioner inbox
One place for everything waiting on the commissioner: trades in review, disputes, stat
corrections and reminders.

### 3.2 Dispute desk (Free)
A member raises a dispute. The commissioner rules on it, and both sides see the ruling. One
component serves both sides.

### 3.5 Deadline autopilot
- Viewing the rules is Free.
- **Switching it on is Commissioner.** The trade deadline, waiver runs, lineup lock
  reminders and the playoff cut then run without the commissioner. Only the commissioner
  or a co-commissioner can change it.

## 4. Specialty formats

### 4.5 Guillotine chop schedule (Commissioner)
How many teams are chopped each week, and in which weeks.

## 5. Dynasty decisions (owner, 2026-10-26)

1. **A Chimmy-run abandoned team is paid (Commissioner).** When a manager leaves mid-season,
   Chimmy runs their team until the seat is filled.
2. **Commissioner includes Chimmy drafting from a manager's psychology profile.** This is the
   same profile the abandoned-team autopilot uses.
3. **Anti-tanking:** every penalty is available. The defaults are **a warning first, then
   loss of a draft pick**. The commissioner can change either for their league.
4. **How Chimmy runs an abandoned team:** by default it **plays like a dynasty owner**, so it
   protects the long-term value of youth and picks rather than trading everything for this
   week. The commissioner can change this.
5. **Switched on site-wide:**
   - **Commissioner reminders.** The sender (`commissioner_recipes_send_enabled`) is on. A
     league still chooses which reminders it wants: leagues are opted out by default, so
     switching it on site-wide messages nobody unexpectedly.
   - **The trade review panel.** It is on by default, and only
     `COMMISSIONER_TRADE_REVIEW_ENABLED=false` turns it off.
6. **Flagged trades are held for the commissioner only when the flag is serious (2026-10-27).**
   On AF Commissioner, an accepted trade is checked for collusion before it goes through. By
   default it waits for the commissioner to approve or veto only when it is **heavily lopsided**
   or an **eliminated team is sending starters to a contender**. Any other flag only alerts the
   commissioner, and the trade goes through. The commissioner can switch holding off or hold
   every flag (`League.settings.integrity_hold_flagged_trades`: `off` / `severe` / `all`;
   `lib/integrity/holdFlaggedTradesMode.ts`).
7. **The rookie draft opens itself on the Commissioner plan (2026-10-27).** Per §1.1, when the
   commissioner holds AF Commissioner, the rookie draft is created automatically when the
   sport's window opens (NFL May, NBA and NHL July, MLB November–January), with the order set
   from the league's rule. The commissioner still starts it, and can switch auto-open off. Free
   leagues create it with the button. A Commissioner league whose offseason had already begun
   before 2026-10-28 is not switched on: its commissioner is told once and can turn it on
   (`lib/dynasty-core/rookieDraftCalendar.ts`, `resolveRookieDraftAutoOpen`).
8. **Taxi rules can be enforced, on the Commissioner plan (2026-10-27).** In a league played on
   AllFantasy, the commissioner can switch on "Enforce these rules" in the taxi settings
   (`League.settings.taxi_rules_enforced`) while the league owner holds AF Commissioner. Roster
   saves then apply every taxi rule shown beside the switch (`lib/taxi/taxiMoveRules.ts`): the lock
   week (nothing onto taxi after it), the promotion deadline, in-season and postseason moves, and
   "once promoted, cannot return", read across seasons from the promotion log. It is opt-in because
   every league already holds default rules nobody chose. The offseason is always open, drops are
   never refused, the commissioner can override, and a lapsed plan stops enforcement without
   deleting the rules. NHL and MLB still offer no taxi squads (decision of 2026-10-20, reconfirmed).

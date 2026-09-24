/**
 * Single source of truth for supported sports across the app.
 * Use this for sport-aware abstractions, resolvers, templates, and filters.
 *
 * SPORT SCOPE: Always support these sports unless explicitly told otherwise:
 * - NFL, NHL, NBA, MLB, NCAA Basketball (NCAAB), NCAA Football (NCAAF), Soccer
 */
import type { LeagueSport } from '@prisma/client'

/**
 * All supported league sports (values match Prisma `LeagueSport`).
 * Order: major US leagues, then NCAA, then soccer (EURO / UEFA in product UI).
 */
export const SUPPORTED_SPORTS: LeagueSport[] = [
  'NFL',
  'NBA',
  'NHL',
  'MLB',
  'NCAAF',
  'NCAAB',
  'SOCCER',
]

/** Rolling Insights / DataFeeds imports only these league sports (same seven as `SUPPORTED_SPORTS`). */
export const ROLLING_INSIGHTS_LEAGUE_SPORTS = SUPPORTED_SPORTS

/** Default sport when league/context has no sport (first in list; do not hardcode one sport). */
export const DEFAULT_SPORT: LeagueSport = SUPPORTED_SPORTS[0]!

/**
 * Devy and Campus-to-Canton (C2C) create flows: primary pro league only
 * (NCAAF / NCAAB college pools pair as NFL↔NCAAF, NBA↔NCAAB in defaults).
 */
export const COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS: LeagueSport[] = ['NFL', 'NBA']

/** @alias COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS */
export const DEVY_WIZARD_PRIMARY_SPORTS = COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS

/** @alias COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS */
export const C2C_WIZARD_PRIMARY_SPORTS = COLLEGE_PAIR_WIZARD_PRIMARY_SPORTS

/** Type for supported sport string (aligns with LeagueSport). */
export type SupportedSport = LeagueSport

/** IDP leagues are explicitly supported only for pro + college football. */
export const IDP_SUPPORTED_SPORTS: readonly LeagueSport[] = ['NFL', 'NCAAF']

/**
 * Sports whose season can actually RUN, end to end, today.
 *
 * 🛑 THIS IS A CAPABILITY, NOT A PREFERENCE, AND THE GAP IS SILENT. A league in a
 * sport that is not listed can be created, drafted and scheduled — and then
 * nothing ever happens to it. Its matchups never finalize, so `advance_week`
 * refuses forever, so it never reaches playoffs, a champion or an offseason.
 * Nothing goes red; the league simply sits at week 1, which is exactly the dead
 * end the whole season-lifecycle effort exists to remove.
 *
 * ⚠ THE RATIONALE HERE WENT STALE AND ASSERTED THE OPPOSITE OF THE CODE. It read
 * "`syncPlayerWeeklyScoresForRedraftSeason` THROWS for a non-NFL sport (wired for
 * NFL only)". That service now says "wired for NFL, NBA and NHL" and carries a
 * full daily-sport branch reading `player_game_stats` across a date window — the
 * throw had been narrowed and this comment was not. **A comment asserting a
 * capability is not evidence of one**, in either direction, and re-reading the
 * code it describes is what adding the next sport owes.
 *
 * ⚠ THE PER-SPORT `lib/{nba,mlb,nhl,ncaab,ncaaf}-scoring` MODULES STILL DO NOT
 * CHANGE THIS, AND THEY STILL LOOK LIKE THEY DO. They are CONFIG services — their
 * own headers say "Read/write NBA scoring configuration from League.settings
 * JSON". They define what a stat is worth; they do not fetch stat lines.
 *
 * ⚠ AND THE WEEK RESOLVER IS BROADER THAN THIS LIST, WHICH IS NOT A CONTRADICTION.
 * `lib/season-week` can place a week for NFL, NCAAF and SOCCER from the schedule
 * feed. Knowing WHICH week it is does not help when nothing can score that week,
 * so the narrower capability is the one that governs here.
 *
 * WHAT NHL NEEDED, AND WHAT THE NEXT SPORT WILL (measured 2026-09-24, not assumed):
 *   1. a stat path — `player_game_stats` held 733 NHL rows across 693 players;
 *   2. a schedule in a RANKED feed — `thesportsdb` held 1,373 NHL 2026 rows, and
 *      it is in `LIVE_SCORE_SOURCES`;
 *   3. its statuses understood by `normalizeGameStatus` — `FT`/`AOT`/`AP` all map
 *      to `final`, `NS` to `scheduled`, so finished games are not read as open;
 *   4. a recorded season opener, because a daily sport's week is a DATE WINDOW —
 *      NHL 2026 is `2026-09-29` in `dailySportSeasonStarts.ts`;
 *   5. the finalizer able to close it — `DATE_WINDOWED_SPORTS` in `weekFinalizer.ts`,
 *      since `SportsGame.week` for NHL is noise (29 distinct values, 1..500).
 *
 * ⚠ NBA CLEARS (1) AND (4) AND IS STILL ABSENT. Its season starts 2026-10-20, so
 * nothing above has been checked against a real NBA slate. Adding it is a
 * measurement, not an edit.
 *
 * NCAAB (2026-09-24), against the same list — and one item the list did not have:
 *   1. stats: 110,640 `player_game_stats` rows for 2025-26 (backfilled), daily sweep since;
 *   2. schedule: NOT a ranked feed. Every SportsGame schedule for NCAAB is incomplete
 *      (thesportsdb stops at a 3,000-game cap), so the finalizer reads Rolling Insights' season
 *      schedule instead — `RI_SCHEDULE_SLATE_SPORTS`, lib/sports-data/riSeasonSchedule.ts (#1201).
 *      Until the 2026-27 schedule is published (it 304s — GAPS N-16) NO week can seal: an unsynced
 *      schedule is an empty slate, which refuses;
 *   3. statuses: final/completed -> final, `replaced` -> cancelled (#1201), postponed holds;
 *   4. opener: 2026-11-02 in dailySportSeasonStarts.ts;
 *   5. finalizer: `DATE_WINDOWED_SPORTS`;
 *   6. NEW — roster ids: a drafted player holds the pool's Rolling Insights id while game logs are
 *      keyed on PlayerIdentityMap.id; queried directly every starter scored 0 (#1200 bridges it).
 *      Any next sport must check this too.
 */
export const SEASON_CAPABLE_SPORTS: readonly LeagueSport[] = ['NFL', 'NHL', 'NCAAB']

/** Whether a league in this sport can run a season to completion today. */
export function canRunSeasonForSport(sport: string | null | undefined): boolean {
  if (sport == null) return false
  return (SEASON_CAPABLE_SPORTS as readonly string[]).includes(String(sport).toUpperCase())
}

/** IDP create-flow draft types (pick-order + execution modes). */
export const IDP_ALLOWED_DRAFT_TYPES = ['snake', 'linear', 'auction', 'offline', 'auto'] as const
export type IdpAllowedDraftType = (typeof IDP_ALLOWED_DRAFT_TYPES)[number]

export function isSupportedSport(s: string | null | undefined): s is LeagueSport {
  if (s == null || typeof s !== 'string') return false
  return (SUPPORTED_SPORTS as readonly string[]).includes(s.toUpperCase())
}

/**
 * Normalize vendor / UI aliases to Prisma `LeagueSport`.
 * Rolling Insights uses `NCAAFB` / `CFB` while leagues store `NCAAF`; `NCAABB` maps to `NCAAB`.
 */
export function normalizeToSupportedSport(sport: string | null | undefined): LeagueSport {
  const raw = sport?.trim() ?? ''
  if (!raw) return DEFAULT_SPORT
  const u = raw.toUpperCase().replace(/[\s-]+/g, '_')

  if (
    u === 'NCAAFB' ||
    u === 'CFB' ||
    u === 'NCAAF' ||
    u === 'NCAA_FOOTBALL' ||
    u === 'COLLEGE_FOOTBALL' ||
    u === 'NCAA_FB' ||
    u === 'NCAA_F'
  ) {
    return 'NCAAF'
  }
  if (u === 'NCAABB' || u === 'NCAA_BASKETBALL' || u === 'NCAAM' || u === 'NCAAB_ALL') {
    return 'NCAAB'
  }

  if (
    u === 'EURO' ||
    u === 'UEFA' ||
    u === 'EURO_SOCCER' ||
    u === 'EPL' ||
    u === 'PREMIER_LEAGUE' ||
    u === 'ENGLISH_PREMIER_LEAGUE' ||
    u === 'LALIGA' ||
    u === 'LA_LIGA' ||
    u === 'LA_LIGA_SPAIN' ||
    u === 'SERIEA' ||
    u === 'SERIE_A' ||
    u === 'ITALIAN_SERIE_A'
  ) {
    return 'SOCCER'
  }

  if ((SUPPORTED_SPORTS as readonly string[]).includes(u)) return u as LeagueSport
  return DEFAULT_SPORT
}

/**
 * Sports that exist on LIVE SCORES ONLY — a scoreboard tab and the clicked-game
 * view, never a league.
 *
 * ⚠ DELIBERATELY NOT A `LeagueSport`, AND NOT IN `SUPPORTED_SPORTS`. Nobody can
 * run a college baseball fantasy league here, and `SUPPORTED_SPORTS` is iterated
 * by ~10 workers, league create flows and every AI-tool sport picker, so adding
 * it there would offer a sport that does nothing. Adding it to the Prisma enum
 * would also mean a migration for a value no league row can use. Live Scores
 * stores its games in `SportsGame.sport`, a plain String, so a live-only key
 * needs neither. User decision, 2026-09-13: College Baseball on Live Scores.
 * The WNBA joined on the same terms the same day, with its game view.
 */
export const LIVE_ONLY_SPORTS = ['NCAABASE', 'WNBA'] as const
export type LiveOnlySport = (typeof LIVE_ONLY_SPORTS)[number]
/** A sport Live Scores can show: every league sport plus the live-only ones. */
export type LiveSport = LeagueSport | LiveOnlySport

export function isLiveOnlySport(s: string | null | undefined): s is LiveOnlySport {
  return typeof s === 'string' && (LIVE_ONLY_SPORTS as readonly string[]).includes(s.toUpperCase())
}

export function isLiveSport(s: string | null | undefined): s is LiveSport {
  return isSupportedSport(s) || isLiveOnlySport(s)
}

/**
 * `normalizeToSupportedSport` for the live-scores path.
 *
 * ⚠ THE LEAGUE NORMALIZER TURNS ANY UNKNOWN SPORT INTO NFL, SILENTLY. On the live
 * path that meant `?sport=NCAABASE` rendered the NFL slate and a clicked college
 * game fetched an NFL summary under a college event id. Live-only aliases resolve
 * here first; everything else keeps the league behaviour unchanged.
 */
export function normalizeToLiveSport(sport: string | null | undefined): LiveSport {
  const u = (sport?.trim() ?? '').toUpperCase().replace(/[\s-]+/g, '_')
  if (u === 'NCAABASE' || u === 'CBASE' || u === 'COLLEGE_BASEBALL' || u === 'NCAA_BASEBALL') return 'NCAABASE'
  if (u === 'WNBA') return 'WNBA'
  return normalizeToSupportedSport(sport)
}

export function supportsIdpLeagueSport(sport: string | null | undefined): boolean {
  const normalized = normalizeToSupportedSport(sport)
  return (IDP_SUPPORTED_SPORTS as readonly string[]).includes(normalized)
}

export function isAllowedIdpDraftType(draftType: string | null | undefined): draftType is IdpAllowedDraftType {
  const normalized = String(draftType ?? '').trim().toLowerCase()
  return (IDP_ALLOWED_DRAFT_TYPES as readonly string[]).includes(normalized)
}

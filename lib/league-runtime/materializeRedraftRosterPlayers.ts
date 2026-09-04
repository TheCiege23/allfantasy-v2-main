import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { reconcileRosterRedraftLinks } from './reconcileRosterRedraftLinks'

/** The columns the enrichment needs. Narrower than `SportsPlayer`, so the select is checked. */
type EnrichedPlayer = {
  sleeperId: string | null
  name: string
  position: string | null
  team: string | null
  sport: string
  source: string
}

/*
 * ⚠ ONE SLEEPER ID CAN MATCH SEVERAL `SportsPlayer` ROWS — one per source. Measured on NFL Dynasty
 * 2026-09-04: 241 ids, 570 rows. They are the SAME PERSON here (unlike an `externalId` collision),
 * but they disagree about SHAPE, and the shape is what the picker renders:
 *
 *     sleeper           "Aaron Rodgers"    QB              PIT
 *     rolling_insights  "Austin Ekeler"    RB              Washington Commanders
 *     thesportsdb       "Brian Robinson"   Running Back    Atlanta Falcons
 *
 * The team LOGO is looked up by abbreviation, and the position chips are two characters wide, so
 * `sleeper` is preferred and `thesportsdb` is last. Lower rank wins.
 */
const SOURCE_RANK: Record<string, number> = {
  sleeper: 0,
  rolling_insights: 1,
  cfbd: 2,
  api_football: 3,
  thesportsdb: 4,
}
function sourceRank(source: string | null | undefined): number {
  return SOURCE_RANK[String(source ?? '').trim().toLowerCase()] ?? 9
}

/**
 * Give a league's `RedraftRoster` rows their players.
 *
 * ── 🛑 WHY 97% OF ROSTERS CANNOT BE PRICED ────────────────────────────────────────────────
 * `canonicalSeasonMaterialization` creates a `RedraftRoster` per team and stops. Every writer of
 * `RedraftRosterPlayer` is a TRANSACTION path — draft finalisation, waivers, keeper carryover, the
 * devy merge, the IDP bridge — and none of those happens on an imported league. So an imported
 * roster is materialised empty and stays empty, while the real roster sits in
 * `Roster.playerData.players` where the trade picker reads it.
 *
 * Measured on production, 2026-09-04:
 *
 *     redraft rosters with NO players     3,039 of 3,130   (97%)
 *       dynasty    1,420 / 1,484          redraft   1,345 / 1,372
 *       guillotine   224 /   224 (all)    zombie       40 /    40 (all)
 *
 * `captureSnapshot` builds its team profile from `roster.players` — it reads their POSITIONS to
 * judge depth — so an empty roster produces no profile, and the verdict falls back to "we could not
 * price enough of this deal". Not a valuation bug: there was nothing to value.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────────────────────
 * It is not a second source of truth. `Roster.playerData` remains where a roster lives; this
 * projects it into the shape the redraft engines already read, the same way
 * `finalizeDraftToRedraftSeason` does after a draft. A league that drafts natively still gets its
 * players from that path and this one finds nothing to do.
 */

export interface MaterializeResult {
  rostersConsidered: number
  /** Rosters that had a `redraftRosterId` to write against. */
  rostersLinked: number
  playersCreated: number
  /**
   * Rows that already existed carrying the id as the name, repaired in place.
   *
   * 🛑 THIS COUNTER EXISTS BECAUSE THE CREATE-ONLY VERSION COULD NOT SELF-HEAL. 58,596 rows were
   * written by the first run with `playerName` set to the Sleeper id, and re-running skipped every
   * one of them as "already present" -- so the bug was permanent until something updated them.
   */
  playersRepaired: number
  /** Already had a live row — the idempotent case, not a failure. */
  playersAlreadyPresent: number
  /** No `redraftRosterId`, so there is nowhere to write. Reported, never silently skipped. */
  rostersSkippedNoLink: number
  /** Linked, but `playerData` held no players. An empty roster is a real state. */
  rostersSkippedNoPlayers: number
}

const EMPTY: MaterializeResult = {
  rostersConsidered: 0,
  rostersLinked: 0,
  playersCreated: 0,
  playersRepaired: 0,
  playersAlreadyPresent: 0,
  rostersSkippedNoLink: 0,
  rostersSkippedNoPlayers: 0,
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function idOf(entry: unknown): string {
  if (typeof entry === 'string') return entry
  const r = asRecord(entry)
  return String(r.id ?? r.player_id ?? '')
}

/**
 * Which slot a player occupies, in the vocabulary already stored in this table.
 *
 * ⚠ A STARTER'S SLOT IS THEIR POSITION, NOT THE WORD "starter" — that is the existing convention,
 * confirmed against production where `WR`, `RB`, `QB`, `TE`, `DEF` and `K` all appear as slot types
 * alongside `bench`, `taxi` and `ir`. `normalizeSlotType` in `finalizeDraftToRedraftSeason` does the
 * same thing, and writing a different vocabulary here would split one column between two meanings.
 *
 * ⚠ NOT SHARED WITH THAT FUNCTION, DELIBERATELY. It matches a DRAFT PICK, which may carry no id and
 * so has to fuzzy-match on name; this matches a roster entry, which always has one. Same output
 * vocabulary, genuinely different matcher — sharing would mean giving the id-based case a name
 * fallback it does not need and cannot exercise.
 */
function slotTypeFor(playerData: unknown, playerId: string, position: string | null): string {
  const data = asRecord(playerData)

  const starters = data.starters
  if (Array.isArray(starters) && starters.some((e) => idOf(e) === playerId)) {
    return position || 'starter'
  }

  const sections = asRecord(data.lineup_sections ?? data.lineupSections)
  for (const [name, value] of Object.entries(sections)) {
    if (!Array.isArray(value)) continue
    if (!value.some((e) => idOf(e) === playerId)) continue
    const s = name.trim().toLowerCase()
    if (s === 'starters' || s === 'starter' || s === 'lineup') return position || 'starter'
    if (s === 'bench' || s === 'bn' || s === 'reserve') return 'bench'
    if (s === 'taxi') return 'taxi'
    if (s === 'ir') return 'ir'
    if (s === 'devy') return 'devy'
    return s
  }

  /*
   * The top-level `reserve` array is IR on every provider that writes it — the same reading
   * `lib/league-import` applies. Checked after `lineup_sections` so an explicit section wins.
   */
  const reserve = data.reserve
  if (Array.isArray(reserve) && reserve.some((e) => idOf(e) === playerId)) return 'ir'
  const taxi = data.taxi
  if (Array.isArray(taxi) && taxi.some((e) => idOf(e) === playerId)) return 'taxi'

  return 'bench'
}

/**
 * Project `Roster.playerData` into `RedraftRosterPlayer` for one league. Idempotent.
 *
 * ⚠ ONLY CREATES. It never drops or updates an existing live row, so a player traded or waived
 * through a redraft engine is not resurrected by a stale `playerData` blob. The generic roster is
 * the source for a roster that has NEVER been populated; once the redraft engines own it, they own
 * it. That asymmetry is deliberate — a two-way sync between two roster stores is the bug this
 * codebase already has twice.
 */
export async function materializeRedraftRosterPlayersForLeague(
  leagueId: string,
  opts?: { sport?: string | null },
): Promise<MaterializeResult> {
  // Links first: without `redraftRosterId` there is nowhere to write, and the reconciler is cheap
  // and idempotent. See `reconcileRosterRedraftLinks` for why the link is not set at creation time.
  await reconcileRosterRedraftLinks(leagueId).catch(() => undefined)

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true, playerData: true, redraftRosterId: true },
  })
  if (rosters.length === 0) return { ...EMPTY }

  const result: MaterializeResult = { ...EMPTY, rostersConsidered: rosters.length }
  const league = await prisma.league
    .findUnique({ where: { id: leagueId }, select: { sport: true, platform: true } })
    .catch(() => null)
  const sport = String(opts?.sport ?? league?.sport ?? 'NFL')
  const platform = String(league?.platform ?? '').toLowerCase()

  /*
   * 🛑 THE ENRICHMENT IS ONE LOOKUP FOR THE WHOLE LEAGUE, AGAINST `sleeperId`, AND BOTH HALVES OF
   * THAT MATTER.
   *
   * The first version asked `getNormalizedPlayerData({ surface: 'roster', leagueId, userId })`
   * per roster inside a `try {} catch {}`. Measured on NFL Dynasty 2026-09-04 it returned ZERO
   * rows, the bare catch said nothing, and `playerName: dto?.name ?? playerId` then wrote the
   * Sleeper id as the player's name -- 58,596 rows, 96.2% of the table, every one counted as
   * "created" and reported as success. Values are looked up BY NAME downstream, so nothing on
   * those rosters could be priced and the trade verdict went on saying it had too little to judge.
   *
   * ⚠ AND THE OBVIOUS REPAIR IS THE ONE THAT HAS ALREADY SHIPPED WRONG DATA TWICE HERE. A Sleeper
   * id must NEVER be looked up against `externalId`: three sources write bare numerics there, and
   * `lib/player-identity/externalIdNamespace.ts` measured 42,032 numeric collisions of which
   * 42,031 are a DIFFERENT PERSON. Probed on this league's own 241 ids:
   *
   *     sleeperIdWhere   241/241 matched   (100%)
   *     bare externalId  121 matched, 0 of 121 the same person
   *                      Justin Herbert -> "Damone Clark", Geno Smith -> an NBA player
   *
   * So this uses `sleeperIdWhere`, which queries the dedicated `sleeperId` column.
   */
  const bySleeperId = new Map<string, EnrichedPlayer>()
  if (platform === 'sleeper') {
    const allIds = [...new Set(rosters.flatMap((r) => getRosterPlayerIds(r.playerData)))]
    if (allIds.length) {
      const rows = await prisma.sportsPlayer
        .findMany({
          where: sleeperIdWhere(allIds, sport),
          select: { sleeperId: true, name: true, position: true, team: true, sport: true, source: true },
        })
        .catch(() => [])
      for (const row of rows) {
        const key = String(row.sleeperId ?? '')
        if (!key) continue
        const held = bySleeperId.get(key)
        if (held && sourceRank(held.source) <= sourceRank(row.source)) continue
        bySleeperId.set(key, row)
      }
    }
  }

  for (const r of rosters) {
    if (!r.redraftRosterId) {
      result.rostersSkippedNoLink += 1
      continue
    }
    result.rostersLinked += 1

    const playerIds = getRosterPlayerIds(r.playerData)
    if (playerIds.length === 0) {
      result.rostersSkippedNoPlayers += 1
      continue
    }

    const existing = await prisma.redraftRosterPlayer.findMany({
      where: { rosterId: r.redraftRosterId, droppedAt: null },
      select: { playerId: true },
    })
    const have = new Set(existing.map((e) => e.playerId))

    /*
     * Enrichment is best-effort and the row is written either way. A player with no metadata still
     * belongs on the roster — `captureSnapshot` reads POSITIONS to judge depth, and an unknown
     * position is a worse profile than a known one but a far better one than a missing player.
     */
    for (const playerId of playerIds) {
      const dto = bySleeperId.get(playerId)

      if (have.has(playerId)) {
        /*
         * 🛑 ALREADY PRESENT IS NOT ALREADY CORRECT, WHICH IS WHY THIS IS NOT A `continue`. The
         * create-only version skipped every one of the 58,596 rows it had itself written with the
         * id as the name, so re-running could never fix them. Repair only when we now hold
         * something better, and only when the stored row still carries the id-as-name signature —
         * a row someone else enriched properly is left alone.
         */
        if (dto?.name) {
          const repaired = await prisma.redraftRosterPlayer.updateMany({
            where: {
              rosterId: r.redraftRosterId,
              playerId,
              droppedAt: null,
              playerName: playerId,
            },
            data: {
              playerName: dto.name,
              position: dto.position ?? 'UNK',
              team: dto.team ?? null,
            },
          })
          result.playersRepaired += repaired.count
          if (repaired.count === 0) result.playersAlreadyPresent += 1
        } else {
          result.playersAlreadyPresent += 1
        }
        continue
      }
      const position = dto?.position ?? null
      await prisma.redraftRosterPlayer.create({
        data: {
          rosterId: r.redraftRosterId,
          playerId,
          playerName: dto?.name ?? playerId,
          // `position` is non-nullable on the model, and 'UNK' is what the draft path already
          // writes when a pick carries none — same placeholder rather than a second convention.
          position: position ?? 'UNK',
          team: dto?.team ?? null,
          sport: String(dto?.sport ?? sport),
          slotType: slotTypeFor(r.playerData, playerId, position),
          /*
           * ⚠ NEITHER COMES FROM THIS SOURCE, AND THAT IS A STATED GAP RATHER THAN A NULL THAT
           * LOOKS LIKE AN ANSWER. `SportsPlayer` has no `byeWeek` column at all and no
           * `injuryStatus` (it has `status`, which is roster/active state, not a game
           * designation). The column was already null for 60,909 of 60,911 rows before this
           * change, so nothing regresses here — but the picker's BYE chip is fed from this column,
           * so it stays blank until a writer with a real bye source fills it.
           */
          injuryStatus: null,
          byeWeek: null,
          // Matches the 2,110 rows already in this table that came from an import.
          acquisitionType: 'imported',
        },
      })
      result.playersCreated += 1
    }
  }

  return result
}

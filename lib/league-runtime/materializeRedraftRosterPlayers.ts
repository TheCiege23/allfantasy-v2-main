import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import {
  resolveSleeperRosterPlayers,
  type ResolvedSleeperPlayer,
} from '@/lib/player-identity/resolveSleeperRosterPlayers'
import { byeForTeam, resolveTeamByeWeeks } from '@/lib/schedule/teamByeWeeks'
import { getNormalizedPlayerData } from '@/lib/player-data/getNormalizedPlayerData'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import { reconcileRosterRedraftLinks } from './reconcileRosterRedraftLinks'


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
    .findUnique({ where: { id: leagueId }, select: { sport: true, platform: true, season: true } })
    .catch(() => null)
  const sport = String(opts?.sport ?? league?.sport ?? 'NFL')
  const platform = String(league?.platform ?? '').toLowerCase()

  /*
   * The bye is a property of the TEAM and this table has a real `Int?` column for it that
   * nothing has ever filled — 60,909 of 60,911 rows null. Derived once per league here so a
   * materialised row carries it, rather than being re-derived on every read.
   */
  const byeByTeam = await resolveTeamByeWeeks(sport, league?.season)

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
  let bySleeperId = new Map<string, ResolvedSleeperPlayer>()
  if (platform === 'sleeper') {
    const allIds = [...new Set(rosters.flatMap((r) => getRosterPlayerIds(r.playerData)))]
    bySleeperId = await resolveSleeperRosterPlayers(allIds, sport)
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
    /*
     * ⚠ A SECOND, SUPPLEMENTARY SOURCE, AND IT EXISTS FOR EXACTLY TWO FIELDS. `SportsPlayer` has
     * no `byeWeek` column and no `injuryStatus` — only the unified product view carries those, and
     * de3ade5bf fixed the path to the bye (`product.byeWeek`, not the top level, which had been
     * persisting null over a real value).
     *
     * 🛑 IT IS THE SUPPLEMENT AND NOT THE PRIMARY BECAUSE IT RETURNS NOTHING HERE. Measured on
     * NFL Dynasty 2026-09-04, `getNormalizedPlayerData` returned ZERO rows for every call shape
     * tried — with `userId`, without it, and without `leagueId`. That is consistent with
     * production: 60,909 of 60,911 rows carry a null bye. So de3ade5bf's path fix is correct and
     * currently inert, and keeping this call is what lets it start working the moment that source
     * does, rather than deleting a peer's fix because it happens to be dormant today.
     */
    const byUnifiedId = new Map<string, ReturnType<typeof serializeUnifiedPlayerForApi>>()
    try {
      const unified = await getNormalizedPlayerData({
        surface: 'roster',
        leagueId,
        userId: r.platformUserId,
        limit: 200,
      })
      for (const row of unified) {
        const d = serializeUnifiedPlayerForApi(row)
        byUnifiedId.set(d.id, d)
      }
    } catch {
      // Dormant is the normal case; an outage here must not keep the roster empty.
    }

    for (const playerId of playerIds) {
      const dto = bySleeperId.get(playerId)
      const extra = byUnifiedId.get(playerId)

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
              // A repaired row gets its bye too; it had none for the same reason it had no name.
              byeWeek: byeForTeam(byeByTeam, dto.team),
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
          injuryStatus: extra?.injuryStatus ?? null,
          /*
           * 🛑 NESTED UNDER `product`, PER de3ade5bf. `extra?.byeWeek` is `undefined`, `?? null`
           * makes it null, and this writes to a real `Int?` column — so the flat read persisted a
           * permanent absence that looked like the provider never supplied one. Nothing surfaced
           * it: no crash, no empty state, and `ignoreBuildErrors` means the build never saw the
           * type error.
           *
           * ⚠ THE VALUE IS STILL NULL IN PRACTICE, and that is the supplement being dormant rather
           * than this path being wrong. See the comment above the lookup.
           */
          /*
           * ⚠ TWO SOURCES, SUPPLEMENT FIRST. de3ade5bf established that the unified view keeps
           * the bye at `product.byeWeek`, not the top level; that path is kept and preferred
           * because it is per-PLAYER and so survives a mid-season trade the team map cannot see.
           * It is dormant today (zero rows), which is why the schedule derivation is behind it
           * rather than instead of it.
           */
          byeWeek: extra?.product?.byeWeek ?? byeForTeam(byeByTeam, dto?.team) ?? null,
          // Matches the 2,110 rows already in this table that came from an import.
          acquisitionType: 'imported',
        },
      })
      result.playersCreated += 1
    }
  }

  return result
}

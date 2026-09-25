/**
 * Fill in `dw_draft_facts.metadata.ownerSleeperId` for Sleeper draft picks imported before the
 * sync recorded it (SleeperHistoricalDraftSyncService `sleeperPickOwnerId`).
 *
 * WHY A BACKFILL AND NOT A RE-SYNC: the sync's completion gate never re-reads a finished season,
 * and forcing it would DELETE and re-create every pick of every season (its write is
 * deleteMany + createMany). This only ADDS the owner to rows that lack one, matched on the pick
 * itself — season, round, pick number and player — and never touches a row it cannot match.
 * Re-running it is a no-op for every row already filled.
 *
 * ⚠ ORDER MATTERS: run it only once the sync change is DEPLOYED. The in-progress season is
 * re-synced daily, and the pre-change sync re-creates those rows WITHOUT an owner, which would
 * undo this for the current season.
 */
import { normalizePickNumber, sleeperOwnerByRosterId, sleeperPickOwnerId } from './sleeperDraftPickIdentity'

export type SleeperSeasonDraftSource = {
  season: number
  /** That season's rosters payload (`roster_id`, `owner_id`); null when it could not be read. */
  rosters: unknown[] | null
  /** Every draft that season, each with its picks. */
  drafts: Array<{ draftId: string; picks: unknown[] | null }>
}

export type ExistingDraftFact = {
  draftId: string
  season: number | null
  round: number
  pickNumber: number
  playerId: string
  metadata: unknown
}

export type DraftOwnerUpdate = { draftId: string; ownerSleeperId: string }

export type DraftOwnerPlan = {
  updates: DraftOwnerUpdate[]
  /** Rows that already carry an owner — left alone. */
  alreadyOwned: number
  /** Rows no Sleeper pick matched — left alone, never guessed. */
  unmatched: number
  /** Picks whose owner could not be read (no owner on that season's roster). */
  ownerUnknown: number
}

function key(season: number, round: number, pickNumber: number, playerId: string): string {
  return `${season}|${round}|${pickNumber}|${playerId}`
}

function hasOwner(metadata: unknown): boolean {
  return Boolean(
    metadata && typeof metadata === 'object' && typeof (metadata as { ownerSleeperId?: unknown }).ownerSleeperId === 'string',
  )
}

/**
 * Pure: which existing rows get which owner. The pick number is derived exactly as the sync
 * derives it (`normalizePickNumber`), so a row written by the sync matches its source pick.
 */
export function planDraftOwnerBackfill(existing: ExistingDraftFact[], sources: SleeperSeasonDraftSource[]): DraftOwnerPlan {
  const ownerByKey = new Map<string, string | null>()
  let ownerUnknown = 0
  for (const source of sources) {
    const owners = sleeperOwnerByRosterId(source.rosters)
    for (const draft of source.drafts) {
      for (const [index, pick] of (draft.picks ?? []).entries()) {
        const p = pick as { player_id?: unknown; round?: unknown } | null
        const playerId = typeof p?.player_id === 'string' ? p.player_id.trim() : ''
        const round = Number(p?.round)
        if (!playerId || !Number.isFinite(round) || round <= 0) continue
        const pickNumber = normalizePickNumber(pick, index + 1)
        const owner = sleeperPickOwnerId(pick, owners)
        if (!owner) ownerUnknown += 1
        const k = key(source.season, round, pickNumber, playerId)
        // Two drafts in one season that share a round, pick and player cannot be told apart —
        // and would be the same person's pick only by accident. Refuse to guess.
        ownerByKey.set(k, ownerByKey.has(k) && ownerByKey.get(k) !== owner ? null : owner)
      }
    }
  }

  const updates: DraftOwnerUpdate[] = []
  let alreadyOwned = 0
  let unmatched = 0
  for (const row of existing) {
    if (hasOwner(row.metadata)) {
      alreadyOwned += 1
      continue
    }
    const owner = row.season == null ? null : ownerByKey.get(key(row.season, row.round, row.pickNumber, row.playerId))
    if (!owner) {
      unmatched += 1
      continue
    }
    updates.push({ draftId: row.draftId, ownerSleeperId: owner })
  }
  return { updates, alreadyOwned, unmatched, ownerUnknown }
}

export type DraftOwnerBackfillDeps = {
  /** Every League row for the league's Sleeper chain, newest first (getSleeperHistoricalLeagueChain). */
  chain(platformLeagueId: string): Promise<Array<{ externalLeagueId: string; season: number }>>
  rosters(externalLeagueId: string): Promise<unknown[] | null>
  drafts(externalLeagueId: string): Promise<Array<{ draft_id?: unknown }> | null>
  picks(draftId: string): Promise<unknown[] | null>
  existing(leagueId: string): Promise<ExistingDraftFact[]>
  /** Adds the owner to each row that still lacks one. Returns rows written. */
  write(updates: DraftOwnerUpdate[]): Promise<number>
}

export type DraftOwnerBackfillResult = DraftOwnerPlan & {
  leagueId: string
  seasonsRead: number[]
  written: number
}

/**
 * One league. Reads Sleeper ONLY for seasons that still have a pick without an owner, so a re-run
 * after a complete pass costs one database read and no provider calls.
 */
export async function backfillLeagueDraftOwners(
  deps: DraftOwnerBackfillDeps,
  league: { id: string; platformLeagueId: string },
  opts: { apply: boolean },
): Promise<DraftOwnerBackfillResult> {
  const existing = await deps.existing(league.id)
  const needed = new Set(
    existing.filter((r) => !hasOwner(r.metadata) && r.season != null).map((r) => r.season as number),
  )
  const empty: DraftOwnerBackfillResult = {
    leagueId: league.id,
    seasonsRead: [],
    written: 0,
    updates: [],
    alreadyOwned: existing.filter((r) => hasOwner(r.metadata)).length,
    unmatched: 0,
    ownerUnknown: 0,
  }
  if (needed.size === 0) return empty

  const chain = (await deps.chain(league.platformLeagueId)).filter((c) => needed.has(c.season))
  const sources: SleeperSeasonDraftSource[] = []
  for (const season of chain) {
    const [rosters, drafts] = await Promise.all([deps.rosters(season.externalLeagueId), deps.drafts(season.externalLeagueId)])
    const draftIds = [
      ...new Set((drafts ?? []).map((d) => (typeof d?.draft_id === 'string' ? d.draft_id.trim() : '')).filter(Boolean)),
    ]
    const withPicks: SleeperSeasonDraftSource['drafts'] = []
    for (const draftId of draftIds) withPicks.push({ draftId, picks: await deps.picks(draftId) })
    sources.push({ season: season.season, rosters, drafts: withPicks })
  }

  const plan = planDraftOwnerBackfill(existing, sources)
  const written = opts.apply && plan.updates.length > 0 ? await deps.write(plan.updates) : 0
  return { ...plan, leagueId: league.id, seasonsRead: sources.map((s) => s.season).sort((a, b) => a - b), written }
}

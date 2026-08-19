/**
 * Fantasy OS Suite — Phase V8.2: bounded historical evidence fetch + provider-neutral normalization.
 *
 * The ONLY place (with the V7.1 client) that reads Sleeper — it maps raw payloads into the neutral
 * contracts and never lets a provider identifier or raw payload escape. Bounded by an explicit week cap;
 * a genuinely empty week is recorded as `empty`, never a failure. Reuses the injected `SleeperFetch`.
 */
import type { SleeperFetch } from '../sleeperCohortClient'
import {
  type LeagueEvidenceBundle,
  type CategoryStatus,
  type RosterMembership,
  type StandingRecord,
  type NormalizedMatchup,
  type NormalizedTransaction,
  type DraftParticipation,
  type PostseasonResult,
  emptyEvidenceBundle,
} from './contracts'

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: validation-only DB-less cohort tooling (CLI + tests, never customer runtime)

// ── Raw Sleeper shapes (only mapped fields) ───────────────────────────────────
type RawRoster = {
  roster_id: number
  owner_id?: string | null
  players?: string[] | null
  starters?: string[] | null
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number; fpts_decimal?: number; fpts_against?: number; fpts_against_decimal?: number }
}
type RawMatchup = { roster_id: number; points?: number; matchup_id?: number | null }
type RawTransaction = {
  /** Provider transaction id — used ONLY for fetch-time dedup (ingestion metadata); never persisted. */
  transaction_id?: string
  type?: string
  status?: string
  leg?: number
  roster_ids?: number[]
  adds?: Record<string, number> | null
  drops?: Record<string, number> | null
  settings?: { waiver_bid?: number } | null
}
type RawDraft = { draft_id: string; status?: string; settings?: { rounds?: number } }
type RawPick = { roster_id?: number }
type RawBracketMatch = { w?: number | null; l?: number | null; p?: number | null }

export type EvidenceFetchOptions = { maxWeeks?: number }

// ── Pure normalizers (exported for tests) ─────────────────────────────────────

export function normalizeRosters(rosters: RawRoster[]): { membership: RosterMembership[]; standings: StandingRecord[] } {
  const membership = rosters.map((r) => ({
    rosterId: r.roster_id,
    hasOwner: !!r.owner_id,
    playerCount: r.players?.length ?? 0,
    starterCount: r.starters?.length ?? 0,
  }))
  const standings = rosters.map((r) => ({
    rosterId: r.roster_id,
    wins: r.settings?.wins ?? 0,
    losses: r.settings?.losses ?? 0,
    ties: r.settings?.ties ?? 0,
    pointsFor: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
    pointsAgainst: (r.settings?.fpts_against ?? 0) + (r.settings?.fpts_against_decimal ?? 0) / 100,
  }))
  return { membership, standings }
}

export function normalizeMatchupWeek(week: number, raw: RawMatchup[]): NormalizedMatchup[] {
  return raw.map((m) => ({ week, rosterId: m.roster_id, points: m.points ?? 0, matchupId: m.matchup_id ?? null }))
}

export function normalizeTransaction(week: number, t: RawTransaction): NormalizedTransaction | null {
  if (t.status && t.status !== 'complete') return null
  const type = t.type === 'trade' ? 'trade' : t.type === 'waiver' ? 'waiver' : t.type === 'free_agent' ? 'free_agent' : null
  if (!type) return null
  const faab = type === 'waiver' && typeof t.settings?.waiver_bid === 'number' ? t.settings.waiver_bid : null
  return {
    type,
    week,
    participatingRosterIds: [...(t.roster_ids ?? [])].sort((a, b) => a - b),
    addsCount: t.adds ? Object.keys(t.adds).length : 0,
    dropsCount: t.drops ? Object.keys(t.drops).length : 0,
    faabSpent: faab,
  }
}

function bracketPlacements(matches: RawBracketMatch[], bracket: 'winners' | 'losers'): PostseasonResult[] {
  const out: PostseasonResult[] = []
  for (const m of matches) {
    if (typeof m.w === 'number' && typeof m.p === 'number') out.push({ rosterId: m.w, placement: m.p, bracket })
    if (typeof m.l === 'number' && typeof m.p === 'number') out.push({ rosterId: m.l, placement: m.p + 1, bracket })
  }
  return out
}

// ── Orchestrated bounded fetch ────────────────────────────────────────────────

export async function fetchLeagueEvidence(
  leagueId: string,
  fetchJson: SleeperFetch,
  opts: EvidenceFetchOptions = {},
): Promise<LeagueEvidenceBundle> {
  const maxWeeks = opts.maxWeeks ?? 18
  const bundle = emptyEvidenceBundle()

  // Rosters + standings.
  const rosters = await fetchJson<RawRoster[]>(`${SLEEPER_BASE}/league/${leagueId}/rosters`)
  if (rosters) {
    const { membership, standings } = normalizeRosters(rosters)
    bundle.rosterMembership = membership
    bundle.standings = standings
    bundle.status.rosters = membership.length ? 'data' : 'empty'
    bundle.status.standings = standings.length ? 'data' : 'empty'
  } else {
    bundle.status.rosters = 'unavailable'
    bundle.status.standings = 'unavailable'
  }

  // Matchups (bounded weeks).
  let mFetched = 0
  let mFailed = 0
  for (let w = 1; w <= maxWeeks; w++) {
    const raw = await fetchJson<RawMatchup[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${w}`)
    if (raw === null) { mFailed++; continue }
    mFetched++
    if (raw.length) {
      bundle.matchups.push(...normalizeMatchupWeek(w, raw))
      bundle.checkpoints.latestMatchupWeek = w
    }
  }
  bundle.status.matchups = mFetched === 0 ? 'unavailable' : mFailed > 0 ? 'partial' : bundle.matchups.length ? 'data' : 'empty'

  // Transactions (bounded weeks). Request-dedup by provider transaction_id so the same transaction is
  // never ingested twice (the id is ingestion metadata only — it is not persisted).
  let tFetched = 0
  let tFailed = 0
  const seenTxIds = new Set<string>()
  for (let w = 1; w <= maxWeeks; w++) {
    const raw = await fetchJson<RawTransaction[]>(`${SLEEPER_BASE}/league/${leagueId}/transactions/${w}`)
    if (raw === null) { tFailed++; continue }
    tFetched++
    const deduped = raw.filter((t) => {
      if (!t.transaction_id) return true
      if (seenTxIds.has(t.transaction_id)) return false
      seenTxIds.add(t.transaction_id)
      return true
    })
    const norm = deduped.map((t) => normalizeTransaction(w, t)).filter((x): x is NormalizedTransaction => x !== null)
    if (norm.length) {
      bundle.transactions.push(...norm)
      bundle.checkpoints.latestTransactionWeek = w
    }
  }
  const trades = bundle.transactions.filter((t) => t.type === 'trade')
  const waivers = bundle.transactions.filter((t) => t.type === 'waiver')
  const freeAgents = bundle.transactions.filter((t) => t.type === 'free_agent')
  const txStatus: CategoryStatus = tFetched === 0 ? 'unavailable' : tFailed > 0 ? 'partial' : bundle.transactions.length ? 'data' : 'empty'
  bundle.status.trades = trades.length ? 'data' : txStatus === 'data' ? 'empty' : txStatus
  bundle.status.waivers = waivers.length ? 'data' : txStatus === 'data' ? 'empty' : txStatus
  bundle.status.free_agents = freeAgents.length ? 'data' : txStatus === 'data' ? 'empty' : txStatus
  bundle.status.faab = waivers.some((w) => w.faabSpent !== null) ? 'data' : 'unavailable'

  // Draft + picks.
  const drafts = await fetchJson<RawDraft[]>(`${SLEEPER_BASE}/league/${leagueId}/drafts`)
  if (drafts && drafts.length) {
    const d = drafts[0]!
    const picks = (await fetchJson<RawPick[]>(`${SLEEPER_BASE}/draft/${d.draft_id}/picks`)) ?? []
    const status = d.status === 'complete' ? 'complete' : d.status === 'drafting' ? 'drafting' : d.status === 'pre_draft' ? 'pre_draft' : 'unknown'
    const draft: DraftParticipation = {
      draftId: true,
      status,
      rounds: d.settings?.rounds ?? null,
      pickCount: picks.length,
      participatingRosterCount: new Set(picks.map((p) => p.roster_id).filter((r): r is number => typeof r === 'number')).size,
    }
    bundle.draft = draft
    bundle.status.drafts = 'data'
    bundle.status.draft_picks = picks.length ? 'data' : 'empty'
    bundle.checkpoints.draftComplete = status === 'complete'
  } else {
    bundle.status.drafts = 'unavailable'
    bundle.status.draft_picks = 'unavailable'
  }

  // Postseason brackets (best-effort; provider limitation when absent).
  const [winners, losers] = await Promise.all([
    fetchJson<RawBracketMatch[]>(`${SLEEPER_BASE}/league/${leagueId}/winners_bracket`),
    fetchJson<RawBracketMatch[]>(`${SLEEPER_BASE}/league/${leagueId}/losers_bracket`),
  ])
  if (winners) bundle.postseason.push(...bracketPlacements(winners, 'winners'))
  if (losers) bundle.postseason.push(...bracketPlacements(losers, 'losers'))

  bundle.status.metadata = 'data'
  return bundle
}

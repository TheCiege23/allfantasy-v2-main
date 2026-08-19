import 'server-only'

import type { SleeperTransaction } from '@/lib/sleeper-client'
import {
  getAllPlayers,
  getLeagueRosters,
  getLeagueTransactions,
  getLeagueUsers,
} from '@/lib/api-cache/SleeperCacheLayer'

/**
 * Pending Sleeper trades, scanned for ONE league.
 *
 * WHY THIS EXISTS: pending (proposed, not yet accepted) trades made on Sleeper
 * were invisible to AllFantasy. The Sleeper importer only fetches users,
 * rosters, draft picks and traded picks — it never calls `/transactions/` — and
 * the league Trades panel reads only `AfLeagueTrade`, the table for trades
 * proposed INSIDE AllFantasy. So a real proposal sitting in a user's Sleeper
 * league showed as "Active Trades 0", and nothing could analyze it because
 * nothing knew it existed.
 *
 * Sleeper's public API DOES expose these: `/league/<id>/transactions/<week>`
 * returns `type: "trade"` rows with `status: "pending"`. This logic already ran
 * in production inside `lib/dashboard-strip/fetchTradesDashboard.ts`, but was
 * trapped in a per-user dashboard loop. It is extracted here verbatim in
 * behavior so any league-scoped surface can reuse it.
 *
 * READ-ONLY BY CONSTRUCTION: Sleeper's public API offers no write endpoint, so
 * AllFantasy can surface and analyze these trades but can never accept, reject
 * or counter them. Callers MUST NOT render accept/reject controls for these
 * rows — link the manager to Sleeper instead. This is the same see-and-advise
 * boundary used for imported-league waiver claims.
 */

export interface PendingTradeAsset {
  playerId: string | null
  playerName: string
  position: string
  team: string
  isPick?: boolean
  pickRound?: string
}

export interface PendingProviderTrade {
  /** Sleeper's transaction id — stable, and the natural idempotency key. */
  transactionId: string
  proposedBy: string
  /**
   * True when the VIEWER created this offer. Without it a trade the user sent
   * would render as incoming — i.e. facing the wrong way, with "given" and
   * "received" reading backwards to them.
   */
  proposedByViewer: boolean
  proposedAt: string | null
  /** Assets leaving the viewer's roster. */
  assetsGiven: PendingTradeAsset[]
  /** Assets arriving on the viewer's roster. */
  assetsReceived: PendingTradeAsset[]
  /** Always true — AF cannot act on provider-side trades. */
  readOnly: true
  provider: 'sleeper'
}

type SleeperRosterRow = { roster_id?: number; owner_id?: string }
type SleeperUserRow = { user_id: string; display_name?: string; metadata?: { team_name?: string } }
type SleeperPlayerRow = {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string
}

/** Sleeper reports pending trades under several spellings across eras. */
export function isPendingTradeStatus(status: string | undefined | null): boolean {
  if (!status) return false
  const s = String(status).toLowerCase()
  return s === 'pending' || s === 'proposed' || s === 'waiting' || s === 'requested'
}

function ordinal(round: number): string {
  return round === 1 ? 'st' : round === 2 ? 'nd' : round === 3 ? 'rd' : 'th'
}

function playerName(row: SleeperPlayerRow | undefined, fallbackId: string): string {
  return row?.full_name ?? ([row?.first_name, row?.last_name].filter(Boolean).join(' ') || fallbackId)
}

/**
 * Pure: split one Sleeper trade transaction into given/received from the
 * perspective of a specific roster. Exported for unit tests.
 */
export function buildTradeAssetsForRoster(args: {
  tx: Pick<SleeperTransaction, 'adds' | 'drops' | 'draft_picks'>
  userRosterId: number
  players: Record<string, SleeperPlayerRow>
}): { assetsGiven: PendingTradeAsset[]; assetsReceived: PendingTradeAsset[] } {
  const { tx, userRosterId, players } = args
  const assetsGiven: PendingTradeAsset[] = []
  const assetsReceived: PendingTradeAsset[] = []

  for (const [playerId, rosterId] of Object.entries(tx.drops ?? {})) {
    if (Number(rosterId) !== userRosterId) continue
    const pl = players[playerId]
    assetsGiven.push({
      playerId,
      playerName: playerName(pl, playerId),
      position: pl?.position ?? '—',
      team: pl?.team ?? '—',
    })
  }

  for (const [playerId, rosterId] of Object.entries(tx.adds ?? {})) {
    if (Number(rosterId) !== userRosterId) continue
    const pl = players[playerId]
    assetsReceived.push({
      playerId,
      playerName: playerName(pl, playerId),
      position: pl?.position ?? '—',
      team: pl?.team ?? '—',
    })
  }

  for (const pick of tx.draft_picks ?? []) {
    const label = `${pick.season} ${pick.round}${ordinal(pick.round)}`
    // `roster_id` on a Sleeper draft pick is the roster RECEIVING it;
    // `previous_owner_id` is the roster giving it up.
    if (pick.roster_id === userRosterId) {
      assetsReceived.push({
        playerId: null,
        playerName: `${label} round pick`,
        position: 'PICK',
        team: '—',
        isPick: true,
        pickRound: label,
      })
    } else if (
      (pick as { previous_owner_id?: number }).previous_owner_id === userRosterId
    ) {
      assetsGiven.push({
        playerId: null,
        playerName: `${label} round pick`,
        position: 'PICK',
        team: '—',
        isPick: true,
        pickRound: label,
      })
    }
  }

  return { assetsGiven, assetsReceived }
}

/**
 * Scan one Sleeper league for pending trades involving `ownerSleeperId`.
 * Never throws — a provider hiccup returns an empty list so the caller's own
 * data still renders.
 */
export async function scanPendingSleeperTradesForLeague(args: {
  platformLeagueId: string
  ownerSleeperId: string
  sport?: string | null
  /** Sleeper stores transactions per week; 1–18 covers a full NFL season. */
  weeks?: number[]
}): Promise<PendingProviderTrade[]> {
  const { platformLeagueId, ownerSleeperId } = args
  if (!platformLeagueId?.trim() || !ownerSleeperId?.trim()) return []

  try {
    const [rosters, users] = await Promise.all([
      getLeagueRosters(platformLeagueId).catch(() => []),
      getLeagueUsers(platformLeagueId).catch(() => []),
    ])

    const roster = (Array.isArray(rosters) ? (rosters as SleeperRosterRow[]) : []).find(
      (r) => String(r.owner_id) === String(ownerSleeperId),
    )
    const userRosterId = Number(roster?.roster_id)
    if (!Number.isFinite(userRosterId)) return []

    const userById = new Map(
      (Array.isArray(users) ? (users as SleeperUserRow[]) : [])
        .filter((u) => typeof u.user_id === 'string')
        .map((u) => [u.user_id, u]),
    )

    const players: Record<string, SleeperPlayerRow> =
      String(args.sport ?? 'NFL').toUpperCase() === 'NFL'
        ? ((await getAllPlayers().catch(() => ({}))) as Record<string, SleeperPlayerRow>)
        : {}

    const weeks = args.weeks ?? Array.from({ length: 18 }, (_, i) => i + 1)
    const seen = new Set<string>()
    const out: PendingProviderTrade[] = []

    for (const week of weeks) {
      const transactions = (await getLeagueTransactions(platformLeagueId, week).catch(
        () => [],
      )) as SleeperTransaction[]
      if (!Array.isArray(transactions)) continue

      for (const tx of transactions) {
        if (tx.type !== 'trade') continue
        if (!isPendingTradeStatus(tx.status)) continue
        if (!tx.roster_ids?.includes(userRosterId)) continue
        if (seen.has(tx.transaction_id)) continue
        seen.add(tx.transaction_id)

        const { assetsGiven, assetsReceived } = buildTradeAssetsForRoster({
          tx,
          userRosterId,
          players,
        })

        const creator = tx.creator ? userById.get(tx.creator) : undefined
        const proposedByViewer = Boolean(tx.creator && String(tx.creator) === String(ownerSleeperId))
        out.push({
          transactionId: tx.transaction_id,
          proposedBy: proposedByViewer
            ? 'You'
            : creator?.metadata?.team_name ||
              creator?.display_name ||
              (tx.creator ? `Manager ${tx.creator.slice(0, 6)}` : 'Another team'),
          proposedByViewer,
          proposedAt: tx.created ? new Date(tx.created).toISOString() : null,
          assetsGiven,
          assetsReceived,
          readOnly: true,
          provider: 'sleeper',
        })
      }
    }

    return out
  } catch {
    // Provider unavailability must never break the caller's own panel.
    return []
  }
}

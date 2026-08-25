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
  /*
   * Machine-readable pick coordinates alongside the human label.
   *
   * WHY BOTH: `pickRound` is "2027 1st", which is right for a panel and wrong
   * for anything that has to rebuild the pick as an asset. A consumer that
   * loads one of these offers into a trade builder needs the year and the round
   * as numbers, and parsing them back out of the label is a regex that breaks
   * the first time the label is reworded.
   */
  pickYear?: number
  pickRoundNumber?: number
  /** Set on a FAAB line, in dollars. */
  faabAmount?: number
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
  tx: Partial<Pick<SleeperTransaction, 'adds' | 'drops' | 'draft_picks' | 'waiver_budget'>>
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
        pickYear: Number(pick.season),
        pickRoundNumber: pick.round,
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
        pickYear: Number(pick.season),
        pickRoundNumber: pick.round,
      })
    }
  }

  /*
   * ⚠ FAAB WAS BEING DROPPED ON THE FLOOR. Sleeper carries budget transfers on
   * the same trade under `waiver_budget`, and this function ignored them — so a
   * deal that was "my WR2 for your WR3 plus $40" rendered as a straight player
   * swap, and every side of it read as worse than it was. In a league where
   * FAAB is the scarce asset (guillotine, survivor) that omission is the whole
   * trade.
   */
  for (const move of tx.waiver_budget ?? []) {
    const amount = Number(move.amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const line: PendingTradeAsset = {
      playerId: null,
      playerName: `$${amount} FAAB`,
      position: 'FAAB',
      team: '—',
      faabAmount: amount,
    }
    if (Number(move.sender) === userRosterId) assetsGiven.push(line)
    else if (Number(move.receiver) === userRosterId) assetsReceived.push(line)
  }

  return { assetsGiven, assetsReceived }
}

/**
 * What the scan was actually able to do.
 *
 * ⚠ AN EMPTY LIST IS NOT AN ANSWER ON ITS OWN. `scanPendingSleeperTradesForLeague`
 * returns `[]` for four different situations — nothing is pending, we could not
 * work out which roster is the viewer's, Sleeper did not answer, or the league
 * was never a Sleeper league. A surface that renders all four as "no offers
 * waiting" states a fact we never established, which is exactly the failure the
 * Trades screen's `inbox.reason` was written to avoid.
 *
 * So the scan reports whether it ran. Callers that want to say "nothing is
 * waiting" must check `scanned` first; callers that only want the rows can keep
 * using the list-returning wrapper below.
 */
export type PendingTradeScan = {
  trades: PendingProviderTrade[]
  /** True only when Sleeper answered and the viewer's roster was identified. */
  scanned: boolean
  /** Why the scan did not run. Null when it did. */
  reason: string | null
  /**
   * Weeks Sleeper refused while others answered. A partial scan still counts as
   * scanned — but "nothing waiting" is weaker than it looks, and the caller
   * should say so rather than round it up to a clean empty.
   */
  weeksUnanswered: number
}

/**
 * Scan one Sleeper league for pending trades involving `ownerSleeperId`, and
 * report whether the scan actually happened.
 *
 * Never throws — a provider hiccup comes back as `scanned: false` with a reason.
 */
export async function scanPendingSleeperTrades(args: {
  platformLeagueId: string
  ownerSleeperId: string
  sport?: string | null
  /** Sleeper stores transactions per week; 1–18 covers a full NFL season. */
  weeks?: number[]
}): Promise<PendingTradeScan> {
  const { platformLeagueId, ownerSleeperId } = args
  if (!platformLeagueId?.trim() || !ownerSleeperId?.trim()) {
    return {
      trades: [],
      scanned: false,
      reason: 'we do not know which Sleeper account is yours in this league',
      weeksUnanswered: 0,
    }
  }

  try {
    const [rosters, users] = await Promise.all([
      getLeagueRosters(platformLeagueId).catch(() => []),
      getLeagueUsers(platformLeagueId).catch(() => []),
    ])

    const roster = (Array.isArray(rosters) ? (rosters as SleeperRosterRow[]) : []).find(
      (r) => String(r.owner_id) === String(ownerSleeperId),
    )
    const userRosterId = Number(roster?.roster_id)
    if (!Number.isFinite(userRosterId)) {
      return {
        trades: [],
        scanned: false,
        reason: 'no roster in this Sleeper league is owned by your linked account',
        weeksUnanswered: 0,
      }
    }

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
    let weeksUnanswered = 0

    for (const week of weeks) {
      /*
       * ⚠ A THROW AND AN EMPTY WEEK ARE DIFFERENT FACTS. The previous
       * `.catch(() => [])` turned "Sleeper refused" into "no transactions this
       * week", which is how an outage became an empty inbox. A null body is
       * still treated as empty — that is Sleeper's own spelling for a quiet
       * week, not a failure.
       */
      let transactions: SleeperTransaction[]
      try {
        const raw = await getLeagueTransactions(platformLeagueId, week)
        transactions = Array.isArray(raw) ? (raw as unknown as SleeperTransaction[]) : []
      } catch {
        weeksUnanswered += 1
        continue
      }

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

    /* Every week refused: we looked at nothing, so we know nothing. */
    if (weeksUnanswered >= weeks.length) {
      return {
        trades: [],
        scanned: false,
        reason: 'Sleeper did not answer for this league',
        weeksUnanswered,
      }
    }

    return { trades: out, scanned: true, reason: null, weeksUnanswered }
  } catch {
    // Provider unavailability must never break the caller's own panel.
    return {
      trades: [],
      scanned: false,
      reason: 'Sleeper could not be reached',
      weeksUnanswered: 0,
    }
  }
}

/**
 * The list-only form, kept because most callers just want the rows.
 *
 * ⚠ USE THE SCAN ABOVE IF YOU INTEND TO RENDER AN EMPTY STATE. This returns
 * `[]` for "nothing pending" and for "we never looked", and those must not read
 * the same on screen.
 */
export async function scanPendingSleeperTradesForLeague(args: {
  platformLeagueId: string
  ownerSleeperId: string
  sport?: string | null
  weeks?: number[]
}): Promise<PendingProviderTrade[]> {
  return (await scanPendingSleeperTrades(args)).trades
}

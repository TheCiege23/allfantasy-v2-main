/**
 * Decision OS — Phase 5.1 Behavioral Event Port.
 *
 * READ-ONLY data-access layer. Loads raw rows from WaiverClaim, AfLeagueTrade,
 * AfRosterMoveHistory, DraftSession, and DraftPick into typed raw-row interfaces.
 * No writes, no mutations, no external API calls.
 *
 * Architecture invariants (ADR_PHASE5_1_BEHAVIORAL_EVENT_PORTS.md):
 * - All DB access is read-only (findUnique / findMany only)
 * - managerId resolution uses native AppUser id fields; null when absent
 * - Timestamps: always system-generated createdAt → exact confidence
 * - No provider fields (all sources are native AF tables → provider: null)
 * - Row limit: 500 rows max per source per call (see MAX_ROWS)
 *
 * Phase 2E addition (docs/DECISION_OS_MANAGER_DNA_PHASE2D_REAL_DATA_READINESS.md
 * §5–§6): the live redraft product does NOT write to AfLeagueTrade or
 * AfRosterMoveHistory — it writes to RedraftTradeProposal/RedraftTradeAsset
 * (trades, via app/api/redraft/trade-proposals/route.ts) and RedraftRoster/
 * RedraftRosterPlayer (roster composition, via app/api/redraft/roster/route.ts).
 * `loadRedraftTradeRows` and `loadRedraftRosterPlayerRows` below are new,
 * additive loaders reading those tables so real redraft activity becomes
 * visible to the same downstream pipeline — nothing above this comment changed.
 *
 * Phase 2H addition (docs/DECISION_OS_MANAGER_DNA_PHASE2G_VOLUME_AND_LINEUP_HISTORY_SCOPE.md
 * §2): `loadRedraftRosterMoveRows` reads the new RedraftRosterMoveHistory
 * table (written by app/api/redraft/roster/route.ts's PATCH handler), which
 * — unlike the free-agent-derived roster signal above — carries a real,
 * non-null `week`, making it visible to Phase 6.1's lineup-based pattern
 * detectors for the first time.
 */

import { prisma } from '@/lib/prisma'

const MAX_ROWS = 500

// ── Raw row interfaces ────────────────────────────────────────────────────────

export interface RawWaiverClaimRow {
  id: string
  leagueId: string
  rosterId: string
  /** AppUser.id — null for legacy rows or system-initiated claims. */
  userId: string | null
  addPlayerId: string
  dropPlayerId: string | null
  /** FAAB bid amount; null for priority-based leagues. */
  faabBid: number | null
  priorityOrder: number
  claimType: string
  /** 'pending' | 'awarded' | 'denied' (or similar — use processedAt as the canonical gate). */
  status: string
  processedAt: Date | null
  resultMessage: string | null
  createdAt: Date
}

export interface RawLeagueTradeRow {
  id: string
  leagueId: string
  /** AppUser.id of the proposer — always present in AfLeagueTrade. */
  proposedByUserId: string
  proposerRosterId: string
  receiverRosterId: string
  status: string
  /** 'commissioner' | 'league_vote' | 'no_veto'. */
  reviewType: string
  acceptedAt: Date | null
  rejectedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  /** Count of AfLeagueTradeItem rows for this trade (derived via _count). */
  itemCount: number
}

export interface RawRosterMoveRow {
  id: string
  leagueId: string
  rosterId: string
  season: number
  week: number
  /** AppUser.id (or external actor id) — nullable. */
  actorUserId: string | null
  /** 'user' | 'commissioner' | 'import' | 'system'. */
  source: string
  moveSummary: string | null
  createdAt: Date
}

export interface RawDraftSessionRow {
  id: string
  leagueId: string
  /** 'pre_draft' | 'in_progress' | 'completed' | etc. */
  status: string
  /** 'snake' | 'linear' | 'auction'. */
  draftType: string
  rounds: number
  teamCount: number
  createdAt: Date
  sportType: string | null
}

export interface RawDraftPickRow {
  id: string
  sessionId: string
  /** Carried from DraftSession — not a native column; set by the port. */
  leagueId: string
  overall: number
  round: number
  slot: number
  rosterId: string
  playerName: string
  position: string
  team: string | null
  playerId: string | null
  assetType: string | null
  amount: number | null
  ownerUserId: string | null
  pickedAt: Date | null
  createdAt: Date
  sportType: string | null
}

// ── Loader functions ──────────────────────────────────────────────────────────

/**
 * Load WaiverClaim rows for a league, optionally since a cutoff date.
 * Returns both submitted (pending) and processed (awarded/denied) rows.
 */
export async function loadWaiverClaimRows(
  leagueId: string,
  since?: Date,
): Promise<RawWaiverClaimRow[]> {
  const rows = await prisma.waiverClaim.findMany({
    where: {
      leagueId,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true,
      leagueId: true,
      rosterId: true,
      userId: true,
      addPlayerId: true,
      dropPlayerId: true,
      faabBid: true,
      priorityOrder: true,
      claimType: true,
      status: true,
      processedAt: true,
      resultMessage: true,
      createdAt: true,
    },
  })
  return rows.map((row: {
    id: string
    leagueId: string
    rosterId: string
    userId: string | null
    addPlayerId: string
    dropPlayerId: string | null
    faabBid: number | null
    priorityOrder: number
    claimType: string
    status: string
    processedAt: Date | null
    resultMessage: string | null
    createdAt: Date
  }): RawWaiverClaimRow => ({
    id: row.id,
    leagueId: row.leagueId,
    rosterId: row.rosterId,
    userId: row.userId ?? null,
    addPlayerId: row.addPlayerId,
    dropPlayerId: row.dropPlayerId ?? null,
    faabBid: row.faabBid ?? null,
    priorityOrder: row.priorityOrder,
    claimType: row.claimType,
    status: row.status,
    processedAt: row.processedAt ?? null,
    resultMessage: row.resultMessage ?? null,
    createdAt: row.createdAt,
  }))
}

/**
 * Load AfLeagueTrade rows (with item counts) for a league.
 */
export async function loadLeagueTradeRows(
  leagueId: string,
  since?: Date,
): Promise<RawLeagueTradeRow[]> {
  const rows = await prisma.afLeagueTrade.findMany({
    where: {
      leagueId,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true,
      leagueId: true,
      proposedByUserId: true,
      proposerRosterId: true,
      receiverRosterId: true,
      status: true,
      reviewType: true,
      acceptedAt: true,
      rejectedAt: true,
      expiresAt: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  })
  return rows.map((row: {
    id: string
    leagueId: string
    proposedByUserId: string
    proposerRosterId: string
    receiverRosterId: string
    status: string
    reviewType: string
    acceptedAt: Date | null
    rejectedAt: Date | null
    expiresAt: Date | null
    createdAt: Date
    _count: { items: number }
  }): RawLeagueTradeRow => ({
    id: row.id,
    leagueId: row.leagueId,
    proposedByUserId: row.proposedByUserId,
    proposerRosterId: row.proposerRosterId,
    receiverRosterId: row.receiverRosterId,
    status: row.status,
    reviewType: row.reviewType,
    acceptedAt: row.acceptedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
    itemCount: row._count.items,
  }))
}

/**
 * Load AfRosterMoveHistory rows for a league.
 */
export async function loadRosterMoveRows(
  leagueId: string,
  since?: Date,
): Promise<RawRosterMoveRow[]> {
  const rows = await prisma.afRosterMoveHistory.findMany({
    where: {
      leagueId,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true,
      leagueId: true,
      rosterId: true,
      season: true,
      week: true,
      actorUserId: true,
      source: true,
      moveSummary: true,
      createdAt: true,
    },
  })
  return rows.map((row: {
    id: string
    leagueId: string
    rosterId: string
    season: number
    week: number
    actorUserId: string | null
    source: string
    moveSummary: string | null
    createdAt: Date
  }): RawRosterMoveRow => ({
    id: row.id,
    leagueId: row.leagueId,
    rosterId: row.rosterId,
    season: row.season,
    week: row.week,
    actorUserId: row.actorUserId ?? null,
    source: row.source,
    moveSummary: row.moveSummary ?? null,
    createdAt: row.createdAt,
  }))
}

/**
 * Load DraftSession + DraftPick rows for a league.
 * Returns null session when no session exists for the league.
 * DraftSession.leagueId is @unique — at most one session per league.
 */
export async function loadDraftRows(
  leagueId: string,
): Promise<{ session: RawDraftSessionRow | null; picks: RawDraftPickRow[] }> {
  const session = await prisma.draftSession.findUnique({
    where: { leagueId },
    select: {
      id: true,
      leagueId: true,
      status: true,
      draftType: true,
      rounds: true,
      teamCount: true,
      createdAt: true,
      sportType: true,
    },
  })

  if (!session) return { session: null, picks: [] }

  const rawSession: RawDraftSessionRow = {
    id: session.id,
    leagueId: session.leagueId,
    status: session.status,
    draftType: session.draftType,
    rounds: session.rounds,
    teamCount: session.teamCount,
    createdAt: session.createdAt,
    sportType: session.sportType ?? null,
  }

  const picks = await prisma.draftPick.findMany({
    where: { sessionId: session.id },
    orderBy: { overall: 'asc' },
    take: MAX_ROWS,
    select: {
      id: true,
      sessionId: true,
      overall: true,
      round: true,
      slot: true,
      rosterId: true,
      playerName: true,
      position: true,
      team: true,
      playerId: true,
      assetType: true,
      amount: true,
      ownerUserId: true,
      pickedAt: true,
      createdAt: true,
      sportType: true,
    },
  })

  const rawPicks: RawDraftPickRow[] = picks.map((pick: {
    id: string
    sessionId: string
    overall: number
    round: number
    slot: number
    rosterId: string
    playerName: string
    position: string
    team: string | null
    playerId: string | null
    assetType: string | null
    amount: number | null
    ownerUserId: string | null
    pickedAt: Date | null
    createdAt: Date
    sportType: string | null
  }): RawDraftPickRow => ({
    id: pick.id,
    sessionId: pick.sessionId,
    leagueId: session.leagueId,
    overall: pick.overall,
    round: pick.round,
    slot: pick.slot,
    rosterId: pick.rosterId,
    playerName: pick.playerName,
    position: pick.position,
    team: pick.team ?? null,
    playerId: pick.playerId ?? null,
    assetType: pick.assetType ?? null,
    amount: pick.amount ?? null,
    ownerUserId: pick.ownerUserId ?? null,
    pickedAt: pick.pickedAt ?? null,
    createdAt: pick.createdAt,
    sportType: pick.sportType ?? null,
  }))

  return { session: rawSession, picks: rawPicks }
}

// ── Phase 2E: Redraft trade + roster raw row interfaces ──────────────────────

export interface RawRedraftTradeRow {
  id: string
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  /** Resolved via RedraftRoster.ownerId — always present (roster always has an owner). */
  proposerOwnerId: string
  /** Resolved via RedraftRoster.ownerId — always present, unlike AfLeagueTrade's receiver side. */
  receiverOwnerId: string
  status: string
  /** 'commissioner' | 'league_vote' | 'no_veto'. */
  vetoMode: string
  acceptedAt: Date | null
  rejectedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  /** Count of RedraftTradeAsset rows for this proposal (derived via _count). */
  itemCount: number
}

/**
 * A `RedraftRosterPlayer` row representing a roster-composition change with a
 * real timestamp. Only rows with `acquisitionType === 'free_agent'` map to a
 * behavioral event (see mappers.ts) — 'waiver'/'trade'/'drafted' rows are
 * already covered by their own dedicated sources and would double-count
 * activity if also mapped here.
 */
export interface RawRedraftRosterPlayerRow {
  id: string
  leagueId: string
  rosterId: string
  /** Resolved via RedraftRoster.ownerId — always present. */
  ownerUserId: string
  playerId: string
  playerName: string
  acquisitionType: string
  addedAt: Date
  droppedAt: Date | null
}

/**
 * Load RedraftTradeProposal rows (with asset counts + resolved roster owners)
 * for a league. Mirrors `loadLeagueTradeRows`'s shape and read-only contract.
 */
export async function loadRedraftTradeRows(
  leagueId: string,
  since?: Date,
): Promise<RawRedraftTradeRow[]> {
  const rows = await prisma.redraftTradeProposal.findMany({
    where: {
      leagueId,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true,
      leagueId: true,
      proposerRosterId: true,
      receiverRosterId: true,
      status: true,
      vetoMode: true,
      acceptedAt: true,
      rejectedAt: true,
      expiresAt: true,
      createdAt: true,
      proposerRoster: { select: { ownerId: true } },
      receiverRoster: { select: { ownerId: true } },
      _count: { select: { assets: true } },
    },
  })
  return rows.map((row: {
    id: string
    leagueId: string
    proposerRosterId: string
    receiverRosterId: string
    status: string
    vetoMode: string
    acceptedAt: Date | null
    rejectedAt: Date | null
    expiresAt: Date | null
    createdAt: Date
    proposerRoster: { ownerId: string }
    receiverRoster: { ownerId: string }
    _count: { assets: number }
  }): RawRedraftTradeRow => ({
    id: row.id,
    leagueId: row.leagueId,
    proposerRosterId: row.proposerRosterId,
    receiverRosterId: row.receiverRosterId,
    proposerOwnerId: row.proposerRoster.ownerId,
    receiverOwnerId: row.receiverRoster.ownerId,
    status: row.status,
    vetoMode: row.vetoMode,
    acceptedAt: row.acceptedAt ?? null,
    rejectedAt: row.rejectedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
    itemCount: row._count.assets,
  }))
}

/**
 * Load RedraftRosterPlayer rows for a league (resolved roster owner included),
 * filtered to rows whose `addedAt` (or `droppedAt`) falls within the lookback
 * window. Read-only, same MAX_ROWS cap as every other loader in this file.
 */
export async function loadRedraftRosterPlayerRows(
  leagueId: string,
  since?: Date,
): Promise<RawRedraftRosterPlayerRow[]> {
  const rows = await prisma.redraftRosterPlayer.findMany({
    where: {
      roster: { leagueId },
      ...(since
        ? { OR: [{ addedAt: { gte: since } }, { droppedAt: { gte: since } }] }
        : {}),
    },
    orderBy: { addedAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true,
      rosterId: true,
      playerId: true,
      playerName: true,
      acquisitionType: true,
      addedAt: true,
      droppedAt: true,
      roster: { select: { leagueId: true, ownerId: true } },
    },
  })
  return rows.map((row: {
    id: string
    rosterId: string
    playerId: string
    playerName: string
    acquisitionType: string
    addedAt: Date
    droppedAt: Date | null
    roster: { leagueId: string; ownerId: string }
  }): RawRedraftRosterPlayerRow => ({
    id: row.id,
    leagueId: row.roster.leagueId,
    rosterId: row.rosterId,
    ownerUserId: row.roster.ownerId,
    playerId: row.playerId,
    playerName: row.playerName,
    acquisitionType: row.acquisitionType,
    addedAt: row.addedAt,
    droppedAt: row.droppedAt ?? null,
  }))
}

// ── Phase 2H: Redraft lineup-save history raw row interface + loader ────────

/**
 * A RedraftRosterMoveHistory row — unlike RawRedraftRosterPlayerRow, this
 * carries a real, non-null `week`/`season` (see recordRedraftRosterMoveHistory
 * in lib/redraft/rosterMoveHistory.ts), so events derived from this source
 * are visible to Phase 6.1's lineup-based pattern detectors.
 */
export interface RawRedraftRosterMoveRow {
  id: string
  leagueId: string
  rosterId: string
  seasonId: string
  season: number
  week: number
  actorUserId: string | null
  source: string
  createdAt: Date
}

/**
 * Load RedraftRosterMoveHistory rows for a league. Read-only, same MAX_ROWS
 * cap and since-date filtering as every other loader in this file. Returns an
 * empty array (never throws on a missing/empty table) — the same
 * fails-safely contract every other loader here already has.
 */
export async function loadRedraftRosterMoveRows(
  leagueId: string,
  since?: Date,
): Promise<RawRedraftRosterMoveRow[]> {
  const rows = await prisma.redraftRosterMoveHistory.findMany({
    where: {
      leagueId,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true,
      leagueId: true,
      rosterId: true,
      seasonId: true,
      season: true,
      week: true,
      actorUserId: true,
      source: true,
      createdAt: true,
    },
  })
  return rows.map((row: {
    id: string
    leagueId: string
    rosterId: string
    seasonId: string
    season: number
    week: number
    actorUserId: string | null
    source: string
    createdAt: Date
  }): RawRedraftRosterMoveRow => ({
    id: row.id,
    leagueId: row.leagueId,
    rosterId: row.rosterId,
    seasonId: row.seasonId,
    season: row.season,
    week: row.week,
    actorUserId: row.actorUserId ?? null,
    source: row.source,
    createdAt: row.createdAt,
  }))
}

// ── Phase 5.2 Wire-up A + B ──────────────────────────────────────────────────
//
// Port function for the Sleeper import provenance signal. Follows the same
// read-only invariants as the other loaders: no writes, no external calls, no
// mutations.

export interface RawImportSignals {
  /** Sleeper is the reference provider; provider filter enforced here so the
      Decision OS behavioral layer stays honest to the audit's scope. */
  provider: 'sleeper'
  /** Latest ImportRun.completedAt for the league. Null when no run exists. */
  lastImportedAt: Date | null
  /** True when the latest run's status is NOT `completed` (running/failed). */
  latestRunIncomplete: boolean
  /** Counts of persisted ImportWarning rows for the league by severity. */
  warningCountsBySeverity: {
    error: number
    warn: number
    info: number
  }
}

const IMPORT_SIGNAL_EMPTY: RawImportSignals = {
  provider: 'sleeper',
  lastImportedAt: null,
  latestRunIncomplete: false,
  warningCountsBySeverity: { error: 0, warn: 0, info: 0 },
}

/**
 * Load Sleeper import-run + warning signals for a league. Returns an empty
 * shape (`lastImportedAt: null`) when no ImportRun exists. Read-only; sorted
 * to find the most recent run only.
 */
export async function loadLeagueImportSignals(
  leagueId: string,
): Promise<RawImportSignals> {
  const latestRun = await prisma.importRun.findFirst({
    where: { leagueId, provider: 'sleeper' },
    orderBy: { startedAt: 'desc' },
    select: { status: true, completedAt: true },
  })

  if (!latestRun) return IMPORT_SIGNAL_EMPTY

  const counts = await prisma.importWarning.groupBy({
    by: ['severity'],
    where: { leagueId },
    _count: { _all: true },
  })

  const warningCountsBySeverity = {
    error: 0,
    warn: 0,
    info: 0,
  }
  for (const c of counts) {
    const key = c.severity as 'error' | 'warn' | 'info'
    if (key === 'error' || key === 'warn' || key === 'info') {
      warningCountsBySeverity[key] = c._count._all
    }
  }

  return {
    provider: 'sleeper',
    lastImportedAt: latestRun.status === 'completed' ? latestRun.completedAt : null,
    latestRunIncomplete: latestRun.status !== 'completed',
    warningCountsBySeverity,
  }}

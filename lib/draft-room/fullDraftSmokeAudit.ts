/**
 * Draft QA Slice — pure audit logic for a completed (or in-progress) draft.
 *
 * The CLI script `scripts/smoke-full-draft.ts` loads rows from Neon and feeds
 * them to `auditFullDraft()` here. Keeping the diagnostics pure means the
 * unit tests cover every branch without Prisma in the loop.
 *
 * AUDIT-ONLY: this module never writes — read-only inspection of an existing
 * draft. The user runs it against a real or test league to verify the draft
 * completed cleanly (no duplicate players, no orphaned rosterId references,
 * no placeholder roster slots left over, expected chat / audit-log counts).
 */

export type SmokeDraftSession = {
  id: string
  leagueId: string
  status: string
  sessionKind: string
  teamCount: number
  draftType: string
  /**
   * Persisted slot order from DraftSession.slotOrder. Each entry has the
   * roster the slot resolves to plus its display name. Test rosters appear
   * here as `rosterId: 'placeholder-N'` until a real Roster row is created.
   */
  slotOrder: Array<{ slot: number; rosterId: string; displayName: string }>
  startedAt: Date | null
  completedAt: Date | null
  expectedTotalPicks: number | null
}

export type SmokeRoster = {
  id: string
  leagueId: string
  displayName: string | null
  platformUserId: string | null
}

export type SmokePick = {
  id: string
  overall: number
  round: number
  roundPick: number | null
  rosterId: string
  playerName: string
  position: string | null
  source: string | null
  pickedAt: Date | null
}

type SmokeAuditLogRow = { id: string; action: string }

export type SmokeChatPickEventRow = {
  id: string
  metadata: { aiManager?: boolean | null; headshotUrl?: string | null } | null
}

export type FullDraftSmokeInput = {
  session: SmokeDraftSession
  rosters: SmokeRoster[]
  picks: SmokePick[]
  auditLog: SmokeAuditLogRow[]
  chatPickEvents: SmokeChatPickEventRow[]
}

type FullDraftSmokeReport = {
  leagueId: string
  sessionId: string
  status: string
  expectedTotalPicks: number | null
  picksMade: number
  isComplete: boolean
  isFullyDrafted: boolean | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  rosterCounts: {
    totalRostersInLeague: number
    rostersInSlotOrder: number
    rostersWithoutPlatformUser: number
    placeholderSlots: Array<{ slot: number; rosterId: string }>
  }
  duplicates: {
    duplicatePlayerNames: Array<{ player: string; count: number; overalls: number[] }>
    duplicateOverallNumbers: Array<{ overall: number; count: number; ids: string[] }>
  }
  orphanedRosterAssignments: Array<{ overall: number; rosterId: string; playerName: string }>
  chat: {
    pickEventCount: number
    autopickEventCount: number
    headshotPresentCount: number
  }
  auditLog: {
    totalEntries: number
    byAction: Record<string, number>
  }
  diagnosis: 'OK' | 'WARNINGS' | 'BLOCKING'
  notes: string[]
}

const PLACEHOLDER_ROSTER_PREFIX = 'placeholder-'

function isPlaceholderRosterId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(PLACEHOLDER_ROSTER_PREFIX)
}

function findDuplicatePlayerNames(picks: SmokePick[]) {
  const counts = new Map<string, number[]>()
  for (const p of picks) {
    const key = (p.playerName ?? '').trim().toLowerCase()
    if (!key) continue
    const overalls = counts.get(key) ?? []
    overalls.push(p.overall)
    counts.set(key, overalls)
  }
  const out: Array<{ player: string; count: number; overalls: number[] }> = []
  for (const [key, overalls] of counts) {
    if (overalls.length > 1) {
      // Use the most recent canonical casing for display by re-scanning picks.
      const canonical = picks.find((p) => p.playerName.trim().toLowerCase() === key)?.playerName ?? key
      out.push({ player: canonical, count: overalls.length, overalls: [...overalls].sort((a, b) => a - b) })
    }
  }
  return out.sort((a, b) => b.count - a.count)
}

function findDuplicateOverallNumbers(picks: SmokePick[]) {
  const counts = new Map<number, string[]>()
  for (const p of picks) {
    const ids = counts.get(p.overall) ?? []
    ids.push(p.id)
    counts.set(p.overall, ids)
  }
  const out: Array<{ overall: number; count: number; ids: string[] }> = []
  for (const [overall, ids] of counts) {
    if (ids.length > 1) out.push({ overall, count: ids.length, ids })
  }
  return out.sort((a, b) => a.overall - b.overall)
}

function findOrphanedRosterAssignments(
  picks: SmokePick[],
  rosters: SmokeRoster[],
  slotOrder: SmokeDraftSession['slotOrder'],
) {
  // A pick is orphaned when its rosterId neither matches a real Roster row
  // nor a slot in slotOrder. Slot-order placeholders are reported separately
  // (they're only a problem if the draft is `completed`).
  const realRosterIds = new Set(rosters.map((r) => r.id))
  const slotRosterIds = new Set(slotOrder.map((s) => s.rosterId))
  const out: Array<{ overall: number; rosterId: string; playerName: string }> = []
  for (const p of picks) {
    if (!realRosterIds.has(p.rosterId) && !slotRosterIds.has(p.rosterId)) {
      out.push({ overall: p.overall, rosterId: p.rosterId, playerName: p.playerName })
    }
  }
  return out
}

function summarizeAuditLog(rows: SmokeAuditLogRow[]) {
  const byAction: Record<string, number> = {}
  for (const r of rows) byAction[r.action] = (byAction[r.action] ?? 0) + 1
  return { totalEntries: rows.length, byAction }
}

function summarizeChat(rows: SmokeChatPickEventRow[]) {
  let autopickEventCount = 0
  let headshotPresentCount = 0
  for (const r of rows) {
    if (r.metadata?.aiManager === true) autopickEventCount++
    if (typeof r.metadata?.headshotUrl === 'string' && r.metadata.headshotUrl.trim()) {
      headshotPresentCount++
    }
  }
  return { pickEventCount: rows.length, autopickEventCount, headshotPresentCount }
}

/**
 * Pure audit. Returns a structured report and a verdict:
 *   - OK        — no anomalies; report is clean.
 *   - WARNINGS  — anomalies present but the draft is not blocked
 *                 (e.g. headshot coverage is incomplete, but picks are unique).
 *   - BLOCKING  — duplicate players, orphaned roster targets, or placeholder
 *                 slots remain in a `completed` session.
 */
export function auditFullDraft(input: FullDraftSmokeInput): FullDraftSmokeReport {
  const { session, rosters, picks, auditLog, chatPickEvents } = input
  const placeholderSlots = session.slotOrder
    .filter((s) => isPlaceholderRosterId(s.rosterId))
    .map((s) => ({ slot: s.slot, rosterId: s.rosterId }))

  const dupNames = findDuplicatePlayerNames(picks)
  const dupOveralls = findDuplicateOverallNumbers(picks)
  const orphaned = findOrphanedRosterAssignments(picks, rosters, session.slotOrder)
  const chat = summarizeChat(chatPickEvents)
  const audit = summarizeAuditLog(auditLog)

  const expectedTotalPicks = session.expectedTotalPicks ?? null
  const isComplete = session.status === 'completed' && session.completedAt !== null
  const isFullyDrafted =
    expectedTotalPicks != null ? picks.length === expectedTotalPicks : null

  const durationMs =
    session.startedAt != null && session.completedAt != null
      ? session.completedAt.getTime() - session.startedAt.getTime()
      : null

  const notes: string[] = []
  let diagnosis: FullDraftSmokeReport['diagnosis'] = 'OK'

  if (dupNames.length > 0) {
    diagnosis = 'BLOCKING'
    notes.push(
      `${dupNames.length} player(s) drafted twice — first: ${dupNames[0].player} at picks ${dupNames[0].overalls.join(', ')}`,
    )
  }
  if (dupOveralls.length > 0) {
    diagnosis = 'BLOCKING'
    notes.push(
      `${dupOveralls.length} overall pick number(s) recorded more than once — first: #${dupOveralls[0].overall} (${dupOveralls[0].count}×)`,
    )
  }
  if (orphaned.length > 0) {
    diagnosis = 'BLOCKING'
    notes.push(
      `${orphaned.length} pick(s) point to a rosterId that does not exist in Roster or slotOrder — first: pick #${orphaned[0].overall} → ${orphaned[0].rosterId}`,
    )
  }
  if (placeholderSlots.length > 0 && session.status === 'completed') {
    diagnosis = 'BLOCKING'
    notes.push(
      `${placeholderSlots.length} placeholder slot(s) still present in a completed session — first: slot ${placeholderSlots[0].slot} (${placeholderSlots[0].rosterId})`,
    )
  } else if (placeholderSlots.length > 0) {
    if (diagnosis === 'OK') diagnosis = 'WARNINGS'
    notes.push(
      `${placeholderSlots.length} placeholder roster slot(s) present (acceptable while pre-draft / in-progress)`,
    )
  }

  if (isFullyDrafted === false && session.status === 'completed') {
    diagnosis = 'BLOCKING'
    notes.push(
      `session is marked completed but only ${picks.length}/${expectedTotalPicks} picks recorded`,
    )
  }

  if (chat.pickEventCount < picks.length) {
    if (diagnosis === 'OK') diagnosis = 'WARNINGS'
    notes.push(
      `chat pick events (${chat.pickEventCount}) lag actual picks (${picks.length}) — fire-and-forget delivery may have dropped some`,
    )
  }

  if (chat.pickEventCount > 0 && chat.headshotPresentCount === 0) {
    if (diagnosis === 'OK') diagnosis = 'WARNINGS'
    notes.push(
      'no chat pick events have a headshot URL — D.6.3 plumbing may not be reaching this league yet',
    )
  }

  if (notes.length === 0) {
    notes.push('no anomalies — draft state is consistent')
  }

  return {
    leagueId: session.leagueId,
    sessionId: session.id,
    status: session.status,
    expectedTotalPicks,
    picksMade: picks.length,
    isComplete,
    isFullyDrafted,
    startedAt: session.startedAt?.toISOString() ?? null,
    completedAt: session.completedAt?.toISOString() ?? null,
    durationMs,
    rosterCounts: {
      totalRostersInLeague: rosters.length,
      rostersInSlotOrder: session.slotOrder.length,
      rostersWithoutPlatformUser: rosters.filter((r) => r.platformUserId == null).length,
      placeholderSlots,
    },
    duplicates: {
      duplicatePlayerNames: dupNames,
      duplicateOverallNumbers: dupOveralls,
    },
    orphanedRosterAssignments: orphaned,
    chat,
    auditLog: audit,
    diagnosis,
    notes,
  }
}

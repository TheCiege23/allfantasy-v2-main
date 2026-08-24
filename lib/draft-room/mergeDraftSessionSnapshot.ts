import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { isDraftBoardFull } from '@/lib/live-draft-engine/draftPickEmpty'
import type { DraftPickSnapshot, DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

function snapshotPicksToProgress(picks: DraftPickSnapshot[]) {
  return picks.map((p) => ({
    overall: p.overall,
    playerName: p.playerName,
    position: p.position,
    pickMetadata: p.pickEditorEmpty ? { pickEditorEmpty: true } : null,
  }))
}

function draftNeedsClock(s: DraftSessionSnapshot): boolean {
  const total = Math.max(0, s.rounds * s.teamCount)
  const picks = snapshotPicksToProgress(s.picks ?? [])
  return (s.status === 'in_progress' || s.status === 'paused') && !isDraftBoardFull(picks, total)
}

function slotOrderLooksComplete(slotOrder: DraftSessionSnapshot['slotOrder'] | undefined, teamCount: number): boolean {
  return Array.isArray(slotOrder) && slotOrder.length >= Math.max(1, teamCount)
}

function inferCurrentPickFromSnapshot(s: DraftSessionSnapshot) {
  const tc = Math.max(1, s.teamCount)
  const rounds = Math.max(1, s.rounds ?? 1)
  const total = Math.max(0, rounds * tc)
  return resolveCurrentOnTheClock({
    totalPicks: total,
    picks: snapshotPicksToProgress(s.picks ?? []),
    teamCount: tc,
    draftType: s.draftType,
    thirdRoundReversal: s.thirdRoundReversal,
    slotOrder: s.slotOrder ?? [],
  })
}

/** True when we have a usable clock anchor for an active draft that still needs picks. */
function timerHasAuthority(s: DraftSessionSnapshot): boolean {
  if (s.status === 'paused') {
    return (
      (typeof s.pausedRemainingSeconds === 'number' && Number.isFinite(s.pausedRemainingSeconds)) ||
      s.timer?.status === 'paused' ||
      (typeof s.timer?.remainingSeconds === 'number' && Number.isFinite(s.timer.remainingSeconds))
    )
  }
  if (s.status !== 'in_progress') return false
  return (
    s.timer?.status === 'running' ||
    s.timer?.status === 'expired' ||
    Boolean(s.timerEndAt && String(s.timerEndAt).length > 0) ||
    Boolean(s.timer?.timerEndAt && String(s.timer.timerEndAt).length > 0)
  )
}

function isWeakActiveSnapshot(s: DraftSessionSnapshot): boolean {
  const tc = Math.max(1, s.teamCount)
  if (!draftNeedsClock(s)) return false
  return (
    !s.currentPick ||
    !slotOrderLooksComplete(s.slotOrder, tc) ||
    !timerHasAuthority(s)
  )
}

/**
 * After repair + merge stitching, overlay prev authority when incoming is incomplete on the same pick epoch.
 * Prevents live-sync/events from blanking currentPick / slotOrder / timer between polls.
 */
function preserveStrongActiveOverWeakIncoming(
  prev: DraftSessionSnapshot | null,
  merged: DraftSessionSnapshot,
): DraftSessionSnapshot {
  if (!prev || !draftNeedsClock(prev)) return merged
  const sameEpoch = (merged.picks?.length ?? 0) === (prev.picks?.length ?? 0)
  if (!sameEpoch) return merged

  const tc = Math.max(1, merged.teamCount)
  const prevStrong =
    (prev.status === 'in_progress' || prev.status === 'paused') &&
    Boolean(prev.currentPick) &&
    slotOrderLooksComplete(prev.slotOrder, Math.max(1, prev.teamCount)) &&
    timerHasAuthority(prev)

  if (!prevStrong || !isWeakActiveSnapshot(merged)) return merged

  let out: DraftSessionSnapshot = {
    ...merged,
    slotOrder: slotOrderLooksComplete(merged.slotOrder, tc) ? merged.slotOrder : prev.slotOrder,
    currentPick: merged.currentPick ?? prev.currentPick ?? null,
    timerSeconds: merged.timerSeconds ?? prev.timerSeconds,
    timerEndAt: merged.timerEndAt ?? prev.timerEndAt,
    pausedRemainingSeconds:
      merged.pausedRemainingSeconds !== undefined && merged.pausedRemainingSeconds !== null
        ? merged.pausedRemainingSeconds
        : prev.pausedRemainingSeconds,
  }

  if (!timerHasAuthority(out) && timerHasAuthority(prev)) {
    out = {
      ...out,
      timer: prev.timer,
      timerEndAt: prev.timerEndAt ?? out.timerEndAt,
    }
  }

  return out
}

/**
 * When a snapshot drops authoritative clock/order/timer anchors, repair from `prev` or infer from the board
 * so live-sync merges cannot blank the room (null currentPick + empty slotOrder + timer none).
 */
export function repairDraftSessionAuthority(
  prev: DraftSessionSnapshot | null,
  next: DraftSessionSnapshot,
): DraftSessionSnapshot {
  if (!draftNeedsClock(next)) return next

  let work = next

  const tc = Math.max(1, work.teamCount)
  if (
    prev &&
    !slotOrderLooksComplete(work.slotOrder, tc) &&
    slotOrderLooksComplete(prev.slotOrder, Math.max(1, prev.teamCount))
  ) {
    work = { ...work, slotOrder: prev.slotOrder }
  }

  if (!work.currentPick) {
    const inferred = inferCurrentPickFromSnapshot(work)
    if (inferred) {
      work = { ...work, currentPick: inferred }
    } else if (
      prev?.currentPick &&
      (work.picks?.length ?? 0) === (prev.picks?.length ?? 0)
    ) {
      work = { ...work, currentPick: prev.currentPick }
    }
  }

  if (
    prev &&
    (work.status === 'in_progress' || work.status === 'paused') &&
    work.timer?.status === 'none' &&
    prev.timer?.status === 'running' &&
    draftNeedsClock(work)
  ) {
    work = { ...work, timer: prev.timer }
  }
  if (
    !work.timerEndAt &&
    prev?.timerEndAt &&
    (work.status === 'in_progress' || work.status === 'paused') &&
    draftNeedsClock(work)
  ) {
    work = { ...work, timerEndAt: prev.timerEndAt }
  }

  return work
}

/**
 * If merge result still lost authoritative fields that `prev` held for the same draft beat, stitch back.
 * Guards equal-version duplicate rows / flaky reads after repair.
 */
function mergeStrongerAuthorityFields(
  prev: DraftSessionSnapshot | null,
  merged: DraftSessionSnapshot,
): DraftSessionSnapshot {
  if (!prev || !draftNeedsClock(merged)) return merged
  let out = merged

  const tc = Math.max(1, merged.teamCount)
  if (
    draftNeedsClock(prev) &&
    !slotOrderLooksComplete(merged.slotOrder, tc) &&
    slotOrderLooksComplete(prev.slotOrder, Math.max(1, prev.teamCount))
  ) {
    out = { ...out, slotOrder: prev.slotOrder }
  }

  if (draftNeedsClock(prev) && prev.currentPick && !merged.currentPick) {
    const samePickEpoch = (merged.picks?.length ?? 0) === (prev.picks?.length ?? 0)
    if (samePickEpoch) {
      out = { ...out, currentPick: prev.currentPick }
    }
  }

  const prevRunning = prev.timer?.status === 'running' && Boolean(prev.timerEndAt || prev.timer?.timerEndAt)
  const mergedDead =
    merged.timer?.status === 'none' &&
    !merged.timerEndAt &&
    !(merged.timer?.timerEndAt && merged.timer.timerEndAt !== '')
  if (prevRunning && mergedDead && (merged.status === 'in_progress' || merged.status === 'paused')) {
    out = {
      ...out,
      timer: prev.timer,
      timerEndAt: prev.timerEndAt ?? out.timerEndAt,
    }
  }

  const samePickEpoch = (merged.picks?.length ?? 0) === (prev.picks?.length ?? 0)
  if (
    draftNeedsClock(prev) &&
    samePickEpoch &&
    prev.timerSeconds != null &&
    (merged.timerSeconds == null || merged.timerSeconds === undefined)
  ) {
    out = { ...out, timerSeconds: prev.timerSeconds }
  }

  return out
}

/**
 * Compact fingerprint for live-room surfaces — avoids React churn when poll returns identical authority.
 */
export function draftSessionLiveSurfaceKey(s: DraftSessionSnapshot | null | undefined): string {
  if (!s) return ''
  const cp = s.currentPick
  const t = s.timer
  return [
    s.version,
    s.updatedAt ?? '',
    s.status,
    s.rosterConfigurationIncomplete === true ? '1' : s.rosterConfigurationIncomplete === false ? '0' : '',
    s.picks?.length ?? 0,
    s.slotOrder?.length ?? 0,
    cp?.overall ?? '',
    cp?.round ?? '',
    cp?.slot ?? '',
    cp?.rosterId ?? '',
    t?.status ?? '',
    s.timerEndAt ?? '',
    s.pausedRemainingSeconds ?? '',
  ].join('|')
}

/**
 * Skip applying an older snapshot over a newer one (poll races, reordering GET responses).
 */
export function isStaleDraftSessionSnapshot(
  prev: DraftSessionSnapshot | null | undefined,
  next: DraftSessionSnapshot | null | undefined,
): boolean {
  if (!next) return false
  if (!prev) return false
  /** Server always bumps `version` on authoritative transitions — strictly newer wins. */
  if (typeof next.version === 'number' && typeof prev.version === 'number') {
    if (next.version > prev.version) return false
    if (next.version < prev.version) return true
  }
  const nextAt = next.updatedAt ? new Date(next.updatedAt).getTime() : 0
  const prevAt = prev.updatedAt ? new Date(prev.updatedAt).getTime() : 0
  if (nextAt > 0 && prevAt > 0 && nextAt < prevAt) return true

  /** Same version + timestamp + same pick count: reject a degraded duplicate read (no pick advanced). */
  if (
    nextAt > 0 &&
    prevAt > 0 &&
    nextAt === prevAt &&
    typeof next.version === 'number' &&
    typeof prev.version === 'number' &&
    next.version === prev.version &&
    (next.picks?.length ?? 0) === (prev.picks?.length ?? 0) &&
    draftNeedsClock(prev)
  ) {
    const prevStrong =
      Boolean(prev.currentPick) &&
      (prev.timer?.status === 'running' ||
        prev.timer?.status === 'paused' ||
        Boolean(prev.timerEndAt || prev.timer?.timerEndAt))
    const nextWeak =
      !next.currentPick ||
      (next.timer?.status === 'none' && !next.timerEndAt && !(next.timer?.timerEndAt && next.timer.timerEndAt !== ''))
    if (prevStrong && nextWeak && draftNeedsClock(next)) return true
  }

  return false
}

/** Incoming POST/GET payloads often omit viewer-only fields — preserve from `prev` when missing on `next`. */
const VIEWER_SESSION_KEYS = [
  'currentUserRosterId',
  'orphanRosterIds',
  'aiManagerEnabled',
  'orphanDrafterMode',
  'orphanAiProviderAvailable',
  'orphanDrafterEffectiveMode',
  'draftOrderMode',
  'lotteryLastRunAt',
  'rosterConfigurationIncomplete',
  'rosterConfigurationMessage',
  // Session-scoped and stable (not viewer-scoped), but partial payloads may omit it —
  // preserve across merges so the mirrored-from-Sleeper chrome cannot flicker between polls.
  'sleeperDraftId',
] as const

function snapshotRecord(s: DraftSessionSnapshot): Record<string, unknown> {
  return s as unknown as Record<string, unknown>
}

export function mergeDraftSessionSnapshot(
  prev: DraftSessionSnapshot | null,
  next: DraftSessionSnapshot | null | undefined,
): DraftSessionSnapshot | null {
  if (!next) return prev ?? null

  /** Never regress an in-flight live draft to pre-draft with the same board progress (stale reads, race ordering). */
  if (
    prev &&
    draftNeedsClock(prev) &&
    (prev.status === 'in_progress' || prev.status === 'paused') &&
    next.status === 'pre_draft' &&
    (next.picks?.length ?? 0) === (prev.picks?.length ?? 0)
  ) {
    return prev
  }

  if (isStaleDraftSessionSnapshot(prev ?? null, next)) return prev ?? null
  const nextRepaired = repairDraftSessionAuthority(prev, next)
  if (prev && draftSessionLiveSurfaceKey(prev) === draftSessionLiveSurfaceKey(nextRepaired)) {
    /** Authority surface unchanged — still apply viewer-scoped updates from `next` if present. */
    let out: DraftSessionSnapshot = prev
    for (const key of VIEWER_SESSION_KEYS) {
      const nv = snapshotRecord(nextRepaired)[key]
      const pv = snapshotRecord(prev)[key]
      if (key === 'currentUserRosterId') {
        const effective =
          typeof nv === 'string' && nv.length > 0
            ? nv
            : typeof pv === 'string' && pv.length > 0
              ? pv
              : nv
        if (effective !== undefined && effective !== pv) {
          if (out === prev) out = { ...prev }
          ;(snapshotRecord(out) as Record<string, unknown>)[key] = effective
        }
        continue
      }
      if (nv !== undefined && nv !== pv) {
        if (out === prev) out = { ...prev }
        ;(snapshotRecord(out) as Record<string, unknown>)[key] = nv
      }
    }
    return out
  }
  const base = nextRepaired
  /** Pick/controls responses often omit viewer-scoped fields; keep them so on-clock / roster mapping does not flicker away. */
  let merged: DraftSessionSnapshot = base
  if (prev) {
    for (const key of VIEWER_SESSION_KEYS) {
      const pv = snapshotRecord(prev)[key]
      const nv = snapshotRecord(base)[key]
      /** Keep roster mapping when the server omits or clears it on partial payloads. */
      if (key === 'currentUserRosterId') {
        if (
          typeof pv === 'string' &&
          pv.length > 0 &&
          (nv === undefined || nv === null || nv === '')
        ) {
          if (merged === base) merged = { ...base }
          snapshotRecord(merged)[key] = pv
        }
        continue
      }
      if (nv === undefined && pv !== undefined) {
        if (merged === base) merged = { ...base }
        snapshotRecord(merged)[key] = pv
      }
    }
  }
  return preserveStrongActiveOverWeakIncoming(prev, mergeStrongerAuthorityFields(prev, merged))
}

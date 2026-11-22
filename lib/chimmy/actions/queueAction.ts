import { draftQueueKeyForUser } from '@/lib/league/teamScopedKey'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { normalizeDraftedNameSet } from '@/lib/draft-queue-engine'
import { persistDraftQueue, prepareDraftQueueSave } from '@/lib/draft-room/saveDraftQueue'
import type { QueueEntry } from '@/lib/live-draft-engine/types'
import { signChimmyActionToken } from './actionToken'
import { applyQueueOps, matchByName, queueFingerprint, queueNameKey, type QueuePlayer } from './queuePlan'
import type { ActionCardPlayer, ChimmyActionCard, ChimmyActionTokenPayload } from './types'

/**
 * "Add Waddle and Flowers to my queue" / "move LaPorta to the top" / "take Kelce off" — Chimmy editing
 * the user's OWN draft queue (stage 2 of drafts, owner's spec 2026-11-16: "yes, with a Confirm tap").
 *
 * 🛑 A QUEUE, NEVER A PICK. Nothing here can draft a player; the queue is the user's own ranked list,
 * and autopick reading it is the draft room's behaviour, unchanged.
 *
 * PROPOSE resolves every name against the draft room's own warm pool (never the model's spelling), runs
 * the SAME checks the room's save runs (`prepareDraftQueueSave`, no write) so a card that cannot save is
 * never shown, and signs the edit against a fingerprint of the queue as it stands. EXECUTE (only from the
 * confirm route, after the tap) refuses if that queue or the current draft changed, then saves through
 * the same `persistDraftQueue` the room uses — one writer.
 */

type Outcome = { ok: true; text: string; card: ChimmyActionCard } | { ok: false; text: string }

const MAX_NAMES = 8

function names(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []
  return [...new Set(list.map((s) => String(s ?? '').trim()).filter(Boolean))].slice(0, MAX_NAMES)
}

async function readQueue(sessionId: string, userId: string): Promise<QueueEntry[]> {
  const row = await prisma.draftQueue.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { order: true } })
  const raw = Array.isArray(row?.order) ? (row!.order as unknown as QueueEntry[]) : []
  return raw.filter((e) => typeof e?.playerName === 'string' && e.playerName.trim().length > 0)
}

type PoolRow = { name: string; position: string; team: string | null; playerId: string | null }

/** The draft room's warm pool, or null when it is not loaded — a chat turn never starts a cold build. */
async function warmPool(leagueId: string): Promise<PoolRow[] | null> {
  const { getWarmDraftPoolSnapshotFast } = await import('@/lib/draft-room/ensureDraftPoolReady')
  const snap = await getWarmDraftPoolSnapshotFast(leagueId, { allowStale: true })
  if (!snap.warm || !Array.isArray(snap.payload.entries)) return null
  return (snap.payload.entries as Array<Record<string, unknown>>)
    .map((e) => ({
      name: String(e.name ?? '').trim(),
      position: String(e.position ?? '').trim(),
      team: typeof e.team === 'string' && e.team ? e.team : null,
      playerId: typeof e.playerId === 'string' && e.playerId ? e.playerId : null,
    }))
    .filter((e) => e.name)
}

const asCardPlayer = (p: { playerName: string; position: string | null; team: string | null }): ActionCardPlayer => ({
  name: p.playerName,
  position: p.position || null,
  team: p.team,
})

export async function proposeDraftQueueChange(args: {
  leagueId: string
  userId: string
  add?: unknown
  remove?: unknown
  position?: unknown
  now?: Date
}): Promise<Outcome> {
  const now = args.now ?? new Date()
  const addNames = names(args.add)
  const removeNames = names(args.remove)
  const addAt: 'top' | 'bottom' = args.position === 'top' ? 'top' : 'bottom'
  if (addNames.length === 0 && removeNames.length === 0) {
    return { ok: false, text: 'Pass the players to add (and/or remove). Nothing was prepared.' }
  }
  if (!(await canAccessLeagueDraft(args.leagueId, args.userId))) {
    return { ok: false, text: "This user can't use this league's draft room, so nothing was prepared." }
  }
  const session = await prisma.draftSession.findFirst({
    where: { leagueId: args.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true, picks: { select: { playerName: true } } },
  })
  if (!session) return { ok: false, text: 'This league has no draft, so there is no queue to change.' }
  if (session.status === 'completed') return { ok: false, text: 'This draft is over, so the queue no longer does anything. Nothing was prepared.' }

  const current = await readQueue(session.id, await draftQueueKeyForUser(args.leagueId, args.userId))
  const drafted = normalizeDraftedNameSet(session.picks)
  const notes: string[] = []

  // ── Who to add: the room's own pool, never the model's spelling ──────────────────────────────
  const add: QueuePlayer[] = []
  if (addNames.length > 0) {
    const pool = await warmPool(args.leagueId)
    if (!pool) {
      return { ok: false, text: "The draft room's player list isn't loaded yet, so those players couldn't be checked. Nothing was prepared. Tell the user to open their draft room once, or add them from the room's player list." }
    }
    for (const asked of addNames) {
      const m = matchByName(asked, pool, (p) => p.name)
      if (!m.ok) {
        notes.push(
          m.reason === 'ambiguous'
            ? `"${asked}" matches more than one player (${m.candidates.map((c) => `${c.name} ${c.position}`).join(', ')}); ask which one.`
            : `"${asked}" is not in this draft's player pool.`,
        )
        continue
      }
      const p = m.item
      if (drafted.has(p.name.toLowerCase().trim()) || [...drafted].some((d) => queueNameKey(d) === queueNameKey(p.name))) {
        notes.push(`${p.name} has already been drafted.`)
        continue
      }
      add.push({ playerName: p.name, position: p.position, team: p.team, playerId: p.playerId })
    }
  }

  // ── Who to take off: only players actually in their queue ───────────────────────────────────
  const removeKeys: string[] = []
  const removed: QueueEntry[] = []
  for (const asked of removeNames) {
    const m = matchByName(asked, current, (e) => e.playerName)
    if (!m.ok) {
      notes.push(m.reason === 'ambiguous' ? `"${asked}" matches more than one queued player; ask which one.` : `"${asked}" is not in their queue.`)
      continue
    }
    removeKeys.push(queueNameKey(m.item.playerName))
    removed.push(m.item)
  }

  if (add.length === 0 && removeKeys.length === 0) {
    return { ok: false, text: `Nothing to change, so nothing was prepared. ${notes.join(' ')}`.trim() }
  }

  const next = applyQueueOps(current, { add, addAt, removeKeys })
  if (queueFingerprint(next) === queueFingerprint(current)) {
    return { ok: false, text: `Their queue already looks like that, so there is nothing to change. ${notes.join(' ')}`.trim() }
  }

  // The room's own save checks, dry-run: a card that could not save is never shown.
  const check = await prepareDraftQueueSave(args.leagueId, next)
  if (!check.ok) return { ok: false, text: `That queue could not be saved (${check.error}). Nothing was prepared.` }
  const kept = new Set(check.prepared.queue.map((e) => queueNameKey(e.playerName)))
  const cut = add.filter((p) => !kept.has(queueNameKey(p.playerName)))
  if (cut.length > 0) {
    return {
      ok: false,
      text: `Their queue is full (this league allows ${check.prepared.queueSizeLimit}), so ${cut.map((p) => p.playerName).join(', ')} would not fit. Nothing was prepared. Suggest removing someone, or adding at the top.`,
    }
  }

  const signed = signChimmyActionToken({
    userId: args.userId,
    leagueId: args.leagueId,
    spec: { kind: 'queue', sessionId: session.id, add, addAt, removeKeys, baseFingerprint: queueFingerprint(current) },
    now,
  })
  if (!signed) return { ok: false, text: 'Confirm cards are unavailable right now, so nothing was prepared. The user can change the queue in their draft room.' }

  const league = await prisma.league.findUnique({ where: { id: args.leagueId }, select: { name: true, sport: true, season: true } })
  const title =
    add.length > 0 && removed.length === 0
      ? `${addAt === 'top' ? 'Put' : 'Add'} ${add.length === 1 ? add[0]!.playerName : `${add.length} players`} ${addAt === 'top' ? 'at the top of' : 'to'} your queue`
      : add.length === 0
        ? `Take ${removed.length === 1 ? removed[0]!.playerName : `${removed.length} players`} off your queue`
        : 'Update your draft queue'
  const card: ChimmyActionCard = {
    actionId: signed.payload.actionId,
    kind: 'queue',
    token: signed.token,
    title,
    league: { id: args.leagueId, name: league?.name ?? null, sport: String(league?.sport ?? '') },
    week: 0,
    season: league?.season ?? now.getUTCFullYear(),
    expiresAt: new Date(signed.payload.exp * 1000).toISOString(),
    queue: {
      add: add.map((p) => asCardPlayer(p)),
      addAt,
      remove: removed.map((e) => asCardPlayer({ playerName: e.playerName, position: e.position ?? null, team: e.team ?? null })),
      resultingTop: check.prepared.queue.slice(0, 5).map((e) => e.playerName),
    },
    warnings: [...notes, 'Your queue only: this never makes a pick.'],
  }
  return {
    ok: true,
    text: `A confirm card is ready${notes.length ? ` (${notes.join(' ')})` : ''}. NOTHING has changed yet — the queue is saved only if the user taps Confirm. Say that, and never say the queue was changed or that a player was drafted.`,
    card,
  }
}

export type QueueExecuteResult = { ok: true; message: string } | { ok: false; message: string }

const CHANGED = 'Your queue changed since this card was made, so nothing was saved. Ask Chimmy again for a fresh card.'

export async function executeQueueAction(payload: ChimmyActionTokenPayload, userId: string): Promise<QueueExecuteResult> {
  const spec = payload.spec
  if (spec.kind !== 'queue') return { ok: false, message: 'This card could not be applied.' }
  if (!(await canAccessLeagueDraft(payload.leagueId, userId))) return { ok: false, message: "You can't use this league's draft room, so nothing was saved." }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId: payload.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { id: true, status: true },
  })
  if (!session || session.id !== spec.sessionId) return { ok: false, message: 'A different draft is current now, so nothing was saved. Ask Chimmy again.' }
  if (session.status === 'completed') return { ok: false, message: 'This draft is over, so nothing was saved.' }

  const queueKey = await draftQueueKeyForUser(payload.leagueId, userId)
  const current = await readQueue(session.id, queueKey)
  if (queueFingerprint(current) !== spec.baseFingerprint) return { ok: false, message: CHANGED }

  const prepared = await prepareDraftQueueSave(payload.leagueId, applyQueueOps(current, spec))
  if (!prepared.ok) return { ok: false, message: `Nothing was saved: ${prepared.error}` }
  await persistDraftQueue(queueKey, prepared.prepared)

  const parts: string[] = []
  if (spec.add.length) parts.push(`${spec.add.map((p) => p.playerName).join(', ')} ${spec.addAt === 'top' ? 'at the top' : 'added'}`)
  if (spec.removeKeys.length) parts.push(`${spec.removeKeys.length} taken off`)
  return { ok: true, message: `Queue saved — ${parts.join('; ')}.${prepared.prepared.removedCount ? ` ${prepared.prepared.removedCount} already-drafted player${prepared.prepared.removedCount === 1 ? '' : 's'} dropped.` : ''}` }
}

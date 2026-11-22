import 'server-only'

import { randomUUID } from 'node:crypto'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { readViewerPoll } from '@/lib/chat-core/messagePolls'

import { bestSlot, formatSlot, parseSlots, safeTimeZone, type SlotError, type SlotTally } from './draftSchedule'

/**
 * The draft scheduler: the commissioner offers start times, the league answers in a league-chat poll
 * (several answers allowed, each shown in the reader's own time zone), the commissioner locks one.
 *
 * Stored in `League.settings.draft_schedule_poll`; the votes live on the chat poll itself, so members
 * answer where they already talk and nothing is counted twice. Locking goes through
 * `executeLeagueSettingsPatch` — the same choke point as the settings screen — so the commissioner check,
 * the tournament copy and the draft-time notification all run exactly as when the date is typed in.
 */

const KEY = 'draft_schedule_poll'

type DraftSchedulePoll = {
  id: string
  pollMessageId: string | null
  slots: Array<{ id: string; startsAt: string }>
  createdBy: string
  createdAt: string
  closesAt: string
  status: 'open' | 'locked' | 'cancelled'
  lockedSlotId: string | null
  lockedAt: string | null
}

function readPoll(raw: unknown): DraftSchedulePoll | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !Array.isArray(r.slots)) return null
  return r as unknown as DraftSchedulePoll
}

async function updateSettingsLocked(leagueId: string, mutate: (s: Record<string, unknown>) => Record<string, unknown> | null): Promise<boolean> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return false
    const next = mutate((league.settings as Record<string, unknown>) ?? {})
    if (!next) return false
    await tx.league.update({ where: { id: leagueId }, data: { settings: next as Prisma.InputJsonValue } })
    return true
  })
}

async function leagueZone(leagueId: string): Promise<string> {
  const s = await prisma.leagueSettings.findUnique({ where: { leagueId }, select: { timezone: true } }).catch(() => null)
  return safeTimeZone(s?.timezone)
}

type CreateError = SlotError | 'not_found' | 'poll_open' | 'poll_failed'

/** Offer start times to the league. One open poll at a time. */
export async function createDraftSchedulePoll(leagueId: string, userId: string, rawSlots: unknown, now = new Date()): Promise<{ ok: true; poll: DraftSchedulePoll } | { ok: false; error: CreateError }> {
  const parsed = parseSlots(rawSlots, now)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return { ok: false, error: 'not_found' }
  if (readPoll(((league.settings as Record<string, unknown>) ?? {})[KEY])?.status === 'open') return { ok: false, error: 'poll_open' }

  const tz = await leagueZone(leagueId)
  const id = randomUUID()
  const slots = parsed.slots.map((startsAt, i) => ({ id: `slot-${i + 1}`, startsAt }))
  // Answers close an hour before the first offered time, and never more than a week out.
  const closesAt = new Date(Math.min(Date.parse(parsed.slots[0]!) - 60 * 60 * 1000, now.getTime() + 7 * 24 * 60 * 60 * 1000)).toISOString()
  const question = '🗓️ When can you draft? Pick every time that works for you.'
  let pollMessageId: string | null = null
  try {
    const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
    const msg = await createLeagueChatMessage(leagueId, userId, question, {
      idempotencyKey: `draft-schedule-poll:${id}`,
      type: 'poll',
      source: null,
      metadata: {
        kind: 'draft_schedule',
        draftSchedulePollId: id,
        poll: {
          question,
          // `text` in the league's zone for any surface that only prints text; `startsAt` for the poll,
          // which shows each option in the reader's own zone.
          options: slots.map((s) => ({ id: s.id, text: formatSlot(s.startsAt, tz), startsAt: s.startsAt, votes: [] })),
          closeAt: closesAt,
          allowMultiple: true,
          anonymous: false,
        },
      },
    } as never)
    pollMessageId = (msg as { id?: string } | null)?.id ?? null
  } catch (e) {
    console.warn('[draft-schedule] poll post failed', e instanceof Error ? e.message : e)
    return { ok: false, error: 'poll_failed' }
  }
  const poll: DraftSchedulePoll = { id, pollMessageId, slots, createdBy: userId, createdAt: now.toISOString(), closesAt, status: 'open', lockedSlotId: null, lockedAt: null }
  await updateSettingsLocked(leagueId, (s) => ({ ...s, [KEY]: poll }))
  return { ok: true, poll }
}

export type DraftScheduleView = {
  poll: DraftSchedulePoll | null
  tallies: SlotTally[]
  best: SlotTally | null
  answered: number
  teamCount: number
}

/** The poll and its answers so far. Counts come from the chat poll itself. */
export async function readDraftSchedule(leagueId: string): Promise<DraftScheduleView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, leagueSize: true } })
  if (!league) return null
  const poll = readPoll(((league.settings as Record<string, unknown>) ?? {})[KEY])
  if (!poll) return { poll: null, tallies: [], best: null, answered: 0, teamCount: league.leagueSize ?? 0 }
  const message = poll.pollMessageId ? await prisma.leagueChatMessage.findUnique({ where: { id: poll.pollMessageId }, select: { metadata: true } }).catch(() => null) : null
  const viewer = message ? readViewerPoll(message.metadata, null) : null
  const raw = (message?.metadata as { poll?: { options?: Array<{ id?: string; votes?: unknown }> } } | null)?.poll?.options ?? []
  const voters = new Set(raw.flatMap((o) => (Array.isArray(o.votes) ? o.votes.filter((v): v is string => typeof v === 'string') : [])))
  const tallies = poll.slots.map((s) => ({ id: s.id, startsAt: s.startsAt, count: viewer?.options.find((o) => o.id === s.id)?.count ?? 0 }))
  return { poll, tallies, best: bestSlot(tallies), answered: voters.size, teamCount: league.leagueSize ?? 0 }
}

type LockError = 'not_found' | 'not_open' | 'unknown_slot' | 'refused'

/** Lock one offered time as the draft date, through the settings choke point. */
export async function lockDraftSlot(leagueId: string, userId: string, slotId: unknown): Promise<{ ok: true; draftDateUtc: string } | { ok: false; error: LockError; reason?: string }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return { ok: false, error: 'not_found' }
  const poll = readPoll(((league.settings as Record<string, unknown>) ?? {})[KEY])
  if (!poll || poll.status !== 'open') return { ok: false, error: 'not_open' }
  const slot = poll.slots.find((s) => s.id === slotId)
  if (!slot) return { ok: false, error: 'unknown_slot' }

  const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
  const res = await executeLeagueSettingsPatch(userId, { leagueId, draftDateUtc: slot.startsAt })
  if (res.status < 200 || res.status >= 300) {
    const reason = ((await res.json().catch(() => null)) as { error?: string } | null)?.error
    return { ok: false, error: 'refused', reason: reason ?? `HTTP ${res.status}` }
  }
  const at = new Date().toISOString()
  await updateSettingsLocked(leagueId, (s) => {
    const current = readPoll(s[KEY])
    if (!current || current.id !== poll.id) return null
    return { ...s, [KEY]: { ...current, status: 'locked', lockedSlotId: slot.id, lockedAt: at } }
  })
  return { ok: true, draftDateUtc: slot.startsAt }
}

/** Withdraw an open poll without setting a time. */
export async function cancelDraftSchedulePoll(leagueId: string): Promise<boolean> {
  return updateSettingsLocked(leagueId, (s) => {
    const current = readPoll(s[KEY])
    if (!current || current.status !== 'open') return null
    return { ...s, [KEY]: { ...current, status: 'cancelled' } }
  })
}

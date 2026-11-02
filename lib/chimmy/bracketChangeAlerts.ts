import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { bracketPromptTarget } from '@/lib/chimmy/bracketEvidence'

export type BracketAlertFormat = 'tournament' | 'world_cup' | 'playoff'
export type BracketChangeState = {
  score?: number | null
  rank?: number | null
  correctPicks?: number | null
  incorrectPicks?: number | null
  winnerTeamName?: string | null
  pickTeamName?: string | null
  seriesName?: string | null
}
export type BracketChangeRecord = {
  changeRef?: string
  format: BracketAlertFormat
  entryId: string
  before: BracketChangeState
  after: BracketChangeState
  observedAt: string
}

const ROOT_KEY = 'chimmyBracketChanges'
const MAX_SAVED_CHANGES = 20
const CHANGE_REF_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const prefKey = (format: BracketAlertFormat, entryId: string) => `${format}:${entryId}`
const readChangeState = (value: unknown): BracketChangeState => {
  const row = object(value)
  const number = (key: string) => {
    const item = row[key]
    return typeof item === 'number' && Number.isFinite(item) ? item : null
  }
  const string = (key: string) => {
    const item = row[key]
    return typeof item === 'string' ? item.slice(0, 120) : null
  }
  return { score: number('score'), rank: number('rank'), correctPicks: number('correctPicks'),
    incorrectPicks: number('incorrectPicks'), winnerTeamName: string('winnerTeamName'),
    pickTeamName: string('pickTeamName'), seriesName: string('seriesName') }
}

/** Scoring can touch large pools; cap concurrent preference and delivery reads. */
export async function settleBracketAlertBatch<T>(items: T[], send: (item: T) => Promise<unknown>): Promise<number> {
  let failed = 0
  for (let start = 0; start < items.length; start += 16) {
    const results = await Promise.allSettled(items.slice(start, start + 16).map(send))
    failed += results.filter((result) => result.status === 'rejected').length
  }
  return failed
}

export function bracketChangeAlertsEnabled(raw: unknown, format: BracketAlertFormat, entryId: string): boolean {
  const root = object(raw)
  return object(object(root[ROOT_KEY]).entries)[prefKey(format, entryId)] === true
}

export async function getBracketChangeAlertsEnabled(userId: string, format: BracketAlertFormat, entryId: string) {
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { notificationPreferences: true } })
  return bracketChangeAlertsEnabled(profile?.notificationPreferences, format, entryId)
}

/** The route verifies entry ownership before calling this. Absence always means OFF. */
export async function setBracketChangeAlertsEnabled(userId: string, format: BracketAlertFormat,
  entryId: string, enabled: boolean): Promise<void> {
  // Ensure a profile exists, then change only this key. A whole-object read/write could
  // erase a scoring snapshot or another settings change made at the same time.
  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId }, update: {},
  })
  const key = prefKey(format, entryId)
  await prisma.$executeRaw`
    UPDATE user_profiles SET "notificationPreferences" = jsonb_set(
      COALESCE("notificationPreferences", '{}'::jsonb),
      '{chimmyBracketChanges}',
      jsonb_set(
        COALESCE("notificationPreferences"->'chimmyBracketChanges', '{}'::jsonb),
        '{entries}',
        COALESCE("notificationPreferences"->'chimmyBracketChanges'->'entries', '{}'::jsonb)
          || jsonb_build_object(${key}::text, ${enabled}::boolean),
        true
      ),
      true
    ) WHERE "userId" = ${userId}
  `
}

export function bracketChangeSummary(before: BracketChangeState, after: BracketChangeState): string | null {
  const parts: string[] = []
  if (typeof before.score === 'number' && typeof after.score === 'number' && before.score !== after.score) {
    const delta = after.score - before.score
    parts.push(`score ${delta >= 0 ? '+' : ''}${delta} (${before.score} to ${after.score})`)
  }
  if (typeof before.rank === 'number' && typeof after.rank === 'number' && before.rank !== after.rank) {
    parts.push(`pool rank ${before.rank} to ${after.rank}`)
  }
  if (typeof before.correctPicks === 'number' && typeof after.correctPicks === 'number' && after.correctPicks !== before.correctPicks) {
    parts.push(`correct picks ${before.correctPicks} to ${after.correctPicks}`)
  }
  if (typeof before.incorrectPicks === 'number' && typeof after.incorrectPicks === 'number' && after.incorrectPicks !== before.incorrectPicks) {
    parts.push(`incorrect picks ${before.incorrectPicks} to ${after.incorrectPicks}`)
  }
  if (after.winnerTeamName && after.winnerTeamName.trim().toLocaleLowerCase() !==
    before.winnerTeamName?.trim().toLocaleLowerCase()) {
    const verdict = after.pickTeamName
      ? (after.pickTeamName.trim().toLocaleLowerCase() === after.winnerTeamName.trim().toLocaleLowerCase() ? 'correct' : 'incorrect')
      : 'no saved pick'
    const result = before.winnerTeamName
      ? `winner corrected from ${before.winnerTeamName} to ${after.winnerTeamName}`
      : `${after.winnerTeamName} won`
    parts.push(`${after.seriesName ?? 'Series'}: ${result}; your pick ${after.pickTeamName ?? 'none'} (${verdict})`)
  }
  return parts.length ? parts.join('; ') : null
}

/** Called after a scoring write succeeds. The private snapshot is the before/after record Chimmy reads. */
export async function emitBracketChangeAlert(input: {
  userId: string
  entryId: string
  entryName: string
  poolName: string
  format: BracketAlertFormat
  before: BracketChangeState
  after: BracketChangeState
  observedAt?: Date
}): Promise<boolean> {
  const summary = bracketChangeSummary(input.before, input.after)
  if (!summary || !(await getBracketChangeAlertsEnabled(input.userId, input.format, input.entryId))) return false
  const observedAt = (input.observedAt ?? new Date()).toISOString()
  const change: BracketChangeRecord = {
    changeRef: randomUUID(), format: input.format, entryId: input.entryId,
    before: input.before, after: input.after, observedAt,
  }
  // Persist before delivery even when in-app rows are off. Keep the newest 20
  // transitions for this entry; the update is atomic across concurrent finals.
  const key = prefKey(input.format, input.entryId)
  const payload = JSON.stringify(change)
  await prisma.$executeRaw`
    UPDATE user_profiles SET "notificationPreferences" = jsonb_set(
      COALESCE("notificationPreferences", '{}'::jsonb),
      '{chimmyBracketChangeHistory}',
      jsonb_set(
        COALESCE("notificationPreferences"->'chimmyBracketChangeHistory', '{}'::jsonb),
        ARRAY[${key}::text],
        (SELECT COALESCE(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb)
         FROM (SELECT value, ordinal
               FROM jsonb_array_elements(
                 (CASE WHEN jsonb_typeof("notificationPreferences"->'chimmyBracketChangeHistory'->${key}) = 'array'
                   THEN "notificationPreferences"->'chimmyBracketChangeHistory'->${key}
                   ELSE '[]'::jsonb END) || jsonb_build_array(${payload}::jsonb)
               ) WITH ORDINALITY AS stored(value, ordinal)
               ORDER BY ordinal DESC LIMIT ${MAX_SAVED_CHANGES}::integer) recent),
        true
      ),
      true
    ) WHERE "userId" = ${input.userId}
  `
  const digest = createHash('sha256').update(JSON.stringify({ before: input.before, after: input.after })).digest('hex').slice(0, 24)
  const prompt = `What changed in my ${bracketPromptTarget(input.entryName, input.poolName)}? Change ref: ${change.changeRef}. Use that saved before-and-after result.`
  const actionHref = getChimmyChatHrefWithPrompt(prompt, { source: 'bracket_change_alert' })
  const result = await dispatchNotification({
    userIds: [input.userId], category: 'bracket_updates', productType: 'bracket',
    type: 'chimmy_bracket_change', title: `Bracket update: ${input.entryName.slice(0, 80)}`,
    body: summary.slice(0, 280), actionHref, actionLabel: 'Ask Chimmy what changed',
    meta: { bracketChange: change, entryId: input.entryId, format: input.format, detectedAt: observedAt },
    dedupePrefix: `chimmy-bracket-change:${input.format}:${input.entryId}:${digest}`,
    severity: 'low', skipChannels: { email: true, sms: true },
  })
  return result.delivered > 0
}

/** Read after verifying the same owner and entry in the bracket tool. */
export async function latestBracketChange(userId: string, format: BracketAlertFormat,
  entryId: string, changeRef?: string): Promise<BracketChangeRecord | null> {
  if (changeRef && !CHANGE_REF_RE.test(changeRef)) return null
  const profile = await prisma.userProfile.findUnique({ where: { userId }, select: { notificationPreferences: true } })
  const preferences = object(profile?.notificationPreferences)
  const saved = object(preferences.chimmyBracketChangeHistory)[prefKey(format, entryId)]
  const history = Array.isArray(saved) ? saved : []
  // Old single snapshots remain readable until the first history write.
  const legacy = object(object(preferences.chimmyBracketChangeLatest)[prefKey(format, entryId)])
  const raw = object(changeRef
    ? history.find((row) => object(row).changeRef === changeRef) ??
        (legacy.changeRef === changeRef ? legacy : null)
    : history.at(-1) ?? legacy)
  if (raw.format !== format || raw.entryId !== entryId || typeof raw.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.observedAt))) return null
  return { changeRef: typeof raw.changeRef === 'string' ? raw.changeRef : undefined,
    format, entryId, observedAt: raw.observedAt,
    before: readChangeState(raw.before), after: readChangeState(raw.after) }
}

export async function emitPlayoffDecisionAlerts(input: { challengeId: string; decisions: Array<{
  seriesId: string; seriesName: string; beforeWinner: string | null; winner: string
}> }): Promise<void> {
  if (!input.decisions.length) return
  const challenge = await prisma.playoffBracketChallenge.findUnique({
    where: { id: input.challengeId }, select: { name: true, isTestMode: true },
  })
  if (!challenge || challenge.isTestMode) return
  const entries = await prisma.playoffBracketEntry.findMany({
    where: { challengeId: input.challengeId, finalizedAt: { not: null } },
    select: { id: true, userId: true, name: true, picks: {
      where: { seriesId: { in: input.decisions.map((decision) => decision.seriesId) } },
      select: { seriesId: true, pickTeamName: true },
    } },
  })
  const tasks = entries.flatMap((entry) => input.decisions.map((decision) => ({ entry, decision })))
  const failed = await settleBracketAlertBatch(tasks, ({ entry, decision }) => {
    const pick = entry.picks.find((row) => row.seriesId === decision.seriesId)
    return emitBracketChangeAlert({
      userId: entry.userId, entryId: entry.id, entryName: entry.name,
      poolName: challenge.name, format: 'playoff',
      before: { winnerTeamName: decision.beforeWinner, seriesName: decision.seriesName },
      after: { winnerTeamName: decision.winner, seriesName: decision.seriesName,
        pickTeamName: pick?.pickTeamName ?? null },
    })
  })
  if (failed) console.warn('[playoff bracket] change alerts failed', { failed })
}

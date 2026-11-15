import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import {
  COMMISSIONER_TIEBREAKS_KEY,
  decisionDeadline,
  readCommissionerTiebreak,
  type CommissionerTiebreakEntry,
} from './commissionerTiebreak'

/**
 * Storage and alerts for "Commissioner decides" (./commissionerTiebreak.ts holds the rules).
 *
 * Every write touches ONE key of `League.settings.guillotine_commissioner_tiebreaks` with `jsonb_set`, so a
 * concurrent settings save is never clobbered. The parent object is made first: `jsonb_set` creates only the last
 * key of a path.
 */

export const AWAITING_COMMISSIONER_TIEBREAK_REASON = 'awaiting commissioner tiebreak'

async function writeEntry(leagueId: string, key: string, entry: CommissionerTiebreakEntry): Promise<void> {
  await prisma.$executeRaw`
    UPDATE leagues SET settings = jsonb_set(
      jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, ARRAY[${COMMISSIONER_TIEBREAKS_KEY}]::text[],
        COALESCE(CASE WHEN jsonb_typeof(settings) = 'object' AND jsonb_typeof(settings -> ${COMMISSIONER_TIEBREAKS_KEY}) = 'object' THEN settings -> ${COMMISSIONER_TIEBREAKS_KEY} END, '{}'::jsonb)),
      ARRAY[${COMMISSIONER_TIEBREAKS_KEY}, ${key}]::text[], ${JSON.stringify(entry)}::jsonb)
    WHERE id = ${leagueId}`
}

/** The league owner and the source platform's head commissioner (lib/commissioner/permissions.ts). */
async function commissionerUserIds(leagueId: string, ownerId: string | null | undefined): Promise<string[]> {
  const heads = await prisma.leagueTeam.findMany({
    where: { leagueId, isCommissioner: true, role: { not: 'viewer' }, claimedByUserId: { not: null } },
    select: { claimedByUserId: true },
  })
  return [...new Set([ownerId, ...heads.map((t) => t.claimedByUserId)].filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

/**
 * Hold this week's chop for the commissioner: store the tie (once — a later run that sees a different tie updates
 * the teams but keeps the original clock) and ask the commissioner once. Never throws: a failed write or alert must
 * not stop the score sync, and the chop simply asks again on its next run.
 */
export async function holdChopForCommissioner(args: {
  leagueId: string
  key: string
  week: number
  existing: CommissionerTiebreakEntry | null
  tiedRosterIds: string[]
  needed: number
  now: Date
}): Promise<void> {
  const { leagueId, key, existing, now } = args
  try {
    const entry: CommissionerTiebreakEntry = {
      ...(existing ?? {}),
      tiedRosterIds: args.tiedRosterIds,
      needed: args.needed,
      requestedAt: existing?.requestedAt ?? now.toISOString(),
    }
    const changed = !existing || existing.needed !== entry.needed || existing.tiedRosterIds.join('|') !== entry.tiedRosterIds.join('|')
    if (changed) await writeEntry(leagueId, key, entry)
    if (entry.notifiedAt) return

    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, userId: true } })
    const userIds = await commissionerUserIds(leagueId, league?.userId)
    if (userIds.length) {
      const leagueName = league?.name?.trim() || 'your league'
      const teams = entry.tiedRosterIds.length
      const deadline = decisionDeadline(entry)
      await dispatchNotification({
        userIds,
        category: 'commissioner_alerts',
        type: 'guillotine_commissioner_tiebreak',
        title: `You decide this week's chop in ${leagueName}`,
        body: `${teams} teams are tied for the chop in week ${args.week}. Pick who goes by ${deadline.toUTCString().replace(/:\d\d GMT$/, ' UTC')}, or your league's next tiebreak rule decides.`,
        actionHref: `/league/${leagueId}/guillotine-tiebreak`,
        actionLabel: 'Decide the chop',
        leagueId,
        meta: { week: args.week, key, tiedRosterIds: entry.tiedRosterIds, needed: entry.needed },
        // High: this is time-boxed, so it may reach a commissioner who opted in to texts.
        severity: 'high',
        dedupePrefix: `guillotine-tiebreak:${leagueId}:${key}`,
      })
    }
    await writeEntry(leagueId, key, { ...entry, notifiedAt: now.toISOString() })
  } catch (error) {
    console.warn('[guillotine] commissioner tiebreak hold could not be recorded; the next run asks again', {
      leagueId,
      key,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Save the commissioner's pick under the league row's lock, so two commissioners (or a double tap) cannot both
 * decide. `check` re-validates against the entry as it is NOW, inside the lock.
 */
type Refusal = { ok: false; error: string; status: number }

export async function saveCommissionerDecision(args: {
  leagueId: string
  key: string
  userId: string
  now: Date
  check: (entry: CommissionerTiebreakEntry | null) => { ok: true; rosterIds: string[] } | Refusal
}): Promise<{ ok: true; entry: CommissionerTiebreakEntry } | Refusal> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT settings FROM leagues WHERE id = ${args.leagueId} FOR UPDATE`
    const entry = readCommissionerTiebreak(rows[0]?.settings, args.key)
    const verdict = args.check(entry)
    if (!verdict.ok) return verdict
    const decided: CommissionerTiebreakEntry = {
      ...entry!,
      decidedRosterIds: verdict.rosterIds,
      decidedAt: args.now.toISOString(),
      decidedBy: args.userId,
    }
    await tx.$executeRaw`
      UPDATE leagues SET settings = jsonb_set(settings, ARRAY[${COMMISSIONER_TIEBREAKS_KEY}, ${args.key}]::text[], ${JSON.stringify(decided)}::jsonb)
      WHERE id = ${args.leagueId}`
    await tx.leagueAuditLog.create({
      data: {
        leagueId: args.leagueId,
        userId: args.userId,
        actionType: 'guillotine_tiebreak_decided',
        entityType: 'league',
        entityId: args.leagueId,
        metadata: { key: args.key },
        afterState: { tiedRosterIds: decided.tiedRosterIds, choppedRosterIds: decided.decidedRosterIds },
      },
    })
    return { ok: true as const, entry: decided }
  })
}

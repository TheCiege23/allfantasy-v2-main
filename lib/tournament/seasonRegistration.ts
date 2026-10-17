import 'server-only'
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { seasonContractHash } from './seasonCalendarVerification'
import { buildOpeningField } from './seasonOpeningField'
import { buildSeasonBlueprint } from './seasonBlueprint'
import { BlueprintOperationError } from './seasonBlueprintStore'
import { readOpeningManifest } from './seasonNativeContract'
import { identityArt, type SeasonArt } from './seasonArtwork'

const controlSchema = z.object({ version: z.literal(1), publicationId: z.string(), tokenHash: z.string().regex(/^[a-f0-9]{64}$/), closesAt: z.string().datetime({ offset: true }), waitlistLimit: z.number().int().min(0).max(192), state: z.enum(['open', 'paused']) })
type Control = z.infer<typeof controlSchema>
const controlActions = ['season_registration_opened', 'season_registration_paused']
const activeStatuses = ['registered', 'waitlisted']
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
class RetryRegistration extends Error {}

async function publication(db: Prisma.TransactionClient, tournamentId: string) {
  const row = await db.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_rules_published' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  if (!row) throw new BlueprintOperationError('Publish tournament rules before registration.', 409)
  const data = row.data as { config?: unknown; hash?: unknown; calendar?: unknown }
  const plan = buildSeasonBlueprint(data?.config)
  if (typeof data.hash !== 'string') throw new BlueprintOperationError('The published rules are unavailable.', 409)
  const exceptions = z.object({ pendingGames: z.number().int().min(0), excludedGames: z.array(z.object({ gameId: z.string(), startsAt: z.string().datetime({ offset: true }) })) }).parse(data.calendar)
  return { id: row.id, hash: data.hash, config: plan.config, exceptions }
}
async function control(db: Prisma.TransactionClient, tournamentId: string): Promise<Control | null> {
  const row = await db.tournamentAuditLog.findFirst({ where: { tournamentId, action: { in: controlActions } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  return row ? controlSchema.parse(row.data) : null
}
function inviteValid(c: Control | null, token: string | undefined, publicationId: string) {
  if (!c || c.publicationId !== publicationId || c.state !== 'open' || Date.parse(c.closesAt) <= Date.now() || !token || !/^[a-f0-9]{64}$/.test(token)) return false
  return timingSafeEqual(Buffer.from(c.tokenHash, 'hex'), Buffer.from(hashToken(token), 'hex'))
}
async function log(db: Prisma.TransactionClient, tournamentId: string, userId: string, action: string, data: Prisma.InputJsonValue, timestamp: Date, targetId?: string) {
  await db.tournamentAuditLog.create({ data: { tournamentId, actorId: userId, actorType: 'user', action, targetType: targetId ? 'participant' : 'tournament', targetId: targetId ?? tournamentId, data, createdAt: timestamp } })
}

/** Every membership/control write takes the same shell CAS lock. A bounded retry re-reads capacity after competing joins. */
async function mutate<T>(tournamentId: string, userId: string, ownerOnly: boolean, run: (db: Prisma.TransactionClient, shell: { commissionerId: string }, timestamp: Date) => Promise<T>, allowFrozen = false): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async db => {
        const shell = await db.tournamentShell.findUnique({ where: { id: tournamentId } })
        if (!shell) throw new BlueprintOperationError('Tournament not found.', 404)
        if (ownerOnly && shell.commissionerId !== userId) throw new BlueprintOperationError('Only the owner can manage registration.', 403)
        if (shell.status !== 'rules_published') throw new BlueprintOperationError('Registration is unavailable for this tournament.', 409)
        const timestamp = new Date(Math.max(Date.now(), shell.updatedAt.getTime() + 1))
        const locked = await db.tournamentShell.updateMany({ where: { id: tournamentId, status: 'rules_published', updatedAt: shell.updatedAt }, data: { updatedAt: timestamp } })
        if (locked.count !== 1) throw new RetryRegistration()
        const frozen = await db.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_field_frozen' } })
        if (frozen && !allowFrozen) throw new BlueprintOperationError('The opening field is frozen. Registration and participant changes are locked.', 409)
        return run(db, shell, timestamp)
      })
    } catch (e) {
      if (!(e instanceof RetryRegistration) && (e as { code?: string }).code !== 'P2034') throw e
      if (attempt === 2) throw new BlueprintOperationError('Registration is busy. Please retry; your place has not been duplicated.', 409)
    }
  }
  throw new BlueprintOperationError('Registration is busy.', 409)
}
function beforeDraft(config: ReturnType<typeof buildSeasonBlueprint>['config']) {
  const draft = config.rules?.calendar.drafts.find(d => d.stage === 1)
  if (!draft || !Number.isFinite(Date.parse(draft.startsAt)) || Date.parse(draft.startsAt) <= Date.now()) throw new BlueprintOperationError('Registration changes are locked at the opening draft.', 409)
}
async function promote(db: Prisma.TransactionClient, tournamentId: string, capacity: number, publicationId: string, userId: string, timestamp: Date) {
  let count = await db.tournamentParticipant.count({ where: { tournamentId, status: 'registered' } })
  while (count < capacity) {
    const next = await db.tournamentParticipant.findFirst({ where: { tournamentId, status: 'waitlisted' }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }] })
    if (!next) break
    const acceptance = await db.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_entry_joined', targetId: next.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    if ((acceptance?.data as { publicationId?: string } | null)?.publicationId !== publicationId) throw new BlueprintOperationError('A waitlisted entrant has no matching rule acceptance. The owner must review this entry.', 409)
    await db.tournamentParticipant.update({ where: { id: next.id }, data: { status: 'registered' } })
    await log(db, tournamentId, userId, 'season_waitlist_promoted', { publicationId }, timestamp, next.id)
    count++
  }
  return count
}
async function syncCount(db: Prisma.TransactionClient, tournamentId: string, timestamp: Date) {
  const count = await db.tournamentParticipant.count({ where: { tournamentId, status: 'registered' } })
  await db.tournamentShell.update({ where: { id: tournamentId }, data: { currentParticipantCount: count, updatedAt: timestamp } })
  return count
}

export async function openSeasonRegistration(userId: string, tournamentId: string, publicationId: string, closesAt: string, waitlistLimit: number) {
  const token = randomBytes(32).toString('hex')
  return mutate(tournamentId, userId, true, async (db, _shell, timestamp) => {
    const pub = await publication(db, tournamentId)
    if (pub.id !== publicationId) throw new BlueprintOperationError('The published rule version changed. Reload the tournament.', 409)
    if (!pub.config.rules?.transactionPolicy || !pub.config.rules.draftPolicy) throw new BlueprintOperationError('This frozen version has no complete draft, IR and waiver transaction policy. Create a new plan with complete rules before inviting entrants.', 409)
    beforeDraft(pub.config)
    const end = Date.parse(closesAt)
    const draftAt = Date.parse(pub.config.rules.calendar.drafts.find(d => d.stage === 1)!.startsAt)
    if (!Number.isFinite(end) || end <= Date.now() || end > draftAt) throw new BlueprintOperationError('Registration must close in the future, at or before the opening draft.', 409)
    const c = controlSchema.parse({ version: 1, publicationId: pub.id, tokenHash: hashToken(token), closesAt, waitlistLimit, state: 'open' })
    const waitlisted = await db.tournamentParticipant.count({ where: { tournamentId, status: 'waitlisted' } })
    if (waitlistLimit < waitlisted) throw new BlueprintOperationError('The waitlist limit cannot be smaller than the existing queue.', 409)
    await log(db, tournamentId, userId, 'season_registration_opened', c, timestamp)
    return { invitePath: '/tournament-entry/' + encodeURIComponent(tournamentId) + '?invite=' + token, closesAt, waitlistLimit }
  })
}
export async function pauseSeasonRegistration(userId: string, tournamentId: string) {
  return mutate(tournamentId, userId, true, async (db, _shell, timestamp) => {
    const pub = await publication(db, tournamentId)
    beforeDraft(pub.config)
    const c = await control(db, tournamentId)
    if (!c || c.state === 'paused') return { ok: true }
    await log(db, tournamentId, userId, 'season_registration_paused', { ...c, state: 'paused' }, timestamp)
    return { ok: true }
  })
}

export async function joinSeasonTournament(userId: string, tournamentId: string, token: string, publicationId: string, acceptedHash: string) {
  return mutate(tournamentId, userId, false, async (db, _shell, timestamp) => {
    const pub = await publication(db, tournamentId)
    if (pub.id !== publicationId || pub.hash !== acceptedHash) throw new BlueprintOperationError('Accept the current published tournament rules before joining.', 409)
    const existing = await db.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
    if (existing && activeStatuses.includes(existing.status)) return { participantId: existing.id, status: existing.status }
    if (existing?.status === 'removed') throw new BlueprintOperationError('The owner has removed this entry. Contact them to restore eligibility.', 403)
    beforeDraft(pub.config)
    const c = await control(db, tournamentId)
    if (!inviteValid(c, token, pub.id)) throw new BlueprintOperationError('This invite is unavailable, expired or registration is paused.', 404)
    const count = await promote(db, tournamentId, pub.config.participants, pub.id, userId, timestamp)
    const status = count < pub.config.participants ? 'registered' : 'waitlisted'
    if (status === 'waitlisted') {
      const waiting = await db.tournamentParticipant.count({ where: { tournamentId, status: 'waitlisted' } })
      if (waiting >= c!.waitlistLimit) throw new BlueprintOperationError('The tournament and its waitlist are full.', 409)
    }
    const user = await db.appUser.findUnique({ where: { id: userId }, select: { displayName: true, username: true, avatarUrl: true } })
    if (!user) throw new BlueprintOperationError('Account not found.', 404)
    const data = { status, displayName: user.displayName || user.username || 'Manager', avatarUrl: user.avatarUrl, updatedAt: timestamp }
    const entrant = existing ? await db.tournamentParticipant.update({ where: { id: existing.id }, data }) : await db.tournamentParticipant.create({ data: { tournamentId, userId, ...data } })
    await log(db, tournamentId, userId, 'season_entry_joined', { publicationId: pub.id, hash: pub.hash, status }, timestamp, entrant.id)
    await syncCount(db, tournamentId, timestamp)
    return { participantId: entrant.id, status }
  })
}

export async function changeSeasonEntry(userId: string, tournamentId: string, action: 'withdraw' | 'remove' | 'restore', participantId?: string, reason?: string) {
  return mutate(tournamentId, userId, action !== 'withdraw', async (db, _shell, timestamp) => {
    const pub = await publication(db, tournamentId)
    beforeDraft(pub.config)
    const c = await control(db, tournamentId)
    if (!c || Date.parse(c.closesAt) <= Date.now()) throw new BlueprintOperationError('Participant changes are locked after the registration deadline.', 409)
    const entrant = action === 'withdraw' ? await db.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } }) : await db.tournamentParticipant.findFirst({ where: { id: participantId, tournamentId } })
    if (!entrant) throw new BlueprintOperationError('Entry not found.', 404)
    if (action === 'restore') {
      if (entrant.status !== 'removed') return { ok: true }
      await db.tournamentParticipant.update({ where: { id: entrant.id }, data: { status: 'withdrawn' } })
      await log(db, tournamentId, userId, 'season_entry_restored', { reason: reason ?? '', publicationId: pub.id }, timestamp, entrant.id)
      return { ok: true }
    }
    if (!activeStatuses.includes(entrant.status)) return { ok: true }
    if (action === 'remove' && !reason?.trim()) throw new BlueprintOperationError('Provide a reason for removal.', 409)
    await db.tournamentParticipant.update({ where: { id: entrant.id }, data: { status: action === 'withdraw' ? 'withdrawn' : 'removed' } })
    await log(db, tournamentId, userId, 'season_entry_' + (action === 'withdraw' ? 'withdrawn' : 'removed'), { publicationId: pub.id, reason: reason?.trim() ?? '' }, timestamp, entrant.id)
    await promote(db, tournamentId, pub.config.participants, pub.id, userId, timestamp)
    await syncCount(db, tournamentId, timestamp)
    return { ok: true }
  })
}


/** Freeze once under the same lock as admissions; retries return the original audited assignment. */
export async function freezeSeasonOpeningField(userId: string, tournamentId: string, publicationId: string) {
  return mutate(tournamentId, userId, true, async (db, _shell, timestamp) => {
    const pub = await publication(db, tournamentId)
    if (pub.id !== publicationId) throw new BlueprintOperationError('Reload the current published rules before freezing.', 409)
    const existing = await db.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_field_frozen' } })
    if (existing) return { freezeId: existing.id }
    beforeDraft(pub.config)
    if (!pub.config.rules?.draftPolicy || !pub.config.rules.transactionPolicy) throw new BlueprintOperationError('Complete frozen draft and transaction rules are required.', 409)
    const c = await control(db, tournamentId)
    if (!c || c.publicationId !== pub.id) throw new BlueprintOperationError('Open registration before freezing the field.', 409)
    const entrants = await db.tournamentParticipant.findMany({ where: { tournamentId, status: 'registered' }, orderBy: { id: 'asc' } })
    if (entrants.length !== pub.config.participants) throw new BlueprintOperationError('Exactly the published capacity must be registered before freezing.', 409)
    const acceptances = await db.tournamentAuditLog.findMany({ where: { tournamentId, action: 'season_entry_joined', targetId: { in: entrants.map(e => e.id) } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    const latest = new Map<string, typeof acceptances[number]>()
    for (const acceptance of acceptances) if (acceptance.targetId && !latest.has(acceptance.targetId)) latest.set(acceptance.targetId, acceptance)
    for (const entrant of entrants) {
      const accepted = latest.get(entrant.id)?.data as { publicationId?: string; hash?: string } | undefined
      if (accepted?.publicationId !== pub.id || accepted.hash !== pub.hash) throw new BlueprintOperationError('Every registered entrant must have accepted this exact published rule version.', 409)
    }
    const field = buildOpeningField(pub.config, entrants.map(e => ({ id: e.id, userId: e.userId, displayName: e.displayName, avatarUrl: e.avatarUrl })), randomInt)
    const data = { ...field, hashAlgorithm: 'canonical_sha256_v1', publicationId: pub.id, rulesHash: pub.hash, config: pub.config }
    const manifestHash = seasonContractHash(data)
    const event = await db.tournamentAuditLog.create({ data: { tournamentId, actorId: userId, actorType: 'user', action: 'season_opening_field_frozen', targetType: 'tournament', targetId: tournamentId, data: { ...data, manifestHash }, createdAt: timestamp } })
    return { freezeId: event.id }
  }, true)
}

export async function loadSeasonRegistration(userId: string, tournamentId: string) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell || shell.commissionerId !== userId) throw new BlueprintOperationError('Only the owner can manage registration.', 403)
  if (shell.status !== 'rules_published') return null
  const pub = await publication(prisma, tournamentId)
  const c = await control(prisma, tournamentId)
  const entrants = await prisma.tournamentParticipant.findMany({ where: { tournamentId }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], select: { id: true, displayName: true, status: true, updatedAt: true } })
  const frozen = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_field_frozen' } })
  const manifest = frozen?.data as { manifestHash: string; leagues: ReturnType<typeof buildOpeningField>['leagues'] } | undefined
  const registered = entrants.filter(e => e.status === 'registered').length
  return { frozenField: frozen && manifest ? { id: frozen.id, manifestHash: manifest.manifestHash, leagues: manifest.leagues } : null, publicationId: pub.id, capacity: pub.config.participants, registered, waitlisted: entrants.filter(e => e.status === 'waitlisted').length,
    state: frozen ? 'field_frozen' : c ? (Date.parse(c.closesAt) <= Date.now() ? 'expired' : c.state) : 'not_opened', closesAt: c?.closesAt ?? '', waitlistLimit: c?.waitlistLimit ?? 64,
    fullField: registered === pub.config.participants, entrants: entrants.map(e => ({ id: e.id, displayName: e.displayName, status: e.status })),
    openingDraftAt: pub.config.rules?.calendar.drafts.find(d => d.stage === 1)?.startsAt ?? '',
  }
}

export async function loadSeasonEntry(userId: string, tournamentId: string, token?: string) {
  const shell = await prisma.tournamentShell.findUnique({ where: { id: tournamentId } })
  if (!shell || shell.status !== 'rules_published') return null
  const pub = await publication(prisma, tournamentId)
  const entrant = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId, userId } } })
  const c = await control(prisma, tournamentId)
  if (!entrant && !inviteValid(c, token, pub.id)) return null
  const frozen = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_field_frozen' } })
  const registered = await prisma.tournamentParticipant.count({ where: { tournamentId, status: 'registered' } })
  const queue = entrant?.status === 'waitlisted' ? await prisma.tournamentParticipant.findMany({ where: { tournamentId, status: 'waitlisted' }, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], select: { id: true } }) : []
  let assignment: { key: string; name: string; division: string | null; art: SeasonArt; teams: number; draftSlot: number; startsAt: string; draftId?: string } | undefined
  if (frozen && entrant?.status === 'registered') {
    const raw = frozen.data as Record<string, unknown>, { manifestHash, ...payload } = raw
    if (seasonContractHash(payload) !== manifestHash) throw new BlueprintOperationError('The frozen assignment needs review.', 409)
    const manifest = readOpeningManifest(raw)
    if (manifest.publicationId !== pub.id || manifest.rulesHash !== pub.hash) throw new BlueprintOperationError('The frozen assignment needs review.', 409)
    const index = manifest.leagues.findIndex(l => l.members.some(m => m.id === entrant.id && m.userId === userId))
    const league = manifest.leagues[index], member = league?.members.find(m => m.id === entrant.id && m.userId === userId)
    if (league && member) {
      const provision = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_league_provisioned', targetType: 'opening_league', targetId: league.key }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
      const native = provision?.data as { freezeId?: string; manifestHash?: string; leagueId?: string; draftId?: string } | undefined
      let draftId: string | undefined
      if (native?.freezeId === frozen.id && native.manifestHash === manifest.manifestHash && native.leagueId && native.draftId) {
        const release = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId, action: 'season_opening_draft_released', targetType: 'league', targetId: native.leagueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
        const data = release?.data as { freezeId?: string; manifestHash?: string; publicationId?: string; key?: string; leagueId?: string; draftId?: string; seasonLaunchReady?: boolean } | undefined
        if (data?.freezeId === frozen.id && data.manifestHash === manifest.manifestHash && data.publicationId === manifest.publicationId && data.key === league.key && data.leagueId === native.leagueId && data.draftId === native.draftId && data.seasonLaunchReady === false) draftId = native.draftId
      }
      assignment = { key: league.key, name: league.name, division: league.division, art: identityArt(manifest.config, index), teams: league.slots, draftSlot: member.draftSlot, startsAt: manifest.config.rules!.calendar.drafts.find(d => d.stage === 1)!.startsAt, ...(draftId ? { draftId } : {}) }
    }
  }
  return { tournamentId, name: pub.config.name, sport: pub.config.sport, publicationId: pub.id, hash: pub.hash, config: pub.config, scheduleExceptions: pub.exceptions, registered, capacity: pub.config.participants,
    status: entrant?.status ?? 'not_joined', participantId: entrant?.id ?? null, waitlistPosition: entrant?.status === 'waitlisted' ? queue.findIndex(e => e.id === entrant.id) + 1 : null,
    canJoin: !frozen && inviteValid(c, token, pub.id) && !activeStatuses.includes(entrant?.status ?? '') && entrant?.status !== 'removed',
    canWithdraw: !frozen && !!entrant && activeStatuses.includes(entrant.status) && !!c && Date.parse(c.closesAt) > Date.now() && Date.parse(pub.config.rules!.calendar.drafts.find(d => d.stage === 1)!.startsAt) > Date.now(),
    fieldFrozen: !!frozen, closesAt: c?.closesAt ?? null, ...(assignment ? { assignment } : {}),
  }
}
export type SeasonRegistrationBoard = NonNullable<Awaited<ReturnType<typeof loadSeasonRegistration>>>
export type SeasonEntryView = NonNullable<Awaited<ReturnType<typeof loadSeasonEntry>>>

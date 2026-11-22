import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { combatTransaction } from './beta2025CombatTransaction'
import { lockItemLeague } from './beta2025ItemService'
import { correctionHash } from './beta2025CorrectionPlan'
import { planSeasonAccounting, planUltimatePot, prorateSeasonEntitlements, type AccountingTeam } from './seasonAccountingPlan'
import { tallyUniverseVote, type VoteChoice, type VoteDenominator } from './governancePolicy'
import { isTournamentCoCommissioner } from '@/lib/league/tournamentCoCommissioners'

type Tx = Prisma.TransactionClient
type Json = Record<string, unknown>
export class ZombieOperationsError extends Error {}
function fail(message: string): never { throw new ZombieOperationsError(message) }
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {}
const money = (value: number) => Math.round(value * 100)
const reason = (value: string) => { if (value.trim().length < 12 || value.length > 2000) fail('A meaningful review reason is required'); return value.trim() }
async function context(tx: Tx, leagueId: string, actor: string, ownerOnly: boolean, lock = false) {
  const anchor = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true, settings: true } } } })
  const universe = anchor.universeId ? await tx.zombieUniverse.findUniqueOrThrow({ where: { id: anchor.universeId } }) : null
  const owner = universe ? (universe.commissionedByUserId ?? universe.createdByUserId) : anchor.league.userId
  if (ownerOnly && owner !== actor) fail('Head commissioner access required')
  if (lock && universe) await tx.$queryRaw`SELECT id FROM zombie_universes WHERE id = ${universe.id} FOR UPDATE`
  const leagues = await tx.zombieLeague.findMany({ where: universe ? { universeId: universe.id, season: anchor.season } : { id: anchor.id }, orderBy: { leagueId: 'asc' }, include: { paidConfig: true, level: true } })
  const ids = leagues.map(l => l.leagueId)
  if (lock) for (const id of ids) await lockItemLeague(tx, id)
  const rosters = await tx.roster.findMany({ where: { leagueId: { in: ids } }, select: { id: true, leagueId: true, platformUserId: true, redraftRosterId: true }, orderBy: { id: 'asc' } })
  const users = await tx.appUser.findMany({ where: { id: { in: rosters.map(r => r.platformUserId) } }, select: { id: true, displayName: true, username: true } })
  if (owner !== actor && !users.some(u => u.id === actor)) fail('Universe membership required')
  return { anchor, universe, owner, leagues, ids, rosters, users, scope: universe ? `u:${universe.id}` : `l:${leagueId}`, season: anchor.season }
}
type Context = Awaited<ReturnType<typeof context>>
type FundingReview = { externalWeeklyIncludedInLedger?: boolean; ultimateOpeningCents?: number; ultimateContributionsConfirmed?: boolean; ultimateReference?: string; previousAllocationReference?: string }
async function accountingSource(tx: Tx, c: Context, funding: FundingReview) {
  const [teams, seasons, resolutions, winnings, stints, prizes, previous] = await Promise.all([
    tx.zombieLeagueTeam.findMany({ where: { leagueId: { in: c.ids } }, orderBy: { id: 'asc' } }),
    tx.redraftSeason.findMany({ where: { leagueId: { in: c.ids }, season: c.season }, include: { rosters: true, schedule: true }, orderBy: { id: 'asc' } }),
    tx.zombieWeeklyResolution.findMany({ where: { zombieLeagueId: { in: c.leagues.map(z => z.id) } }, orderBy: [{ zombieLeagueId: 'asc' }, { week: 'asc' }] }),
    tx.zombieWeeklyWinnings.findMany({ where: { leagueId: { in: c.ids } }, orderBy: [{ leagueId: 'asc' }, { rosterId: 'asc' }, { week: 'asc' }] }),
    tx.zombieOperationsRecord.findMany({ where: { scope: { in: c.ids.map(id => `l:${id}`) }, season: c.season, kind: 'owner_stints' }, orderBy: { id: 'asc' } }),
    tx.zombieExternalWeeklyPayout.findMany({ where: { zombieLeagueId: { in: c.leagues.map(z => z.id) } }, orderBy: { id: 'asc' } }),
    tx.zombieOperationsRecord.findMany({ where: { scope: c.scope, season: { lt: c.season }, kind: 'accounting_close' }, orderBy: [{ season: 'desc' }, { createdAt: 'desc' }], take: 1 }),
  ])
  const pending = await tx.zombieCorrectionReview.count({ where: { zombieLeagueId: { in: c.leagues.map(z => z.id) }, effectsPending: true } })
  const closed = await tx.zombieOperationsRecord.findUnique({ where: { id: `close:${c.scope}:${c.season}` } })
  const basis = object(object(closed?.payload).fundingBasis)
  const effectiveFunding: FundingReview = { ...funding,
    externalWeeklyIncludedInLedger: funding.externalWeeklyIncludedInLedger ?? (typeof basis.externalWeeklyIncludedInLedger === 'boolean' ? basis.externalWeeklyIncludedInLedger : undefined),
    ultimateOpeningCents: funding.ultimateOpeningCents ?? (typeof basis.ultimateOpeningCents === 'number' ? basis.ultimateOpeningCents : undefined) }
  return { leagues: c.leagues, rosters: c.rosters, teams, seasons, resolutions, winnings, stints, prizes, previous, pending, funding: effectiveFunding }
}
type Source = Awaited<ReturnType<typeof accountingSource>>
function buildAccounting(source: Source) {
  const blockers: string[] = [], results: Array<{ leagueId: string; name: string; result: ReturnType<typeof planSeasonAccounting> }> = []
  const alpha: Array<AccountingTeam & { totalWeeks: number }> = []
  if (source.pending) blockers.push('Finish correction standings and report retries first.')
  for (const z of source.leagues) {
    try {
      if (z.sport !== 'NFL') fail(`${z.name}: the financial policy is the approved 2025 NFL policy only.`)
      if (!['complete', 'completed'].includes(z.status) || z.correctionHoldFromWeek != null) fail(`${z.name}: finish the season and correction holds first.`)
      const season = source.seasons.find(s => s.leagueId === z.leagueId)
      if (!season) fail(`${z.name}: native season is unavailable.`)
      const rows = source.resolutions.filter(r => r.zombieLeagueId === z.id)
      const scheduled = [...new Set(season.schedule.filter(m => m.awayRosterId && !m.isMedianMatchup).map(m => m.week))].sort((a, b) => a - b)
      if (!scheduled.length || scheduled.some(w => !rows.some(r => r.week === w && r.status === 'complete' && !r.requiresStatCorrection))) fail(`${z.name}: every scheduled week must have an unheld completed settlement.`)
      const totalWeeks = scheduled.length
      if (scheduled.some((w, i) => w !== i + 1)) fail(`${z.name}: partial-season calendar needs an explicit ownership review.`)
      const field: AccountingTeam[] = source.teams.filter(t => t.leagueId === z.leagueId).map(t => {
        const roster = source.rosters.find(r => r.id === t.rosterId), native = season.rosters.find(r => r.id === roster?.redraftRosterId)
        if (!roster || !native) fail('Verify the native roster crosswalk before accounting.')
        const saved = source.stints.find(s => s.id === `stints:${z.leagueId}:${t.rosterId}:${z.season}`)
        const first = object(rows.find(r => r.week === 1)?.settlementSnapshot).owners as Array<{ rosterId: string; userId: string }> | undefined
        if (!saved && first?.find(o => o.rosterId === t.rosterId)?.userId !== roster.platformUserId) fail('Opening ownership is unavailable or changed without a recorded stint.')
        const raw = saved ? object(saved.payload).stints as Array<{ userId: string; startWeek: number; endWeek: number | null }> : [{ userId: roster.platformUserId, startWeek: 1, endWeek: totalWeeks }]
        const ledger = source.winnings.filter(w => w.rosterId === t.rosterId && w.leagueId === z.leagueId)
        if (ledger.some(w => w.source !== 'weekly_settlement_2025') || new Set(ledger.map(w => w.week)).size !== totalWeeks) fail('Every weekly ledger row must use the sealed 2025 policy.')
        const weeklyCents = money(ledger.reduce((n, w) => n + w.amount, 0))
        if (weeklyCents !== money(t.totalWinnings)) fail('The winnings total disagrees with the season ledger.')
        const team = { rosterId: t.rosterId, role: t.status, points: native.pointsFor, weeklyCents,
          stints: raw.map(s => ({ ...s, endWeek: s.endWeek ?? totalWeeks })) }
        if (z.isPaid && (z.level?.tierLabel ?? z.level?.name)?.toLowerCase() === 'alpha' && (z.ultimateSurvivorPot || z.paidConfig?.ultimateSurvivorEnabled)) alpha.push({ ...team, totalWeeks })
        return team
      })
      const cfg = z.paidConfig, prizes = source.prizes.filter(p => p.zombieLeagueId === z.id)
      if (z.isPaid && !cfg) fail('Paid league funding must be recorded before accounting.')
      if (prizes.length && source.funding.externalWeeklyIncludedInLedger == null) fail('Confirm whether external weekly prize records duplicate the internal ledger or are separate prizes.')
      const funded = z.isPaid ? money(cfg!.totalCollected) : 0
      const fee = cfg && z.isPaid ? Math.min(Math.round(funded * cfg.commissionerFeeRate), cfg.commissionerFeeCap == null ? funded : money(cfg.commissionerFeeCap)) : 0
      const result = planSeasonAccounting({ teams: field, totalWeeks, paid: z.isPaid, fundedCents: funded, feeCents: fee,
        otherPrizeCents: z.isPaid && !source.funding.externalWeeklyIncludedInLedger ? prizes.reduce((n, p) => n + p.amountCents, 0) : 0 })
      results.push({ leagueId: z.leagueId, name: z.name ?? 'Zombie league', result })
    } catch (e) { blockers.push(e instanceof Error ? e.message : 'Season requires accounting review') }
  }
  let ultimate: (ReturnType<typeof planUltimatePot> & { owners: ReturnType<typeof prorateSeasonEntitlements>['owners'] }) | null = null
  const priorPot = object(object(source.previous[0]?.payload).plan).ultimate as { closingCents?: number } | undefined
  if (!alpha.length && (priorPot?.closingCents ?? 0) > 0) blockers.push('Reconcile the outstanding Alpha carryover before disabling or changing the Alpha pot.')
  if (alpha.length && !blockers.length) try {
    if (!source.funding.ultimateContributionsConfirmed || (source.funding.ultimateReference?.trim().length ?? 0) < 3) fail('Confirm the actual five-dollar Alpha contributions and record their external reconciliation reference.')
    const previous = source.previous[0]
    if (previous && previous.season !== source.leagues[0].season - 1) fail('An Ultimate pot season is missing; reconcile the carryover first.')
    const closing = object(object(previous?.payload).plan).ultimate as { closingCents?: number } | undefined
    const opening = previous ? closing?.closingCents ?? 0 : source.funding.ultimateOpeningCents
    if (opening == null) fail('Record the reconciled opening Ultimate pot for the first tracked season.')
    const pot = planUltimatePot(opening, alpha)
    ultimate = { ...pot, owners: prorateSeasonEntitlements(alpha, pot.awards).owners }
  } catch (e) { blockers.push(e instanceof Error ? e.message : 'Ultimate pot requires review') }
  return { policy: 'beta_2025', blockers: [...new Set(blockers)], leagues: results, ultimate, paymentsAreExternal: true }
}
const sourceHash = (source: Source) => correctionHash(JSON.parse(JSON.stringify({ ...source, funding: {
  externalWeeklyIncludedInLedger: source.prizes.length ? source.funding.externalWeeklyIncludedInLedger : undefined,
  ultimateOpeningCents: source.previous.length ? undefined : source.funding.ultimateOpeningCents,
} }, (k, v) => k === 'updatedAt' ? undefined : v)))
export async function previewSeasonAccounting(leagueId: string, actor: string, funding: FundingReview) {
  return combatTransaction(async tx => {
    const c = await context(tx, leagueId, actor, true, true), source = await accountingSource(tx, c, funding), hash = sourceHash(source), plan = buildAccounting(source)
    const prior = await tx.zombieOperationsRecord.findUnique({ where: { id: `close:${c.scope}:${c.season}` } })
    const previousApprovalHash = prior ? String(object(prior.payload).hash) : null
    if (previousApprovalHash === hash) return prior!
    if (prior && (funding.previousAllocationReference?.trim().length ?? 0) < 3) plan.blockers.push('This changes an already approved allocation. Reconcile its external payments and record the reconciliation reference before another approval.')
    const attestation = correctionHash({ previousApprovalHash, funding }).slice(0, 16)
    const id = `review:${c.scope}:${c.season}:${hash}:${attestation}`
    return tx.zombieOperationsRecord.upsert({ where: { id }, create: { id, scope: c.scope, season: c.season,
      kind: 'accounting_review', actorUserId: actor, payload: toPrismaJsonInput({ hash, source, plan, funding, previousApprovalHash }) }, update: {} })
  }, 60_000)
}
export async function approveSeasonAccounting(leagueId: string, actor: string, reviewId: string, hash: string, note: string) {
  reason(note)
  return combatTransaction(async tx => {
    const c = await context(tx, leagueId, actor, true, true), review = await tx.zombieOperationsRecord.findUniqueOrThrow({ where: { id: reviewId } })
    if (review.scope !== c.scope || review.season !== c.season || review.kind !== 'accounting_review') fail('Review belongs to a different season or universe')
    const saved = object(review.payload), id = `close:${c.scope}:${c.season}`
    const old = await tx.zombieOperationsRecord.findUnique({ where: { id } })
    if (old && object(old.payload).hash === hash && object(old.payload).reviewId === reviewId) return old
    if ((saved.previousApprovalHash ?? null) !== (old ? object(old.payload).hash : null)) fail('The previous approval changed. Prepare a fresh accounting review.')
    const source = await accountingSource(tx, c, object(saved.funding)), plan = buildAccounting(source)
    if (saved.hash !== hash || sourceHash(source) !== hash) fail('Stale accounting preview. Prepare a fresh review.')
    if (plan.blockers.length) fail('Resolve every accounting dependency first')
    const reference = source.funding.previousAllocationReference?.trim()
    if (old && (!reference || reference.length < 3)) fail('Record actual external reconciliation before changing an approved allocation')
    if (old) await tx.zombieOperationsRecord.create({ data: { id: `accounting-history:${crypto.randomUUID()}`, scope: c.scope, season: c.season, kind: 'accounting_history', actorUserId: actor,
      payload: toPrismaJsonInput({ previous: old.payload, nextReviewId: reviewId, externalReference: reference, reason: note.trim() }) } })
    const payload = toPrismaJsonInput({ reviewId, hash, plan, note: note.trim(), approvedAt: new Date().toISOString(), externalReference: reference,
      fundingBasis: { externalWeeklyIncludedInLedger: source.funding.externalWeeklyIncludedInLedger, ultimateOpeningCents: source.funding.ultimateOpeningCents }, externalPaymentUnchanged: true })
    return tx.zombieOperationsRecord.upsert({ where: { id }, create: { id, scope: c.scope, season: c.season, kind: 'accounting_close', actorUserId: actor, payload }, update: { actorUserId: actor, payload } })
  }, 60_000)
}
type Proposal = { title: string; text: string; proposer: string; secondedBy: string | null; deadline: string | null; electorate: string[];
  denominator: VoteDenominator; effectiveSeason: number; status: string; result?: ReturnType<typeof tallyUniverseVote> }
async function proposalRow(tx: Tx, c: Context, id: string) {
  const row = await tx.zombieOperationsRecord.findUniqueOrThrow({ where: { id } })
  if (row.kind !== 'proposal' || row.scope !== c.scope || row.season !== c.season) fail('Proposal belongs to another universe or season')
  return { row, proposal: row.payload as unknown as Proposal }
}
export async function governanceAction(leagueId: string, actor: string, action: 'configure' | 'propose' | 'second' | 'vote' | 'finalize', input: Json) {
  return combatTransaction(async tx => {
    const c = await context(tx, leagueId, actor, false, true)
    if (!c.universe) fail('Universe governance requires a linked universe')
    const electorate = [...new Set(c.users.map(u => u.id))].sort()
    if (action === 'configure') {
      if (actor !== c.owner || !['votes_cast', 'eligible_owners'].includes(String(input.denominator))) fail('Head commissioner and an explicit denominator are required')
      if (await tx.zombieOperationsRecord.count({ where: { scope: c.scope, season: c.season, kind: 'proposal' } })) fail('The denominator cannot change after a proposal exists this season')
      return tx.zombieUniverse.update({ where: { id: c.universe.id }, data: { settings: toPrismaJsonInput({ ...object(c.universe.settings), zombieGovernanceDenominator: input.denominator }) } })
    }
    if (!electorate.includes(actor) && !(action === 'finalize' && actor === c.owner)) fail('A current owner seat is required to propose, second or vote')
    if (action === 'propose') {
      const title = String(input.title ?? '').trim(), text = String(input.text ?? '').trim(), denominator = input.denominator as VoteDenominator
      if (title.length < 5 || title.length > 140 || text.length < 20 || text.length > 4000 || !['votes_cast', 'eligible_owners'].includes(denominator)) fail('Provide a proposal, reason and explicit voting denominator')
      if ((object(c.universe.settings).zombieGovernanceDenominator ?? 'votes_cast') !== denominator) fail('Use the universe voting denominator')
      if (c.leagues.some(z => !['complete', 'completed'].includes(z.status))) fail('Rule-change proposals open after every universe league finishes')
      const payload: Proposal = { title, text, proposer: actor, secondedBy: null, deadline: null, electorate, denominator, effectiveSeason: c.season + 1, status: 'awaiting_second' }
      return tx.zombieOperationsRecord.create({ data: { id: `proposal:${crypto.randomUUID()}`, scope: c.scope, season: c.season, kind: 'proposal', actorUserId: actor, payload: toPrismaJsonInput(payload) } })
    }
    const { row, proposal } = await proposalRow(tx, c, String(input.proposalId ?? ''))
    if (action === 'second') {
      if (proposal.proposer === actor) fail('A different owner must second the proposal')
      if (proposal.status !== 'awaiting_second') return row
      proposal.secondedBy = actor; proposal.deadline = new Date(Date.now() + 86_400_000).toISOString(); proposal.status = 'voting'
      for (const league of c.leagues) await tx.leagueChatMessage.upsert({ where: { id: `vote:${row.id}:${league.leagueId}` }, create: {
        id: `vote:${row.id}:${league.leagueId}`, leagueId: league.leagueId, userId: actor, type: 'host_announcement',
        message: `Universe rule vote: ${proposal.title}\nA second owner has supported this proposal. Vote Yes, No or Abstain in Zombie season operations. Closes ${proposal.deadline}. Passed rules apply in season ${proposal.effectiveSeason}.`,
        metadata: { senderIsHost: true, contentType: 'host_announcement', proposalId: row.id } }, update: {} })
      return tx.zombieOperationsRecord.update({ where: { id: row.id }, data: { payload: toPrismaJsonInput(proposal) } })
    }
    if (action === 'vote') {
      const choice = input.choice as VoteChoice
      if (proposal.status !== 'voting' || !proposal.deadline || Date.now() >= new Date(proposal.deadline).getTime() || !proposal.electorate.includes(actor) || !['yes', 'no', 'abstain'].includes(choice)) fail('Voting is closed or this ballot is ineligible')
      const id = `ballot:${row.id}:${actor}`
      return tx.zombieOperationsRecord.upsert({ where: { id }, create: { id, scope: c.scope, season: c.season, kind: 'ballot', actorUserId: actor, payload: { proposalId: row.id, userId: actor, choice } }, update: { payload: { proposalId: row.id, userId: actor, choice } } })
    }
    if (proposal.status !== 'voting') return row
    if (!proposal.deadline || Date.now() < new Date(proposal.deadline).getTime()) fail('The full 24-hour vote must finish before tallying')
    const ballots = await tx.zombieOperationsRecord.findMany({ where: { scope: c.scope, season: c.season, kind: 'ballot', payload: { path: ['proposalId'], equals: row.id } } })
    proposal.result = tallyUniverseVote(proposal.electorate, ballots.map(b => b.payload as unknown as { userId: string; choice: VoteChoice }), proposal.denominator)
    proposal.status = proposal.result.passed ? 'passed_for_next_season' : 'not_passed'
    return tx.zombieOperationsRecord.update({ where: { id: row.id }, data: { payload: toPrismaJsonInput(proposal) } })
  })
}
/** Bounded housekeeping; it tallies due votes and never applies arbitrary rule text to live settings. */
export async function expireUniverseVotes() {
  const rows = await prisma.zombieOperationsRecord.findMany({ where: { kind: 'proposal', AND: [{ payload: { path: ['status'], equals: 'voting' } }, { payload: { path: ['deadline'], lte: new Date().toISOString() } }] }, orderBy: { createdAt: 'asc' }, take: 30 })
  for (const row of rows) {
    const p = row.payload as unknown as Proposal
    if (!p.deadline || new Date(p.deadline).getTime() > Date.now()) continue
    const universeId = row.scope.startsWith('u:') ? row.scope.slice(2) : ''
    const league = await prisma.zombieLeague.findFirst({ where: { universeId, season: row.season }, select: { leagueId: true } })
    const universe = await prisma.zombieUniverse.findUnique({ where: { id: universeId }, select: { commissionedByUserId: true, createdByUserId: true } })
    if (league && universe) await governanceAction(league.leagueId, universe.commissionedByUserId ?? universe.createdByUserId ?? p.proposer, 'finalize', { proposalId: row.id }).catch(() => {})
  }
}
export async function escalateOwnerContacts() {
  const due = await prisma.zombieOperationsRecord.findMany({ where: { kind: 'owner_contact', AND: [{ payload: { path: ['status'], equals: 'awaiting_response' } }, { payload: { path: ['deadline'], lte: new Date().toISOString() } }] }, orderBy: { createdAt: 'asc' }, take: 30 })
  for (const candidate of due) {
    const data = object(candidate.payload)
    if (data.escalatedAt || !data.deadline || new Date(String(data.deadline)).getTime() > Date.now()) continue
    const leagueId = candidate.scope.startsWith('l:') ? candidate.scope.slice(2) : ''
    if (!leagueId) continue
    await combatTransaction(async tx => {
      await lockItemLeague(tx, leagueId)
      const row = await tx.zombieOperationsRecord.findUniqueOrThrow({ where: { id: candidate.id } }), payload = object(row.payload)
      if (payload.status !== 'awaiting_response' || payload.escalatedAt || new Date(String(payload.deadline)).getTime() > Date.now()) return
      const z = await tx.zombieLeague.findUniqueOrThrow({ where: { leagueId }, include: { league: { select: { userId: true } }, universe: { select: { commissionedByUserId: true, createdByUserId: true } } } })
      const owner = z.universe?.commissionedByUserId ?? z.universe?.createdByUserId ?? z.league.userId
      await tx.platformNotification.upsert({ where: { sourceKey: `owner-review:${row.id}:${correctionHash(payload.deadline).slice(0, 10)}` },
        create: { sourceKey: `owner-review:${row.id}:${correctionHash(payload.deadline).slice(0, 10)}`, userId: owner, leagueId, type: 'zombie_owner_recovery', severity: 'high', title: 'Participation notice needs review',
          body: 'The full 48-hour response window has passed. Review the contact and any circumstances before assigning a replacement. No owner was removed automatically.', meta: { href: `/league/${leagueId}?view=zombie`, contactId: row.id } }, update: {} })
      await tx.zombieOperationsRecord.update({ where: { id: row.id }, data: { payload: toPrismaJsonInput({ ...payload, status: 'needs_commissioner_review', escalatedAt: new Date().toISOString() }) } })
    })
  }
}
export async function readSeasonOperations(leagueId: string, actor: string) {
  return combatTransaction(async tx => {
    const c = await context(tx, leagueId, actor, false), records = await tx.zombieOperationsRecord.findMany({ where: { scope: { in: [...new Set([c.scope, `l:${leagueId}`])] }, season: c.season }, orderBy: { createdAt: 'desc' }, take: 100 })
    return { scope: c.scope, userId: actor, userNames: Object.fromEntries(c.users.map(u => [u.id, u.displayName || u.username])), season: c.season, canManage: c.owner === actor, denominator: object(c.universe?.settings).zombieGovernanceDenominator ?? 'votes_cast', teams: c.rosters.map(r => ({ id: r.id, leagueId: r.leagueId, userId: r.platformUserId })),
      records: records.filter(r => c.owner === actor || r.kind === 'proposal' || r.kind === 'accounting_close' || ((r.kind === 'ballot' || r.kind === 'acceptance' || r.kind === 'consent') && r.actorUserId === actor) || (r.kind === 'owner_contact' && object(r.payload).userId === actor))
        .map(r => ({ id: r.id, kind: r.kind, payload: r.kind === 'accounting_review' ? { hash: object(r.payload).hash, plan: object(r.payload).plan } : r.payload })) }
  })
}

export async function ownerRecoveryAction(leagueId: string, actor: string, action: 'contact' | 'respond' | 'replace', input: Json) {
  return combatTransaction(async tx => {
    const c = await context(tx, leagueId, actor, action !== 'respond', true)
    const roster = c.rosters.find(r => r.id === input.rosterId && r.leagueId === leagueId)
    if (!roster) fail('A roster in this league is required')
    const z = c.leagues.find(l => l.leagueId === leagueId)!
    if (z.correctionHoldFromWeek != null || await tx.zombieWeeklyResolution.count({ where: { zombieLeagueId: z.id, status: { in: ['resolving', 'review_required'] } } })) fail('Resolve active settlement or correction dependencies before ownership changes')
    const id = `contact:${leagueId}:${roster.id}:${z.season}`
    const contact = await tx.zombieOperationsRecord.findUnique({ where: { id } })
    if (action === 'respond') {
      if (roster.platformUserId !== actor || !contact || object(contact.payload).userId !== actor || !['awaiting_response', 'needs_commissioner_review'].includes(String(object(contact.payload).status))) fail('Only the contacted current owner may respond')
      return tx.zombieOperationsRecord.update({ where: { id }, data: { payload: toPrismaJsonInput({ ...object(contact.payload), status: 'responded', respondedAt: new Date().toISOString() }) } })
    }
    if (action === 'contact') {
      const note = reason(String(input.reason ?? ''))
      if (contact && object(contact.payload).userId === roster.platformUserId && ['awaiting_response', 'needs_commissioner_review'].includes(String(object(contact.payload).status))) return contact
      const payload = { userId: roster.platformUserId, reason: note, contactedAt: new Date().toISOString(), deadline: new Date(Date.now() + 172_800_000).toISOString(), status: 'awaiting_response' }
      await tx.zombieOperationsRecord.create({ data: { id: `contact-history:${crypto.randomUUID()}`, scope: `l:${leagueId}`, season: z.season, kind: 'owner_contact_history', actorUserId: actor, payload } })
      const record = await tx.zombieOperationsRecord.upsert({ where: { id }, create: { id, scope: `l:${leagueId}`, season: z.season, kind: 'owner_contact', actorUserId: actor, payload }, update: { payload } })
      await tx.platformNotification.create({ data: { leagueId, userId: roster.platformUserId, type: 'zombie_owner_contact', severity: 'high', title: 'Please confirm your Zombie participation',
        body: `${note} Please respond in Zombie season operations within 48 hours. The commissioner will review any replacement.`, meta: { href: `/league/${leagueId}?view=zombie`, contactId: id } } })
      await tx.zombieAuditLog.create({ data: { leagueId, zombieLeagueId: z.id, eventType: 'owner_replacement', metadata: { action: 'contacted', rosterId: roster.id, actorUserId: actor, deadline: payload.deadline } } })
      return record
    }
    const note = reason(String(input.reason ?? '')), account = String(input.newUserId ?? '').trim()
    const candidates = await tx.appUser.findMany({ where: { OR: [{ id: account }, { username: { equals: account, mode: 'insensitive' } }] }, select: { id: true, displayName: true, username: true }, take: 2 })
    if (candidates.length !== 1) fail('Choose an unambiguous registered replacement username or account')
    const replacement = candidates[0]
    const newUserId = replacement.id
    if (contact && object(contact.payload).status === 'replaced' && object(contact.payload).newUserId === newUserId && roster.platformUserId === newUserId) return contact
    if (!contact || object(contact.payload).userId !== roster.platformUserId || !['awaiting_response', 'needs_commissioner_review'].includes(String(object(contact.payload).status)) || Date.now() < new Date(String(object(contact.payload).deadline)).getTime()) fail('Replacement requires the contacted owner and the full unanswered 48-hour window')
    if (c.rosters.some(r => r.platformUserId === newUserId)) fail('One owner may occupy only one league in a universe')
    const pastOwnership = await tx.zombieOperationsRecord.findMany({ where: { scope: { in: c.ids.map(id => `l:${id}`) }, season: c.season, kind: 'owner_stints' }, select: { payload: true } })
    if (pastOwnership.some(row => ((object(row.payload).stints ?? []) as Array<{ userId: string }>).some(s => s.userId === newUserId))) fail('This account already managed a team in this universe season; review its prior ownership instead of creating a second history')
    if (roster.platformUserId === c.owner || roster.platformUserId === c.anchor.league.userId || isTournamentCoCommissioner(c.anchor.league.settings, roster.platformUserId)) fail('Transfer commissioner authority separately before replacing that seat')
    const settled = await tx.zombieWeeklyResolution.findMany({ where: { zombieLeagueId: z.id, status: 'complete' }, orderBy: { week: 'asc' } })
    if (settled.some(r => r.requiresStatCorrection)) fail('Resolve score corrections before replacing an owner')
    const startWeek = (settled.at(-1)?.week ?? 0) + 1
    if (z.totalWeeks == null || startWeek > z.totalWeeks || !roster.redraftRosterId) fail('Replacement needs an active native season with remaining weeks')
    const historyId = `stints:${leagueId}:${roster.id}:${z.season}`, old = await tx.zombieOperationsRecord.findUnique({ where: { id: historyId } })
    const opening = object(settled[0]?.settlementSnapshot).owners as Array<{ rosterId: string; userId: string }> | undefined
    if (!old && settled.length && opening?.find(o => o.rosterId === roster.id)?.userId !== roster.platformUserId) fail('Historical ownership needs reconciliation before replacement')
    const stints = (old ? object(old.payload).stints : [{ userId: roster.platformUserId, startWeek: 1, endWeek: null }]) as Array<{ userId: string; startWeek: number; endWeek: number | null }>
    const current = stints.at(-1)
    if (!current || current.userId !== roster.platformUserId || current.endWeek != null || current.startWeek >= startWeek) fail('Replacement ownership history is ambiguous')
    current.endWeek = startWeek - 1; stints.push({ userId: newUserId, startWeek, endWeek: null })
    await tx.zombieOperationsRecord.upsert({ where: { id: historyId }, create: { id: historyId, scope: `l:${leagueId}`, season: z.season, kind: 'owner_stints', actorUserId: actor, payload: { stints } }, update: { payload: { stints } } })
    await tx.roster.update({ where: { id: roster.id }, data: { platformUserId: newUserId } })
    const displayName = replacement.displayName || replacement.username
    await tx.redraftRoster.update({ where: { id: roster.redraftRosterId }, data: { ownerId: newUserId, ownerName: displayName } })
    await tx.leagueTeam.updateMany({ where: { leagueId, OR: [{ externalId: roster.id }, { platformUserId: roster.platformUserId }] }, data: { platformUserId: newUserId, claimedByUserId: newUserId, ownerName: displayName, isOrphan: false, isCommissioner: false, isCoCommissioner: false, role: 'member' } })
    await tx.redraftLeagueMember.deleteMany({ where: { leagueId, userId: roster.platformUserId } })
    await tx.redraftLeagueMember.upsert({ where: { leagueId_userId: { leagueId, userId: newUserId } }, create: { leagueId, userId: newUserId, role: 'MEMBER' }, update: {} })
    const team = await tx.zombieLeagueTeam.findUniqueOrThrow({ where: { leagueId_rosterId: { leagueId, rosterId: roster.id } } })
    await tx.zombieLeagueTeam.update({ where: { id: team.id }, data: { displayName } })
    await tx.zombieTeamItem.updateMany({ where: { teamStatusId: team.id }, data: { userId: newUserId } })
    await tx.whispererRecord.updateMany({ where: { zombieLeagueId: z.id, userId: roster.platformUserId }, data: { userId: newUserId, displayName } })
    await tx.zombieCoWhisperer.updateMany({ where: { zombieLeagueId: z.id, userId: roster.platformUserId }, data: { userId: newUserId } })
    await tx.zombieRoleWorkflow.updateMany({ where: { zombieLeagueId: z.id, status: 'pending', actorUserId: roster.platformUserId }, data: { actorUserId: newUserId } })
    await tx.zombieRoleWorkflow.updateMany({ where: { zombieLeagueId: z.id, status: 'pending', targetUserId: roster.platformUserId }, data: { targetUserId: newUserId } })
    await tx.zombieOperationsRecord.update({ where: { id }, data: { payload: toPrismaJsonInput({ ...object(contact.payload), status: 'replaced', newUserId, startWeek, reason: note }) } })
    await tx.zombieAuditLog.create({ data: { leagueId, zombieLeagueId: z.id, eventType: 'owner_replacement', metadata: { action: 'assigned', rosterId: roster.id, previousUserId: roster.platformUserId, newUserId, startWeek, actorUserId: actor, reason: note, refundIssued: false } } })
    return tx.zombieOperationsRecord.create({ data: { id: `replacement:${crypto.randomUUID()}`, scope: `l:${leagueId}`, season: z.season, kind: 'replacement', actorUserId: actor,
      payload: { rosterId: roster.id, previousUserId: roster.platformUserId, newUserId, startWeek, mustStartGamma: startWeek > 9, reason: note, refundIssued: false } } })
  })
}

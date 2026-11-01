import 'server-only'

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/carryDynastyRosters'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { ownerHasAfCommissionerPlan } from '@/lib/stat-corrections/applyStatCorrections'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphanRosterResolver'
import { addToBench, removeFromLineup, seasonTeamsByRoster } from '@/lib/dispersal-draft/nativeDispersal'
import { persistRosterLineupWithEngine } from '@/lib/roster-lineup-engine/lineupService'
import type { WorkspaceTaskCandidate } from '@/lib/commissioner-workspace/taskSources'
import {
  checkClaim,
  claimedNotice,
  claimsLeft,
  describeTaxiStealing,
  isDue,
  outcomeNotice,
  promoteFromTaxi,
  readTaxiStealClaims,
  readTaxiStealingRule,
  taxiPlayerIds,
  trimClaims,
  TAXI_STEAL_CLAIMS_KEY,
  type ClaimIssue,
  type TaxiStealClaim,
  type TaxiStealingRule,
} from './taxiStealing'

/**
 * Taxi stealing (./taxiStealing.ts) against the league's rows: the Waivers card, claims, protection,
 * the hourly resolution, the Commish OS task and Chimmy.
 *
 * Storage, without a new table: every claim is in `League.settings.taxi_steal_claims`, written with
 * `jsonb_set` on that one key inside a transaction that holds the league row FOR UPDATE — so two
 * claims on one player cannot both open, and a protection and a steal cannot both win.
 *
 * "On the taxi squad" is the team's saved lineup (`Roster.playerData`), which every lineup save keeps
 * in step with `RedraftRosterPlayer.slotType`. A steal moves the player's `RedraftRosterPlayer` row to
 * the claiming team's bench and edits both lineups for that one player, as a dispersal claim does.
 * Protection is the owner's ordinary lineup save, so every other lineup rule still applies to it.
 *
 * DB-first: nothing here calls a provider. Native dynasty-family leagues only.
 */

type Db = Prisma.TransactionClient

const loadLeague = (leagueId: string, db: Db = prisma) =>
  db.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, userId: true, platform: true, leagueType: true, isDynasty: true, settings: true },
  })
type LeagueRow = NonNullable<Awaited<ReturnType<typeof loadLeague>>>

const applies = (league: LeagueRow) => resolveWriteAuthority(league.platform) === 'NATIVE' && isDynastyFamilyLeague(league)

const currentSeason = (leagueId: string) =>
  prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true, season: true, currentWeek: true } })

type Team = { rosterId: string; ownerUserId: string; teamId: string; teamName: string; playerData: unknown; taxi: string[] }

async function loadTeams(leagueId: string, db: Db = prisma): Promise<{ teams: Team[]; names: Map<string, { name: string; position: string | null; team: string | null }> }> {
  const [rosters, teamByRoster] = await Promise.all([
    db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } }),
    seasonTeamsByRoster(db, leagueId),
  ])
  const seasonTeams = await db.redraftRoster.findMany({ where: { id: { in: [...teamByRoster.values()] } }, select: { id: true, teamName: true, ownerName: true } })
  const byId = new Map(seasonTeams.map((t) => [t.id, t]))
  const teams: Team[] = []
  for (const r of rosters) {
    const t = byId.get(teamByRoster.get(r.id) ?? '')
    if (!t) continue
    teams.push({ rosterId: r.id, ownerUserId: r.platformUserId, teamId: t.id, teamName: t.teamName?.trim() || t.ownerName || 'A team', playerData: r.playerData, taxi: taxiPlayerIds(r.playerData) })
  }
  const taxiIds = teams.flatMap((t) => t.taxi)
  const rows = taxiIds.length
    ? await db.redraftRosterPlayer.findMany({
        where: { rosterId: { in: teams.map((t) => t.teamId) }, playerId: { in: taxiIds }, droppedAt: null },
        select: { playerId: true, playerName: true, position: true, team: true },
      })
    : []
  return { teams, names: new Map(rows.map((p) => [p.playerId, { name: p.playerName, position: p.position || null, team: p.team || null }])) }
}

async function writeClaims(db: Db, leagueId: string, claims: TaxiStealClaim[]): Promise<void> {
  // `jsonb_set` on the one key: a column holding SQL or JSON null, or a scalar, is written as {} first.
  await db.$executeRaw`UPDATE leagues SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END, ARRAY[${TAXI_STEAL_CLAIMS_KEY}]::text[], ${JSON.stringify(trimClaims(claims))}::jsonb) WHERE id = ${leagueId}`
}

/** Inside a transaction: the league's claims, with the row held until the transaction ends. */
async function lockClaims(tx: Db, leagueId: string): Promise<TaxiStealClaim[] | null> {
  const rows = await tx.$queryRaw<Array<{ settings: unknown }>>`SELECT settings FROM leagues WHERE id = ${leagueId} FOR UPDATE`
  return rows.length ? readTaxiStealClaims(rows[0]!.settings) : null
}

async function preferredLanguage(userId: string): Promise<'en' | 'es'> {
  const p = await prisma.userProfile.findUnique({ where: { userId }, select: { preferredLanguage: true } }).catch(() => null)
  return p?.preferredLanguage?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

async function notify(league: LeagueRow, userId: string, notice: { title: { en: string; es: string }; body: { en: string; es: string } }, dedupePrefix: string, severity: 'low' | 'medium' | 'high'): Promise<void> {
  if (isOrphanPlatformUserId(userId)) return
  const lang = await preferredLanguage(userId)
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  await dispatchNotification({
    userIds: [userId],
    category: 'league_announcements',
    type: 'taxi_steal',
    title: notice.title[lang],
    body: notice.body[lang],
    actionHref: `/core/waivers?league=${encodeURIComponent(league.id)}#taxi-steals`,
    actionLabel: lang === 'es' ? 'Ver reclamos de taxi' : 'Open taxi claims',
    leagueId: league.id,
    severity,
    dedupePrefix,
  })
}

// ── View ───────────────────────────────────────────────────────────────────────────────────────────

export type TaxiStealView =
  | { supported: false }
  | {
      supported: true
      rule: TaxiStealingRule
      /** The rule is on and the league owner holds AF Commissioner, so claims are taken. */
      active: boolean
      isCommissioner: boolean
      /** The viewer may change the rule: a commissioner with AF Commissioner (switching it off is free). */
      canEdit: boolean
      /** The viewer's team, when the viewer has one. */
      myTeam: null | { rosterId: string; teamName: string; claimsLeft: number | null }
      /** Every other team's taxi players, and whether one already has an open claim. */
      available: { playerId: string; name: string; position: string | null; team: string | null; fromRosterId: string; ownerTeam: string; claimed: boolean }[]
      /** Open claims on the viewer's players: theirs to protect. */
      againstMe: { claimId: string; player: string; claimer: string; deadline: string }[]
      /** The viewer's own open claims. */
      mine: { claimId: string; player: string; owner: string; deadline: string }[]
      /** Every open claim in the league, for the commissioner. */
      open: { player: string; owner: string; claimer: string; deadline: string }[]
      recent: { player: string; owner: string; claimer: string; status: TaxiStealClaim['status']; resolvedAt: string | null }[]
      /**
       * How many taxi players each team holds right now, for the commissioner only (empty otherwise) — the
       * Roster settings page warns when a lower slot count would leave a team over. Read from the same
       * rosters this view already loads; no extra query.
       */
      taxiHeld: { teamName: string; count: number }[]
    }

export async function readTaxiStealView(leagueId: string, userId: string): Promise<{ ok: true; view: TaxiStealView } | { ok: false; status: 403 | 404 }> {
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404 }
  if (!applies(league)) return { ok: true, view: { supported: false } }
  const [commissioner, { teams, names }, season] = await Promise.all([isElevatedCommissioner(leagueId, userId), loadTeams(leagueId), currentSeason(leagueId)])
  const mineTeam = teams.find((t) => t.ownerUserId === userId && !isOrphanPlatformUserId(t.ownerUserId)) ?? null
  if (!commissioner && !mineTeam) return { ok: false, status: 403 }

  const rule = readTaxiStealingRule(league.settings)
  const [ownerPlan, viewerPlan] = await Promise.all([
    ownerHasAfCommissionerPlan(league.userId),
    commissioner ? prisma.appUser.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true } }).then(hasAfCommissionerPlan) : Promise.resolve(false),
  ])
  const active = rule.enabled && ownerPlan
  const claims = readTaxiStealClaims(league.settings)
  const open = claims.filter((c) => c.status === 'open')
  const team = new Map(teams.map((t) => [t.rosterId, t.teamName]))
  const playerName = (c: TaxiStealClaim) => names.get(c.playerId)?.name ?? c.playerName
  return {
    ok: true,
    view: {
      supported: true,
      rule,
      active,
      isCommissioner: commissioner,
      canEdit: commissioner && viewerPlan,
      myTeam: mineTeam ? { rosterId: mineTeam.rosterId, teamName: mineTeam.teamName, claimsLeft: claimsLeft({ rule, claims, rosterId: mineTeam.rosterId, season: season?.season ?? 0 }) } : null,
      available: teams
        .filter((t) => t.rosterId !== mineTeam?.rosterId)
        .flatMap((t) =>
          t.taxi.map((playerId) => ({
            playerId,
            name: names.get(playerId)?.name ?? playerId,
            position: names.get(playerId)?.position ?? null,
            team: names.get(playerId)?.team ?? null,
            fromRosterId: t.rosterId,
            ownerTeam: t.teamName,
            claimed: open.some((c) => c.playerId === playerId),
          })),
        ),
      againstMe: open.filter((c) => c.fromRosterId === mineTeam?.rosterId).map((c) => ({ claimId: c.id, player: playerName(c), claimer: team.get(c.toRosterId) ?? 'A team', deadline: c.deadline })),
      mine: open.filter((c) => c.toRosterId === mineTeam?.rosterId).map((c) => ({ claimId: c.id, player: playerName(c), owner: team.get(c.fromRosterId) ?? 'A team', deadline: c.deadline })),
      open: commissioner ? open.map((c) => ({ player: playerName(c), owner: team.get(c.fromRosterId) ?? 'A team', claimer: team.get(c.toRosterId) ?? 'A team', deadline: c.deadline })) : [],
      recent: claims
        .filter((c) => c.status === 'protected' || c.status === 'stolen')
        .slice(-10)
        .reverse()
        .map((c) => ({ player: playerName(c), owner: team.get(c.fromRosterId) ?? 'A team', claimer: team.get(c.toRosterId) ?? 'A team', status: c.status, resolvedAt: c.resolvedAt ?? null })),
      taxiHeld: commissioner ? teams.map((t) => ({ teamName: t.teamName, count: t.taxi.length })) : [],
    },
  }
}

// ── Actions ────────────────────────────────────────────────────────────────────────────────────────

export type StealResult = { ok: true; claim: TaxiStealClaim } | { ok: false; status: 400 | 403 | 404 | 409; error: string; code?: ClaimIssue | 'LINEUP_REFUSED' }

const CLAIM_ERRORS: Record<ClaimIssue, string> = {
  RULE_OFF: 'Taxi stealing is not on in this league.',
  OWN_PLAYER: 'That player is already on your team.',
  NOT_ON_TAXI: 'That player is not on a taxi squad any more.',
  ALREADY_CLAIMED: 'Another team has already claimed that player.',
  NO_CLAIMS_LEFT: 'Your team has used its taxi claims for this season.',
}

export async function claimTaxiPlayer(leagueId: string, userId: string, input: { playerId?: unknown }, now = new Date()): Promise<StealResult> {
  const playerId = typeof input.playerId === 'string' ? input.playerId.trim() : ''
  if (!playerId) return { ok: false, status: 400, error: 'Choose a player.' }
  const league = await loadLeague(leagueId)
  if (!league) return { ok: false, status: 404, error: 'League not found.' }
  if (!applies(league)) return { ok: false, status: 400, error: 'Taxi stealing is for dynasty leagues AllFantasy runs.' }
  const rule = readTaxiStealingRule(league.settings)
  if (!rule.enabled) return { ok: false, status: 409, error: CLAIM_ERRORS.RULE_OFF, code: 'RULE_OFF' }
  if (!(await ownerHasAfCommissionerPlan(league.userId))) return { ok: false, status: 403, error: 'Taxi stealing is part of the league owner’s AF Commissioner plan, which has lapsed.' }
  const season = await currentSeason(leagueId)
  if (!season) return { ok: false, status: 409, error: 'This league has no season yet.' }

  const { teams, names } = await loadTeams(leagueId)
  const claimer = teams.find((t) => t.ownerUserId === userId && !isOrphanPlatformUserId(t.ownerUserId))
  if (!claimer) return { ok: false, status: 403, error: 'Only a team in this league can claim a taxi player.' }
  const owner = teams.find((t) => t.taxi.includes(playerId))

  const result = await prisma.$transaction(async (tx): Promise<StealResult> => {
    const claims = await lockClaims(tx, leagueId)
    if (!claims) return { ok: false, status: 404, error: 'League not found.' }
    const checked = checkClaim({ rule, claims, playerId, fromRosterId: owner?.rosterId ?? '', toRosterId: claimer.rosterId, onTaxi: Boolean(owner), season: season.season })
    if (!checked.ok) return { ok: false, status: checked.issue === 'OWN_PLAYER' ? 400 : 409, error: CLAIM_ERRORS[checked.issue], code: checked.issue }
    const claim: TaxiStealClaim = {
      id: randomUUID(),
      playerId,
      playerName: names.get(playerId)?.name ?? playerId,
      fromRosterId: owner!.rosterId,
      toRosterId: claimer.rosterId,
      claimedBy: userId,
      season: season.season,
      createdAt: now.toISOString(),
      deadline: new Date(now.getTime() + rule.protectHours * 3_600_000).toISOString(),
      status: 'open',
      resolvedAt: null,
    }
    await writeClaims(tx, leagueId, [...claims, claim])
    return { ok: true, claim }
  })
  if (result.ok && owner) {
    await notify(league, owner.ownerUserId, claimedNotice({ player: result.claim.playerName, claimer: claimer.teamName, deadline: result.claim.deadline, leagueName: league.name ?? 'your league' }), `taxi-steal:claimed:${result.claim.id}`, 'high').catch(() => undefined)
  }
  return result
}

async function findOpenClaim(leagueId: string, claimId: unknown): Promise<{ league: LeagueRow; claim: TaxiStealClaim } | null> {
  const league = await loadLeague(leagueId)
  if (!league || typeof claimId !== 'string') return null
  const claim = readTaxiStealClaims(league.settings).find((c) => c.id === claimId && c.status === 'open')
  return claim ? { league, claim } : null
}

/** Set a claim's outcome, only if it is still open. Returns the claim as it was closed, or null. */
async function closeClaim(tx: Db, leagueId: string, claimId: string, patch: Partial<TaxiStealClaim>): Promise<TaxiStealClaim | null> {
  const claims = await lockClaims(tx, leagueId)
  const i = claims?.findIndex((c) => c.id === claimId && c.status === 'open') ?? -1
  if (!claims || i < 0) return null
  const done = { ...claims[i]!, ...patch }
  claims[i] = done
  await writeClaims(tx, leagueId, claims)
  return done
}

/** The owner keeps the player by promoting them to the active roster. */
export async function protectTaxiPlayer(leagueId: string, userId: string, input: { claimId?: unknown }, now = new Date()): Promise<StealResult> {
  const found = await findOpenClaim(leagueId, input.claimId)
  if (!found) return { ok: false, status: 409, error: 'That claim is no longer open.' }
  const { league, claim } = found
  const roster = await prisma.roster.findUnique({ where: { id: claim.fromRosterId }, select: { platformUserId: true, playerData: true } })
  if (!roster || roster.platformUserId !== userId) return { ok: false, status: 403, error: 'Only the player’s owner can protect them.' }
  if (!taxiPlayerIds(roster.playerData).includes(claim.playerId)) {
    // Already off the taxi squad: the claim cannot succeed, so it ends as protected.
    const closed = await prisma.$transaction((tx) => closeClaim(tx, leagueId, claim.id, { status: 'protected', resolvedAt: now.toISOString() }))
    return closed ? { ok: true, claim: closed } : { ok: false, status: 409, error: 'That claim is no longer open.' }
  }
  const season = await currentSeason(leagueId)
  const pd = roster.playerData && typeof roster.playerData === 'object' ? (roster.playerData as Record<string, unknown>) : {}
  const saved = await persistRosterLineupWithEngine({
    leagueId,
    rosterId: claim.fromRosterId,
    actorUserId: userId,
    expectedOwnerUserId: userId,
    season: season?.season ?? new Date().getFullYear(),
    week: Math.max(1, season?.currentWeek ?? 1),
    source: 'user_save',
    nextPlayerData: promoteFromTaxi(roster.playerData, claim.playerId),
    taxiProtection: [claim.playerId],
    ...(Array.isArray(pd.starters) ? { expectedStarters: pd.starters.map(String) } : {}),
  })
  if (!saved.ok) return { ok: false, status: 409, error: saved.error, code: 'LINEUP_REFUSED' }
  const closed = await prisma.$transaction((tx) => closeClaim(tx, leagueId, claim.id, { status: 'protected', resolvedAt: now.toISOString() }))
  if (!closed) return { ok: false, status: 409, error: 'That claim closed while you were saving.' }
  await notifyOutcome(league, closed, 'protected')
  return { ok: true, claim: closed }
}

/** The owner hands the player over now rather than waiting for the window. */
export async function releaseTaxiPlayer(leagueId: string, userId: string, input: { claimId?: unknown }, now = new Date()): Promise<StealResult> {
  const found = await findOpenClaim(leagueId, input.claimId)
  if (!found) return { ok: false, status: 409, error: 'That claim is no longer open.' }
  const roster = await prisma.roster.findUnique({ where: { id: found.claim.fromRosterId }, select: { platformUserId: true } })
  if (!roster || roster.platformUserId !== userId) return { ok: false, status: 403, error: 'Only the player’s owner can let them go.' }
  return executeSteal(found.league, found.claim, now)
}

/** The claimer takes the claim back; a withdrawn claim does not count toward the season's claims. */
export async function withdrawTaxiClaim(leagueId: string, userId: string, input: { claimId?: unknown }, now = new Date()): Promise<StealResult> {
  const found = await findOpenClaim(leagueId, input.claimId)
  if (!found) return { ok: false, status: 409, error: 'That claim is no longer open.' }
  if (found.claim.claimedBy !== userId) return { ok: false, status: 403, error: 'Only the team that made the claim can withdraw it.' }
  const closed = await prisma.$transaction((tx) => closeClaim(tx, leagueId, found.claim.id, { status: 'withdrawn', resolvedAt: now.toISOString() }))
  return closed ? { ok: true, claim: closed } : { ok: false, status: 409, error: 'That claim is no longer open.' }
}

/**
 * Move the player to the claiming team, in one transaction with the claim's close. A player no longer
 * on the owner's taxi squad ends the claim as void, with nothing moved.
 */
async function executeSteal(league: LeagueRow, claim: TaxiStealClaim, now: Date): Promise<StealResult> {
  const result = await prisma.$transaction(
    async (tx): Promise<StealResult> => {
      const claims = await lockClaims(tx, league.id)
      if (!claims?.some((c) => c.id === claim.id && c.status === 'open')) return { ok: false, status: 409, error: 'That claim is no longer open.' }
      const [from, to, teamByRoster] = await Promise.all([
        tx.roster.findUnique({ where: { id: claim.fromRosterId }, select: { playerData: true } }),
        tx.roster.findUnique({ where: { id: claim.toRosterId }, select: { playerData: true } }),
        seasonTeamsByRoster(tx, league.id),
      ])
      const fromTeam = teamByRoster.get(claim.fromRosterId)
      const toTeam = teamByRoster.get(claim.toRosterId)
      const voided = async (note: string) => {
        const closed = await closeClaim(tx, league.id, claim.id, { status: 'void', resolvedAt: now.toISOString(), note })
        return closed ? ({ ok: true, claim: closed } as const) : ({ ok: false, status: 409, error: 'That claim is no longer open.' } as const)
      }
      if (!from || !to || !fromTeam || !toTeam) return voided('A team is no longer in this season.')
      if (!taxiPlayerIds(from.playerData).includes(claim.playerId)) return voided('The player left the taxi squad before the window closed.')
      const row = await tx.redraftRosterPlayer.findFirst({
        where: { rosterId: fromTeam, playerId: claim.playerId, droppedAt: null },
        select: { playerName: true, position: true, team: true },
      })
      if (!row) return voided('The player is no longer on that team.')
      await tx.redraftRosterPlayer.updateMany({
        where: { rosterId: fromTeam, playerId: claim.playerId, droppedAt: null },
        data: { rosterId: toTeam, slotType: 'BENCH', acquisitionType: 'taxi_steal', isLocked: false, addedAt: now },
      })
      await tx.roster.update({ where: { id: claim.fromRosterId }, data: { playerData: removeFromLineup(from.playerData, [claim.playerId]) as Prisma.InputJsonValue } })
      await tx.roster.update({
        where: { id: claim.toRosterId },
        data: { playerData: addToBench(to.playerData, [{ id: claim.playerId, name: row.playerName, position: row.position || undefined, team: row.team || undefined }]) as Prisma.InputJsonValue },
      })
      const closed = await closeClaim(tx, league.id, claim.id, { status: 'stolen', resolvedAt: now.toISOString() })
      return closed ? { ok: true, claim: closed } : { ok: false, status: 409, error: 'That claim is no longer open.' }
    },
    { timeout: 20_000 },
  )
  if (result.ok && result.claim.status === 'stolen') await notifyOutcome(league, result.claim, 'stolen')
  return result
}

async function notifyOutcome(league: LeagueRow, claim: TaxiStealClaim, outcome: 'protected' | 'stolen'): Promise<void> {
  const rosters = await prisma.roster.findMany({ where: { id: { in: [claim.fromRosterId, claim.toRosterId] } }, select: { id: true, platformUserId: true } })
  const { teams } = await loadTeams(league.id)
  const name = (id: string) => teams.find((t) => t.rosterId === id)?.teamName ?? 'A team'
  const base = { player: claim.playerName, owner: name(claim.fromRosterId), claimer: name(claim.toRosterId), outcome, leagueName: league.name ?? 'your league' }
  for (const r of rosters) {
    const forClaimer = r.id === claim.toRosterId
    await notify(league, r.platformUserId, outcomeNotice({ ...base, forClaimer }), `taxi-steal:${outcome}:${claim.id}`, forClaimer && outcome === 'stolen' ? 'medium' : 'low').catch(() => undefined)
  }
}

// ── The hourly run ─────────────────────────────────────────────────────────────────────────────────

export type TaxiStealRunResult = { leagues: number; stolen: number; voided: number; failures: { leagueId: string; claimId?: string; error: string }[] }

/** Hourly: every open claim whose window has closed is resolved — the player moves or the claim ends. */
export async function runTaxiStealResolution(opts?: { now?: Date; limit?: number; deadline?: number }): Promise<TaxiStealRunResult> {
  const now = opts?.now ?? new Date()
  const deadline = opts?.deadline ?? Date.now() + 25_000
  const result: TaxiStealRunResult = { leagues: 0, stolen: 0, voided: 0, failures: [] }
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues
    WHERE settings -> ${TAXI_STEAL_CLAIMS_KEY} @> '[{"status":"open"}]'::jsonb
    ORDER BY id LIMIT ${Math.max(1, Math.min(opts?.limit ?? 25, 100))}`
  for (const { id } of ids) {
    if (Date.now() >= deadline) break
    try {
      const league = await loadLeague(id)
      if (!league) continue
      const due = readTaxiStealClaims(league.settings).filter((c) => isDue(c, now))
      if (!due.length) continue
      result.leagues += 1
      for (const claim of due) {
        if (Date.now() >= deadline) break
        try {
          const r = await executeSteal(league, claim, now)
          if (r.ok && r.claim.status === 'stolen') result.stolen += 1
          else if (r.ok) result.voided += 1
        } catch (e) {
          result.failures.push({ leagueId: id, claimId: claim.id, error: e instanceof Error ? e.message : String(e) })
        }
      }
    } catch (e) {
      result.failures.push({ leagueId: id, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return result
}

// ── Commish OS and Chimmy ──────────────────────────────────────────────────────────────────────────

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' })

/** Commish OS: one task while claims are open. Nothing for the commissioner to do but know. */
export async function readTaxiStealTasks(leagueId: string, now = new Date()): Promise<WorkspaceTaskCandidate[]> {
  const league = await loadLeague(leagueId)
  if (!league || !applies(league)) return []
  const open = readTaxiStealClaims(league.settings).filter((c) => c.status === 'open')
  if (!open.length) return []
  const { teams } = await loadTeams(leagueId)
  const name = (id: string) => teams.find((t) => t.rosterId === id)?.teamName ?? 'A team'
  const overdue = open.filter((c) => isDue(c, now))
  const lines = open.map((c) => `${name(c.toRosterId)} claimed ${c.playerName} from ${name(c.fromRosterId)} (until ${when(c.deadline)})`)
  return [
    {
      sourceKey: `taxi-steal-open:${open.map((c) => c.id).sort().join(',')}:v1`,
      title: open.length === 1 ? 'A taxi steal claim is open' : `${open.length} taxi steal claims are open`,
      description:
        `${lines.join('; ')}. Each owner can protect the player by promoting them to the active roster; ` +
        `otherwise AllFantasy moves the player within the hour after the window closes.${overdue.length ? ` ${overdue.length} past the window, moving within the hour.` : ''}`,
      priority: overdue.length ? 'elevated' : 'standard',
      automationCandidate: false,
      relatedLinks: [{ label: 'Commissioner Hub', moduleId: 'managers' as const, href: `/core/waivers?league=${encodeURIComponent(leagueId)}#taxi-steals` }],
    },
  ]
}

/** For Chimmy: the rule and every open claim (claims are public to the league). */
export async function readTaxiStealingForChimmy(leagueId: string): Promise<string | null> {
  const league = await loadLeague(leagueId)
  if (!league || !applies(league)) return null
  const rule = readTaxiStealingRule(league.settings)
  const text = describeTaxiStealing(rule)
  if (!text || !(await ownerHasAfCommissionerPlan(league.userId))) return null
  const open = readTaxiStealClaims(league.settings).filter((c) => c.status === 'open')
  if (!open.length) return text
  const { teams } = await loadTeams(leagueId)
  const name = (id: string) => teams.find((t) => t.rosterId === id)?.teamName ?? 'A team'
  return `${text} Open claims: ${open.map((c) => `${name(c.toRosterId)} on ${c.playerName} (${name(c.fromRosterId)}, until ${when(c.deadline)})`).join('; ')}.`
}

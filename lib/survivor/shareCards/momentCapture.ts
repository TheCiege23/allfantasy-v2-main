import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { idolDefinition } from '@/lib/survivor/survivorIdolCatalog'
import { SURVIVOR_TRIBE_CATALOG, tribeCrestUrl } from '@/lib/survivor/survivorTribeIdentity'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { safeIdolId } from './cardContent'
import { countImmunityMoments, createShareMomentOnce } from './momentStore'
import type { ShareMomentPayload } from './types'

/**
 * Turns engine events into share moments. Each capture reads only state the league has already
 * been shown (a revealed council, finalized scores, a public Exile return, a crowned winner) and
 * stores the published facts. Captures are idempotent (dedupe key per event), so the engine hooks
 * and the lazy `syncLeagueShareMoments` backstop can both run without double-creating.
 */

const JURY_PHASES = new Set(['merge', 'post_merge', 'jury', 'finale'])
const PROTECTIVE_POWERS = new Set(['vote_shield', 'protect_self', 'immunity'])

interface LeagueFacts {
  leagueName: string
  sport: string
  season: number
  settings: ReturnType<typeof normalizeSurvivorFoundationSettings>
  phase: string | null
}

async function leagueFacts(leagueId: string): Promise<LeagueFacts | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, sport: true, season: true, settings: true, survivorPhase: true } })
  if (!league) return null
  const raw = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? (league.settings as Record<string, unknown>) : {}
  const config = await prisma.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { seasonThemeLabel: true } }).catch(() => null)
  return {
    leagueName: (league.name ?? '').trim() || (config?.seasonThemeLabel ?? '').trim() || 'Survivor League',
    sport: String(league.sport ?? 'NFL'),
    season: league.season ?? new Date().getUTCFullYear(),
    settings: normalizeSurvivorFoundationSettings(raw),
    phase: league.survivorPhase ?? null,
  }
}

/** A tribe's crest: its stored crest path when it is one of ours, else the catalog crest matching its name. */
export function resolveTribeCrestPath(tribe: { name: string; logoUrl: string | null } | null, sport: string): string | null {
  if (!tribe) return null
  if (tribe.logoUrl && /^\/survivor\/tribes\/crests\/[a-z]+\/[a-z0-9-]+\.svg$/.test(tribe.logoUrl)) return tribe.logoUrl
  const plain = stripLeadingTribeIcon(tribe.name).replace(/^tribe\s+/i, '').trim().toLowerCase()
  const match = SURVIVOR_TRIBE_CATALOG.find(entry => entry.name.toLowerCase() === plain || entry.id === plain)
  return match ? tribeCrestUrl(match.id, sport) : null
}

async function tribeFacts(tribeId: string | null | undefined, sport: string): Promise<{ tribeName: string | null; crestPath: string | null }> {
  if (!tribeId) return { tribeName: null, crestPath: null }
  const tribe = await prisma.survivorTribe.findUnique({ where: { id: tribeId }, select: { name: true, logoUrl: true, isMerged: true } })
  if (!tribe || tribe.isMerged) return { tribeName: null, crestPath: null }
  return { tribeName: stripLeadingTribeIcon(tribe.name) || null, crestPath: resolveTribeCrestPath(tribe, sport) }
}

async function seasonPoints(leagueId: string, userId: string, uptoWeek?: number): Promise<number | null> {
  const rows = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, userId, isFinalized: true, ...(uptoWeek != null ? { week: { lte: uptoWeek } } : {}) },
    select: { finalScore: true },
  })
  if (rows.length === 0) return null
  return Math.round(rows.reduce((sum, row) => sum + row.finalScore, 0) * 10) / 10
}

async function weeksScored(leagueId: string, userId: string, uptoWeek: number): Promise<number> {
  return prisma.survivorWeeklyScore.count({ where: { leagueId, userId, isFinalized: true, week: { lte: uptoWeek } } })
}

function basePayload(facts: LeagueFacts, displayName: string, tribe: { tribeName: string | null; crestPath: string | null }): ShareMomentPayload {
  return { v: 1, displayName, leagueName: facts.leagueName, sport: facts.sport, season: facts.season, tribeName: tribe.tribeName, crestPath: tribe.crestPath }
}

/** "2–1", "3–1–1": the counts read aloud at the ceremony, highest first. No names. */
export function publicTally(counts: number[]): string | null {
  const sorted = counts.filter(n => Number.isFinite(n) && n > 0).sort((a, b) => b - a)
  if (sorted.length === 0) return null
  if (sorted.length === 1) sorted.push(0)
  return sorted.join('–')
}

type Scroll = { targetUserId?: string | null; targetName?: string | null; status?: string }
type IdolPlay = { idolId?: string; powerType?: string; playerUserId?: string; userId?: string }

function scrollsOf(raw: unknown): Scroll[] {
  return Array.isArray(raw) ? (raw.filter(item => item && typeof item === 'object') as Scroll[]) : []
}

function playsOf(raw: unknown): IdolPlay[] {
  return Array.isArray(raw) ? (raw.filter(item => item && typeof item === 'object' && typeof (item as IdolPlay).idolId === 'string') as IdolPlay[]) : []
}

/** Count the scrolls that counted, per target, exactly as the ceremony read them. */
export function countedTallyFromScrolls(scrolls: Scroll[]): string | null {
  const byTarget = new Map<string, number>()
  for (const scroll of scrolls) {
    if (scroll.status !== 'counts') continue
    const key = scroll.targetUserId ?? scroll.targetName ?? ''
    if (!key) continue
    byTarget.set(key, (byTarget.get(key) ?? 0) + 1)
  }
  return publicTally([...byTarget.values()])
}

async function resolveSubject(leagueId: string, userId: string | null, rosterId: string | null) {
  if (userId) {
    const player = await prisma.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { userId: true, displayName: true, tribeId: true, redraftRosterId: true, exileWeeksServed: true } })
    if (player) return player
    return { userId, displayName: '', tribeId: null, redraftRosterId: rosterId, exileWeeksServed: 0 }
  }
  if (!rosterId) return null
  return prisma.survivorPlayer.findFirst({ where: { leagueId, redraftRosterId: rosterId }, select: { userId: true, displayName: true, tribeId: true, redraftRosterId: true, exileWeeksServed: true } })
}

/** Out + idol moments for a revealed council. Called after `revealCouncil` commits. */
export async function captureCouncilShareMoments(leagueId: string, councilId: string): Promise<number> {
  const council = await prisma.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
  if (!council || !council.isRevealed) return 0
  const facts = await leagueFacts(leagueId)
  if (!facts) return 0
  const scrolls = scrollsOf(council.revealSequence)
  let created = 0

  if (!council.isTie && (council.eliminatedUserId || council.eliminatedRosterId)) {
    const subject = await resolveSubject(leagueId, council.eliminatedUserId, council.eliminatedRosterId)
    if (subject) {
      const tribe = await tribeFacts(subject.tribeId ?? council.attendingTribeId, facts.sport)
      const weeks = await weeksScored(leagueId, subject.userId, council.week)
      const next = facts.settings.eliminationOutcome === 'exile_island'
        ? 'exile'
        : facts.settings.juryEnabled && JURY_PHASES.has(facts.phase ?? council.phase) ? 'jury' : null
      const result = await createShareMomentOnce({
        leagueId, type: 'out', week: council.week, subjectUserId: subject.userId,
        subjectRosterId: council.eliminatedRosterId ?? subject.redraftRosterId ?? null,
        dedupeKey: `out:${council.id}`,
        payload: {
          ...basePayload(facts, subject.displayName || council.eliminatedName || 'A manager', tribe),
          tally: countedTallyFromScrolls(scrolls),
          weeks: weeks || council.week,
          points: await seasonPoints(leagueId, subject.userId, council.week),
          next,
        },
      })
      if (result.created) created++
    }
  }

  for (const play of playsOf(council.idolsPlayed)) {
    const ownerUserId = play.playerUserId ?? play.userId
    if (!ownerUserId || !play.idolId) continue
    let powerType = play.powerType
    if (!powerType) {
      const idol = await prisma.survivorIdol.findUnique({ where: { id: play.idolId }, select: { powerType: true } })
      powerType = idol?.powerType
    }
    if (!powerType) continue
    const definition = idolDefinition(powerType)
    const subject = await resolveSubject(leagueId, ownerUserId, null)
    if (!subject) continue
    const tribe = await tribeFacts(subject.tribeId ?? council.attendingTribeId, facts.sport)
    const against = scrolls.filter(scroll => scroll.targetUserId === ownerUserId)
    const result = await createShareMomentOnce({
      leagueId, type: 'idol', week: council.week, subjectUserId: subject.userId, subjectRosterId: subject.redraftRosterId ?? null,
      dedupeKey: `idol:${council.id}:${play.idolId}`,
      payload: {
        ...basePayload(facts, subject.displayName || 'A manager', tribe),
        idolId: safeIdolId(definition.id || null),
        idolName: definition.name,
        idolProtective: PROTECTIVE_POWERS.has(powerType) || definition.id === 'immunity',
        votesCancelled: against.filter(scroll => scroll.status !== 'counts').length,
        votesCounted: against.filter(scroll => scroll.status === 'counts').length,
      },
    })
    if (result.created) created++
  }
  return created
}

/**
 * The immunity winner for a finalized week. Post-merge that is the island's top scorer; pre-merge
 * the whole winning tribe is safe, and the card goes to that tribe's top scorer.
 */
export async function captureImmunityShareMoment(leagueId: string, week: number): Promise<number> {
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { immunePlayerId: true, immuneTribeId: true, weekScoringFinalAt: true } })
  if (!game?.weekScoringFinalAt) return 0
  const scores = await prisma.survivorWeeklyScore.findMany({ where: { leagueId, week, isFinalized: true }, select: { userId: true, finalScore: true, tribeId: true } })
  if (scores.length === 0) return 0
  let winner: { userId: string; finalScore: number; tribeId: string | null } | undefined
  let scope: 'tribe' | 'island' = 'island'
  if (game.immunePlayerId) {
    winner = scores.find(score => score.userId === game.immunePlayerId)
  } else if (game.immuneTribeId) {
    scope = 'tribe'
    winner = scores.filter(score => score.tribeId === game.immuneTribeId).sort((a, b) => b.finalScore - a.finalScore || a.userId.localeCompare(b.userId))[0]
  }
  if (!winner) return 0
  const facts = await leagueFacts(leagueId)
  if (!facts) return 0
  const subject = await resolveSubject(leagueId, winner.userId, null)
  if (!subject) return 0
  const tribe = await tribeFacts(scope === 'tribe' ? game.immuneTribeId : subject.tribeId, facts.sport)
  const prior = await countImmunityMoments(leagueId, subject.userId)
  const result = await createShareMomentOnce({
    leagueId, type: 'immunity', week, subjectUserId: subject.userId, subjectRosterId: subject.redraftRosterId ?? null,
    dedupeKey: `immunity:${week}`,
    payload: {
      ...basePayload(facts, subject.displayName || 'A manager', tribe),
      points: Math.round(winner.finalScore * 10) / 10,
      rank: 1,
      rankScope: scope,
      immunityWins: prior + 1,
    },
  })
  return result.created ? 1 : 0
}

/** Public Exile returns, from the audit entries the return engines write. */
export async function captureExileReturnShareMoments(leagueId: string): Promise<number> {
  const entries = await prisma.survivorAuditEntry.findMany({
    where: { leagueId, action: 'return_to_island', isVisibleToPublic: true, targetUserId: { not: null } },
    select: { id: true, week: true, targetUserId: true, data: true },
    orderBy: { createdAt: 'asc' },
    take: 20,
  })
  if (entries.length === 0) return 0
  const facts = await leagueFacts(leagueId)
  if (!facts) return 0
  let created = 0
  for (const entry of entries) {
    const subject = await resolveSubject(leagueId, entry.targetUserId, null)
    if (!subject) continue
    const data = entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data) ? (entry.data as Record<string, unknown>) : {}
    const tokens = typeof data.tokensSpent === 'number' ? data.tokensSpent : null
    const week = entry.week ?? facts.settings.exileReturnWeek
    const tribe = await tribeFacts(subject.tribeId, facts.sport)
    const result = await createShareMomentOnce({
      leagueId, type: 'exile', week, subjectUserId: subject.userId, subjectRosterId: subject.redraftRosterId ?? null,
      dedupeKey: `exile:${entry.id}`,
      payload: {
        ...basePayload(facts, subject.displayName || 'A manager', tribe),
        tokens,
        exileWeeks: subject.exileWeeksServed > 0 ? subject.exileWeeksServed : null,
        rejoinWeek: week + 1,
      },
    })
    if (result.created) created++
  }
  return created
}

/** The champion card, once the jury session records a revealed winner. */
export async function captureChampionShareMoment(leagueId: string): Promise<number> {
  const session = await prisma.jurySession.findUnique({ where: { leagueId }, select: { winnerId: true, winnerName: true, revealedAt: true } })
  if (!session?.winnerId || !session.revealedAt) return 0
  const facts = await leagueFacts(leagueId)
  if (!facts) return 0
  const subject = await resolveSubject(leagueId, session.winnerId, null)
  if (!subject) return 0
  const [winnerEvent, game, weeks] = await Promise.all([
    prisma.survivorAuditLog.findFirst({ where: { leagueId, eventType: 'winner_crowned' }, orderBy: { createdAt: 'desc' }, select: { metadata: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }),
    prisma.survivorWeeklyScore.findMany({ where: { leagueId, isFinalized: true }, select: { week: true }, distinct: ['week'] }),
  ])
  const meta = winnerEvent?.metadata && typeof winnerEvent.metadata === 'object' && !Array.isArray(winnerEvent.metadata) ? (winnerEvent.metadata as Record<string, unknown>) : {}
  const voteCount = meta.voteCount && typeof meta.voteCount === 'object' && !Array.isArray(meta.voteCount) ? Object.values(meta.voteCount as Record<string, unknown>).filter((n): n is number => typeof n === 'number') : []
  const week = game?.currentWeek && game.currentWeek > 0 ? game.currentWeek : Math.max(0, ...weeks.map(row => row.week))
  const result = await createShareMomentOnce({
    leagueId, type: 'champ', week, subjectUserId: subject.userId, subjectRosterId: subject.redraftRosterId ?? null,
    dedupeKey: 'champ',
    payload: {
      ...basePayload(facts, subject.displayName || session.winnerName || 'The champion', { tribeName: null, crestPath: null }),
      tally: publicTally(voteCount),
      weeks: weeks.length || null,
      immunityWins: await countImmunityMoments(leagueId, subject.userId),
      points: await seasonPoints(leagueId, subject.userId),
    },
  })
  return result.created ? 1 : 0
}

/**
 * Backstop for every hook: derive any missing moments from durable engine state. Runs when the
 * share UI opens, so a moment whose hook was skipped (a legacy reveal path, a crash between commit
 * and capture) still appears. Immunity is only derivable for the current finalized week, because
 * the game state keeps the immune player/tribe for that week alone.
 */
export async function syncLeagueShareMoments(leagueId: string): Promise<void> {
  const [councils, existing] = await Promise.all([
    prisma.survivorTribalCouncil.findMany({
      where: { leagueId, isRevealed: true },
      select: { id: true, isTie: true, eliminatedUserId: true, eliminatedRosterId: true, idolsPlayed: true },
      orderBy: { week: 'asc' },
      take: 40,
    }),
    prisma.survivorShareMoment.findMany({ where: { leagueId }, select: { dedupeKey: true } }).catch(() => null),
  ])
  if (existing == null) return // table not migrated yet
  const have = new Set(existing.map(row => row.dedupeKey))
  for (const council of councils) {
    const wants = [
      ...(!council.isTie && (council.eliminatedUserId || council.eliminatedRosterId) ? [`out:${council.id}`] : []),
      ...playsOf(council.idolsPlayed).map(play => `idol:${council.id}:${play.idolId}`),
    ]
    if (wants.some(key => !have.has(key))) await captureCouncilShareMoments(leagueId, council.id)
  }
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true, weekScoringFinalAt: true } })
  if (game?.weekScoringFinalAt && game.currentWeek > 0 && !have.has(`immunity:${game.currentWeek}`)) await captureImmunityShareMoment(leagueId, game.currentWeek)
  await captureExileReturnShareMoments(leagueId)
  if (!have.has('champ')) await captureChampionShareMoment(leagueId)
}

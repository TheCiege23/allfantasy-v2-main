import type { PrismaClient } from '@prisma/client'

/**
 * PREDICTION POLLS — a league chat poll tied to one native matchup, and the season-long
 * Prediction Leaderboard built from them.
 *
 * A prediction poll is an ordinary league chat poll (`LeagueChatMessage.metadata.poll`, the shape
 * `lib/chat-core/messagePolls.ts` reads and the shared `/vote` route writes) carrying one extra
 * object, `poll.prediction`. Nothing new is stored anywhere else: no table, no migration.
 *
 * ⚠ THE PREDICTION OBJECT IS SERVER-OWNED. A client cannot post one: the composer's metadata goes
 * through `sanitizeDraftChatRichMeta`, which rebuilds a poll from its question and options and drops
 * every other key. A prediction poll is only ever written by `createPredictionPoll` below, from the
 * matchup row itself — so the options really are the two teams, and the resolution really is the
 * final score. A member who could forge `prediction` could award themselves points.
 *
 * ⚠ THE LEADERBOARD IS COMPUTED, NEVER INCREMENTED. Each resolved poll stores which option won;
 * the leaderboard is a count over those polls at read time. That is what makes resolving
 * idempotent: running the resolver twice — or from both the week finalizer and a page load —
 * writes the same outcome and moves nobody's total. A `points += 1` counter would double on the
 * second run, and the finalizer re-runs on a schedule.
 *
 * ⚠ A STAT CORRECTION CAN CHANGE THE WINNER, AND THE RESOLVER FOLLOWS IT. `weekFinalizer.ts`
 * re-opens a week on a correction and re-finalizes it with the corrected score. The resolver
 * re-checks every final matchup it has a poll for and rewrites the outcome only when it differs,
 * so the leaderboard tracks the score the league actually ended on.
 */

export const PREDICTION_POLL_SUBTYPE = 'prediction_poll'

export type PredictionSide = 'home' | 'away'
export type PredictionOutcome = PredictionSide | 'tie'

export type PredictionMeta = {
  kind: 'matchup'
  matchupId: string
  seasonId: string
  season: number
  week: number
  homeRosterId: string
  awayRosterId: string
  /** The poll option id for each side. */
  optionIds: Record<PredictionSide, string>
  resolvedAt?: string
  outcome?: PredictionOutcome
  /** null on a tie: nobody picked "tie", so nobody was right. */
  winningOptionId?: string | null
  finalScore?: { home: number; away: number }
}

export type PredictionMatchupRow = {
  id: string
  leagueId: string
  seasonId: string
  week: number
  status: string
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  isMedianMatchup?: boolean
}

export type PredictionTeam = { rosterId: string; name: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** The option id for a side — derived from the roster, so it is stable and readable in a row. */
export function predictionOptionId(side: PredictionSide, rosterId: string): string {
  return `${side}-${rosterId}`.slice(0, 64)
}

/** Deterministic row id: one prediction poll per matchup, enforced by the primary key. */
export function predictionPollMessageId(matchupId: string): string {
  return `predpoll_${matchupId}`
}

/**
 * Whether a matchup can still be predicted. Only a real head-to-head game (not a bye, not the
 * median game) that has not started scoring.
 */
export function isPredictableMatchup(m: PredictionMatchupRow): boolean {
  return Boolean(m.awayRosterId) && !m.isMedianMatchup && m.status === 'scheduled'
}

/**
 * The poll metadata for a prediction on this matchup. Pure.
 *
 * Single choice and never anonymous: a prediction is a public pick that earns a point, and a
 * multi-choice "prediction" would let somebody back both teams.
 */
export function buildPredictionPollMetadata(args: {
  matchup: PredictionMatchupRow
  season: number
  home: PredictionTeam
  away: PredictionTeam
  /** The matchup's kickoff — the poll closes then. Null when the slate is not known. */
  closeAt: Date | null
  resultsVisibility?: 'live' | 'after_close'
}): { poll: Record<string, unknown> } {
  const { matchup, home, away } = args
  if (!matchup.awayRosterId) throw new Error('a bye has no prediction')
  const homeOpt = predictionOptionId('home', home.rosterId)
  const awayOpt = predictionOptionId('away', away.rosterId)
  const prediction: PredictionMeta = {
    kind: 'matchup',
    matchupId: matchup.id,
    seasonId: matchup.seasonId,
    season: args.season,
    week: matchup.week,
    homeRosterId: home.rosterId,
    awayRosterId: away.rosterId,
    optionIds: { home: homeOpt, away: awayOpt },
  }
  return {
    poll: {
      question: `Week ${matchup.week}: who wins ${home.name} vs ${away.name}?`,
      options: [
        { id: homeOpt, text: home.name, votes: [] },
        { id: awayOpt, text: away.name, votes: [] },
      ],
      ...(args.closeAt ? { closeAt: args.closeAt.toISOString() } : {}),
      allowMultiple: false,
      anonymous: false,
      ...(args.resultsVisibility === 'after_close' ? { resultsVisibility: 'after_close' } : {}),
      prediction,
    },
  }
}

/** Read `metadata.poll.prediction`, or null when this is not a prediction poll. */
export function readPrediction(metadata: unknown): PredictionMeta | null {
  if (!isRecord(metadata) || !isRecord(metadata.poll)) return null
  const p = metadata.poll.prediction
  if (!isRecord(p) || p.kind !== 'matchup') return null
  if (typeof p.matchupId !== 'string' || !p.matchupId) return null
  if (!isRecord(p.optionIds) || typeof p.optionIds.home !== 'string' || typeof p.optionIds.away !== 'string') {
    return null
  }
  const season = Number(p.season)
  const week = Number(p.week)
  if (!Number.isFinite(season) || !Number.isFinite(week)) return null
  return {
    kind: 'matchup',
    matchupId: p.matchupId,
    seasonId: typeof p.seasonId === 'string' ? p.seasonId : '',
    season,
    week,
    homeRosterId: typeof p.homeRosterId === 'string' ? p.homeRosterId : '',
    awayRosterId: typeof p.awayRosterId === 'string' ? p.awayRosterId : '',
    optionIds: { home: p.optionIds.home, away: p.optionIds.away },
    ...(typeof p.resolvedAt === 'string' ? { resolvedAt: p.resolvedAt } : {}),
    ...(p.outcome === 'home' || p.outcome === 'away' || p.outcome === 'tie' ? { outcome: p.outcome } : {}),
    ...(typeof p.winningOptionId === 'string' || p.winningOptionId === null
      ? { winningOptionId: p.winningOptionId as string | null }
      : {}),
    ...(isRecord(p.finalScore) &&
    Number.isFinite(Number(p.finalScore.home)) &&
    Number.isFinite(Number(p.finalScore.away))
      ? { finalScore: { home: Number(p.finalScore.home), away: Number(p.finalScore.away) } }
      : {}),
  }
}

/** Who won a FINAL matchup, or null while it is not final. Pure. */
export function decidePredictionOutcome(m: Pick<PredictionMatchupRow, 'status' | 'homeScore' | 'awayScore'>): PredictionOutcome | null {
  if (m.status !== 'final') return null
  if (!Number.isFinite(m.homeScore) || !Number.isFinite(m.awayScore)) return null
  if (m.homeScore === m.awayScore) return 'tie'
  return m.homeScore > m.awayScore ? 'home' : 'away'
}

/**
 * The metadata with this outcome written onto it — or null when the poll already carries exactly
 * this outcome and score, so the caller writes nothing. Pure; this null is the idempotency.
 */
export function applyPredictionResolution(
  metadata: unknown,
  outcome: PredictionOutcome,
  finalScore: { home: number; away: number },
  now: Date,
): Record<string, unknown> | null {
  const prediction = readPrediction(metadata)
  if (!prediction || !isRecord(metadata) || !isRecord(metadata.poll)) return null
  if (
    prediction.outcome === outcome &&
    prediction.finalScore?.home === finalScore.home &&
    prediction.finalScore?.away === finalScore.away &&
    metadata.poll.closed === true
  ) {
    return null
  }
  const winningOptionId = outcome === 'tie' ? null : prediction.optionIds[outcome]
  const rawPrediction = metadata.poll.prediction as Record<string, unknown>
  return {
    ...metadata,
    poll: {
      ...metadata.poll,
      // A resolved prediction is over; nothing may be cast after the result is known.
      closed: true,
      prediction: {
        ...rawPrediction,
        resolvedAt: prediction.resolvedAt ?? now.toISOString(),
        outcome,
        winningOptionId,
        finalScore,
      },
    },
  }
}

export type LeaderboardEntry = {
  userId: string
  /** Correct picks — one point each. */
  points: number
  /** Resolved predictions this person voted in. */
  made: number
}

/**
 * The season's Prediction Leaderboard from the polls themselves. Pure.
 *
 * Only resolved polls of `season` count. A vote on a tie counts as `made` but scores nothing.
 * Ordered by points, then accuracy, then fewest picks needed (a 3-for-3 beats a 3-for-5), then id
 * so the order is stable between reads.
 */
export function computePredictionLeaderboard(
  polls: ReadonlyArray<{ metadata: unknown }>,
  season: number,
): LeaderboardEntry[] {
  const byUser = new Map<string, LeaderboardEntry>()
  for (const row of polls) {
    const prediction = readPrediction(row.metadata)
    if (!prediction || prediction.season !== season || !prediction.resolvedAt || !prediction.outcome) continue
    const poll = (row.metadata as { poll: Record<string, unknown> }).poll
    if (!Array.isArray(poll.options)) continue
    const seen = new Set<string>()
    for (const option of poll.options) {
      if (!isRecord(option) || !Array.isArray(option.votes)) continue
      const correct = prediction.winningOptionId != null && option.id === prediction.winningOptionId
      for (const voter of option.votes) {
        if (typeof voter !== 'string' || !voter || voter.startsWith('anon:')) continue
        // One person, one pick per poll — a malformed row with the same voter twice counts once.
        if (seen.has(voter)) continue
        seen.add(voter)
        const entry = byUser.get(voter) ?? { userId: voter, points: 0, made: 0 }
        entry.made += 1
        if (correct) entry.points += 1
        byUser.set(voter, entry)
      }
    }
  }
  return [...byUser.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.points / Math.max(1, b.made) - a.points / Math.max(1, a.made) ||
      a.made - b.made ||
      a.userId.localeCompare(b.userId),
  )
}

/** A roster's display name — the team name, else the manager, never blank. */
export function predictionTeamName(r: { teamName?: string | null; ownerName?: string | null } | null | undefined): string {
  return r?.teamName?.trim() || r?.ownerName?.trim() || 'TBD'
}

type Db = Pick<PrismaClient, 'leagueChatMessage' | 'redraftMatchup'>

/**
 * Resolve every prediction poll in the league whose matchup is final. Idempotent; never throws.
 *
 * Called from the week finalizer once a week is fully final, and again before the leaderboard is
 * read, so a week finalized before this shipped (or whose finalizer tail failed) still settles.
 */
export async function resolvePredictionPollsForLeague(args: {
  prisma: Db
  leagueId: string
  now?: Date
}): Promise<{ checked: number; resolved: number }> {
  const out = { checked: 0, resolved: 0 }
  try {
    const rows = await args.prisma.leagueChatMessage.findMany({
      where: { leagueId: args.leagueId, messageSubtype: PREDICTION_POLL_SUBTYPE },
      select: { id: true, metadata: true },
    })
    const polls = rows
      .map((r) => ({ id: r.id, metadata: r.metadata, prediction: readPrediction(r.metadata) }))
      .filter((r): r is { id: string; metadata: typeof r.metadata; prediction: PredictionMeta } => r.prediction != null)
    if (polls.length === 0) return out
    out.checked = polls.length

    const matchups = await args.prisma.redraftMatchup.findMany({
      where: { leagueId: args.leagueId, id: { in: [...new Set(polls.map((p) => p.prediction.matchupId))] } },
      select: { id: true, status: true, homeScore: true, awayScore: true },
    })
    const byId = new Map(matchups.map((m) => [m.id, m]))
    const now = args.now ?? new Date()

    for (const p of polls) {
      const m = byId.get(p.prediction.matchupId)
      if (!m) continue
      const outcome = decidePredictionOutcome(m)
      if (!outcome) continue
      const next = applyPredictionResolution(p.metadata, outcome, { home: m.homeScore, away: m.awayScore }, now)
      if (!next) continue
      await args.prisma.leagueChatMessage.update({
        where: { id: p.id },
        data: { metadata: next as never },
      })
      out.resolved += 1
    }
  } catch (error) {
    console.warn('[predictionPolls] resolve failed', {
      leagueId: args.leagueId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return out
}

/** The season's leaderboard for a league, with display names. */
export async function loadPredictionLeaderboard(args: {
  prisma: Pick<PrismaClient, 'leagueChatMessage' | 'appUser'>
  leagueId: string
  season: number
}): Promise<Array<LeaderboardEntry & { name: string }>> {
  const rows = await args.prisma.leagueChatMessage.findMany({
    where: { leagueId: args.leagueId, messageSubtype: PREDICTION_POLL_SUBTYPE },
    select: { metadata: true },
  })
  const board = computePredictionLeaderboard(rows, args.season)
  if (board.length === 0) return []
  const users = await args.prisma.appUser.findMany({
    where: { id: { in: board.map((b) => b.userId) } },
    select: { id: true, displayName: true, username: true },
  })
  const names = new Map(users.map((u) => [u.id, u.displayName?.trim() || u.username?.trim() || 'Manager']))
  return board.map((b) => ({ ...b, name: names.get(b.userId) ?? 'Manager' }))
}

/* ─── Creating one, and what can be created ─────────────────────────────────────────────────── */

type CreateDb = Pick<PrismaClient, 'league' | 'redraftSeason' | 'redraftMatchup' | 'redraftRoster' | 'leagueChatMessage' | 'sportsGame'>

export type PredictableMatchup = {
  id: string
  week: number
  home: PredictionTeam
  away: PredictionTeam
  /** The prediction poll already posted for it, if any — one per matchup. */
  pollMessageId: string | null
}

/** The league's current native season, or null for an import or a league with no schedule. */
async function currentSeason(prisma: Pick<PrismaClient, 'league' | 'redraftSeason'>, leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  if (!league) return null
  const { isNativePlatform } = await import('@/lib/league/isNativeLeague')
  // An imported league's matchups are its provider's; there is nothing of ours to resolve against.
  if (!isNativePlatform(league.platform)) return null
  return prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, sport: true, currentWeek: true },
  })
}

/**
 * The matchups a member can post a prediction on right now: the earliest week, from the season's
 * current one on, that still has a game that has not started.
 */
export async function listPredictableMatchups(args: {
  prisma: Pick<PrismaClient, 'league' | 'redraftSeason' | 'redraftMatchup' | 'leagueChatMessage'>
  leagueId: string
}): Promise<{ native: boolean; season: number | null; week: number | null; matchups: PredictableMatchup[] }> {
  const season = await currentSeason(args.prisma, args.leagueId)
  if (!season) return { native: false, season: null, week: null, matchups: [] }
  const rows = await args.prisma.redraftMatchup.findMany({
    where: {
      seasonId: season.id,
      status: 'scheduled',
      isMedianMatchup: false,
      awayRosterId: { not: null },
      week: { gte: Math.max(1, season.currentWeek || 1) },
    },
    orderBy: [{ week: 'asc' }],
    select: {
      id: true,
      week: true,
      homeRosterId: true,
      awayRosterId: true,
      homeRoster: { select: { teamName: true, ownerName: true } },
      awayRoster: { select: { teamName: true, ownerName: true } },
    },
  })
  const week = rows[0]?.week ?? null
  const thisWeek = rows.filter((r) => r.week === week)
  const posted = thisWeek.length
    ? await args.prisma.leagueChatMessage.findMany({
        where: { id: { in: thisWeek.map((r) => predictionPollMessageId(r.id)) } },
        select: { id: true },
      })
    : []
  const postedIds = new Set(posted.map((p) => p.id))
  return {
    native: true,
    season: season.season,
    week,
    matchups: thisWeek.map((r) => ({
      id: r.id,
      week: r.week,
      home: { rosterId: r.homeRosterId, name: predictionTeamName(r.homeRoster) },
      away: { rosterId: r.awayRosterId as string, name: predictionTeamName(r.awayRoster) },
      pollMessageId: postedIds.has(predictionPollMessageId(r.id)) ? predictionPollMessageId(r.id) : null,
    })),
  }
}

export type CreatePredictionResult =
  | { ok: true; messageId: string; created: boolean }
  | { ok: false; code: 'not_native' | 'matchup_not_found' | 'not_predictable' | 'kicked_off' }

/**
 * Post the prediction poll for one matchup into the league chat. Idempotent per matchup: the row
 * id is derived from the matchup, so a second call (a second member, a double tap, the Studio's
 * auto-post) returns the poll already there with `created: false` instead of a duplicate that
 * would score every pick twice.
 *
 * Posting side effects are the ones `/api/league/chat` has — the Discord relay and the opt-in
 * "new league chat message" notification — and nothing more.
 */
export async function createPredictionPoll(args: {
  prisma: CreateDb
  leagueId: string
  matchupId: string
  authorUserId: string
  resultsVisibility?: 'live' | 'after_close'
  now?: Date
  /** Injected for tests. */
  firstKickoff?: (q: { sport: string; season: number; week: number }) => Promise<Date | null>
  afterPost?: (posted: PostedChatItem) => Promise<void> | void
}): Promise<CreatePredictionResult> {
  const now = args.now ?? new Date()
  const season = await currentSeason(args.prisma, args.leagueId)
  if (!season) return { ok: false, code: 'not_native' }

  const m = await args.prisma.redraftMatchup.findUnique({
    where: { id: args.matchupId },
    select: {
      id: true,
      leagueId: true,
      seasonId: true,
      week: true,
      status: true,
      homeRosterId: true,
      awayRosterId: true,
      homeScore: true,
      awayScore: true,
      isMedianMatchup: true,
      homeRoster: { select: { teamName: true, ownerName: true } },
      awayRoster: { select: { teamName: true, ownerName: true } },
    },
  })
  if (!m || m.leagueId !== args.leagueId) return { ok: false, code: 'matchup_not_found' }

  const messageId = predictionPollMessageId(m.id)
  const existing = await args.prisma.leagueChatMessage.findUnique({ where: { id: messageId }, select: { id: true } })
  if (existing) return { ok: true, messageId, created: false }

  if (!isPredictableMatchup(m)) return { ok: false, code: 'not_predictable' }

  let kickoff: Date | null = null
  try {
    kickoff = args.firstKickoff
      ? await args.firstKickoff({ sport: season.sport, season: season.season, week: m.week })
      : await defaultFirstKickoff(args.prisma, { sport: season.sport, season: season.season, week: m.week })
  } catch {
    kickoff = null
  }
  if (kickoff && kickoff.getTime() <= now.getTime()) return { ok: false, code: 'kicked_off' }

  const home = { rosterId: m.homeRosterId, name: predictionTeamName(m.homeRoster) }
  const away = { rosterId: m.awayRosterId as string, name: predictionTeamName(m.awayRoster) }
  const metadata = buildPredictionPollMetadata({
    matchup: m,
    season: season.season,
    home,
    away,
    closeAt: kickoff,
    resultsVisibility: args.resultsVisibility,
  })
  const body = `📊 ${String(metadata.poll.question)}`

  const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
  const created = await createLeagueChatMessage(args.leagueId, args.authorUserId, body, {
    idempotencyKey: messageId,
    type: 'text',
    metadata,
    messageSubtype: PREDICTION_POLL_SUBTYPE,
  })
  // A null is the primary key refusing a concurrent duplicate: the poll exists, which is the goal.
  if (!created) return { ok: true, messageId, created: false }

  try {
    await (args.afterPost ?? defaultAfterPost(args.leagueId, args.authorUserId))({
      messageId,
      body,
      metadata,
      authorName: created.senderName ?? 'Manager',
      authorAvatarUrl: created.senderAvatarUrl ?? null,
    })
  } catch (error) {
    console.warn('[predictionPolls] post side effects failed', {
      leagueId: args.leagueId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return { ok: true, messageId, created: true }
}

async function defaultFirstKickoff(
  prisma: Pick<PrismaClient, 'sportsGame'>,
  q: { sport: string; season: number; week: number },
): Promise<Date | null> {
  const { buildWeekKickoffMap } = await import('@/lib/redraft/lineupLock')
  const map = await buildWeekKickoffMap(prisma as PrismaClient, q)
  return map.firstKickoff
}

export type PostedChatItem = {
  messageId: string
  body: string
  metadata: Record<string, unknown>
  authorName: string
  authorAvatarUrl: string | null
}

/** The same relay and opt-in notification a member's own league chat post gets. */
export function defaultAfterPost(leagueId: string, senderUserId: string) {
  return async (posted: PostedChatItem) => {
    const [{ syncOutboundLeagueChat }, { queueLeagueChatNotifications }] = await Promise.all([
      import('@/lib/discord/sync-outbound'),
      import('@/lib/chat-notifications/chatMessageNotifier'),
    ])
    await syncOutboundLeagueChat({
      leagueId,
      messageId: posted.messageId,
      authorName: posted.authorName,
      authorAvatarUrl: posted.authorAvatarUrl,
      text: posted.body,
      gifUrl: null,
    }).catch(() => undefined)
    queueLeagueChatNotifications({
      leagueId,
      messageId: posted.messageId,
      senderUserId,
      messageType: 'text',
      body: posted.body,
      metadata: posted.metadata,
      source: 'league',
    })
  }
}

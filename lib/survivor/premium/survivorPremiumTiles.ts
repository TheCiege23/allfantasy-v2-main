/**
 * The player-lens tiles of the Premium Survivor command center, as pure functions over public
 * facts. Every privacy rule the tiles rely on lives here so tests can drive it directly:
 *
 *  - Display names only. Never a user id, a ballot's voter, an idol or its holder, or another
 *    manager's token count.
 *  - Votes against a castaway count only at councils whose read is complete (the names were read
 *    out to everyone). A manager whose elimination has not been read yet still looks active.
 *  - Chat activity is message COUNTS in a channel the viewer can already read. Never content.
 *
 * Client-safe: no I/O.
 */

export type PremiumThreatLevel = 'high' | 'medium' | 'low'

export type PremiumCastRow = {
  userId: string
  displayName: string
  tribeId: string | null
  /** Treated as in the game: active, or out but not yet read out. */
  inGame: boolean
  isJuror: boolean
}

export type PremiumScoreRow = { userId: string; finalScore: number; wonIndividualImmunity: boolean; wonTribeImmunity: boolean }

/** One completed council read: the names on the parchments that counted. */
export type PremiumReadCouncil = { week: number; councilNumber: number; votedNames: string[] }

// ── Threat map ───────────────────────────────────────────────────────────────

export type ThreatMapRow = {
  name: string
  isYou: boolean
  seasonPoints: number
  immunityWins: number
  votesAgainst: number
  threat: PremiumThreatLevel
  /** Received votes at the most recent completed read. */
  onTheBlock: boolean
}

export type ThreatMapTile = {
  scope: 'tribe' | 'cast'
  scopeName: string | null
  rows: ThreatMapRow[]
  lastRead: { week: number; names: Array<{ name: string; votes: number }> } | null
}

const round1 = (n: number) => Math.round(n * 10) / 10

function tallyNames(names: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return counts
}

/**
 * Who looks dangerous and who is under pressure. Threat is about strength (season points, then
 * immunity wins): the top third of the scope is high, the next third medium. "On the block" is
 * who drew votes at the latest read. Pre-merge the scope is the viewer's own tribe; after the
 * merge, or for a viewer without a tribe (a host, someone on Exile), it is everyone still in.
 */
export function buildThreatMapTile(input: {
  viewerUserId: string
  viewerTribeId: string | null
  merged: boolean
  tribeNames: Readonly<Record<string, string>>
  cast: readonly PremiumCastRow[]
  scores: readonly PremiumScoreRow[]
  reads: readonly PremiumReadCouncil[]
}): ThreatMapTile {
  const byTribe = !input.merged && input.viewerTribeId != null
  const scope = input.cast.filter(p => p.inGame && (!byTribe || p.tribeId === input.viewerTribeId))
  const points = new Map<string, number>()
  const immunity = new Map<string, number>()
  for (const s of input.scores) {
    points.set(s.userId, (points.get(s.userId) ?? 0) + s.finalScore)
    if (s.wonIndividualImmunity) immunity.set(s.userId, (immunity.get(s.userId) ?? 0) + 1)
  }
  const allVotes = tallyNames(input.reads.flatMap(r => r.votedNames))
  const latest = [...input.reads].sort((a, b) => b.week - a.week || b.councilNumber - a.councilNumber)[0] ?? null
  const latestVotes = latest ? tallyNames(latest.votedNames) : new Map<string, number>()

  const ranked = [...scope].sort((a, b) =>
    (points.get(b.userId) ?? 0) - (points.get(a.userId) ?? 0) || (immunity.get(b.userId) ?? 0) - (immunity.get(a.userId) ?? 0) || a.displayName.localeCompare(b.displayName))
  const third = Math.max(1, Math.round(ranked.length / 3))
  const rows = ranked.map((p, index): ThreatMapRow => ({
    name: p.displayName,
    isYou: p.userId === input.viewerUserId,
    seasonPoints: round1(points.get(p.userId) ?? 0),
    immunityWins: immunity.get(p.userId) ?? 0,
    votesAgainst: allVotes.get(p.displayName) ?? 0,
    threat: index < third ? 'high' : index < third * 2 ? 'medium' : 'low',
    onTheBlock: (latestVotes.get(p.displayName) ?? 0) > 0,
  }))
  return {
    scope: byTribe ? 'tribe' : 'cast',
    scopeName: byTribe ? input.tribeNames[input.viewerTribeId as string] ?? null : null,
    rows,
    lastRead: latest
      ? { week: latest.week, names: [...latestVotes].map(([name, votes]) => ({ name, votes })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name)) }
      : null,
  }
}

// ── Social pulse ─────────────────────────────────────────────────────────────

export type SocialPulseTile =
  | { available: false; reason: string }
  | {
    available: true
    channelName: string
    windowDays: number
    totalMessages: number
    health: 'lively' | 'steady' | 'quiet'
    rows: Array<{ name: string; isYou: boolean; messages: number; lastActiveAt: string | null }>
  }

export const SOCIAL_PULSE_WINDOW_DAYS = 7

/** Who is talking in the viewer's own huddle this week, by count. Content is never read. */
export function buildSocialPulseTile(input: {
  viewerUserId: string
  channelName: string | null
  members: ReadonlyArray<{ userId: string; displayName: string }>
  messages: ReadonlyArray<{ senderUserId: string; createdAt: Date }>
}): SocialPulseTile {
  if (!input.channelName) return { available: false, reason: 'You do not have a tribe huddle right now.' }
  const counts = new Map<string, { n: number; last: Date | null }>()
  for (const m of input.messages) {
    const row = counts.get(m.senderUserId) ?? { n: 0, last: null }
    row.n += 1
    if (!row.last || m.createdAt > row.last) row.last = m.createdAt
    counts.set(m.senderUserId, row)
  }
  const rows = input.members.map(member => {
    const row = counts.get(member.userId)
    return { name: member.displayName, isYou: member.userId === input.viewerUserId, messages: row?.n ?? 0, lastActiveAt: row?.last?.toISOString() ?? null }
  }).sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name))
  const totalMessages = rows.reduce((n, r) => n + r.messages, 0)
  const perMember = rows.length ? totalMessages / rows.length : 0
  return {
    available: true,
    channelName: input.channelName,
    windowDays: SOCIAL_PULSE_WINDOW_DAYS,
    totalMessages,
    health: perMember >= 10 ? 'lively' : perMember >= 2 ? 'steady' : 'quiet',
    rows,
  }
}

// ── Challenge outlook ────────────────────────────────────────────────────────

export type ChallengeOutlookItem = {
  title: string
  status: 'open' | 'locked' | 'settled'
  locksAt: string | null
  reward: string | null
  scope: 'tribe' | 'individual'
  youSubmitted: boolean
}

export type ChallengeOutlookTile = { week: number; items: ChallengeOutlookItem[] }

const SETTLED = new Set(['settled', 'complete', 'completed', 'scored', 'resolved', 'closed'])

function rewardText(type: string | null, amount: number | null): string | null {
  if (!type) return null
  const label = type.replace(/_/g, ' ')
  return amount != null && amount > 0 ? `${label} (${amount})` : label
}

/** This week's challenges: what is open, when it locks, what it pays, and whether you are in. */
export function buildChallengeOutlookTile(input: {
  week: number
  now: Date
  challenges: ReadonlyArray<{
    id: string; title: string; challengeType: string; status: string; scope: string
    locksAt: Date | null; closesAt: Date | null; rewardType: string | null; rewardAmount: number | null
  }>
  submittedChallengeIds: ReadonlySet<string>
}): ChallengeOutlookTile {
  const items = input.challenges.map((c): ChallengeOutlookItem => {
    const lock = c.locksAt ?? c.closesAt
    const status: ChallengeOutlookItem['status'] = SETTLED.has(c.status) ? 'settled' : lock && lock <= input.now ? 'locked' : 'open'
    return {
      title: c.title || c.challengeType.replace(/_/g, ' '),
      status,
      locksAt: lock?.toISOString() ?? null,
      reward: rewardText(c.rewardType, c.rewardAmount),
      scope: c.scope === 'individual' ? 'individual' : 'tribe',
      youSubmitted: input.submittedChallengeIds.has(c.id),
    }
  })
  const order = { open: 0, locked: 1, settled: 2 } as const
  items.sort((a, b) => order[a.status] - order[b.status] || (a.locksAt ?? '').localeCompare(b.locksAt ?? ''))
  return { week: input.week, items }
}

// ── Jury projection ──────────────────────────────────────────────────────────

export type JuryProjectionTile = {
  jurors: string[]
  finalistCount: number
  remaining: number
  /** The castaways best placed to reach the end, strongest first, with why. */
  contenders: Array<{ name: string; isYou: boolean; reason: string }>
}

/**
 * Who is on the jury and who looks set to face it. A contender's case is strength that also
 * survived scrutiny: immunity wins and season points, with fewer votes drawn breaking ties.
 */
export function buildJuryProjectionTile(input: {
  viewerUserId: string
  finalistCount: number
  cast: readonly PremiumCastRow[]
  scores: readonly PremiumScoreRow[]
  reads: readonly PremiumReadCouncil[]
}): JuryProjectionTile {
  const map = buildThreatMapTile({ viewerUserId: input.viewerUserId, viewerTribeId: null, merged: true, tribeNames: {}, cast: input.cast, scores: input.scores, reads: input.reads })
  const contenders = [...map.rows].sort((a, b) => b.immunityWins - a.immunityWins || b.seasonPoints - a.seasonPoints || a.votesAgainst - b.votesAgainst || a.name.localeCompare(b.name))
    .slice(0, Math.max(input.finalistCount + 2, 3))
    .map(row => ({
      name: row.name,
      isYou: row.isYou,
      reason: [
        row.immunityWins ? `${row.immunityWins} immunity win${row.immunityWins === 1 ? '' : 's'}` : null,
        `${row.seasonPoints} season points`,
        row.votesAgainst === 0 ? 'no votes drawn' : `${row.votesAgainst} vote${row.votesAgainst === 1 ? '' : 's'} drawn`,
      ].filter(Boolean).join(' · '),
    }))
  return {
    jurors: input.cast.filter(p => p.isJuror && !p.inGame).map(p => p.displayName).sort((a, b) => a.localeCompare(b)),
    finalistCount: input.finalistCount,
    remaining: map.rows.length,
    contenders,
  }
}

// ── Exile status ─────────────────────────────────────────────────────────────

export type ExileStatusTile =
  | { enabled: false }
  | {
    enabled: true
    returnWeek: number
    weeksUntilReturn: number | null
    tokensNeeded: number
    onExile: number
    /** Only ever the viewer's own balance, and only while they are on Exile. */
    you: { onExile: true; tokens: number } | { onExile: false }
  }

export function buildExileStatusTile(input: {
  enabled: boolean
  returnWeek: number
  tokensNeeded: number
  currentWeek: number
  exileCount: number
  viewer: { onExile: boolean; tokens: number }
}): ExileStatusTile {
  if (!input.enabled) return { enabled: false }
  return {
    enabled: true,
    returnWeek: input.returnWeek,
    weeksUntilReturn: input.currentWeek > 0 && input.returnWeek >= input.currentWeek ? input.returnWeek - input.currentWeek : null,
    tokensNeeded: input.tokensNeeded,
    onExile: input.exileCount,
    you: input.viewer.onExile ? { onExile: true, tokens: input.viewer.tokens } : { onExile: false },
  }
}

export type SurvivorPremiumTilePayload =
  | { tileId: 'threat_map'; data: ThreatMapTile }
  | { tileId: 'social_pulse'; data: SocialPulseTile }
  | { tileId: 'challenge_outlook'; data: ChallengeOutlookTile }
  | { tileId: 'jury_projection'; data: JuryProjectionTile }
  | { tileId: 'exile_status'; data: ExileStatusTile }

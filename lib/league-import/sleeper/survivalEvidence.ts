const MAX_SCORING_WEEK = 30
const COMMISSIONER_DROP_WINDOW_MS = 60 * 60 * 1000

export type SleeperSurvivalEvidence = {
  version: 1
  method: 'sleeper_chopped' | 'verified_weekly_chops' | 'verified_commissioner_drops'
  rosterId: number
  firstWeek: number
  finalWeek: number
  eliminatedWeek: number | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function week(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SCORING_WEEK
}

function rosterId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function readSleeperSurvivalEvidence(value: unknown): SleeperSurvivalEvidence | null {
  const v = record(value)
  if (v.version !== 1 || (v.method !== 'sleeper_chopped' && v.method !== 'verified_weekly_chops' &&
      v.method !== 'verified_commissioner_drops')) return null
  if (!rosterId(v.rosterId) || !week(v.firstWeek) || !week(v.finalWeek) || v.firstWeek > v.finalWeek) return null
  if (v.eliminatedWeek === null) {
    if (v.method !== 'sleeper_chopped') return null
  } else if (!week(v.eliminatedWeek) || v.eliminatedWeek < v.firstWeek || v.eliminatedWeek > v.finalWeek) return null
  return {
    version: 1, method: v.method, rosterId: v.rosterId, firstWeek: v.firstWeek,
    finalWeek: v.finalWeek, eliminatedWeek: v.eliminatedWeek,
  }
}

export function sleeperSurvivalPeriods(evidence: SleeperSurvivalEvidence) {
  const totalPeriods = evidence.finalWeek - evidence.firstWeek + 1
  return { totalPeriods, periods: evidence.eliminatedWeek === null ? totalPeriods : evidence.eliminatedWeek - evidence.firstWeek }
}

type WeeklyScore = { id: number; points: number; players: unknown[] }

function weeklyScores(input: unknown, expectedRosters: Set<number>): WeeklyScore[] | null {
  if (!Array.isArray(input) || input.length !== expectedRosters.size) return null
  const seen = new Set<number>()
  const active: WeeklyScore[] = []
  for (const entry of input) {
    const row = record(entry)
    const id = row.roster_id
    const points = row.custom_points ?? row.points
    if (!rosterId(id) || !expectedRosters.has(id) || seen.has(id) || typeof points !== 'number' || !Number.isFinite(points)) return null
    seen.add(id)
    const hasPlayers = Array.isArray(row.players) && row.players.length > 0
    const hasStarter = Array.isArray(row.starters) && row.starters.some(id => typeof id === 'string' && id !== '' && id !== '0')
    if (hasPlayers && hasStarter) active.push({ id, points, players: row.players as unknown[] })
    // Older completed seasons can retain starter IDs after the roster was cleared.
    // An empty roster must also have zero points and pass the full elimination replay.
    else if (hasPlayers || points !== 0) return null
  }
  return active
}

function verifiedWeeklyExit(
  scores: WeeklyScore[][], expectedRosters: Set<number>, ownerRoster: number,
): number | null {
  let prior = scores[0]
  if (!prior || prior.length !== expectedRosters.size || scores.at(-1)?.length !== 2) return null
  let exit: number | null = null
  for (let i = 1; i < scores.length; i++) {
    const current = scores[i]
    const priorIds = new Set(prior.map(r => r.id))
    if (current.some(r => !priorIds.has(r.id))) return null
    const currentIds = new Set(current.map(r => r.id))
    const removed = prior.filter(r => !currentIds.has(r.id))
    if (prior.length > 2) {
      if (removed.length !== 1) return null
      const cut = removed[0]
      if (prior.some(r => r.id !== cut.id && r.points <= cut.points)) return null
      if (cut.id === ownerRoster) exit = i - 1
    } else if (removed.length) return null
    prior = current
  }
  return exit
}

async function verifiedCommissionerExit(
  scores: WeeklyScore[][], ownerRoster: number, firstWeek: number,
  getTransactions: (week: number) => Promise<unknown>,
): Promise<number | null> {
  // The owner must have a scored roster up to the cut and stay inactive afterward.
  const firstMissing = scores.findIndex(active => active.every(row => row.id !== ownerRoster))
  if (firstMissing <= 0 || scores.slice(firstMissing).some(active => active.some(row => row.id === ownerRoster))) return null
  const cutIndex = firstMissing - 1
  const active = scores[cutIndex]
  const owner = active.find(row => row.id === ownerRoster)
  if (!owner || active.length < 2 || active.some(row => row.id !== ownerRoster && row.points <= owner.points)) return null

  const expectedPlayers = new Set(owner.players.filter((id): id is string => typeof id === 'string' && id !== '' && id !== '0'))
  if (expectedPlayers.size !== owner.players.length) return null
  const eliminatedWeek = firstWeek + cutIndex
  const transactions = await getTransactions(eliminatedWeek)
  if (!Array.isArray(transactions)) return null
  const dropped = new Set<string>()
  const commissioners = new Set<string>()
  const timestamps: number[] = []
  for (const raw of transactions) {
    const tx = record(raw)
    if (tx.type !== 'commissioner' || tx.status !== 'complete' || tx.leg !== eliminatedWeek) continue
    const relevantDrops = Object.entries(record(tx.drops)).filter(([id, team]) => team === ownerRoster && expectedPlayers.has(id))
    if (relevantDrops.length === 0) continue
    if (typeof tx.creator !== 'string' || !tx.creator || typeof tx.status_updated !== 'number' ||
        !Number.isSafeInteger(tx.status_updated) || tx.status_updated <= 0 ||
        Object.values(record(tx.adds)).includes(ownerRoster)) return null
    for (const [id] of relevantDrops) dropped.add(id)
    commissioners.add(tx.creator)
    timestamps.push(tx.status_updated)
  }
  // Require a single, time-bounded commissioner action covering the exact roster.
  if (dropped.size !== expectedPlayers.size || commissioners.size !== 1 ||
      Math.max(...timestamps) - Math.min(...timestamps) > COMMISSIONER_DROP_WINDOW_MS) return null
  return eliminatedWeek
}

export function isCompletedSleeperEliminationCandidate(value: unknown): boolean {
  const league = record(value)
  const settings = record(league.settings)
  return league.status === 'complete' && league.sport === 'nfl' &&
    (settings.type === 3 || (settings.playoff_week_start === 0 &&
      typeof league.name === 'string' && /\b(?:guillotine|guillo|guilly|chopped)\b/i.test(league.name)))
}

/**
 * Native Chopped seasons record exact cut weeks. For a custom Guillotine league,
 * verify the full weekly elimination pattern or corroborate the owner's exit
 * with a completed commissioner drop for every player on the cut-week roster.
 */
export async function verifySleeperSurvival(
  leagueValue: unknown,
  rosterValues: unknown,
  sleeperUserId: string,
  getWeek: (week: number) => Promise<unknown>,
  getTransactions?: (week: number) => Promise<unknown>,
): Promise<SleeperSurvivalEvidence | null> {
  const league = record(leagueValue)
  const settings = record(league.settings)
  if (!isCompletedSleeperEliminationCandidate(league) || !Array.isArray(rosterValues)) return null
  const native = settings.type === 3

  const rosters = rosterValues.map(record)
  const expectedRosters = new Set(rosters.map(r => r.roster_id).filter(rosterId))
  const matching = rosters.filter(r => r.owner_id === sleeperUserId || (Array.isArray(r.co_owners) && r.co_owners.includes(sleeperUserId)))
  const ownerRoster = matching[0]?.roster_id
  if (matching.length !== 1 || !rosterId(ownerRoster) || expectedRosters.size !== rosters.length ||
      expectedRosters.size !== league.total_rosters || expectedRosters.size < 3) return null
  const firstWeek = settings.start_week ?? (native ? 1 : null)
  const finalWeek = settings.last_scored_leg
  if (!week(firstWeek) || !week(finalWeek) || firstWeek >= finalWeek) return null

  if (native) {
    if (settings.last_chopped_leg !== finalWeek) return null
    const cuts = rosters.map(r => record(r.settings).eliminated)
    const actualCuts = cuts.filter(value => value !== undefined && value !== null)
    if (actualCuts.length !== rosters.length - 1 || actualCuts.length !== finalWeek - firstWeek + 1 ||
        new Set(actualCuts).size !== actualCuts.length ||
        actualCuts.some(value => !week(value) || value < firstWeek || value > finalWeek)) return null
    return readSleeperSurvivalEvidence({
      version: 1, method: 'sleeper_chopped', rosterId: ownerRoster, firstWeek, finalWeek,
      eliminatedWeek: record(matching[0].settings).eliminated ?? null,
    })
  }

  const weeks: unknown[] = []
  for (let start = firstWeek; start <= finalWeek; start += 4) {
    const batch = Array.from({ length: Math.min(4, finalWeek - start + 1) }, (_, i) => getWeek(start + i))
    weeks.push(...await Promise.all(batch))
  }
  const scores = weeks.map(value => weeklyScores(value, expectedRosters))
  if (!scores.every((active): active is WeeklyScore[] => active !== null)) return null
  const exit = verifiedWeeklyExit(scores, expectedRosters, ownerRoster)
  if (exit !== null) return {
    version: 1, method: 'verified_weekly_chops', rosterId: ownerRoster, firstWeek, finalWeek,
    eliminatedWeek: firstWeek + exit,
  }
  const eliminatedWeek = getTransactions ? await verifiedCommissionerExit(scores, ownerRoster, firstWeek, getTransactions) : null
  return eliminatedWeek === null ? null : {
    version: 1, method: 'verified_commissioner_drops', rosterId: ownerRoster, firstWeek, finalWeek, eliminatedWeek,
  }
}

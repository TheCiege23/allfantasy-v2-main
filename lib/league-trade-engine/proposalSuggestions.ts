export type SuggestionPlayer = {
  id: string
  name: string
  position: string | null
  value: number | null
  weeklyProjection?: number | null
}

export type SuggestionPick = {
  pickId: string
  label: string
  itemType: 'rookie_pick' | 'future_pick'
  value: number | null
}

export type SuggestionRoster = {
  rosterId: string
  ownerName: string | null
  players: SuggestionPlayer[]
  picks: SuggestionPick[]
  faabRemaining: number | null
  wins: number
  losses: number
  playoffProbability?: number | null
}

export type SuggestedTradeAsset = {
  kind: 'player' | 'pick' | 'faab'
  id: string
  name: string
  value: number | null
  position: string | null
  amount: number | null
  itemType: 'player' | 'rookie_pick' | 'future_pick' | 'faab'
}

export type SuggestedTradePackage = {
  id: string
  send: SuggestedTradeAsset[]
  receive: SuggestedTradeAsset[]
  sendValue: number
  receiveValue: number
  fairness: number
  acceptanceLikelihood: number | null
  simulation?: ProposalOutcomeSimulation
  /** Signed server receipt for this exact package. Omitted when evidence is incomplete. */
  decisionEvidenceToken?: string | null
  reason: string
}

export type ProposalOutcomeSimulation = {
  available: boolean
  metric: 'playoff' | 'survival'
  beforePct: number | null
  afterPct: number | null
  deltaPct: number | null
  iterations: number
  reason: string | null
}

export type PartnerBehaviorProfile = {
  rosterId: string
  sampleSize: number
  acceptanceRate: number | null
  counterRate: number | null
  preferredAssetKinds: Array<'player' | 'pick' | 'faab'>
}

export type SuggestedMultiTeamLeg = {
  fromRosterId: string
  toRosterId: string
  asset: SuggestedTradeAsset
}

export type MultiTeamTradeSuggestion = {
  id: string
  rosterIds: [string, string, string]
  fairness: number
  reason: string
  legs: SuggestedMultiTeamLeg[]
  simulation?: ProposalOutcomeSimulation
  /** Signed server receipt for this exact package. Omitted when evidence is incomplete. */
  decisionEvidenceToken?: string | null
}

export type TradePartnerSuggestion = {
  rosterId: string
  fitScore: number
  reasons: string[]
  packages: SuggestedTradePackage[]
}

export type ProposalLeagueMode = 'redraft' | 'dynasty' | 'keeper' | 'best_ball' | 'guillotine' | 'survivor' | 'specialty'
export type ProposalManagerStrategy = 'win-now' | 'balanced' | 'rebuild'

const FLEX = new Set(['FLEX', 'SUPER_FLEX', 'SUPERFLEX', 'REC_FLEX', 'WRRB_FLEX', 'QB/RB/WR/TE'])
const NON_STARTER = new Set(['BN', 'BENCH', 'IR', 'TAXI'])

function requirements(slots: string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const raw of slots) {
    const slot = String(raw).toUpperCase()
    if (NON_STARTER.has(slot) || FLEX.has(slot)) continue
    out[slot] = (out[slot] ?? 0) + 1
  }
  return out
}

function positionCounts(roster: SuggestionRoster): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of roster.players) {
    const pos = String(p.position ?? '').toUpperCase()
    if (pos) out[pos] = (out[pos] ?? 0) + 1
  }
  return out
}

function positionStrength(roster: SuggestionRoster, position: string, starters: number): number {
  const values = roster.players
    .filter((player) => String(player.position ?? '').toUpperCase() === position && player.value != null)
    .map((player) => player.value ?? 0)
    .sort((a, b) => b - a)
    .slice(0, Math.max(1, starters))
  return values.length ? values.reduce((sum, value) => sum + value, 0) / Math.max(1, starters) : 0
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function assetOfPlayer(p: SuggestionPlayer): SuggestedTradeAsset {
  return { kind: 'player', id: p.id, name: p.name, value: p.value, position: p.position, amount: null, itemType: 'player' }
}

function assetOfPick(p: SuggestionPick): SuggestedTradeAsset {
  return { kind: 'pick', id: p.pickId, name: p.label, value: p.value, position: null, amount: null, itemType: p.itemType }
}

function combinations<T>(rows: T[], maxSize: number): T[][] {
  const out: T[][] = []
  const walk = (start: number, chosen: T[]) => {
    if (chosen.length > 0) out.push([...chosen])
    if (chosen.length >= maxSize) return
    for (let i = start; i < rows.length; i += 1) {
      chosen.push(rows[i]!)
      walk(i + 1, chosen)
      chosen.pop()
      if (out.length > 500) return
    }
  }
  walk(0, [])
  return out
}

function total(rows: SuggestedTradeAsset[]): number {
  return rows.reduce((sum, row) => sum + (row.value ?? 0), 0)
}

function packageFor(
  mine: SuggestionRoster,
  target: SuggestionRoster,
  wanted: SuggestedTradeAsset,
  weakPositions: string[],
  mineSurplus: string[],
  targetWeak: string[],
  faabBudget: number | null,
  leagueMode: ProposalLeagueMode,
  managerStrategy: ProposalManagerStrategy,
  behavior: PartnerBehaviorProfile | null,
  ordinal: number,
): SuggestedTradePackage | null {
  if (wanted.value == null || wanted.value <= 0) return null
  const pool = [
    ...mine.players
      .filter((p) => p.value != null && p.value > 0)
      .sort((a, b) => {
        const aSurplus = mineSurplus.includes(String(a.position).toUpperCase()) ? 1 : 0
        const bSurplus = mineSurplus.includes(String(b.position).toUpperCase()) ? 1 : 0
        return bSurplus - aSurplus || (b.value ?? 0) - (a.value ?? 0)
      })
      .slice(0, 12)
      .map(assetOfPlayer),
    ...(leagueMode === 'guillotine' || leagueMode === 'survivor' || leagueMode === 'best_ball' || managerStrategy === 'rebuild'
      ? []
      : mine.picks.filter((p) => p.value != null && p.value > 0).slice(0, 6).map(assetOfPick)),
  ]
  const combos = combinations(pool, 3)
  let best: SuggestedTradeAsset[] | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const combo of combos) {
    const value = total(combo)
    const diff = Math.abs(value - wanted.value) / wanted.value
    const helpsTarget = combo.some((a) => a.kind === 'pick' || (a.position && targetWeak.includes(a.position.toUpperCase())))
    const scarceAssetsSent = combo.filter((a) => a.kind === 'player' && a.position && !mineSurplus.includes(a.position.toUpperCase())).length
    const replacesScarceTarget = wanted.kind !== 'player' || !wanted.position || !targetWeak.includes(wanted.position.toUpperCase())
      || combo.some((asset) => asset.kind === 'player' && asset.position?.toUpperCase() === wanted.position?.toUpperCase())
    const score = diff + (helpsTarget ? 0 : 0.1) + (replacesScarceTarget ? 0 : 0.25) + scarceAssetsSent * 0.05 + Math.max(0, combo.length - 2) * 0.02
    if (score < bestScore) {
      best = combo
      bestScore = score
    }
  }
  if (!best) return null

  const send = [...best]
  let sendValue = total(send)
  const gap = wanted.value - sendValue
  if (gap > wanted.value * 0.04 && mine.faabRemaining && faabBudget && mine.faabRemaining > 0) {
    const faabUnit = Math.max(1, wanted.value * 0.12 / faabBudget)
    const amount = Math.min(mine.faabRemaining, Math.max(1, Math.round(gap / faabUnit)))
    const value = Math.round(amount * faabUnit)
    send.push({ kind: 'faab', id: `faab:${amount}`, name: `$${amount} FAAB`, value, position: null, amount, itemType: 'faab' })
    sendValue += value
  }
  const receive = [wanted]
  let receiveValue = wanted.value
  const receiveGap = sendValue - receiveValue
  if (receiveGap > receiveValue * 0.04 && target.faabRemaining && faabBudget && target.faabRemaining > 0) {
    const faabUnit = Math.max(1, receiveValue * 0.12 / faabBudget)
    const amount = Math.min(target.faabRemaining, Math.max(1, Math.round(receiveGap / faabUnit)))
    const value = Math.round(amount * faabUnit)
    receive.push({ kind: 'faab', id: `faab:${amount}`, name: `$${amount} FAAB`, value, position: null, amount, itemType: 'faab' })
    receiveValue += value
  }
  const fairness = Math.max(0, Math.round(100 - Math.abs(sendValue - receiveValue) / Math.max(sendValue, receiveValue) * 100))
  if (fairness < 72) return null
  const receivedKinds = new Set(send.map((asset) => asset.kind))
  const preferenceHits = behavior?.preferredAssetKinds.filter((kind) => receivedKinds.has(kind)).length ?? 0
  const acceptanceLikelihood = behavior?.acceptanceRate == null
    ? null
    : Math.max(5, Math.min(95, Math.round(behavior.acceptanceRate * 100 + preferenceHits * 6 - Math.max(0, 85 - fairness) * 0.35)))
  const need = wanted.kind === 'pick'
    ? 'adds future draft capital for your rebuild'
    : wanted.position && weakPositions.includes(wanted.position.toUpperCase())
      ? `fills your ${wanted.position.toUpperCase()} need`
      : 'improves your roster plan'
  return {
    id: `${target.rosterId}:${wanted.id}:${ordinal}`,
    send,
    receive,
    sendValue: Math.round(sendValue),
    receiveValue: Math.round(receiveValue),
    fairness,
    acceptanceLikelihood,
    reason: `${wanted.name} ${need}; the package stays within ${100 - fairness}% of the priced value, avoids unnecessary damage to your scarce positions, and addresses ${target.ownerName ?? 'the other manager'}'s roster.`,
  }
}

export function generateTradePartnerSuggestions(input: {
  viewerRosterId: string | null
  rosters: SuggestionRoster[]
  rosterPositions: string[]
  faabBudget: number | null
  leagueMode?: ProposalLeagueMode
  managerStrategy?: ProposalManagerStrategy
  partnerBehavior?: PartnerBehaviorProfile[]
}): TradePartnerSuggestion[] {
  const mine = input.rosters.find((r) => r.rosterId === input.viewerRosterId)
  if (!mine) return []
  const required = requirements(input.rosterPositions)
  const leagueMode = input.leagueMode ?? 'redraft'
  const managerStrategy = input.managerStrategy ?? 'balanced'
  const mineCounts = positionCounts(mine)
  const leagueStrength = new Map(Object.entries(required).map(([position, starters]) => [
    position,
    median(input.rosters.map((roster) => positionStrength(roster, position, starters))),
  ]))
  const weakFor = (roster: SuggestionRoster, counts: Record<string, number>) => Object.entries(required)
    .filter(([position, needed]) => {
      const depthFloor = needed + (leagueMode === 'best_ball' ? 2 : 0)
      const quality = positionStrength(roster, position, needed)
      const leagueMedian = leagueStrength.get(position) ?? 0
      return (counts[position] ?? 0) <= depthFloor || (leagueMedian > 0 && quality < leagueMedian * 0.82)
    })
    .map(([position]) => position)
  const surplusFor = (roster: SuggestionRoster, counts: Record<string, number>) => Object.keys(counts)
    .filter((position) => {
      const needed = required[position] ?? 1
      const leagueMedian = leagueStrength.get(position) ?? 0
      return (counts[position] ?? 0) > needed + 1
        && (leagueMedian === 0 || positionStrength(roster, position, needed) >= leagueMedian * 0.95)
    })
  const weakPositions = weakFor(mine, mineCounts)

  return input.rosters
    .filter((r) => r.rosterId !== mine.rosterId)
    .map((target) => {
      const behavior = input.partnerBehavior?.find((profile) => profile.rosterId === target.rosterId) ?? null
      const targetCounts = positionCounts(target)
      const targetSurplus = surplusFor(target, targetCounts)
      const overlap = weakPositions.filter((pos) => targetSurplus.includes(pos))
      const mineSurplus = surplusFor(mine, mineCounts)
      const targetWeak = weakFor(target, targetCounts)
      const reciprocal = mineSurplus.filter((pos) => targetWeak.includes(pos))
      const recordGap = Math.abs((mine.wins - mine.losses) - (target.wins - target.losses))
      const playoffGap = mine.playoffProbability != null && target.playoffProbability != null
        ? Math.abs(mine.playoffProbability - target.playoffProbability)
        : null
      const timelineFit = playoffGap == null
        ? (leagueMode === 'dynasty' || leagueMode === 'keeper'
            ? Math.min(10, recordGap * 2)
            : Math.max(0, 10 - recordGap * 2))
        : (leagueMode === 'dynasty' || leagueMode === 'keeper'
            ? Math.min(12, playoffGap / 5)
            : Math.max(0, 12 - playoffGap / 5))
      const behaviorFit = behavior?.acceptanceRate == null ? 0 : Math.round(behavior.acceptanceRate * 12)
      const fitScore = Math.min(100, 45 + overlap.length * 18 + reciprocal.length * 14 + timelineFit + behaviorFit)
      const playerCandidates = target.players
        .filter((p) => p.value != null && p.value > 0)
        .sort((a, b) => {
          const aNeed = weakPositions.includes(String(a.position).toUpperCase()) ? 1 : 0
          const bNeed = weakPositions.includes(String(b.position).toUpperCase()) ? 1 : 0
          return bNeed - aNeed || (b.value ?? 0) - (a.value ?? 0)
        })
        .slice(0, managerStrategy === 'rebuild' ? 3 : 5)
        .map(assetOfPlayer)
      const pickCandidates = managerStrategy === 'rebuild' && !['guillotine', 'survivor', 'best_ball'].includes(leagueMode)
        ? target.picks.filter((p) => p.value != null && p.value > 0).slice(0, 4).map(assetOfPick)
        : []
      const candidates = [...pickCandidates, ...playerCandidates]
      const packages = candidates
        .map((wanted, i) => packageFor(mine, target, wanted, weakPositions, mineSurplus, targetWeak, input.faabBudget, leagueMode, managerStrategy, behavior, i))
        .filter((p): p is SuggestedTradePackage => Boolean(p))
        .sort((a, b) => b.fairness - a.fairness)
        .slice(0, 3)
      const reasons = [
        overlap.length ? `${target.ownerName ?? 'This manager'} has surplus ${overlap.join('/')}, where your roster is thin.` : null,
        reciprocal.length ? `You have ${reciprocal.join('/')} depth that fits their roster.` : null,
        target.picks.length ? 'Draft capital is available to balance a package.' : null,
        target.faabRemaining != null ? `They have $${target.faabRemaining} FAAB available.` : null,
        leagueMode === 'guillotine' || leagueMode === 'survivor'
          ? 'The match favors immediate weekly survival value; future picks are excluded.'
          : null,
        leagueMode === 'best_ball'
          ? 'The match favors playable depth for automatic best-lineup scoring.'
          : null,
        leagueMode === 'dynasty' || leagueMode === 'keeper'
          ? 'The match allows present production and future draft capital to balance each other.'
          : null,
        playoffGap != null
          ? `Their playoff probability is ${Math.round(target.playoffProbability ?? 0)}%; yours is ${Math.round(mine.playoffProbability ?? 0)}%.`
          : null,
        `Your confirmed strategy is ${managerStrategy}.`,
        behavior?.acceptanceRate != null
          ? `This manager has accepted ${Math.round(behavior.acceptanceRate * 100)}% of ${behavior.sampleSize} recorded offers${behavior.preferredAssetKinds.length ? ` and most often accepts ${behavior.preferredAssetKinds.join('/')}` : ''}.`
          : null,
      ].filter((x): x is string => Boolean(x))
      return { rosterId: target.rosterId, fitScore, reasons, packages }
    })
    .filter((r) => r.packages.length > 0)
    .sort((a, b) => b.fitScore - a.fitScore || b.packages[0]!.fairness - a.packages[0]!.fairness)
}

function sideFairness(sent: number, received: number): number {
  if (sent <= 0 || received <= 0) return 0
  return Math.max(0, Math.round(100 - Math.abs(sent - received) / Math.max(sent, received) * 100))
}

/** Builds genuine circular A→B→C→A player exchanges where each asset addresses the next roster's need. */
export function generateMultiTeamTradeSuggestions(input: {
  viewerRosterId: string | null
  rosters: SuggestionRoster[]
  rosterPositions: string[]
}): MultiTeamTradeSuggestion[] {
  const mine = input.rosters.find((roster) => roster.rosterId === input.viewerRosterId)
  if (!mine) return []
  const required = requirements(input.rosterPositions)
  const counts = new Map(input.rosters.map((roster) => [roster.rosterId, positionCounts(roster)]))
  const weak = (roster: SuggestionRoster) => Object.entries(required)
    .filter(([position, needed]) => (counts.get(roster.rosterId)?.[position] ?? 0) <= needed)
    .map(([position]) => position)
  const surplus = (roster: SuggestionRoster) => Object.entries(counts.get(roster.rosterId) ?? {})
    .filter(([position, count]) => count > (required[position] ?? 1) + 1)
    .map(([position]) => position)
  const candidatesFor = (from: SuggestionRoster, to: SuggestionRoster) => from.players
    .filter((player) => player.value != null && player.value > 0)
    .filter((player) => surplus(from).includes(String(player.position).toUpperCase()) && weak(to).includes(String(player.position).toUpperCase()))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 5)

  const out: MultiTeamTradeSuggestion[] = []
  const others = input.rosters.filter((roster) => roster.rosterId !== mine.rosterId)
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      const b = others[i]!
      const c = others[j]!
      for (const mineToB of candidatesFor(mine, b)) {
        for (const bToC of candidatesFor(b, c)) {
          for (const cToMine of candidatesFor(c, mine)) {
            const aFair = sideFairness(mineToB.value ?? 0, cToMine.value ?? 0)
            const bFair = sideFairness(bToC.value ?? 0, mineToB.value ?? 0)
            const cFair = sideFairness(cToMine.value ?? 0, bToC.value ?? 0)
            const fairness = Math.min(aFair, bFair, cFair)
            if (fairness < 68) continue
            out.push({
              id: `three:${mine.rosterId}:${b.rosterId}:${c.rosterId}:${mineToB.id}:${bToC.id}:${cToMine.id}`,
              rosterIds: [mine.rosterId, b.rosterId, c.rosterId],
              fairness,
              reason: `${mineToB.name} fills ${b.ownerName ?? 'team two'}'s ${mineToB.position} need, ${bToC.name} fills ${c.ownerName ?? 'team three'}'s ${bToC.position} need, and ${cToMine.name} fills your ${cToMine.position} need.`,
              legs: [
                { fromRosterId: mine.rosterId, toRosterId: b.rosterId, asset: assetOfPlayer(mineToB) },
                { fromRosterId: b.rosterId, toRosterId: c.rosterId, asset: assetOfPlayer(bToC) },
                { fromRosterId: c.rosterId, toRosterId: mine.rosterId, asset: assetOfPlayer(cToMine) },
              ],
            })
          }
        }
      }
    }
  }
  return out.sort((a, b) => b.fairness - a.fairness).slice(0, 3)
}

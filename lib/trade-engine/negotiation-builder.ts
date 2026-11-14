import type {
  Asset,
  AcceptDriver,
  NegotiationToolkit,
  NegotiationTheme,
  SweetenerTarget,
} from './types'
import type { TradeDriverData } from './trade-engine'

const DRIVER_TO_THEME: Record<string, NegotiationTheme> = {
  ar_need_fit: 'NEED_FIT',
  ar_market_mismatch: 'MARKET',
  ar_manager_alignment: 'MANAGER_BIAS',
  ar_opp_lineup_gain: 'LINEUP_UPGRADE',
  ar_volatility_delta: 'RISK_SWAP',
}

const THEME_WHY_TEMPLATES: Record<NegotiationTheme, (d: AcceptDriver) => string> = {
  NEED_FIT: (d) => {
    const ppg = Math.abs(d.evidence.raw ?? 0).toFixed(1)
    return d.direction === 'UP'
      ? `This deal fills a weak starter slot for them (+${ppg} PPG upgrade at their need position).`
      : `The assets you're offering don't directly address their roster holes (${ppg} PPG gap).`
  },
  MARKET: (d) => {
    const pct = Math.round(Math.abs(d.evidence.raw ?? 0))
    return d.direction === 'DOWN'
      ? `They'd be giving up ~${pct}% more market value than they get back.`
      : `Market consensus favors them by ~${pct}%, so they'll see this as a bargain.`
  },
  MANAGER_BIAS: (d) => {
    const note = d.evidence.note || ''
    return d.direction === 'UP'
      ? `Their trading history suggests they're receptive to this type of deal.${note ? ` ${note}` : ''}`
      : `Their past trades suggest they rarely accept deals structured like this.${note ? ` ${note}` : ''}`
  },
  LINEUP_UPGRADE: (d) => {
    const ppg = Math.abs(d.evidence.raw ?? 0).toFixed(1)
    return d.direction === 'UP'
      ? `This trade improves their starting lineup by ${ppg} PPG per week.`
      : `Their starting lineup doesn't meaningfully improve (${ppg} PPG delta).`
  },
  RISK_SWAP: (d) => {
    const vol = Math.abs(d.evidence.raw ?? 0).toFixed(2)
    return d.direction === 'UP'
      ? `They'd be trading into lower-volatility assets (${vol} vol improvement), which reduces their risk.`
      : `The assets you're offering carry more volatility (${vol} vol increase), making this riskier for them.`
  },
}

function pickTheme(drivers: AcceptDriver[]): { theme: NegotiationTheme; driver: AcceptDriver } {
  if (drivers.length === 0) {
    const fallback: AcceptDriver = { id: 'ar_market_mismatch', name: 'Market', emoji: '📈', direction: 'NEUTRAL', strength: 'WEAK', value: 0, evidence: {} }
    return { theme: 'MARKET', driver: fallback }
  }
  const eligible = drivers.filter(d => DRIVER_TO_THEME[d.id] != null)
  if (eligible.length === 0) {
    return { theme: 'MARKET', driver: drivers[0] }
  }
  eligible.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  const strongest = eligible[0]
  return { theme: DRIVER_TO_THEME[strongest.id], driver: strongest }
}

type NegotiationBuilderInput = {
  drivers: TradeDriverData
  give: Asset[]
  receive: Asset[]
  availableBenchAssets?: Asset[]
  availablePicks?: Array<{ id: string; displayName?: string; round?: number; season?: number; value?: number }>
  userFaabRemaining?: number
  partnerNeeds?: string[]
  userNeeds?: string[]
}

function resolveMainPos(receive: Asset[]): string {
  const posCounts: Record<string, number> = {}
  for (const a of receive) {
    if (a.pos) {
      posCounts[a.pos] = (posCounts[a.pos] ?? 0) + 1
    }
  }
  let mainPos = 'depth'
  let max = 0
  for (const [pos, count] of Object.entries(posCounts)) {
    if (count > max) { max = count; mainPos = pos }
  }
  return mainPos
}

function buildDmMessages(
  theme: NegotiationTheme,
  drivers: TradeDriverData,
  receive: Asset[],
): NegotiationToolkit['dmMessages'] {
  const needFitDriver = drivers.acceptDrivers.find(d => d.id === 'ar_need_fit')
  const marketDriver = drivers.acceptDrivers.find(d => d.id === 'ar_market_mismatch')
  const lineupDriver = drivers.acceptDrivers.find(d => d.id === 'ar_opp_lineup_gain')
  const volDriver = drivers.acceptDrivers.find(d => d.id === 'ar_volatility_delta')

  const needFitPPG = Math.abs(needFitDriver?.evidence.raw ?? 0).toFixed(1)
  const marketDeltaOppPct = Math.round(Math.abs(marketDriver?.evidence.raw ?? 0))
  const deltaThem = Math.abs(lineupDriver?.evidence.raw ?? 0).toFixed(1)
  const volDelta = (volDriver?.evidence.raw ?? 0).toFixed(2)
  const mainPos = resolveMainPos(receive)

  switch (theme) {
    case 'NEED_FIT':
      return {
        opener: `I think this helps your ${mainPos} spot immediately — want to work something out?`,
        rationale: `It upgrades your weakest starter by about +${needFitPPG} PPG based on your lineup setup.`,
        fallback: "No worries if the package isn't right — let me know what you'd need to make it work and I'll see if we can adjust.",
      }
    case 'MARKET':
      return {
        opener: "I can balance this a bit more if you're hung up on market values.",
        rationale: `Right now market shows you'd be down ~${marketDeltaOppPct}%, which usually blocks trades.`,
        fallback: "If the value feels off, I'm open to tweaking it — maybe a pick swap or small add could balance things out.",
      }
    case 'MANAGER_BIAS':
      return {
        opener: `Saw you've been targeting ${mainPos} upgrades — I've got one that fits.`,
        rationale: `Your past deals show you prioritize ${mainPos} starters, so this is aligned.`,
        fallback: "If this isn't quite the direction you're going, let me know what would fit better and I'll take another look.",
      }
    case 'LINEUP_UPGRADE':
      return {
        opener: "This looks like a clean weekly starter upgrade for you.",
        rationale: `Your projected starters improve by roughly +${deltaThem} PPG.`,
        fallback: "If the starter swap doesn't appeal, I have a couple other ideas that might achieve a similar upgrade — want to hear them?",
      }
    case 'RISK_SWAP':
      return {
        opener: "If you'd rather reduce volatility / chase upside, we can shape it that way.",
        rationale: `This deal shifts volatility by ${volDelta}, which matches your style.`,
        fallback: "I get it if the volatility angle doesn't appeal — if you'd rather keep your current pieces, no hard feelings.",
      }
  }
}

function estimateAcceptProbDelta(
  addedMarketValue: number,
  tradeTotal: number,
  currentProb: number,
): number {
  if (tradeTotal <= 0) return 0
  const pctAdd = addedMarketValue / tradeTotal
  const rawDelta = pctAdd * 0.20
  const headroom = 1 - currentProb
  return Math.round(Math.min(rawDelta, headroom * 0.5) * 1000) / 1000
}

function buildCounters(input: NegotiationBuilderInput): NegotiationToolkit['counters'] {
  const { drivers, give, receive, availableBenchAssets, availablePicks, userFaabRemaining } = input
  const counters: NegotiationToolkit['counters'] = []

  const negDrivers = drivers.acceptDrivers
    .filter(d => d.direction === 'DOWN' && d.strength !== 'WEAK')
    .sort((a, b) => a.value - b.value)

  const giveTotal = give.reduce((s, a) => s + (a.marketValue ?? a.value ?? 0), 0)
  const receiveTotal = receive.reduce((s, a) => s + (a.marketValue ?? a.value ?? 0), 0)
  const tradeTotal = Math.max(giveTotal, receiveTotal, 1)

  for (const nd of negDrivers.slice(0, 4)) {
    if (counters.length >= 3) break

    if (nd.id === 'ar_market_mismatch' && (availablePicks?.length || (userFaabRemaining ?? 0) > 0)) {
      const marketGap = Math.abs(nd.evidence.raw ?? 0)
      const targetValue = tradeTotal * (marketGap / 100) * 0.6

      const pick = availablePicks
        ?.filter(p => (p.round ?? 4) >= 2)
        .sort((a, b) => Math.abs((a.value ?? 0) - targetValue) - Math.abs((b.value ?? 0) - targetValue))
        [0]

      if (pick) {
        const pickAsset: Asset = {
          id: pick.id,
          type: 'PICK',
          value: pick.value ?? 0,
          displayName: pick.displayName,
          round: pick.round as 1 | 2 | 3 | 4 | undefined,
          pickSeason: pick.season,
        }
        const delta = estimateAcceptProbDelta(pick.value ?? 0, tradeTotal, drivers.acceptProbability)
        counters.push({
          id: `counter_market_pick_${counters.length}`,
          description: `Add ${pick.displayName || pick.id} (late 2nd/3rd equivalent) to close the ~${Math.round(marketGap)}% market gap.`,
          adjust: { add: [pickAsset] },
          expected: {
            acceptProbDelta: delta,
            driverChanges: [{ driverId: 'ar_market_mismatch', delta: Math.min(Math.abs(nd.value) * 0.6, 0.5) }],
          },
        })
      } else if ((userFaabRemaining ?? 0) >= 3) {
        const faabToAdd = Math.min(
          Math.round(targetValue / 100) * 5 || 5,
          userFaabRemaining ?? 0,
          25,
        )
        const faabAsset: Asset = { id: `faab_${faabToAdd}`, type: 'FAAB', value: faabToAdd * 100, faabAmount: faabToAdd }
        const delta = estimateAcceptProbDelta(faabToAdd * 100, tradeTotal, drivers.acceptProbability)
        counters.push({
          id: `counter_market_faab_${counters.length}`,
          description: `Add $${faabToAdd} FAAB to narrow the ~${Math.round(marketGap)}% market value gap.`,
          adjust: { add: [faabAsset] },
          expected: {
            acceptProbDelta: delta,
            driverChanges: [{ driverId: 'ar_market_mismatch', delta: Math.min(Math.abs(nd.value) * 0.4, 0.3) }],
          },
        })
      }
    }

    if (nd.id === 'ar_need_fit' && availableBenchAssets?.length) {
      const partnerNeeds = new Set((input.partnerNeeds ?? []).map(p => p.toUpperCase()))
      const needFitPlayers = availableBenchAssets
        .filter(a => a.pos && partnerNeeds.has(a.pos.toUpperCase()))
        .sort((a, b) => (b.marketValue ?? b.value ?? 0) - (a.marketValue ?? a.value ?? 0))

      const swapCandidate = needFitPlayers[0]
      if (swapCandidate) {
        const worstIncoming = [...receive]
          .filter(a => a.type === 'PLAYER')
          .sort((a, b) => (a.marketValue ?? a.value ?? 0) - (b.marketValue ?? b.value ?? 0))[0]

        const delta = estimateAcceptProbDelta(
          (swapCandidate.marketValue ?? swapCandidate.value ?? 0),
          tradeTotal,
          drivers.acceptProbability,
        )

        const desc = worstIncoming
          ? `Swap incoming ${worstIncoming.name || worstIncoming.id} for ${swapCandidate.name || swapCandidate.id} (${swapCandidate.pos}) to better match their weakest slot.`
          : `Add ${swapCandidate.name || swapCandidate.id} (${swapCandidate.pos}) to directly fill their ${swapCandidate.pos} need.`

        counters.push({
          id: `counter_needfit_${counters.length}`,
          description: desc,
          adjust: { add: [swapCandidate] },
          expected: {
            acceptProbDelta: delta,
            driverChanges: [{ driverId: 'ar_need_fit', delta: Math.min(Math.abs(nd.value) * 0.5, 0.4) }],
          },
        })
      }
    }

    if (nd.id === 'ar_deal_shape') {
      const shape = nd.evidence.raw ?? 0
      if (shape < 0 && availableBenchAssets?.length) {
        const benchAdd = availableBenchAssets
          .filter(a => a.type === 'PLAYER' && !a.isCornerstone)
          .sort((a, b) => (a.marketValue ?? a.value ?? 0) - (b.marketValue ?? b.value ?? 0))
          [0]

        if (benchAdd) {
          const delta = estimateAcceptProbDelta(
            benchAdd.marketValue ?? benchAdd.value ?? 0,
            tradeTotal,
            drivers.acceptProbability,
          )
          counters.push({
            id: `counter_shape_${counters.length}`,
            description: `Turn ${give.length}-for-${receive.length} into ${give.length + 1}-for-${receive.length} by adding ${benchAdd.name || benchAdd.id} — they prefer depth.`,
            adjust: { add: [benchAdd] },
            expected: {
              acceptProbDelta: delta,
              driverChanges: [{ driverId: 'ar_deal_shape', delta: Math.min(Math.abs(nd.value) * 0.5, 0.3) }],
            },
          })
        }
      }
    }

    if (nd.id === 'ar_volatility_delta') {
      const lowVolAssets = (availableBenchAssets ?? [])
        .filter(a => a.type === 'PLAYER' && (a.volatility ?? 0.5) < 0.3)
        .sort((a, b) => (a.volatility ?? 0.5) - (b.volatility ?? 0.5))

      const highVolInTrade = [...give]
        .filter(a => a.type === 'PLAYER' && (a.volatility ?? 0.5) > 0.5)
        .sort((a, b) => (b.volatility ?? 0.5) - (a.volatility ?? 0.5))
        [0]

      if (lowVolAssets[0] && highVolInTrade) {
        const volImprovement = (highVolInTrade.volatility ?? 0.5) - (lowVolAssets[0].volatility ?? 0.5)
        counters.push({
          id: `counter_risk_${counters.length}`,
          description: `Swap ${highVolInTrade.name || highVolInTrade.id} (volatile) for ${lowVolAssets[0].name || lowVolAssets[0].id} (stable vet) to reduce their risk by ${volImprovement.toFixed(2)} vol.`,
          adjust: {
            add: [lowVolAssets[0]],
            remove: [highVolInTrade],
          },
          expected: {
            acceptProbDelta: estimateAcceptProbDelta(0, tradeTotal, drivers.acceptProbability) + 0.02,
            driverChanges: [{ driverId: 'ar_volatility_delta', delta: Math.min(Math.abs(nd.value) * 0.6, 0.4) }],
          },
        })
      } else if (lowVolAssets[0]) {
        counters.push({
          id: `counter_risk_add_${counters.length}`,
          description: `Add ${lowVolAssets[0].name || lowVolAssets[0].id} (stable floor) to offset the volatility in the deal.`,
          adjust: { add: [lowVolAssets[0]] },
          expected: {
            acceptProbDelta: 0.02,
            driverChanges: [{ driverId: 'ar_volatility_delta', delta: Math.min(Math.abs(nd.value) * 0.4, 0.3) }],
          },
        })
      }
    }
  }

  return counters.slice(0, 3)
}

function buildSweeteners(input: NegotiationBuilderInput): NegotiationToolkit['sweeteners'] {
  const { drivers, availablePicks, userFaabRemaining, give, receive } = input
  const sweeteners: NegotiationToolkit['sweeteners'] = []

  const giveTotal = give.reduce((s, a) => s + (a.marketValue ?? a.value ?? 0), 0)
  const receiveTotal = receive.reduce((s, a) => s + (a.marketValue ?? a.value ?? 0), 0)
  const tradeTotal = Math.max(giveTotal, receiveTotal, 1)

  const weakDriverIds = drivers.acceptDrivers
    .filter(d => d.direction === 'DOWN')
    .map(d => d.id)

  if (availablePicks?.length) {
    const sorted = [...availablePicks].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))

    const latePick = sorted.find(p => (p.round ?? 4) >= 3)
    if (latePick) {
      sweeteners.push({
        id: latePick.id,
        type: 'PICK',
        target: 'SMALL',
        suggestion: `Throw in ${latePick.displayName || latePick.id} as a small gesture of good faith.`,
        expectedAcceptProbDelta: estimateAcceptProbDelta(latePick.value ?? 500, tradeTotal, drivers.acceptProbability),
        reasoningDriverIds: weakDriverIds.length ? [weakDriverIds[0]] : ['ar_market_mismatch'],
      })
    }

    const midPick = sorted.find(p => (p.round ?? 4) === 2)
    if (midPick) {
      sweeteners.push({
        id: midPick.id,
        type: 'PICK',
        target: 'MEDIUM',
        suggestion: `Add ${midPick.displayName || midPick.id} to meaningfully close the value gap.`,
        expectedAcceptProbDelta: estimateAcceptProbDelta(midPick.value ?? 2000, tradeTotal, drivers.acceptProbability),
        reasoningDriverIds: weakDriverIds.length ? weakDriverIds.slice(0, 2) : ['ar_market_mismatch'],
      })
    }

    const earlyPick = sorted.find(p => (p.round ?? 4) === 1)
    if (earlyPick) {
      sweeteners.push({
        id: earlyPick.id,
        type: 'PICK',
        target: 'LARGE',
        suggestion: `Include ${earlyPick.displayName || earlyPick.id} — a significant add that could swing this deal.`,
        expectedAcceptProbDelta: estimateAcceptProbDelta(earlyPick.value ?? 5000, tradeTotal, drivers.acceptProbability),
        reasoningDriverIds: weakDriverIds.length ? weakDriverIds.slice(0, 2) : ['ar_market_mismatch'],
      })
    }
  }

  if ((userFaabRemaining ?? 0) >= 3) {
    const faab = userFaabRemaining!
    const steps: Array<{ amount: number; target: SweetenerTarget }> = []
    if (faab >= 3) steps.push({ amount: Math.min(5, faab), target: 'SMALL' })
    if (faab >= 8) steps.push({ amount: Math.min(12, faab), target: 'MEDIUM' })
    if (faab >= 20) steps.push({ amount: Math.min(25, faab), target: 'LARGE' })

    for (const step of steps) {
      if (sweeteners.length >= 5) break
      sweeteners.push({
        id: `sweet_faab_${step.target.toLowerCase()}_${sweeteners.length}`,
        type: 'FAAB',
        target: step.target,
        suggestion: `Add $${step.amount} FAAB to sweeten the deal.`,
        expectedAcceptProbDelta: estimateAcceptProbDelta(step.amount * 100, tradeTotal, drivers.acceptProbability),
        reasoningDriverIds: ['ar_market_mismatch'],
      })
    }
  }

  return sweeteners.slice(0, 5)
}

function buildRedLines(input: NegotiationBuilderInput): NegotiationToolkit['redLines'] {
  const { drivers, give } = input
  const redLines: NegotiationToolkit['redLines'] = []

  const cornerstones = give.filter(a => a.isCornerstone)
  for (const cs of cornerstones) {
    redLines.push({
      id: `rl_cornerstone_${cs.id}`,
      rule: `Do not include ${cs.name || cs.id} in any counter — they are a franchise cornerstone.`,
      because: `${cs.name || cs.id} is flagged as cornerstone${cs.cornerstoneReason ? ` (${cs.cornerstoneReason})` : ''}. Giving up a cornerstone rarely results in net positive value.`,
      driverIds: ['ar_market_mismatch', 'ar_opp_lineup_gain'],
    })
  }

  const marketDriver = drivers.acceptDrivers.find(d => d.id === 'ar_market_mismatch')
  if (marketDriver && marketDriver.direction === 'UP' && marketDriver.strength !== 'WEAK') {
    const pct = Math.round(Math.abs(marketDriver.evidence.raw ?? 0))
    redLines.push({
      id: 'rl_market_ceiling',
      rule: `Don't add more than ${Math.round(pct * 0.5)}% market value; acceptance can be improved by targeting need-fit instead.`,
      because: `You're already sending ~${pct}% more market value than you're receiving. Further adds push into overpay territory.`,
      driverIds: ['ar_market_mismatch'],
    })
  }

  const volDriver = drivers.acceptDrivers.find(d => d.id === 'ar_volatility_delta')
  if (volDriver && volDriver.direction === 'DOWN' && volDriver.strength !== 'WEAK') {
    redLines.push({
      id: 'rl_volatility',
      rule: "Avoid adding another volatile piece; it will drop confidence and acceptance stability.",
      because: `The deal already carries elevated volatility (${Math.abs(volDriver.evidence.raw ?? 0).toFixed(2)} delta). Adding more variance makes the opponent less likely to accept.`,
      driverIds: ['ar_volatility_delta'],
    })
  }

  const userNeeds = input.userNeeds ?? []
  const needPositionsInGive = give.filter(a => a.type === 'PLAYER' && a.pos && userNeeds.includes(a.pos.toUpperCase()))
  for (const np of needPositionsInGive.slice(0, 2)) {
    redLines.push({
      id: `rl_need_${np.id}`,
      rule: `Avoid giving away additional ${np.pos} players — ${np.pos} is already a need on your roster.`,
      because: `Trading ${np.name || np.id} already weakens a position of need. Adding more ${np.pos} in counters deepens the hole.`,
      driverIds: ['ar_need_fit'],
    })
  }

  if (drivers.acceptProbability < 0.15) {
    redLines.push({
      id: 'rl_fundamental',
      rule: 'Consider whether this trade is worth pursuing at all — acceptance probability is very low.',
      because: 'Multiple factors work against acceptance. Significant restructuring may be needed rather than small sweeteners.',
      driverIds: drivers.acceptDrivers.filter(d => d.direction === 'DOWN').map(d => d.id),
    })
  }

  const capsDriver = drivers.acceptDrivers.find(d => d.id === 'ar_caps')
  if (capsDriver && capsDriver.value < -0.3) {
    redLines.push({
      id: 'rl_cap_triggered',
      rule: 'An acceptance cap is active — the opponent sees this as fundamentally unfair.',
      because: capsDriver.evidence.note || 'Hard or soft cap triggered due to large market/need mismatch.',
      driverIds: ['ar_caps', 'ar_market_mismatch'],
    })
  }

  return redLines.slice(0, 6)
}

export function buildNegotiationToolkit(input: NegotiationBuilderInput): NegotiationToolkit {
  const { drivers } = input

  const { theme, driver: themeDriver } = pickTheme(drivers.acceptDrivers)
  const whyFn = THEME_WHY_TEMPLATES[theme]
  const why = whyFn(themeDriver)

  const dmMessages = buildDmMessages(theme, drivers, input.receive)

  const counters = buildCounters(input)
  const sweeteners = buildSweeteners(input)
  const redLines = buildRedLines(input)

  return {
    acceptProb: Math.round(drivers.acceptProbability * 1000) / 1000,
    leverage: { theme, why },
    dmMessages,
    counters,
    sweeteners,
    redLines,
  }
}

export function buildInstantNegotiationToolkit(
  drivers: TradeDriverData,
  give: Asset[],
  receive: Asset[],
): NegotiationToolkit {
  const NO_ROSTER_IDS = new Set(['ar_opp_lineup_gain', 'ar_need_fit'])
  const rosterFiltered = drivers.acceptDrivers.filter(
    d => !(NO_ROSTER_IDS.has(d.id) && d.evidence.note === 'no rosters')
  )
  const { theme, driver: themeDriver } = pickTheme(rosterFiltered)
  const whyFn = THEME_WHY_TEMPLATES[theme]
  const why = whyFn(themeDriver)

  const dmMessages = buildDmMessages(theme, drivers, receive)

  const giveTotal = give.reduce((s, a) => s + (a.marketValue ?? a.value ?? 0), 0)
  const receiveTotal = receive.reduce((s, a) => s + (a.marketValue ?? a.value ?? 0), 0)
  const tradeTotal = Math.max(giveTotal, receiveTotal, 1)

  const counters: NegotiationToolkit['counters'] = []
  const marketDriver = drivers.acceptDrivers.find(d => d.id === 'ar_market_mismatch')
  if (marketDriver && marketDriver.direction === 'DOWN' && marketDriver.strength !== 'WEAK') {
    const gap = Math.round(Math.abs(marketDriver.evidence.raw ?? 0))
    counters.push({
      id: 'counter_instant_market_0',
      description: `Add a late 2nd or 3rd round pick equivalent to close the ~${gap}% market gap.`,
      adjust: {},
      expected: {
        acceptProbDelta: estimateAcceptProbDelta(1500, tradeTotal, drivers.acceptProbability),
        driverChanges: [{ driverId: 'ar_market_mismatch', delta: Math.min(Math.abs(marketDriver.value) * 0.5, 0.4) }],
      },
    })
  }

  const volDriver = drivers.acceptDrivers.find(d => d.id === 'ar_volatility_delta')
  if (volDriver && volDriver.direction === 'DOWN' && volDriver.strength !== 'WEAK' && counters.length < 2) {
    counters.push({
      id: 'counter_instant_vol_0',
      description: 'Swap the most volatile player for a stable veteran at similar value to reduce their risk.',
      adjust: {},
      expected: {
        acceptProbDelta: 0.02,
        driverChanges: [{ driverId: 'ar_volatility_delta', delta: Math.min(Math.abs(volDriver.value) * 0.5, 0.3) }],
      },
    })
  }

  const redLines: NegotiationToolkit['redLines'] = []
  if (marketDriver && marketDriver.direction === 'UP' && marketDriver.strength !== 'WEAK') {
    const pct = Math.round(Math.abs(marketDriver.evidence.raw ?? 0))
    redLines.push({
      id: 'rl_instant_market',
      rule: `Don't add more than ${Math.round(pct * 0.5)}% market value; target need-fit improvements instead.`,
      because: `Already sending ~${pct}% more market value than receiving.`,
      driverIds: ['ar_market_mismatch'],
    })
  }
  if (volDriver && volDriver.direction === 'DOWN' && volDriver.strength !== 'WEAK') {
    redLines.push({
      id: 'rl_instant_vol',
      rule: 'Avoid adding another volatile piece; it will drop acceptance stability.',
      because: `Deal already carries elevated volatility (${Math.abs(volDriver.evidence.raw ?? 0).toFixed(2)} delta).`,
      driverIds: ['ar_volatility_delta'],
    })
  }

  return {
    acceptProb: Math.round(drivers.acceptProbability * 1000) / 1000,
    approximate: true,
    leverage: { theme, why },
    dmMessages,
    counters,
    sweeteners: [],
    redLines,
  }
}

export function negotiationToolkitToLegacy(toolkit: NegotiationToolkit): {
  dmMessages: Array<{ tone: string; hook: string; message: string }>
  counters: Array<{ label: string; ifTheyObject: string; rationale: string; counterTrade: Record<string, unknown> }>
  sweeteners: Array<{ label: string; whenToUse: string; addOn: Record<string, unknown> }>
  redLines: string[]
} {
  const dmMessages = [
    { tone: 'FRIENDLY', hook: toolkit.leverage.why.slice(0, 60), message: toolkit.dmMessages.opener },
    { tone: 'DATA_BACKED', hook: `Based on ${toolkit.leverage.theme.toLowerCase().replace('_', ' ')} analysis`, message: toolkit.dmMessages.rationale },
    { tone: 'CASUAL', hook: 'Quick alternative angle', message: toolkit.dmMessages.fallback },
  ]

  const counters = toolkit.counters.map((c, i) => ({
    label: `Counter ${i + 1}`,
    ifTheyObject: c.description,
    rationale: `Expected +${Math.round(c.expected.acceptProbDelta * 100)}% accept probability. Key driver: ${c.expected.driverChanges[0]?.driverId || 'general'}.`,
    counterTrade: {
      youAdd: (c.adjust.add ?? []).map(a => a.id),
      youRemove: (c.adjust.remove ?? []).map(a => a.id),
    },
  }))

  const sweeteners = toolkit.sweeteners.map(s => {
    const addOn: Record<string, unknown> = {}
    if (s.type === 'FAAB') {
      const match = s.suggestion.match(/\$(\d+)/)
      if (match) addOn.faab = parseInt(match[1])
    } else if (s.type === 'PICK') {
      addOn.pickSwap = { youAddPickId: s.id }
    }
    return {
      label: `${s.target} ${s.type}`,
      whenToUse: s.suggestion,
      addOn,
    }
  })

  const redLines = toolkit.redLines.map(r => r.rule)

  return { dmMessages, counters, sweeteners, redLines }
}

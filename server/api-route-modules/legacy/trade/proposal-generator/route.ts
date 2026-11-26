import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { validateRequestOrigin, forbiddenResponse } from '@/lib/api-auth'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { findPlayerByName, getPickValue, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { getCachedOpponentProfile, formatOpponentForPrompt } from '@/lib/opponent-tendencies'
import { z } from 'zod'
import { autoLogDecision } from '@/lib/decision-log'
import { computeConfidenceRisk, getHistoricalHitRate, type AssetContext } from '@/lib/analytics/confidence-risk-engine'
import { logTradeOfferEvent } from '@/lib/trade-engine/trade-event-logger'
import { createLegacyPackageGrader, legacySessionUserId } from '@/lib/legacy/legacyOneGrade'
import { gradeInputsFromRosterAssets, rankByOneGrade, type LegacyPackageGrade } from '@/lib/legacy/legacyPackageGrade'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/*
 * 🛑 EVERY PROPOSAL THIS GENERATOR SHOWS CARRIES THE ONE TRADE GRADE (2026-09-29), AND THE ONE GRADE
 * NOW CHOOSES WHICH PROPOSALS IT SHOWS (2026-11-26).
 *
 * It used to score its own packages "fairness N/100" on its FantasyCalc totals, run a separate
 * acceptance model, rank the packages by that acceptance, and label them "Slight Edge" / "Fair &
 * Balanced" / "Overpay" — three verdicts, none of them the letter the full analyzer on the same page
 * gives the same deal. After 2026-09-29 it printed the one grade, but still FILTERED its packages on
 * `lib/hybrid-valuation.ts` prices (a build more than 20% off the ask was dropped), so which deals a
 * manager saw was still decided by a second engine.
 *
 * Now: the SEARCH reads the FantasyCalc board this route already loads (DB-first), only to propose
 * candidate packages — several per band. Every candidate is graded by the one grader
 * (`lib/legacy/legacyOneGrade.ts`), from your side, before the AI writes a word, and THAT grade
 * filters and labels them (`rankByOneGrade`): a B is the lighter offer, a C the matched one, a D the
 * stronger one, closest to even within each; an A or F is never proposed. When no candidate can be
 * graded at all (no league, not your league), the search's best build per band comes back carrying
 * the withheld reason — never ranked on the search's values as though those were a grade.
 */
export const PROPOSAL_LABELS = {
  /** Graded B for you: you send a little less than you get back, on the league's values. */
  lighter: 'Lighter offer',
  /** Graded C: even. */
  matched: 'Matched offer',
  /** Graded D for you: you send a little more than you get back. */
  stronger: 'Stronger offer',
} as const

/** Which label each proposable letter earns. Read off the one grade, never off the search's values. */
const LABEL_FOR_LETTER: Record<'B' | 'C' | 'D', string> = {
  B: PROPOSAL_LABELS.lighter,
  C: PROPOSAL_LABELS.matched,
  D: PROPOSAL_LABELS.stronger,
}

const RequestSchema = z.object({
  leagueId: z.string().min(1),
  username: z.string().min(1),
  myRosterId: z.string().or(z.number()),
  targetRosterId: z.string().or(z.number()),
  desiredAssets: z.array(z.object({
    type: z.enum(['player', 'pick']),
    id: z.string().optional(),
    name: z.string(),
    pos: z.string().optional(),
    team: z.string().optional(),
    pickYear: z.number().optional(),
    pickRound: z.number().optional(),
    pickSlot: z.number().optional().nullable(),
    originalOwner: z.string().optional(),
  })),
  myTeam: z.object({
    displayName: z.string(),
    players: z.array(z.object({
      id: z.string(),
      name: z.string(),
      pos: z.string(),
      team: z.string().optional(),
    })),
    draftPicks: z.array(z.object({
      season: z.string(),
      round: z.number(),
      slot: z.number().optional().nullable(),
      originalOwner: z.string().optional(),
      originalRosterId: z.number().optional(),
    })).optional().default([]),
    record: z.object({ wins: z.number(), losses: z.number() }).optional(),
  }),
  targetTeam: z.object({
    displayName: z.string(),
    players: z.array(z.object({
      id: z.string(),
      name: z.string(),
      pos: z.string(),
      team: z.string().optional(),
    })),
    draftPicks: z.array(z.object({
      season: z.string(),
      round: z.number(),
      slot: z.number().optional().nullable(),
      originalOwner: z.string().optional(),
      originalRosterId: z.number().optional(),
    })).optional().default([]),
    record: z.object({ wins: z.number(), losses: z.number() }).optional(),
  }),
  format: z.enum(['dynasty', 'redraft']).default('dynasty'),
  isSuperFlex: z.boolean().default(false),
})

/** A roster asset with the SEARCH value it is matched on. The value chooses candidates; it is never shown or graded on. */
interface PricedRosterAsset {
  type: 'player' | 'pick'
  id?: string
  name: string
  pos?: string
  team?: string
  value: number
  pickYear?: number
  pickRound?: number
  pickSlot?: number | null
  originalOwner?: string
}

type SearchBoard = { fcPlayers: FantasyCalcPlayer[]; isDynasty: boolean; numTeams: number }

/** The search value of a player: his row on the FantasyCalc board, or 0 (the search skips him). */
function searchPlayerValue(board: SearchBoard, name: string, pos?: string, team?: string): number {
  return findPlayerByName(board.fcPlayers, name, { position: pos ?? null, team: team ?? null })?.value ?? 0
}

function searchPickValue(board: SearchBoard, year: number, round: number, slot?: number | null): number {
  return getPickValue(year, round, board.isDynasty, slot ?? undefined, board.numTeams)
}

function searchTeamAssets(team: z.infer<typeof RequestSchema>['myTeam'], board: SearchBoard): PricedRosterAsset[] {
  const players = team.players.map((p) => ({
    type: 'player' as const,
    id: p.id,
    name: p.name,
    pos: p.pos,
    team: p.team,
    value: searchPlayerValue(board, p.name, p.pos, p.team),
  }))
  const picks = (team.draftPicks || []).map((pk) => {
    const year = parseInt(pk.season) || new Date().getFullYear()
    return {
      type: 'pick' as const,
      name: `${year} Round ${pk.round}`,
      value: searchPickValue(board, year, pk.round, pk.slot),
      pickYear: year,
      pickRound: pk.round,
      pickSlot: pk.slot,
      originalOwner: pk.originalOwner,
    }
  })
  return [...players, ...picks]
}

function searchDesiredAssets(assets: z.infer<typeof RequestSchema>['desiredAssets'], board: SearchBoard): PricedRosterAsset[] {
  return assets.map((a) => {
    if (a.type === 'player') {
      return { type: 'player' as const, id: a.id, name: a.name, pos: a.pos, team: a.team, value: searchPlayerValue(board, a.name, a.pos, a.team) }
    }
    const year = a.pickYear || new Date().getFullYear()
    const round = a.pickRound || 1
    return {
      type: 'pick' as const,
      name: `${year} Round ${round}`,
      value: searchPickValue(board, year, round, a.pickSlot),
      pickYear: year,
      pickRound: round,
      pickSlot: a.pickSlot,
      originalOwner: a.originalOwner,
    }
  })
}

/**
 * Up to `limit` packages from your pool whose SEARCH total lands in [low, high], closest to `target`
 * first. Candidates only: the one grade decides which (if any) are shown.
 */
function topCombinations(
  pool: PricedRosterAsset[],
  target: number,
  low: number,
  high: number,
  limit: number,
  maxAssets: number = 5,
): PricedRosterAsset[][] {
  const sorted = [...pool]
    .filter(a => a.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 25)
  const found: Array<{ combo: PricedRosterAsset[]; diff: number }> = []
  for (let size = 1; size <= Math.min(maxAssets, sorted.length); size++) {
    for (const combo of getCombinations(sorted, size)) {
      const total = combo.reduce((s, a) => s + a.value, 0)
      if (total >= low && total <= high) found.push({ combo, diff: Math.abs(total - target) })
    }
  }
  return found.sort((a, b) => a.diff - b.diff).slice(0, limit).map((f) => f.combo)
}

function getCombinations(arr: PricedRosterAsset[], size: number): PricedRosterAsset[][] {
  if (size === 1) return arr.map(a => [a])
  const result: PricedRosterAsset[][] = []
  for (let i = 0; i <= arr.length - size; i++) {
    const rest = getCombinations(arr.slice(i + 1), size - 1)
    for (const combo of rest) {
      result.push([arr[i], ...combo])
    }
    if (result.length > 2000) break
  }
  return result
}

/** The search bands, as a share of what you ask for. Each contributes a few CANDIDATES; the grade picks. */
const SEARCH_BANDS = [
  { label: PROPOSAL_LABELS.lighter, low: 0.8, high: 0.96, target: 0.9 },
  { label: PROPOSAL_LABELS.matched, low: 0.96, high: 1.06, target: 1.0 },
  { label: PROPOSAL_LABELS.stronger, low: 1.06, high: 1.3, target: 1.15 },
] as const
const CANDIDATES_PER_BAND = 4

type Candidate = { searchLabel: string; myOffer: PricedRosterAsset[]; theirOffer: PricedRosterAsset[] }

const comboKey = (combo: PricedRosterAsset[]) => combo.map((a) => `${a.type}:${a.name}`).sort().join('|')

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/proposal-generator", tool: "LegacyTradeProposalGenerator" })(async (req: NextRequest) => {
  // CSRF protection only -- `requireAuthOrOrigin` stood here and authenticated nobody.
  if (!validateRequestOrigin(req)) return forbiddenResponse('Invalid request origin')

  const ip = getClientIp(req)
  const rl = consumeRateLimit({
    scope: 'legacy',
    action: 'trade_proposal',
    ip,
    maxRequests: 10,
    windowMs: 60_000,
    includeIpInKey: true,
  })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before generating more proposals.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  try {
    const body = await req.json()
    const parsed = RequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    /*
     * Paid model call, plus decision-log and trade-offer writes keyed on `username`. Identity is
     * the caller's own linked Sleeper account (no guests: model spend); the body's username is
     * only compared, so a mismatch is a visible 403.
     */
    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: parsed.data.username,
      rateLimit: { action: 'trade_proposal', maxRequests: 10, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response

    /*
     * AF Legacy (`legacy_trade_proposals`): the /af-legacy screen locks this action (Trade Command Center), and that lock was the only one —
     * a direct POST ran the model for anyone. A guest actor (`guest:…`) holds no plan and gets the same lock.
     */
    const plan = await requireFeatureEntitlement({ userId: gate.identity.actorId, userEmail: null, featureId: 'legacy_trade_proposals' })
    if (!plan.ok) return plan.response
    const username = gate.identity.sleeperUsername

    const {
      myTeam,
      targetTeam,
      desiredAssets,
      format,
      isSuperFlex,
    } = parsed.data

    let fcPlayers: FantasyCalcPlayer[] = []
    try {
      fcPlayers = await getFantasyCalcValuesDbFirst({
        isDynasty: format === 'dynasty',
        numQbs: isSuperFlex ? 2 : 1,
        numTeams: 12,
        ppr: 1,
      })
    } catch {
      fcPlayers = []
    }
    const board: SearchBoard = { fcPlayers, isDynasty: format === 'dynasty', numTeams: 12 }

    const pricedMyAssets = searchTeamAssets(myTeam, board)
    const pricedDesired = searchDesiredAssets(desiredAssets, board)
    const pricedTargetAssets = searchTeamAssets(targetTeam, board)

    const desiredTotal = pricedDesired.reduce((s, a) => s + a.value, 0)

    if (desiredTotal === 0) {
      return NextResponse.json({
        error: 'Could not determine value for the selected assets. Try different players or picks.',
      }, { status: 400 })
    }

    const MIN_ASSET_VALUE = 5
    const availablePool = pricedMyAssets.filter(a => a.value >= MIN_ASSET_VALUE)

    // CANDIDATES from the search, a few per band, deduplicated. None of them is shown yet.
    const seen = new Set<string>()
    const candidates: Candidate[] = []
    for (const band of SEARCH_BANDS) {
      for (const combo of topCombinations(availablePool, desiredTotal * band.target, desiredTotal * band.low, desiredTotal * band.high, CANDIDATES_PER_BAND)) {
        const key = comboKey(combo)
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push({ searchLabel: band.label, myOffer: combo, theirOffer: pricedDesired })
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        error: 'Could not find viable trade combinations from your roster. The assets you want may be too valuable or your tradeable assets may not match well.',
      }, { status: 400 })
    }

    /*
     * THE grade of every candidate, from your side (you send `myOffer`), BEFORE the AI is asked
     * anything — so the pitch it writes explains the letter rather than deciding one. One league load.
     */
    const gradeOf = await createLegacyPackageGrader({
      suppliedLeagueId: parsed.data.leagueId,
      userId: await legacySessionUserId(),
      viewerSide: false,
    })
    const gradedCandidates = await Promise.all(
      candidates.map(async (c) => ({ ...c, grade: await gradeOf(gradeInputsFromRosterAssets(c.myOffer), gradeInputsFromRosterAssets(c.theirOffer)) })),
    )

    // The one grade filters, ranks and labels. Nothing graded: the search's best per band, each withheld.
    const { ranked, ungraded } = rankByOneGrade(gradedCandidates)
    const proposals: Array<(typeof gradedCandidates)[number] & { label: string }> = []
    for (const band of SEARCH_BANDS) {
      const pick = ungraded
        ? ranked.find((c) => c.searchLabel === band.label)
        : ranked.find((c) => c.grade.graded && LABEL_FOR_LETTER[c.grade.letter as 'B' | 'C' | 'D'] === band.label)
      if (pick) proposals.push({ ...pick, label: band.label })
    }

    if (proposals.length === 0) {
      return NextResponse.json({
        error: 'None of the packages your roster can build grades within reach of even for this ask, on this league’s values. Try different assets.',
      }, { status: 400 })
    }
    const grades: LegacyPackageGrade[] = proposals.map((p) => p.grade)

    const proposalSummaries = proposals.map((p, i) => {
      const g = grades[i]!
      const myNames = p.myOffer.map(a => `${a.name} (${a.type === 'pick' ? 'Pick' : a.pos || 'Player'})`).join(', ')
      const theirNames = p.theirOffer.map(a => `${a.name} (${a.type === 'pick' ? 'Pick' : a.pos || 'Player'})`).join(', ')
      const verdict = g.graded
        ? `AllFantasy trade grade for ${username}: ${g.letter} ("${g.label}"), on league values ${g.giveValue} sent vs ${g.getValue} received.`
        : `Not graded: ${g.reason}`
      return `${p.label}: You send [${myNames}] for [${theirNames}]. ${verdict}`
    }).join('\n\n')

    const myRosterSummary = pricedMyAssets
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(a => `${a.name} (${a.pos || a.type})`)
      .join(', ')

    const targetRosterSummary = pricedTargetAssets
      .filter(a => a.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 15)
      .map(a => `${a.name} (${a.pos || a.type})`)
      .join(', ')

    let aiExplanations: any = {}

    let opponentAddendum = '';
    try {
      const targetRId = typeof parsed.data.targetRosterId === 'string'
        ? parseInt(parsed.data.targetRosterId)
        : parsed.data.targetRosterId;
      if (targetRId && parsed.data.leagueId) {
        const opponentProfile = await getCachedOpponentProfile(parsed.data.leagueId, targetRId);
        if (opponentProfile && opponentProfile.confidence >= 0.15) {
          opponentAddendum = formatOpponentForPrompt(opponentProfile);
        }
      }
    } catch {}

    try {
      const aiResponse = await openaiChatJson({
        messages: [{
          role: 'system',
          content: `You are AllFantasy's trade proposal analyst. You evaluate fantasy football trade proposals and explain why each option works for both managers.

Your philosophy: Trades are their own ecosystem — both teams should feel they gave up value but got better. Never encourage exploiting managers. Be honest and constructive. League integrity matters more than "winning" a trade.

For each proposal, explain:
1. WHY the other manager would realistically accept this — be honest about weaknesses
2. What makes this proposal attractive to THEM specifically
3. A pitch the user could use when proposing this trade

Each proposal already carries AllFantasy's trade grade. That grade is FINAL and is what the user sees: explain it, never argue for a different one, never give your own letter, fairness score, value estimate or acceptance percentage. If the grade says the trade favors one side, say so — don't dress it up.

Keep explanations concise but insightful (2-3 sentences each). Consider team needs, roster construction, and competitive windows.${opponentAddendum}`
        }, {
          role: 'user',
          content: `Analyze these trade proposals between ${username} (${myTeam.displayName}) and ${targetTeam.displayName}.

${username}'s team (${myTeam.record?.wins ?? '?'}-${myTeam.record?.losses ?? '?'}):
Top assets: ${myRosterSummary}

${targetTeam.displayName} (${targetTeam.record?.wins ?? '?'}-${targetTeam.record?.losses ?? '?'}):
${targetRosterSummary}

PROPOSALS (each with its AllFantasy trade grade):
${proposalSummaries}

For each proposal (${PROPOSAL_LABELS.lighter}, ${PROPOSAL_LABELS.matched}, ${PROPOSAL_LABELS.stronger}), provide:
- "theirPitch": why this trade appeals to ${targetTeam.displayName} (2-3 sentences). Be honest about what the grade says.
- "yourAdvantage": what ${username} gains strategically (1-2 sentences)
- "tradePitch": a message ${username} could send to propose this trade (1-2 sentences, casual tone)

Respond in JSON format:
{
  "proposals": {
    "lighter": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string },
    "matched": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string },
    "stronger": { "theirPitch": string, "yourAdvantage": string, "tradePitch": string }
  }
}`
        }],
        temperature: 0.7,
        maxTokens: 1200,
      })

      const parsed = parseJsonContentFromChatCompletion(aiResponse)
      if (parsed?.proposals) {
        aiExplanations = parsed.proposals
      }
    } catch (e) {
      console.error('AI explanation generation failed:', e)
    }

    const labelToKey: Record<string, string> = {
      [PROPOSAL_LABELS.lighter]: 'lighter',
      [PROPOSAL_LABELS.matched]: 'matched',
      [PROPOSAL_LABELS.stronger]: 'stronger',
    }

    // The builder's values chose the assets; they are not printed — the grade's league values are.
    const shown = (a: PricedRosterAsset) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      pos: a.pos,
      team: a.team,
      pickYear: a.pickYear,
      pickRound: a.pickRound,
    })

    const finalProposals = proposals.map((p, i) => {
      const key = labelToKey[p.label] || ''
      const ai = aiExplanations[key] || {}
      return {
        label: p.label,
        myOffer: p.myOffer.map(shown),
        theirOffer: p.theirOffer.map(shown),
        /** THE trade grade, from your side (you send `myOffer`). Withheld with a reason, never guessed. */
        grade: grades[i]!,
        theirPitch: ai.theirPitch ?? null,
        yourAdvantage: ai.yourAdvantage ?? null,
        tradePitch: ai.tradePitch ?? null,
      }
    })

    // Risk tags read the asked-for assets' SEARCH values (the FantasyCalc board). Not a grade; never shown as one.
    const proposalAssets: AssetContext[] = pricedDesired.map((a: any) => ({
      type: a.type === 'pick' ? 'pick' as const : 'player' as const,
      name: a.name,
      position: a.pos,
      value: a.value,
      pickYear: a.pickYear,
      pickRound: a.pickRound,
    }))

    const hitRate = await getHistoricalHitRate(username, 'trade_proposal', parsed.data.leagueId).catch(() => null)

    const crResult = computeConfidenceRisk({
      category: 'trade_proposal',
      userId: username,
      leagueId: parsed.data.leagueId,
      assets: proposalAssets,
      dataCompleteness: {
        hasHistoricalData: true,
        dataPointCount: pricedDesired.length * 15,
        playerCoverage: 0.9,
        isCommonScenario: true,
      },
      tradeContext: {
        assetCount: pricedDesired.length,
      },
      historicalHitRate: hitRate,
    })

    autoLogDecision({
      userId: username,
      leagueId: parsed.data.leagueId,
      decisionType: 'trade_proposal',
      aiRecommendation: {
        summary: `Trade Proposals: ${finalProposals.length} generated`,
        proposalCount: finalProposals.length,
        desiredTotal,
      },
      confidenceScore: crResult.confidenceScore01,
      riskProfile: crResult.riskProfile,
      contextSnapshot: { leagueId: parsed.data.leagueId },
      confidenceRisk: crResult,
    })

    proposals.forEach((p, i) => {
      const g = grades[i]!
      logTradeOfferEvent({
        leagueId: parsed.data.leagueId,
        senderUserId: username,
        opponentUserId: String(parsed.data.targetRosterId),
        assetsGiven: p.myOffer.map((a) => ({ name: a.name, value: a.value })),
        assetsReceived: p.theirOffer.map((a) => ({ name: a.name, value: a.value })),
        acceptProb: null,
        verdict: g.graded ? g.letter : null,
        confidenceScore: crResult.confidenceScore01,
        mode: 'PROPOSAL_GENERATOR',
        isSuperFlex: parsed.data.isSuperFlex ?? null,
        leagueFormat: parsed.data.format ?? null,
      }).catch(() => {})
    })

    return NextResponse.json({
      success: true,
      proposals: finalProposals,
      opponentTendencies: null, // Private inputs may inform internal calculations, never the public dossier.
      confidenceRisk: {
        confidence: crResult.numericConfidence,
        level: crResult.confidenceLevel,
        volatility: crResult.volatilityLevel,
        riskProfile: crResult.riskProfile,
        riskTags: crResult.riskTags,
        explanation: crResult.explanation,
      },
    })

  } catch (e) {
    console.error('proposal-generator error:', e)
    return NextResponse.json({ error: 'Failed to generate trade proposals' }, { status: 500 })
  }
})

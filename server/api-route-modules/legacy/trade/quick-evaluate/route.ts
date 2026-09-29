import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { computeBestLineupBySlot, type SlotAssignment } from '@/lib/trade-engine/trade-engine'
import { computeManagerTendencies, type ManagerTendencyProfile } from '@/lib/trade-engine/manager-tendency-engine'
import type { Asset } from '@/lib/trade-engine/types'
import { gradeInputsFromLegacyAssets } from '@/lib/decision-os/trade/receiptViews'
import { createLegacyPackageGrader, legacySessionUserId } from '@/lib/legacy/legacyOneGrade'

export const dynamic = 'force-dynamic'

/*
 * 🛑 THE TRADE HUB'S LIVE PREVIEW SHOWS THE ONE TRADE GRADE (2026-09-29).
 *
 * This route used to run `computeTradeDrivers` on FantasyCalc values (re-priced by a Grok news
 * multiplier) and return its own verdict, fairness delta, 4-factor score, confidence and an
 * acceptance rate — plus "sweeteners" ranked by how much they moved that acceptance rate. None of it
 * was the letter the full analyzer one button away gives the same deal, and the acceptance rate was
 * a model's guess printed as a percentage.
 *
 * Now the deal is graded by the one grader (`lib/legacy/legacyOneGrade.ts`), with EXACTLY the full
 * analyzer's orientation and inputs: the graded side receives `assetsYouGet` (the analyzer's
 * `assetsA`) and sends `assetsYouGive` (`assetsB`), players by name, `viewerSide: false`. A grade that
 * cannot be taken is withheld with its reason. What stays is what is not a verdict: the lineup slot
 * map and the opponent's trade tendencies.
 */

interface QuickAsset {
  type: 'player' | 'pick' | 'faab'
  name?: string
  pos?: string
  team?: string
  id?: string
  year?: number
  round?: number
  pickNumber?: number
  amount?: number
}

const fcCache: { at: number; data: FantasyCalcPlayer[] | null; sf: boolean } = { at: 0, data: null, sf: false }
const FC_TTL = 10 * 60 * 1000

async function getFcPlayers(isSF: boolean, numTeams: number): Promise<FantasyCalcPlayer[]> {
  const now = Date.now()
  if (fcCache.data && now - fcCache.at < FC_TTL && fcCache.sf === isSF) return fcCache.data
  try {
    const players = await getFantasyCalcValuesDbFirst({
      isDynasty: true,
      numQbs: isSF ? 2 : 1,
      numTeams,
      ppr: 1,
    })
    fcCache.at = now
    fcCache.data = players
    fcCache.sf = isSF
    return players
  } catch {
    return fcCache.data || []
  }
}

function findFcPlayer(fcPlayers: FantasyCalcPlayer[], name: string): FantasyCalcPlayer | null {
  const lower = name.toLowerCase().trim()
  return fcPlayers.find(p => {
    const pName = (p.player?.name || '').toLowerCase().trim()
    return pName === lower
  }) || fcPlayers.find(p => {
    const pName = (p.player?.name || '').toLowerCase().trim()
    return pName.includes(lower) || lower.includes(pName)
  }) || null
}

/** Only for the lineup slot map: which of your players start before and after. Never a grade. */
function rosterToAssets(players: any[], fcPlayers: FantasyCalcPlayer[], starterIds?: string[]): Asset[] {
  const starterSet = new Set(starterIds || [])
  return players
    .filter((p: any) => p.name && p.pos)
    .map((p: any) => {
      const fc = findFcPlayer(fcPlayers, p.name)
      const value = fc?.value || 0
      return {
        id: p.id || p.name,
        type: 'PLAYER' as const,
        value,
        marketValue: value,
        name: p.name,
        pos: (p.pos || '').toUpperCase(),
        team: p.team,
        slot: starterSet.has(p.id) ? 'Starter' as const : 'Bench' as const,
      }
    })
}

/** The live preview's assets in the full analyzer's asset shape, so both hand the grader the same inputs. */
export function quickAssetsAsLegacy(assets: ReadonlyArray<QuickAsset>): Parameters<typeof gradeInputsFromLegacyAssets>[0] {
  const out: Array<Parameters<typeof gradeInputsFromLegacyAssets>[0][number]> = []
  for (const a of assets) {
    if (a?.type === 'player') out.push({ type: 'player', player: { name: a.name ?? null } })
    else if (a?.type === 'pick') out.push({ type: 'pick', pick: { year: a.year ?? null, round: a.round ?? null, pickNumber: a.pickNumber ?? null } })
    else if (a?.type === 'faab') out.push({ type: 'faab', faab: { amount: a.amount ?? null } })
  }
  return out
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade/quick-evaluate", tool: "LegacyTradeQuickEvaluate" })(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const {
      assetsYouGet = [],
      assetsYouGive = [],
      yourRoster = [],
      yourStarters = [],
      rosterPositions = [],
      numTeams = 12,
      leagueId,
      opponentUsername,
      leagueContext,
    } = body

    const getAssets = quickAssetsAsLegacy(Array.isArray(assetsYouGet) ? assetsYouGet : [])
    const giveAssets = quickAssetsAsLegacy(Array.isArray(assetsYouGive) ? assetsYouGive : [])
    if (getAssets.length === 0 && giveAssets.length === 0) {
      return NextResponse.json({ error: 'No assets provided' }, { status: 400 })
    }

    const teams = Number(numTeams) || 12
    const grade = await (
      await createLegacyPackageGrader({
        suppliedLeagueId: typeof leagueId === 'string' ? leagueId : null,
        userId: await legacySessionUserId(),
        viewerSide: false,
      })
    )(gradeInputsFromLegacyAssets(giveAssets, teams), gradeInputsFromLegacyAssets(getAssets, teams))

    const isSF = leagueContext?.settings?.qbFormat === 'superflex' || leagueContext?.settings?.qbFormat === '2qb' || (rosterPositions.some((p: string) =>
      p === 'SUPER_FLEX' || p === 'QB'
    ) && rosterPositions.filter((p: string) => p === 'SUPER_FLEX' || p === 'QB').length >= 2)

    let slotMap: { before: SlotAssignment[]; after: SlotAssignment[]; deltas: { slot: string; beforePlayer?: string; afterPlayer?: string; beforePPG: number; afterPPG: number; delta: number }[] } | null = null
    if (rosterPositions.length > 0 && Array.isArray(yourRoster) && yourRoster.length > 0) {
      const fcPlayers = await getFcPlayers(isSF, teams)
      const yourRosterAssets = rosterToAssets(yourRoster, fcPlayers, yourStarters)
      const incoming = rosterToAssets(
        (assetsYouGet as QuickAsset[]).filter(a => a?.type === 'player' && a.name && a.pos).map(a => ({ id: a.id || a.name, name: a.name, pos: a.pos, team: a.team })),
        fcPlayers,
      )
      const outgoing = new Set((assetsYouGive as QuickAsset[]).filter(a => a?.type === 'player').map(a => String(a.id || a.name)))
      const yourRosterAfter = [...yourRosterAssets.filter(a => !outgoing.has(String(a.id))), ...incoming]
      const before = computeBestLineupBySlot(yourRosterAssets, rosterPositions)
      const after = computeBestLineupBySlot(yourRosterAfter, rosterPositions)
      const deltas = before.map((b, i) => ({
        slot: b.slot,
        beforePlayer: b.playerName,
        afterPlayer: after[i]?.playerName,
        beforePPG: Math.round(b.ppg * 100) / 100,
        afterPPG: Math.round((after[i]?.ppg ?? 0) * 100) / 100,
        delta: Math.round(((after[i]?.ppg ?? 0) - b.ppg) * 100) / 100,
      }))
      slotMap = { before, after, deltas }
    }

    let opponentTendency: ManagerTendencyProfile | null = null
    if (opponentUsername && leagueId) {
      try {
        opponentTendency = await computeManagerTendencies(opponentUsername, leagueId)
      } catch { /* ignore */ }
    }

    return NextResponse.json({
      success: true,
      /** THE grade, for the side that receives `assetsYouGet`. Withheld with a reason, never guessed. */
      grade,
      slotMap,
      opponentTendency: opponentTendency ? {
        positionBias: opponentTendency.positionBias,
        overpayThreshold: opponentTendency.overpayThreshold,
        riskTolerance: opponentTendency.riskTolerance,
        consolidationBias: opponentTendency.consolidationBias,
        fairnessTolerance: opponentTendency.fairnessTolerance,
        starterPremium: opponentTendency.starterPremium,
        sampleSize: opponentTendency.sampleSize,
      } : null,
    })
  } catch (e) {
    console.error('quick-evaluate error:', e)
    return NextResponse.json({ error: 'Failed to evaluate trade' }, { status: 500 })
  }
})

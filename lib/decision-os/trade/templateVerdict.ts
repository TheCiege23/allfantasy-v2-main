import type { ExplanationPacket } from './explanationPacket'
import type { TradeVerdict } from './tradeVerdict'

/**
 * THE FALLBACK EXPLANATION — deterministic, built from the packet alone (design: "On failure, retry
 * once, then fall back to a template"). Used when the grade is withheld, when AI spend is off, when
 * every provider fails, and when the model's answer fails validation twice.
 *
 * 🛑 IT MUST PASS THE SAME VALIDATOR AS THE MODEL. A fallback that states a number the packet does
 * not hold would be the exact defect the validator exists to stop, shipped by the code that is
 * supposed to be the safe path. `__tests__/decision-os/trade-explanation.test.ts` runs every golden
 * packet through both.
 *
 * Numbers are printed the way the validator compares them: whole league values, one decimal of points.
 */

const oneDecimal = (n: number) => (Math.round(Math.abs(n) * 10) / 10).toFixed(1)
const whole = (n: number) => String(Math.round(Math.abs(n)))

function lineupReason(p: ExplanationPacket): TradeVerdict['reasons'][number] | null {
  const a = p.lineup.teamA
  if (a?.startingPointsDelta != null) {
    const d = a.startingPointsDelta
    const dir = Math.abs(d) < 0.05 ? 'does not change' : d > 0 ? `rises by ${oneDecimal(d)} points` : `falls by ${oneDecimal(d)} points`
    return {
      text: `${p.teams.teamA}'s projected starting lineup ${dir}${a.week != null ? ` in week ${a.week}` : ''}.`,
      evidence: ['lineup.teamA.startingPointsDelta'],
    }
  }
  const o = p.seasonOutlook
  if (o) {
    const d = o.teamA.lineupDeltaPerWeek
    const dir = Math.abs(d) < 0.05 ? 'is unchanged' : d > 0 ? `gains ${oneDecimal(d)} points a week` : `loses ${oneDecimal(d)} points a week`
    return {
      text: `Over the rest of the season, ${p.teams.teamA}'s starting lineup ${dir}.`,
      evidence: ['seasonOutlook.teamA.lineupDeltaPerWeek'],
    }
  }
  return null
}

function topAsset(p: ExplanationPacket): TradeVerdict['reasons'][number] | null {
  const all = [
    ...p.assets.teamAReceives.map((a, i) => ({ a, path: `assets.teamAReceives[${i}].leagueValue`, to: p.teams.teamA })),
    ...p.assets.teamASends.map((a, i) => ({ a, path: `assets.teamASends[${i}].leagueValue`, to: p.teams.teamB })),
  ].filter((x) => x.a.leagueValue != null)
  if (all.length === 0) return null
  const best = all.reduce((m, x) => (x.a.leagueValue! > m.a.leagueValue! ? x : m))
  return {
    text: `The biggest single piece is ${best.a.name}, at ${whole(best.a.leagueValue!)} in league value, going to ${best.to}.`,
    evidence: [best.path],
  }
}

export function templateVerdict(p: ExplanationPacket): TradeVerdict {
  const risks = p.riskCandidates.slice(0, 2).map((r) => {
    const i = r.indexOf(': ')
    const body = i === -1 ? r : r.slice(i + 2)
    return body.charAt(0).toUpperCase() + body.slice(1) + '.'
  })

  if (!p.graded || !p.grade || !p.values || !p.fixed.grades) {
    const reasons: TradeVerdict['reasons'] = [
      { text: `This trade is not graded: ${p.withheldReason ?? 'it could not be priced.'}`, evidence: ['withheldReason'] },
    ]
    if (p.unpriceable.length > 0) {
      reasons.push({ text: `Could not be valued: ${p.unpriceable.join(', ')}.`, evidence: ['unpriceable'] })
    }
    return {
      verdict: null,
      headline: 'Not graded — see why below.',
      grades: [],
      reasons,
      risks,
      confidence: p.fixed.confidence,
    }
  }

  const reasons: TradeVerdict['reasons'] = []
  const lineup = lineupReason(p)
  if (lineup) reasons.push(lineup)
  reasons.push({
    text: `${p.teams.teamA} receives ${whole(p.values.teamAReceives)} and sends ${whole(p.values.teamASends)} in league value${p.basis ? ` (${p.basis})` : ''}.`,
    evidence: ['values.teamAReceives', 'values.teamASends'],
  })
  const top = topAsset(p)
  if (top) reasons.push(top)
  if (reasons.length < 2) {
    reasons.push({ text: p.grade.label, evidence: ['grade.label'] })
  }

  const letter = p.fixed.grades.teamA
  const headline = `${p.teams.teamA} gets ${letter === 'A' || letter === 'F' ? 'an' : 'a'} ${letter} grade: ${p.grade.recommendation}`
  return {
    verdict: p.fixed.verdict,
    headline: headline.length <= 280 ? headline : `${p.teams.teamA}: ${p.grade.label}`.slice(0, 280),
    grades: [
      { teamId: 'teamA', grade: p.fixed.grades.teamA },
      { teamId: 'teamB', grade: p.fixed.grades.teamB },
    ],
    reasons: reasons.slice(0, 4),
    risks,
    confidence: p.fixed.confidence,
  }
}

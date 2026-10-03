import type { TradeGradeView } from './tradeGrade'
import type { VisualImpactResult } from './loadVisualImpact'
import { tradeEvidence, tradePackageReview, tradeValueSensitivity } from './tradeEvidence'
import { projectedLetterFor } from '@/lib/trade-intel/gradeScale'
import type { PackageCost } from './packageCost'

export function counterDecision(args:{before:TradeGradeView;after:TradeGradeView;addTo:'give'|'get';cost?:PackageCost|null}) {
  if (!args.before.graded || !args.after.graded) return 'This counter needs a complete new evaluation.'
  const before=Math.abs(args.before.getValue-args.before.giveValue),after=Math.abs(args.after.getValue-args.after.giveValue)
  const net=args.addTo==='get'?1:-1
  const capacity=args.cost?.capacity
  const drops=capacity!=null&&args.cost?Math.max(0,args.cost.activeAfter+net-capacity):null
  return `One added player reduces the quoted gap from ${before.toLocaleString()} to ${after.toLocaleString()}. ${drops==null?'Roster capacity is unverified.':`If that player uses an active slot, this counter needs ${drops} drop${drops===1?'':'s'} under the recorded capacity.`} Add it and analyze again to check its starting-lineup and drop costs. This is a shortlisted counter, not proof of the smallest possible fair change or partner acceptance.`
}

/** Explain observed price and roster signals without inventing risks or acceptance odds. */
export function decisionSummary(args: { grade: TradeGradeView; evaluatedAt?: string | null; gaps?: readonly string[]; visual?: VisualImpactResult | null; generic?: boolean }) {
  const { grade, visual, generic } = args
  if (!grade.graded) return { headline: 'More evidence needed', accept: [], hesitate: [grade.reason], change: ['Resolve the missing evidence and run the evaluation again.'] }
  const who = generic ? 'Team A' : 'Your team'
  const accept: string[] = [], hesitate: string[] = [], change: string[] = []
  const evidence = tradeEvidence(grade.lines, args.evaluatedAt ?? '', args.gaps)
  if (grade.percentDiff >= 0) accept.push(`${who} receives ${grade.getValue.toLocaleString()} in quoted value for ${grade.giveValue.toLocaleString()} sent (${grade.percentDiff}% signed gap).`)
  else hesitate.push(`${who} sends ${Math.round(grade.giveValue - grade.getValue).toLocaleString()} more in quoted value than it receives.`)
  const impact = visual?.impact
  if (!generic && impact && !impact.blockedReason && impact.startingPointsDelta != null && Number.isFinite(impact.startingPointsDelta)) {
    const delta = impact.startingPointsDelta
    const line = Math.abs(delta) < .05 ? `The optimal week ${impact.week ?? '?'} starting lineup is unchanged.` : `The optimal week ${impact.week ?? '?'} starting lineup projects ${Math.abs(delta).toFixed(1)} points ${delta > 0 ? 'higher' : 'lower'} under league scoring.`
    ;(delta > .05 ? accept : hesitate).push(line)
    const depthLoss = impact.depthChanges.filter(row => row.rosteredAfter < row.rosteredBefore)
    if (depthLoss.length) hesitate.push(`Roster depth decreases at ${depthLoss.map(row => row.position).join(', ')}.`)
    if (impact.unpricedExcluded) hesitate.push(`${impact.unpricedExcluded} roster players lack projections and were excluded.`)
  } else hesitate.push(generic ? 'No league roster, scoring, or lineup effect is evaluated here.' : `Lineup fit is unverified: ${visual?.reason ?? impact?.blockedReason ?? 'weekly roster projections unavailable'}`)
  const pack = tradePackageReview(grade.lines)
  if (pack) hesitate.push(`${who} sends ${pack.givePlayers} players and receives ${pack.getPlayers}. ${pack.netPlayerSlots>0?'Extra players need usable roster space.':'Check replacement starters and depth.'}`)
  if (visual?.rostersStale) change.push('Sync the league and reassess with the updated roster.')
  if (evidence.issues.length) {
    hesitate.unshift(evidence.issues[0])
    change.push('Refresh or verify flagged asset quotes; outdated or estimated prices can change the value conclusion.')
  }
  if (visual?.packageCost?.requiredDrops) hesitate.unshift(`${visual.packageCost.requiredDrops} active-roster drops are needed under the recorded capacity. The lineup projection is before those drops.`)
  if (grade.percentDiff < 0) change.push(`To match the outgoing quoted total, ask for ${Math.round(grade.giveValue - grade.getValue).toLocaleString()} more value or remove that amount from your side. Any edited package needs a new evaluation.`)
  const sensitivity = tradeValueSensitivity(grade.giveValue, grade.getValue, 10)
  if (sensitivity) {
    const low = projectedLetterFor({ percentDiff: sensitivity.low, hasSignal: true })
    const high = projectedLetterFor({ percentDiff: sensitivity.high, hasSignal: true })
    change.push(`Opposing ±10% price stress gives ${low} to ${high}. This is a hypothetical sensitivity check, not a confidence interval.`)
  }
  change.push(generic ? 'Connect a league to assess starting slots, usable depth, and roster limits.' : 'Review injuries, future value, and any required drops before acting; those costs are not deducted from the price letter.')
  if (!accept.length) accept.push('A roster benefit could justify the price cost, but the recorded evidence does not establish that benefit.')
  if (!hesitate.length) hesitate.push('The price signal does not establish injury safety, future production, or partner acceptance.')
  return { headline: grade.percentDiff >= 10 ? 'Value advantage — confirm team fit' : grade.percentDiff <= -10 ? 'Price disadvantage — review the package' : 'Similar quoted value — team fit matters', accept, hesitate, change }
}

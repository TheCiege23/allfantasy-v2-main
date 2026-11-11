import type { TradeGradeView } from './tradeGrade'
import type { VisualImpactResult } from './loadVisualImpact'
import { tradeEvidence, tradePackageReview, tradeValueSensitivity } from './tradeEvidence'
import { projectedLetterFor } from '@/lib/trade-intel/gradeScale'
import type { PackageCost } from './packageCost'
import { getIntlLocale, type LanguageCode } from '@/lib/i18n/constants'

export function counterDecision(args:{before:TradeGradeView;after:TradeGradeView;addTo:'give'|'get';cost?:PackageCost|null;language?:LanguageCode}) {
  const locale=getIntlLocale(args.language??'en')
  if (!args.before.graded || !args.after.graded) return 'Grade this counteroffer again to see what it changes.'
  const before=Math.abs(args.before.getValue-args.before.giveValue),after=Math.abs(args.after.getValue-args.after.giveValue)
  const net=args.addTo==='get'?1:-1
  const capacity=args.cost?.capacity
  const drops=capacity!=null&&args.cost?Math.max(0,args.cost.activeAfter+net-capacity):null
  return `Adding this player cuts the value gap from ${before.toLocaleString(locale)} to ${after.toLocaleString(locale)}. ${drops==null?'We couldn’t check your roster space.':drops===0?'You have room for this player.':`You’d need to drop ${drops} player${drops===1?'':'s'} to make room.`} Add it and grade again to see the effect on your lineup.`
}

/** Explain observed price and roster signals without inventing risks or acceptance odds. */
export function decisionSummary(args: { grade: TradeGradeView; evaluatedAt?: string | null; gaps?: readonly string[]; visual?: VisualImpactResult | null; generic?: boolean;language?:LanguageCode }) {
  const { grade, visual, generic } = args
  if (!grade.graded && grade.divisionImpacts) return { headline: 'Campus and Canton impact', accept: [], hesitate: [grade.reason], change: [] }
  if (!grade.graded) return { headline: 'Not enough values to grade', accept: [], hesitate: [grade.reason], change: ['Fill in the missing values and grade it again.'] }
  const giveValue=generic?grade.giveMarket:grade.giveValue,getValue=generic?grade.getMarket:grade.getValue
  if (![giveValue,getValue].every(value=>Number.isFinite(value)&&value>0)) return {headline:'Not enough values to grade',accept:[],hesitate:['Some values are missing. Grade it again before you rely on this.'],change:['Fill in the missing values and grade it again.']}
  const locale=getIntlLocale(args.language??'en')
  const who = generic ? 'Team A' : 'Your team'
  const accept: string[] = [], hesitate: string[] = [], change: string[] = []
  const evidence = tradeEvidence(grade.lines, args.evaluatedAt ?? '', args.gaps)
  if (grade.percentDiff >= 0) accept.push(`${who} gets ${getValue.toLocaleString(locale)} in value and sends ${giveValue.toLocaleString(locale)} (${grade.percentDiff}% more).`)
  else hesitate.push(`${who} sends ${Math.round(giveValue - getValue).toLocaleString(locale)} more in value than it gets back.`)
  const impact = visual?.impact
  if (!generic && impact && !impact.blockedReason && impact.startingPointsDelta != null && Number.isFinite(impact.startingPointsDelta)) {
    const delta = impact.startingPointsDelta
    const line = Math.abs(delta) < .05 ? `Your best week ${impact.week ?? '?'} lineup stays the same.` : `Your best week ${impact.week ?? '?'} lineup scores about ${Math.abs(delta).toLocaleString(locale,{minimumFractionDigits:1,maximumFractionDigits:1})} points ${delta > 0 ? 'more' : 'less'}.`
    ;(delta > .05 ? accept : hesitate).push(line)
    const depthLoss = impact.depthChanges.filter(row => row.rosteredAfter < row.rosteredBefore)
    if (depthLoss.length) hesitate.push(`You lose depth at ${depthLoss.map(row => row.position).join(', ')}.`)
    if (impact.unpricedExcluded) hesitate.push(`${impact.unpricedExcluded} of your players have no projection, so they were left out.`)
  } else hesitate.push(generic ? 'This doesn’t check league rosters, scoring, or lineups.' : `We couldn’t check your lineup: ${visual?.reason ?? impact?.blockedReason ?? 'weekly roster projections unavailable'}`)
  const pack = tradePackageReview(grade.lines)
  if (pack) hesitate.push(`${who} sends ${pack.givePlayers} players and gets ${pack.getPlayers}. ${pack.netPlayerSlots>0?'The extra players need open roster spots.':'Make sure the starters sent out can be replaced.'}`)
  if (visual?.rostersStale) change.push('Sync your league and grade it again with current rosters.')
  if (evidence.issues.length) {
    hesitate.unshift(evidence.issues[0])
    change.push('Some values are old or estimated. Fresher values could change the grade.')
  }
  if (visual?.packageCost?.requiredDrops) hesitate.unshift(`You’d need to drop ${visual.packageCost.requiredDrops} players to fit this trade. The lineup numbers don’t include those drops yet.`)
  if (grade.percentDiff < 0) change.push(`To make it even, ask for about ${Math.round(giveValue - getValue).toLocaleString(locale)} more in value or send that much less. Grade it again after any change.`)
  const sensitivity = tradeValueSensitivity(giveValue, getValue, 10)
  if (sensitivity) {
    const low = projectedLetterFor({ percentDiff: sensitivity.low, hasSignal: true })
    const high = projectedLetterFor({ percentDiff: sensitivity.high, hasSignal: true })
    change.push(`If values shift 10% either way, the grade ranges from ${low} to ${high}.`)
  }
  change.push(generic ? 'Connect a league to check lineups, depth, and roster limits.' : 'Before you accept, check injuries, long-term value, and anyone you’d have to drop. The grade doesn’t include those.')
  if (!accept.length) accept.push('It could still help your roster, but we don’t see clear proof of that.')
  if (!hesitate.length) hesitate.push('The grade can’t tell you about injuries, future production, or whether they’ll accept.')
  return { headline: grade.percentDiff >= 10 ? 'You get more value — check it fits your team' : grade.percentDiff <= -10 ? 'You give up more value — rework the deal' : 'About even — decide on team fit', accept, hesitate, change }
}

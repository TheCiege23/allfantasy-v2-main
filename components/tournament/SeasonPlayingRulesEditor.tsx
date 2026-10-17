'use client'

import type { SeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { assessSeasonRules, defaultSeasonRules, type SeasonRules } from '@/lib/tournament/seasonRules'

const field = 'min-h-11 w-full rounded-xl border border-white/20 bg-slate-900 px-3 py-2 text-white'
const utcInput = (value: string) => value ? new Date(value).toISOString().slice(0, 16) : ''
const utcValue = (value: string) => value ? new Date(value + ':00Z').toISOString() : ''

export function SeasonPlayingRulesEditor({ config, onChange }: { config: SeasonBlueprint; onChange: (rules: SeasonRules) => void }) {
  const r = config.rules
  const readiness = assessSeasonRules(config)
  const initialize = () => {
    const rules = defaultSeasonRules(config.sport, config.scoring)
    rules.calendar.periods = Array.from({ length: config.finalWeek - config.startWeek + 1 }, (_, i) => ({ number: config.startWeek + i, startsAt: '', endsAt: '', finalizesAt: '' }))
    rules.calendar.drafts = [1, 2, 3].map(stage => ({ stage, startsAt: '', completeBy: '' }))
    onChange(rules)
  }
  const update = <K extends keyof SeasonRules>(key: K, value: SeasonRules[K]) => r && onChange({ ...r, [key]: value })
  return <section className="space-y-4 rounded-xl border border-cyan-300/20 p-3 sm:p-4" aria-label="Playing rules and calendar">
    <h3 className="text-lg font-semibold">Playing rules and season calendar</h3>
    <p className="text-sm text-slate-300">Save your work as a draft while completing the contract. Rule readiness is separate from live launch readiness.</p>
    {!r ? <button type="button" className="min-h-11 rounded-xl border border-cyan-300/40 px-3" onClick={initialize}>Add playing rules and calendar</button> : <>
      {(r.sport !== config.sport || r.scoringPreset !== config.scoring) && <p className="text-amber-200">The scoring preset changed. Reset playing rules to use the new preset.</p>}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Scoring weights and positional roster</summary>
        <p className="my-3 text-sm text-slate-400">Weights are copied from AllFantasy defaults when added. All pools use this saved snapshot; editing it makes a custom preset.</p>
        <div className="grid gap-3 sm:grid-cols-2">{r.weights.map((weight, i) => <label key={weight.statKey} className="text-sm">{weight.statKey.replaceAll('_', ' ')}<input className={field} type="number" min={-100} max={100} step="any" value={weight.points} onChange={e => update('weights', r.weights.map((w, index) => index === i ? { ...w, points: Number(e.target.value) } : w))} /></label>)}</div>
        <h4 className="my-3 font-medium">Starter positions</h4>
        <div className="grid grid-cols-2 gap-3">{r.starters.map((slot, i) => <label key={slot.position}>{slot.position} starters<input className={field} type="number" min={0} max={10} value={slot.count} onChange={e => update('starters', r.starters.map((s, index) => index === i ? { ...s, count: Number(e.target.value) } : s))} /></label>)}
          <label>Bench slots<input className={field} type="number" min={0} max={19} value={r.bench} onChange={e => update('bench', Number(e.target.value))} /></label>
          <label>Additional IR slots<input className={field} type="number" min={0} max={5} value={r.ir} onChange={e => update('ir', Number(e.target.value))} /></label>
        </div>
        <p className="mt-2 text-sm text-slate-400">Starters + bench must match total roster slots above. IR is additional and is not drafted.</p>
      </details>
      {!r.draftPolicy ? <button type="button" className="min-h-11 rounded-xl border border-cyan-300/40 px-3" onClick={() => update('draftPolicy', defaultSeasonRules(config.sport, config.scoring).draftPolicy)}>Add draft order and auction terms</button> : <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Draft order, clocks and auction terms</summary>
        <p className="my-2 text-sm text-slate-300">Opening draft order uses an audited shuffle. Later draft order follows previous-stage seed, best seed first within each league. Autodraft selects the best available player who fits a legal roster. Auction nomination order follows the same order and skips completed rosters. When the nomination clock expires, the best available legal player opens at a one-dollar bid for the nominator. Manual nominations without bids return to the pool when their clock expires.</p>
        <label className="block">Draft pick clock (seconds)<input className={field} type="number" min={10} max={300} value={r.draftPolicy.pickClockSeconds} onChange={e => update('draftPolicy', { ...r.draftPolicy!, pickClockSeconds: Number(e.target.value) })} /></label>
        <label className="block">Auction budget per team<input className={field} type="number" min={10} max={1000} value={r.draftPolicy.auctionBudget} onChange={e => update('draftPolicy', { ...r.draftPolicy!, auctionBudget: Number(e.target.value) })} /></label>
        <label className="block">Auction nomination clock (seconds)<input className={field} type="number" min={10} max={120} value={r.draftPolicy.nominationClockSeconds} onChange={e => update('draftPolicy', { ...r.draftPolicy!, nominationClockSeconds: Number(e.target.value) })} /></label>
        <label className="block">Auction bid extension (seconds)<input className={field} type="number" min={5} max={60} value={r.draftPolicy.bidExtensionSeconds} onChange={e => update('draftPolicy', { ...r.draftPolicy!, bidExtensionSeconds: Number(e.target.value) })} /></label>
        <p className="text-sm text-slate-400">Minimum auction bid: one dollar. The draft engine will enforce these published settings when leagues are provisioned.</p>
      </details>}
      {!r.transactionPolicy ? <button type="button" className="min-h-11 rounded-xl border border-cyan-300/40 px-3" onClick={() => update('transactionPolicy', defaultSeasonRules(config.sport, config.scoring).transactionPolicy)}>Add IR and waiver transaction policy</button> : <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">IR and waiver transaction policy</summary>
        <p className="my-2 text-sm text-slate-300">Eligible injury statuses. Questionable and doubtful players do not qualify.</p>
        {(['IR', 'OUT', 'INJURED'] as const).map(status => <label key={status} className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={r.transactionPolicy!.irEligibleStatuses.includes(status)} onChange={e => update('transactionPolicy', { ...r.transactionPolicy!, irEligibleStatuses: e.target.checked ? [...r.transactionPolicy!.irEligibleStatuses, status] : r.transactionPolicy!.irEligibleStatuses.filter(s => s !== status) })} />Allow {status} in IR</label>)}
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={r.transactionPolicy.zeroDollarBids} onChange={e => update('transactionPolicy', { ...r.transactionPolicy!, zeroDollarBids: e.target.checked })} />Allow zero-dollar FAAB bids</label>
        <p className="mt-2 text-sm text-slate-400">Ineligible IR blocks new adds until corrected. Waiver priority starts in reverse draft order; successful claims move the winner to the back. Equal FAAB bids use rolling priority. Budget and priority reset with each draft. No final-stage trades.</p>
      </details>}
      <label className="block">Lineup lock<select className={field} value={r.lineupLock} onChange={e => update('lineupLock', e.target.value as SeasonRules['lineupLock'])}><option value="individual_game">Each player's game starts</option><option value="period_start">Start of scoring period</option></select></label>
      {config.sport === 'NBA' && <div className="space-y-3">
        <label className="block">NBA counted games<select className={field} value={r.nbaGames.mode} onChange={e => update('nbaGames', { ...r.nbaGames, mode: e.target.value as SeasonRules['nbaGames']['mode'] })}><option value="capped_starts">Limit counted starter games</option><option value="all_scheduled">Count all scheduled starter games</option></select></label>
        {r.nbaGames.mode === 'capped_starts' && <><label className="block">Counted starts per seven-day period<input className={field} type="number" min={1} max={100} value={r.nbaGames.startsPerPeriod} onChange={e => update('nbaGames', { ...r.nbaGames, startsPerPeriod: Number(e.target.value) })} /></label>
        <label className="block">Short and extended scoring periods<select className={field} value={r.nbaGames.shortPeriods} onChange={e => update('nbaGames', { ...r.nbaGames, shortPeriods: e.target.value as SeasonRules['nbaGames']['shortPeriods'] })}><option value="prorate_by_days">Scale cap by duration, round down</option><option value="same_cap">Keep the same cap</option></select></label></>}
        <p className="text-sm text-slate-400">Count eligible starters in actual tipoff order. Simultaneous starts require a stable lineup-slot order. The live scoring adapter will enforce this policy.</p>
      </div>}
      <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Waivers, trades and score corrections</summary><div className="space-y-3">
        <label className="block">Waiver system<select className={field} value={r.waivers.mode} onChange={e => update('waivers', { ...r.waivers, mode: e.target.value as SeasonRules['waivers']['mode'] })}><option value="faab">FAAB</option><option value="rolling_priority">Rolling priority</option></select></label>
        <label className="block">FAAB budget per stage<input className={field} type="number" min={0} max={1000} value={r.waivers.budget} onChange={e => update('waivers', { ...r.waivers, budget: Number(e.target.value) })} /></label>
        <label className="block">Daily waiver processing hour (UTC)<input className={field} type="number" min={0} max={23} value={r.waivers.processingHourUtc} onChange={e => update('waivers', { ...r.waivers, processingHourUtc: Number(e.target.value) })} /></label>
        <label className="block">Dropped-player waiver hold (hours)<input className={field} type="number" min={0} max={72} value={r.waivers.holdHours} onChange={e => update('waivers', { ...r.waivers, holdHours: Number(e.target.value) })} /></label>
        {config.trades && <><label className="block">Trade deadline hours before each qualifier cut<input className={field} type="number" min={1} max={168} value={r.tradeDeadlineHoursBeforeCut} onChange={e => update('tradeDeadlineHoursBeforeCut', Number(e.target.value))} /></label><label className="block">Trade review hours<input className={field} type="number" min={0} max={72} value={r.tradeReviewHours} onChange={e => update('tradeReviewHours', Number(e.target.value))} /></label></>}
        <label className="block">Minimum stat-correction window (hours)<input className={field} type="number" min={1} max={168} value={r.correctionHours} onChange={e => update('correctionHours', Number(e.target.value))} /></label>
        <p className="text-sm text-slate-400">FAAB and priority reset each stage; waiver ties use prior seed, then audited commissioner resolution. Trades stop in the final stage. Postponed games count in their actual start period. Corrections after finalization require an audited dispute. Eliminated final-stage rosters stay locked.</p>
      </div></details>
      <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Dated scoring and draft windows</summary><div className="space-y-4">
        <p className="text-sm text-amber-200">All date fields below use UTC, regardless of your device timezone. Use the display timezone when sharing schedules. Review every period against the sport's actual schedule, including All-Star and short weeks.</p>
        <label className="block">Schedule display timezone<input className={field} value={r.calendar.timezone} onChange={e => update('calendar', { ...r.calendar, timezone: e.target.value, scheduleReviewed: false })} /></label>
        <label className="block">Season label<input className={field} value={r.calendar.seasonLabel} maxLength={40} placeholder="2026–27 NBA" onChange={e => update('calendar', { ...r.calendar, seasonLabel: e.target.value, scheduleReviewed: false })} /></label>
        <label className="block">Official schedule source URL<input className={field} type="url" value={r.calendar.sourceUrl} onChange={e => update('calendar', { ...r.calendar, sourceUrl: e.target.value, scheduleReviewed: false })} /></label>
        {(['regularSeasonStartsAt', 'regularSeasonEndsAt'] as const).map((key, i) => <label key={key} className="block">Regular season {i === 0 ? 'starts' : 'ends'} (UTC)<input className={field} type="datetime-local" value={utcInput(r.calendar[key])} onChange={e => update('calendar', { ...r.calendar, [key]: utcValue(e.target.value), scheduleReviewed: false })} /></label>)}
        <button type="button" className="min-h-11 rounded-xl border border-white/20 px-3" onClick={() => update('calendar', { ...r.calendar, scheduleReviewed: false, periods: Array.from({ length: config.finalWeek - config.startWeek + 1 }, (_, i) => r.calendar.periods.find(p => p.number === config.startWeek + i) ?? { number: config.startWeek + i, startsAt: '', endsAt: '', finalizesAt: '' }), drafts: [1, 2, 3].map(stage => r.calendar.drafts.find(d => d.stage === stage) ?? { stage, startsAt: '', completeBy: '' }) })}>Sync calendar rows to scoring periods</button>
        {r.calendar.periods.map((p, index) => <div key={p.number} className="space-y-2 rounded-xl border border-white/15 p-3"><h4 className="font-medium">Period {p.number}</h4>{(['startsAt', 'endsAt', 'finalizesAt'] as const).map(key => <label key={key} className="block text-sm">Period {p.number} {key === 'startsAt' ? 'starts' : key === 'endsAt' ? 'ends' : 'scores finalize'} (UTC)<input className={field} type="datetime-local" value={utcInput(p[key])} onChange={e => update('calendar', { ...r.calendar, scheduleReviewed: false, periods: r.calendar.periods.map((row, i) => i === index ? { ...row, [key]: utcValue(e.target.value) } : row) })} /></label>)}</div>)}
        {r.calendar.drafts.map((d, index) => <div key={d.stage} className="space-y-2 rounded-xl border border-white/15 p-3"><h4 className="font-medium">Stage {d.stage} draft</h4>{(['startsAt', 'completeBy'] as const).map(key => <label key={key} className="block text-sm">Stage {d.stage} draft {key === 'startsAt' ? 'starts' : 'complete by'} (UTC)<input className={field} type="datetime-local" value={utcInput(d[key])} onChange={e => update('calendar', { ...r.calendar, scheduleReviewed: false, drafts: r.calendar.drafts.map((row, i) => i === index ? { ...row, [key]: utcValue(e.target.value) } : row) })} /></label>)}</div>)}
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={r.calendar.scheduleReviewed} onChange={e => update('calendar', { ...r.calendar, scheduleReviewed: e.target.checked })} />I reviewed these windows against actual games and season breaks</label>
      </div></details>
      <button type="button" className="min-h-11 rounded-xl border border-amber-300/30 px-3 text-amber-200" onClick={initialize}>Reset playing rules and calendar to defaults</button>
    </>}
    <details open={!r}><summary className="min-h-11 cursor-pointer py-2 font-medium">Rules checklist: {readiness.ready ? 'complete' : `${readiness.blockers.length} items remaining`}</summary><ul className="list-disc space-y-2 pl-5 text-sm text-amber-200">{readiness.blockers.map((message, i) => <li key={i}>{message}</li>)}</ul>{readiness.ready && <p className="text-sm text-cyan-200">The configuration passes rule checks. Registration, provider coverage and tournament execution still need their launch checks.</p>}</details>
  </section>
}

'use client'
import { SeasonRuleLabels } from './SeasonRuleLabels'
import { useState } from 'react'
import { SeasonIdentityHero } from './SeasonIdentity'
import { SeasonLeagueReveal } from './SeasonLeagueReveal'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SeasonEntryView } from '@/lib/tournament/seasonRegistration'
import { buildSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { nbaStartCap } from '@/lib/tournament/seasonRules'

export function SeasonTournamentEntry({ entry, token = '' }: { entry: SeasonEntryView; token?: string }) {
  const router = useRouter()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const rules = entry.config.rules!
  const format = (date: string) => new Intl.DateTimeFormat('en', { timeZone: rules.calendar.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date))
  async function act(action: 'join' | 'withdraw') {
    if (busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/tournament/season-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, tournamentId: entry.tournamentId, ...(action === 'join' ? { token, publicationId: entry.publicationId, acceptedHash: entry.hash, acceptedRules: accepted } : {}) }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not update your entry.')
      setNotice(action === 'withdraw' ? 'You have withdrawn.' : body.status === 'waitlisted' ? 'You joined the waitlist. Your place will update when a seat opens.' : 'Your tournament place is reserved.')
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update your entry.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 bg-slate-950 px-4 py-6 text-white">
    <Link className="text-cyan-200" href="/tournament-hub">Tournament Hub</Link>
    <SeasonIdentityHero config={entry.config}><p className="text-sm text-cyan-200">{entry.sport} tournament</p><h1 className="text-3xl font-bold">{entry.name}</h1><p>{entry.registered}/{entry.capacity} places reserved · Your status: {entry.status.replaceAll('_', ' ')}</p>{entry.waitlistPosition !== null && <p className="font-semibold text-amber-200">Waitlist position: {entry.waitlistPosition}</p>}{entry.closesAt && <p className="text-sm text-slate-300">Registration closes {format(entry.closesAt)} ({rules.calendar.timezone})</p>}<div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Tournament places reserved" aria-valuenow={entry.registered} aria-valuemin={0} aria-valuemax={entry.capacity}><div className="h-full bg-amber-300" style={{ width: Math.min(100, 100 * entry.registered / entry.capacity) + '%' }} /></div></SeasonIdentityHero>
    {entry.assignment && <SeasonLeagueReveal assignment={entry.assignment} timezone={rules.calendar.timezone} />}
    <section className="space-y-3 rounded-2xl border border-white/15 p-5">
      {entry.fieldFrozen && <p role="status" className="text-amber-200">The opening field is frozen. Registration and withdrawals are locked while leagues and drafts are prepared.</p>}
      <h2 className="text-xl font-semibold">Published tournament rules</h2>
      <p className="text-sm text-slate-300">Two half-field qualifiers, three drafts and one final cross-league bracket. Final leagues use separate player pools, so opponents can roster the same athlete. Scores reset at every redraft. Final-stage rosters are never released to waivers.</p>
      <ul className="space-y-2 text-sm">{buildSeasonBlueprint(entry.config).stages.map(s => <li key={s.number}>Stage {s.number}: {s.participants} entrants, {s.leagueCount} leagues, scoring periods {s.startWeek}–{s.endWeek}.</li>)}</ul>
      <p className="text-sm">Draft: {entry.config.draftType}. Trading: {entry.config.trades ? 'qualifiers only' : 'disabled'}. Ties: stage points → {entry.config.tiebreakers.map(s => s.replaceAll('_', ' ')).join(' → ')} → audited commissioner resolution.</p>
      <p className="text-sm">Draft order: opening audited shuffle; later stages use previous seed, best first within each pool. Autodraft chooses the best available legal player. Pick clock: {rules.draftPolicy?.pickClockSeconds ?? 'not specified'} seconds. Auction budget: {rules.draftPolicy?.auctionBudget ?? 'not specified'}, minimum bid one dollar; nomination clock {rules.draftPolicy?.nominationClockSeconds ?? 'not specified'} seconds, bid extension {rules.draftPolicy?.bidExtensionSeconds ?? 'not specified'} seconds. An expired nomination clock selects a legal player and opens at one dollar for the nominator; manual nominations with no bids return to the pool.</p>
      <p className="text-sm">Divisions: {entry.config.divisions.length ? entry.config.divisions.join(', ') + ' (identity only; no reserved advancement places)' : 'none'}. Opening league names: {entry.config.leagueNames.length ? entry.config.leagueNames.join(', ') : 'generated by opening league number'}.</p>
      <SeasonRuleLabels config={entry.config} /><details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Scoring and rosters</summary><p className="my-3 text-sm">Starters: {rules.starters.filter(s => s.count).map(s => s.count + ' ' + s.position).join(', ')}. Bench: {rules.bench}. Additional IR: {rules.ir}. Eligible IR statuses: {rules.transactionPolicy?.irEligibleStatuses.join(', ') ?? 'not specified'}. Ineligible IR blocks adds until corrected.</p><p className="mb-3 text-sm">Lineup lock: {rules.lineupLock === 'individual_game' ? "each player's game start" : 'start of scoring period'}. NBA game policy: {rules.nbaGames.mode === 'all_scheduled' ? 'all scheduled starter games count' : rules.nbaGames.startsPerPeriod + ' counted starter games per seven days; ' + (rules.nbaGames.shortPeriods === 'same_cap' ? 'same cap for every period' : 'cap scales by period duration, rounded down')}. Capped games count in actual start order, with lineup-slot order breaking simultaneous starts.</p><ul className="grid gap-2 text-sm sm:grid-cols-2">{rules.weights.map(w => <li key={w.statKey}>{w.statKey.replaceAll('_', ' ')}: {w.points}</li>)}</ul></details>
      <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Waivers, trades and corrections</summary><p className="text-sm">Waivers: {rules.waivers.mode === 'faab' ? 'FAAB, budget ' + rules.waivers.budget + ' per draft' : 'rolling priority'}. Process daily at {rules.waivers.processingHourUtc}:00 UTC. Dropped-player hold: {rules.waivers.holdHours} hours. {rules.transactionPolicy?.zeroDollarBids ? 'Zero-dollar bids allowed.' : 'Zero-dollar bids disabled.'} Priority begins in reverse draft order and winning claims move to the back; equal bids use rolling priority. Budget and priority reset each draft.</p><p className="mt-3 text-sm">Qualifier trades, when enabled, close {rules.tradeDeadlineHoursBeforeCut} hours before each cut, with {rules.tradeReviewHours} hours for review. Final-stage trades are disabled. Score corrections have at least {rules.correctionHours} hours; corrections after finalization require an audited dispute. Postponed games count in their actual start period.</p></details>
      <details><summary className="min-h-11 cursor-pointer py-2 text-cyan-200">Scoring and draft schedule ({rules.calendar.timezone})</summary><ul className="space-y-3 text-sm">{rules.calendar.drafts.map(d => <li key={'draft-' + d.stage}>Stage {d.stage} draft: {format(d.startsAt)} to {format(d.completeBy)}. Drafts finish at least {entry.config.redraftBufferHours} hours before scoring.</li>)}{rules.calendar.periods.map(p => <li key={p.number}>Period {p.number}: {format(p.startsAt)} to {format(p.endsAt)}; scores finalize {format(p.finalizesAt)}.{entry.sport === 'NBA' && rules.nbaGames.mode === 'capped_starts' && ' Counted starts: ' + nbaStartCap(rules, p.number) + '.'}</li>)}</ul></details>
      <p className="text-sm text-slate-300">Waitlist: first in, first promoted when a seat opens before the registration deadline. Withdrawing and rejoining puts you at the back. The owner can remove entries with an audited reason; removed entries need restored eligibility before rejoining.</p>
      {entry.scheduleExceptions.pendingGames > 0 && <p className="text-sm text-amber-200">{entry.scheduleExceptions.pendingGames} NBA Cup-dependent games are pending. The schedule must be rechecked before scoring opens.</p>}
      {entry.scheduleExceptions.excludedGames.length > 0 && <details><summary className="min-h-11 cursor-pointer py-2 text-amber-200">{entry.scheduleExceptions.excludedGames.length} games excluded during scoring gaps</summary><ul className="space-y-2 text-sm">{entry.scheduleExceptions.excludedGames.map(g => <li key={g.gameId}>{g.gameId}: {format(g.startsAt)} — will not count</li>)}</ul></details>}
      <p className="break-all text-xs text-slate-400">Accepted rule version: {entry.hash}</p>
    </section>
    <section className="space-y-3 rounded-2xl border border-white/15 p-5">
      {error && <p role="alert" className="text-red-200">{error}</p>}{notice && <p role="status" className="text-cyan-200">{notice}</p>}
      {entry.canJoin && <><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={busy} />I accept this published tournament rule version</label><button className="min-h-12 w-full rounded-xl bg-cyan-300 px-4 font-bold text-slate-950 disabled:opacity-40" disabled={!accepted || busy} onClick={() => act('join')}>{entry.registered >= entry.capacity ? 'Join waitlist' : 'Join tournament'}</button></>}
      {entry.canWithdraw && <button className="min-h-11 w-full rounded-xl border border-red-300/30 px-4 text-red-200" disabled={busy} onClick={() => act('withdraw')}>Withdraw my entry</button>}
      {!entry.canJoin && !entry.canWithdraw && <p className="text-sm text-slate-300">{entry.status === 'removed' ? 'Contact the tournament owner to restore your eligibility.' : 'Joining or withdrawals are unavailable here. If you want to rejoin before the deadline, request the current invite from the owner.'}</p>}
      <p className="text-sm text-amber-200">Registration reserves your place. Your league is assigned when the owner freezes the full field. Draft launch remains locked while runtime checks are completed.</p>
    </section>
  </main>
}

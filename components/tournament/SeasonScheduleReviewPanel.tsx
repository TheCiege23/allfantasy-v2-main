'use client'
import { useState } from 'react'
import type { reviewSeasonPublishedSchedule } from '@/lib/tournament/seasonScheduleReview'

type Report = Awaited<ReturnType<typeof reviewSeasonPublishedSchedule>>
type StartReport = { gameId: string; status: string; observedAt: string; verifiedWindow: boolean; startAfter: string | null; startedBy: string | null; reason: string | null; exactStartVerified: false; lineupLockCertified: false; impact?: { lockedLeagues: number; scoreRevisions: number; finalizedWeeks: number; receiptReviewRequired: boolean } }
type LockedCoverageReport = { leagueKey: string; leagueName: string; lockedGames: number; lockedPlayerGamePairs: number; matchedPairs: number; unresolvedIdentityPairs: number; missingGamePairs: number; unverifiedBoxPairs: number; absentFinalPlayerPairs: number; pendingPlayerPairs: number; scheduledFuturePlayerPairs: number; boxContractMeasured: boolean; scoringCertified: false; publishedGames: number; publishedGamesPending: number; publishedGameRowsMissing: number; publishedGamesWithoutLockedReceipt: number; lockedGamesOutsidePublication: number; draftedPlayers: number; draftedPlayersWithoutLockedGame: number; explicitDnpOutcomes: number; completeGameAndPlayerCoverageVerified: false }
type PeriodReport = { period: number; observedAt: string; expectedGames: number; fetchedGames: number; finalGames: number; missingGameIds: string[]; futureGameIds: string[]; unknownGameIds: string[]; allGameRowsFinal: boolean; exactStartVerified: false; playerCoverageVerified: false; scoringCertified: false; boxAudit: { measuredSport: boolean; gamesWithPlayerBoxes: number; providerPlayerRows: number; missingBoxGameIds: string[]; malformedBoxGameIds: string[]; duplicatePlayerGameIds: string[]; invalidWeightedBoxGameIds: string[]; unscorableWeightedStats: string[]; draftedPlayerCoverageVerified: false }; lockedCoverage?: LockedCoverageReport; outcomeEvidence?: { revisions: number; correctedSubjects: number; candidateDnp: number; candidateNoGame: number; candidateNoDraftedPlayers: number; contractVerified: false; scoringCertified: false } }
const labels: Record<Report['changes'][number]['kind'], string> = {
  missing: 'Missing from current feed', conflict: 'Conflicting provider rows', replaced: 'Replaced',
  canceled: 'Canceled', postponed: 'Postponed', unverified: 'Schedule unverified',
  rescheduled: 'Scheduled time changed', new_game: 'New game',
}
export function SeasonScheduleReviewPanel({ tournamentId, freezeId, periods = [], leagues = [] }: { tournamentId: string; freezeId: string; periods?: number[]; leagues?: Array<{ key: string; name: string; leagueId: string | null }> }) {
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [gameId, setGameId] = useState('')
  const [startReport, setStartReport] = useState<StartReport | null>(null)
  const [period, setPeriod] = useState(periods[0] ?? 1)
  const [leagueKey, setLeagueKey] = useState('')
  const [periodReport, setPeriodReport] = useState<PeriodReport | null>(null)
  async function review() {
    if (busy) return
    setBusy(true); setError(''); setReport(null)
    try {
      const response = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'review_schedule', tournamentId, freezeId }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not review the current schedule.')
      setReport(body)
    } catch (e) { setError(e instanceof Error ? e.message : 'Schedule review failed.') }
    finally { setBusy(false) }
  }
  async function observeStart() {
    if (busy || !gameId.trim()) return
    setBusy(true); setError(''); setStartReport(null)
    try {
      const response = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'observe_start', tournamentId, freezeId, gameId: gameId.trim() }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not check live game status.')
      setStartReport(body)
    } catch (e) { setError(e instanceof Error ? e.message : 'Live status check failed.') }
    finally { setBusy(false) }
  }
  async function refreshPeriod() {
    if (busy || !periods.includes(period)) return
    setBusy(true); setError(''); setPeriodReport(null)
    try {
      const response = await fetch('/api/tournament/season-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh_period', tournamentId, freezeId, period, ...(leagueKey ? { key: leagueKey } : {}) }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not check the full scoring-period feed.')
      setPeriodReport(body)
    } catch (e) { setError(e instanceof Error ? e.message : 'Scoring-period feed check failed.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Tournament schedule review" className="min-w-0 space-y-2 rounded-xl border border-cyan-300/30 p-3 text-sm">
    <h4 className="font-semibold">Published schedule review</h4>
    <p className="text-slate-300">Compare the locked game assignments with the latest Rolling Insights schedule. This check does not move games, change scoring weeks, or verify actual starts.</p>
    <button type="button" className="min-h-11 rounded-xl border border-cyan-300/40 px-4 disabled:opacity-40" disabled={busy} onClick={review}>{busy ? 'Checking schedule…' : 'Check current schedule'}</button>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 text-slate-300">Published game ID<input className="mt-1 block min-h-11 max-w-full rounded-lg border border-white/20 bg-slate-950 px-3 text-white" value={gameId} onChange={event => setGameId(event.target.value)} maxLength={200} /></label>
      <button type="button" className="min-h-11 rounded-xl border border-cyan-300/40 px-4 disabled:opacity-40" disabled={busy || !gameId.trim()} onClick={observeStart}>Sample live status</button>
    </div>
    <p className="text-slate-300">Sample this game before it starts and again while it is in progress. A close pair can bound when play began; it cannot prove an exact tipoff or unlock scoring.</p>
    {periods.length > 0 && <div className="flex flex-wrap items-end gap-2">
      <label className="text-slate-300">Scoring period<select className="mt-1 block min-h-11 rounded-lg border border-white/20 bg-slate-950 px-3 text-white" value={period} disabled={busy} onChange={event => { setPeriod(Number(event.target.value)); setPeriodReport(null) }}>{periods.map(number => <option key={number} value={number}>Week {number}</option>)}</select></label>
      <label className="min-w-0 text-slate-300">Opening league<select className="mt-1 block min-h-11 max-w-full rounded-lg border border-white/20 bg-slate-950 px-3 text-white" value={leagueKey} disabled={busy} onChange={event => { setLeagueKey(event.target.value); setPeriodReport(null) }}><option value="">Feed only</option>{leagues.filter(league => league.leagueId).map(league => <option key={league.key} value={league.key}>{league.name}</option>)}</select></label>
      <button type="button" className="min-h-11 rounded-xl border border-cyan-300/40 px-4 disabled:opacity-40" disabled={busy} onClick={refreshPeriod}>Check whole-period feed</button>
    </div>}
    <p className="text-slate-300">This read-only check fetches each elapsed Eastern game day in the selected published period. Missing games are reported, never scored as zero.</p>
    {error && <p role="alert" className="break-words text-red-200">{error}</p>}
    {startReport && <div role="status" className="space-y-1 break-words text-amber-100"><p>Game {startReport.gameId}: {startReport.status.replaceAll('_', ' ')} observed {new Date(startReport.observedAt).toLocaleString()}.</p><p>{startReport.verifiedWindow ? `Start observed after ${startReport.startAfter} and by ${startReport.startedBy}.` : startReport.reason}</p>{startReport.impact && <p>Saved impact: {startReport.impact.lockedLeagues} leagues with lineups · {startReport.impact.scoreRevisions} score revisions · {startReport.impact.finalizedWeeks} finalized weeks. {startReport.impact.receiptReviewRequired ? 'Review those records before correction.' : 'No affected records found.'}</p>}<p>Exact start and lineup lock remain unverified. Scoring stays blocked.</p></div>}
    {periodReport && <div role="status" className="space-y-1 break-words text-amber-100">
      <p>Week {periodReport.period}: {periodReport.fetchedGames} of {periodReport.expectedGames} published game rows found; {periodReport.finalGames} final. Checked {new Date(periodReport.observedAt).toLocaleString()}.</p>
      <p>{periodReport.missingGameIds.length} missing · {periodReport.futureGameIds.length} future · {periodReport.unknownGameIds.length} unknown or changed status.</p>
      {periodReport.missingGameIds.length > 0 && <p>Missing game IDs: {periodReport.missingGameIds.slice(0, 10).join(', ')}{periodReport.missingGameIds.length > 10 ? ` and ${periodReport.missingGameIds.length - 10} more` : ''}.</p>}
      {periodReport.boxAudit?.measuredSport ? <p>NBA box preflight: {periodReport.boxAudit.gamesWithPlayerBoxes} game boxes, {periodReport.boxAudit.providerPlayerRows} provider player rows. {periodReport.boxAudit.missingBoxGameIds.length} missing boxes · {periodReport.boxAudit.malformedBoxGameIds.length} malformed · {periodReport.boxAudit.duplicatePlayerGameIds.length} duplicate player IDs · {periodReport.boxAudit.invalidWeightedBoxGameIds.length} invalid weighted lines. {periodReport.boxAudit.unscorableWeightedStats.length ? `Unscorable frozen stats: ${periodReport.boxAudit.unscorableWeightedStats.join(', ')}.` : ''} Drafted-player coverage is still unverified.</p> : <p>NFL per-game player-box structure and drafted-player coverage remain unverified.</p>}
      {periodReport.lockedCoverage && <p>{periodReport.lockedCoverage.leagueName}: {periodReport.lockedCoverage.lockedGames} locked games, {periodReport.lockedCoverage.lockedPlayerGamePairs} locked player/game pairs · {periodReport.lockedCoverage.matchedPairs} found in measured boxes · {periodReport.lockedCoverage.unresolvedIdentityPairs} unresolved identities · {periodReport.lockedCoverage.missingGamePairs} missing game rows · {periodReport.lockedCoverage.unverifiedBoxPairs} unverified boxes · {periodReport.lockedCoverage.absentFinalPlayerPairs} absent from final boxes · {periodReport.lockedCoverage.pendingPlayerPairs} live pending · {periodReport.lockedCoverage.scheduledFuturePlayerPairs} scheduled for later. Missing players and DNPs are unresolved, never zero scores.</p>}
      {periodReport.lockedCoverage && <p>Period-wide coverage: {periodReport.lockedCoverage.publishedGames} published games, {periodReport.lockedCoverage.publishedGamesPending} scheduled for later; {periodReport.lockedCoverage.publishedGameRowsMissing} elapsed games lack feed rows; {periodReport.lockedCoverage.publishedGamesWithoutLockedReceipt} elapsed games lack a locked receipt or explicit no-player outcome; {periodReport.lockedCoverage.lockedGamesOutsidePublication} locked games fall outside publication. {periodReport.lockedCoverage.draftedPlayersWithoutLockedGame} of {periodReport.lockedCoverage.draftedPlayers} drafted players have no locked game or verified no-game outcome. Explicit DNP outcomes: {periodReport.lockedCoverage.explicitDnpOutcomes}. Full game and player coverage remains unverified.</p>}
      {periodReport.outcomeEvidence && <p>Candidate outcome evidence: {periodReport.outcomeEvidence.candidateDnp} DNP, {periodReport.outcomeEvidence.candidateNoGame} no-game, {periodReport.outcomeEvidence.candidateNoDraftedPlayers} no-drafted-player claims across {periodReport.outcomeEvidence.revisions} saved revisions ({periodReport.outcomeEvidence.correctedSubjects} corrections). Source completeness is unverified; these claims do not close coverage or score points.</p>}
      <p>{periodReport.allGameRowsFinal ? 'All published game rows are final in this snapshot.' : 'The published game rows are not all final.'} Exact starts, player coverage and scoring remain unverified.</p>
    </div>}
    {report && <div role="status" className="space-y-2">
      <p className="font-medium">{report.scheduleMatches ? 'No schedule changes found' : `${report.changes.length} schedule change${report.changes.length === 1 ? '' : 's'} ${report.changes.length === 1 ? 'needs' : 'need'} review`} · launch blocked</p>
      <p className="text-slate-300">Checked {new Date(report.checkedAt).toLocaleString()}. Scheduled times are not proof of actual start.</p>
      <p className="text-slate-300">Every flagged game needs an actual-start check and an audit of locked lineups, scores, and finalized weeks before a correction. Nothing is changed automatically.</p>
      {report.pendingGames > 0 && <p className="text-amber-200">{report.pendingGames} regular-season games are still pending in the current feed.</p>}
      {report.coverageBlockers.length > 0 && <ul className="list-disc space-y-1 pl-5 text-amber-200">{report.coverageBlockers.map(item => <li key={item}>{item}</li>)}</ul>}
      <ul className="space-y-2">{report.changes.slice(0, 20).map(change => <li key={`${change.gameId}:${change.kind}`} className="min-w-0 rounded-lg border border-amber-300/20 p-2 break-words">
        <span className="font-medium">Game {change.gameId}: {labels[change.kind]}</span>
        <span className="block text-slate-300">Published {change.publishedStartsAt ?? 'none'} · period {change.publishedPeriod ?? 'none'}</span>
        <span className="block text-slate-300">Current scheduled {change.currentScheduledAt ?? 'unknown'} · period {change.currentScheduledPeriod ?? 'none'}{change.replacedBy ? ` · replacement ${change.replacedBy}` : ''}</span>
        <span className="block text-amber-100">{report.reconciliation.find(item => item.gameId === change.gameId)?.steps.at(-1)}</span>
      </li>)}</ul>
      {report.changes.length > 20 && <p className="text-amber-200">{report.changes.length - 20} more changes require review.</p>}
    </div>}
  </section>
}

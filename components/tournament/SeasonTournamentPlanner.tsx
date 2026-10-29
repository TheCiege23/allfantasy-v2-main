'use client'
import { SeasonRuleLabels, SeasonRosterPresetPicker } from './SeasonRuleLabels'

import { useState } from 'react'
import { SeasonIdentityHero, SeasonCrest } from './SeasonIdentity'
import { SeasonTournamentMoments } from './SeasonTournamentMoments'
import { SeasonIdentityEditor } from './SeasonIdentityEditor'
import { identityArt, defaultSeasonArt } from '@/lib/tournament/seasonArtwork'
import { SeasonRegistrationManager } from './SeasonRegistrationManager'
import { SeasonRulesPublication } from './SeasonRulesPublication'
import { SeasonPlayingRulesEditor } from './SeasonPlayingRulesEditor'
import Link from 'next/link'
import { buildSeasonLeagueLayout } from '@/lib/tournament/seasonLeagueLayout'
import { useRouter } from 'next/navigation'
import { buildSeasonBlueprint, defaultSeasonBlueprint, type SeasonBlueprint, type SavedSeasonBlueprint, type BlueprintStaffRole } from '@/lib/tournament/seasonBlueprint'

type SavedPlan = SavedSeasonBlueprint
const field = 'min-h-11 w-full rounded-xl border border-white/20 bg-slate-900 px-3 py-2 text-white'
const panel = 'min-w-0 rounded-2xl border border-white/15 bg-slate-900/70 p-4 sm:p-6'

/** `initial` carries the sport and field size chosen on the format picker (step 1). */
export function SeasonTournamentPlanner({ saved, initial }: { saved?: SavedPlan; initial?: { sport: 'NFL' | 'NBA'; participants: number } }) {
  const router = useRouter()
  const [config, setConfig] = useState<SeasonBlueprint>(saved?.config ?? (initial ? { ...defaultSeasonBlueprint(initial.sport), participants: initial.participants } : defaultSeasonBlueprint()))
  const [divisionText, setDivisionText] = useState(config.divisions.join('\n'))
  const [leagueText, setLeagueText] = useState(config.leagueNames.join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState<BlueprintStaffRole>('viewer')
  const [editing, setEditing] = useState(!saved)
  const canEdit = !saved || saved.canEditSettings
  const [notice, setNotice] = useState('')
  const change = <K extends keyof SeasonBlueprint>(key: K, value: SeasonBlueprint[K]) => setConfig(c => {
    const next = { ...c, [key]: value }
    if (next.artwork && key === 'participants') next.artwork = { ...next.artwork, leagues: Array.from({ length: Math.ceil(next.participants / 32) * 4 }, (_, i) => identityArt(c, i)) }
    if (next.rules && ['startWeek', 'firstCutWeek', 'secondCutWeek', 'finalWeek', 'redraftBufferHours'].includes(key)) {
      next.rules = { ...next.rules, calendar: { ...next.rules.calendar, scheduleReviewed: false } }
    }
    return next
  })
  let plan: ReturnType<typeof buildSeasonBlueprint> | null = null
  let issues: string[] = []
  try { plan = buildSeasonBlueprint({ ...config, divisions: divisionText.split('\n').map(s => s.trim()).filter(Boolean), leagueNames: leagueText.split('\n').map(s => s.trim()).filter(Boolean) }) } catch (e) {
    issues = (e as { issues?: { message: string }[] }).issues?.map(i => i.message) ?? ['Check the tournament settings.']
  }
  const leagueLayout = plan ? buildSeasonLeagueLayout(plan.config) : []
  async function save() {
    if (!plan || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/tournament/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saved ? { action: 'blueprint_update', tournamentId: saved.tournamentId, revision: saved.revision, config: plan.config } : { action: 'save_blueprint', config: plan.config }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not save tournament plan.')
      if (saved) {
        setEditing(false)
        setNotice('Tournament rules saved.'); router.refresh()
      } else { router.push('/tournament-hub/' + body.tournamentId) }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save plan.') }
    finally { setBusy(false) }
  }
  function cancelEditing() {
    if (!saved) return
    setConfig(saved.config)
    setDivisionText(saved.config.divisions.join('\n'))
    setLeagueText(saved.config.leagueNames.join('\n'))
    setEditing(false); setError('')
  }
  async function manageStaff(action: 'blueprint_add_staff' | 'blueprint_remove_staff', details: Record<string, string>) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/tournament/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, tournamentId: saved?.tournamentId, ...details }) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Could not update staff access.')
      setNotice(action === 'blueprint_remove_staff' ? 'Staff access removed.' : 'Staff access saved.')
      setStaffName(''); router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update staff access.') }
    finally { setBusy(false) }
  }
  return <main className="mx-auto min-h-screen max-w-6xl space-y-6 bg-slate-950 px-4 py-6 text-white sm:px-6">
    <nav className="flex flex-wrap gap-4 text-sm text-cyan-300"><Link href="/core/commissioner">Commissioner Hub</Link><Link href="/tournament-hub">Tournament Hub</Link></nav>
    <SeasonIdentityHero config={plan?.config ?? config}>
      <p className="text-sm font-semibold uppercase tracking-widest text-amber-300">Tournament leagues · NFL + NBA</p>
      <h1 className="mt-2 text-2xl font-bold sm:text-4xl">{saved ? config.name : 'One field. Three drafts. One champion.'}</h1>
      <p className="mt-3 max-w-3xl text-slate-300">Two points-based qualifiers cut the field in half. Survivors enter balanced new leagues and redraft. The final stage is a weekly head-to-head bracket.</p>
      <p className="mt-3 rounded-lg border border-amber-400/30 p-3 text-sm text-amber-200">{saved?.publication ? 'Rules are frozen. The owner can manage registration below. Opening setup is available below. Live drafts and scoring remain locked until runtime checks are complete.' : 'Planning preview: save your rules, verify the calendar and publish before opening registration. Live drafts and scoring remain locked until runtime checks are complete.'}</p>
    </SeasonIdentityHero>
    {error && <div role="alert" className="rounded-xl border border-red-400/50 p-4 text-red-200"><p>{error}</p>{saved && <button className="mt-2 min-h-11 rounded-xl border border-white/20 px-3" onClick={() => router.refresh()} disabled={busy}>Reload latest plan</button>}</div>}
    <p role="status" className="text-sm text-cyan-200">{notice}</p>
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <section className={panel}>
        <h2 className="mb-4 text-xl font-semibold">{saved ? 'Commissioner rules' : 'Set the rules before inviting anyone'}</h2>
        {saved && canEdit && !editing && <button className="mb-4 min-h-11 rounded-xl border border-cyan-300/40 px-4 text-cyan-200" onClick={() => { setEditing(true); setNotice('') }}>Edit tournament rules</button>}
        <fieldset disabled={!canEdit || !editing || busy} className="min-w-0 space-y-4">
          <label className="block">Tournament name<input className={field} value={config.name} maxLength={120} onChange={e => change('name', e.target.value)} /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>Sport<select className={field} value={config.sport} onChange={e => setConfig({ ...defaultSeasonBlueprint(e.target.value as 'NFL' | 'NBA'), name: config.name })}><option>NBA</option><option>NFL</option></select></label>
            <label>Participants<input className={field} type="number" min={64} max={192} step={4} value={config.participants} onChange={e => change('participants', Number(e.target.value))} /></label>
          </div>
          <p className="text-sm text-slate-400">64–192 entrants, in multiples of four to support two exact half-field cuts. Suggested fields: 64, 96, 128, 160 or 192. Seeds use stage points across the entire field; divisions are for identity.</p>
          <div className="grid grid-cols-2 gap-4">
            {(['startWeek', 'firstCutWeek', 'secondCutWeek', 'finalWeek'] as const).map((key, i) => <label key={key}>{['First scoring period', 'First cut after period', 'Second cut after period', 'Championship period'][i]}<input className={field} type="number" min={1} max={config.sport === 'NFL' ? 18 : 30} value={config[key]} onChange={e => change(key, Number(e.target.value))} /></label>)}
          </div>
          <p className="text-sm text-slate-400">Period numbers are a planning grid, not verified season dates. Redrafts must finish between the prior score lock and the next lineup lock.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>Draft format<select className={field} value={config.draftType} onChange={e => change('draftType', e.target.value as SeasonBlueprint['draftType'])}><option value="snake">Snake</option><option value="auction">Auction</option></select></label>
            <label>Scoring<select className={field} value={config.scoring} onChange={e => change('scoring', e.target.value as SeasonBlueprint['scoring'])}>{config.sport === 'NBA' ? <option value="nba_points">NBA points</option> : <><option value="ppr">PPR</option><option value="half_ppr">Half PPR</option><option value="standard">Standard</option></>}</select></label>
            <label>Total roster slots<input className={field} type="number" min={5} max={20} value={config.rosterSize} onChange={e => change('rosterSize', Number(e.target.value))} /></label>
            <label>Redraft buffer (hours)<input className={field} type="number" min={1} max={168} value={config.redraftBufferHours} onChange={e => change('redraftBufferHours', Number(e.target.value))} /></label>
          </div>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={config.trades} onChange={e => change('trades', e.target.checked)} />Allow trading during qualifiers</label>
          <label className="block">Division names, one per line (optional)<textarea className={field} rows={3} value={divisionText} onChange={e => { setDivisionText(e.target.value); const names = e.target.value.split('\n').map(s => s.trim()).filter(Boolean); setConfig(c => ({ ...c, divisions: names, ...(c.artwork ? { artwork: { ...c.artwork, divisions: names.map((_, i) => c.artwork!.divisions[i] ?? defaultSeasonArt(i % 2 ? 'gold' : 'black')) } } : {}) })) }} /></label>
          <label className="block">Opening league names, one per line (optional)<textarea className={field} rows={4} value={leagueText} onChange={e => setLeagueText(e.target.value)} /></label>
          <label className="block">First tiebreaker after stage points<select className={field} value={config.tiebreakers[0]} onChange={e => { const first = e.target.value as SeasonBlueprint['tiebreakers'][number]; change('tiebreakers', [first, ...config.tiebreakers.filter(t => t !== first)]) }}>{(['best_week', 'wins', 'previous_seed'] as const).map(t => <option key={t} value={t}>{t.replaceAll('_', ' ')}</option>)}</select></label>
          <SeasonIdentityEditor config={{ ...config, divisions: divisionText.split('\n').map(s => s.trim()).filter(Boolean), leagueNames: leagueText.split('\n').map(s => s.trim()).filter(Boolean) }} onChange={next => { setConfig(next); setDivisionText(next.divisions.join('\n')); setLeagueText(next.leagueNames.join('\n')) }} />
          <SeasonRuleLabels config={config} />
          <SeasonRosterPresetPicker config={config} onChange={setConfig} />
          <SeasonPlayingRulesEditor config={config} onChange={rules => change('rules', rules)} />
        </fieldset>
        <p className="mt-4 text-sm text-slate-300">Tiebreak order: stage points → {config.tiebreakers.map(t => t.replaceAll('_', ' ')).join(' → ')} → manual resolution if still tied. No random elimination.</p>
        {canEdit && editing && <button className="mt-5 min-h-12 w-full rounded-xl bg-amber-400 px-4 font-bold text-slate-950 disabled:opacity-40" onClick={save} disabled={!plan || busy}>{busy ? 'Saving…' : saved ? 'Save rule changes' : 'Save tournament plan'}</button>}
        {saved && editing && <button className="mt-3 min-h-11 w-full rounded-xl border border-white/20 px-4" onClick={cancelEditing} disabled={busy}>Cancel changes</button>}
      </section>
      <div className="min-w-0 space-y-6">
        {saved && !editing && <SeasonRulesPublication saved={saved} />}
        {saved?.isOwner && saved.publication && <SeasonRegistrationManager tournamentId={saved.tournamentId} publicationId={saved.publication.id} />}
        <section className={panel} aria-live="polite">
          <h2 className="text-xl font-semibold">Your path to a champion</h2><div className="mt-3"><SeasonRuleLabels config={config} compact /></div>
          {issues.length > 0 && <ul className="mt-4 list-disc space-y-2 pl-5 text-amber-200">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
          {plan && <><div className="mt-4 space-y-4">{plan.stages.map(stage => <article key={stage.number} className="rounded-xl border border-cyan-400/20 bg-cyan-950/20 p-4">
            <p className="text-sm text-cyan-300">Stage {stage.number} · periods {stage.startWeek}–{stage.endWeek} · fresh draft</p>
            <h3 className="mt-1 text-lg font-semibold">{stage.name}</h3>
            <p>{stage.participants} teams · {stage.leagueCount} leagues · {Math.min(...stage.sizes)}{Math.min(...stage.sizes) !== Math.max(...stage.sizes) ? '–' + Math.max(...stage.sizes) : ''} teams per league</p>
            <p className="mt-2 text-sm text-slate-300">{stage.number < 3 ? stage.participants / 2 + ' advance by global seed. League count halves.' : plan.bracketWeeks + ' bracket weeks; ' + plan.byes + ' first-week byes awarded to top seeds. Eliminated rosters stay locked.'}</p>
            <details className="mt-3 rounded-lg border border-white/15 p-3">
              <summary className="min-h-11 cursor-pointer py-2 text-sm text-cyan-200">Preview league names and seed slots</summary>
              <ul className="space-y-3 text-sm">{leagueLayout.find(layout => layout.stage === stage.number)?.leagues.map(league => <li key={league.key} className="border-t border-white/10 pt-3">
                <SeasonCrest art={identityArt(plan.config, Number(league.key.split('-').at(-1)) - 1)} division={league.division ?? ''} className="float-left mr-3 w-16" /><p className="break-words font-medium">{league.name} · {league.slots} teams</p>
                {league.division && <p className="text-slate-300">Division: {league.division}</p>}
                {league.seeds.length > 0 && <p className="mt-1 text-slate-300">Seed slots: {league.seeds.join(', ')}</p>}
              </li>)}</ul>
              <p className="mt-3 text-xs text-slate-400">Structure preview. Leagues and drafts have not been created.</p>
            </details>
          </article>)}</div><ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-300">{plan.warnings.map(w => <li key={w}>{w}</li>)}</ul></>}
        </section>
        {saved?.isOwner && <section className={panel}>
          <h2 className="text-xl font-semibold">Commissioner team</h2>
          <p className="my-3 text-sm text-slate-300">{saved.publication ? 'Published rules are frozen for everyone. You can still manage staff access.' : 'Reviewers can read the plan. Co-commissioners can edit its rules. Only you can add, change or remove staff.'}</p>
          <label className="block">AllFantasy username<input className={field} value={staffName} maxLength={80} onChange={e => setStaffName(e.target.value)} disabled={busy} /></label>
          <label className="mt-3 block">New staff access<select className={field} value={staffRole} onChange={e => setStaffRole(e.target.value as BlueprintStaffRole)} disabled={busy}><option value="viewer">Reviewer — view only</option><option value="co_commissioner">Co-commissioner — edit rules</option></select></label>
          <button className="mt-3 min-h-11 rounded-xl border border-cyan-300/40 px-4 text-cyan-200 disabled:opacity-40" onClick={() => manageStaff('blueprint_add_staff', { username: staffName.trim(), role: staffRole })} disabled={busy || !staffName.trim()}>Add staff member</button>
          {saved.staff.length === 0 ? <p className="mt-4 text-sm text-slate-400">No co-commissioners or reviewers yet.</p> : <ul className="mt-4 space-y-3" aria-label="Tournament staff">{saved.staff.map(member => <li key={member.userId} className="rounded-xl border border-white/15 p-3">
            <p className="break-words font-medium">{member.displayName}</p>
            {member.username && <p className="mb-2 text-sm text-slate-400">@{member.username}</p>}
            <label className="block">Access for {member.displayName}<select className={field} value={member.role} disabled={busy || !member.username} onChange={e => manageStaff('blueprint_add_staff', { username: member.username, role: e.target.value })}><option value="viewer">Reviewer — view only</option><option value="co_commissioner">Co-commissioner — edit rules</option></select></label>
            <button className="mt-2 min-h-11 rounded-xl border border-red-300/30 px-3 text-red-200" disabled={busy} onClick={() => manageStaff('blueprint_remove_staff', { assigneeId: member.userId })}>Remove {member.displayName}</button>
          </li>)}</ul>}
        </section>}
        <SeasonTournamentMoments config={config} /><section className={panel}><h2 className="text-xl font-semibold">Make every cut an event</h2><p className="mt-3 text-slate-300">A live cut-line race, weekly seed movement cards, league rivalries, draft countdowns, and a champion’s season recap can keep the whole field involved. Eliminated managers can follow the bracket and cheer for their division.</p><p className="mt-3 text-sm text-slate-400">Planned features. Player-release elimination tournaments will be a separate format; final-stage rosters will never be released to waivers.</p></section>
      </div>
    </div>

  </main>
}

'use client'
/**
 * DivisionControl — commissioner seeding (week N) and round control (week N+1 on),
 * plus registration/placement and the notification matrix.
 *
 * ⚠ Seeds, winners and blockers arrive computed by the server. "Commit seeding" and
 * "Advance round" each call ONE guarded action that cannot be undone; the server
 * re-checks every blocker shown here before it writes.
 */
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { REGIONS } from '@/lib/tournament/divisions/engine'
import type { ControlView } from '@/lib/tournament/divisions/lifecycle'
import { TournamentNotificationsPanel } from './TournamentNotificationsPanel'

type Tab = 'registration' | 'seeding' | 'rounds' | 'notifications'
type Control = NonNullable<ControlView>
const card = 'rounded-2xl border border-white/10 bg-[#0b0d14]'
const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" }
const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(1))

const AUDIT_TEXT: Record<string, string> = {
  divisions_blueprint_created: 'Tournament plan saved', divisions_blueprint_updated: 'Tournament plan updated',
  divisions_registration_opened: 'Registration opened', divisions_entry_joined: 'Entrant joined', divisions_entry_withdrawn: 'Entrant left',
  divisions_waitlist_promoted: 'Waitlist spot filled', divisions_leagues_placed: 'Leagues placed', divisions_draft_scheduled: 'Draft time set',
  divisions_corrections_closed: 'Stat corrections confirmed closed', divisions_tie_calls: 'Commissioner tie call', divisions_seeding_committed: 'Seeding committed',
  divisions_bubble_notified: 'Bubble alerts sent', divisions_round_advanced: 'Round advanced', divisions_championship_committed: 'Champion crowned',
}

function Check({ done, n, title, sub, action }: { done: boolean; n: number; title: string; sub: string; action?: ReactNode }) {
  return (
    <li className={'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ' + (done ? 'border-[#6fe0a8]/40 bg-[#0e1a14]' : 'border-white/10 bg-[#0e1018]')}>
      <span aria-hidden="true" className={'grid h-9 w-9 shrink-0 place-items-center rounded-full font-bold ' + (done ? 'bg-[#163826] text-[#6fe0a8]' : 'bg-[#1a1c26] text-slate-400')}>{done ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> : n}</span>
      <div className="min-w-0 flex-1"><p className="font-bold text-white">{title}<span className="sr-only">{done ? ' — done' : ' — to do'}</span></p><p className="text-sm text-slate-400">{sub}</p></div>
      {action}
    </li>
  )
}

export function DivisionControl({ control, preview = false }: { control: Control; preview?: boolean }) {
  const router = useRouter()
  const { view, seeding, rounds } = control
  const [tab, setTab] = useState<Tab>(control.state.status === 'registering' || control.state.status === 'blueprint' ? 'registration' : seeding.committed ? 'rounds' : 'seeding')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [ack, setAck] = useState(false)
  const [division, setDivision] = useState<0 | 1>(0)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [closesAt, setClosesAt] = useState('')
  const [allowPreference, setAllowPreference] = useState(true)
  const [allowGrouping, setAllowGrouping] = useState(false)
  const tid = view.tournament.id

  async function act(body: Record<string, unknown>, done: string) {
    if (busy || preview) return
    setBusy(true); setMessage('')
    try {
      const res = await fetch('/api/tournament/divisions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tournamentId: tid, ...body }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'That did not work.')
      setMessage(done); setAck(false); router.refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : 'That did not work.') } finally { setBusy(false) }
  }

  const s = view.settings
  const seedingDone = [seeding.results > 0 && seeding.provisional, seeding.correctionsClosed, seeding.ties.length === 0, seeding.results > 0, seeding.committed]
  const d = view.divisions[division]
  const grid = new Map<string, { name: string; isWildcard: boolean }>()
  for (const r of REGIONS) for (const g of d.regions[r]?.[0] ?? []) for (const e of [g.a, g.b]) if (e) grid.set(`${r}:${e.seedLine}`, { name: e.name, isWildcard: e.seedLine > s.autoBids / 4 })
  const lines = (s.autoBids + s.wildcardSpots) / 4
  const lineRows = ([0, 1] as const).flatMap(di => view.divisions[di].rows.filter(r => r.tiebreak && r.tiebreak !== 'points' && (Math.abs(r.rank - s.autoBids - 0.5) <= 1)).map(r => ({ where: `${view.divisions[di].name} #${r.rank}`, id: r.id, name: r.name, points: r.points, wins: r.wins, losses: r.losses, by: r.tiebreak as string | null })))
  const poolRows = ([0, 1] as const).flatMap(di => view.divisions[di].pool.rows.filter(r => r.poolTiebreak && Math.abs(r.poolRank - s.wildcardSpots - 0.5) <= 1).map(r => ({ where: `${view.divisions[di].name} wc #${r.poolRank}`, id: r.id, name: r.name, points: r.points, wins: r.wins, losses: r.losses, by: r.poolTiebreak as string | null })))
  const rp = control.roundPreview

  return (
    <main className="mx-auto min-h-screen max-w-[1440px] space-y-6 bg-[#07080d] px-4 py-6 text-white sm:px-8">
      <header className="flex flex-wrap items-center gap-4 border-b border-white/10 pb-5">
        <Link href={`/tournament-hub/${tid}`} aria-label="Back to the tournament" className="grid h-12 w-12 place-items-center rounded-xl border border-white/15 bg-[#0e1018] text-xl">‹</Link>
        <div className="min-w-0 flex-1"><h1 className="text-2xl font-bold sm:text-4xl">Seeding and round control</h1><p className="text-slate-300">{view.identity.divisions[0].name} vs {view.identity.divisions[1].name} · commissioner only</p></div>
        <div role="tablist" aria-label="Control mode" className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-[#07080d] p-1">
          {([['registration', 'Registration'], ['seeding', `Seeding · week ${seeding.week}`], ['rounds', `Rounds · week ${view.calendar.bracketStartWeek}+`], ['notifications', 'Notifications']] as Array<[Tab, string]>).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-300 aria-selected:bg-[#1a1c26] aria-selected:text-[#ffd98a]">{label}</button>
          ))}
        </div>
      </header>
      {message && <p role="status" className="rounded-xl border border-white/15 bg-[#0e1018] p-3 text-sm">{message}</p>}
      {preview && <p className="text-sm font-semibold text-amber-300">Preview with invented sample data. Buttons are disabled.</p>}

      {tab === 'registration' && (
        <section className={card + ' space-y-4 p-5'}>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Registration · {control.state.status}</h2>
          <p className="text-slate-200">{control.counts.registered ?? 0} of {control.state.capacity} registered · {control.counts.waitlisted ?? 0} on the waitlist · {control.counts.following ?? 0} following.</p>
          {control.state.status === 'blueprint' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">Registration closes<input type="datetime-local" value={closesAt} onChange={e => setClosesAt(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-[#07080d] px-3 text-white" /></label>
              <div className="space-y-2">
                <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={allowPreference} onChange={e => setAllowPreference(e.target.checked)} />Let entrants state a division preference (honoured while divisions stay balanced)</label>
                <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={allowGrouping} onChange={e => setAllowGrouping(e.target.checked)} />Keep friends who join through a personal link together</label>
              </div>
              <button type="button" disabled={busy || !closesAt} onClick={() => act({ action: 'open_registration', closesAt: new Date(closesAt).toISOString(), allowPreference, allowGrouping }, 'Registration is open. Share the invite link.')} className="min-h-12 rounded-xl bg-[#e8b84a] font-bold text-[#1a1204] disabled:opacity-40 sm:col-span-2">Open registration</button>
            </div>
          )}
          {control.state.status === 'registering' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-300">Invite link: <code className="break-all rounded bg-[#07080d] px-2 py-1">/tournament-hub/{tid}/join</code> · personal links add <code>?ref=username</code>.</p>
              <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I understand closing registration places every entrant and can’t be undone.</label>
              <button type="button" disabled={busy || !ack} onClick={() => act({ action: 'close_and_place' }, 'Leagues placed. Everyone has been told.')} className="min-h-12 w-full rounded-xl bg-[#e8b84a] font-bold text-[#1a1204] disabled:opacity-40">Close registration and place leagues</button>
            </div>
          )}
          {control.leagues.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Draft times</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {control.leagues.map(l => <DraftRow key={l.id} league={l} disabled={busy || preview} onSave={at => act({ action: 'set_draft_time', tournamentLeagueId: l.id, at }, `Draft time set for ${l.name}. Its managers have been told.`)} />)}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === 'seeding' && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_620px]">
          <div className="space-y-5">
            <section className={card + ' p-5'}>
              <div className="mb-3 flex justify-between"><h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Checklist before seeding locks</h2><span className="text-sm text-slate-400" style={mono}>{seedingDone.filter(Boolean).length} of 5 done</span></div>
              <ol className="space-y-3">
                <Check n={1} done={seedingDone[0]!} title={`All week-${seeding.week} scores final`} sub={seeding.provisional ? `${seeding.results} results stored. Nothing missing or provisional.` : 'Some results are missing or still provisional.'} />
                <Check n={2} done={seeding.correctionsClosed} title="Stat corrections closed" sub={seeding.correctionsClosed ? 'Confirmed by the commissioner.' : 'Confirm once the provider’s correction window has passed.'}
                  action={!seeding.correctionsClosed && <button type="button" disabled={busy} onClick={() => act({ action: 'confirm_corrections', week: seeding.week }, 'Confirmed.')} className="min-h-11 rounded-xl border border-white/15 px-4 font-bold">Confirm closed</button>} />
                <Check n={3} done={seeding.ties.length === 0} title={seeding.ties.length ? `Resolve ${seeding.ties.length} tie${seeding.ties.length === 1 ? '' : 's'} on a line` : 'No unresolved ties on a line'} sub="Record, then best single week; anything still level is your call." />
                <Check n={4} done={seeding.results > 0} title={`Preview ${(s.autoBids + s.wildcardSpots) * 2} seeds`} sub={`${s.autoBids + s.wildcardSpots} per division, ${lines} per region. Check names before anything changes.`} />
                <Check n={5} done={seeding.committed} title="Commit seeding" sub={`Locks the regular season, builds 8 region brackets and starts week ${view.calendar.bracketStartWeek}. This can’t be undone.`}
                  action={!seeding.committed && (
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I understand</label>
                      <button type="button" disabled={busy || !ack || seeding.blockers.length > 0} onClick={() => act({ action: 'commit_seeding' }, 'Seeding committed. Brackets are live and managers have been told.')} className="min-h-12 rounded-xl bg-[#e8b84a] px-5 font-bold text-[#1a1204] disabled:opacity-40">Commit seeding</button>
                    </div>
                  )} />
              </ol>
              {seeding.blockers.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-amber-200">{seeding.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
              {!seeding.committed && <button type="button" disabled={busy} onClick={() => act({ action: 'notify_bubble' }, 'Bubble alerts sent.')} className="mt-3 min-h-11 rounded-xl border border-white/15 px-4 text-sm font-bold">Send “on the bubble” alerts (one week before seeding)</button>}
            </section>
            <section className={card + ' border-[#e8b84a]/40 p-5'}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#ffd98a]">Ties on a line</h2><span className="rounded-lg border border-white/15 px-3 py-1 text-sm">Seed › record › best week › commish</span></div>
              {seeding.ties.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {seeding.ties.map(t => (
                    <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 p-3">
                      <span className="flex-1">{view.divisions[t.division].name}: <b>{t.name}</b> is level on record, points and best week.</span>
                      <button type="button" disabled={busy} onClick={() => act({ action: 'call_ties', calls: { [t.id]: 1 } }, `${t.name} ranked higher.`)} className="min-h-11 rounded-xl border border-white/15 px-3 text-sm font-bold">Rank {t.name} higher</button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-widest text-slate-500"><tr><th className="py-2">Where</th><th>Team</th><th className="text-right">Points</th><th className="text-right">Record</th><th className="text-right">Decided by</th></tr></thead>
                  <tbody>
                    {[...lineRows, ...poolRows].map(r => (
                      <tr key={r.where + r.id} className="border-t border-white/5"><td className="py-3 text-slate-300">{r.where}</td><td className="font-bold">{r.name}</td><td className="text-right" style={mono}>{fmt(r.points)}</td><td className="text-right" style={mono}>{r.wins}-{r.losses}</td><td className="text-right text-[#ffd98a]">{r.by?.replace('_', ' ')}</td></tr>
                    ))}
                  </tbody>
                </table>
                {lineRows.length + poolRows.length === 0 && <p className="py-3 text-sm text-slate-400">No ties at the automatic-bid line or the wildcard line right now.</p>}
              </div>
              <p className="mt-2 text-sm text-slate-400">No seeds exist before the bracket, so tiebreaker 1 is skipped here.</p>
            </section>
          </div>
          <aside className="space-y-5">
            <section className={card + ' p-5'}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Seed preview</h2>
                <div role="tablist" aria-label="Division" className="inline-flex gap-1 rounded-xl border border-white/10 bg-[#07080d] p-1">
                  {([0, 1] as const).map(i => <button key={i} type="button" role="tab" aria-selected={division === i} onClick={() => setDivision(i)} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-300 aria-selected:bg-[#1a1c26] aria-selected:text-[#ffd98a]">{view.divisions[i].name}</button>)}
                </div>
              </div>
              {d.seeded ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="text-[11px] uppercase tracking-widest text-slate-500"><tr><th className="w-8" />{REGIONS.map(r => <th key={r} className="py-1 text-left">{r}</th>)}</tr></thead>
                    <tbody>
                      {Array.from({ length: lines }, (_, i) => i + 1).map(line => (
                        <tr key={line}><td className="pr-2 text-right text-slate-500" style={mono}>{line}</td>
                          {REGIONS.map(r => { const c = grid.get(`${r}:${line}`); return <td key={r} className={'truncate px-1 py-1 ' + (c?.isWildcard ? 'rounded bg-[#33290f] text-[#ffd98a]' : 'text-slate-200')}>{c?.name ?? '—'}</td> })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-slate-400">The preview appears once the division has enough teams to fill its bracket.</p>}
              <p className="mt-2 text-sm text-slate-400">Gold cells are wildcards (seeds {s.autoBids / 4 + 1}–{lines}). Odd seed lines go N, E, S, W; even lines go W, S, E, N.</p>
            </section>
            <Jobs items={[['Lock regular-season standings', seeding.committed], ['Build 8 region brackets (snake seed lines)', seeding.committed], [`Open week ${view.calendar.bracketStartWeek} bracket games`, seeding.committed], ['Notify every manager', seeding.committed], ['Publish trophy-page bracket', seeding.committed]]} />
            <Audit audits={control.audits} />
          </aside>
        </div>
      )}

      {tab === 'rounds' && (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_520px]">
          <section className={card + ' space-y-3 p-5'}>
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Checklist before the next round</h2>
            {!seeding.committed ? <p className="text-slate-300">Commit seeding first.</p> : !rp ? <p className="text-slate-300">Every round is complete.</p> : (
              <>
                <ol className="space-y-3">
                  <Check n={1} done={!rp.blockers.some(b => /missing|final|waiting/.test(b))} title={`All ${rp.label.toLowerCase()} scores final`} sub={`Week ${rp.week} results from each team’s own league.`} />
                  <Check n={2} done={rounds.correctionsClosed} title="Stat corrections closed" sub="Confirm once the correction window has passed."
                    action={!rounds.correctionsClosed && <button type="button" disabled={busy} onClick={() => act({ action: 'confirm_corrections', week: rp.week }, 'Confirmed.')} className="min-h-11 rounded-xl border border-white/15 px-4 font-bold">Confirm closed</button>} />
                  <Check n={3} done={rp.kind === 'division' ? rp.divisions.every(x => x.needsReview.every(k => overrides[k])) : true} title="Resolve tied games" sub="A tied game goes to the higher seed. Only a tie on seed, record and best week needs you." />
                  <Check n={4} done={rp.blockers.length === 0} title={`Preview the ${rp.label.toLowerCase()}`} sub="Winners are slotted by bracket position." />
                  <Check n={5} done={false} title={`Advance the ${rp.label.toLowerCase()}`} sub={`Locks week ${rp.week}. Losers are eliminated. This can’t be undone.`}
                    action={<div className="flex flex-col gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />I understand</label>
                      <button type="button" disabled={busy || !ack || !rounds.correctionsClosed || rp.blockers.filter(b => !/commissioner decision/.test(b)).length > 0} onClick={() => act({ action: 'advance_round', round: rp.round, overrides }, `${rp.label} advanced.`)} className="min-h-12 rounded-xl bg-[#e8b84a] px-5 font-bold text-[#1a1204] disabled:opacity-40">Advance round</button></div>} />
                </ol>
                {rp.blockers.length > 0 && <ul className="list-disc pl-5 text-sm text-amber-200">{rp.blockers.map(b => <li key={b}>{b}</li>)}</ul>}
                {rp.kind === 'division' && rp.divisions.map((dv, di) => (
                  <div key={di} className="overflow-x-auto">
                    <h3 className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-[#ffd98a]">{view.divisions[di].name} · {rp.label}</h3>
                    <table className="mt-2 w-full min-w-[560px] text-sm">
                      <tbody>
                        {dv.games.map(g => (
                          <tr key={g.key} className="border-t border-white/5">
                            <td className="py-2 text-slate-400">{g.a?.region ?? ''}</td>
                            <td className={g.winnerId && g.winnerId === g.a?.id ? 'font-bold text-white' : 'text-slate-300'}>{g.a ? `${g.a.seedLine} · ${g.a.name}` : 'TBD'}</td>
                            <td className="text-right" style={mono}>{fmt(g.scoreA)}–{fmt(g.scoreB)}</td>
                            <td className={g.winnerId && g.winnerId === g.b?.id ? 'pl-3 font-bold text-white' : 'pl-3 text-slate-300'}>{g.b ? `${g.b.seedLine} · ${g.b.name}` : 'TBD'}</td>
                            <td className="text-right text-[#ffd98a]">
                              {dv.needsReview.includes(g.key) && g.a && g.b ? (
                                <select aria-label={`Winner of ${g.a.name} v ${g.b.name}`} value={overrides[g.key] ?? ''} onChange={e => setOverrides(o => ({ ...o, [g.key]: e.target.value }))} className="min-h-11 rounded-lg border border-white/15 bg-[#07080d] px-2">
                                  <option value="">Choose winner</option><option value={g.a.id}>{g.a.name}</option><option value={g.b.id}>{g.b.name}</option>
                                </select>
                              ) : g.decidedBy && g.decidedBy !== 'score' ? `tie · ${g.decidedBy.replace('_', ' ')}` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {rp.kind === 'championship' && <p className="text-slate-200">{rp.champs[0]?.name ?? 'TBD'} {fmt(rp.scores[0]?.points)} – {fmt(rp.scores[1]?.points)} {rp.champs[1]?.name ?? 'TBD'}</p>}
              </>
            )}
          </section>
          <aside className="space-y-5">
            <section className={card + ' p-5'}>
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Rounds · ends one week before the season</h2>
              <ol className="mt-2">
                {view.calendar.weeks.map((w, i) => {
                  const status = i < rounds.committedRounds ? 'Done' : i === rounds.committedRounds && seeding.committed ? 'Posted' : 'Next'
                  return <li key={w.week} className="flex items-center gap-3 border-b border-white/5 py-3"><span aria-hidden="true" className={'h-3 w-3 rounded-full ' + (status === 'Done' ? 'bg-[#6fe0a8]' : status === 'Posted' ? 'bg-[#e8b84a]' : 'bg-slate-600')} /><span className="flex-1">Week {w.week} · {w.label}{w.kind === 'championship' ? ` · season week ${s.seasonLength} − 1` : ''}</span><span className={'text-sm ' + (status === 'Done' ? 'text-[#6fe0a8]' : status === 'Posted' ? 'text-[#e8b84a]' : 'text-slate-500')} style={mono}>{status}</span></li>
                })}
              </ol>
            </section>
            <Audit audits={control.audits} />
          </aside>
        </div>
      )}

      {tab === 'notifications' && <TournamentNotificationsPanel view={view} />}
    </main>
  )
}

function DraftRow({ league, disabled, onSave }: { league: { id: string; name: string; draftAt: string | null; teams: number }; disabled: boolean; onSave: (iso: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0e1018] p-3">
      <span className="min-w-0 flex-1"><b>{league.name}</b> <span className="text-sm text-slate-400">· {league.teams} teams · {league.draftAt ? new Date(league.draftAt).toLocaleString() : 'no time yet'}</span></span>
      <input type="datetime-local" aria-label={`Draft time for ${league.name}`} value={value} onChange={e => setValue(e.target.value)} className="min-h-11 rounded-lg border border-white/15 bg-[#07080d] px-2" />
      <button type="button" disabled={disabled || !value} onClick={() => onSave(new Date(value).toISOString())} className="min-h-11 rounded-lg border border-white/15 px-3 font-bold disabled:opacity-40">Set</button>
    </li>
  )
}

function Jobs({ items }: { items: Array<[string, boolean]> }) {
  return (
    <section className={card + ' p-5'}>
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Setup jobs</h2>
      <ul className="mt-2">{items.map(([label, done]) => <li key={label} className="flex items-center gap-3 border-b border-white/5 py-3"><span aria-hidden="true" className={'h-3 w-3 rounded-full ' + (done ? 'bg-[#6fe0a8]' : 'bg-slate-600')} /><span className="flex-1">{label}</span><span className={'text-sm ' + (done ? 'text-[#6fe0a8]' : 'text-slate-500')} style={mono}>{done ? 'Done' : 'Waiting'}</span></li>)}</ul>
    </section>
  )
}

function Audit({ audits }: { audits: Control['audits'] }) {
  return (
    <section className={card + ' p-5'}>
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Audit log</h2>
      {audits.length === 0 ? <p className="mt-2 text-sm text-slate-400">Nothing recorded yet.</p> : (
        <ol className="mt-2">
          {audits.slice(0, 12).map(a => (
            <li key={a.id} className="border-b border-white/5 py-3"><p className="font-bold">{AUDIT_TEXT[a.action] ?? a.action.replace('divisions_', '').replaceAll('_', ' ')}</p><p className="text-sm text-slate-400">{new Date(a.at).toLocaleString()}</p></li>
          ))}
        </ol>
      )}
    </section>
  )
}

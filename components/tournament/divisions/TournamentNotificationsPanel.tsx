'use client'
/**
 * TournamentNotifications: the seven moments, the lock-screen push, the email and
 * the default channel matrix. Copy is rendered from the same `MOMENTS` templates
 * the server sends, so what the commissioner previews is what managers receive.
 */
import { useState } from 'react'
import { MOMENTS, type Channel, type MomentContext, type MomentId } from '@/lib/tournament/divisions/moments'
import { libraryPath, leagueDisplayName } from '@/lib/tournament/divisions/identity'
import type { HubView } from '@/lib/tournament/divisions/hubView'

const CHANNELS: Array<[Channel, string]> = [['push', 'Push'], ['inApp', 'In-app'], ['email', 'Email'], ['leagueChat', 'League chat']]
const ICON: Record<MomentId, string> = { league_revealed: 'smoke', draft_scheduled: 'vet', made_the_cut: 'sprout', eliminated: 'skull', wildcard_clinched: 'crosshair', on_the_bubble: 'scales', champion: 'shieldstar' }

export function TournamentNotificationsPanel({ view }: { view: HubView }) {
  const [selected, setSelected] = useState<MomentId>('league_revealed')
  const conf = view.identity.conferences[Math.min(5, view.identity.conferences.length - 1)]!
  const div = view.identity.divisions[0]
  const ctx: MomentContext = {
    tournament: `${view.identity.divisions[0].name} vs ${view.identity.divisions[1].name}`, league: leagueDisplayName(conf.name, div.name), division: div.name,
    teams: view.settings.teamsPerConference, draftAt: 'Sat, Sep 5, 7:00 PM ET', seedLine: 14, rank: view.settings.autoBids + 6,
    round: 'Round of 64', nextRound: 'Round of 32', line: view.divisions[0].pool.lineToBeat ?? 1043.2, week: view.calendar.seedingLocksAfter, opponent: 'the Division B champion',
  }
  const moment = MOMENTS.find(m => m.id === selected)!
  const stack = [moment, ...MOMENTS.filter(m => m.id !== selected).slice(0, 2)]
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[300px_380px_minmax(0,1fr)]">
      <section aria-labelledby="moments-h">
        <h2 id="moments-h" className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Moments</h2>
        <ul className="space-y-2">
          {MOMENTS.map(m => (
            <li key={m.id}>
              <button type="button" onClick={() => setSelected(m.id)} aria-pressed={selected === m.id} className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-white/10 bg-[#0b0d14] p-3 text-left aria-pressed:border-[#e8b84a] aria-pressed:bg-[#1a160c]">
                <img src={libraryPath(ICON[m.id])} alt="" width={36} height={36} />
                <span><b className="block text-white">{m.label}</b><span className="text-sm text-slate-400">{m.trigger}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Lock screen preview" className="rounded-[44px] border-8 border-[#1a1c26] bg-gradient-to-b from-[#3a3524] via-[#12131a] to-[#2a2616] p-5">
        <p className="mt-6 text-center text-lg text-white/80">Lock screen</p>
        <ul className="mt-10 space-y-3">
          {stack.map((m, i) => (
            <li key={m.id} className={'rounded-2xl p-3 backdrop-blur ' + (i === 0 ? 'bg-white/15' : 'bg-white/5 opacity-80')}>
              <p className="flex justify-between text-[11px] font-bold uppercase tracking-widest text-white/60"><span>AllFantasy</span><span>{i === 0 ? 'now' : ''}</span></p>
              <p className="font-bold text-white">{m.title(ctx)}</p>
              <p className="text-sm text-white/80">{m.body(ctx)}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-center text-sm text-white/50">Newest on top</p>
      </section>
      <div className="space-y-5">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d14]">
          <div className="border-b border-white/10 p-4"><p className="text-sm text-slate-400">From AllFantasy · to you</p><p className="font-bold text-white">{moment.title(ctx)}</p></div>
          <div className="p-5">
            <p className="text-slate-200">{moment.body(ctx)}</p>
            <p className="mt-4 text-sm text-slate-500">{moment.defaults.email ? 'Sent by email too.' : 'No email for this moment by default.'} Managers can turn off any channel in Settings → Notifications.</p>
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-[#0b0d14] p-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Default channels · managers can turn any of these off</h2>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-slate-500"><tr><th className="py-2 text-left">Moment</th>{CHANNELS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>
                {MOMENTS.map(m => (
                  <tr key={m.id} className={'border-t border-white/5 ' + (m.id === selected ? 'bg-[#1a160c]' : '')}>
                    <td className="py-2 font-semibold text-white">{m.label}</td>
                    {CHANNELS.map(([c, l]) => <td key={c} className="text-center"><span aria-label={`${l} ${m.defaults[c] ? 'on' : 'off'}`} className={'rounded px-2 py-0.5 text-[11px] font-black ' + (m.defaults[c] ? 'bg-[#10291e] text-[#6fe0a8]' : 'bg-[#1a1c26] text-slate-500')}>{m.defaults[c] ? 'ON' : 'OFF'}</span></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

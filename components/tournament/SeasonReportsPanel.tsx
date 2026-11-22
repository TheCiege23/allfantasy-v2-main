'use client'

import { useEffect, useState } from 'react'
import { seasonReportCsvPath, seasonReportPath, type SeasonReportVersion, type SeasonReportView } from '@/lib/tournament/seasonReportFormat'

const control = 'min-h-11 rounded-lg border border-white/20 bg-slate-900 px-3 py-2 text-sm'
const stageAudience = JSON.stringify({ scope: 'stage' })
const label = (version: SeasonReportVersion) => 'Stage ' + version.stage + ' · Period ' + version.period + ' · v' + version.revision + ' · ' + version.status

async function readReportJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, cache: 'no-store' })
  if (!response.ok) throw new Error('The standings archive could not be loaded.')
  return response.json()
}

export function SeasonReportsPanel({ tournamentId }: { tournamentId: string }) {
  const [versions, setVersions] = useState<SeasonReportVersion[]>([])
  const [selected, setSelected] = useState('')
  const [report, setReport] = useState<SeasonReportView | null>(null)
  const [canPost, setCanPost] = useState(false)
  const [audience, setAudience] = useState(stageAudience)
  const [refresh, setRefresh] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    readReportJson(seasonReportPath(tournamentId), controller.signal).then(body => {
      const reports: SeasonReportVersion[] = body.reports
      setVersions(reports)
      setCanPost(body.canPost)
      setSelected(previous => reports.some(item => item.id === previous) ? previous : reports[0]?.id ?? '')
      setLoaded(true)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [tournamentId, refresh])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    readReportJson(seasonReportPath(tournamentId, selected), controller.signal).then(setReport)
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [tournamentId, selected])

  async function send() {
    if (!report || report.id !== selected || sending) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(seasonReportPath(tournamentId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.id, audience: JSON.parse(audience) }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Chat delivery could not be confirmed. Retry this version.')
      setNotice(result.posted + ' posted · ' + result.alreadyPosted + ' already delivered · ' + result.unavailable + ' unavailable')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Chat delivery could not be confirmed.')
    } finally {
      setSending(false)
    }
  }

  const current = report?.id === selected ? report : null
  const leagues = new Map(current?.leagues.map(league => [league.id, league]))
  const divisions = [...new Set(current?.leagues.flatMap(league => league.division ? [league.division] : []))]
  return <section className="space-y-4 rounded-2xl border border-white/15 bg-slate-950 p-4 text-white sm:p-6" aria-label="Standings report archive">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-xl font-semibold">Standings report archive</h2>
      <button type="button" className={control} onClick={() => { setError(''); setRefresh(value => value + 1) }}>Refresh versions</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {loaded && !versions.length && <p className="text-sm text-slate-300">Reports appear after the first scoring period ends.</p>}
    {versions.length > 0 && <label className="block text-sm">Report version<select className={control + ' mt-1 block w-full'} value={selected} disabled={sending} onChange={e => {
      setError(''); setNotice(''); setAudience(stageAudience); setSelected(e.target.value)
    }}>{versions.map(version => <option key={version.id} value={version.id}>{label(version)}</option>)}</select></label>}
    {selected && !current && !error && <p role="status">Loading report…</p>}
    {current && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-300">{label(current)} · <time dateTime={current.publishedAt}>{new Date(current.publishedAt).toLocaleString()}</time></p>
        <a className={control + ' inline-flex items-center text-cyan-200'} href={seasonReportCsvPath(tournamentId, current.id)}>Download CSV</a>
      </div>
      <p className="text-sm text-slate-300">Tournament summary · {current.summary}</p>
      {current.status === 'corrected' && <p className="text-sm text-slate-300">{current.official ? 'This is the approved correction to a finalized report.' : 'This revision contains a score correction and remains provisional.'}</p>}
      <p className="break-all text-xs text-slate-400">Report {current.id}{current.previousId && ' · Supersedes ' + current.previousId}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label(current)} standings</caption>
          <thead className="text-slate-300"><tr>{['Rank / seed', 'Manager', 'League', 'League / division rank', 'Record', 'Period PF / PA', 'Stage PF / PA', 'Standing'].map(title => <th key={title} scope="col" className="px-2 py-2">{title}</th>)}</tr></thead>
          <tbody>{current.rows.map((row, index) => <tr key={index} className="border-t border-white/10">
            <td className="px-2 py-2">{row.rank ?? '—'}{row.seedMovement ? ' (' + (row.seedMovement > 0 ? '+' : '') + row.seedMovement + ')' : ''}</td>
            <th scope="row" className="px-2 py-2 font-medium">{row.manager}</th>
            <td className="px-2 py-2">{leagues.get(row.leagueId)?.name}{leagues.get(row.leagueId)?.division && <small className="block">{leagues.get(row.leagueId)?.division}</small>}</td>
            <td className="px-2 py-2">{row.leagueRank ?? '—'} / {row.divisionRank ?? '—'}</td>
            <td className="px-2 py-2">{row.wins}–{row.losses}–{row.ties}</td>
            <td className="px-2 py-2">{row.weekPoints ?? '—'} / {row.weekAgainst ?? '—'}</td>
            <td className="px-2 py-2">{row.pointsFor ?? '—'} / {row.pointsAgainst ?? '—'}</td>
            <td className="px-2 py-2">{row.standing}<small className="block text-slate-300">{row.reason}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
      {canPost && <div className="space-y-2 border-t border-white/15 pt-3">
        <p className="text-sm text-slate-300">Scheduled delivery posts each version to its league chats. Retry delivery for a specific audience here.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">Chat audience<select className={control + ' mt-1 block'} value={audience} disabled={sending} onChange={e => setAudience(e.target.value)}>
            <option value={stageAudience}>All leagues in this stage</option>
            {divisions.map(target => <option key={target} value={JSON.stringify({ scope: 'division', target })}>Division · {target}</option>)}
            {current.leagues.map(league => <option key={league.id} value={JSON.stringify({ scope: 'league', target: league.id })}>League · {league.name}</option>)}
          </select></label>
          <button type="button" className={control + ' text-cyan-200'} disabled={sending} onClick={send}>{sending ? 'Checking delivery…' : 'Retry chat delivery'}</button>
        </div>
        {notice && <p role="status" className="text-sm text-cyan-200">{notice}</p>}
      </div>}
    </>}
  </section>
}

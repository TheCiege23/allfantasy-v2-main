'use client'

import { useState } from 'react'
import { reportTsv, weeklyOverview, weeklyRecap, type WeeklyReport } from '@/lib/tournament/weeklyReport'

/**
 * ⚠ BLANK IS "LATEST", AND THE CONTROL HAS TO SAY SO. The route resolves an
 * absent week to the newest one carrying actual scoring activity — a number
 * input with a `placeholder` only whispers that, because a placeholder reads as
 * a hint about what to type rather than as the value in force. A select makes
 * "Latest" a real, selected option, which is what it has always been.
 *
 * ⚠ 18 WEEKS, NOT THE ROUTE'S 53. The API accepts 1–53 because it also serves
 * sports whose seasons run long; offering a commissioner 53 fantasy weeks is a
 * menu nobody can use. A week beyond this list is still reachable by the API,
 * and `week` is a string here precisely so it stays free-form for that.
 */
const WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => String(i + 1))

export function WeeklyReportPanel({
  tournamentId,
  oldestUpdatedAt,
}: {
  tournamentId: string
  /** The stalest league's timestamp — the real age of every number on the page. */
  oldestUpdatedAt?: Date | string | null
}) {
  const [season, setSeason] = useState(String(new Date().getFullYear()))
  const [week, setWeek] = useState('')
  const [activeSheet, setActiveSheet] = useState(0)
  const [report, setReport] = useState<WeeklyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function load() {
    setBusy(true)
    setReport(null)
    setMessage('')
    try {
      const res = await fetch(`/api/tournament/${encodeURIComponent(tournamentId)}/weekly-report?season=${encodeURIComponent(season)}&week=${encodeURIComponent(week)}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Report could not be loaded')
      setReport(data)
      setActiveSheet(0)
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Report could not be loaded') }
    finally { setBusy(false) }
  }
  async function copy() {
    if (!report) return
    try { await navigator.clipboard.writeText(reportTsv(report)); setMessage('Copied. Paste into Excel or Google Sheets.') }
    catch { setMessage('Copy unavailable. Select and copy the report text below.') }
  }
  async function copyRecap() {
    if (!report) return
    try { await navigator.clipboard.writeText(weeklyRecap(report)); setMessage('Weekly recap copied. Ready to share with your managers.') }
    catch { setMessage('Copy unavailable. Select the weekly recap text below.') }
  }
  const overview = report ? weeklyOverview(report) : null
  async function download() {
    if (!report) return
    try {
      const XLSX = await import('xlsx')
      const workbook = XLSX.utils.book_new()
      for (const sheet of report.sheets) {
        const ws = XLSX.utils.aoa_to_sheet(sheet.rows)
        ws['!cols'] = sheet.rows[0].map(() => ({ wch: 24 }))
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name)
      }
      XLSX.writeFile(workbook, `tournament-${report.season}-week-${report.week}.xlsx`)
      setMessage('Excel download ready.')
    } catch { setMessage('Download failed. You can still copy the report below.') }
  }
  return <section className="af-th-league">
    <h2 className="af-th-league-name">Weekly report · all conferences</h2>
    <p className="af-th-note">Manager status, weekly scores and the top 25 scoring teams across every connected league. Leave week on Latest for the most recent scoring activity — standings always show the latest sync, weekly points use the reported week.</p>
    <div className="af-th-fields">
      <label className="af-th-field"><span>Season</span><input className="af-th-input af-th-input--num" type="number" disabled={busy} value={season} onChange={(e) => { setSeason(e.target.value); setReport(null) }} /></label>
      <label className="af-th-field"><span>Week</span>
        <span className="af-th-selectwrap">
          <select className="af-th-select" disabled={busy} value={week} onChange={(e) => { setWeek(e.target.value); setReport(null) }}>
            <option value="">Latest</option>
            {WEEK_OPTIONS.map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
          <span className="af-th-selectwrap-chevron" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </span>
      </label>
      <button className="af-th-copy" disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Build weekly report'}</button>
      {/*
        ⚠ STALENESS SITS BESIDE THE WEEK IT QUALIFIES. These records are only as
        fresh as the STALEST league's last sync, and a commissioner about to cut
        176 managers on them is entitled to read that here rather than assume
        "now" from a week number they just chose.
      */}
      {oldestUpdatedAt ? <span className="af-th-freshness">Records as last synced. Oldest league last updated {new Date(oldestUpdatedAt).toLocaleString()}.</span> : null}
    </div>
    {report && <div className="af-th-actions">
      <button className="af-th-copy af-th-copy--ghost" onClick={copyRecap}>Copy weekly recap</button><button className="af-th-copy af-th-copy--ghost" onClick={copy}>Copy report for Excel</button><button className="af-th-copy af-th-copy--ghost" onClick={download}>Download Excel (.xlsx)</button>
    </div>}
    {message && <p role="status" className="af-th-note">{message}</p>}
    {report && <>
      <p className="af-th-note"><strong>{report.season} · Week {report.week}</strong> · {report.sheets[0].rows.length - 1} managers across all conferences</p>
      {overview && <div className="af-th-actions" aria-label="Weekly overview">
        <button type="button" className="af-th-linkbtn" onClick={() => setActiveSheet(0)}>{overview.aboveCut} above cut · {overview.bubble} bubble · {overview.belowCut} below cut · {overview.needsLink} need team links</button>
        <button type="button" className="af-th-linkbtn" onClick={() => setActiveSheet(2)}>{overview.missingLeagues} leagues missing scores</button>
      </div>}
      <div className="af-th-actions" role="group" aria-label="Report views">
        {report.sheets.slice(0, 3).map((sheet, index) => <button key={sheet.name} type="button" className="af-th-linkbtn" aria-pressed={activeSheet === index} onClick={() => setActiveSheet(index)}>{sheet.name}</button>)}
      </div>
      {report.sheets[2].rows.slice(1).some((r) => Number(r[4]) > 0) && <p className="af-th-warn" role="status">Some managers have no collected score for this week. The leaderboard is partial; see data coverage below.</p>}
      <div className="af-th-scroll"><table className="af-th-table" aria-label={report.sheets[activeSheet].name}><thead><tr>{report.sheets[activeSheet].rows[0].map((v, i) => <th scope="col" key={i}>{v}</th>)}</tr></thead><tbody>{report.sheets[activeSheet].rows.slice(1).map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
      {report.sheets[1].rows.length === 1 && <p className="af-th-warn">No weekly scores collected for the selected week.</p>}
      <details><summary>Weekly recap preview</summary><textarea aria-label="Weekly recap text" className="af-th-pastebox" readOnly value={weeklyRecap(report)} rows={10} /></details>
      <details><summary>Plain text for copying</summary><textarea aria-label="Weekly report text" className="af-th-pastebox" readOnly value={reportTsv(report)} rows={14} /></details>
    </>}
  </section>
}

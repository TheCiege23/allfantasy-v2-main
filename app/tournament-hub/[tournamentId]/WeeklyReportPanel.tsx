'use client'

import { useState } from 'react'
import { reportTsv, type WeeklyReport } from '@/lib/tournament/weeklyReport'

export function WeeklyReportPanel({ tournamentId }: { tournamentId: string }) {
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
    <p className="af-th-note">Manager status, weekly scores and the top 25 scoring teams across every connected league. Leave week blank for the latest week with scoring activity. Standings show the latest sync; weekly points use the reported week.</p>
    <div className="af-th-actions">
      <label className="af-th-field">Season<input className="af-th-input af-th-input--num" type="number" disabled={busy} value={season} onChange={(e) => { setSeason(e.target.value); setReport(null) }} /></label>
      <label className="af-th-field">Week<input className="af-th-input af-th-input--num" type="number" disabled={busy} placeholder="Latest" min="1" max="53" value={week} onChange={(e) => { setWeek(e.target.value); setReport(null) }} /></label>
      <button className="af-th-copy" disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Build weekly report'}</button>
      {report && <>
<button className="af-th-copy" onClick={copy}>Copy report for Excel</button><button className="af-th-copy" onClick={download}>Download Excel (.xlsx)</button></>}
    </div>
    {message && <p role="status" className="af-th-note">{message}</p>}
    {report && <>
      <p className="af-th-note"><strong>{report.season} · Week {report.week}</strong> · {report.sheets[0].rows.length - 1} managers across all conferences</p>
      <div className="af-th-actions" role="group" aria-label="Report views">
        {report.sheets.slice(0, 3).map((sheet, index) => <button key={sheet.name} type="button" className="af-th-linkbtn" aria-pressed={activeSheet === index} onClick={() => setActiveSheet(index)}>{sheet.name}</button>)}
      </div>
      {report.sheets[2].rows.slice(1).some((r) => Number(r[4]) > 0) && <p className="af-th-warn" role="status">Some managers have no collected score for this week. The leaderboard is partial; see data coverage below.</p>}
      <div className="af-th-scroll"><table className="af-th-table" aria-label={report.sheets[activeSheet].name}><thead><tr>{report.sheets[activeSheet].rows[0].map((v, i) => <th scope="col" key={i}>{v}</th>)}</tr></thead><tbody>{report.sheets[activeSheet].rows.slice(1).map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>
      {report.sheets[1].rows.length === 1 && <p className="af-th-warn">No weekly scores collected for the selected week.</p>}
      <details><summary>Plain text for copying</summary><textarea aria-label="Weekly report text" readOnly value={reportTsv(report)} rows={14} style={{ width: '100%', color: 'inherit', background: 'transparent' }} /></details>
    </>}
  </section>
}

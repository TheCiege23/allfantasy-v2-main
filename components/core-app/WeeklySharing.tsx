'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { weeklySharingMessages } from '@/lib/core-app/messages/weeklySharing'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import type { WeeklyPlayoffPath } from '@/lib/core-app/weeklyPlayoffPath'
import { commissionerWeekDraft, drawWeeklyShareCard, rivalryNarrative, weeklySocialPost, weeklyCardScenarios, WEEK_PUBLIC_URL, WEEK_SOCIALS, type WeekSocial } from '@/lib/core-app/weeklyShare'
import { COMMS_OPEN_EVENT } from './comms/commsEvents'
import { formatPct1 } from '@/lib/core-app/weeklyPercent'
import CommissionerWeeklyPlan from './CommissionerWeeklyPlan'
import { WeeklyXPublisher } from './WeeklyXPublisher'

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = url; link.download = filename; link.click(); setTimeout(()=>URL.revokeObjectURL(url),60000)
}
export function WeeklySharing({ data, path }: { data: WeeklyBlueprint; path?: WeeklyPlayoffPath | null }) {
  const {language} = useOptionalLanguage(); const es = language === 'es'
  const m = useMessages(weeklySharingMessages)
  const [platform,setPlatform] = useState<WeekSocial>('X')
  const [status,setStatus] = useState(''); const [busy,setBusy] = useState(false)
  const [image,setImage] = useState<File | null>(null)
  const [includeStory,setIncludeStory] = useState(true)
  const [previewOpen,setPreviewOpen] = useState(false)
  const [xConnection,setXConnection] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Coming back from X's consent screen (?xConnection=connected|failed|denied|sign_in): reopen the
  // X publisher so the result is visible, then drop the flag so a reload does not repeat it.
  useEffect(()=>{
    try {
      const url = new URL(window.location.href), result = url.searchParams.get('xConnection')
      if (!result) return
      setXConnection(result); setPlatform('X'); setPreviewOpen(true)
      url.searchParams.delete('xConnection'); window.history.replaceState(window.history.state, '', url.toString())
    } catch {}
  },[])
  const cardGeneration = useRef(0)
  const shareData = useMemo(()=>includeStory ? data : {...data,rivalry:undefined},[data,includeStory])
  const scenario = weeklyCardScenarios(shareData,path)
  useEffect(()=>{cardGeneration.current++;setImage(null);setStatus('')},[shareData,path,es])
  useEffect(()=>{
    if (!previewOpen || !canvasRef.current) return
    try { drawWeeklyShareCard(canvasRef.current,shareData,es,path) }
    catch { setStatus(m.previewUnavailable) }
  },[previewOpen,shareData,path,es,m])
  const post = weeklySocialPost(shareData,platform,es), story = rivalryNarrative(data,es)
  const commId = data.focusLeagueId && data.commissionerLeagueIds?.includes(data.focusLeagueId) ? data.focusLeagueId : null
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setStatus(m.copied) }
    catch { setStatus(m.selectAndCopy) }
  }
  async function share() {
    if (!navigator.share) { await copy(post); return }
    try { await navigator.share({title:'AllFantasy · Your Week',text:post}); setStatus(m.shared) }
    catch(e) { if ((e as Error).name !== 'AbortError') { await copy(post) } }
  }
  async function createImage() {
    setBusy(true)
    const generation = cardGeneration.current
    try {
      const canvas = document.createElement('canvas'); drawWeeklyShareCard(canvas,shareData,es,path)
      const blob = await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b ? resolve(b) : reject(new Error('Image unavailable')),'image/png'))
      if (generation !== cardGeneration.current) return
      const file = new File([blob],'allfantasy-your-week.png',{type:'image/png'})
      setImage(file); download(file,file.name); setStatus(m.cardDownloaded)
    } catch { setStatus(m.cardFailed) }
    finally { setBusy(false) }
  }
  async function shareImage() {
    if (!image) return
    if (!navigator.canShare?.({files:[image]})) { download(image,image.name); return }
    try { await navigator.share({files:[image]}) }
    catch(e) { if ((e as Error).name !== 'AbortError') setStatus(m.useDownloadedCard) }
  }
  async function exportExcel() {
    setBusy(true)
    try {
      const {buildWeeklyWorkbook} = await import('@/lib/core-app/weeklyWorkbook')
      const bytes = buildWeeklyWorkbook(data,path,es)
      download(new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'allfantasy-your-week.xlsx')
      setStatus(m.excelDownloaded)
    } catch { setStatus(m.exportFailed) }
    finally { setBusy(false) }
  }
  const announcement = commissionerWeekDraft(data,es,path)
  const probability = path?.league?.you?.playoffPct
  const hasCharts = !!path?.league?.you?.modelled && path.league.season === path.season && path.league.period === path.period && probability != null && Number.isFinite(probability) && probability >= 0 && probability <= 100 && (path.points.some(p=>Number.isInteger(p.period) && p.period > 0 && Number.isFinite(p.probability) && p.probability >= 0 && p.probability <= 100) || !!(path.swing && path.swing.week >= path.period && [path.swing.ifWin,path.swing.ifLose].every(p=>Number.isFinite(p) && p >= 0 && p <= 100)))
  const askCommissioner = () => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT,{detail:{tab:'chimmy',leagueId:commId,prefill:`${announcement}\n${m.commissionerPrompt}`}}))
  return <section className="af-wbp-share">
    {story ? <div><h3>{m.storyTitle}</h3><p>{story}</p><button type="button" onClick={()=>copy(story)}>{m.copyMotivation}</button><p><small>{m.storyCaveat}</small></p></div> : null}
    <details open={previewOpen} onToggle={e=>setPreviewOpen(e.currentTarget.open)}><summary>{m.shareSummary}</summary>
      <p>{m.reviewBeforeSharing}</p>
      <label>{m.platform} <select value={platform} onChange={e=>{setPlatform(e.target.value as WeekSocial);setImage(null)}}>{WEEK_SOCIALS.map(p=><option key={p}>{p}</option>)}</select></label>
      {story ? <label className="af-wbp-check"><input type="checkbox" checked={includeStory} onChange={e=>{setIncludeStory(e.target.checked);setImage(null)}} />{m.includeStory}</label> : null}
      <div className="af-wbp-share-workspace"><div>
      <textarea aria-label={m.postLabel} value={post} readOnly onFocus={e=>e.target.select()} rows={7}/>
      <div className="af-wbp-buttons"><button type="button" onClick={()=>copy(post)}>{m.copyPost}</button><button type="button" onClick={share}>{m.shareToApps}</button>
        {platform === 'X' ? <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(post)}`} target="_blank" rel="noopener noreferrer">{m.openXDraft}</a> : null}
        {platform === 'Facebook' ? <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(WEEK_PUBLIC_URL)}`} target="_blank" rel="noopener noreferrer">{m.openFacebook}</a> : null}
        <button type="button" disabled={busy} onClick={createImage}>{m.downloadPng}</button>
        {image ? <button type="button" onClick={shareImage}>{m.shareCard}</button> : null}
        <button type="button" disabled={busy} onClick={exportExcel}>{hasCharts ? m.downloadExcelCharts : m.downloadExcel}</button>
      </div></div>{previewOpen ? <figure className="af-wbp-card-preview"><canvas ref={canvasRef} role="img" aria-label={m.previewLabel}/><figcaption>{m.cardSize}{scenario ? m.scenario(scenario.period, formatPct1(scenario.ifWin), formatPct1(scenario.ifLose)) : m.noScenarios}</figcaption></figure> : null}</div><p><small>{m.otherPlatforms}</small></p>
      {previewOpen && platform === 'X' ? <WeeklyXPublisher post={post} leagueId={data.focusLeagueId} es={es} connectionResult={xConnection}/> : null}
      {!hasCharts ? <p><small>{m.noCharts}</small></p> : null}
    </details>
    {commId ? <details><summary>{m.commissionerPlan}</summary>
      <CommissionerWeeklyPlan key={commId} leagueId={commId} data={data} announcement={announcement} />
      <p>{m.commissionerCheck}</p>
      <div className="af-wbp-buttons"><button type="button" onClick={askCommissioner}>{m.prepareWithChimmy}</button><Link href={`/core/commissioner?league=${encodeURIComponent(commId)}`}>{m.openCommissionerHub}</Link><Link href={`/core/standings?league=${encodeURIComponent(commId)}`}>{m.reviewStandings}</Link></div>
    </details> : data.commissionerLeagueIds?.length ? <Link href="/core/commissioner">{m.prepareManagedLeagues} →</Link> : null}
    <p role="status">{status}</p>
  </section>
}

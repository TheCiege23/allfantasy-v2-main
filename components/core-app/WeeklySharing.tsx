'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
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
  const [platform,setPlatform] = useState<WeekSocial>('X')
  const [status,setStatus] = useState(''); const [busy,setBusy] = useState(false)
  const [image,setImage] = useState<File | null>(null)
  const [includeStory,setIncludeStory] = useState(true)
  const [previewOpen,setPreviewOpen] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardGeneration = useRef(0)
  const shareData = useMemo(()=>includeStory ? data : {...data,rivalry:undefined},[data,includeStory])
  const scenario = weeklyCardScenarios(shareData,path)
  useEffect(()=>{cardGeneration.current++;setImage(null);setStatus('')},[shareData,path,es])
  useEffect(()=>{
    if (!previewOpen || !canvasRef.current) return
    try { drawWeeklyShareCard(canvasRef.current,shareData,es,path) }
    catch { setStatus(es ? 'Vista previa no disponible. Puedes copiar la publicación.' : 'Preview unavailable. You can copy the post.') }
  },[previewOpen,shareData,path,es])
  const post = weeklySocialPost(shareData,platform,es), story = rivalryNarrative(data,es)
  const commId = data.focusLeagueId && data.commissionerLeagueIds?.includes(data.focusLeagueId) ? data.focusLeagueId : null
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setStatus(es ? 'Copiado.' : 'Copied.') }
    catch { setStatus(es ? 'Selecciona el texto y cópialo.' : 'Select the text and copy it.') }
  }
  async function share() {
    if (!navigator.share) { await copy(post); return }
    try { await navigator.share({title:'AllFantasy · Your Week',text:post}); setStatus(es ? 'Compartido.' : 'Shared.') }
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
      setImage(file); download(file,file.name); setStatus(es ? 'Tarjeta descargada. Puedes compartirla abajo.' : 'Card downloaded. You can share it below.')
    } catch { setStatus(es ? 'No se pudo crear la tarjeta. Copia el texto.' : 'Could not create the card. Copy the text instead.') }
    finally { setBusy(false) }
  }
  async function shareImage() {
    if (!image) return
    if (!navigator.canShare?.({files:[image]})) { download(image,image.name); return }
    try { await navigator.share({files:[image]}) }
    catch(e) { if ((e as Error).name !== 'AbortError') setStatus(es ? 'Usa la tarjeta descargada.' : 'Use the downloaded card.') }
  }
  async function exportExcel() {
    setBusy(true)
    try {
      const {buildWeeklyWorkbook} = await import('@/lib/core-app/weeklyWorkbook')
      const bytes = buildWeeklyWorkbook(data,path,es)
      download(new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'allfantasy-your-week.xlsx')
      setStatus(es ? 'Excel descargado.' : 'Excel downloaded.')
    } catch { setStatus(es ? 'No se pudo exportar. Inténtalo de nuevo.' : 'Export failed. Please try again.') }
    finally { setBusy(false) }
  }
  const announcement = commissionerWeekDraft(data,es,path)
  const probability = path?.league?.you?.playoffPct
  const hasCharts = !!path?.league?.you?.modelled && path.league.season === path.season && path.league.period === path.period && probability != null && Number.isFinite(probability) && probability >= 0 && probability <= 100 && (path.points.some(p=>Number.isInteger(p.period) && p.period > 0 && Number.isFinite(p.probability) && p.probability >= 0 && p.probability <= 100) || !!(path.swing && path.swing.week >= path.period && [path.swing.ifWin,path.swing.ifLose].every(p=>Number.isFinite(p) && p >= 0 && p <= 100)))
  const askCommissioner = () => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT,{detail:{tab:'chimmy',leagueId:commId,prefill:`${announcement}\n${es ? 'Ayúdame a preparar un anuncio. Comprueba las reglas y los plazos; no inventes información privada de otros equipos.' : 'Help me prepare an announcement. Check rules and deadlines; do not invent private information about other teams.'}`}}))
  return <section className="af-wbp-share">
    {story ? <div><h3>{es ? 'Tu historia esta semana' : 'Your story this week'}</h3><p>{story}</p><button type="button" onClick={()=>copy(story)}>{es ? 'Copiar motivación' : 'Copy motivation'}</button><p><small>{es ? 'Basado en encuentros importados; el historial puede estar incompleto.' : 'Based on imported meetings; history may be incomplete.'}</small></p></div> : null}
    <details onToggle={e=>setPreviewOpen(e.currentTarget.open)}><summary>{es ? 'Compartir y exportar mi semana' : 'Share and export my week'}</summary>
      <p>{es ? 'Revisa los nombres y las probabilidades antes de compartir. El enlace abre la semana del destinatario; tus datos privados siguen protegidos.' : 'Review names and odds before sharing. The link opens the recipient’s own week; your private page stays protected.'}</p>
      <label>{es ? 'Plataforma' : 'Platform'} <select value={platform} onChange={e=>{setPlatform(e.target.value as WeekSocial);setImage(null)}}>{WEEK_SOCIALS.map(p=><option key={p}>{p}</option>)}</select></label>
      {story ? <label className="af-wbp-check"><input type="checkbox" checked={includeStory} onChange={e=>{setIncludeStory(e.target.checked);setImage(null)}} />{es ? 'Incluir historia del rival' : 'Include opponent story'}</label> : null}
      <div className="af-wbp-share-workspace"><div>
      <textarea aria-label={es ? 'Publicación para copiar' : 'Social post to copy'} value={post} readOnly onFocus={e=>e.target.select()} rows={7}/>
      <div className="af-wbp-buttons"><button type="button" onClick={()=>copy(post)}>{es ? 'Copiar publicación' : 'Copy post'}</button><button type="button" onClick={share}>{es ? 'Compartir en aplicaciones' : 'Share to apps'}</button>
        {platform === 'X' ? <a href={`https://x.com/intent/tweet?text=${encodeURIComponent(post)}`} target="_blank" rel="noopener noreferrer">{es ? 'Abrir borrador en X' : 'Open X draft'}</a> : null}
        {platform === 'Facebook' ? <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(WEEK_PUBLIC_URL)}`} target="_blank" rel="noopener noreferrer">{es ? 'Abrir Facebook' : 'Open Facebook'}</a> : null}
        <button type="button" disabled={busy} onClick={createImage}>{es ? 'Descargar tarjeta PNG' : 'Download PNG card'}</button>
        {image ? <button type="button" onClick={shareImage}>{es ? 'Compartir tarjeta' : 'Share card'}</button> : null}
        <button type="button" disabled={busy} onClick={exportExcel}>{hasCharts ? es ? 'Descargar Excel y gráficos' : 'Download Excel and charts' : es ? 'Descargar Excel' : 'Download Excel'}</button>
      </div></div>{previewOpen ? <figure className="af-wbp-card-preview"><canvas ref={canvasRef} role="img" aria-label={es ? 'Vista previa de tu tarjeta semanal' : 'Preview of your weekly share card'}/><figcaption>{es ? 'Tarjeta 1080 × 1350. ' : '1080 × 1350 card. '}{scenario ? es ? `Período ${scenario.period}: si ganas ${formatPct1(scenario.ifWin)}%; si pierdes ${formatPct1(scenario.ifLose)}%.` : `Period ${scenario.period}: if you win ${formatPct1(scenario.ifWin)}%; if you lose ${formatPct1(scenario.ifLose)}%.` : es ? 'Sin escenarios verificados para este enfrentamiento.' : 'No verified scenarios for this matchup.'}</figcaption></figure> : null}</div><p><small>{es ? 'Instagram, TikTok y YouTube: pega el texto y adjunta la tarjeta descargada. Las aplicaciones disponibles dependen de tu dispositivo.' : 'Instagram, TikTok and YouTube: paste the caption and attach the downloaded card. Available share apps depend on your device.'}</small></p>
      {previewOpen && platform === 'X' ? <WeeklyXPublisher post={post} leagueId={data.focusLeagueId} es={es}/> : null}
      {!hasCharts ? <p><small>{es ? 'Abre una liga con un modelo de playoffs disponible para exportar sus gráficos.' : 'Open a league with an available playoff model to export its charts.'}</small></p> : null}
    </details>
    {commId ? <details><summary>{es ? 'Plan del comisionado' : 'Commissioner weekly plan'}</summary>
      <CommissionerWeeklyPlan key={commId} leagueId={commId} data={data} announcement={announcement} />
      <p>{es ? 'Comprueba plazos, puntuación pendiente y reglas de playoffs antes de publicar un resumen.' : 'Check deadlines, pending scoring and playoff rules before publishing a briefing.'}</p>
      <div className="af-wbp-buttons"><button type="button" onClick={askCommissioner}>{es ? 'Preparar con Chimmy' : 'Prepare with Chimmy'}</button><Link href={`/core/commissioner?league=${encodeURIComponent(commId)}`}>{es ? 'Abrir Centro del comisionado' : 'Open Commissioner Hub'}</Link><Link href={`/core/standings?league=${encodeURIComponent(commId)}`}>{es ? 'Revisar clasificación' : 'Review standings'}</Link></div>
    </details> : data.commissionerLeagueIds?.length ? <Link href="/core/commissioner">{es ? 'Preparar las ligas que administras' : 'Prepare the leagues you manage'} →</Link> : null}
    <p role="status">{status}</p>
  </section>
}

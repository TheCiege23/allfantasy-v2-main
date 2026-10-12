'use client'

import { useRef, useState } from 'react'
import { Download, Share2 } from 'lucide-react'
import { survivorSceneArtwork } from '@/lib/survivor/survivorVisuals'

type Moment = 'voted_out' | 'idol_played' | 'champion'
type Format = 'post' | 'story' | 'link'
const FORMATS: Record<Format, { label: string; ratio: string }> = {
  post: { label: 'Post 4:5', ratio: '4 / 5' },
  story: { label: 'Story 9:16', ratio: '9 / 16' },
  link: { label: 'Link 1.91:1', ratio: '1.91 / 1' },
}
const ART: Record<Moment, string> = {
  voted_out: '/survivor/weekly/torch-out.svg',
  idol_played: '/survivor/idols/immunity.svg',
  champion: '/survivor/late/champion-trophy.svg',
}

/** Renders only already-published facts supplied by the league summary. */
export function SurvivorShareCard({ moment, sport, leagueName, week, headline, caption }: {
  moment: Moment; sport: string; leagueName: string; week: number; headline: string; caption: string
}) {
  const [format, setFormat] = useState<Format>('post')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const card = useRef<HTMLDivElement>(null)

  async function renderPng(): Promise<Blob> {
    if (!card.current) throw new Error('Card is not ready.')
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(card.current, { scale: 2, useCORS: true, backgroundColor: '#080b11' })
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export card.')), 'image/png'))
  }

  async function save(share: boolean) {
    setBusy(true)
    setError(null)
    try {
      const blob = await renderPng()
      const file = new File([blob], `allfantasy-${moment}-week-${week}.png`, { type: 'image/png' })
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: headline })
      } else {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = file.name
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
    } catch (cause) {
      if (cause instanceof Error && cause.name !== 'AbortError') setError(cause.message)
    } finally { setBusy(false) }
  }

  return <section className="rounded-2xl border border-amber-300/20 bg-[#080b11] p-4 text-white">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-amber-100">Share this published moment</h3>
      <div className="flex gap-1" role="group" aria-label="Share card size">
        {(Object.keys(FORMATS) as Format[]).map(key => <button type="button" key={key} onClick={() => setFormat(key)} aria-pressed={format === key} className={`rounded-lg px-2 py-1 text-xs ${format === key ? 'bg-amber-300 text-slate-950' : 'bg-white/10 text-white/70'}`}>{FORMATS[key].label}</button>)}
      </div>
    </div>
    <div className="mx-auto max-h-[650px] max-w-[400px] overflow-auto rounded-xl">
      <div ref={card} className="relative flex w-full flex-col justify-between overflow-hidden bg-[#140d19] p-6" style={{ aspectRatio: FORMATS[format].ratio }}>
        <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center opacity-65" style={{ backgroundImage: `url(${survivorSceneArtwork(sport, 'volcanic-tribal')})` }} />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-black/65 via-transparent to-black/90" />
        <div className="relative flex items-center justify-between gap-3 text-sm font-bold"><span>AF · AllFantasy</span><span className="max-w-[55%] truncate rounded-full bg-black/50 px-3 py-1 text-xs">{leagueName}</span></div>
        <img src={ART[moment]} alt="" className={`relative mx-auto w-2/3 object-contain ${format === 'link' ? 'max-h-24' : 'max-h-64'}`} />
        <div className="relative"><p className="text-xs font-bold uppercase tracking-widest text-amber-200">{moment.replace('_', ' ')} · Week {week}</p><p className="mt-2 font-serif text-2xl font-bold text-amber-50 sm:text-3xl">{headline}</p><p className="mt-2 text-sm text-white/80">{caption}</p><p className="mt-4 border-t border-white/20 pt-2 text-xs text-white/60">allfantasy.ai · {sport}</p></div>
      </div>
    </div>
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      <button type="button" onClick={() => save(false)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50"><Download className="h-4 w-4" /> Save PNG</button>
      <button type="button" onClick={() => save(true)} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-amber-300 px-3 py-2 text-sm text-slate-950 hover:bg-amber-200 disabled:opacity-50"><Share2 className="h-4 w-4" /> Share</button>
    </div>
    {error && <p role="alert" className="mt-2 text-center text-xs text-rose-300">{error}</p>}
    <p className="mt-2 text-center text-xs text-white/45">The image contains the published result only. Private votes and hidden idols stay private.</p>
  </section>
}

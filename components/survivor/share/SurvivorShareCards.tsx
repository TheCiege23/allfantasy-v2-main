'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SHARE_MOMENT_OFFERED, shareSheetHeading } from '@/lib/survivor/shareCards/cardContent'
import { SHARE_CARD_SIZES, type ShareCardFormat, type ShareMomentListItem, type ShareMomentType } from '@/lib/survivor/shareCards/types'

/**
 * Survivor share UI (share cards handoff): a desktop modal with the moment list, a format switch,
 * a live preview of the server-rendered PNG and four actions; on a phone, a bottom sheet that opens
 * on Story with Story/Post/Link chips, the same four actions and "Not now".
 *
 * The preview IS the PNG from /api/share/survivor/[momentId] — no client-side re-render — so what
 * the manager sees is byte-for-byte what they post.
 */

type MomentsState = { status: 'loading' | 'ready' | 'error'; enabled: boolean; moments: ShareMomentListItem[] }

export function useSurvivorShareMoments(leagueId: string, active = true) {
  const [state, setState] = useState<MomentsState>({ status: 'loading', enabled: false, moments: [] })
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/share/survivor?leagueId=${encodeURIComponent(leagueId)}`, { cache: 'no-store', credentials: 'include' })
      if (!res.ok) throw new Error('Could not load share cards')
      const data = (await res.json()) as { enabled?: boolean; moments?: ShareMomentListItem[] }
      setState({ status: 'ready', enabled: Boolean(data.enabled), moments: Array.isArray(data.moments) ? data.moments : [] })
    } catch {
      setState({ status: 'error', enabled: false, moments: [] })
    }
  }, [leagueId])
  useEffect(() => {
    if (active) void load()
  }, [active, load])
  const replace = useCallback((moment: ShareMomentListItem) => {
    setState(current => ({ ...current, moments: current.moments.map(item => (item.id === moment.id ? moment : item)) }))
  }, [])
  return { ...state, reload: load, replace }
}

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(max-width: 767px)')
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return phone
}

const FORMAT_LABELS: Record<ShareCardFormat, { long: string; short: string }> = {
  post: { long: 'Post 4:5', short: 'Post' },
  story: { long: 'Story 9:16', short: 'Story' },
  link: { long: 'Link 1.91:1', short: 'Link' },
}

const Icon = {
  share: <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />,
  save: <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />,
  link: <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />,
  chat: <path d="M4 6h16v10H8l-4 4z" />,
}

function OutlineIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

function fileName(moment: ShareMomentListItem, format: ShareCardFormat) {
  return `allfantasy-survivor-${moment.type}-week-${moment.week}-${format}.png`
}

async function fetchPng(moment: ShareMomentListItem, format: ShareCardFormat): Promise<Blob> {
  const res = await fetch(moment.imageUrl[format], { credentials: 'include' })
  if (!res.ok) throw new Error('Could not load the card image.')
  return res.blob()
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function postAction(momentId: string, action: 'publish' | 'chat'): Promise<ShareMomentListItem> {
  const res = await fetch('/api/share/survivor', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ momentId, action }),
  })
  const data = (await res.json().catch(() => ({}))) as { moment?: ShareMomentListItem; error?: string }
  if (!res.ok || !data.moment) throw new Error(data.error ?? 'That did not work. Try again.')
  return data.moment
}

function useShareActions(moment: ShareMomentListItem | null, format: ShareCardFormat, onUpdate: (moment: ShareMomentListItem) => void) {
  const [busy, setBusy] = useState<null | 'share' | 'save' | 'link' | 'chat'>(null)
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const say = useCallback((text: string) => {
    setToast(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2600)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const ensurePublished = useCallback(async (current: ShareMomentListItem) => {
    if (current.published) return current
    const updated = await postAction(current.id, 'publish')
    onUpdate(updated)
    return updated
  }, [onUpdate])

  const run = useCallback(async (kind: 'share' | 'save' | 'link' | 'chat') => {
    if (!moment || busy) return
    setBusy(kind)
    try {
      if (kind === 'save') {
        downloadBlob(await fetchPng(moment, format), fileName(moment, format))
        say('Image saved')
      } else if (kind === 'link') {
        const published = await ensurePublished(moment)
        say((await copyText(published.pageUrl)) ? 'Link copied' : published.pageUrl)
      } else if (kind === 'chat') {
        onUpdate(await postAction(moment.id, 'chat'))
        say('Posted to league chat')
      } else {
        const [published, blob] = await Promise.all([ensurePublished(moment), fetchPng(moment, format)])
        const file = new File([blob], fileName(moment, format), { type: 'image/png' })
        const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
        if (nav.share && nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], title: published.headline, text: `${published.headline} ${published.pageUrl}` })
        } else {
          // No file sharing here: save the image and put the link on the clipboard instead.
          downloadBlob(blob, file.name)
          say((await copyText(published.pageUrl)) ? 'Image saved · Link copied' : 'Image saved')
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) say(error instanceof Error ? error.message : 'That did not work. Try again.')
    } finally {
      setBusy(null)
    }
  }, [busy, ensurePublished, format, moment, onUpdate, say])

  return { busy, toast, run }
}

function Actions({ busy, run, compact }: { busy: string | null; run: (kind: 'share' | 'save' | 'link' | 'chat') => void; compact?: boolean }) {
  const items: Array<{ kind: 'share' | 'save' | 'link' | 'chat'; label: string; icon: React.ReactNode }> = [
    { kind: 'share', label: 'Share', icon: Icon.share },
    { kind: 'save', label: 'Save image', icon: Icon.save },
    { kind: 'link', label: 'Copy link', icon: Icon.link },
    { kind: 'chat', label: 'League chat', icon: Icon.chat },
  ]
  return (
    <div className={compact ? 'flex w-full gap-1' : 'flex gap-1.5'}>
      {items.map(item => (
        <button
          key={item.kind}
          type="button"
          onClick={() => run(item.kind)}
          disabled={busy != null}
          aria-busy={busy === item.kind}
          className={`flex min-h-[44px] flex-col items-center gap-1.5 bg-transparent text-[11.5px] font-semibold text-[#a3a9c2] hover:text-white disabled:opacity-60 ${compact ? 'flex-1' : 'w-[76px]'}`}
        >
          <span className="grid h-[52px] w-[52px] place-items-center rounded-[14px] border border-white/[0.08] bg-[#151926] text-[#e8eaf2]">
            <OutlineIcon>{item.icon}</OutlineIcon>
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function Preview({ moment, format, maxW, maxH }: { moment: ShareMomentListItem; format: ShareCardFormat; maxW: number; maxH: number }) {
  const size = SHARE_CARD_SIZES[format]
  const scale = Math.min(maxH / size.height, maxW / size.width)
  const width = Math.round(size.width * scale)
  const height = Math.round(size.height * scale)
  const [loaded, setLoaded] = useState<string | null>(null)
  const src = moment.imageUrl[format]
  return (
    <div
      className="relative flex-none overflow-hidden rounded-[14px] bg-[#10131c] shadow-[0_30px_60px_rgba(0,0,0,.55),0_0_0_1px_rgba(255,255,255,.08)]"
      style={{ width, height, maxWidth: '100%' }}
    >
      {loaded !== src && <div className="absolute inset-0 animate-pulse bg-white/[0.04] motion-reduce:animate-none" aria-hidden="true" />}
      <img
        key={src}
        src={src}
        alt={`${moment.title} card, ${FORMAT_LABELS[format].short.toLowerCase()} format: ${moment.headline}`}
        width={width}
        height={height}
        onLoad={() => setLoaded(src)}
        className="block h-full w-full object-contain"
      />
    </div>
  )
}

function Toast({ text }: { text: string | null }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4">
      {text ? <span className="rounded-full border border-white/10 bg-[#151926] px-4 py-2 text-sm font-semibold text-white shadow-lg">{text}</span> : null}
    </div>
  )
}

export interface SurvivorShareDialogProps {
  moments: ShareMomentListItem[]
  initialMomentId?: string | null
  onClose: () => void
  onMomentUpdate: (moment: ShareMomentListItem) => void
}

export function SurvivorShareDialog({ moments, initialMomentId, onClose, onMomentUpdate }: SurvivorShareDialogProps) {
  const isPhone = useIsPhone()
  const [selectedId, setSelectedId] = useState<string | null>(initialMomentId ?? moments[0]?.id ?? null)
  const [desktopFormat, setDesktopFormat] = useState<ShareCardFormat>('post')
  const [phoneFormat, setPhoneFormat] = useState<ShareCardFormat>('story')
  const format = isPhone ? phoneFormat : desktopFormat
  const moment = useMemo(() => moments.find(item => item.id === selectedId) ?? moments[0] ?? null, [moments, selectedId])
  const { busy, toast, run } = useShareActions(moment, format, onMomentUpdate)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!moment) return null

  if (isPhone) {
    return (
      <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="sv-share-sheet-title">
        <style>{`@keyframes svShareUp{from{transform:translateY(100%)}to{transform:none}}.sv-share-sheet{animation:svShareUp .35s cubic-bezier(.2,.8,.2,1) both}@media (prefers-reduced-motion:reduce){.sv-share-sheet{animation:none}}`}</style>
        <button type="button" aria-label="Close" className="absolute inset-0 bg-[rgba(7,8,13,.72)]" onClick={onClose} tabIndex={-1} />
        <div className="sv-share-sheet absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col items-center gap-3 rounded-t-[20px] border-t border-white/10 bg-[#0b0d14] px-4 pb-6 pt-2.5 text-[#e8eaf2]">
          <span className="h-1 w-10 rounded-full bg-[#2a2f40]" aria-hidden="true" />
          <h2 id="sv-share-sheet-title" className="text-base font-bold">{shareSheetHeading(moment.type, moment.isSubject)}</h2>
          <div className="flex gap-2" role="group" aria-label="Card format">
            {(['story', 'post', 'link'] as ShareCardFormat[]).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setPhoneFormat(key)}
                aria-pressed={phoneFormat === key}
                className={`min-h-[44px] rounded-full border px-4 text-xs font-semibold ${phoneFormat === key ? 'border-[#d9b45a] text-[#f1d58a]' : 'border-white/[0.12] text-[#a3a9c2]'} bg-[#10131c]`}
              >
                {FORMAT_LABELS[key].short}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <Preview moment={moment} format={phoneFormat} maxW={340} maxH={380} />
          </div>
          <Actions busy={busy} run={run} compact />
          <button ref={closeRef} type="button" onClick={onClose} className="min-h-[46px] w-full rounded-xl border border-white/10 bg-[#151926] text-sm font-semibold text-white">
            Not now
          </button>
        </div>
        <Toast text={toast} />
      </div>
    )
  }

  const size = SHARE_CARD_SIZES[desktopFormat]
  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[rgba(7,8,13,.86)]" role="dialog" aria-modal="true" aria-labelledby="sv-share-modal-title">
      <div className="mx-auto my-6 w-[min(1440px,calc(100%-32px))] rounded-2xl border border-white/[0.08] bg-[#07080d] text-[#e8eaf2]">
        <header className="flex flex-wrap items-center gap-4 border-b border-white/[0.06] px-7 py-[18px]">
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close share cards" className="grid min-h-[44px] min-w-[44px] place-items-center rounded-lg border border-white/10 bg-[#10131c] text-lg text-white">‹</button>
          <div className="flex flex-[1_1_320px] flex-col gap-[3px]">
            <h2 id="sv-share-modal-title" className="text-[28px] font-bold leading-tight text-white">Share cards</h2>
            <span className="text-sm text-[#a3a9c2]">One tap turns the season&apos;s big moments into a post, a story or a link preview</span>
          </div>
          <div className="flex w-[360px] max-w-full rounded-xl border border-white/[0.08] bg-[#0b0d14] p-1" role="group" aria-label="Card format">
            {(['post', 'story', 'link'] as ShareCardFormat[]).map(key => (
              <button
                key={key}
                type="button"
                onClick={() => setDesktopFormat(key)}
                aria-pressed={desktopFormat === key}
                className={`min-h-[44px] flex-1 rounded-lg text-sm font-semibold ${desktopFormat === key ? 'border-b-2 border-[#d9b45a] bg-[#151926] text-white' : 'text-[#a3a9c2]'}`}
              >
                {FORMAT_LABELS[key].long}
              </button>
            ))}
          </div>
        </header>
        <div className="flex flex-wrap items-start gap-7 px-7 pb-8 pt-6">
          <aside className="flex flex-[0_1_300px] flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8d93ad]">Moment</span>
            {moments.map(item => {
              const on = item.id === moment.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  aria-pressed={on}
                  className="flex min-h-[56px] w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left"
                  style={{ borderColor: on ? '#d9b45a' : 'rgba(255,255,255,.07)', background: on ? '#151926' : '#0b0d14' }}
                >
                  <img src={item.iconPath} alt="" width={36} height={36} className="h-9 w-9 object-contain" />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="font-semibold">{item.title}</span>
                    <span className="text-[11.5px] text-[#8d93ad]">{item.subtitle}</span>
                  </span>
                </button>
              )
            })}
          </aside>
          <section className="flex flex-[1_1_560px] flex-col items-center gap-5">
            <Preview moment={moment} format={desktopFormat} maxW={560} maxH={640} />
            <span className="font-mono text-xs text-[#8d93ad]">{size.width} × {size.height} PNG</span>
            <Actions busy={busy} run={run} />
          </section>
          <aside className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-3.5">
            <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-[#0b0d14] p-[18px]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8d93ad]">When the card is offered</span>
              <span className="text-sm text-[#a3a9c2]">{SHARE_MOMENT_OFFERED[moment.type as ShareMomentType]}</span>
            </div>
            <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.06] bg-[#0b0d14] p-[18px]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8d93ad]">Every card has</span>
              {[
                'The league’s island background for its sport and the moment’s mood.',
                'The hero art from the moment: necklace, torch, idol, token or trophy.',
                'The AllFantasy mark, the league name and crest, and a link back.',
              ].map((line, index) => (
                <div key={line} className="flex gap-2.5 text-sm text-[#a3a9c2]"><span className="font-mono text-[#f1d58a]">{index + 1}</span><span>{line}</span></div>
              ))}
            </div>
            <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.06] bg-[#10131c] p-[18px]">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8d93ad]">Privacy</span>
              <span className="text-sm text-[#a3a9c2]">Cards never show who voted for whom, or anyone&apos;s hidden idols. An idol card is only offered after it has been played.</span>
            </div>
          </aside>
        </div>
      </div>
      <Toast text={toast} />
    </div>
  )
}

/**
 * Entry point for the share UI. With `type` (and optionally `week`) it opens straight onto that
 * moment — used by the Torch Ceremony (out, opt-in) and the finale (champ). Without it, it is the
 * general "Share cards" button that lists every moment offered to the viewer, and it renders
 * nothing when there are none or the league has sharing turned off.
 */
export function SurvivorShareCardsButton({ leagueId, type, week, label, className, autoOpen = false }: {
  leagueId: string
  type?: ShareMomentType
  week?: number
  label?: string
  className?: string
  autoOpen?: boolean
}) {
  const { status, enabled, moments, replace } = useSurvivorShareMoments(leagueId)
  const [open, setOpen] = useState(false)
  const visible = useMemo(() => moments.filter(item => (!type || item.type === type) && (week == null || item.week === week)), [moments, type, week])
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpen && !autoOpened.current && visible.length > 0) {
      autoOpened.current = true
      setOpen(true)
    }
  }, [autoOpen, visible.length])

  if (status === 'loading') return autoOpen ? <p role="status" className="text-sm text-white/60">Preparing your card…</p> : null
  if (!enabled || visible.length === 0) return autoOpen && status === 'ready' && enabled ? <p role="status" className="text-sm text-white/60">Your card is not ready yet. Check back in a minute.</p> : null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? 'inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-100 hover:bg-amber-950/50'}
      >
        <OutlineIcon>{Icon.share}</OutlineIcon>
        {label ?? 'Share cards'}
      </button>
      {open && (
        <SurvivorShareDialog
          moments={type ? visible : moments}
          initialMomentId={visible[0]?.id ?? null}
          onClose={() => setOpen(false)}
          onMomentUpdate={replace}
        />
      )}
    </>
  )
}

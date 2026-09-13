'use client'

import Link from 'next/link'
import { AfCrest } from '@/components/core-app/AfCrest'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CareerData } from '@/lib/core-app/career'
import { chooseShareVideoFormat } from '@/lib/core-app/shareVideo'
import '@/components/core-app/af-career-share.css'

/**
 * 26a — Career Share, the generator.
 *
 * The output card already existed; the page that produces it did not. Career's
 * own overview carried the comment "Share generator does not exist yet" — this
 * is that page.
 *
 * ⚠ FOUR THINGS THE HANDOFF FLAGS AS HARD UX BUGS, AND WHERE EACH IS ANSWERED.
 * All four are live today on `/career-share`, which is why they are named rather
 * than merely avoided:
 *
 *   1. NO "LOAD MY DATA" BUTTON. The stats are props. The app already holds this
 *      user's career; making them press a button to fetch what we have is the
 *      regression the handoff calls out by name. `/career-share` has an
 *      "⚡ Load My Dynasty Report" button — that is the thing not being repeated.
 *   2. NO USERNAME FIELD. The signed-in user's identity is known. `/career-share`
 *      asks for a Sleeper username in a text input; asking a signed-in user who
 *      they are is treated here as a defect, not a form field.
 *   3. NO VENDOR NAME, EVER. The copy says "Chimmy" or "Intelligence". Never
 *      "AI-powered", never the underlying model vendor. `/career-share` renders
 *      "Grok-powered", "Generating with Grok…" and "🚀 AI-Powered"; those strings
 *      are corrected in that file in the same change as this one.
 *   4. THE SHARING REWARD IS STATED EXACTLY, OR NOT AT ALL. `/career-share` says
 *      "Earn tokens for sharing" with no number. The real rule, read from
 *      `server/api-route-modules/legacy/share-reward/route.ts`, is one token,
 *      once per day. That is what this screen says.
 *
 * ⚠ COST IS ON THE BUTTON, BEFORE THE CLICK. The handoff's mock prints a token
 * price there. The real caption endpoint (`/api/share/generate-copy`) charges
 * nothing today — it is not in `lib/tokens/pricing-matrix.ts` — so the button
 * says so plainly rather than displaying a number we do not actually take. The
 * contract is "no surprise after the click", and a fabricated price would be its
 * own surprise. If a spend rule is ever added for captions, pass its cost in as
 * `tokenCost` and the button reads it.
 */

const CAPTION_STYLES = [
  { id: 'balanced', label: 'Balanced' },
  { id: 'hype', label: 'Hype' },
  { id: 'funny', label: 'Funny' },
  { id: 'humble', label: 'Humble' },
  { id: 'trash_talk', label: 'Trash talk' },
  { id: 'clean', label: 'Clean' },
] as const

type CaptionStyle = (typeof CAPTION_STYLES)[number]['id']

/**
 * Real platform limits, used to live-validate the generated caption.
 * X counts 280; Instagram 2,200; TikTok 150; Threads 500.
 */
const PLATFORMS = [
  { id: 'x', label: 'X', limit: 280 },
  { id: 'instagram', label: 'Instagram', limit: 2200 },
  { id: 'tiktok', label: 'TikTok', limit: 150 },
  { id: 'threads', label: 'Threads', limit: 500 },
] as const

type PlatformId = (typeof PLATFORMS)[number]['id']

const ASPECTS = [
  { id: 'square', label: 'Square', ratio: '1 / 1' },
  { id: 'story', label: 'Story', ratio: '9 / 16' },
  { id: 'wide', label: 'Wide', ratio: '16 / 9' },
] as const

type AspectId = (typeof ASPECTS)[number]['id']

const CARD_STYLES = [
  { id: 'nocturne', label: 'Nocturne' },
  { id: 'mono', label: 'Mono' },
  { id: 'gold', label: 'Gold' },
] as const

type CardStyleId = (typeof CARD_STYLES)[number]['id']

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function safeFilename(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'league'
}

type LeagueWrapped = {
  season: number
  manager: {
    record: string | null
    rank: number | null
    moves: number
    trades: number
    draftPicks: number
    bestTrade: { partner: string | null; differential: number | null; season: number } | null
    outlook: string
  }
  commissioner: {
    teams: number
    trades: number
    rosterChanges: number
    draftPicks: number
    leader: { teamId: string; record: string; pointsFor: number } | null
  } | null
}

export type CareerShareProps = {
  career: CareerData
  /**
   * Leagues we can attribute this card to, auto-detected. Never a manual entry
   * box — the app knows which leagues the user is in.
   */
  leagues: Array<{
    id: string
    name: string
    platform: string
    /**
     * The league's crest, already resolved to a URL by `leagueArtUrl` — never
     * the raw `avatarUrl` column, which on Sleeper holds an avatar id and would
     * render as a broken image on roughly half the account's leagues.
     */
    imageUrl?: string | null
  }>
  /** Preselected from ?league=, when the user arrived from a league. */
  selectedLeagueId: string | null
  /**
   * Token price of one caption generation, when a spend rule exists for it.
   * Null means the call is not token-charged — the button says so.
   */
  tokenCost: number | null
  /**
   * The real sharing reward, read from the share-reward service. Null when the
   * reward is not available to this account today.
   */
  reward: { tokensPerShare: number; oncePerDay: boolean } | null
}

export function CareerShare({
  career,
  leagues,
  selectedLeagueId,
  tokenCost,
  reward,
}: CareerShareProps) {
  const [leagueId, setLeagueId] = useState<string | null>(selectedLeagueId ?? leagues[0]?.id ?? null)
  const [style, setStyle] = useState<CaptionStyle>('balanced')
  const [platform, setPlatform] = useState<PlatformId>('x')
  const [aspect, setAspect] = useState<AspectId>('square')
  const [cardStyle, setCardStyle] = useState<CardStyleId>('nocturne')
  const [caption, setCaption] = useState('')
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'caption' | 'image' | null>(null)
  const [generations, setGenerations] = useState(0)
  const [wrapped, setWrapped] = useState<LeagueWrapped | null>(null)
  const [wrappedLoading, setWrappedLoading] = useState(false)
  const [edition, setEdition] = useState<'manager' | 'commissioner'>('manager')
  const [downloadState, setDownloadState] = useState<'idle' | 'image' | 'video' | 'error'>('idle')
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  const league = useMemo(
    () => leagues.find((l) => l.id === leagueId) ?? null,
    [leagues, leagueId],
  )
  const limit = PLATFORMS.find((p) => p.id === platform)!.limit
  const overBy = Math.max(0, caption.length - limit)

  const drawDownloadCard = useCallback((canvas: HTMLCanvasElement, reveal = 1) => {
    const dimensions: Record<AspectId, [number, number]> = {
      square: [1080, 1080],
      story: [1080, 1920],
      wide: [1920, 1080],
    }
    const [width, height] = dimensions[aspect]
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Your browser could not create the share card.')

    const palettes: Record<CardStyleId, [string, string, string]> = {
      nocturne: ['#070a18', '#0d1730', '#27d3ea'],
      mono: ['#090a0d', '#242831', '#f4f7fb'],
      gold: ['#130d05', '#38260c', '#f7c85c'],
    }
    const [start, end, accent] = palettes[cardStyle]
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, start)
    gradient.addColorStop(1, end)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    const pad = Math.round(width * 0.075)
    const compact = aspect === 'wide'
    const titleSize = Math.round(width * (compact ? 0.055 : 0.075))
    const bodySize = Math.round(width * (compact ? 0.025 : 0.037))
    ctx.fillStyle = accent
    ctx.font = `800 ${Math.round(bodySize * 0.72)}px Arial, sans-serif`
    ctx.fillText('ALLFANTASY LEAGUE WRAPPED', pad, pad)

    ctx.fillStyle = '#ffffff'
    ctx.font = `900 ${titleSize}px Arial, sans-serif`
    ctx.fillText(league?.name ?? 'Your league', pad, pad + titleSize * 1.3, width - pad * 2)
    ctx.fillStyle = 'rgba(255,255,255,.68)'
    ctx.font = `700 ${bodySize}px Arial, sans-serif`
    ctx.fillText(`${wrapped?.season ?? new Date().getFullYear()} · ${edition === 'commissioner' ? 'Commissioner edition' : 'Manager edition'}`, pad, pad + titleSize * 2.05)

    const managerMetrics = [
      ['RECORD', wrapped?.manager.record ?? (career.games > 0 ? `${career.wins}-${career.losses}` : '—')],
      ['TRADES', String(wrapped?.manager.trades ?? 0)],
      ['ROSTER MOVES', String(wrapped?.manager.moves ?? 0)],
      ['DRAFT PICKS', String(wrapped?.manager.draftPicks ?? 0)],
    ]
    const commissionerMetrics = [
      ['TEAMS', String(wrapped?.commissioner?.teams ?? 0)],
      ['TRADES', String(wrapped?.commissioner?.trades ?? 0)],
      ['ROSTER CHANGES', String(wrapped?.commissioner?.rosterChanges ?? 0)],
      ['DRAFTED', String(wrapped?.commissioner?.draftPicks ?? 0)],
    ]
    const metrics = edition === 'commissioner' && wrapped?.commissioner ? commissionerMetrics : managerMetrics
    const gridTop = compact ? Math.round(height * 0.39) : Math.round(height * 0.42)
    const gap = Math.round(width * 0.018)
    const columns = compact ? 4 : 2
    const boxWidth = (width - pad * 2 - gap * (columns - 1)) / columns
    const rows = Math.ceil(metrics.length / columns)
    const boxHeight = Math.min(Math.round(height * (compact ? 0.25 : 0.16)), (height - gridTop - pad * 2) / rows - gap)
    ctx.globalAlpha = Math.max(0.12, Math.min(1, reveal))
    metrics.forEach(([label, value], index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      const x = pad + col * (boxWidth + gap)
      const y = gridTop + row * (boxHeight + gap)
      ctx.fillStyle = 'rgba(255,255,255,.075)'
      ctx.strokeStyle = 'rgba(255,255,255,.15)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.roundRect(x, y, boxWidth, boxHeight, 24)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = accent
      ctx.font = `800 ${Math.round(bodySize * 0.66)}px Arial, sans-serif`
      ctx.fillText(label, x + gap, y + Math.round(boxHeight * 0.3))
      ctx.fillStyle = '#ffffff'
      ctx.font = `900 ${Math.round(titleSize * 0.72)}px Arial, sans-serif`
      ctx.fillText(value, x + gap, y + Math.round(boxHeight * 0.72), boxWidth - gap * 2)
    })
    ctx.globalAlpha = 1

    const footer = edition === 'manager'
      ? wrapped?.manager.outlook ?? 'Your next season starts with the next decision.'
      : wrapped?.commissioner?.leader
        ? `League leader: ${wrapped.commissioner.leader.teamId} · ${wrapped.commissioner.leader.record}`
        : 'Built for every manager in the league.'
    ctx.fillStyle = 'rgba(255,255,255,.82)'
    ctx.font = `600 ${bodySize}px Arial, sans-serif`
    ctx.fillText(footer.slice(0, 92), pad, height - pad * 1.45, width - pad * 2)
    ctx.fillStyle = accent
    ctx.font = `900 ${Math.round(bodySize * 0.8)}px Arial, sans-serif`
    ctx.fillText('allfantasy.ai', pad, height - pad * 0.65)
  }, [aspect, cardStyle, career.games, career.losses, career.wins, edition, league?.name, wrapped])

  const downloadImage = useCallback(() => {
    try {
      setDownloadError(null)
      setDownloadState('image')
      const canvas = document.createElement('canvas')
      drawDownloadCard(canvas)
      canvas.toBlob((blob) => {
        if (!blob) {
          setDownloadState('error')
          setDownloadError('The image could not be created in this browser.')
          return
        }
        downloadBlob(blob, `${safeFilename(league?.name ?? 'league')}-wrapped.png`)
        setDownloadState('idle')
      }, 'image/png')
    } catch (cause) {
      setDownloadState('error')
      setDownloadError(cause instanceof Error ? cause.message : 'The image could not be created.')
    }
  }, [drawDownloadCard, league?.name])

  const downloadVideo = useCallback(async () => {
    const canvas = document.createElement('canvas')
    const fallbackToPng = async (reason: string) => {
      drawDownloadCard(canvas)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('The share card could not be created in this browser.')
      downloadBlob(blob, `${safeFilename(league?.name ?? 'league')}-wrapped.png`)
      setDownloadState('idle')
      setDownloadError(`${reason} A PNG was downloaded automatically.`)
    }

    try {
      setDownloadError(null)
      setDownloadState('video')
      drawDownloadCard(canvas, 0)
      if (
        typeof MediaRecorder === 'undefined' ||
        typeof MediaRecorder.isTypeSupported !== 'function' ||
        typeof canvas.captureStream !== 'function'
      ) {
        await fallbackToPng('This browser cannot record an animated card.')
        return
      }
      const output = chooseShareVideoFormat((mime) => MediaRecorder.isTypeSupported(mime))
      if (!output) {
        await fallbackToPng('This browser does not provide a supported MP4 or WebM recorder.')
        return
      }
      const stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType: output.mime })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
      const finished = new Promise<void>((resolve) => {
        recorder.onstop = () => {
          downloadBlob(
            new Blob(chunks, { type: output.mime }),
            `${safeFilename(league?.name ?? 'league')}-wrapped.${output.extension}`,
          )
          stream.getTracks().forEach((track) => track.stop())
          resolve()
        }
      })
      recorder.start()
      const started = performance.now()
      await new Promise<void>((resolve) => {
        const frame = (time: number) => {
          const elapsed = time - started
          drawDownloadCard(canvas, Math.min(1, elapsed / 1_600))
          if (elapsed < 3_200) requestAnimationFrame(frame)
          else resolve()
        }
        requestAnimationFrame(frame)
      })
      recorder.stop()
      await finished
      setDownloadState('idle')
    } catch (cause) {
      try {
        await fallbackToPng(
          cause instanceof Error
            ? `The animated card could not be created: ${cause.message}`
            : 'The animated card could not be created.',
        )
      } catch (fallbackCause) {
        setDownloadState('error')
        setDownloadError(fallbackCause instanceof Error ? fallbackCause.message : 'The share card could not be created.')
      }
    }
  }, [drawDownloadCard, league?.name])

  useEffect(() => {
    if (!leagueId) {
      setWrapped(null)
      return
    }
    const controller = new AbortController()
    setWrappedLoading(true)
    fetch(`/api/league/wrapped?leagueId=${encodeURIComponent(leagueId)}`, { signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<LeagueWrapped> : null)
      .then((value) => {
        setWrapped(value)
        if (!value?.commissioner) setEdition('manager')
      })
      .catch(() => setWrapped(null))
      .finally(() => setWrappedLoading(false))
    return () => controller.abort()
  }, [leagueId])

  const generate = useCallback(async () => {
    setStatus('working')
    setError(null)
    try {
      const res = await fetch('/api/share/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareType: 'season_recap',
          leagueId: league?.id ?? undefined,
          leagueName: league?.name ?? undefined,
          teamName: career.handle ?? undefined,
          tier: career.levelName ?? undefined,
          rank: career.level ?? undefined,
        }),
      })
      if (!res.ok) throw new Error(`Caption service returned ${res.status}`)
      /*
         The service returns `platformVariants` as OBJECTS — { caption, hashtags }
         per platform — not strings. Typing it as Record<string, string> and
         assigning it straight into the textarea rendered "[object Object]", and
         nothing caught it: tsc believed the annotation, and the shape only shows
         up in a live response. Verified against the real endpoint.
      */
      const data = (await res.json()) as {
        caption?: string
        platformVariants?: Record<string, { caption?: string; hashtags?: string[] } | string>
      }
      const variant = data.platformVariants?.[platform]
      const variantText = typeof variant === 'string' ? variant : variant?.caption
      const next = variantText ?? data.caption ?? ''
      if (!next) throw new Error('The caption service returned nothing to show.')
      setCaption(next)
      setGenerations((n) => n + 1)
      setStatus('done')
    } catch (e) {
      setStatus('error')
      setError(
        e instanceof Error
          ? `${e.message} Nothing was spent — try again in a moment.`
          : 'Something went wrong writing that caption. Nothing was spent.',
      )
    }
  }, [career.handle, career.level, career.levelName, league, platform])

  const copyCaption = useCallback(async () => {
    if (!caption) return
    await navigator.clipboard.writeText(caption).catch(() => null)
    setCopied('caption')
    window.setTimeout(() => setCopied(null), 1800)
  }, [caption])

  /*
   * "Copy image" copies the card's TEXT content, and the button says so.
   * Rasterising a DOM node needs a canvas pipeline this screen does not have,
   * and a button that silently copies nothing is worse than one that is honest
   * about what it puts on the clipboard.
   */
  const copyCardText = useCallback(async () => {
    const text = cardRef.current?.innerText?.trim()
    if (!text) return
    await navigator.clipboard.writeText(text).catch(() => null)
    setCopied('image')
    window.setTimeout(() => setCopied(null), 1800)
  }, [])

  const generateLabel =
    status === 'working'
      ? 'Chimmy is writing…'
      : generations > 0
        ? tokenCost != null
          ? `Regenerate · ${tokenCost}`
          : 'Regenerate'
        : tokenCost != null
          ? `Write my caption · ${tokenCost}`
          : 'Write my caption'

  return (
    <div className="af-cs">
      <header className="af-cs-head">
        <p className="af-cs-eyebrow af-label">AllFantasy League Wrapped</p>
        <h1 className="af-display af-cs-title">Turn a season into a recap worth sharing</h1>
        <p className="af-cs-sub">
          Chimmy writes the caption; you decide whether it goes out.{' '}
          <b>AllFantasy never posts for you.</b>
        </p>
      </header>

      <div className="af-cs-cols">
        {/* ── Left: what goes on the card ─────────────────────────── */}
        <section className="af-cs-left">
          <div className="af-cs-block">
            <h2 className="af-cs-blocktitle">League</h2>
            {leagues.length === 0 ? (
              <p className="af-cs-note">
                No leagues detected on your account, so the card is your career only — not tied to
                one league.
              </p>
            ) : (
              <>
                <div className="af-cs-chips">
                  {leagues.slice(0, 8).map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className="af-cs-chip"
                      data-platform={l.platform}
                      data-on={l.id === leagueId}
                      onClick={() => setLeagueId(l.id)}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
                <p className="af-cs-note">
                  Detected from your account — nothing to type in.
                </p>
              </>
            )}
          </div>

          {league ? (
            <div className="af-cs-block af-cs-wrapped">
              <div className="af-cs-blockhead">
                <h2 className="af-cs-blocktitle">{wrapped?.season ?? 'Season'} recap</h2>
                {wrapped?.commissioner ? (
                  <div className="af-cs-chips af-cs-chips--tight">
                    <button type="button" className="af-cs-chip" data-on={edition === 'manager'} onClick={() => setEdition('manager')}>My team</button>
                    <button type="button" className="af-cs-chip" data-on={edition === 'commissioner'} onClick={() => setEdition('commissioner')}>Commissioner</button>
                  </div>
                ) : null}
              </div>
              {wrappedLoading ? <p className="af-cs-note">Building the recap from league history…</p> : wrapped ? (
                edition === 'commissioner' && wrapped.commissioner ? (
                  <>
                    <dl className="af-cs-stats">
                      <div><dt>Teams</dt><dd>{wrapped.commissioner.teams}</dd></div>
                      <div><dt>Trades</dt><dd>{wrapped.commissioner.trades}</dd></div>
                      <div><dt>Changes</dt><dd>{wrapped.commissioner.rosterChanges}</dd></div>
                      <div><dt>Drafted</dt><dd>{wrapped.commissioner.draftPicks}</dd></div>
                    </dl>
                    <p className="af-cs-note">League leader: {wrapped.commissioner.leader ? `${wrapped.commissioner.leader.teamId} · ${wrapped.commissioner.leader.record} · ${wrapped.commissioner.leader.pointsFor.toFixed(1)} PF` : 'standings not available yet'}.</p>
                  </>
                ) : (
                  <>
                    <dl className="af-cs-stats">
                      <div><dt>Record</dt><dd>{wrapped.manager.record ?? '—'}</dd></div>
                      <div><dt>Rank</dt><dd>{wrapped.manager.rank ? `#${wrapped.manager.rank}` : '—'}</dd></div>
                      <div><dt>Trades</dt><dd>{wrapped.manager.trades}</dd></div>
                      <div><dt>Drafted</dt><dd>{wrapped.manager.draftPicks}</dd></div>
                    </dl>
                    <p className="af-cs-note"><b>Best measured trade:</b> {wrapped.manager.bestTrade ? `${wrapped.manager.bestTrade.partner ? `with ${wrapped.manager.bestTrade.partner}` : 'graded from league history'}${wrapped.manager.bestTrade.differential != null ? ` · ${wrapped.manager.bestTrade.differential >= 0 ? '+' : ''}${Math.round(wrapped.manager.bestTrade.differential)} value` : ''}` : 'No graded historical trade is available yet.'}</p>
                    <p className="af-cs-note"><b>Next-season outlook:</b> {wrapped.manager.outlook}</p>
                  </>
                )
              ) : <p className="af-cs-note af-cs-note--warn">This league does not have enough imported history for a Wrapped recap yet.</p>}
            </div>
          ) : null}

          {/*
            The stats. Loaded, not requested — there is no button here on purpose.
          */}
          <div className="af-cs-block">
            <h2 className="af-cs-blocktitle">What&apos;s going on it</h2>
            <dl className="af-cs-stats">
              <div>
                <dt>Level</dt>
                <dd className="af-num">
                  {career.level != null ? career.level : '—'}
                  {career.levelName ? <span className="af-cs-statsub">{career.levelName}</span> : null}
                </dd>
              </div>
              <div>
                <dt>XP</dt>
                <dd className="af-num">{career.xp ? career.xp.total.toLocaleString() : '—'}</dd>
              </div>
              <div>
                <dt>Record</dt>
                <dd className="af-num">
                  {career.games > 0 ? `${career.wins}–${career.losses}` : '—'}
                </dd>
              </div>
              <div>
                <dt>Titles</dt>
                <dd className="af-num">{career.championships}</dd>
              </div>
            </dl>
            {career.level == null && career.games === 0 ? (
              <p className="af-cs-note af-cs-note--warn">
                We hold no scored career history for you yet, so the card below will be thin. Import
                past seasons and it fills in — nothing here is a placeholder.
              </p>
            ) : (
              <p className="af-cs-note">
                Pulled from your imported history automatically. No load step, no username to
                re-enter.
              </p>
            )}
          </div>

          <div className="af-cs-block">
            <h2 className="af-cs-blocktitle">Caption style</h2>
            <div className="af-cs-chips">
              {CAPTION_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="af-cs-chip"
                  data-on={s.id === style}
                  onClick={() => setStyle(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="af-cs-block">
            <h2 className="af-cs-blocktitle">Platform</h2>
            <div className="af-cs-chips">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="af-cs-chip"
                  data-on={p.id === platform}
                  onClick={() => setPlatform(p.id)}
                >
                  {p.label}
                  <span className="af-cs-chip-sub af-num">{p.limit}</span>
                </button>
              ))}
            </div>
            <p className="af-cs-note">
              Character limits are the platform&apos;s own. The caption is checked against the one
              you pick.
            </p>
          </div>

          {/* Cost stated ON the button, before the click. */}
          <button
            type="button"
            className="af-cs-generate"
            onClick={generate}
            disabled={status === 'working'}
          >
            {generateLabel}
          </button>
          <p className="af-cs-cost">
            {tokenCost != null
              ? `${tokenCost} tokens per caption, including each regenerate.`
              : 'Captions are included in your plan — this does not spend tokens.'}
          </p>
          {reward ? (
            <p className="af-cs-cost">
              Sharing earns {reward.tokensPerShare}{' '}
              {reward.tokensPerShare === 1 ? 'token' : 'tokens'}
              {reward.oncePerDay ? ', once per day.' : '.'}
            </p>
          ) : null}
        </section>

        {/* ── Right: the caption and the card ─────────────────────── */}
        <section className="af-cs-right">
          <div className="af-cs-block">
            <div className="af-cs-blockhead">
              <h2 className="af-cs-blocktitle">Caption</h2>
              <span
                className="af-cs-count af-num"
                data-over={overBy > 0}
                title={`${limit}-character limit on ${PLATFORMS.find((p) => p.id === platform)!.label}`}
              >
                {caption.length}/{limit}
              </span>
            </div>

            <textarea
              className="af-cs-textarea"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={
                status === 'working'
                  ? 'Chimmy is writing…'
                  : 'Press “Write my caption” and edit whatever comes back. Nothing posts on its own.'
              }
              rows={5}
              aria-label="Caption"
            />

            {overBy > 0 ? (
              <p className="af-cs-note af-cs-note--warn">
                {overBy} character{overBy === 1 ? '' : 's'} over the limit for{' '}
                {PLATFORMS.find((p) => p.id === platform)!.label}. Trim it, or switch platform —
                nothing is truncated for you.
              </p>
            ) : null}

            {error ? <p className="af-cs-note af-cs-note--bad">{error}</p> : null}

            <div className="af-cs-actions">
              <button
                type="button"
                className="af-cs-act"
                onClick={generate}
                disabled={status === 'working'}
              >
                {status === 'working' ? 'Writing…' : 'Regenerate'}
              </button>
              <button type="button" className="af-cs-act" onClick={copyCaption} disabled={!caption}>
                {copied === 'caption' ? 'Copied' : 'Copy caption'}
              </button>
            </div>
          </div>

          <div className="af-cs-block">
            <div className="af-cs-blockhead">
              <h2 className="af-cs-blocktitle">Card</h2>
              <div className="af-cs-chips af-cs-chips--tight">
                {ASPECTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="af-cs-chip"
                    data-on={a.id === aspect}
                    onClick={() => setAspect(a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="af-cs-chips af-cs-chips--tight af-cs-cardstyles">
              {CARD_STYLES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="af-cs-chip"
                  data-on={c.id === cardStyle}
                  onClick={() => setCardStyle(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Live preview. */}
            <div className="af-cs-preview">
              <div
                ref={cardRef}
                className="af-cs-card"
                data-style={cardStyle}
                style={{ aspectRatio: ASPECTS.find((a) => a.id === aspect)!.ratio }}
              >
                <div className="af-cs-card-top">
                  {/*
                    ⚠ THE DRAWN CREST, NOT THE "AF" TEXT MARK IT REPLACED, and not
                    `/af-crest.png` either — that file is a JPEG with a .png
                    extension, so it carries a baked-in white background that
                    would put a white square on a dark gradient card. See
                    `AfCrest.tsx`.
                  */}
                  <span className="af-cs-card-mark">
                    <AfCrest size={26} />
                  </span>
                  {/*
                    The league's own artwork beside its name, when it has any. A
                    league with none renders the name alone rather than a
                    placeholder tile — 67 of 115 production leagues have no
                    avatar on the platform either.
                  */}
                  {league?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="af-cs-card-crest"
                      src={league.imageUrl}
                      alt=""
                      width={22}
                      height={22}
                      loading="lazy"
                    />
                  ) : null}
                  <span className="af-cs-card-league">{league?.name ?? 'Career'} · Wrapped</span>
                </div>

                <div className="af-cs-card-body">
                  <p className="af-cs-card-level af-num">
                    {career.level != null ? `LVL ${career.level}` : 'UNRANKED'}
                  </p>
                  <h3 className="af-cs-card-name">{career.handle ?? 'Your career'}</h3>
                  {career.levelName ? (
                    <p className="af-cs-card-tier">{career.levelName}</p>
                  ) : null}
                </div>

                <div className="af-cs-card-stats">
                  <span>
                    <b className="af-num">{wrapped?.manager.record ?? (career.games > 0 ? `${career.wins}–${career.losses}` : '—')}</b>
                    record
                  </span>
                  <span>
                    <b className="af-num">{wrapped?.manager.trades ?? career.championships}</b>
                    {wrapped ? 'trades' : career.championships === 1 ? 'title' : 'titles'}
                  </span>
                  <span>
                    <b className="af-num">{wrapped?.manager.draftPicks ?? career.seasonsPlayed}</b>
                    {wrapped ? 'draft picks' : career.seasonsPlayed === 1 ? 'season' : 'seasons'}
                  </span>
                </div>

                <p className="af-cs-card-foot">allfantasy.ai</p>
              </div>
            </div>

            <div className="af-cs-actions">
              <button type="button" className="af-cs-act" onClick={downloadImage} disabled={downloadState === 'image' || downloadState === 'video'}>
                {downloadState === 'image' ? 'Creating PNG…' : 'Download PNG'}
              </button>
              <button type="button" className="af-cs-act" onClick={() => void downloadVideo()} disabled={downloadState === 'image' || downloadState === 'video'}>
                {downloadState === 'video' ? 'Creating animation…' : 'Download animation'}
              </button>
              <button type="button" className="af-cs-act" onClick={copyCardText}>
                {copied === 'image' ? 'Card text copied' : 'Copy card text'}
              </button>
              <Link href="/core/career" className="af-cs-act">
                Back to your career
              </Link>
            </div>

            {downloadError ? <p className="af-cs-note af-cs-note--warn" role="status">{downloadError}</p> : null}

            <p className="af-cs-note">Animation downloads as MP4 when the browser supports it, WebM otherwise, with automatic PNG fallback.</p>

            <p className="af-cs-note">
              <b>AllFantasy never posts for you.</b> Copy what you want and post it yourself —
              nothing here is connected to your social accounts.
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}

export default CareerShare

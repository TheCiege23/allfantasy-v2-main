'use client'

import Link from 'next/link'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { CareerData } from '@/lib/core-app/career'
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

export type CareerShareProps = {
  career: CareerData
  /**
   * Leagues we can attribute this card to, auto-detected. Never a manual entry
   * box — the app knows which leagues the user is in.
   */
  leagues: Array<{ id: string; name: string; platform: string }>
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
  const cardRef = useRef<HTMLDivElement | null>(null)

  const league = useMemo(
    () => leagues.find((l) => l.id === leagueId) ?? null,
    [leagues, leagueId],
  )
  const limit = PLATFORMS.find((p) => p.id === platform)!.limit
  const overBy = Math.max(0, caption.length - limit)

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
        <p className="af-cs-eyebrow af-label">Career Share</p>
        <h1 className="af-display af-cs-title">Make a card worth posting</h1>
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
                  <span className="af-cs-card-mark">AF</span>
                  <span className="af-cs-card-league">{league?.name ?? 'Career'}</span>
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
                    <b className="af-num">{career.games > 0 ? `${career.wins}–${career.losses}` : '—'}</b>
                    record
                  </span>
                  <span>
                    <b className="af-num">{career.championships}</b>
                    {career.championships === 1 ? 'title' : 'titles'}
                  </span>
                  <span>
                    <b className="af-num">{career.seasonsPlayed}</b>
                    {career.seasonsPlayed === 1 ? 'season' : 'seasons'}
                  </span>
                </div>

                <p className="af-cs-card-foot">allfantasy.ai</p>
              </div>
            </div>

            <div className="af-cs-actions">
              {/*
                ⚠ "COPY CARD TEXT", NOT "DOWNLOAD IMAGE". The handoff draws a
                Download action, and there is no image renderer behind this card —
                it is live DOM, not a rasterised asset. A Download button wired to
                a route that does not exist is exactly the unattached control this
                build is meant not to ship, so the label matches what the click
                actually does. When a card renderer lands, this becomes a download.
              */}
              <button type="button" className="af-cs-act" onClick={copyCardText}>
                {copied === 'image' ? 'Card text copied' : 'Copy card text'}
              </button>
              <Link href="/core/career" className="af-cs-act">
                Back to your career
              </Link>
            </div>

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

'use client'

import Link from 'next/link'
import { useEffect, useId, useState } from 'react'
import type { SurvivorSummary } from '@/components/survivor/types'
import { useMessages } from '@/components/i18n/useMessages'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'
import { survivorIslandMessages } from '@/lib/core-app/messages/survivorIsland'
import { clockText, islandView, sportBall, tribeColor, type SportBall } from '@/lib/core-app/survivorIsland'
import { shouldPollReading } from '@/lib/core-app/survivorVoteReading'
import { SurvivorRulebook } from './SurvivorRulebook'
import { SurvivorVoteReading } from './SurvivorVoteReading'
import { castawayNameWithTribeEmoji } from '@/lib/survivor/survivorTribeEmoji'

/** How often the banner refreshes the summary while a council's votes are being read. */
export const READING_POLL_MS = 10_000

/**
 * The island banner at the top of a Survivor league's Camp, Tribe standings and Immunity challenge
 * screens (the approved Survivor mock-up, step 2).
 *
 * It reads the same summary the Survivor hub reads and never blocks the screen under it: while the
 * summary loads, or if it fails, the banner shows the scene and the league name only.
 */
export function SurvivorIslandBanner({
  leagueId,
  leagueName,
  variant = 'full',
}: {
  leagueId: string
  leagueName: string
  /** 'full' on Camp (headline, actions, tribe board); 'compact' on the other screens. */
  variant?: 'full' | 'compact'
}) {
  const m = useMessages(survivorIslandMessages)
  const [summary, setSummary] = useState<SurvivorSummary | null>(null)
  const [now, setNow] = useState<number | null>(null)

  const [tick, setTick] = useState(0)
  const polling = shouldPollReading(summary)

  useEffect(() => {
    let live = true
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/summary`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      // A failed refresh mid-read keeps what is already on screen rather than blanking it.
      .then((d) => { if (live && (d || tick === 0)) setSummary(d) })
      .catch(() => {})
    return () => { live = false }
  }, [leagueId, tick])

  // While the votes are being read the server releases ballots on its own clock; refresh until the
  // read is complete, then stop.
  useEffect(() => {
    if (!polling) return
    const id = window.setInterval(() => setTick((n) => n + 1), READING_POLL_MS)
    return () => window.clearInterval(id)
  }, [polling])

  // The clock only runs on the client, so server and client render the same first frame.
  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const v = islandView(summary)
  const ball = sportBall(v.sport)
  const clock = v.clock && now != null ? clockText(v.clock.at, now) : null
  const lines = (() => {
    const mo = v.moment
    switch (mo.kind) {
      case 'pre_draft': return [m.preDraftTitle, m.preDraftBody]
      case 'finale_open': return [m.finaleTitle, m.finaleBody]
      case 'crowned': return [m.crownedTitle(mo.winnerName), m.crownedBody]
      case 'reading': return [m.readingTitle, m.readingBody]
      case 'council': return [mo.mine || !mo.tribeName ? m.councilMine : m.councilTribe(mo.tribeName), m.councilBody]
      case 'challenge': return [m.challengeTitle(mo.title), m.challengeBody]
      case 'merged': return [m.mergedTitle, m.mergedBody]
      default: return [m.campTitle, m.campBody]
    }
  })()
  const q = `league=${encodeURIComponent(leagueId)}`
  const full = variant === 'full'

  return (
    <>
      <section
        className="sv-banner"
        data-variant={variant}
        data-scene={v.scene}
        data-testid="survivor-island-banner"
        style={{ backgroundImage: `url('/survivor/scenes/${v.scene}.svg')` }}
      >
        <div className="sv-banner-in">
          {full ? <SurvivorEmblem ball={ball} /> : null}
          <div className="sv-banner-copy">
            <div className="sv-chips">
              {v.sport ? <span>{v.sport}</span> : null}
              <span>{m.survivor}</span>
              {v.week ? <span>{m.week(v.week)}</span> : null}
              {v.castawaysTotal > 0 ? <span>{m.castaways(v.castawaysLeft, v.castawaysTotal)}</span> : null}
              {v.myTribe ? <span style={{ borderColor: v.myTribe.color ?? undefined }}>{m.you(v.myTribe.name)}</span> : null}
            </div>
            <h1 className="sv-title">{summary?.leagueName || leagueName}</h1>
            <p className="sv-sub">{summary ? lines[0] : m.loading}</p>
            {full && summary ? <p className="sv-desc">{lines[1]}</p> : null}
            {full ? (
              <div className="sv-actions">
                <Link className="sv-btn sv-btn-primary" href={`/core/my-team?${q}`}>{m.myTeam}</Link>
                <Link className="sv-btn" href={`/core/matchup?${q}`}>{m.matchup}</Link>
                <Link className="sv-btn" href={`/survivor/${encodeURIComponent(leagueId)}/tribal`}>{m.council}</Link>
                <Link className="sv-btn" href={`/survivor/${encodeURIComponent(leagueId)}`}>{m.island}</Link>
              </div>
            ) : null}
          </div>
          {clock && v.clock ? (
            <div className="sv-clock" role="timer" aria-live="off">
              <div className="sv-clock-label">{v.clock.label === 'council' ? m.clockCouncil : v.clock.label === 'challenge' ? m.clockChallenge : m.clockJury}</div>
              <div className="sv-clock-time">{clock}</div>
              <div className="sv-clock-at">{new Date(v.clock.at).toLocaleString(getAppIntlLocale(), { weekday: 'long', hour: 'numeric', minute: '2-digit' })}</div>
            </div>
          ) : null}
        </div>
      </section>
      {full && summary && summary.tribes.some((t) => t.members.length > 0) ? <TribeBoard summary={summary} /> : null}
      {full && summary ? <SurvivorVoteReading summary={summary} /> : null}
      {full && summary ? <SurvivorRulebook config={summary.config} collapsible /> : null}
    </>
  )
}

function TribeBoard({ summary }: { summary: SurvivorSummary }) {
  const m = useMessages(survivorIslandMessages)
  const immune = new Set(summary.immunityRosterIds ?? [])
  const names = summary.rosterDisplayNames ?? {}
  const attending = summary.council && !summary.council.closedAt ? summary.council.attendingTribeId : null
  const tribes = summary.tribes.filter((t) => t.members.length > 0 || (t.outMembers?.length ?? 0) > 0)
  return (
    <section className="sv-panel" aria-label={m.tribes}>
      <div className="sv-panel-h"><span className="sv-eyebrow">{m.tribes}</span></div>
      <div className="sv-tribes">
        {tribes.map((t) => {
          const color = tribeColor(t)
          const mine = t.id === summary.myTribeId
          const score = summary.tribeScores?.[t.id]
          const seats = [
            ...t.members.map((x) => ({ id: x.rosterId, out: false })),
            ...(t.outMembers ?? []).map((x) => ({ id: x.rosterId, out: true })),
          ]
          return (
            <div key={t.id} className="sv-tribe" data-mine={mine ? 'true' : undefined}>
              <div className="sv-tribe-h">
                <strong style={{ color }}>{castawayNameWithTribeEmoji(t.name, t.tribeEmoji, Boolean(summary.tribeEmojiInNames))}</strong>
                <span className="sv-mono" style={{ color }}>{t.members.length}/{seats.length}</span>
              </div>
              <div className="sv-strip">
                {seats.map((s) => (
                  <i
                    key={s.id}
                    title={names[s.id] ?? undefined}
                    data-out={s.out ? 'true' : undefined}
                    data-immune={!s.out && immune.has(s.id) ? 'true' : undefined}
                    data-me={s.id === summary.myRosterId ? 'true' : undefined}
                    style={{ background: color }}
                  />
                ))}
              </div>
              <div className="sv-note">
                {attending && attending === t.id ? <span className="sv-danger">{m.attending}</span> : attending ? m.safe : summary.merged ? m.merged : null}
                {typeof score === 'number' ? <span className="sv-mono"> · {m.points(score.toFixed(1))}</span> : null}
              </div>
            </div>
          )
        })}
      </div>
      <div className="sv-legend">
        <span><i data-out="true" />{m.legendOut}</span>
        <span><i data-immune="true" />{m.legendImmune}</span>
        <span><i data-me="true" />{m.legendYou}</span>
      </div>
    </section>
  )
}

/** The league crest: a carved shield, crossed torches, a tiki mask and the league's sport ball. */
export function SurvivorEmblem({ ball, size = 132 }: { ball: SportBall; size?: number }) {
  const id = useId().replace(/:/g, '')
  const torch = (deg: number) => (
    <g transform={`rotate(${deg} 100 120)`}>
      <rect x="96" y="56" width="8" height="120" rx="2" fill="#3b2412" />
      <path d="M90 60 h20 l-3 -12 h-14Z" fill="#6b4422" />
      <path className="sv-flame" d="M100 48 C88 40 92 24 100 12 C108 26 112 38 100 48Z" fill="#f2862b" />
      <path className="sv-flame sv-flame-2" d="M100 46 C95 40 97 32 100 26 C104 33 105 40 100 46Z" fill="#ffd47a" />
    </g>
  )
  return (
    <svg className="sv-emblem" width={size} height={Math.round(size * 1.12)} viewBox="0 0 200 224" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5a3a20" /><stop offset="1" stopColor="#2a170b" /></linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e8c98e" /><stop offset=".5" stopColor="#9a6a32" /><stop offset="1" stopColor="#e2b971" /></linearGradient>
        <radialGradient id={`${id}f`} cx=".5" cy=".3" r=".7"><stop offset="0" stopColor="#f0a35e" stopOpacity=".55" /><stop offset="1" stopColor="#f0a35e" stopOpacity="0" /></radialGradient>
      </defs>
      <path d="M100 8 L186 40 Q186 140 100 206 Q14 140 14 40Z" fill={`url(#${id}w)`} stroke={`url(#${id}r)`} strokeWidth="6" />
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d={`M${30 + i * 18} 46 Q${34 + i * 18} 120 ${28 + i * 18} 170`} stroke="#000" strokeOpacity=".18" strokeWidth="2" fill="none" />
      ))}
      <circle cx="100" cy="86" r="70" fill={`url(#${id}f)`} />
      {torch(-24)}
      {torch(24)}
      <g transform="translate(100 112)">
        <path d="M-26 -36 h52 v58 q-26 18 -52 0Z" fill="#1d120a" stroke="#c9a46a" strokeWidth="2.5" />
        <rect x="-17" y="-22" width="12" height="7" fill="#f0a35e" />
        <rect x="5" y="-22" width="12" height="7" fill="#f0a35e" />
        <path d="M-6 -10 h12 v10 h-12Z" fill="#c9a46a" />
        <path d="M-16 8 h32" stroke="#c9a46a" strokeWidth="3" />
        <path d="M-12 14 h24" stroke="#c9a46a" strokeWidth="2" />
      </g>
      <g transform="translate(100 166) scale(.95)"><Ball kind={ball} /></g>
      <path d="M30 184 L170 184 L162 206 L38 206Z" fill="#2a170b" stroke={`url(#${id}r)`} strokeWidth="2.5" />
      <text x="100" y="200" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontSize="13" letterSpacing="3" fill="#ead2a2">SURVIVOR</text>
    </svg>
  )
}

function Ball({ kind }: { kind: SportBall }) {
  if (kind === 'football') return (<><ellipse rx="20" ry="12" fill="#7a3a17" stroke="#3a1a08" strokeWidth="2" /><path d="M-8 0h16M-5-3v6M-1-3v6M3-3v6M7-3v6" stroke="#f3e5c8" strokeWidth="1.6" /></>)
  if (kind === 'basketball') return (<><circle r="15" fill="#c8641d" stroke="#3a1a08" strokeWidth="2" /><path d="M-15 0h30M0-15v30M-11-10q7 10 0 20M11-10q-7 10 0 20" stroke="#2a1306" strokeWidth="1.6" fill="none" /></>)
  if (kind === 'puck') return (<><ellipse cy="5" rx="17" ry="6" fill="#0e0e0e" /><rect x="-17" y="-3" width="34" height="8" fill="#141414" /><ellipse cy="-3" rx="17" ry="6" fill="#2b2b2b" stroke="#555" strokeWidth="1" /></>)
  if (kind === 'baseball') return (<><circle r="15" fill="#f2ead8" stroke="#6b5a3e" strokeWidth="1.6" /><path d="M-9-12q5 12 0 24M9-12q-5 12 0 24" stroke="#b5321e" strokeWidth="1.6" fill="none" strokeDasharray="2 2" /></>)
  if (kind === 'soccer') return (<><circle r="15" fill="#f4f4f4" stroke="#222" strokeWidth="1.6" /><path d="M0-6l6 4-2 7h-8l-2-7Z" fill="#222" /></>)
  return <circle r="9" fill="#f0a35e" stroke="#3a1a08" strokeWidth="2" />
}

'use client'

/**
 * Guillotine league home in the specialty-league design
 * (design-refs/native-league-handoff/specialty-leagues/guillotine/: GuillotineHome, GuillotineChop,
 * MobileGuillotine). Presentation only — every number is the engine's, as served by
 * /api/leagues/[leagueId]/guillotine/summary (dangerTiers, config, myRosterId, myEscapes, home).
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { ChopExplainerBlock } from '@/components/scenario-explainer/WhatDoINeed'
import Link from 'next/link'
import {
  SpecialtyCard,
  SpecialtyCountdown,
  SpecialtyFeed,
  SpecialtyGrid,
  SpecialtyHero,
  SpecialtyReplayButton,
  SpecialtyRules,
  SpecialtyShell,
  SpecialtyTag,
  specialtyAsset,
  specialtyAvatarColor,
  specialtyInitials,
  spStyles as sp,
  usePrefersReducedMotion,
  type SpecialtyFeedItem,
  type SpecialtyTone,
} from '@/components/league/specialty/SpecialtyShell'
import type { GuillotineHomeExtras } from '@/lib/league-specialty/guillotineHome'
import {
  buildChopLine,
  guillotineHeadline,
  ordinal,
  tiebreakLabels,
  tierLabel,
  type ChopLineRow,
  type DangerTierRow,
} from './guillotineHomeModel'
import gl from './guillotine-specialty.module.css'

export interface GuillotineSpecialtySummary {
  weekOrPeriod: number
  dangerTiers?: DangerTierRow[]
  myRosterId?: string | null
  myEscapes?: { weekOrPeriod: number; margin: number }[]
  home?: GuillotineHomeExtras | null
  config?: { tiebreakerOrder: string[]; teamsPerChop: number; dangerMarginPoints: number | null } | null
}

const asset = (f: string) => specialtyAsset('guillotine', f)
const TONE: Record<ChopLineRow['tier'], SpecialtyTone> = { safe: 'safe', danger: 'danger', chop_zone: 'zone' }
const BAR: Record<ChopLineRow['tier'], string> = {
  safe: 'linear-gradient(90deg,#1f7a4a,#3abe78)',
  danger: 'linear-gradient(90deg,#8a5a1c,#ffc46b)',
  chop_zone: 'linear-gradient(90deg,#8a1f16,#e0402e)',
}
const fmt = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—')

function leagueHref(leagueId: string, params: Record<string, string>) {
  return `/league/${encodeURIComponent(leagueId)}?${new URLSearchParams(params).toString()}`
}

function Avatar({ id, name, size = 34 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className={`${sp.av} ${gl.avDim}`}
      style={{ background: specialtyAvatarColor(id), width: size, height: size, fontSize: size > 40 ? 15 : 11.5 }}
      aria-hidden
    >
      {specialtyInitials(name)}
    </span>
  )
}

export function GuillotineSpecialtyHome({
  leagueId,
  sport,
  leagueName,
  summary,
}: {
  leagueId: string
  sport: string
  leagueName?: string | null
  summary: GuillotineSpecialtySummary
}) {
  const [mode, setMode] = useState<'live' | 'projected'>('live')
  const home = summary.home ?? null
  const week = summary.weekOrPeriod
  const line = useMemo(
    () => buildChopLine(summary.dangerTiers, summary.myRosterId, home?.scores),
    [summary.dangerTiers, summary.myRosterId, home?.scores],
  )
  const myChopped = home?.chopped.find((c) => c.rosterId === summary.myRosterId) ?? null
  const headline = guillotineHeadline({ week, me: line.me, alive: line.alive, myChoppedWeek: myChopped?.week ?? null })
  const title = leagueName?.trim() || 'Guillotine League'
  const alive = home?.aliveCount ?? line.alive
  const chips = [
    sport.toUpperCase(),
    ...(home?.season ? [String(home.season)] : []),
    'Guillotine',
    home ? `${home.teamCount} teams · ${alive} alive` : `${alive} alive`,
  ]
  const lineupHref = leagueHref(leagueId, { view: 'team' })
  const waiversHref = leagueHref(leagueId, { view: 'players' })
  const chopCaption = home?.chopLabel ? `After stat corrections · ${home.chopLabel}` : 'After stat corrections'

  const feed: SpecialtyFeedItem[] = useMemo(() => {
    const items: (SpecialtyFeedItem & { week: number })[] = []
    for (const c of home?.chopped ?? []) {
      items.push({
        id: `chop-${c.rosterId}`,
        week: c.week ?? 0,
        icon: asset('icon-chop.svg'),
        title: `${c.name} was chopped`,
        sub: `Week ${c.week ?? '—'}${c.points != null ? ` · ${fmt(c.points)} points` : ''} · roster released`,
      })
    }
    for (const e of summary.myEscapes ?? []) {
      items.push({
        id: `escape-${e.weekOrPeriod}`,
        week: e.weekOrPeriod + 0.1,
        icon: asset('icon-safe.svg'),
        title: `You survived week ${e.weekOrPeriod}`,
        sub: e.margin === 0 ? 'On the tiebreaker' : `+${fmt(e.margin)} over the cut`,
      })
    }
    return items.sort((a, b) => b.week - a.week).slice(0, 4)
  }, [home?.chopped, summary.myEscapes])

  const tiebreaks = tiebreakLabels(summary.config?.tiebreakerOrder)
  const me = line.me
  const meTone = me?.tier ?? 'safe'

  return (
    <SpecialtyShell format="guillotine" testId="guillotine-specialty-home">
      {/* ---------- desktop / tablet ---------- */}
      <div className={gl.desktopOnly}>
        <SpecialtyHero
          format="guillotine"
          bannerSrc={asset('banner.svg')}
          emblemSrc={asset('emblem.svg')}
          emblemAlt="Guillotine league crest"
          chips={chips}
          title={title}
          headline={headline}
          blurb="One league-wide points race. The lowest score each week is chopped and that roster drops to waivers. Last team standing wins."
          actions={[
            { label: 'Set lineup', href: lineupHref, primary: true, testId: 'guillotine-hero-lineup' },
            { label: 'Waivers', href: waiversHref, testId: 'guillotine-hero-waivers' },
            ...(home?.lastChop ? [{ label: 'See the chop', href: '#guillotine-chop', testId: 'guillotine-hero-chop' }] : []),
          ]}
          clock={<SpecialtyCountdown label="Chop locks in" target={home?.nextChopAt} caption={chopCaption} />}
        />
      </div>

      <div className={gl.desktopOnly}>
        <SpecialtyGrid
          main={
            <SpecialtyCard
              label={`The chop line · week ${week}`}
              icon={asset('icon-chop.svg')}
              testId="guillotine-chop-line"
              aside={
                <div className={sp.seg} role="group" aria-label="Score source">
                  <button type="button" aria-pressed={mode === 'live'} onClick={() => setMode('live')}>
                    Live
                  </button>
                  <button
                    type="button"
                    aria-pressed={mode === 'projected'}
                    disabled
                    title="Projected scores are not available for this league yet"
                  >
                    Projected
                  </button>
                </div>
              }
            >
              {line.rows.length === 0 ? (
                <p className={sp.empty}>The chop line appears once this week has scores.</p>
              ) : (
                <ol className={gl.list} aria-label="Alive teams, highest score first">
                  {line.rows.map((r) => (
                    <li key={r.rosterId}>
                      {r.cutAbove ? (
                        <div className={gl.cut} data-testid="guillotine-cut-line">
                          <span>CUT LINE{line.cutScore != null ? ` · ${fmt(line.cutScore)}` : ''}</span>
                        </div>
                      ) : null}
                      <div
                        className={sp.row}
                        data-testid={`guillotine-row-${r.tier}`}
                        style={
                          r.tier === 'chop_zone'
                            ? { background: 'rgba(224,64,46,.1)', borderColor: 'rgba(224,64,46,.45)' }
                            : r.isMe
                              ? { background: '#151a28', borderColor: 'rgba(159,176,220,.35)' }
                              : undefined
                        }
                      >
                        <span className={gl.rank}>{r.rank}</span>
                        <Avatar id={r.rosterId} name={r.name} />
                        <span className={gl.name}>{r.isMe ? `You · ${r.name}` : r.name}</span>
                        <div className={`${sp.bar} ${gl.barCell}`} aria-hidden>
                          <span style={{ width: `${r.barPct}%`, background: BAR[r.tier] }} />
                        </div>
                        <span className={`${sp.num} ${gl.pts}`}>{fmt(r.points)}</span>
                        <span
                          className={`${sp.num} ${gl.delta}`}
                          style={{ color: r.tier === 'chop_zone' ? '#ff9a8a' : r.tier === 'danger' ? '#ffc46b' : '#7fe0a6' }}
                        >
                          {r.tier === 'chop_zone' ? 'CUT' : `+${fmt(r.margin)}`}
                        </span>
                        <span className={gl.tagCell}>
                          <SpecialtyTag tone={TONE[r.tier]} style={{ width: '100%' }}>
                            {tierLabel(r.tier)}
                          </SpecialtyTag>
                        </span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {home && home.chopped.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <span className={sp.lbl} style={{ marginRight: 6 }}>Chopped</span>
                  {home.chopped.map((c) => (
                    <span key={c.rosterId} className={`${sp.chip} ${gl.chopChip}`}>
                      <s>{c.name}</s>
                      <span className={sp.num}>
                        Wk {c.week ?? '—'}{c.points != null ? ` · ${fmt(c.points)}` : ''}
                      </span>
                    </span>
                  ))}
                </div>
              ) : null}
            </SpecialtyCard>
          }
          rail={
            <>
              <SpecialtyCard
                variant={2}
                borderColor={meTone === 'chop_zone' ? 'rgba(224,64,46,.45)' : meTone === 'danger' ? 'rgba(255,196,107,.35)' : 'rgba(58,190,120,.35)'}
                testId="guillotine-your-survival"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset(meTone === 'safe' ? 'icon-safe.svg' : 'icon-zone.svg')} alt="" aria-hidden style={{ width: 44, height: 44 }} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className={sp.lbl} style={{ color: meTone === 'safe' ? '#7fe0a6' : meTone === 'danger' ? '#ffc46b' : '#ff9a8a' }}>
                      Your survival · week {week}
                    </span>
                    <span
                      className={`${gl.big} ${gl.survBig} ${meTone === 'danger' ? gl.survBigDanger : meTone === 'chop_zone' ? gl.survBigZone : ''}`}
                    >
                      {myChopped ? 'Chopped' : me ? (me.tier === 'chop_zone' ? 'Chop zone' : `${tierLabel(me.tier)} · +${fmt(me.margin)}`) : '—'}
                    </span>
                  </div>
                </div>
                <span className={sp.t2} style={{ fontSize: 12.5 }}>
                  {myChopped
                    ? `You were chopped in week ${myChopped.week ?? '—'}${myChopped.points != null ? ` with ${fmt(myChopped.points)}` : ''}.`
                    : me
                      ? `You’re ${ordinal(me.rank)} of ${line.alive}.${line.cutScore != null ? ` The cut is at ${fmt(line.cutScore)}.` : ''}`
                      : 'You don’t have an alive team in this league.'}
                </span>
              </SpecialtyCard>
              {tiebreaks.length > 0 ? (
                <SpecialtyCard label="Ties are broken by" testId="guillotine-tiebreaks">
                  <SpecialtyRules rules={tiebreaks} />
                </SpecialtyCard>
              ) : null}
              <SpecialtyCard label="Latest" testId="guillotine-feed">
                <SpecialtyFeed items={feed} empty="No chops yet." />
              </SpecialtyCard>
            </>
          }
        />
      </div>

      {/* ---------- phone ---------- */}
      <div className={`${gl.phoneOnly} ${gl.phone}`} data-testid="guillotine-phone-home">
        <div className={gl.phoneHead}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={gl.bg} src={asset('banner.svg')} alt="" aria-hidden />
          <div className={gl.veil} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={gl.emblem} src={asset('emblem.svg')} alt="Guillotine league crest" />
          <div className={gl.phoneHeadText}>
            <h2 className={`${gl.big} ${gl.phoneTitle}`}>{title}</h2>
            <span className={sp.t2}>
              Week {week} · {alive} alive
            </span>
          </div>
        </div>
        <SpecialtyCountdown label="Chop locks in" target={home?.nextChopAt} caption={chopCaption} />
        {me ? (
          <div
            className={`${sp.card} ${gl.phoneStatus}`}
            style={{ borderColor: me.tier === 'safe' ? 'rgba(58,190,120,.35)' : me.tier === 'danger' ? 'rgba(255,196,107,.35)' : 'rgba(224,64,46,.45)' }}
          >
            <span className={sp.lbl} style={{ color: me.tier === 'safe' ? '#7fe0a6' : me.tier === 'danger' ? '#ffc46b' : '#ff9a8a' }}>
              {me.tier === 'safe' ? 'You’re safe right now' : me.tier === 'danger' ? 'You’re in the danger tier' : 'You’re in the chop zone'}
            </span>
            <span className={`${gl.big} ${gl.phoneMargin}`} style={me.tier === 'chop_zone' ? { color: '#ffb0a4' } : undefined}>
              {me.tier === 'chop_zone' ? 'CUT' : `+${fmt(me.margin)}`}
            </span>
            <span className={sp.t2}>
              {me.tier === 'chop_zone' ? 'lowest score this week' : 'over the cut'} · {ordinal(me.rank)} of {line.alive}
            </span>
            <div className={sp.bar} aria-hidden>
              <span style={{ width: `${me.barPct}%`, background: BAR[me.tier] }} />
            </div>
          </div>
        ) : null}
        <span className={sp.lbl}>Chop zone and danger tier</span>
        <ul className={gl.list}>
          {line.rows
            .filter((r) => r.tier !== 'safe')
            .reverse()
            .slice(0, 4)
            .map((r) => (
              <li key={r.rosterId} className={sp.row} style={r.tier === 'chop_zone' ? { borderColor: 'rgba(224,64,46,.45)' } : undefined}>
                <Avatar id={r.rosterId} name={r.name} />
                <span className={gl.name} style={{ flex: 1 }}>{r.isMe ? 'You' : r.name}</span>
                <span className={`${sp.num} ${gl.pts}`}>{fmt(r.points)}</span>
                <SpecialtyTag tone={TONE[r.tier]}>{tierLabel(r.tier)}</SpecialtyTag>
              </li>
            ))}
        </ul>
        <div className={gl.phoneCtas}>
          {home?.lastChop ? (
            <a className={`${sp.btn} ${sp.btnP}`} href="#guillotine-chop">
              Watch the chop
            </a>
          ) : null}
          <Link className={`${sp.btn} ${home?.lastChop ? '' : sp.btnP}`} href={lineupHref}>
            Set lineup
          </Link>
        </div>
      </div>

      {/* What do I need to avoid the chop — lib/scenario-explainer. Hidden until there are chop scores to model. */}
      <ChopExplainerBlock leagueId={leagueId} />

      {home?.lastChop ? <GuillotineChopMoment leagueId={leagueId} lastChop={home.lastChop} aliveCount={alive} waiverLabel={home.waiverLabel} /> : null}
    </SpecialtyShell>
  )
}

const BLADE_SVG = (
  <svg viewBox="0 0 200 110" aria-hidden>
    <rect x="2" y="0" width="196" height="18" rx="3" fill="#3a1e12" stroke="#000" strokeWidth="3" />
    <path d="M14,18 L186,18 L186,60 L14,104 Z" fill="#cfd5de" stroke="#000" strokeWidth="4" strokeLinejoin="round" />
    <path d="M20,98 L180,58" stroke="#fff" strokeWidth="3" />
    <path d="M100,0 V-200" stroke="#c9a46a" strokeWidth="4" />
  </svg>
)

/**
 * Signature moment: the bottom three of the latest chopped week. "Drop the blade" drops the steel
 * over the lowest team (0.5s), draws the slash and pops the Chopped stamp; the released roster then
 * slides in with Bid buttons that stay disabled until each player's FAAB window opens. Replay resets.
 * Reduced motion: opens already chopped, with no movement.
 */
export function GuillotineChopMoment({
  leagueId,
  lastChop,
  aliveCount,
  waiverLabel,
  now = Date.now(),
}: {
  leagueId: string
  lastChop: NonNullable<GuillotineHomeExtras['lastChop']>
  aliveCount: number
  waiverLabel?: string | null
  now?: number
}) {
  const reduced = usePrefersReducedMotion()
  const [dropped, setDropped] = useState(false)
  const done = dropped || reduced
  const chopped = new Set(lastChop.choppedRosterIds)
  const cut = lastChop.bottom.find((b) => chopped.has(b.rosterId)) ?? lastChop.bottom[lastChop.bottom.length - 1] ?? null
  const cutName = cut?.name ?? 'The lowest score'
  const waivers = `/league/${encodeURIComponent(leagueId)}?view=players`

  return (
    <section
      id="guillotine-chop"
      className={`${sp.card} ${sp.pad} ${done ? gl.chopped : ''}`}
      style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(224,64,46,.14), transparent 60%), #0b0d14', gap: 16 }}
      data-testid="guillotine-chop-moment"
      data-state={done ? 'chopped' : 'armed'}
      aria-labelledby="guillotine-chop-title"
    >
      <div className={sp.momentHead}>
        <h2 id="guillotine-chop-title" className={sp.h1} style={{ fontSize: 22 }}>
          The chop · week {lastChop.week}
        </h2>
        {done ? (
          <SpecialtyReplayButton onReplay={() => setDropped(false)} />
        ) : (
          <button type="button" className={`${sp.btn} ${sp.btnP}`} onClick={() => setDropped(true)} data-testid="guillotine-drop-blade">
            Drop the blade
          </button>
        )}
      </div>
      <span className={sp.lbl}>Bottom three · week {lastChop.week} final</span>
      <div className={gl.stage}>
        {lastChop.bottom.map((b) => {
          const isTarget = cut?.rosterId === b.rosterId
          const sub = isTarget
            ? done
              ? 'Chopped · roster released'
              : 'Lowest score'
            : cut
              ? `Survived by ${fmt(b.points - cut.points)}`
              : 'Survived'
          return (
            <div key={b.rosterId} className={`${gl.card} ${isTarget ? gl.target : ''}`}>
              {isTarget ? (
                <>
                  <div className={gl.blade}>{BLADE_SVG}</div>
                  <span className={gl.slash} aria-hidden />
                </>
              ) : null}
              <Avatar id={b.rosterId} name={b.name} size={56} />
              <span className={gl.cardName}>{b.name}</span>
              <span className={`${sp.num} ${gl.cardPts}`} style={{ color: isTarget ? '#ff9a8a' : '#e8eaf2' }}>
                {fmt(b.points)}
              </span>
              <span className={sp.t3} style={{ fontSize: 12 }}>{sub}</span>
              {isTarget && done ? (
                <div className={gl.stampWrap}>
                  <span className={gl.stamp}>Chopped</span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <p className={sp.t2} style={{ margin: 0, fontSize: 13 }} aria-live="polite">
        {done
          ? `${cutName} is out${cut ? ` with ${fmt(cut.points)}` : ''}. ${aliveCount} teams remain. Their roster is on waivers.`
          : 'Scores are final. The lowest score is chopped when the blade drops.'}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset('icon-zone.svg')} alt="" aria-hidden style={{ width: 28, height: 28 }} />
          <span className={sp.lbl}>
            {done ? `Released to waivers · ${lastChop.releases.length}` : 'Roster to be released'}
          </span>
        </div>
        {lastChop.releases.length === 0 ? (
          <p className={sp.empty}>The released players show here once the roster is processed.</p>
        ) : (
          <ul className={gl.list}>
            {lastChop.releases.map((p, i) => {
              const opens = p.availableAt ? new Date(p.availableAt).getTime() : NaN
              const open = done && p.status !== 'claimed' && (!Number.isFinite(opens) || opens <= now)
              return (
                <li
                  key={p.playerId}
                  className={gl.released}
                  style={{ animationDelay: done && !reduced ? `${(0.9 + i * 0.12).toFixed(2)}s` : '0s', opacity: done ? undefined : 0.45 } as CSSProperties}
                >
                  <SpecialtyTag tone="muted" style={{ width: 44 }}>{p.position || '—'}</SpecialtyTag>
                  <span style={{ flex: 1, fontWeight: 600, minWidth: 0 }}>{p.playerName}</span>
                  {p.team ? <span className={`${sp.t3} ${sp.num}`} style={{ fontSize: 12 }}>{p.team}</span> : null}
                  {open ? (
                    <Link className={`${sp.btn} ${gl.bid}`} href={waivers} aria-label={`Bid on ${p.playerName}`}>
                      Bid
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={`${sp.btn} ${gl.bid}`}
                      disabled
                      aria-label={`Bid on ${p.playerName} (opens when the FAAB window opens)`}
                    >
                      {p.status === 'claimed' ? 'Claimed' : 'Bid'}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {waiverLabel ? (
          <div className={sp.card2} style={{ padding: 14, fontSize: 12.5, color: '#a3a9c2' }}>
            Bids on released players run with the league&rsquo;s next waiver process ({waiverLabel}).
          </div>
        ) : null}
      </div>
    </section>
  )
}

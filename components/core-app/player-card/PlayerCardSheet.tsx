'use client'

import { useEffect, useRef, useState } from 'react'

import type {
  PlayerCardComp,
  PlayerCardData,
  PlayerCardNews,
  PlayerCardTrade,
  PlayerCardWeek,
} from '@/lib/core-app/playerCard'
import type { PlayerCardRef } from './PlayerCardProvider'

/**
 * STATE 6 / STATE 7 of the design handoff, in one component.
 *
 * ⚠ ONE COMPONENT FOR BOTH FLAVOURS, BECAUSE THE DESIGN IS ONE CARD. The handoff
 * draws "universal" and "league" as two screens, but they are the same shell
 * with three swaps: the header's back-link, the stat row, and one column. Two
 * components would mean fixing every layout bug twice.
 *
 * ⚠ DESKTOP AND MOBILE ARE THE SAME MARKUP, SWITCHED IN CSS. The design shows a
 * right-hand slide-in on desktop and a full-screen sheet on mobile; those differ
 * only in how the panel is anchored and sized, so `af-player-card.css` does it
 * with one media query rather than this file branching on a width it would have
 * to measure (and would get wrong on first paint).
 *
 * ⚠ NOTHING HERE INVENTS A NUMBER. Every section is a `SectionState`; when one
 * is unavailable the card prints its REASON rather than a dash, because "—" and
 * "we have never priced kickers" look identical and only one of them tells the
 * reader whether to go looking elsewhere.
 */

function ago(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 14) return `${days}d`
  return `${Math.round(days / 7)}w`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/** A section that has no data prints why, quietly, in place of the content. */
function Absent({ reason }: { reason: string }) {
  return <p className="af-pc-absent">{reason}</p>
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="af-pc-label">{children}</div>
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: React.ReactNode
  tone?: 'accent' | 'good' | 'bad' | 'plain'
}) {
  return (
    <div className="af-pc-tile">
      <Label>{label}</Label>
      <div className={`af-pc-tile-v af-num${tone && tone !== 'plain' ? ` af-pc-tile-v--${tone}` : ''}`}>{value}</div>
      {sub ? <div className="af-pc-tile-sub">{sub}</div> : null}
    </div>
  )
}

function ScheduleRows({ weeks }: { weeks: PlayerCardWeek[] }) {
  return (
    <>
      {weeks.map((w) => (
        <div key={w.week} className={`af-pc-row${w.bye ? ' af-pc-row--muted' : ''}`}>
          <span className="af-pc-row-k">
            WK{w.week} · {w.bye ? 'BYE' : `${w.home ? 'vs' : '@'} ${w.opponent}`}
          </span>
          <span className="af-pc-row-v af-num">{w.projection != null ? w.projection.toFixed(1) : '—'}</span>
        </div>
      ))}
    </>
  )
}

function TradeRows({ trades, subject }: { trades: PlayerCardTrade[]; subject: string }) {
  return (
    <>
      {trades.map((t) => {
        /*
         * ⚠ DROP THE SUBJECT BY NAME, NOT BY POSITION. This first read
         * `acquired.slice(1)`, assuming the player whose card this is sits at
         * index 0 of his own side. He does not — the provider's array order is
         * whatever the transaction carried — so a real three-player trade
         * rendered "Moved with Jahmyr Gibbs" on Jahmyr Gibbs's own card.
         */
        const got = t.acquired.filter((n) => n && n !== subject)
        const sent = [...t.sent.filter(Boolean), ...t.picks]
        return (
          <div key={t.transactionId} className="af-pc-trade">
            <div className="af-pc-trade-h">
              <span className={`af-pc-plat af-pc-plat--${t.platform.toLowerCase()}`}>{t.platform.toUpperCase()}</span>
              {t.leagueName ? <span className="af-pc-trade-lg"> · {t.leagueName}</span> : null}
            </div>
            <div className="af-pc-trade-b">
              {sent.length > 0 ? <>Cost {sent.join(' + ')}</> : 'Package not recorded'}
              {t.tradeDate ? <span className="af-pc-faint"> · {ago(t.tradeDate)}</span> : null}
            </div>
            {got.length > 0 ? (
              <div className="af-pc-trade-b af-pc-faint">Moved with {got.join(', ')}</div>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function NewsRows({ items }: { items: PlayerCardNews[] }) {
  return (
    <>
      {items.map((n, i) => (
        <div key={`${n.title}-${i}`} className="af-pc-news">
          {n.url ? (
            <a className="af-pc-news-t" href={n.url} target="_blank" rel="noreferrer noopener">
              {n.title}
            </a>
          ) : (
            <span className="af-pc-news-t">{n.title}</span>
          )}
          <span className="af-pc-faint">
            {' '}
            — {n.source}
            {ago(n.publishedAt) ? ` · ${ago(n.publishedAt)}` : ''}
          </span>
        </div>
      ))}
    </>
  )
}

export default function PlayerCardSheet({
  subject,
  data,
  status,
  onClose,
  onOpen,
}: {
  subject: PlayerCardRef
  data: PlayerCardData | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  onClose: () => void
  onOpen: (ref: PlayerCardRef) => void
}) {
  const [insightOpen, setInsightOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // Focus lands inside the sheet, so Escape and Tab belong to it immediately.
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // Collapse the expander whenever the subject changes — a comp opened from
  // inside the card must not inherit the previous player's expanded state.
  useEffect(() => {
    setInsightOpen(false)
  }, [subject.externalId, subject.sleeperId])

  const p = data?.player
  const name = p?.name ?? subject.name
  const position = p?.position ?? subject.position ?? null
  const team = p?.team ?? subject.team ?? null
  const image = p?.imageUrl ?? subject.imageUrl ?? null
  const league = data?.league ?? null
  const market = data?.market
  const bio = data?.bio

  const openComp = (c: PlayerCardComp) => {
    onOpen({
      sport: subject.sport,
      sleeperId: c.sleeperId,
      name: c.name,
      position: c.position,
      leagueId: subject.leagueId,
    })
  }

  return (
    <div className="af-pc-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="af-pc-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} player card`}
        ref={panelRef}
      >
        {/* header ─────────────────────────────────────────────── */}
        <div className="af-pc-bar">
          <button type="button" className="af-pc-back" onClick={onClose}>
            {league ? (
              <>
                <span className={`af-pc-crest af-pc-plat--${league.platform.toLowerCase()}`} aria-hidden>
                  {initials(league.leagueName)}
                </span>
                <span>‹ {league.leagueName}</span>
              </>
            ) : (
              <span>‹ Back</span>
            )}
          </button>
          <span className="af-pc-bar-sp" />
          <button type="button" className="af-pc-x" onClick={onClose} aria-label="Close player card" ref={closeRef}>
            ✕
          </button>
        </div>

        <div className="af-pc-body">
          {/* identity ──────────────────────────────────────────── */}
          <div className="af-pc-id">
            <div className="af-pc-face">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" width={100} height={100} />
              ) : (
                <span className="af-pc-face-none" aria-hidden>
                  {initials(name)}
                </span>
              )}
            </div>
            <div className="af-pc-id-main">
              <h2 className="af-pc-name">{name}</h2>
              <div className="af-pc-meta">
                {position ? (
                  <span className="af-bd-pos" data-pos={position.toUpperCase()}>
                    {position.toUpperCase()}
                  </span>
                ) : null}
                {team ? (
                  <span className="af-pc-faint">
                    {position ? ' · ' : ''}
                    {team}
                    {p?.number != null ? ` #${p.number}` : ''}
                  </span>
                ) : null}
              </div>

              {league ? (
                <div className="af-pc-owner">
                  {league.slot === 'NOT ROSTERED' ? (
                    <span className="af-pc-owner-free">FREE AGENT</span>
                  ) : (
                    <>
                      <span className="af-pc-owner-who">
                        {league.isYours ? 'ON YOUR ROSTER' : `OWNED BY ${(league.owner?.ownerName ?? 'another manager').toUpperCase()}`}
                      </span>
                      <span className="af-pc-faint">
                        {' · '}
                        {league.owner?.teamName ?? league.slot}
                        {league.owner?.teamName ? ` · ${league.slot}` : ''}
                      </span>
                    </>
                  )}
                </div>
              ) : null}

              {/*
                The design's Propose Trade action.

                It goes to AF's own per-league trade builder rather than straight
                to the platform, because that is where the deal is actually
                priced and graded under this league's settings. The builder then
                hands off to Sleeper/ESPN/Yahoo to SEND it — AllFantasy is
                read-only on every connected platform and cannot submit a trade.

                Only on the league flavour, and only when he is not already
                yours: "propose a trade" for a player on your own roster is not
                a thing you can do.
              */}
              {league && !league.isYours && league.slot !== 'NOT ROSTERED' ? (
                <a
                  className="af-pc-cta"
                  href={`/core/trades?league=${encodeURIComponent(league.leagueId)}`}
                >
                  Propose Trade
                </a>
              ) : null}

              {bio ? (
                <div className="af-pc-bio">
                  {bio.age != null ? (
                    <span className="af-pc-bio-i">
                      <Label>AGE</Label>
                      <b>{bio.age}</b>
                    </span>
                  ) : null}
                  {bio.height ? (
                    <span className="af-pc-bio-i">
                      <Label>HT</Label>
                      <b>{bio.height}</b>
                    </span>
                  ) : null}
                  {bio.weight ? (
                    <span className="af-pc-bio-i">
                      <Label>WT</Label>
                      <b>{bio.weight}</b>
                    </span>
                  ) : null}
                  {/* 0 is a rookie and null is unknown — never collapse them. */}
                  {bio.yearsExp != null ? (
                    <span className="af-pc-bio-i">
                      <Label>EXP</Label>
                      <b>{bio.yearsExp === 0 ? 'ROOKIE' : bio.yearsExp}</b>
                    </span>
                  ) : null}
                  {bio.college ? (
                    <span className="af-pc-bio-i">
                      <Label>COLLEGE</Label>
                      <b>{bio.college}</b>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {status === 'loading' ? <p className="af-pc-absent">Loading this player&rsquo;s market…</p> : null}
          {status === 'error' ? <p className="af-pc-absent">This player&rsquo;s card could not be loaded.</p> : null}

          {/* insight ───────────────────────────────────────────── */}
          {data?.insight ? (
            <div className="af-pc-insight">
              <button
                type="button"
                className="af-pc-insight-h"
                onClick={() => setInsightOpen((v) => !v)}
                aria-expanded={insightOpen}
              >
                <span className="af-pc-dot" aria-hidden />
                <span className="af-pc-insight-t">{data.insight.headline}</span>
                <span className="af-pc-chev" aria-hidden>
                  {insightOpen ? '⌃' : '⌄'}
                </span>
              </button>
              {insightOpen ? (
                <div className="af-pc-insight-d">
                  <p>{data.insight.detail}</p>
                  {/* The basis is not decoration: it is what makes the line checkable. */}
                  <p className="af-pc-basis">Based on {data.insight.basis}.</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* stat tiles ────────────────────────────────────────── */}
          {data ? (
            <div className="af-pc-tiles">
              {league ? (
                <>
                  {league.price.available ? (
                    <Tile
                      label="LEAGUE PRICE"
                      value={league.price.data.value.toLocaleString()}
                      tone="accent"
                      sub={
                        <span className="af-pc-faint">
                          {league.price.data.mode} · {league.price.data.numQbs === 2 ? 'SF' : '1QB'} ·{' '}
                          {league.price.data.teams}-team
                        </span>
                      }
                    />
                  ) : (
                    <Tile label="LEAGUE PRICE" value="—" tone="plain" sub={<span className="af-pc-faint">not priced</span>} />
                  )}
                  <Tile label="SLOT" value={league.slot} tone="plain" />
                </>
              ) : null}

              {market?.available ? (
                <>
                  {!league ? (
                    <Tile
                      label="TRADE PRICE"
                      value={market.data.value.toLocaleString()}
                      tone="accent"
                      sub={
                        market.data.delta ? (
                          <span className={market.data.delta.change >= 0 ? 'af-pc-up' : 'af-pc-down'}>
                            {market.data.delta.change >= 0 ? '+' : ''}
                            {market.data.delta.change.toLocaleString()} · {market.data.delta.days}d
                          </span>
                        ) : (
                          <span className="af-pc-faint">no move on file</span>
                        )
                      }
                    />
                  ) : null}
                  <Tile
                    label="OVERALL RK"
                    value={market.data.overallRank != null ? `#${market.data.overallRank}` : '—'}
                  />
                  <Tile
                    label={`POS RK${position ? ` · ${position.toUpperCase()}` : ''}`}
                    value={market.data.positionRank != null ? `#${market.data.positionRank}` : '—'}
                  />
                </>
              ) : null}

              {!league && data.ownership.available ? (
                <Tile
                  label="ROSTERED"
                  value={`${Math.round(data.ownership.data.ownPct * 100)}%`}
                  sub={
                    <span className="af-pc-faint">
                      of {data.ownership.data.leaguesCounted} AF leagues
                      {data.ownership.data.startPct != null
                        ? ` · ${Math.round(data.ownership.data.startPct * 100)}% start`
                        : ''}
                    </span>
                  }
                />
              ) : null}
            </div>
          ) : null}

          {/* the price basis, which the tile above deliberately does not hide */}
          {data && market?.available && !league ? (
            <p className="af-pc-basis">
              {market.data.format.toLowerCase()} ·{' '}
              {market.data.qbFormat === 'SUPERFLEX' ? 'superflex' : 'one-QB'} · {market.data.source.toLowerCase()}
            </p>
          ) : null}
          {data && !market?.available ? <Absent reason={market?.reason ?? 'No market price.'} /> : null}

          {/* two columns ───────────────────────────────────────── */}
          {data ? (
            <div className="af-pc-cols">
              <div className="af-pc-col">
                {/* Rendered "SCHEDULE · SCHEDULE" in the league flavour before. */}
                <Label>{league ? 'SCHEDULE' : 'NEXT UP · SCHEDULE'}</Label>
                {data.schedule.available ? (
                  <>
                    <ScheduleRows weeks={data.schedule.data.weeks} />
                    {/*
                      ⚠ THE HANDOFF DREW A PROJECTION ON ALL FIVE ROWS AND WE HOLD ONE
                      WEEK. Saying so is the difference between a thin card and a card
                      that looks broken.
                    */}
                    <p className="af-pc-basis">
                      {data.schedule.data.projectedWeek != null
                        ? `Projections are published for week ${data.schedule.data.projectedWeek} only; later weeks show the fixture.`
                        : 'No projected week is published yet; these are fixtures.'}
                    </p>
                  </>
                ) : (
                  <Absent reason={data.schedule.reason} />
                )}

                {league ? (
                  <>
                    {/*
                      The design's "PLAYOFF SCHEDULE · WK 15-17". The weeks come
                      from THIS league's settings, not that literal — 15 is right
                      for 197 of 257 claimed leagues and wrong for the rest.
                    */}
                    <Label>
                      {league.playoffSchedule.available
                        ? `PLAYOFF SCHEDULE · WK ${league.playoffSchedule.data.startWeek}-${
                            league.playoffSchedule.data.startWeek +
                            league.playoffSchedule.data.weeks.length -
                            1
                          }`
                        : 'PLAYOFF SCHEDULE'}
                    </Label>
                    {league.playoffSchedule.available ? (
                      <ScheduleRows weeks={league.playoffSchedule.data.weeks} />
                    ) : (
                      <Absent reason={league.playoffSchedule.reason} />
                    )}

                    <Label>YOUR ROSTER{position ? ` AT ${position.toUpperCase()}` : ''}</Label>
                    {league.yourRoster.length > 0 ? (
                      league.yourRoster.map((r) => (
                        <div key={r.name} className="af-pc-row">
                          <span className="af-pc-row-k">{r.name}</span>
                          <span className="af-pc-row-v af-num">
                            {r.value != null ? r.value.toLocaleString() : '—'}
                          </span>
                        </div>
                      ))
                    ) : (
                      <Absent reason="You have nobody else at this position in this league, or your team is not claimed here." />
                    )}
                  </>
                ) : null}
              </div>

              <div className="af-pc-col">
                <Label>{league ? 'TRADES IN THIS LEAGUE' : 'RECENT TRADES'}</Label>
                {league ? (
                  league.trades.length > 0 ? (
                    <TradeRows trades={league.trades} subject={name} />
                  ) : (
                    <Absent reason="No trade in this league has moved him." />
                  )
                ) : data.trades.available ? (
                  <>
                    <TradeRows trades={data.trades.data} subject={name} />
                    {/* Scope stated: these are our imports, not the whole sport. */}
                    <p className="af-pc-basis">Trades in leagues AllFantasy has imported.</p>
                  </>
                ) : (
                  <Absent reason={data.trades.reason} />
                )}

                {!league ? (
                  <>
                    <Label>SIMILAR PRICE</Label>
                    {data.comps.available ? (
                      <div className="af-pc-chips">
                        {data.comps.data.map((c) => (
                          <button key={c.sleeperId} type="button" className="af-pc-chip" onClick={() => openComp(c)}>
                            {c.name}
                            <span className="af-pc-faint af-num"> {c.value.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Absent reason={data.comps.reason} />
                    )}
                  </>
                ) : null}

                <Label>LATEST</Label>
                {data.news.available ? <NewsRows items={data.news.data} /> : <Absent reason={data.news.reason} />}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

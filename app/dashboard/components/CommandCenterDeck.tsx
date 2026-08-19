'use client'

/**
 * CommandCenterDeck — the dashboard's cross-league brain surface: three
 * connected sections from ONE payload (/api/dashboard/command-center):
 *
 *  1. COMMAND FEED — urgency-ranked, every item tagged with the ENGINE that
 *     emitted it (Decision OS, Trade engine, Draft intel, LeagueContext,
 *     matchup model) and deep-linked to the surface that renders it fully.
 *  2. YOUR WEEK — win-probability strip across every league, rivalry records
 *     from the Legacy H2H sync, pirate-week flags, "favored in X of Y".
 *  3. PORTFOLIO — total roster market value, per-league breakdown, 30-day
 *     risers/fallers.
 *
 * The same payload grounds Chimmy's dashboard-level chat, so asking Chimmy
 * "what needs me today?" cites exactly what this deck shows.
 */

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { CommandCenterPayload, FeedItem } from '@/lib/dashboard-intel/commandCenterService'
import { sleeperPlayerHeadshot } from '@/lib/sports-data/headshots'
import { WarRoomCard } from './warroom/WarRoomCard'
import { SectionHeading } from './warroom/SectionHeading'
import '@/components/decide/broadcast-deck.css'

type ApiResponse = { center: CommandCenterPayload | null; error?: string }

const SEV_STYLE: Record<FeedItem['severity'], { rail: string; chip: string; label: string }> = {
  crit: { rail: '#ff6b8b', chip: 'crit', label: 'act now' },
  warn: { rail: '#ffc53d', chip: 'warn', label: 'soon' },
  info: { rail: '#7fb3ff', chip: 'info', label: 'fyi' },
  ok: { rail: '#3ddc97', chip: 'ok', label: 'good' },
}

export function CommandCenterDeck({ userId }: { userId: string }) {
  const [center, setCenter] = useState<CommandCenterPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetch('/api/dashboard/command-center', { credentials: 'same-origin', cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<ApiResponse>) : null))
      .then((payload) => {
        if (!cancelled) setCenter(payload?.center ?? null)
      })
      .catch(() => {
        /* deck is additive — the rest of the dashboard renders regardless */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (!loading && (!center || center.leaguesScanned === 0)) return null

  return (
    <div className="bdx space-y-5" data-testid="command-center-deck" style={{ background: 'transparent', padding: 0 }}>
      {loading || !center ? (
        <WarRoomCard className="p-5">
          <div className="bdx-skel" style={{ height: 72 }} />
        </WarRoomCard>
      ) : (
        <>
          {/* ── 1. Command feed ── */}
          <WarRoomCard className="p-4 sm:p-5">
            <SectionHeading
              trailing={
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/30">
                  {center.leaguesScanned} leagues · {center.feed.length} items
                </span>
              }
            >
              Needs your call — all leagues
            </SectionHeading>
            {center.feed.length > 0 ? (
              <div className="mt-3 space-y-2">
                {center.feed.map((f) => {
                  const sev = SEV_STYLE[f.severity]
                  return (
                    <Link
                      key={f.id}
                      href={f.href}
                      className="block rounded-xl border border-[#262c6a] bg-[#12163e]/70 px-3.5 py-2.5 transition hover:bg-[#12163e]"
                      style={{ borderLeft: `3px solid ${sev.rail}` }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-extrabold text-[#f0f2ff]">{f.title}</span>
                        <span className={`bdx-sev ${sev.chip}`}>{sev.label}</span>
                        <span className="ml-auto text-[10.5px] font-bold uppercase tracking-wide text-[#5d64a3]">
                          {f.leagueName}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-[#8b93cf]">{f.detail}</div>
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-[#ff8a3d]/80">
                        via {f.engine}
                      </div>
                    </Link>
                  )
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-[#262c6a] px-4 py-5 text-center">
                <p className="text-[13px] font-bold text-[#3ddc97]">All clear — nothing needs your call</p>
                <p className="mt-1 text-[11px] text-[#5d64a3]">
                  Every engine reported in and found no pending decisions across your leagues.
                </p>
              </div>
            )}
          </WarRoomCard>

          {/* ── 2. Your week ── */}
          {center.week.matchups.length > 0 ? (
            <WarRoomCard className="p-4 sm:p-5">
              <SectionHeading
                trailing={
                  center.week.projectedCount > 0 ? (
                    <span className="text-[11px] font-black italic uppercase text-[#f0f2ff]">
                      favored in {center.week.favoredCount} of {center.week.projectedCount}
                    </span>
                  ) : undefined
                }
              >
                Your week — every matchup
              </SectionHeading>
              <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
                {center.week.matchups.map((m) => (
                  <Link
                    key={m.leagueId}
                    href={`/league/${m.leagueId}?view=decide`}
                    className="min-w-[210px] shrink-0 rounded-xl border border-[#262c6a] bg-[#12163e]/70 p-3 transition hover:bg-[#12163e]"
                  >
                    <div className="truncate text-[10.5px] font-bold uppercase tracking-wide text-[#5d64a3]">
                      {m.leagueName}
                      {m.pirate ? <span className="ml-1 text-[#ff6b8b]">☠</span> : null}
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="text-[20px] font-black italic tabular-nums text-[#f0f2ff]">
                        {m.winProb != null ? `${m.winProb.toFixed(0)}%` : '—'}
                      </span>
                      <span className="truncate text-[11px] text-[#8b93cf]">vs {m.oppName}</span>
                    </div>
                    {m.winProb != null ? (
                      <div className="mt-1.5 h-[4px] overflow-hidden rounded-full bg-[#1c2153]">
                        <div
                          className="h-full"
                          style={{ width: `${m.winProb}%`, background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }}
                        />
                      </div>
                    ) : null}
                    <div className="mt-1.5 text-[10px] tabular-nums text-[#5d64a3]">
                      {m.myPoints > 0 || m.oppPoints > 0
                        ? `live ${m.myPoints.toFixed(1)}–${m.oppPoints.toFixed(1)} · `
                        : ''}
                      proj {m.myProjected?.toFixed(0) ?? '—'}–{m.oppProjected?.toFixed(0) ?? '—'}
                      {m.rivalry
                        ? ` · all-time ${m.rivalry.wins}–${m.rivalry.losses}${m.rivalry.ties > 0 ? `–${m.rivalry.ties}` : ''}`
                        : ''}
                    </div>
                  </Link>
                ))}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[#5d64a3]">{center.week.modelNote}</p>
            </WarRoomCard>
          ) : null}

          {/* ── 3. Portfolio ── */}
          {center.portfolio.leagues.length > 0 ? (
            <WarRoomCard className="p-4 sm:p-5">
              <SectionHeading
                trailing={
                  <span className="text-[13px] font-black italic tabular-nums text-[#f0f2ff]">
                    {center.portfolio.totalValue.toLocaleString()}
                  </span>
                }
              >
                Portfolio — roster market value
              </SectionHeading>
              <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div>
                  {center.portfolio.leagues.map((l) => {
                    const max = center.portfolio.leagues[0]?.rosterValue || 1
                    return (
                      <Link key={l.leagueId} href={`/league/${l.leagueId}?view=decide`} className="mb-2 block">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12px] font-semibold text-[#c6cbf5]">{l.leagueName}</span>
                          <span className="text-[12px] font-bold tabular-nums text-[#f0f2ff]">
                            {l.rosterValue.toLocaleString()}
                            <span className="ml-1 text-[9.5px] font-semibold uppercase text-[#5d64a3]">{l.mode}</span>
                          </span>
                        </div>
                        <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-[#1c2153]">
                          <div
                            className="h-full"
                            style={{ width: `${Math.max(4, (l.rosterValue / max) * 100)}%`, background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }}
                          />
                        </div>
                      </Link>
                    )
                  })}
                </div>
                <div className="space-y-3">
                  {center.portfolio.risers.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-black uppercase italic tracking-widest text-[#3ddc97]">Risers · 30d</p>
                      {center.portfolio.risers.map((p) => (
                        <MoverRow key={`${p.leagueId}:${p.playerId}`} {...p} up />
                      ))}
                    </div>
                  ) : null}
                  {center.portfolio.fallers.length > 0 ? (
                    <div>
                      <p className="text-[10px] font-black uppercase italic tracking-widest text-[#ff6b8b]">Fallers · 30d</p>
                      {center.portfolio.fallers.map((p) => (
                        <MoverRow key={`${p.leagueId}:${p.playerId}`} {...p} up={false} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[#5d64a3]">
                {center.portfolio.source}. {center.portfolio.note}
              </p>
            </WarRoomCard>
          ) : null}

          {/* ── 3b. Rivalry radar (Legacy H2H vs this week's opponents) ── */}
          {center.week.matchups.some((m) => m.rivalry) ? (
            <WarRoomCard className="p-4 sm:p-5">
              <SectionHeading
                trailing={
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white/30">
                    from every matchup ever synced
                  </span>
                }
              >
                Rivalry radar — this week&apos;s opponents
              </SectionHeading>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {center.week.matchups
                  .filter((m) => m.rivalry)
                  .map((m) => {
                    const r = m.rivalry!
                    const leading = r.wins > r.losses
                    const tied = r.wins === r.losses
                    return (
                      <Link
                        key={m.leagueId}
                        href={`/league/${m.leagueId}?view=legacy`}
                        className="rounded-xl border border-[#262c6a] bg-[#12163e]/70 p-3 transition hover:bg-[#12163e]"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[12px] font-extrabold text-[#f0f2ff]">
                            you vs {m.oppName}
                          </span>
                          <span
                            className={`text-[15px] font-black italic tabular-nums ${
                              tied ? 'text-[#7fb3ff]' : leading ? 'text-[#3ddc97]' : 'text-[#ff6b8b]'
                            }`}
                          >
                            {r.wins}–{r.losses}
                            {r.ties > 0 ? `–${r.ties}` : ''}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide text-[#5d64a3]">
                          {m.leagueName}
                          {m.pirate ? ' · ☠ pirate stakes' : ''}
                        </div>
                        <div className="mt-1 text-[11px] tabular-nums text-[#8b93cf]">
                          avg margin {r.avgMargin > 0 ? '+' : ''}
                          {r.avgMargin.toFixed(1)} for you
                          {r.closest
                            ? ` · closest ever: ${r.closest.season} wk ${r.closest.week} (${r.closest.margin > 0 ? '+' : ''}${r.closest.margin.toFixed(1)})`
                            : ''}
                        </div>
                        <div className="mt-1 text-[10px] text-[#5d64a3]">
                          {tied
                            ? 'Dead even all-time — this one breaks the tie.'
                            : leading
                              ? 'You own this rivalry — keep it that way.'
                              : 'They own you all-time — statement week.'}
                        </div>
                      </Link>
                    )
                  })}
              </div>
            </WarRoomCard>
          ) : null}

          {/* ── 4. Player exposure ── */}
          {center.exposure.rows.length > 0 ? (
            <WarRoomCard className="p-4 sm:p-5">
              <SectionHeading
                trailing={
                  <span className="text-[10px] font-bold uppercase tracking-wide text-white/30">
                    across {center.exposure.rostersCounted} rosters
                  </span>
                }
              >
                Player exposure
              </SectionHeading>
              <div className="mt-3 space-y-1.5">
                {center.exposure.rows.map((r) => {
                  const src = sleeperPlayerHeadshot(r.playerId)
                  return (
                    <div key={r.playerId} className="flex items-center gap-2.5" title={r.leagueNames.join(' · ')}>
                      {src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={src}
                          alt=""
                          loading="lazy"
                          className="h-6 w-6 shrink-0 rounded-full object-cover"
                          style={{ background: '#1c2153' }}
                          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#c6cbf5]">
                        {r.name}
                        <span className="text-[10px] text-[#5d64a3]"> {r.position ?? ''}</span>
                        {r.injury ? (
                          <span
                            className="bdx-sev warn"
                            style={{ marginLeft: 6 }}
                            title={`${r.injury.status}${r.injury.note ? ` — ${r.injury.note}` : ''} · hits: ${r.leagueNames.join(', ')}`}
                          >
                            ⚕ {r.injury.status} · hits {r.count} league{r.count === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </span>
                      <div className="hidden h-[4px] w-24 overflow-hidden rounded-full bg-[#1c2153] sm:block">
                        <div
                          className="h-full"
                          style={{ width: `${r.exposurePct}%`, background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }}
                        />
                      </div>
                      <span className="w-24 text-right text-[11px] font-bold tabular-nums text-[#f0f2ff]">
                        {r.count} of {center.exposure.rostersCounted} · {r.exposurePct}%
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[#5d64a3]">{center.exposure.note}</p>
            </WarRoomCard>
          ) : null}

          <p className="text-center text-[9.5px] font-semibold uppercase tracking-widest text-[#5d64a3]">
            wired to: {center.engines.join(' · ')} — ask Chimmy anything about the above; it reads the same facts
          </p>
        </>
      )}
    </div>
  )
}

function MoverRow({
  playerId,
  name,
  position,
  leagueName,
  value,
  trend30Day,
  up,
}: {
  playerId: string
  name: string
  position: string | null
  leagueName: string
  value: number
  trend30Day: number
  up: boolean
}) {
  const src = sleeperPlayerHeadshot(playerId)
  return (
    <div className="mt-1 flex items-center gap-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-5 w-5 shrink-0 rounded-full object-cover"
          style={{ background: '#1c2153' }}
          onError={(e) => e.currentTarget.style.setProperty('display', 'none')}
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#c6cbf5]">
        {name}
        <span className="text-[9.5px] text-[#5d64a3]"> {position ?? ''} · {leagueName}</span>
      </span>
      <span className={`text-[11px] font-bold tabular-nums ${up ? 'text-[#3ddc97]' : 'text-[#ff6b8b]'}`}>
        {trend30Day > 0 ? '+' : ''}
        {trend30Day.toLocaleString()}
      </span>
      <span className="text-[10px] tabular-nums text-[#5d64a3]">{value.toLocaleString()}</span>
    </div>
  )
}

export default CommandCenterDeck

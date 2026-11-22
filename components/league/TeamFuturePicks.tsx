'use client'

import { pickSlotLabel } from '@/lib/league/pickSlotLabel'
import { projectedSlotFor, useFuturePicks } from './useFuturePicks'

/**
 * "Future draft picks" at the foot of the Team tab (owner's page review #4): the viewer's picks by
 * season — their own, ones acquired ("via"), and ones traded away ("to", struck through) — and, for
 * next season's draft, each pick's projected slot from the league's own draft-order engine.
 *
 * Renders nothing when the league tracks no picks or the read fails, so a redraft league never shows
 * an empty "0 picks" section.
 */
const T = {
  text: 'var(--lsk-text, #fff)',
  text2: 'var(--lsk-text2, rgba(255,255,255,.8))',
  muted: 'var(--lsk-muted, rgba(255,255,255,.6))',
  line: 'var(--lsk-line, rgba(255,255,255,.1))',
  surface: 'var(--lsk-surface, #0e1119)',
  accent: 'var(--lsk-accent, #e8c07a)',
  strong: 'var(--lsk-accent-strong, #d4a24c)',
  soft: 'var(--lsk-soft, rgba(212,162,76,.12))',
}

type Chip = { key: string; round: number; label: string; sub: string; kind: 'own' | 'got' | 'gone'; proj: string | null }

export function TeamFuturePicks({ leagueId }: { leagueId: string }) {
  const view = useFuturePicks(leagueId)
  const board = view?.board
  const me = board?.teams.find((t) => t.isViewer)
  if (!view || !board || !me) return null
  const myIds = view.ids.find((i) => i.rosterId === me.rosterId) ?? null
  const draftSeason = view.projection?.draftSeason ?? null
  const slotOf = (teamName: string | null) => {
    const ids = teamName == null ? myIds : view.ids.find((i) => i.name === teamName) ?? null
    return projectedSlotFor(view, ids)
  }

  const traded = Object.values(me.tradedAwayBySeason).reduce((n, list) => n + list.length, 0)
  const rows = board.seasons.map((season) => {
    const chips: Chip[] = [
      ...(me.bySeason[season] ?? []).map((p, i) => {
        const slot = season === draftSeason ? slotOf(p.fromTeam) : null
        return {
          key: `h${season}-${p.round}-${i}`,
          round: p.round,
          label: p.label,
          sub: p.fromTeam ? `via ${p.fromTeam}` : 'Your pick',
          kind: (p.fromTeam ? 'got' : 'own') as Chip['kind'],
          proj: slot ? `${slot.status === 'locked' ? '' : 'proj. '}${pickSlotLabel(p.round, slot.slot)}` : null,
        }
      }),
      ...(me.tradedAwayBySeason[season] ?? []).map((p, i) => ({
        key: `t${season}-${p.round}-${i}`,
        round: p.round,
        label: p.label,
        sub: `to ${p.toTeam}`,
        kind: 'gone' as const,
        proj: null,
      })),
    ].sort((a, b) => a.round - b.round)
    return { season, chips }
  })

  return (
    <section className="mt-6 flex flex-col gap-3" aria-labelledby="team-future-picks" data-testid="team-future-picks">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="team-future-picks" className="m-0 text-[20px] font-extrabold" style={{ color: T.text }}>Future draft picks</h3>
        <span className="text-[14px]" style={{ color: T.text2 }}>
          <b style={{ color: T.text }}>{me.total}</b> picks · <b style={{ color: T.accent }}>{me.firsts === 1 ? '1 first-rounder' : `${me.firsts} first-rounders`}</b>
          {traded ? ` · ${traded} traded away` : ''}
        </span>
      </div>
      {board.coverage === 'traded_only' ? (
        <p className="m-0 text-[13px]" style={{ color: T.muted }}>Only traded picks are on file for this league; each team&apos;s own picks will show once its draft settings sync.</p>
      ) : null}
      {rows.map((r) => (
        <div key={r.season} className="grid items-start gap-3 rounded-2xl border px-4 py-3" style={{ gridTemplateColumns: '64px minmax(0,1fr)', borderColor: T.line, background: T.surface }}>
          <span className="pt-1.5 text-[20px] font-extrabold" style={{ color: T.text }}>{r.season}</span>
          <div className="flex flex-wrap gap-2.5">
            {r.chips.length === 0 ? <span className="pt-2 text-[13px]" style={{ color: T.muted }}>No picks this season</span> : null}
            {r.chips.map((c) => (
              <div
                key={c.key}
                className="flex min-h-[60px] min-w-[100px] flex-col gap-0.5 rounded-xl px-3 py-2"
                style={
                  c.kind === 'own'
                    ? { border: `1.5px solid ${T.strong}`, background: T.soft, color: T.text }
                    : c.kind === 'got'
                      ? { border: `1.5px dashed ${T.strong}`, color: T.text }
                      : { border: `1.5px solid ${T.line}`, color: T.muted, textDecoration: 'line-through' }
                }
              >
                <span className="text-[15px] font-extrabold">{c.label}</span>
                <span className="text-[12px] opacity-85">{c.sub}</span>
                {c.proj ? <span className="af-proj-af text-[12px]" style={{ textDecoration: 'none' }}>{c.proj}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      {view.projection ? (
        <p className="m-0 text-[13px]" style={{ color: T.muted }}>
          Projected slots for the {view.projection.draftSeason} draft follow this league&apos;s draft-order setting and update after every week.
        </p>
      ) : null}
    </section>
  )
}

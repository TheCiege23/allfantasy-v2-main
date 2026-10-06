'use client'

import Link from 'next/link'
import { PlayerAvatar, TeamLogo } from '@/components/core-app/player-finder/PlayerMarks'
import { PlayerSearchBox } from '@/components/core-app/player-finder/PlayerSearchBox'
import { comparePlayers } from '@/lib/core-app/playerCompare'
import type { PlayerDetail } from '@/lib/core-app/playerFinder'
import { readiness } from '@/lib/core-app/playerMoves'
import { platformLabel } from '@/lib/core-app/platformLinks'
import { playerRef } from '@/lib/core-app/playerRef'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { compareCopy, compareHeadlineText, compareNoteText, type CompareCopy } from '@/lib/core-app/finderSearchCopy'
import { designationText, finderCopy, type FinderCopy } from '@/lib/core-app/playerFinderCopy'
import { slotText } from '@/lib/core-app/playerMovesCopy'

/**
 * Two players side by side — the same header and tiles for each, then one
 * league table with a column per player and a computed verdict line.
 *
 * Replaces the single detail card when a second player is held (`?vs=`).
 * The decision column beside it stays about the first player; Swap turns the
 * pair round, Clear goes back to the single card.
 *
 * Spanish (2026-10-05): every word is built at render from `useOptionalLanguage` — the tile labels
 * are Player Finder's own (`finderCopy`), the verdict and the row notes come from playerCompare.ts's
 * parts (finderSearchCopy.ts), the slot chip and readiness go through `slotText` / `designationText`.
 */

function slotTone(slot: string | null): 'good' | 'warn' | 'bad' | 'none' {
  if (slot === 'STARTER') return 'good'
  if (slot === 'IR SLOT') return 'warn'
  if (slot === 'BENCH' || slot === 'TAXI') return 'bad'
  return 'none'
}

function Head({ d, level, language }: { d: PlayerDetail; level: 2 | 3; language: string }) {
  const ready = readiness(d.injury.available ? d.injury.data.status : null, d.injury.available)
  const H = level === 2 ? 'h2' : 'h3'
  return (
    <div className="af-pf-cmp-head">
      <PlayerAvatar src={d.player.imageUrl} name={d.player.name} size={56} />
      <div className="af-pf-cmp-who">
        <H className="af-display af-pf-cmp-name">{d.player.name}</H>
        <div className="af-pf-cmp-line">
          {d.player.position ?? ''}
          {d.player.team ? (
            <>
              {d.player.position ? ' · ' : ''}
              <TeamLogo sport={d.player.sport} team={d.player.team} />
              {d.player.team}
            </>
          ) : null}
          {ready ? (
            <span className="af-chip af-num af-pf-ready af-pf-cmp-ready" data-tone={ready.tone}>
              {designationText(ready.label, language)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

type Tile = { label: string; a: string | null; b: string | null; lead: 'a' | 'b' | null; help?: string }

/** Which side leads, given a number each and whether more or less is better; null when either is missing or they tie. */
function leader(a: number | null, b: number | null, better: 'higher' | 'lower'): 'a' | 'b' | null {
  if (a == null || b == null || a === b) return null
  const aWins = better === 'higher' ? a > b : a < b
  return aWins ? 'a' : 'b'
}

function tilesFor(a: PlayerDetail, b: PlayerDetail, fc: FinderCopy, t: CompareCopy): Tile[] {
  const proj = (d: PlayerDetail) => (d.projection.available ? d.projection.data.points : null)
  const afProj = (d: PlayerDetail) => (d.afProjection?.available ? d.afProjection.data.points : null)
  const rank = (d: PlayerDetail) => (d.positionRank.available ? d.positionRank.data.rank : null)
  const rankLabel = (d: PlayerDetail) => (d.positionRank.available ? `${d.positionRank.data.position}${d.positionRank.data.rank}` : null)
  const snap = (d: PlayerDetail) => (d.snapShare.available ? d.snapShare.data.share : null)
  const week = a.projection.available ? a.projection.data.week : b.projection.available ? b.projection.data.week : null
  const fmt = (n: number | null, f: (n: number) => string) => (n == null ? null : f(n))
  return [
    {
      label: week ? fc.projWeek(week) : fc.projThisWeek,
      a: fmt(proj(a), (n) => n.toFixed(1)),
      b: fmt(proj(b), (n) => n.toFixed(1)),
      lead: leader(proj(a), proj(b), 'higher'),
      help: t.projHelp,
    },
    // AllFantasy's own engine, same week and same standard scoring as the row above.
    {
      label: week ? fc.afProjWeek(week) : fc.afProj,
      a: fmt(afProj(a), (n) => n.toFixed(1)),
      b: fmt(afProj(b), (n) => n.toFixed(1)),
      lead: leader(afProj(a), afProj(b), 'higher'),
      help: t.afProjHelp,
    },
    // A rank reads the other way: TE6 leads TE9.
    { label: fc.posRank, a: rankLabel(a), b: rankLabel(b), lead: leader(rank(a), rank(b), 'lower') },
    { label: fc.snapShare, a: fmt(snap(a), (n) => `${Math.round(n * 100)}%`), b: fmt(snap(b), (n) => `${Math.round(n * 100)}%`), lead: leader(snap(a), snap(b), 'higher') },
    // Age is context, not a contest.
    { label: fc.age, a: a.bio.age != null ? String(a.bio.age) : null, b: b.bio.age != null ? String(b.bio.age) : null, lead: null },
  ]
}

function Cell({
  c,
  name,
  t,
  language,
}: {
  c: { slot: string | null; isYours: boolean; ownerName: string | null; points: number | null; unchecked: boolean }
  name: string
  t: CompareCopy
  language: string
}) {
  if (c.unchecked) return <span className="af-pf-nothing">{t.unchecked}</span>
  if (!c.slot) return <span className="af-pf-nothing">{t.notOnRoster}</span>
  return (
    <span className="af-pf-cmp-cell">
      <span
        className="af-chip af-num af-pf-slot"
        data-tone={slotTone(c.isYours ? c.slot : null)}
        title={c.isYours ? t.slotTitleYours(name) : c.ownerName ? t.slotTitleOwner(c.ownerName, name) : t.slotTitleOther(name)}
      >
        {slotText(c.slot, language)}
      </span>
      {!c.isYours && c.ownerName ? <span className="af-pf-cmp-owner">@{c.ownerName}</span> : null}
      {c.points != null ? <span className="af-num af-pf-cmp-pts">{c.points.toFixed(1)}</span> : null}
    </span>
  )
}

export function PlayerCompare({
  a,
  b,
  query,
  selectedLeagueId,
  signedIn,
  swapHref,
  clearHref,
}: {
  a: PlayerDetail
  b: PlayerDetail
  query: string
  selectedLeagueId: string | null
  signedIn: boolean
  swapHref: string
  clearHref: string
}) {
  const { language } = useOptionalLanguage()
  const t = compareCopy(language)
  const f = finderCopy(language)
  const cmp = comparePlayers(a, b)
  const aLast = a.player.name.trim().split(/\s+/).slice(-1)[0] ?? a.player.name
  const bLast = b.player.name.trim().split(/\s+/).slice(-1)[0] ?? b.player.name
  const tiles = tilesFor(a, b, f, t)

  return (
    <section className="af-card af-pf-cmp" aria-labelledby="af-pf-cmp-h">
      <header className="af-pf-cmp-top">
        <span className="af-label" id="af-pf-cmp-h">
          {t.heading(aLast, bLast)}
        </span>
        <div className="af-pf-cmp-actions">
          <Link className="af-btn af-btn--ghost af-pf-cmp-btn" href={swapHref}>
            {t.swap}
          </Link>
          <Link className="af-btn af-btn--ghost af-pf-cmp-btn" href={clearHref}>
            {t.clear}
          </Link>
        </div>
      </header>

      <div className="af-pf-cmp-heads">
        <Head d={a} level={2} language={language} />
        <Head d={b} level={3} language={language} />
      </div>

      <p className="af-pf-cmp-verdict">{compareHeadlineText(cmp, language)}</p>

      <div className="af-pf-cmp-tiles" role="table" aria-label={t.sideBySide}>
        {tiles.map((t) => (
          <div className="af-pf-cmp-tile" role="row" key={t.label}>
            <span className="af-pf-cmp-tile-label" role="rowheader">
              <span className="af-label">{t.label}</span>
              {t.help ? <span className="af-pf-cmp-tile-help">{t.help}</span> : null}
            </span>
            <span className="af-pf-cmp-tile-value af-num" role="cell" data-lead={t.lead === 'a' ? 'true' : undefined}>
              {t.a ?? '—'}
            </span>
            <span className="af-pf-cmp-tile-value af-num" role="cell" data-lead={t.lead === 'b' ? 'true' : undefined}>
              {t.b ?? '—'}
            </span>
          </div>
        ))}
      </div>

      {signedIn ? (
        cmp.rows.length === 0 ? (
          <p className="af-pf-unavailable">{t.neither}</p>
        ) : (
          <div className="af-pf-cmp-table-wrap">
            <table className="af-pf-table af-pf-cmp-table" aria-label={t.acrossYourLeagues}>
              <thead>
                <tr>
                  <th>{f.colLeague}</th>
                  <th>{aLast}</th>
                  <th>{bLast}</th>
                  <th className="af-pf-cmp-gap-h">{t.gap}</th>
                </tr>
              </thead>
              <tbody>
                {cmp.rows.map((r) => (
                  <tr key={r.leagueId} data-note={r.note ? 'true' : undefined}>
                    <td className="af-pf-cmp-col-league">
                      <span className="af-pf-cmp-league">{r.leagueName}</span>
                      <span className="af-pf-cmp-platform">{platformLabel(r.platform)}</span>
                      {/* On a phone the Gap column is gone; the figure sits by the league name instead. */}
                      {r.gap != null ? (
                        <span className="af-num af-pf-cmp-gap-m" data-tone={r.gap > 0 ? 'good' : r.gap < 0 ? 'bad' : 'none'} aria-hidden>
                          {`${r.gap > 0 ? '+' : ''}${r.gap.toFixed(1)} ${r.gap > 0 ? aLast : r.gap < 0 ? bLast : t.even}`}
                        </span>
                      ) : null}
                      {r.note ? <span className="af-pf-cmp-note">{compareNoteText(r, aLast, bLast, language)}</span> : null}
                    </td>
                    <td className="af-pf-cmp-col-a">
                      {/* Column labels, shown only where the header row is not: the phone layout. */}
                      <span className="af-label af-pf-cmp-col" aria-hidden>
                        {aLast}
                      </span>
                      <Cell c={r.a} name={aLast} t={t} language={language} />
                    </td>
                    <td className="af-pf-cmp-col-b">
                      <span className="af-label af-pf-cmp-col" aria-hidden>
                        {bLast}
                      </span>
                      <Cell c={r.b} name={bLast} t={t} language={language} />
                    </td>
                    <td className="af-num af-pf-cmp-gap" data-tone={r.gap == null ? undefined : r.gap > 0 ? 'good' : r.gap < 0 ? 'bad' : 'none'}>
                      {r.gap == null ? '—' : `${r.gap > 0 ? '+' : ''}${r.gap.toFixed(1)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <p className="af-pf-unavailable">{t.signIn}</p>
      )}

      <p className="af-pf-block-sub">{t.footnote(aLast, bLast)}</p>

      <div className="af-pf-cmp-again">
        <span className="af-label">{t.compareAgain(aLast)}</span>
        <PlayerSearchBox query={query} selectedLeagueId={selectedLeagueId} signedIn={signedIn} variant="compare" compareWith={playerRef(a.player.sport, a.player.externalId)} />
      </div>
    </section>
  )
}

export default PlayerCompare

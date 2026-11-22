'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { TradeBoardSection } from './TradeBoardSection'
/*
 * ⚠ THE CLASS ON THE ROOT IS HALF THE FIX; THIS IMPORT IS THE OTHER HALF.
 * `.af-core` selects nothing unless af-core.css is in the bundle, and the
 * standalone route pulls in no other af-* stylesheet — so without this line the
 * tokens would be undefined there and every var() would resolve to nothing.
 * Nothing throws and nothing 404s; the screen just paints unstyled, which is
 * precisely how this class of break survives review.
 *
 * A JS import rather than an `@import` inside a CSS file: per app/layout.tsx an
 * @import inside a route-bundled CSS file is dropped once another af-*.css is
 * concatenated ahead of it. Same rule ImportV4 and LiveScores already follow.
 */
import '@/components/core-app/af-core.css'
/*
 * The redraft /core batch (B2). Its rules apply only under the shell's redraft stamp
 * (`.af-core.af-shell[data-format=redraft]`), so the standalone route — which has no shell — and every
 * non-redraft league render exactly as before. The `af-dh-*` classes below are hooks for it and carry
 * no style of their own.
 */
import '@/components/core-app/af-core-redraft-myteam.css'
/* The 2026-11 redesign (board: DefenseHub). Its own `af-dfh-*` prefix, because `.af-dh` is also Draft HQ's. */
import '@/components/core-app/af-defense-hub.css'

import type { DefenseHubPayload, DefenseHubState } from '@/lib/idp-projections/defenseHub'
import { FOREIGN_IDS_UNREADABLE } from '@/lib/core-app/foreignIdSpaceCopy'
import { ValuesPageLink } from '@/components/values/ValuesPageLink'
import { useMessages } from '@/components/i18n/useMessages'
import { defenseHubMessages } from '@/lib/core-app/messages/defenseHub'
import { getAppIntlLocale } from '@/lib/i18n/appLocale'

/**
 * Defense Hub — rostered defenders, what they are projected for under THIS league's scoring,
 * how much they play, what they actually do, and how their defence has been played.
 *
 * ⚠ EVERY NUMBER ON THIS PAGE USED TO BE INVENTED. The previous version built its rows from
 * `const MOCK_IDS = ['def1','def2','def3']`, named the players `Defender 1`, `Defender 2`,
 * `Defender 3`, took their points from a hash of the id string, set snap shares to `60 + i`,
 * and called the opponents `@OPP0`. It rendered as analysis.
 *
 * The rule that replaced it: if a number cannot be traced to a stat line, it does not render.
 * An absence shows as an em dash with the reason beside it — never a zero, never a placeholder,
 * and never a row quietly dropped, because a missing row reads as "nobody thought to look".
 *
 * 2026-11-14, said once: the headline is the answer (who leads your defense), one line says what the
 * projections are built from, snap share and "what they actually do" are one table, and every method
 * note — the rule above included — sits once in "How these numbers work" at the bottom instead of on
 * every card. The rule itself is unchanged.
 */

const FALLBACK_REASON: Record<DefenseHubState, { title: string; body: string }> = {
  ok: { title: '', body: '' },
  not_idp_league: {
    title: 'This league doesn’t roster individual defensive players',
    body:
      'Its scoring settings don’t start LB, DL or DB slots, so a Defense Hub has nothing to ' +
      'show here. This isn’t a sync problem.',
  },
  no_scoring_settings: {
    title: 'We don’t hold this league’s scoring settings',
    body:
      'Every projection on this page is scored under the league’s own rules, so without them ' +
      'there is nothing we can honestly compute. Re-syncing the league usually fixes it.',
  },
  no_team_claimed: {
    title: 'We can’t tell which team in this league is yours',
    body: 'Claim your team and your defenders appear here.',
  },
  no_roster: {
    title: 'No roster rows imported for your team',
    body:
      'Your team is claimed, but its roster has never been imported, so there are no players ' +
      'to read. This one needs a sync, not a setting.',
  },
  no_defenders: {
    title: 'You don’t roster any defensive players yet',
    body: 'This league starts defensive slots — once you hold a defender, he shows up here.',
  },
  ids_unreadable: {
    title: FOREIGN_IDS_UNREADABLE,
    body:
      'Your roster is imported, but until its players can be matched there is no defender here ' +
      'we could name or price — so none is shown, rather than the wrong one.',
  },
  no_projection_history: {
    title: 'No scored games on file yet',
    body:
      'Projections are built from played games. Before the season has any, there is nothing ' +
      'to project from — and a number here would be invented rather than early.',
  },
  valuation_refused: {
    title: 'We couldn’t establish replacement level for this league',
    body:
      'Value over replacement needs enough rostered defenders to say what a freely available ' +
      'one is worth. Ranking them without it would price a data gap.',
  },
}

function Blocked({ state, leagueId }: { state: DefenseHubState; leagueId: string }) {
  const copy = FALLBACK_REASON[state]
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[var(--surface)] px-8 py-14 text-center">
      <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--chip)] text-lg text-[var(--faint)]">
        —
      </div>
      <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-[var(--text)]">{copy.title}</h2>
      <p className="mx-auto mt-3 max-w-[440px] text-[13px] leading-relaxed text-[var(--muted)]">
        {copy.body}
      </p>
      <Link
        href={`/league/${leagueId}`}
        className="mt-6 inline-block rounded-lg bg-[var(--accent)] px-4 py-2.5 text-[13px] font-bold text-[var(--accent-ink)] transition hover:brightness-110"
      >
        Back to league
      </Link>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <h2 className="af-dh-label af-dfh-label mb-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--faint)]">
    {children}
  </h2>
)

const Dash = () => <span className="text-[var(--faint)]">—</span>

const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * The headline: who leads your defense this week (2026-11-14). It used to read "Defense Hub" over a
 * sentence about the page's honesty rule, three counts, and a banner repeating the counts.
 * The defenders arrive sorted by projection, so the first one with a projection leads.
 */
export function defenseHeadline(data: DefenseHubPayload, m: (typeof defenseHubMessages)['en']): string {
  const top = data.defenders.find((d) => !d.reason && d.projection != null)
  if (!top || top.projection == null) return m.title
  return m.headLeader(top.name, top.projection.toFixed(1), data.defenders.length, data.projectedFor?.week ?? null)
}

export function DefenseHubClient({
  leagueId,
  embedded = false,
}: {
  leagueId: string
  /*
   * Rendered inside a league tab rather than as its own page. The standalone page owns the
   * viewport — full-height background and page padding — which inside a tab produces a second
   * scroll container and a band of dead space above the content.
   */
  embedded?: boolean
}) {
  const m = useMessages(defenseHubMessages)
  const [data, setData] = useState<DefenseHubPayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    fetch(`/api/idp/players?leagueId=${encodeURIComponent(leagueId)}&view=defense-hub`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'not-a-member' : 'request-failed')
        return (await r.json()) as DefenseHubPayload
      })
      .then((p) => live && setData(p))
      .catch((e: Error) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [leagueId])

  const ok = data && data.state === 'ok' ? data : null
  /*
   * Stated as the evidence, not as a target week. The projector resolves its week from the newest
   * game on file rather than from a clock, so the target is one PAST the last real week; what the
   * reader needs is which games the number was built from.
   */
  const basis = ok?.projectedFor ? m.basisLine(ok.projectedFor.season, ok.projectedFor.week - 1) : null

  return (
    /*
     * ⚠ `af-core` IS ON THE ROOT AND IT IS LOAD BEARING, IN THE STANDALONE CASE
     * ESPECIALLY. Every colour in this screen is now a token, and af-core.css
     * declares those tokens scoped to `.af-core` — never at `:root`, on purpose,
     * because app/globals.css defines the same NAMES with different VALUES and
     * hoisting them would repaint the whole product.
     *
     * This component renders in TWO places: embedded in the core shell (which
     * already provides the scope) and standalone at /idp/defense-hub/[leagueId]
     * (which does NOT — its page.tsx is a bare Suspense wrapper). Without the
     * class here the standalone route would resolve every var() to nothing:
     * no throw, no 404, just transparent surfaces and unstyled text. That is
     * the exact failure af-import.css's header documents, and the reason it is
     * spelled out again rather than left to the reader.
     *
     * Nesting `.af-core` inside the shell's own `.af-core` is a no-op — the
     * inner scope re-declares identical values for the active theme.
     */
    <div
      className={
        embedded
          ? 'af-core af-dh px-4 pb-10 pt-4 text-[var(--text)] md:px-6'
          : 'af-core af-dh min-h-screen bg-[var(--bg)] px-5 pb-24 pt-10 text-[var(--text)] md:px-10'
      }
    >
      <div className="mx-auto max-w-[1200px]">
        <header className="af-dfh-head mb-6">
          <div className="af-dfh-head-text">
            {!embedded ? (
              <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--faint)]">
                <Link href={`/league/${leagueId}`} className="hover:text-[var(--accent)]">
                  {m.backToLeague}
                </Link>
              </div>
            ) : null}
            <p className="af-dfh-eyebrow">{ok ? m.title : m.eyebrow}</p>
            <h1 className="af-dh-title af-dfh-title mt-2 text-[24px] font-black tracking-[-0.03em]" data-testid="defense-hub-headline">
              {ok ? defenseHeadline(ok, m) : m.title}
            </h1>
            {basis ? (
              <p className="af-dfh-lede mt-1.5 max-w-[620px] text-[13px] leading-relaxed text-[var(--muted)]" data-testid="defense-hub-basis">
                {basis}
              </p>
            ) : null}
          </div>
        </header>

        {error && (
          <div className="rounded-[13px] border border-[color-mix(in_srgb,var(--bad)_30%,transparent)] bg-[var(--bad-soft)] px-4 py-3.5 text-[13px] text-[var(--text)]">
            {error === 'not-a-member' ? m.notMember : m.loadFailed}
          </div>
        )}

        {!data && !error && (
          <div className="rounded-[13px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3.5 font-mono text-[11px] text-[var(--faint)]">
            {m.loading}
          </div>
        )}

        {data && data.state !== 'ok' && <Blocked state={data.state} leagueId={leagueId} />}

        {ok && (
          <div className="flex flex-col gap-[22px]">
            <DefenderTable data={ok} />
            {/*
              The league-wide board. Rendered directly under "your defenders" because it answers
              the question that one raises: you can now see what yours are worth, so what is HIS
              worth? It fetches separately — the board queries every roster in the league rather
              than one, and pairing the two would make the fast half of this page wait for the slow half.
            */}
            <TradeBoardSection leagueId={leagueId} />
            <Kickers data={ok} />
            <PlayTable data={ok} />
            <Tendencies data={ok} />
            <HowItWorks data={ok} leagueId={leagueId} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Kickers, priced as a position.
 *
 * 🛑 ONE VALUE, SHOWN ONCE, ABOVE THE LIST — NOT A COLUMN REPEATED DOWN IT. A per-row value
 * column would be identical in every row, and a reader scanning a table of identical numbers
 * concludes the page is broken rather than that the position is flat. Stating it once, with
 * the reason attached, is the difference between a finding and a rendering bug.
 *
 * ⚠ AND NO PROJ / VORP / RANK COLUMNS HERE, DELIBERATELY. Those exist for defenders because
 * value over replacement genuinely orders them. The same columns beside kickers would invite
 * a comparison the data cannot support — see lib/kicker-values/leagueKickerValue.ts.
 */
function Kickers({ data }: { data: DefenseHubPayload }) {
  const m = useMessages(defenseHubMessages)
  if (!data.kickerValue || data.kickers.length === 0) return null

  return (
    <section>
      <Label>{m.yourKickers}</Label>
      <div className="af-dh-card rounded-[13px] border border-[var(--line)] bg-[var(--surface)] p-[13px]">
        <div className="flex items-baseline gap-2.5">
          <div className="font-mono text-[17px] font-black text-[var(--text)]">
            {data.kickerValue.value?.toLocaleString()}
          </div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--faint)]">
            each · replacement about K{data.kickerValue.replacementRank}
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-[1.5] text-[var(--muted)]">{data.kickerValue.basis}</p>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--line)] pt-3">
          {data.kickers.map((k) => (
            <div key={k.sleeperId} className="flex items-center gap-2">
              <div className="text-[12px] font-bold text-[var(--text)]">{k.name}</div>
              <div className="text-[11px] font-medium text-[var(--faint)]">{k.team ?? <Dash />}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function DefenderTable({ data }: { data: DefenseHubPayload }) {
  const m = useMessages(defenseHubMessages)
  return (
    <section className="af-dfh-section" data-section="defenders">
      <div className="af-dfh-section-head">
        <Label>{m.yourDefenders}</Label>
      </div>
      <div className="af-dh-card af-dh-table af-dfh-table overflow-x-auto rounded-[13px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full min-w-[680px] text-left">
          <thead>
            <tr className="border-b border-[var(--line)] font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--faint)]">
              <th className="px-4 py-3">{m.colPlayer}</th>
              <th className="px-2 py-3">{m.colPos}</th>
              <th className="af-dh-proj-head px-2 py-3 text-right text-[var(--accent)]">{m.colProj}</th>
              <th className="px-2 py-3 text-right">{m.colLastWeek}</th>
              <th className="px-2 py-3 text-right">
                <abbr title={m.vorpTip} className="no-underline">
                  {m.colVorp}
                </abbr>
              </th>
              <th className="px-2 py-3 text-right">{m.colPosRank}</th>
              <th className="px-4 py-3 text-right">{m.colValue}</th>
            </tr>
          </thead>
          <tbody>
            {data.defenders.map((d) => (
              <tr key={d.sleeperId} className="border-b border-[var(--line)] last:border-0">
                <td className="px-4 py-3" colSpan={d.reason ? 7 : 1}>
                  <div className="text-[13px] font-extrabold">{d.name}</div>
                  <div className="font-mono text-[11px] text-[var(--faint)]">{d.team ?? '—'}</div>
                  {d.reason && (
                    <div className="mt-1.5 text-[11px] font-semibold text-[var(--warn)]">{d.reason}</div>
                  )}
                </td>
                {!d.reason && (
                  <>
                    <td className="px-2 py-3 font-mono text-[11px] text-[var(--text2)]">
                      {d.position ? (
                        /* A hook for the redraft chip; the IDP group (DL/LB/DB) is the job, whatever the spelling. */
                        <span className="af-dh-pos" data-dh-group={(d.positionGroup ?? d.position).toUpperCase()}>
                          {d.position}
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="af-dh-proj px-2 py-3 text-right font-mono text-[14px] font-extrabold text-[var(--good)]">
                      {d.projection != null ? d.projection.toFixed(1) : <Dash />}
                    </td>
                    {/*
                      A dash with a tooltip, never 0.0. `no_game` is a bye or an un-ingested
                      week; `unscored` means this league prices none of what he did. Rendering
                      either as zero tells a manager his starter blanked.
                    */}
                    <td
                      className="px-2 py-3 text-right font-mono text-[12px] text-[var(--text2)]"
                      title={
                        d.lastWeek && !d.lastWeek.scored
                          ? d.lastWeek.reason === 'no_game'
                            ? m.lastWeekNoGame
                            : (d.lastWeek.lineKeys ?? 0) <= 4
                              ? m.lastWeekUnscored
                              : m.lastWeekPricedNothing
                          : undefined
                      }
                    >
                      {d.lastWeek?.scored ? d.lastWeek.points.toFixed(1) : <Dash />}
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-[12px]">
                      {d.vorp != null ? (
                        `${d.vorp > 0 ? '+' : ''}${d.vorp.toFixed(1)}`
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-[12px] text-[var(--text2)]">
                      {/*
                        Against the GROUP, never `d.position` — the rank is computed per
                        DL/LB/DB, and pairing it with a raw spelling printed `Cornerback80`
                        beside `CB78` and `DB81` for one ranking. See idpPositionGroup.
                      */}
                      {d.positionRank != null && (d.positionGroup ?? d.position) ? (
                        `${d.positionGroup ?? d.position}${d.positionRank}`
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px]">
                      {d.value == null ? (
                        <Dash />
                      ) : d.valueIsFloor ? (
                        /*
                         * A floor price is not a measured value — roughly half this board sits
                         * on it. Rendered as a plain number it reads as a real price, so two
                         * floor-priced defenders look like equivalent trade assets. Muted and
                         * marked instead, with the explanation on hover.
                         */
                        <span className="text-[var(--muted)]" title={m.floorTip}>
                          {d.value.toLocaleString()}
                          <span className="ml-1 text-[11px]"> {m.floor}</span>
                        </span>
                      ) : (
                        d.value.toLocaleString()
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * "2,236" for a big rate, "11.7" for a small one. The decimal is written as a point in every language,
 * like the projections in the table above it — one page should not mix "13.8" and "8,4".
 */
function rate(n: number): string {
  return n >= 100 ? Math.round(n).toLocaleString(getAppIntlLocale()) : n.toFixed(1)
}

/**
 * How much they play (2026-11-14): one row per defender, where there used to be a snap-share card
 * AND a "what they actually do" card for each — 44 cards, each signing off with "— first week" or
 * "Coverage — no targets-allowed column is ingested by any provider we read". The rates are the
 * same counts (deriveDefenderRole), worded here so Spanish reads Spanish.
 */
function PlayTable({ data }: { data: DefenseHubPayload }) {
  const m = useMessages(defenseHubMessages)
  if (data.snaps.length === 0) return null
  const roleOf = new Map(data.roles.map((r) => [r.sleeperId, r]))
  return (
    <section className="af-dfh-section" data-section="play">
      <Label>{m.playTitle}</Label>
      <div className="af-dh-card af-dfh-table overflow-x-auto rounded-[13px] border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full min-w-[560px] text-left" data-testid="defense-hub-play">
          <thead>
            <tr className="border-b border-[var(--line)] font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--faint)]">
              <th className="px-4 py-3">{m.colPlayer}</th>
              <th className="px-2 py-3 text-right">{m.colSnaps}</th>
              <th className="px-2 py-3 text-right">{m.colGames}</th>
              <th className="px-2 py-3 text-right">{m.colSackEvery}</th>
              <th className="px-4 py-3 text-right">{m.colTackleEvery}</th>
            </tr>
          </thead>
          <tbody>
            {data.snaps.map((s) => {
              const r = roleOf.get(s.sleeperId)
              /* Optional on the wire: a server older than 2026-11-14 sends only the worded lines. */
              const counted = r && typeof r.snaps === 'number' && r.games > 0 && r.snaps > 0
              const games = s.share != null ? s.games : counted ? r!.games : null
              if (s.share == null && !counted) {
                return (
                  <tr key={s.sleeperId} className="border-b border-[var(--line)] last:border-0" data-testid="defense-hub-play-row">
                    <td className="px-4 py-3 text-[13px] font-extrabold">{s.name}</td>
                    {/* Left-aligned so a phone shows it beside the name, not off the table's right edge. */}
                    <td colSpan={4} className="px-2 py-3 text-left text-[12px] text-[var(--muted)]">
                      {m.noSnaps}
                    </td>
                  </tr>
                )
              }
              return (
                <tr key={s.sleeperId} className="border-b border-[var(--line)] last:border-0" data-testid="defense-hub-play-row">
                  <td className="px-4 py-3 text-[13px] font-extrabold">{s.name}</td>
                  <td className="px-2 py-3 text-right font-mono text-[13px] font-bold">
                    {s.share != null ? (
                      <>
                        {pct(s.share)}
                        {s.basis === 'offense' ? <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">{m.offenseSnaps}</span> : null}
                      </>
                    ) : (
                      <Dash />
                    )}
                  </td>
                  <td className="px-2 py-3 text-right font-mono text-[12px] text-[var(--text2)]">{games ?? <Dash />}</td>
                  <td className="px-2 py-3 text-right font-mono text-[12px] text-[var(--text2)]">
                    {counted ? (r!.sacks > 0 ? m.everySnaps(rate(r!.snaps / r!.sacks)) : m.noSackYet) : <Dash />}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-[var(--text2)]">
                    {counted && r!.tackles != null && r!.tackles > 0 ? m.everySnaps(rate(r!.snaps / r!.tackles)) : <Dash />}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Tendencies({ data }: { data: DefenseHubPayload }) {
  const m = useMessages(defenseHubMessages)
  if (data.tendencies.length === 0) return null

  return (
    <section className="af-dfh-section" data-section="tendencies">
      <Label>{m.tendencies}</Label>
      <div className="flex flex-col gap-3">
        {data.tendencies.map(({ team, tendency: t }) => (
          <div key={team} className="af-dh-card rounded-[13px] border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-[13px] font-extrabold">{m.tendencyTeam(team)}</span>
              {/* The season is not decoration — coordinators change between years. */}
              <span className="font-mono text-[11px] text-[var(--faint)]">{m.tendencySeason(t.season)}</span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label={m.passRateFaced} value={t.passRateFaced != null ? pct(t.passRateFaced) : null} />
              {/*
                NOT "faced". `blitzRate` has no `Faced` suffix in the source because it describes
                what THIS defence does — which is the half a defender's own sack chances rest on.
              */}
              <Stat label={m.blitzRate} value={t.blitzRate != null ? pct(t.blitzRate) : null} />
              <Stat label={m.playsFaced} value={t.playsFacedSeason != null ? t.playsFacedSeason.toLocaleString() : null} />
              <Stat label={m.thirdDownFaced} value={t.thirdDownRateFaced != null ? pct(t.thirdDownRateFaced) : null} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * Every method note, once, folded (2026-11-14). They used to sit under the tables they qualify — and
 * the coverage one was printed under every defender — so the page read as an explanation of itself.
 */
function HowItWorks({ data, leagueId }: { data: DefenseHubPayload; leagueId: string }) {
  const m = useMessages(defenseHubMessages)
  const unresolved = data.unresolvedIds ?? 0
  return (
    <details className="af-dfh-how rounded-[13px] border border-[var(--line)] bg-[var(--surface)] px-4 py-3" data-testid="defense-hub-how">
      <summary className="cursor-pointer text-[13px] font-bold text-[var(--text)]">{m.howTitle}</summary>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[12px] leading-relaxed text-[var(--muted)]">
        {unresolved > 0 ? <li>{m.noteUnresolved(unresolved)}</li> : null}
        <li>{m.noteSnapLag}</li>
        <li>{m.noteCoverage}</li>
        {data.tendencies.length > 0 ? <li>{m.noteTendency}</li> : null}
      </ul>
      {/* Only renders when this league starts defenders or kickers. */}
      <div className="mt-3">
        <ValuesPageLink leagueId={leagueId} />
      </div>
    </details>
  )
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="font-mono text-[16px] font-extrabold leading-none">
        {value ?? <Dash />}
      </div>
      <div className="mt-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--faint)]">
        {label}
      </div>
    </div>
  )
}

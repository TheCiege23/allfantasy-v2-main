'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import type { DefenseHubPayload, DefenseHubState } from '@/lib/idp-projections/defenseHub'

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
    <div className="rounded-[18px] border border-white/[0.07] bg-[#0d1020] px-8 py-14 text-center">
      <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-white/[0.05] text-lg text-[#5d648a]">
        —
      </div>
      <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-[#eef0fa]">{copy.title}</h2>
      <p className="mx-auto mt-3 max-w-[440px] text-[13px] leading-relaxed text-[#8f97bd]">
        {copy.body}
      </p>
      <Link
        href={`/league/${leagueId}`}
        className="mt-6 inline-block rounded-lg bg-[#22d3ee] px-4 py-2.5 text-[13px] font-bold text-[#04050c] transition hover:brightness-110"
      >
        Back to league
      </Link>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="mb-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#5d648a]">
    {children}
  </div>
)

const Dash = () => <span className="text-[#5d648a]">—</span>

const pct = (n: number) => `${Math.round(n * 100)}%`

export function DefenseHubClient({ leagueId }: { leagueId: string }) {
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

  return (
    <div className="min-h-screen bg-[#06070f] px-5 pb-24 pt-10 text-[#eef0fa] md:px-10">
      <div className="mx-auto max-w-[1200px]">
        <header className="mb-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#5d648a]">
            <Link href={`/league/${leagueId}`} className="hover:text-[#22d3ee]">
              ← League
            </Link>
          </div>
          <h1 className="mt-2 text-[24px] font-black tracking-[-0.03em]">Defense Hub</h1>
          <p className="mt-1.5 max-w-[520px] text-[13px] leading-relaxed text-[#8f97bd]">
            If a number can’t be traced to a real stat line, it doesn’t render — this page shows
            an absence, never a guess.
          </p>
        </header>

        {error && (
          <div className="rounded-[13px] border border-[#fb5b78]/30 bg-[#fb5b78]/[0.09] px-4 py-3.5 text-[13px] text-[#eef0fa]">
            {error === 'not-a-member'
              ? 'You don’t have access to this league.'
              : 'We couldn’t load this page. Nothing is shown rather than something wrong.'}
          </div>
        )}

        {!data && !error && (
          <div className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] px-4 py-3.5 font-mono text-[11px] text-[#5d648a]">
            Loading…
          </div>
        )}

        {data && data.state !== 'ok' && <Blocked state={data.state} leagueId={leagueId} />}

        {data && data.state === 'ok' && (
          <div className="flex flex-col gap-[22px]">
            <CoverageBanner data={data} />
            <DefenderTable data={data} />
            <SnapShare data={data} />
            <RoleCards data={data} />
            <Tendencies data={data} />
          </div>
        )}
      </div>
    </div>
  )
}

function CoverageBanner({ data }: { data: DefenseHubPayload }) {
  const { defenders, projected } = data.coverage
  // Amber the moment anything is missing: a green banner over a partial board is the lie.
  const full = projected >= data.defenders.length && data.defenders.every((d) => !d.reason)
  const week = data.projectedFor

  return (
    <div
      className={`rounded-[13px] border px-4 py-3.5 text-[13px] ${
        full
          ? 'border-[#34d399]/30 bg-[#34d399]/[0.09]'
          : 'border-[#fbbf24]/30 bg-[#fbbf24]/[0.09]'
      }`}
    >
      <span
        className={`mr-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] ${
          full ? 'text-[#34d399]' : 'text-[#fbbf24]'
        }`}
      >
        Coverage
      </span>
      {data.defenders.filter((d) => !d.reason).length} of {data.defenders.length} rostered
      defenders projected
      {/*
        Stated as the evidence, not as a target week. The projector resolves its week from the
        newest game on file rather than from a clock — correct, because the ingest stalls over
        the offseason — but that makes the target one PAST the last real week, so naming it
        renders a week that does not exist ("2025 week 19"). What the reader needs is which
        games the number was built from.
      */}
      {week ? ` from games through ${week.season} week ${week.week - 1}` : ''} · {projected} of{' '}
      {defenders} defenders priced league-wide.
    </div>
  )
}

function DefenderTable({ data }: { data: DefenseHubPayload }) {
  return (
    <section>
      <Label>Your rostered defenders</Label>
      <div className="overflow-x-auto rounded-[13px] border border-white/[0.07] bg-[#0d1020]">
        <table className="w-full min-w-[680px] text-left">
          <thead>
            <tr className="border-b border-white/[0.07] font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
              <th className="px-4 py-3">Player</th>
              <th className="px-2 py-3">Pos</th>
              <th className="px-2 py-3 text-right text-[#22d3ee]">Proj ↓</th>
              <th className="px-2 py-3 text-right">Last wk</th>
              <th className="px-2 py-3 text-right">VORP</th>
              <th className="px-2 py-3 text-right">Pos rank</th>
              <th className="px-4 py-3 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {data.defenders.map((d) => (
              <tr key={d.sleeperId} className="border-b border-white/[0.04] last:border-0">
                <td className="px-4 py-3" colSpan={d.reason ? 7 : 1}>
                  <div className="text-[13px] font-extrabold">{d.name}</div>
                  <div className="font-mono text-[10px] text-[#5d648a]">{d.team ?? '—'}</div>
                  {d.reason && (
                    <div className="mt-1.5 text-[11px] font-semibold text-[#fbbf24]">{d.reason}</div>
                  )}
                </td>
                {!d.reason && (
                  <>
                    <td className="px-2 py-3 font-mono text-[11px] text-[#c3c9e6]">
                      {d.position ?? <Dash />}
                    </td>
                    <td className="px-2 py-3 text-right font-mono text-[14px] font-extrabold text-[#34d399]">
                      {d.projection != null ? d.projection.toFixed(1) : <Dash />}
                    </td>
                    {/*
                      A dash with a tooltip, never 0.0. `no_game` is a bye or an un-ingested
                      week; `unscored` means this league prices none of what he did. Rendering
                      either as zero tells a manager his starter blanked.
                    */}
                    <td
                      className="px-2 py-3 text-right font-mono text-[12px] text-[#c3c9e6]"
                      title={
                        d.lastWeek && !d.lastWeek.scored
                          ? d.lastWeek.reason === 'no_game'
                            ? 'no game on file for him that week'
                            : (d.lastWeek.lineKeys ?? 0) <= 4
                              ? 'we hold a line for him but none of the stats this league scores'
                              : 'this league’s scoring prices none of what he did'
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
                    <td className="px-2 py-3 text-right font-mono text-[12px] text-[#c3c9e6]">
                      {d.positionRank != null && d.position ? (
                        `${d.position}${d.positionRank}`
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px]">
                      {d.value != null ? d.value.toLocaleString() : <Dash />}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.notes.map((n) => (
        <p key={n} className="mt-2 text-[11px] leading-relaxed text-[#5d648a]">
          {n}
        </p>
      ))}
    </section>
  )
}

function SnapShare({ data }: { data: DefenseHubPayload }) {
  return (
    <section>
      <Label>Snap share</Label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.snaps.map((s) => (
          <div
            key={s.sleeperId}
            className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] p-4"
          >
            <div className="text-[13px] font-extrabold">{s.name}</div>
            <div className="mt-1.5 font-mono text-[26px] font-extrabold leading-none">
              {s.share != null ? pct(s.share) : <Dash />}
            </div>
            <div className="mt-2 text-[11px] text-[#8f97bd]">
              {s.share != null ? (
                <>
                  {s.basis === 'defense' ? 'Defensive' : 'Offensive'} snaps · {s.games} game
                  {s.games === 1 ? '' : 's'}
                </>
              ) : (
                s.reason
              )}
            </div>
            {/*
              The trend is null until a second week of the CURRENT season exists. Comparing the
              opener against last year's finale would report an offseason of roster and scheme
              change as though it were form.
            */}
            {s.share != null && (
              <div className="mt-1 font-mono text-[10px] text-[#5d648a]">— first week</div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-[#5d648a]">
        Snap data can lag a game by 24–48 hours.
      </p>
    </section>
  )
}

function RoleCards({ data }: { data: DefenseHubPayload }) {
  return (
    <section>
      <Label>What they actually do</Label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.roles.map((r) => (
          <div
            key={r.sleeperId}
            className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] p-4"
          >
            <div className="mb-2.5 text-[13px] font-extrabold">{r.name}</div>
            <div className="flex flex-col gap-2">
              {r.lines.map((l) => (
                <div key={l.label}>
                  <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
                    {l.label}
                  </div>
                  <div
                    className={`text-[12px] font-semibold ${
                      l.value ? 'text-[#eef0fa]' : 'text-[#fbbf24]'
                    }`}
                  >
                    {l.value ?? '—'}
                  </div>
                  <div className="text-[10px] leading-snug text-[#5d648a]">{l.basis}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/*
        No archetype label. "Run Stopper" / "Coverage" needs snap SPLITS, which no provider we
        ingest carries — the version this replaces derived them from the character codes of the
        player id.
      */}
      <p className="mt-2 text-[11px] leading-relaxed text-[#5d648a]">
        No run-stopper / coverage / edge archetypes: those need per-snap role splits, and no
        provider we read carries them.
      </p>
    </section>
  )
}

function Tendencies({ data }: { data: DefenseHubPayload }) {
  if (data.tendencies.length === 0) return null

  return (
    <section>
      <Label>How their defence has been played</Label>
      <div className="flex flex-col gap-3">
        {data.tendencies.map(({ team, tendency: t }) => (
          <div key={team} className="rounded-[13px] border border-white/[0.07] bg-[#0d1020] p-4">
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-[13px] font-extrabold">{team} defence</span>
              {/* The season is not decoration — coordinators change between years. */}
              <span className="font-mono text-[10px] text-[#5d648a]">{t.season} season</span>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Pass rate faced" value={t.passRateFaced != null ? pct(t.passRateFaced) : null} />
              {/*
                NOT "faced". `blitzRate` has no `Faced` suffix in the source because it describes
                what THIS defence does — which is the half a defender's own sack chances rest on.
              */}
              <Stat label="Blitz rate (own)" value={t.blitzRate != null ? pct(t.blitzRate) : null} />
              <Stat
                label="Plays faced (season)"
                value={t.playsFacedSeason != null ? t.playsFacedSeason.toLocaleString() : null}
              />
              <Stat
                label="3rd-down rate faced"
                value={t.thirdDownRateFaced != null ? pct(t.thirdDownRateFaced) : null}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 max-w-[640px] text-[11px] leading-relaxed text-[#5d648a]">
        These are facts about how the defence has been played, not a matchup grade. Grading them
        measured worse than leaving them out, over 5,291 out-of-sample player-weeks.
      </p>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="font-mono text-[16px] font-extrabold leading-none">
        {value ?? <Dash />}
      </div>
      <div className="mt-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[#5d648a]">
        {label}
      </div>
    </div>
  )
}

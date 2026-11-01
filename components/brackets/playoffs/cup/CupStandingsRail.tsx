"use client"

import { useEffect, useMemo, useState } from "react"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { TeamLogo } from "@/app/components/TeamLogo"
import { pointsForSeries } from "@/lib/playoffs/playoffScoring"
import { cupGameState, projectedQuarterfinalSeeds, wildCardRace, type CupGroup, type CupTeamRow } from "@/lib/playoffs/nbaCupBoard"
import { tipoffLabel } from "./cupFormat"
import "./af-nba-cup.css"

export type CupStandingsRailProps = {
  groups: CupGroup[]
  series: PlayoffSeriesView[]
  sport: string
  teamLogos: Record<string, string>
}

function diff(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0"
}

/**
 * Group standings, the selected team's road to the knockout bracket, the
 * wild-card race and the quarterfinal field as it stands tonight.
 *
 * ⚠ STATUSES ARE ARITHMETIC ON STORED RESULTS. "Clinched" and "Eliminated" are
 * only claimed when no remaining result could change them; everything in
 * between says what the team needs, not what we think will happen.
 */
export default function CupStandingsRail({ groups, series, sport, teamLogos }: CupStandingsRailProps) {
  const defaultGroup = useMemo(() => {
    const withLive = groups.find((g) => g.teams.some((t) => t.live))
    return (withLive ?? groups[0])?.id ?? null
  }, [groups])
  const [groupId, setGroupId] = useState<string | null>(defaultGroup)
  const [team, setTeam] = useState<string | null>(null)
  useEffect(() => { if (!groups.some((g) => g.id === groupId)) setGroupId(defaultGroup) }, [groups, groupId, defaultGroup])

  const group = groups.find((g) => g.id === groupId) ?? groups[0] ?? null
  const selected: CupTeamRow | null = group?.teams.find((t) => t.team === team) ?? group?.teams[0] ?? null
  const conference = group?.conference ?? "east"
  const wild = useMemo(() => wildCardRace(groups, conference).slice(0, 3), [groups, conference])
  const seeds = useMemo(() => projectedQuarterfinalSeeds(groups, conference), [groups, conference])

  const knockout = (round: string) => series.filter((s) => s.round === round)
  const roundDate = (round: string, teamName?: string) => {
    const rows = knockout(round)
    const own = teamName ? rows.find((s) => s.homeTeamName === teamName || s.awayTeamName === teamName) : null
    const any = own ?? rows.filter((s) => s.startsAt).sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0]
    return any?.startsAt ? tipoffLabel(any.startsAt) : "Date TBA"
  }
  const pts = (round: string) => pointsForSeries({ round } as PlayoffSeriesView, sport)

  if (!groups.length) {
    return (
      <section className="af-pb-card af-cup af-cup-rail-card" data-testid="cup-standings">
        <div className="af-pb-rail-head">Group standings</div>
        <p className="af-cup-note">Groups appear as the Group Play schedule syncs. Each group is recovered from who plays whom.</p>
      </section>
    )
  }

  const road = selected ? (() => {
    const s = selected.status
    const through = ["won_group", "clinched_group", "wild_card"].includes(s)
    const out = s === "eliminated"
    const seed = seeds.find((slot) => slot.team === selected.team)
    const qfRow = knockout("cup_quarterfinals").find((r) => r.homeTeamName === selected.team || r.awayTeamName === selected.team)
    const qfDone = qfRow ? cupGameState(qfRow) === "final" : false
    const qfWon = qfDone && qfRow?.winnerTeamName === selected.team
    return [
      {
        state: selected.remaining === 0 ? "done" : "now",
        title: `Group Play · ${selected.wins}-${selected.losses}`,
        detail: selected.live
          ? `Live now: ${selected.live.teamScore ?? 0}–${selected.live.opponentScore ?? 0} vs ${selected.live.opponent} (${selected.live.clock})`
          : selected.remaining ? `${selected.remaining} group game${selected.remaining === 1 ? "" : "s"} left` : "Group play finished",
      },
      {
        state: through ? "done" : out ? "out" : selected.remaining === 0 ? "now" : "next",
        title: through ? selected.statusLabel : "Win the group or take the wild card",
        detail: selected.path,
      },
      {
        state: out ? "out" : qfDone ? (qfWon ? "done" : "out") : through ? "now" : "next",
        title: `Quarterfinal · ${pts("cup_quarterfinals")} pt${pts("cup_quarterfinals") === 1 ? "" : "s"}`,
        detail: `${seed ? `${seed.confirmed ? "" : "On course for "}#${seed.seed} seed · ` : ""}higher seed hosts · ${roundDate("cup_quarterfinals", selected.team)}`,
      },
      { state: out ? "out" : "next", title: `Semifinal · ${pts("cup_semifinals")} pts`, detail: roundDate("cup_semifinals", selected.team) },
      { state: out ? "out" : "title", title: `Championship · ${pts("cup_championship")} pts`, detail: roundDate("cup_championship", selected.team) },
    ]
  })() : []

  return (
    <>
      <section className="af-pb-card af-cup af-cup-rail-card" data-testid="cup-standings">
        <div className="af-pb-rail-head">Group standings</div>
        <div className="af-cup-tabs" role="tablist" aria-label="Groups">
          {groups.map((g) => (
            <button key={g.id} type="button" role="tab" className="af-cup-tab" aria-selected={g.id === group?.id} onClick={() => { setGroupId(g.id); setTeam(null) }}>
              {g.label.replace(" Group ", " ")}
            </button>
          ))}
        </div>
        <div className="af-cup-standing-top af-cup-standing-head" aria-hidden="true">
          <span>#</span><span>Team</span><span className="af-cup-num">W-L</span><span className="af-cup-num">PD</span>
        </div>
        {group?.teams.map((row, index) => (
          <button
            type="button"
            key={row.team}
            className="af-cup-standing"
            aria-pressed={row.team === selected?.team}
            onClick={() => setTeam(row.team)}
            aria-label={`${row.team}, ${row.wins}-${row.losses}, ${row.statusLabel}. Show road to the bracket.`}
          >
            <span className="af-cup-standing-top">
              <span className="af-cup-seed">{index + 1}</span>
              <span className="af-cup-standing-team">
                <TeamLogo teamAbbr={row.team} sport="NBA_CUP" logoUrl={teamLogos[row.team] ?? null} size={22} />
                <span>{row.team}</span>
              </span>
              <span className="af-cup-num"><strong>{row.wins}-{row.losses}</strong></span>
              <span className="af-cup-num">{diff(row.pointDiff)}</span>
            </span>
            <span className="af-cup-status-row">
              <span className="af-cup-status" data-status={row.status}>{row.statusLabel}</span>
            </span>
            {row.live ? <span className="af-cup-livenote">Live: {row.live.teamScore ?? 0}–{row.live.opponentScore ?? 0} vs {row.live.opponent} · {row.live.clock}</span> : null}
            <span className="af-cup-path">{row.path}</span>
            <span className="af-cup-dots" aria-hidden="true">
              {row.results.map((r, i) => <span key={i} data-r={r} />)}
            </span>
          </button>
        ))}
        <div className="af-cup-legend" aria-hidden="true">
          <span><i style={{ background: "var(--pb-good)" }} />Win</span>
          <span><i style={{ background: "var(--pb-bad)" }} />Loss</span>
          <span><i style={{ background: "#ff5a5f", opacity: 0.6 }} />Live</span>
          <span><i style={{ background: "var(--pb-line2)" }} />To play</span>
          <span>Tiebreaks: record, head-to-head, point differential, points scored.</span>
        </div>
      </section>

      {selected ? (
        <section className="af-pb-card af-cup af-cup-rail-card" data-testid="cup-road">
          <div className="af-pb-rail-head">Road to the bracket · {selected.team}</div>
          <ol className="af-cup-road">
            {road.map((step, i) => (
              <li key={i} data-state={step.state}>
                <span className="af-cup-road-mark" aria-hidden="true"><b>{i + 1}</b><i /></span>
                <span className="af-cup-road-body"><strong>{step.title}</strong><span>{step.detail}</span></span>
              </li>
            ))}
          </ol>
          <p className="af-cup-note">Tap any team in the standings to see its road.</p>
        </section>
      ) : null}

      <section className="af-pb-card af-cup af-cup-rail-card" data-testid="cup-wild-card">
        <div className="af-pb-rail-head">{conference === "east" ? "East" : "West"} wild-card race</div>
        <p className="af-cup-note">The best second-place team across the conference&apos;s three groups takes the 4 seed.</p>
        {wild.length ? wild.map((row, i) => (
          <div className="af-cup-mini" key={row.team}>
            <span className="af-cup-seed">{i + 1}</span>
            <TeamLogo teamAbbr={row.team} sport="NBA_CUP" logoUrl={teamLogos[row.team] ?? null} size={24} />
            <span className="af-cup-mini-name"><strong>{row.team}</strong><span>2nd in {groups.find((g) => g.teams.some((t) => t.team === row.team))?.label ?? "its group"}</span></span>
            <strong>{row.wins}-{row.losses}</strong>
            <span style={{ width: 34, textAlign: "right" }}>{diff(row.pointDiff)}</span>
          </div>
        )) : <p className="af-cup-note">Starts once each group has a result.</p>}
      </section>

      <section className="af-pb-card af-cup af-cup-rail-card" data-testid="cup-projected-qf">
        <div className="af-pb-rail-head">{conference === "east" ? "East" : "West"} quarterfinals {seeds.length && seeds.every((s) => s.confirmed) ? "· set" : "· as it stands"}</div>
        {seeds.length ? (
          <>
            {[[1, 4], [2, 3]].map(([a, b]) => {
              const pair = [seeds.find((s) => s.seed === a), seeds.find((s) => s.seed === b)]
              return (
                <div key={`${a}v${b}`} style={{ borderTop: "1px solid var(--pb-line)" }}>
                  {pair.map((slot, i) => slot ? (
                    <div className="af-cup-mini" key={slot.seed} style={i ? { borderTop: 0, paddingTop: 0 } : undefined}>
                      <span className="af-cup-seed">{slot.seed}</span>
                      <TeamLogo teamAbbr={slot.team} sport="NBA_CUP" logoUrl={teamLogos[slot.team] ?? null} size={24} />
                      <span className="af-cup-mini-name"><strong>{slot.team}</strong><span>{slot.how}{slot.confirmed ? "" : " · projected"}</span></span>
                    </div>
                  ) : null)}
                </div>
              )
            })}
            <p className="af-cup-note">1 v 4 and 2 v 3. The higher seed hosts. Knockout picks open when the matchups are confirmed.</p>
          </>
        ) : <p className="af-cup-note">Projections start after the first group games are final.</p>}
      </section>
    </>
  )
}

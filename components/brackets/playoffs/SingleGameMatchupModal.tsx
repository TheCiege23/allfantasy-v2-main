"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import type { BracketTeamProfile, PlayoffSeriesView } from "@/lib/playoffs/types"
import { abbreviate, roundLabel, seriesOdds } from "@/lib/playoffs/playoffBracketGraph"
import { isOfficialTeamName } from "@/lib/playoffs/playoffBracketProjection"
import { getPlayoffPickResult, pointsForSeries } from "@/lib/playoffs/playoffScoring"
import { TeamLogo } from "@/app/components/TeamLogo"
import { getTeamLogoCandidates } from "@/lib/players/teamLogos"
import { isNbaCupTeam } from "@/lib/playoffs/nbaCupTournament"
import { cupGameDetail, cupGameState, cupLiveClock, cupTeamCode, groupForTeam, type CupGroup, type CupLeader } from "@/lib/playoffs/nbaCupBoard"
import { teamColors } from "@/lib/playoffs/playoffTeamColors"
import { countdown, teamTint, tipoffLabel } from "./cup/cupFormat"
import "./af-playoff-bracket.css"
import "./cup/af-nba-cup.css"

type Props = {
  series: PlayoffSeriesView
  sport: string
  profiles: Record<string, BracketTeamProfile>
  teamLogos: Record<string, string>
  picked: string | null
  locked: boolean
  saving: boolean
  onPick: (team: string) => void
  onClose: () => void
  /** NBA Cup only: the derived groups, for records, stakes and the group table. */
  cupGroups?: CupGroup[]
  /** NBA Cup only: every Group Play game, for each team's Cup results so far. */
  cupGames?: PlayoffSeriesView[]
}

function chance(series: PlayoffSeriesView, home?: BracketTeamProfile, away?: BracketTeamProfile) {
  const seeded = seriesOdds(series)
  if (seeded.basis !== "unknown") return { home: seeded.home, away: seeded.away, basis: "Seed comparison" }
  if (home?.winPercentage != null && away?.winPercentage != null) {
    const homeChance = Math.max(20, Math.min(80, Math.round(50 + (home.winPercentage - away.winPercentage) * 0.55)))
    return { home: homeChance, away: 100 - homeChance, basis: "Season record comparison" }
  }
  return null
}

/** "Hawks", "Trail Blazers", "76ers" — the short name a headline uses. */
function nickname(name: string): string {
  if (/trail blazers$/i.test(name)) return "Trail Blazers"
  return name.split(/\s+/).pop() ?? name
}

function signed(n: number | null | undefined): string {
  if (n == null) return "—"
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0"
}

/**
 * The team mark as a large one-colour silhouette behind its panel. It is the
 * real logo, flattened by CSS (see `.af-cup-silhouette`); a logo that fails to
 * load simply disappears, because a broken-image icon behind a team name is
 * worse than no mark.
 */
function Silhouette({ team, logoUrl, logoSport }: { team: string; logoUrl: string | null; logoSport: string }) {
  const [failed, setFailed] = useState(false)
  const url = logoUrl ?? getTeamLogoCandidates(team, logoSport)[0] ?? null
  if (!url || failed) return null
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="af-cup-silhouette" src={url} alt="" aria-hidden="true" onError={() => setFailed(true)} />
}

export default function SingleGameMatchupModal({ series, sport, profiles, teamLogos, picked, locked, saving, onPick, onClose, cupGroups, cupGames }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    document.addEventListener("keydown", keydown)
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown) }
  }, [onClose])

  const cup = sport === "nba_cup"
  const logoSport = sport === "ncaaf" ? "NCAAF" : "NBA_CUP"
  const home = profiles[series.homeTeamName]
  const away = profiles[series.awayTeamName]
  const estimate = chance(series, home, away)
  const hasTeams = cup ? isNbaCupTeam(series.homeTeamName) && isNbaCupTeam(series.awayTeamName) : isOfficialTeamName(series.homeTeamName) && isOfficialTeamName(series.awayTeamName)
  const choice = estimate ? estimate.home >= estimate.away ? series.homeTeamName : series.awayTeamName : null
  const state = cupGameState(series)
  const detail = cupGameDetail(series)
  const canPick = hasTeams && !locked && !saving && state === "scheduled"
  const points = pointsForSeries(series, sport)
  const dateLabel = tipoffLabel(series.startsAt, { weekday: "long", year: true }) ?? "Start time to be announced"
  const left = state === "scheduled" ? countdown(series.startsAt) : null
  const group = cup && cupGroups ? groupForTeam(cupGroups, series.homeTeamName) : null
  const rowOf = (team: string) => group?.teams.find((t) => t.team === team) ?? null
  const pickResult = state === "final" ? getPlayoffPickResult(series, picked ? { pickTeamName: picked } : null, sport) : null

  const colorOf = (side: "home" | "away") => (side === "home" ? detail.homeColor : detail.awayColor) ?? null
  const tintStyle = (team: string, side: "home" | "away"): CSSProperties => {
    const t = teamTint(colorOf(side)) ?? { tint: teamColors(abbreviate(team)).bg, edge: "var(--pb-line2)" }
    return { ["--team-tint" as string]: t.tint, ["--team-edge" as string]: t.edge }
  }

  const cupResults = useMemo(() => {
    const map = new Map<string, Array<{ wl: "W" | "L"; text: string; score: string }>>()
    for (const g of cupGames ?? []) {
      if (cupGameState(g) !== "final" || !g.winnerTeamName || g.id === series.id) continue
      for (const [team, opp, mine, theirs, isHome] of [
        [g.homeTeamName, g.awayTeamName, g.liveHomeScore, g.liveAwayScore, true],
        [g.awayTeamName, g.homeTeamName, g.liveAwayScore, g.liveHomeScore, false],
      ] as const) {
        const date = g.startsAt ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(g.startsAt)) : ""
        map.set(team, [...(map.get(team) ?? []), {
          wl: g.winnerTeamName === team ? "W" : "L",
          text: `${isHome ? "vs" : "at"} ${opp}${date ? ` · ${date}` : ""}`,
          score: mine != null && theirs != null ? `${mine}–${theirs}` : "",
        }])
      }
    }
    return map
  }, [cupGames, series.id])

  const title = cup
    ? `${nickname(series.awayTeamName)} at ${nickname(series.homeTeamName)}`
    : series.gameLabel || (sport === "ncaaf" && series.roundIndex > 1 && series.roundIndex < 4 ? "Bowl assignment to be announced" : "Tournament matchup")

  const teamCard = (name: string, side: "home" | "away", seed: number, profile: BracketTeamProfile | undefined, probability: number | null) => {
    const row = rowOf(name)
    const results = cupResults.get(name) ?? []
    const official = isOfficialTeamName(name) && !/^(?:CFP|EAST|WEST)\d+$/i.test(name)
    return (
      <section className="af-cup-team" style={tintStyle(name, side)} data-picked={picked === name ? "true" : undefined} aria-label={name}>
        {official ? <Silhouette team={name} logoUrl={teamLogos[name] ?? null} logoSport={logoSport} /> : null}
        <span className="af-cup-team-eyebrow">{seed > 0 ? `Seed ${seed}` : `${side === "home" ? "Home" : "Away"} · Tournament team`}</span>
        <div className="af-cup-team-id">
          {official ? <TeamLogo teamAbbr={name} sport={logoSport} logoUrl={teamLogos[name] ?? null} size={64} className="border-white/20 bg-white/10" /> : null}
          <div>
            <h2>{official ? name : "Winner to be determined"}</h2>
            {row && group ? <div className="af-cup-team-sub">{row.wins}-{row.losses} in {group.label} · {row.statusLabel}</div> : null}
          </div>
        </div>
        <div className="af-cup-stats">
          {cup ? (
            <>
              <div className="af-cup-stat"><strong>{row ? `${row.wins}-${row.losses}` : "—"}</strong><span>Group</span></div>
              <div className="af-cup-stat"><strong>{row ? signed(row.pointDiff) : "—"}</strong><span>Group +/−</span></div>
            </>
          ) : null}
          <div className="af-cup-stat"><strong>{profile?.won != null && profile.lost != null ? `${profile.won}-${profile.lost}` : "—"}</strong><span>Season</span></div>
          <div className="af-cup-stat"><strong>{profile?.winPercentage != null ? `${profile.winPercentage}%` : "—"}</strong><span>Win rate</span></div>
          {!cup ? <div className="af-cup-stat"><strong>{signed(profile?.plusMinus)}</strong><span>+/−</span></div> : null}
        </div>
        {cup ? (
          <div className="af-cup-panel">
            <span className="af-cup-panel-head">Cup results so far</span>
            {results.length ? results.map((r, i) => (
              <div className="af-cup-panel-row" key={i}>
                <span className="af-cup-wl" data-r={r.wl}>{r.wl}</span>
                <span style={{ flex: 1 }}>{r.text}</span>
                <span style={{ color: "var(--pb-text2)" }}>{r.score}</span>
              </div>
            )) : <span className="af-cup-panel-row" style={{ color: "var(--pb-muted)" }}>No finished Cup games yet.</span>}
          </div>
        ) : <p className="af-cup-ifwin">{profile?.seasonReview ?? "Season review will appear when verified standings are available."}</p>}
        {cup && row && group && state === "scheduled" ? (
          <p className="af-cup-ifwin"><strong>If they win:</strong> {row.wins + 1}-{row.losses} in {group.label}.{row.status === "controls_path" ? " Still controls its own path to the group title." : ""}</p>
        ) : null}
        {state === "scheduled" ? (
          <div className="af-cup-team-pick">
            <button type="button" disabled={!canPick} onClick={() => onPick(name)}>
              {saving ? "Saving…" : picked === name ? "Your pick ✓" : `Pick ${official ? name : "this team"}`}
            </button>
            {probability != null ? <span>{probability}% matchup estimate</span> : null}
          </div>
        ) : picked === name ? <span className="af-cup-tag af-cup-tag--accent" style={{ alignSelf: "flex-start" }}>Your pick</span> : null}
      </section>
    )
  }

  const scoreSide = (name: string, side: "home" | "away", score: number | null | undefined) => {
    const other = side === "home" ? series.liveAwayScore : series.liveHomeScore
    const dim = score != null && other != null && score < other
    const row = rowOf(name)
    return (
      <div className="af-cup-board-side" data-side={side} data-dim={dim ? "true" : undefined} style={tintStyle(name, side)}>
        <Silhouette team={name} logoUrl={teamLogos[name] ?? null} logoSport={logoSport} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexDirection: side === "home" ? "row-reverse" : "row" }}>
          <TeamLogo teamAbbr={name} sport={logoSport} logoUrl={teamLogos[name] ?? null} size={52} />
          <div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{nickname(name)}</div>
            {row ? <div style={{ color: "var(--pb-text2)", fontSize: 12 }}>{row.wins}-{row.losses} in group{state === "final" && series.winnerTeamName === name ? " · winner" : ""}</div> : null}
          </div>
        </div>
        <span className="af-cup-board-score">{score ?? "–"}</span>
      </div>
    )
  }

  const leaderCard = (name: string, side: "home" | "away", leader: CupLeader | null) => leader ? (
    <div className="af-cup-leader" style={tintStyle(name, side)}>
      <Silhouette team={name} logoUrl={teamLogos[name] ?? null} logoSport={logoSport} />
      <div className="af-cup-leader-text">
        <span>{state === "final" ? "Top scorer" : "Leading scorer"} · {cupTeamCode(name, side === "home" ? detail.homeAbbr : detail.awayAbbr)}</span>
        <strong>{leader.name}</strong>
      </div>
      <span className="af-cup-leader-pts">{leader.points}<small> PTS</small></span>
    </div>
  ) : null

  const periods = Math.max(detail.homeLines.length, detail.awayLines.length)
  const periodLabel = (i: number) => i < 4 ? `Q${i + 1}` : i === 4 ? "OT" : `${i - 3}OT`
  const lineRows = [
    { side: "away" as const, name: series.awayTeamName, lines: detail.awayLines, total: series.liveAwayScore, abbr: detail.awayAbbr },
    { side: "home" as const, name: series.homeTeamName, lines: detail.homeLines, total: series.liveHomeScore, abbr: detail.homeAbbr },
  ]

  return <div className="af-pb-overlay af-cup af-cup-sheet" role="dialog" aria-modal="true" aria-label={`${series.awayTeamName} at ${series.homeTeamName} matchup`}>
    <svg className="af-cup-court" viewBox="0 0 1280 520" preserveAspectRatio="xMidYMin slice" style={{ height: 520, bottom: "auto" }} aria-hidden="true">
      <g>
        <line x1="640" y1="0" x2="640" y2="520" />
        <circle cx="640" cy="200" r="120" />
        <circle cx="640" cy="200" r="40" />
        <path d="M0 60 H180 A200 200 0 0 1 180 460 H0" />
        <path d="M1280 60 H1100 A200 200 0 0 0 1100 460 H1280" />
      </g>
    </svg>
    <div className="af-cup-sheet-inner">
      <button ref={closeRef} type="button" onClick={onClose} className="af-cup-back">← Back to bracket</button>

      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="af-cup-tags">
          <span className="af-cup-tag af-cup-tag--accent">{roundLabel(sport, series.round)}{group ? ` · ${group.label}` : ""}</span>
          <span className="af-cup-tag af-cup-tag--gold">+{points} pt{points === 1 ? "" : "s"}</span>
          {state === "live" ? <span className="af-cup-chip af-cup-chip--live"><span className="af-cup-dot" aria-hidden="true" />LIVE · {cupLiveClock(series)}</span> : null}
          {state === "final" ? <span className="af-cup-tag">Final</span> : null}
          {pickResult?.status === "correct" ? <span className="af-cup-tag af-cup-tag--good">Your pick was right · +{pickResult.points}</span> : null}
          {pickResult?.status === "wrong" ? <span className="af-cup-tag af-cup-tag--bad">Your pick missed</span> : null}
          {state === "scheduled" && locked ? <span className="af-cup-tag">Picks locked</span> : null}
        </div>
        <h1>{title}</h1>
        <div className="af-cup-when">
          <span className="af-cup-when-date">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--pb-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
            {dateLabel}
          </span>
          <span className="af-cup-when-place">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>
            {series.venue || "Venue to be announced"}{series.location ? ` · ${series.location}` : ""}
          </span>
          {left ? <span className="af-cup-countdown">Tips off {left} · pick locks at tipoff</span> : null}
        </div>
      </header>

      {state !== "scheduled" ? (
        <section className="af-cup-board" aria-label={state === "final" ? "Final score" : "Live score"}>
          {scoreSide(series.awayTeamName, "away", series.liveAwayScore)}
          <div className="af-cup-board-mid">
            <strong>{state === "final" ? (detail.detail?.toUpperCase() ?? "FINAL") : "LIVE"}</strong>
            {state === "live" ? <span style={{ color: "#ff9ca0", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{cupLiveClock(series)}</span> : <span style={{ color: "var(--pb-faint)" }}>–</span>}
          </div>
          {scoreSide(series.homeTeamName, "home", series.liveHomeScore)}
        </section>
      ) : null}

      {state !== "scheduled" && periods > 0 ? (
        <div className="af-cup-box">
          <table>
            <caption>Score by quarter</caption>
            <thead><tr><th scope="col">TEAM</th>{Array.from({ length: periods }, (_, i) => <th scope="col" key={i}>{periodLabel(i)}</th>)}<th scope="col">T</th></tr></thead>
            <tbody>
              {lineRows.map((r) => (
                <tr key={r.side}>
                  <th scope="row">{cup ? cupTeamCode(r.name, r.abbr) : r.abbr ?? abbreviate(r.name)}</th>
                  {Array.from({ length: periods }, (_, i) => <td key={i}>{r.lines[i] ?? "–"}</td>)}
                  <td style={{ fontWeight: 900 }}>{r.total ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {state !== "scheduled" && (detail.awayLeader || detail.homeLeader) ? (
        <div className="af-cup-leaders">
          {leaderCard(series.awayTeamName, "away", detail.awayLeader)}
          {leaderCard(series.homeTeamName, "home", detail.homeLeader)}
        </div>
      ) : null}

      {state !== "final" ? (
        <div className="af-cup-teams">
          {teamCard(series.awayTeamName, "away", series.awaySeed, away, estimate?.away ?? null)}
          {teamCard(series.homeTeamName, "home", series.homeSeed, home, estimate?.home ?? null)}
        </div>
      ) : null}

      {state === "scheduled" ? (
        <section className="af-cup-chimmy">
          <span className="af-cup-chimmy-eyebrow">Chimmy Intelligence</span>
          <h2>A smart read before you pick</h2>
          {estimate ? <>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 14 }}><span>{series.awayTeamName} {estimate.away}%</span><span>{series.homeTeamName} {estimate.home}%</span></div>
            <div className="af-cup-chimmy-bar" role="img" aria-label={`${series.awayTeamName} ${estimate.away} percent, ${series.homeTeamName} ${estimate.home} percent`}>
              <span style={{ width: `${estimate.away}%` }} /><span style={{ width: `${estimate.home}%` }} />
            </div>
            <p>Basis: {estimate.basis}. This is a transparent comparison, not a guaranteed outcome. Verified records and point differential appear above when available.</p>
            <button type="button" disabled={!canPick || !choice} onClick={() => choice && onPick(choice)}>Go with Chimmy&apos;s pick · {choice}</button>
          </> : <p>No trustworthy estimate is available for this matchup yet. Pick either team after the official field is set.</p>}
        </section>
      ) : null}

      {cup && group ? (
        <div className="af-cup-split">
          {state !== "final" ? (
            <section className="af-cup-box-card">
              <h2>What this game means for {group.label}</h2>
              <div className="af-cup-stakes">
                {[series.awayTeamName, series.homeTeamName].map((winnerName) => {
                  const loserName = winnerName === series.homeTeamName ? series.awayTeamName : series.homeTeamName
                  const w = rowOf(winnerName), l = rowOf(loserName)
                  return (
                    <div key={winnerName} style={{ borderColor: teamTint(colorOf(winnerName === series.homeTeamName ? "home" : "away"))?.edge }}>
                      <strong>{nickname(winnerName)} win</strong>
                      <span>{w ? `${cupTeamCode(winnerName)} ${w.wins + 1}-${w.losses}` : ""}{l ? ` · ${cupTeamCode(loserName)} ${l.wins}-${l.losses + 1}` : ""} in group play.</span>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}
          <section className="af-cup-box-card">
            <h2>{group.label}{state === "final" ? " standings" : " right now"}</h2>
            {group.teams.map((row, i) => (
              <div className="af-cup-mini" key={row.team} style={row.team === series.homeTeamName || row.team === series.awayTeamName ? { background: "var(--pb-accent-soft)" } : undefined}>
                <span className="af-cup-seed">{i + 1}</span>
                <TeamLogo teamAbbr={row.team} sport="NBA_CUP" logoUrl={teamLogos[row.team] ?? null} size={22} />
                <span className="af-cup-mini-name"><strong>{row.team}</strong><span>{row.statusLabel}</span></span>
                <strong>{row.wins}-{row.losses}</strong>
                <span style={{ width: 36, textAlign: "right" }}>{signed(row.pointDiff)}</span>
              </div>
            ))}
          </section>
        </div>
      ) : null}

      <p className="af-cup-fine">AllFantasy brackets are for fun and competition. No entry fees, prizes, betting, or payouts are offered here.</p>
    </div>
  </div>
}

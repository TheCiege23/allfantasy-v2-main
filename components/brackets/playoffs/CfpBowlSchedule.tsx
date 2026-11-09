"use client"
import { useEffect, useState } from "react"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { isOfficialTeamName } from "@/lib/playoffs/playoffBracketProjection"
import { cfpBowlCrestKey } from "@/lib/playoffs/cfpBowlCrest"
import CfpBowlCrest from "./CfpBowlCrest"

type BowlGame = { gameLabel?: string | null; startsAt?: string | null; venue?: string | null; location?: string | null; awayTeamName?: string; homeTeamName?: string }
const BOWLS = [
  { name: "Fiesta Bowl", round: "Quarterfinal", date: "Dec 30, 2026 · 7:30 PM ET", venue: "State Farm Stadium · Glendale, Arizona" },
  { name: "Cotton Bowl", round: "Quarterfinal", date: "Jan 1, 2027 · time TBA", venue: "AT&T Stadium · Arlington, Texas" },
  { name: "Peach Bowl", round: "Quarterfinal", date: "Jan 1, 2027 · time TBA", venue: "Mercedes-Benz Stadium · Atlanta, Georgia" },
  { name: "Rose Bowl", round: "Quarterfinal", date: "Jan 1, 2027 · time TBA", venue: "Rose Bowl Stadium · Pasadena, California" },
  { name: "Orange Bowl", round: "Semifinal", date: "Jan 14, 2027 · 7:30 PM ET", venue: "Hard Rock Stadium · Miami Gardens, Florida" },
  { name: "Sugar Bowl", round: "Semifinal", date: "Jan 15, 2027 · 7:30 PM ET", venue: "Caesars Superdome · New Orleans, Louisiana" },
] as const

function officialTeam(name: string | undefined): boolean {
  return Boolean(name && isOfficialTeamName(name) && !/^(?:CFP\d+|TBD|TBA|to be announced)$/i.test(name.trim()))
}
function known(value?: string | null): string | null {
  return value && !/^(?:venue|location)?\s*(?:tba|tbd|to be announced)$/i.test(value.trim()) ? value.trim() : null
}

export default function CfpBowlSchedule({ season, series, live = false }: { season: number; series: PlayoffSeriesView[]; live?: boolean }) {
  const [published, setPublished] = useState<BowlGame[]>([])
  useEffect(() => {
    if (!live || season !== 2026) return
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch("/api/brackets/cfp/bowls", { cache: "no-store" })
        if (!response.ok) return
        const data = await response.json() as { games?: Array<{ label?: string; startsAt?: string; venue?: string; location?: string; homeTeamName?: string; awayTeamName?: string }> }
        if (active && Array.isArray(data.games)) setPublished(data.games.map(game => ({ gameLabel: game.label, startsAt: game.startsAt, venue: game.venue, location: game.location, homeTeamName: game.homeTeamName, awayTeamName: game.awayTeamName })))
      } catch { /* Keep the last published details. */ }
    }
    void refresh()
    const timer = window.setInterval(refresh, 15 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [live, season])
  if (season !== 2026) return null
  const games: BowlGame[] = live ? published : series
  return <section className="af-pb-card" aria-label="CFP bowl games" data-testid="cfp-bowl-schedule">
    <h2>CFP bowl games</h2>
    <p className="af-pb-note">Teams and bracket paths are confirmed on selection day. Times are Eastern; matchups appear when officially published.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: 10 }}>
      {BOWLS.map(bowl => {
        const game = games.find(row => row.gameLabel?.toLowerCase().includes(bowl.name.toLowerCase()))
        const teams = officialTeam(game?.awayTeamName) && officialTeam(game?.homeTeamName) ? `${game!.awayTeamName} vs ${game!.homeTeamName}` : "Matchup to be announced"
        const date = game?.startsAt && Number.isFinite(Date.parse(game.startsAt))
          ? `${new Date(game.startsAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} ET` : bowl.date
        const venue = known(game?.venue), location = known(game?.location)
        const place = venue ? [venue, location ?? bowl.venue.split(" · ")[1]].filter(Boolean).join(" · ") : bowl.venue
        const crest = cfpBowlCrestKey(bowl.name)
        return <article key={bowl.name} className="af-pb-bowl-card" data-bowl={crest ?? undefined}>
          <div className="af-pb-bowl-head">
            {crest ? <CfpBowlCrest bowl={crest} size={44} decorative /> : null}
            <div className="af-pb-bowl-title"><span className="af-pb-bowl-round">{bowl.round}</span><strong>{bowl.name}</strong><div className="af-pb-bowl-when">{date}</div></div>
          </div>
          <div className="af-pb-bowl-place">{place}</div>
          <div className="af-pb-bowl-teams">{teams}</div>
        </article>
      })}
    </div>
    <p className="af-pb-note"><a href="https://collegefootballplayoff.com/news/2026/6/1/26-27-broadcast-sked" target="_blank" rel="noreferrer">Official CFP schedule</a></p>
  </section>
}

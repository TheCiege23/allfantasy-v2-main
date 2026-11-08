import type { PlayoffSeriesView } from "@/lib/playoffs/types"
import { isOfficialTeamName } from "@/lib/playoffs/playoffBracketProjection"

// CFP has announced bowl dates, but will assign teams and most January 1
// kickoff times on selection day. Do not attach a bowl to a bracket slot by
// guessing: the top seeds choose their paths after the field is selected.
const BOWLS = [
  { name: "Fiesta Bowl", round: "Quarterfinal", date: "Dec 30, 2026 · 7:30 PM ET" },
  { name: "Cotton Bowl", round: "Quarterfinal", date: "Jan 1, 2027 · time TBA" },
  { name: "Peach Bowl", round: "Quarterfinal", date: "Jan 1, 2027 · time TBA" },
  { name: "Rose Bowl", round: "Quarterfinal", date: "Jan 1, 2027 · time TBA" },
  { name: "Orange Bowl", round: "Semifinal", date: "Jan 14, 2027 · 7:30 PM ET" },
  { name: "Sugar Bowl", round: "Semifinal", date: "Jan 15, 2027 · 7:30 PM ET" },
] as const

function officialTeam(name: string | undefined): boolean {
  return Boolean(name && isOfficialTeamName(name) && !/^(?:CFP\d+|TBD|TBA|to be announced)$/i.test(name.trim()))
}

export default function CfpBowlSchedule({ season, series }: { season: number; series: PlayoffSeriesView[] }) {
  if (season !== 2026) return null
  return <section className="af-pb-card" aria-label="CFP bowl games" data-testid="cfp-bowl-schedule">
    <h2>CFP bowl games</h2>
    <p className="af-pb-note">Teams and bracket paths are confirmed on selection day. Times are Eastern; matchups appear when officially published.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 8 }}>
      {BOWLS.map(bowl => {
        const game = series.find(row => row.gameLabel?.toLowerCase().includes(bowl.name.toLowerCase()))
        const teams = officialTeam(game?.awayTeamName) && officialTeam(game?.homeTeamName)
          ? `${game!.awayTeamName} vs ${game!.homeTeamName}` : "Matchup to be announced"
        const date = game?.startsAt
          ? `${new Date(game.startsAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} ET`
          : bowl.date
        return <div key={bowl.name} style={{ border: "1px solid var(--pb-border, #345)", borderRadius: 10, padding: 10 }}>
          <strong>{bowl.name}</strong><div>{bowl.round}</div><div>{date}</div><div>{teams}</div>
        </div>
      })}
    </div>
    <p className="af-pb-note"><a href="https://collegefootballplayoff.com/news/2026/6/1/26-27-broadcast-sked" target="_blank" rel="noreferrer">Official CFP schedule</a></p>
  </section>
}

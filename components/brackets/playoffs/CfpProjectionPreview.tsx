"use client"
import Link from "next/link"
import { useEffect, useState } from "react"
import type { CfpProjection } from "@/lib/playoffs/cfpRankingsProjection"
import CfpBowlSchedule from "./CfpBowlSchedule"
import "./cfp-preview.css"

// Snapshot of the first committee ranking, not the final playoff field.
// Boise State is projected into the Group of Six automatic-qualifier spot.
const fallbackTeams = ["Miami", "Georgia", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Boise State"] as const
const firstRound = [[8, 9], [5, 12], [7, 10], [6, 11]] as const
const quarterfinals = [
  { seed: 1, from: "8 / 9" }, { seed: 4, from: "5 / 12" },
  { seed: 2, from: "7 / 10" }, { seed: 3, from: "6 / 11" },
] as const

function Team({ seed, teams }: { seed: number; teams: readonly string[] }) {
  return <div className="cfp-preview-team"><span className="cfp-preview-seed">{seed}</span><strong>{teams[seed - 1]}</strong></div>
}
function Placeholder({ children }: { children: string }) {
  return <div className="cfp-preview-team cfp-preview-placeholder">{children}</div>
}

export default function CfpProjectionPreview({ standalone = false }: { standalone?: boolean }) {
  const [projection, setProjection] = useState<CfpProjection | null>(null)
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const response = await fetch("/api/brackets/cfp/projection", { cache: "no-store" })
        if (!response.ok) return
        const data = await response.json() as CfpProjection
        if (active && data.season === 2026 && Array.isArray(data.teams) && data.teams.length === 12 && typeof data.rankingDate === "string") setProjection(data)
      } catch { /* Retain the last dated projection when the provider is unavailable. */ }
    }
    void refresh()
    const timer = window.setInterval(refresh, 15 * 60 * 1000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])
  const teams = projection?.teams ?? fallbackTeams
  const rankingDate = projection?.rankingDate ?? "2026-11-03"
  const rankingLabel = new Date(`${rankingDate}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
  return <section className="cfp-preview" aria-label="Projected CFP bracket" data-testid="cfp-projection-preview">
    <div className="cfp-preview-heading">
      <div><p className="cfp-preview-eyebrow">2026 COLLEGE FOOTBALL PLAYOFF</p><h2>See the bracket take shape</h2><p>Projected field · Subject to change</p></div>
      <span className="cfp-preview-tag">PREVIEW ONLY</span>
    </div>
    <p className="cfp-preview-description">Based on the {rankingLabel} CFP rankings. {projection?.groupSix ?? "Boise State"} is shown as the projected Group of Six qualifier. Conference qualifiers are projected using the highest-ranked team in each conference. Teams, seeds and paths are not official; the committee announces the final field December 6.</p>
    <p className="cfp-preview-footnote">Swipe or scroll to see every round.</p>
    <div className="cfp-preview-scroll" role="region" aria-label="Projected bracket rounds; scroll horizontally to see all rounds" tabIndex={0}>
      <div className="cfp-preview-grid">
        <div className="cfp-preview-column"><h3>First round <span>Dec 18–19</span></h3>{firstRound.map(([a,b]) => <div className="cfp-preview-card" key={a}><Team seed={a} teams={teams} /><Team seed={b} teams={teams} /></div>)}</div>
        <div className="cfp-preview-column"><h3>Quarterfinals <span>Dec 30–Jan 1</span></h3>{quarterfinals.map(({seed,from}) => <div className="cfp-preview-card" key={seed}><Team seed={seed} teams={teams} /><Placeholder>{`Winner ${from}`}</Placeholder></div>)}</div>
        <div className="cfp-preview-column"><h3>Semifinals <span>Jan 14–15</span></h3>{[1,2].map(n => <div className="cfp-preview-card" key={n}><Placeholder>Quarterfinal winner</Placeholder><Placeholder>Quarterfinal winner</Placeholder></div>)}</div>
        <div className="cfp-preview-column"><h3>Championship <span>Jan 25</span></h3><div className="cfp-preview-card cfp-preview-final"><Placeholder>Semifinal winner</Placeholder><Placeholder>Semifinal winner</Placeholder></div></div>
      </div>
    </div>
    {standalone ? <CfpBowlSchedule season={2026} series={[]} live /> : null}
    <p className="cfp-preview-footnote">Illustrative bracket paths and bowl assignments may change. This preview does not save picks or affect standings. <a href="https://collegefootballplayoff.com/rankings" target="_blank" rel="noreferrer">CFP rankings source</a>{standalone ? <> · <Link href="/brackets/leagues/new?sport=NCAAF">Create a CFP pool</Link></> : <> · <Link href="/brackets/cfp/preview">Open shareable preview</Link></>}</p>
  </section>
}

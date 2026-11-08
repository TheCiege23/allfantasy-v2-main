import Link from "next/link"
import "./cfp-preview.css"

// Snapshot of the first committee ranking, not the final playoff field.
// Boise State is projected into the Group of Six automatic-qualifier spot.
const teams = ["Miami", "Georgia", "Utah", "Indiana", "Alabama", "Kentucky", "Texas", "UCLA", "BYU", "Ole Miss", "Notre Dame", "Boise State"] as const
const firstRound = [[8, 9], [5, 12], [7, 10], [6, 11]] as const
const quarterfinals = [
  { seed: 1, from: "8 / 9" }, { seed: 4, from: "5 / 12" },
  { seed: 2, from: "7 / 10" }, { seed: 3, from: "6 / 11" },
] as const

function Team({ seed }: { seed: number }) {
  return <div className="cfp-preview-team"><span className="cfp-preview-seed">{seed}</span><strong>{teams[seed - 1]}</strong></div>
}
function Placeholder({ children }: { children: string }) {
  return <div className="cfp-preview-team cfp-preview-placeholder">{children}</div>
}

export default function CfpProjectionPreview({ standalone = false }: { standalone?: boolean }) {
  return <section className="cfp-preview" aria-label="Projected CFP bracket" data-testid="cfp-projection-preview">
    <div className="cfp-preview-heading">
      <div><p className="cfp-preview-eyebrow">2026 COLLEGE FOOTBALL PLAYOFF</p><h2>See the bracket take shape</h2><p>Projected field · Subject to change</p></div>
      <span className="cfp-preview-tag">PREVIEW ONLY</span>
    </div>
    <p className="cfp-preview-description">Based on the November 3 CFP rankings. Boise State is shown as the projected Group of Six qualifier. Teams, seeds and paths are not official; the committee announces the final field December 6.</p>
    <p className="cfp-preview-footnote">Swipe or scroll to see every round.</p>
    <div className="cfp-preview-scroll" role="region" aria-label="Projected bracket rounds; scroll horizontally to see all rounds" tabIndex={0}>
      <div className="cfp-preview-grid">
        <div className="cfp-preview-column"><h3>First round <span>Dec 18–19</span></h3>{firstRound.map(([a,b]) => <div className="cfp-preview-card" key={a}><Team seed={a} /><Team seed={b} /></div>)}</div>
        <div className="cfp-preview-column"><h3>Quarterfinals <span>Dec 30–Jan 1</span></h3>{quarterfinals.map(({seed,from}) => <div className="cfp-preview-card" key={seed}><Team seed={seed} /><Placeholder>{`Winner ${from}`}</Placeholder></div>)}</div>
        <div className="cfp-preview-column"><h3>Semifinals <span>Jan 14–15</span></h3>{[1,2].map(n => <div className="cfp-preview-card" key={n}><Placeholder>Quarterfinal winner</Placeholder><Placeholder>Quarterfinal winner</Placeholder></div>)}</div>
        <div className="cfp-preview-column"><h3>Championship <span>Jan 25</span></h3><div className="cfp-preview-card cfp-preview-final"><Placeholder>Semifinal winner</Placeholder><Placeholder>Semifinal winner</Placeholder></div></div>
      </div>
    </div>
    <p className="cfp-preview-footnote">Illustrative bracket paths and bowl assignments may change. This preview does not save picks or affect standings. <a href="https://collegefootballplayoff.com/news/2026/11/3/rankings" target="_blank" rel="noreferrer">CFP rankings source</a>{standalone ? <> · <Link href="/brackets/leagues/new?sport=NCAAF">Create a CFP pool</Link></> : <> · <Link href="/brackets/cfp/preview">Open shareable preview</Link></>}</p>
  </section>
}

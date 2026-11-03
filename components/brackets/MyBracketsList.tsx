import Link from "next/link"
import { ArrowLeft, ArrowRight, Trophy } from "lucide-react"
import type { MyBracketLeague } from "@/lib/playoffs/myBrackets"
import { myBracketsCopy } from "@/lib/brackets/myBracketsCopy"
import "./bracket-experience.css"

export default function MyBracketsList({ leagues, language, failed = false }: { leagues: MyBracketLeague[]; language: string; failed?: boolean }) {
  const copy = myBracketsCopy(language)
  return <main className="af-bracket-experience">
    <div className="af-bx-shell af-bx-saved">
      <Link className="af-bx-btn" href="/brackets"><ArrowLeft size={16} aria-hidden />{copy.back}</Link>
      <header className="af-bx-hero">
        <div><p className="af-bx-eyebrow">AllFantasy</p><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
        <div className="af-bx-actions">
          <Link className="af-bx-btn af-bx-primary" href="/brackets/leagues/new?sport=NBA_CUP&challengeType=playoff_challenge">{copy.create}</Link>
          <Link className="af-bx-btn" href="/brackets/join">{copy.join}</Link>
        </div>
      </header>
      {failed ? <div className="af-bx-notice af-bx-error" role="alert"><span>{copy.error}</span><Link className="af-bx-btn" href="/brackets/my">{copy.retry}</Link></div>
        : leagues.length === 0 ? <section className="af-bx-panel af-bx-detail"><h2>{copy.empty}</h2><p>{copy.emptyBody}</p></section>
          : <div className="af-bx-saved-grid">{leagues.map((league) => <section className="af-bx-panel" key={league.id}>
            <header className="af-bx-panelhead"><div><p className="af-bx-eyebrow">{copy.sports[league.sport] ?? league.sport} · {league.seasonYear}</p><h2>{league.name}</h2></div><Trophy size={21} aria-hidden /></header>
            <div className="af-bx-detail">
              {league.entries.length ? <ul className="af-bx-saved-entries">{league.entries.map((entry) => <li className="af-bx-saved-entry" key={entry.id}>
                <div><h3>{entry.name}</h3><p>{entry.finalizedAt ? copy.finalized : copy.draft} · {entry._count.picks} {copy.saved}</p></div>
                <Link className="af-bx-btn af-bx-primary" aria-label={`${copy.open}: ${entry.name}`} href={`/brackets/leagues/${encodeURIComponent(league.id)}/entries/${encodeURIComponent(entry.id)}`}>{copy.open}<ArrowRight size={16} aria-hidden /></Link>
              </li>)}</ul> : <p>{copy.noEntry}</p>}
              <Link className="af-bx-text-link" href={`/brackets/leagues/${encodeURIComponent(league.id)}`}>{copy.league}<ArrowRight size={14} aria-hidden /></Link>
            </div>
          </section>)}</div>}
    </div>
  </main>
}

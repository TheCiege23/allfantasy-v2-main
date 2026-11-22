import Link from "next/link"
import { House, LayoutList, Trophy, UserPlus, Users } from "lucide-react"
import "./bracket-quick-nav.css"

export default function BracketQuickNav({ current, leagueId, language, showInvite }: {
  current?: "hub" | "my" | "league"
  leagueId?: string
  language?: string
  showInvite?: boolean
}) {
  const spanish = language === "es"
  const leagueHref = leagueId ? `/brackets/leagues/${encodeURIComponent(leagueId)}` : null
  return (
    <nav className="af-bracket-quick-nav" aria-label={spanish ? "Navegación de cuadros" : "Bracket navigation"}>
      <Link href="/core"><House size={16} aria-hidden />{spanish ? "Inicio Fantasy" : "Fantasy Home"}</Link>
      <Link href="/brackets" aria-current={current === "hub" ? "page" : undefined}>
        <Trophy size={16} aria-hidden />{spanish ? "Cuadros" : "Bracket Hub"}
      </Link>
      <Link href="/brackets/my" aria-current={current === "my" ? "page" : undefined}>
        <LayoutList size={16} aria-hidden />{spanish ? "Mis cuadros" : "My Brackets"}
      </Link>
      {leagueHref ? (
        <Link href={leagueHref} aria-current={current === "league" ? "page" : undefined}>
          <Users size={16} aria-hidden />{spanish ? "Liga" : "League"}
        </Link>
      ) : null}
      {leagueHref && showInvite ? (
        <Link href={`${leagueHref}#league-invite`}>
          <UserPlus size={16} aria-hidden />{spanish ? "Invitar" : "Invite friends"}
        </Link>
      ) : null}
    </nav>
  )
}

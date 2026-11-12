import Link from 'next/link'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import '@/components/core-app/af-core-boards.css'

/**
 * "Leagues | Portfolio" — the two views behind the one My Leagues nav entry (2026-11-12).
 *
 * ⚠ TWO NAV ENTRIES LISTED THE SAME LEAGUES. My Leagues (/core/leagues) is the list ranked by
 * what needs you; Portfolio (/core/portfolio) is the cross-league board — exposure, risk, value —
 * whose own Leagues tab listed them a second time. The rail now carries one entry, "My Leagues",
 * and this strip heads both screens so Portfolio is one tap from it. The shell highlights the
 * My Leagues entry on either (AfCoreShell `navActive`).
 *
 * Links, not a client toggle: each view has its own loader, and a URL per view keeps both
 * addressable, as they were before.
 */
export type LeaguesPortfolioView = 'leagues' | 'portfolio'

export function LeaguesPortfolioSwitch({ current, language }: { current: LeaguesPortfolioView; language: string }) {
  const copy = (english: string) => coreUiCopy(english, language)
  const views: Array<{ key: LeaguesPortfolioView; href: string; label: string }> = [
    { key: 'leagues', href: '/core/leagues', label: copy('Leagues') },
    { key: 'portfolio', href: '/core/portfolio', label: copy('Portfolio') },
  ]
  return (
    <nav className="af-bd-tabs af-lp-switch" aria-label={copy('My Leagues')} data-testid="leagues-portfolio-switch">
      {views.map((v) => (
        <Link
          key={v.key}
          href={v.href}
          className="af-bd-tab"
          data-core-nav=""
          aria-current={v.key === current ? 'page' : undefined}
        >
          {v.label}
        </Link>
      ))}
    </nav>
  )
}

export default LeaguesPortfolioSwitch

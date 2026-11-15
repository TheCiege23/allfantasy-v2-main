'use client'

import Link from 'next/link'
import { useEffect, useRef, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { demoHrefFor } from '@/lib/demo-league/demoLinks'

import { AfCrest } from '@/components/core-app/AfCrest'
import { CoreNavIcon } from '@/components/core-app/CoreNavIcon'
import { LeagueMark } from '@/components/core-app/LeagueMark'
import { DemoBanner } from '@/components/demo-league/DemoBanner'
// The same style sheets, in the same order, AfCoreShell loads.
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-core-shell.css'
import '@/components/league/native/redraft-identity.css'
import '@/components/core-app/af-core-redraft.css'
import '@/components/core-app/af-core-dynasty.css'
import '@/components/core-app/af-survivor-theme.css'
import './demo-core.css'

/**
 * The app's own chrome — league rail, league menu, top bar, phone tab bar — around every /demo page,
 * so the demo looks like the product rather than a sketch of it.
 *
 * 🛑 NOT `AfCoreShell`. That component is the signed-in shell: its player search, Updates menu, inbox,
 * account menu and comms dock all call signed-in APIs, and every link in it points into /core, where a
 * visitor is sent to sign in. This uses the SAME markup and classes (so `af-core-shell.css` styles it
 * identically) with demo destinations only, and leaves the real shell untouched.
 *
 * The rail lists the live demo league and every league-type example; the menu is the demo's pages.
 */
export type DemoRailItem = {
  href: string
  name: string
  image: string | null
  mark: string
  /** The league theme AfCoreShell would stamp: redraft (green NFL identity) or the dynasty background. */
  theme: 'redraft' | 'dynasty'
}

type MenuItem = { href: string; label: string; icon: Parameters<typeof CoreNavIcon>[0]['navKey']; active: (path: string) => boolean }

/**
 * Home and Standings belong to whichever league the rail has selected (the live demo or a league-type
 * example); Trades, Chimmy, Player Finder and the Trade Evaluator are the live demo league's tools.
 */
function menuFor(leagueHome: string): MenuItem[] {
  const live = leagueHome === '/demo'
  return [
    { href: leagueHome, label: 'Home', icon: 'home', active: (p) => p === leagueHome || (live && p.startsWith('/demo/teams')) },
    { href: `${leagueHome}/standings`, label: 'Standings', icon: 'standings', active: (p) => p === `${leagueHome}/standings` },
    { href: '/demo/trades', label: 'Trades', icon: 'trades', active: (p) => p.startsWith('/demo/trades') },
    { href: '/demo/chimmy', label: 'Chimmy', icon: 'play', active: (p) => p.startsWith('/demo/chimmy') },
    { href: '/demo/players', label: 'Player Finder', icon: 'players', active: (p) => p.startsWith('/demo/players') },
    { href: '/demo/trade-evaluator', label: 'Trade Evaluator', icon: 'tools', active: (p) => p.startsWith('/demo/trade-evaluator') },
    { href: '/demo/formats', label: 'League types', icon: 'my-leagues', active: (p) => p === '/demo/formats' },
  ]
}

/** `/demo/formats/survivor` must not claim `/demo/formats/survivor-guilly`. */
const within = (path: string, href: string) => path === href || path.startsWith(`${href}/`)

export function DemoCoreShell({ rail, children }: { rail: DemoRailItem[]; children: ReactNode }) {
  const path = usePathname() ?? '/demo'
  const inFormat = rail.find((r) => r.href !== '/demo' && within(path, r.href))
  const selected = inFormat ?? rail.find((r) => r.href === '/demo')
  const leagueName = selected?.name ?? 'Demo league'
  const leagueHome = selected?.href ?? '/demo'
  const menu = menuFor(leagueHome)

  /*
   * The real screens link into the signed-in app (/core/…?league=…). Rewrite those anchors to demo
   * pages or sign-up (lib/demo-league/demoLinks.ts) — on the attribute, so hover, copy-link and
   * open-in-new-tab all agree with where a click goes — and keep rewriting as the screens re-render.
   */
  const contentRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const root = contentRef.current
    if (!root) return
    const rewrite = () => {
      for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        const next = demoHrefFor(a.getAttribute('href'), leagueHome)
        if (next && a.getAttribute('href') !== next) {
          a.dataset.demoRewritten = '1'
          a.setAttribute('href', next)
        }
      }
    }
    rewrite()
    const obs = new MutationObserver(rewrite)
    obs.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['href'] })
    return () => obs.disconnect()
  }, [leagueHome])
  /*
   * A Next <Link> navigates with the href it was RENDERED with, not the attribute. So a click on a
   * rewritten link is caught in the capture phase — before the Link's own handler — and sent where the
   * attribute now says. Modified clicks (new tab etc.) fall through to the browser, which reads the
   * attribute.
   */
  const router = useRouter()
  const onContentClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null
    if (!a || a.dataset.demoRewritten !== '1') return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    router.push(a.getAttribute('href') ?? leagueHome)
  }

  return (
    <div
      className="af-core af-shell"
      data-rail-open="false"
      data-demo-league="1"
      data-format={selected?.theme === 'redraft' ? 'redraft' : undefined}
      data-sport={selected?.theme === 'redraft' ? 'nfl' : undefined}
      data-dynasty-background={selected?.theme === 'dynasty' ? 'true' : undefined}
    >
      <a href="#af-content" className="af-skip">Skip to content</a>

      <nav className="af-rail" aria-label="Demo leagues">
        <Link href="/" className="af-rail-logo" aria-label="AllFantasy home">
          <AfCrest size={34} />
        </Link>
        <div className="af-rail-divider" />
        <div className="af-rail-scroll">
          {rail.map((r) => {
            const active = r === selected
            return (
              <Link
                key={r.href}
                href={r.href}
                className="af-rail-tile af-platform"
                data-platform="allfantasy"
                data-active={active}
                aria-current={active ? 'true' : undefined}
                title={r.name}
                aria-label={r.name}
              >
                <span className="af-rail-tile-art">
                  <LeagueMark src={r.image} letter={r.mark} />
                </span>
              </Link>
            )
          })}
        </div>
      </nav>

      <aside className="af-nav" aria-label="Demo league menu">
        <div className="af-nav-scroll">
          <div className="af-nav-group">
            <div className="af-nav-heading af-label" aria-hidden>This league</div>
            <div className="af-nav-league" title={leagueName}>
              <span className="af-nav-league-dot" aria-hidden />
              <span className="af-nav-league-name">{leagueName}</span>
            </div>
            <ul className="af-nav-items" aria-label="This league">
              {menu.map((item) => {
                const active = item.active(path)
                return (
                  <li key={item.href}>
                    <Link href={item.href} className="af-nav-item" data-active={active} aria-current={active ? 'page' : undefined}>
                      <span className="af-nav-glyph" aria-hidden><CoreNavIcon navKey={item.icon} size={16} /></span>
                      <span className="af-nav-label">{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
        <div className="af-nav-foot">
          <div className="af-import-cta">
            <div className="af-import-title">Make it yours</div>
            <p className="af-import-body">Create a league or bring one over from Sleeper, ESPN, Yahoo and more.</p>
            <Link href="/create-league" className="af-btn af-import-btn">Create a league</Link>
          </div>
        </div>
      </aside>

      <div className="af-main">
        <DemoBanner />
        <header className="af-topbar">
          <Link href="/" className="af-topbar-crest" aria-label="AllFantasy home">
            <AfCrest size={28} />
          </Link>
          <div className="af-scope">
            <span className="af-scope-btn" aria-label={`League: ${leagueName}`}>{leagueName}</span>
          </div>
          <div className="af-topbar-right">
            <Link href="/signup" className="af-btn af-btn--ghost">Sign up free</Link>
          </div>
        </header>
        <main id="af-content" className="af-content" ref={contentRef} onClickCapture={onContentClickCapture}>{children}</main>
      </div>

      <nav className="af-tabbar" aria-label="Demo league menu">
        {menu.slice(0, 5).map((item) => {
          const active = item.active(path)
          return (
            <Link key={item.href} href={item.href} className="af-tabbar-item" data-active={active} aria-current={active ? 'page' : undefined}>
              <span className="af-tabbar-glyph" aria-hidden><CoreNavIcon navKey={item.icon} size={20} /></span>
              <span className="af-tabbar-label">{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

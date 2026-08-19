'use client'

import Link from 'next/link'
import '@/components/core-app/af-tools.css'

/**
 * Tools — the launcher for everything that lives outside the core shell.
 *
 * ⚠ THIS CLOSES TWO LEDGER ITEMS AT ONCE. It was one of three rail slots
 * rendering "has not been built yet", and it is also where the seven orphaned
 * link-outs go. Every destination below is a route that already works today and
 * that /core simply had no way to reach — so retiring /dashboard without this
 * would have stranded them: live pages with no door.
 *
 * ⚠ EVERY HREF HERE WAS CHECKED TO BE A REAL ROUTE. The Commissioner Hub card on
 * that surface promised "recruit managers with one shareable link" and pointed at
 * /import — the league-import page. A launcher full of confident links to the
 * wrong places is worse than no launcher, because it looks authoritative.
 */

type Tool = {
  href: string
  title: string
  desc: string
  /** Opens outside the core shell — worth signalling before the click. */
  leavesShell?: boolean
}

const GROUPS: Array<{ heading: string; tools: Tool[] }> = [
  {
    heading: 'Your leagues',
    tools: [
      {
        href: '/commissioner-hub',
        title: 'Commissioner Hub',
        desc: 'Run the leagues you commission — settings, integrity, recaps.',
        leavesShell: true,
      },
      {
        href: '/war-room',
        title: 'War Room',
        desc: 'Draft-room intelligence and live pick support.',
        leavesShell: true,
      },
      {
        href: '/af-rankings',
        title: 'Rankings',
        desc: 'Your AF Rank and where you sit against other managers.',
        leavesShell: true,
      },
    ],
  },
  {
    heading: 'Add a league',
    tools: [
      {
        href: '/import?returnTo=%2Fcore%2Ftools',
        title: 'Import a league',
        desc: 'Bring in a league from Sleeper, ESPN or Yahoo.',
      },
      {
        href: '/create-league',
        title: 'Create a league',
        desc: 'Start one from scratch and invite managers.',
        leavesShell: true,
      },
      {
        href: '/af-legacy',
        title: 'AF Legacy',
        desc: 'Career history tools and past-season imports.',
        leavesShell: true,
      },
    ],
  },
  {
    heading: 'Account',
    tools: [
      {
        href: '/tokens',
        title: 'Tokens',
        desc: 'Your balance, what actions cost, and top-ups.',
        leavesShell: true,
      },
      {
        href: '/pricing',
        title: 'Plans',
        desc: 'Compare tiers and what each one unlocks.',
        leavesShell: true,
      },
      {
        href: '/settings?tab=billing',
        title: 'Billing',
        desc: 'Payment method, invoices and cancellation.',
        leavesShell: true,
      },
      {
        href: '/settings',
        title: 'Settings',
        desc: 'Profile, notifications, language and connected accounts.',
        leavesShell: true,
      },
      {
        href: '/support',
        title: 'Support',
        desc: 'Get help from a person.',
        leavesShell: true,
      },
    ],
  },
]

export function Tools() {
  return (
    <div className="af-tl">
      <header className="af-tl-head">
        <h1 className="af-tl-title">Tools</h1>
        <p className="af-tl-sub">
          Everything that lives outside the main screens. All of these open the full page.
        </p>
      </header>

      {GROUPS.map((group) => (
        <section key={group.heading} className="af-tl-group">
          <h2 className="af-tl-heading">{group.heading}</h2>
          <div className="af-tl-grid">
            {group.tools.map((tool) => (
              <Link key={tool.href} href={tool.href} className="af-tl-card">
                <span className="af-tl-card-title">
                  {tool.title}
                  {tool.leavesShell ? (
                    <span className="af-tl-out" aria-label="opens the full page">
                      ↗
                    </span>
                  ) : null}
                </span>
                <span className="af-tl-card-desc">{tool.desc}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default Tools

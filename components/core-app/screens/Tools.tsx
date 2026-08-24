'use client'

import Link from 'next/link'
import type { ToolCard, ToolsHubData } from '@/lib/core-app/toolsHub'
import '@/components/core-app/af-tools.css'

/**
 * 25a — Tools, grouped by the job you came here to do.
 *
 * ⚠ THIS REPLACED A FLAT ALPHABETICAL LAUNCHER, AND THE GROUPING IS THE POINT.
 * "Decide something today" is deadline-bound and every card in it shows what is
 * actually pending; "Understand something" has no clock and shows a real
 * statistic instead; "Share something" produces an artefact. A tool's group is
 * the fastest signal about whether it is worth opening right now.
 *
 * ⚠ EVERY HREF HERE IS A ROUTE THAT EXISTS. The version of this screen that
 * shipped before carried a Commissioner Hub card promising "recruit managers
 * with one shareable link" pointed at /import — the league-import page. A
 * launcher full of confident links to the wrong places is worse than no
 * launcher, because it looks authoritative. That rule survives this rewrite.
 *
 * ⚠ URGENCY AND PRICE COME FROM THE LOADER, NOT FROM THIS FILE. See
 * `lib/core-app/toolsHub.ts` — it reads the shared issue queue and the real
 * token pricing matrix. Nothing on this screen is a literal.
 */

export type ToolsProps = {
  data: ToolsHubData
}

function TierBadge({ tier }: { tier: ToolCard['tier'] }) {
  if (tier === 'free') return null
  const label = tier === 'commissioner' ? 'Commissioner' : tier === 'pro' ? 'Pro' : 'Plan'
  return (
    <span className="af-tl-tier" data-tier={tier}>
      {label}
    </span>
  )
}

function Card({ tool }: { tool: ToolCard }) {
  return (
    <div className="af-tl-cardwrap">
      <Link href={tool.href} className="af-tl-card" data-tone={tool.live?.tone ?? 'none'}>
        <span className="af-tl-card-head">
          <span className="af-tl-card-title">
            {tool.title}
            {tool.leavesShell ? (
              <span className="af-tl-out" aria-label="opens the full page" title="Opens the full page">
                ↗
              </span>
            ) : null}
          </span>
          <span className="af-tl-card-badges">
            {/* Price before the click. Never revealed after. */}
            {tool.tokenCost != null ? (
              <span className="af-tl-cost af-num" title="Tokens per run">
                {tool.tokenCost}
              </span>
            ) : null}
            <TierBadge tier={tool.tier} />
          </span>
        </span>

        <span className="af-tl-card-desc">{tool.desc}</span>

        {/* The live line. A tool card with no context is a bare tool name. */}
        {tool.live ? (
          <span className="af-tl-live" data-tone={tool.live.tone}>
            <i className="af-tl-livedot" aria-hidden />
            {tool.live.text}
          </span>
        ) : null}
      </Link>

      {/*
        Alternates. These are live routes doing the same job — see the open
        decision panel below. Listed rather than hidden, because hiding a working
        route is a retirement decision nobody has taken.
      */}
      {tool.alternates && tool.alternates.length > 0 ? (
        <div className="af-tl-alts">
          <span className="af-tl-alts-label">Also:</span>
          {tool.alternates.map((a) => (
            <Link key={a.href} href={a.href} className="af-tl-alt">
              {a.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Tools({ data }: ToolsProps) {
  return (
    <div className="af-tl">
      <header className="af-tl-head">
        <h1 className="af-tl-title">Tools</h1>
        <p className="af-tl-sub">
          Grouped by what you came to do. Anything with a deadline shows it here, before you open it.
        </p>
      </header>

      {data.groups.map((group) => (
        <section key={group.id} className="af-tl-group">
          <div className="af-tl-grouphead">
            <h2 className="af-tl-heading">{group.heading}</h2>
            <p className="af-tl-groupnote">{group.note}</p>
          </div>
          <div className="af-tl-grid">
            {group.tools.map((tool) => (
              <Card key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      ))}

      <p className="af-tl-scopenote">{data.leagueScopedNote}</p>

      {/*
        The pending product decision, on the page rather than only in a comment.
        The handoff asks that implementation not silently pick a direction; the
        honest version of "not picking" is saying so where it can be seen.
      */}
      {data.openDecision ? (
        <aside className="af-tl-decision">
          <p className="af-tl-decision-eyebrow af-label">Open decision</p>
          <h2 className="af-tl-decision-title">{data.openDecision.title}</h2>
          <p className="af-tl-decision-body">{data.openDecision.body}</p>
        </aside>
      ) : null}
    </div>
  )
}

export default Tools

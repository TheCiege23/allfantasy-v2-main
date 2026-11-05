'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeftRight, BarChart3, ClipboardList, Coins, Crown, Download, LineChart, MessageCircle, Settings, Share2, Sparkles, Swords, Trophy, Users, type LucideIcon } from 'lucide-react'
import type { ToolCard, ToolsHubData } from '@/lib/core-app/toolsHub'
import '@/components/core-app/af-tools.css'
import '@/components/core-app/af-tools-redesign.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { TopicTip } from '@/components/core-app/TopicTip'
import { COMMS_OPEN_EVENT } from '@/components/core-app/comms/commsEvents'
import { useMessages } from '@/components/i18n/useMessages'
import { toolsScreenMessages } from '@/lib/core-app/messages/toolsScreen'
import { matchesToolPlanFilter, toolPlanStatus, type ToolPlanFilter, type ToolPlanStatus } from '@/lib/core-app/toolsPlan'
import { FilterChips } from '@/components/core-app/primitives/FilterChips'
import { PageHeader } from '@/components/core-app/primitives/PageHeader'

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

/**
 * The viewer's plan, read by the shell (lib/ai-access/AIAccessResolver via page.tsx). `held` is
 * already expanded for the Supreme bundle; `name` is the display name of the first plan, or null on
 * the free tier. Omitted (or null) when the read failed: the plan chip and filter are then not drawn,
 * rather than guessing a viewer is on Free.
 */
export type ToolsViewerPlan = { held: string[]; name: string | null }

export type ToolsProps = {
  data: ToolsHubData
  viewerPlan?: ToolsViewerPlan | null
}

/** One icon per tool on the board; a tool added later falls back to its group's icon. */
const TOOL_ICONS: Record<string, LucideIcon> = {
  waivers: ClipboardList,
  trade: ArrowLeftRight,
  draft: Swords,
  outlook: LineChart,
  'trade-history': ArrowLeftRight,
  compare: Users,
  'power-rankings': Trophy,
  'share-card': Share2,
  tokens: Coins,
  plans: Crown,
  settings: Settings,
  import: Download,
  commissioner: Crown,
}
const GROUP_ICONS: Record<string, LucideIcon> = { decide: Sparkles, understand: BarChart3, share: Share2, account: Settings }

function TierBadge({ tier }: { tier: ToolCard['tier'] }) {
  const { language } = useOptionalLanguage()
  if (tier === 'free') return null
  const label = tier === 'commissioner' ? 'Commissioner' : tier === 'pro' ? 'Pro' : 'Plan'
  return (
    <span className="af-tl-tier" data-tier={tier}>
      {coreUiCopy(label, language)}
    </span>
  )
}

function PlanBadge({ tier, status }: { tier: ToolCard['tier']; status: ToolPlanStatus }) {
  const m = useMessages(toolsScreenMessages)
  if (status === 'free') return <span className="af-tl-plan" data-status="free">{m.badgeFree}</span>
  if (status === 'included') return <span className="af-tl-plan" data-status="included">{m.badgeIncluded}</span>
  return <TierBadge tier={tier} />
}

function Card({ tool, groupId, status }: { tool: ToolCard; groupId: string; status: ToolPlanStatus }) {
  const { language } = useOptionalLanguage()
  const m = useMessages(toolsScreenMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  const Icon = TOOL_ICONS[tool.id] ?? GROUP_ICONS[groupId] ?? Sparkles
  return (
    <div className="af-tl-cardwrap" data-plan-status={status} data-testid={`tool-${tool.id}`}>
      <Link href={tool.href} className="af-tl-card" data-tone={tool.live?.tone ?? 'none'}>
        <span className="af-tl-card-head">
          <span className="af-tl-icon" aria-hidden>
            <Icon size={20} strokeWidth={1.9} />
          </span>
          <span className="af-tl-card-title">
            {copy(tool.title)}
            {tool.leavesShell ? (
              <span className="af-tl-out" aria-label={copy('opens the full page')}>
                ↗
              </span>
            ) : null}
          </span>
          <span className="af-tl-card-badges">
            {/* Price before the click. Never revealed after. Explained once, by the "?" at the page heading. */}
            {tool.tokenCost != null ? (
              <span className="af-tl-cost af-num">
                {tool.tokenCost}
                {/* The title= that named this number is gone (phones never showed it); a screen reader still needs it. */}
                <span className="sr-only"> {copy('Tokens per run')}</span>
              </span>
            ) : null}
          </span>
        </span>

        <span className="af-tl-card-desc">{copy(tool.desc)}</span>

        {/* The live line. A tool card with no context is a bare tool name. */}
        {tool.live ? (
          <span className="af-tl-live" data-tone={tool.live.tone}>
            <i className="af-tl-livedot" aria-hidden />
            {copy(tool.live.text)}
          </span>
        ) : null}

        {/* The board's footer: the plan badge, then the action. The action is a label inside the card's
            one link (a second link here would nest), so it reads "Open" and goes where the card goes. */}
        <span className="af-tl-foot">
          <PlanBadge tier={tool.tier} status={status} />
          <span className="af-tl-open" data-variant={status === 'upgrade' ? 'quiet' : 'solid'}>{m.open}</span>
        </span>
      </Link>

      {status === 'upgrade' ? (
        <Link href="/pricing" className="af-tl-upsell" data-testid={`tool-${tool.id}-plans`}>
          {m.seePlans}
        </Link>
      ) : null}

      {/*
        Alternates. These are live routes doing the same job — see the open
        decision panel below. Listed rather than hidden, because hiding a working
        route is a retirement decision nobody has taken.
      */}
      {tool.alternates && tool.alternates.length > 0 ? (
        <div className="af-tl-alts">
          <span className="af-tl-alts-label">{copy('Also:')}</span>
          {tool.alternates.map((a) => (
            <Link key={a.href} href={a.href} className="af-tl-alt">
              {copy(a.label)}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const FILTERS: readonly ToolPlanFilter[] = ['all', 'included', 'upgrade']

export function Tools({ data, viewerPlan = null }: ToolsProps) {
  const { language } = useOptionalLanguage()
  const m = useMessages(toolsScreenMessages)
  const copy = (english: string) => coreUiCopy(english, language)
  const [filter, setFilter] = useState<ToolPlanFilter>('all')
  const held = viewerPlan ? viewerPlan.held : null
  const hasCardMarks = data.groups.some((g) => g.tools.some((t) => t.tokenCost != null || t.leavesShell))
  const groups = data.groups
    .map((group) => ({
      ...group,
      tools: group.tools
        .map((tool) => ({ tool, status: toolPlanStatus(tool.tier, held) }))
        .filter(({ status }) => matchesToolPlanFilter(status, filter)),
    }))
    .filter((group) => group.tools.length > 0)
  const filterLabel: Record<ToolPlanFilter, string> = { all: m.filterAll, included: m.filterIncluded, upgrade: m.filterUpgrade }
  return (
    <div className="af-tl" data-redesign="tools">
      <PageHeader
        className="af-tl-head"
        eyebrow={m.eyebrow}
        title={
          <>
            {copy('Tools')}
            {/* Replaces two per-card `title=`s ("Tokens per run", "Opens the full page") a phone never showed — the cards are links, so the key lives here. */}
            {hasCardMarks ? (
              <>
                {' '}
                <TopicTip topic="tokenCost" />
              </>
            ) : null}
          </>
        }
        sub={copy('Grouped by what you came to do. Anything with a deadline shows it here, before you open it.')}
        actions={
          viewerPlan ? (
            <Link href="/pricing" className="af-tl-planchip" data-testid="tools-plan-chip">
              {m.planChip(viewerPlan.name ?? m.planFree)}
            </Link>
          ) : null
        }
      />

      <section className="af-tl-chimmy" aria-labelledby="af-tl-chimmy-title">
        <span className="af-tl-chimmy-mark" aria-hidden>
          <MessageCircle size={26} strokeWidth={1.9} />
        </span>
        <span className="af-tl-chimmy-text">
          <span className="af-tl-chimmy-title" id="af-tl-chimmy-title">{m.chimmyTitle}</span>
          <span className="af-tl-chimmy-body">{m.chimmyBody}</span>
        </span>
        <button
          type="button"
          className="af-tl-chimmy-ask"
          onClick={() => window.dispatchEvent(new CustomEvent(COMMS_OPEN_EVENT, { detail: { tab: 'chimmy' } }))}
        >
          {m.askChimmy}
        </button>
      </section>

      {held ? (
        <FilterChips
          className="af-tl-filters"
          ariaLabel={m.filterAria}
          scrollOnPhone
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ id: f, label: filterLabel[f], testId: `tools-filter-${f}` }))}
        />
      ) : null}

      {groups.length === 0 ? <p className="af-tl-empty">{m.empty}</p> : null}

      {groups.map((group) => (
        <section key={group.id} className="af-tl-group">
          <div className="af-tl-grouphead">
            <h2 className="af-tl-heading">{copy(group.heading)}</h2>
            <p className="af-tl-groupnote">{copy(group.note)}</p>
          </div>
          {/*
            38a·11 gives the deadline-bound group a wider 3-up card and the
            reference groups a denser 4-up. Emphasis by size: the cards with a
            clock on them should be the ones that read first.

            ⚠ THE DESIGN DROPS `share` AND `account` AND THIS KEEPS THEM. Career
            Share has no other entry point in the product — deleting its group to
            match a mock orphans the screen behind it. Emphasis does not require
            deletion, so they stay as the denser rows.
          */}
          <div className="af-tl-grid" data-density={group.id === 'decide' ? 'wide' : 'dense'}>
            {group.tools.map(({ tool, status }) => (
              <Card key={tool.id} tool={tool} groupId={group.id} status={status} />
            ))}
          </div>
        </section>
      ))}

      <p className="af-tl-scopenote">{copy(data.leagueScopedNote)}</p>

    </div>
  )
}

export default Tools

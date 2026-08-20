'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChimmyChatPanel, ChimmyChatShell, type ChimmyToolContextValue } from '@/components/chimmy'
import { getToolContextForChimmy } from '@/lib/chimmy-interface'
import { getToolToAIChatHref } from '@/lib/chimmy-chat'
import { getChimmyChatHref, getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'

type ToolRoutePreset = {
  prompt: string
  toolContext: ChimmyToolContextValue
}

function buildToolRoutePreset(source: Parameters<typeof getToolContextForChimmy>[0]): ToolRoutePreset {
  const routed = getToolContextForChimmy(source, { leagueName: 'Harness League', sport: 'NFL' })
  const toolName = routed.toolId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  return {
    prompt: routed.suggestedPrompt,
    toolContext: {
      toolName,
      summary: routed.contextHint,
      leagueName: 'Harness League',
      sport: 'NFL',
    },
  }
}

export default function ChimmyInterfaceHarnessClient() {
  const defaultToolRoutePreset = useMemo(() => buildToolRoutePreset('trade'), [])
  const [shellKey, setShellKey] = useState(1)
  const [prompt, setPrompt] = useState<string>(defaultToolRoutePreset.prompt)
  const [toolContext, setToolContext] = useState<ChimmyToolContextValue | null>(defaultToolRoutePreset.toolContext)
  const [compareCount, setCompareCount] = useState(0)
  const [splitOpen, setSplitOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const shellProps = useMemo(
    () => ({
      initialPrompt: prompt,
      clearUrlPromptAfterUse: false,
      leagueName: 'Harness League',
      leagueId: 'chimmy_e2e_league',
      sport: 'NFL' as const,
      season: 2026,
      week: 9,
      toolContext,
      onOpenCompare: () => setCompareCount((current) => current + 1),
    }),
    [prompt, toolContext]
  )

  const applyRoutePreset = (source: Parameters<typeof getToolContextForChimmy>[0]) => {
    const preset = buildToolRoutePreset(source)
    setPrompt(preset.prompt)
    setToolContext(preset.toolContext)
    setShellKey((current) => current + 1)
  }

  return (
    <main className="min-h-screen bg-[#060b18] p-6 text-white" data-testid="chimmy-harness-page">
      <h1 className="mb-3 text-xl font-semibold">Chimmy Interface Harness</h1>
      <p className="mb-4 text-sm text-white/65">
        Prompt 126 audit harness for Chimmy chat interactions, context routing, and voice controls.
      </p>

      <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <h2 className="mb-2 text-sm font-semibold text-white/90">Chimmy entry links</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href={getChimmyChatHref()}
            data-testid="chimmy-harness-entry-primary-link"
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5"
          >
            Ask Chimmy
          </Link>
          <Link
            href={getChimmyChatHrefWithPrompt('Explain this trade with evidence and risk notes.')}
            data-testid="chimmy-harness-entry-prompted-link"
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5"
          >
            Prompted entry
          </Link>
          <Link
            href={getToolToAIChatHref('matchup', {
              leagueId: 'chimmy_e2e_league',
              sport: 'NFL',
              week: 9,
            })}
            data-testid="chimmy-harness-entry-matchup-link"
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5"
          >
            Matchup tool route
          </Link>
          <Link
            href={getToolToAIChatHref('playoff', {
              leagueId: 'chimmy_e2e_league',
              sport: 'NFL',
              week: 9,
            })}
            data-testid="chimmy-harness-entry-playoff-link"
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5"
          >
            Playoff tool route
          </Link>
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <h2 className="mb-2 text-sm font-semibold text-white/90">Tool-to-Chimmy handoff buttons</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="chimmy-harness-route-trade-button"
            onClick={() => applyRoutePreset('trade')}
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-200"
          >
            Route trade context
          </button>
          <button
            type="button"
            data-testid="chimmy-harness-route-waiver-button"
            onClick={() => applyRoutePreset('waiver')}
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-200"
          >
            Route waiver context
          </button>
          <button
            type="button"
            data-testid="chimmy-harness-route-matchup-button"
            onClick={() => applyRoutePreset('matchup')}
            className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-1.5 text-xs text-cyan-200"
          >
            Route matchup context
          </button>
          <button
            type="button"
            data-testid="chimmy-harness-reset-shell-button"
            onClick={() => {
              setPrompt('')
              setToolContext(null)
              setShellKey((current) => current + 1)
            }}
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80"
          >
            Reset shell
          </button>
          <button
            type="button"
            data-testid="chimmy-harness-open-split-button"
            onClick={() => setSplitOpen(true)}
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80"
          >
            Open split panel
          </button>
          <button
            type="button"
            data-testid="chimmy-harness-open-drawer-button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80"
          >
            Open mobile drawer
          </button>
        </div>
        <p className="mt-2 text-xs text-white/55" data-testid="chimmy-harness-compare-count">
          Compare opened: {compareCount}
        </p>
      </section>

      <section data-testid="chimmy-harness-inline-shell">
        <ChimmyChatShell key={shellKey} {...shellProps} />
      </section>

      <section data-testid="chimmy-harness-split" className="mt-4">
        {splitOpen && (
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              data-testid="chimmy-harness-close-split-button"
              onClick={() => setSplitOpen(false)}
              className="rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-xs text-white/80"
            >
              Close split panel
            </button>
          </div>
        )}
        <ChimmyChatPanel
          {...shellProps}
          key={`split-${shellKey}`}
          variant="split"
          open={splitOpen}
          onClose={() => setSplitOpen(false)}
        />
      </section>

      {drawerOpen && (
        <section data-testid="chimmy-harness-drawer">
          <button
            type="button"
            data-testid="chimmy-harness-close-drawer-button"
            onClick={() => setDrawerOpen(false)}
            className="fixed right-3 top-3 z-[70] rounded-lg border border-white/20 bg-[#050b1b] px-2.5 py-1.5 text-xs text-white/90"
          >
            Close drawer
          </button>
          <ChimmyChatPanel
            {...shellProps}
            key={`drawer-${shellKey}`}
            variant="drawer"
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
          />
        </section>
      )}
    </main>
  )
}

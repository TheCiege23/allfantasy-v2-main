'use client'

import Link from 'next/link'
import HomeTopNav from '@/components/navigation/HomeTopNav'
import {
  ArrowRight,
  BookmarkCheck,
  Bot,
  BrainCircuit,
  Cpu,
  Gauge,
  Layers3,
  Network,
  ShieldCheck,
  Sparkles,
  Workflow,
  Zap,
} from 'lucide-react'

const APP_SURFACES = [
  {
    title: 'Fantasy leagues',
    description: 'League workflows, roster moves, and decision support inside Sports App.',
    href: '/app',
  },
  {
    title: 'Bracket challenges',
    description: 'Bracket analysis, simulations, and AI-assisted tournament strategy.',
    href: '/brackets',
  },
  {
    title: 'AI tools',
    description: 'Unified AI Workbench for run, compare, and provider-aware reasoning.',
    href: '/ai/tools',
  },
  {
    title: 'Dynasty tools',
    description: 'Long-horizon valuation, strategy planning, and lifecycle decision support.',
    href: '/af-legacy',
  },
  {
    title: 'Creator leagues',
    description: 'Creator-facing league experiences with AI-enhanced growth and content support.',
    href: '/creator-leagues',
  },
  {
    title: 'Legacy history',
    description: 'Hall of Fame, story systems, and identity narratives grounded in deterministic history.',
    href: '/app/hall-of-fame',
  },
  {
    title: 'Analytics tools',
    description: 'Meta insights, trend intelligence, and confidence-aware recommendation context.',
    href: '/app/meta-insights',
  },
] as const

const ORCHESTRATION_MODES = [
  {
    title: 'Single Model',
    description: 'One provider executes the full response path for speed and clarity.',
  },
  {
    title: 'Specialist Mode',
    description: 'Tool-specific provider routing based on deterministic context and use case.',
  },
  {
    title: 'Consensus Mode',
    description: 'Multiple providers are compared and disagreements are surfaced clearly.',
  },
  {
    title: 'Unified Brain Mode',
    description: 'Deterministic facts + DeepSeek reasoning + xAI narrative framing + OpenAI synthesis.',
  },
] as const

export default function AISystemExplainerPage() {
  return (
    <main
      className="min-h-screen flex flex-col mode-readable"
      style={{ background: 'var(--bg)', color: 'var(--text)' }}
    >
      <HomeTopNav />

      <article className="flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
            <BrainCircuit className="h-3.5 w-3.5" />
            AI System Explainer
          </div>
          <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">
            How AllFantasy AI works across the entire app
          </h1>
          <p className="mt-4 text-base leading-relaxed" style={{ color: 'var(--muted)' }}>
            AllFantasy uses a deterministic-first AI architecture. Core engines compute the facts,
            then AI explains, compares, and recommends without overriding deterministic rules.
            This powers Chimmy, tools, leagues, bracket strategy, dynasty workflows, creator systems,
            legacy history, and analytics surfaces.
          </p>
          <div className="mt-6">
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/ai/tools"
                data-testid="ai-system-try-tools-final-button"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black shadow-lg hover:bg-emerald-400 transition-colors"
              >
                <Sparkles className="h-5 w-5 shrink-0" />
                Try AI Tools
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
              <Link
                href="/ai/history"
                data-testid="ai-system-open-saved-button"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 transition-colors"
              >
                <BookmarkCheck className="h-5 w-5 shrink-0" />
                Open Saved AI Results
              </Link>
            </div>
          </div>

          <section className="mt-10">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5 text-purple-400" aria-hidden />
              Chimmy overview
            </h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Chimmy is the conversational face of AllFantasy AI. Chimmy turns your natural-language
              question into a structured context envelope that includes sport, league context,
              deterministic evidence, confidence metadata, and risk caveats. Chimmy is designed
              to stay calm, clear, and trustworthy.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Cpu className="h-5 w-5 text-cyan-400" aria-hidden />
              Deterministic-first AI
            </h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Before AI generates any narrative, deterministic layers compute the numbers: trade
              fairness, lineup impact, rankings and tiers, waiver priority, simulation outcomes,
              legacy scoring, reputation signals, and draft value context. Those outputs are passed
              into model prompts as hard evidence. AI explains and extends; it does not replace
              deterministic computation.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-400" aria-hidden />
              OpenAI, DeepSeek, and xAI (Grok)
            </h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              OpenAI, DeepSeek, and xAI are orchestrated through one provider layer.
              OpenAI focuses on final synthesis and clear action planning.
              DeepSeek focuses on structured reasoning, calculations, and analysis depth.
              xAI focuses on narrative framing and trend-forward context.
              All three consume deterministic evidence and follow the same safety envelope.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Workflow className="h-5 w-5 text-cyan-400" aria-hidden />
              Orchestration modes
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {ORCHESTRATION_MODES.map((mode) => (
                <div
                  key={mode.title}
                  className="rounded-xl border p-4"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
                >
                  <h3 className="text-sm font-semibold">{mode.title}</h3>
                  <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                    {mode.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Layers3 className="h-5 w-5 text-emerald-400" aria-hidden />
              AI across AllFantasy
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              AI is not a separate product tier. It is a system layer integrated across core
              AllFantasy experiences.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {APP_SURFACES.map((surface) => (
                <Link
                  key={surface.href + surface.title}
                  href={surface.href}
                  className="rounded-xl border p-4 transition-colors hover:opacity-90"
                  style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}
                >
                  <h3 className="text-sm font-semibold">{surface.title}</h3>
                  <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                    {surface.description}
                  </p>
                </Link>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Network className="h-5 w-5 text-amber-400" aria-hidden />
              Reliability and fallback behavior
            </h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              Provider health and fallback routing are monitored continuously. If one provider
              fails or is degraded, orchestration can route to another provider while preserving
              deterministic evidence and safety constraints. Output includes confidence and
              uncertainty notes when data quality is partial.
            </p>
          </section>

          <section className="mt-10">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-rose-400" aria-hidden />
              Safety and trust boundaries
            </h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
              AllFantasy AI is constrained to avoid invented stats, unsupported claims, and
              deterministic conflicts. Risk and uncertainty are surfaced explicitly. This keeps
              recommendations actionable without pretending to have certainty where data is missing.
            </p>
          </section>

          <section className="mt-10 rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--panel)' }}>
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-cyan-400" />
              Explore the AI system live
            </h2>
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              Open the Unified AI Workbench to run tools, compare providers, and inspect confidence-aware outputs.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/ai/tools"
                data-testid="ai-system-try-tools-button"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-black shadow-lg hover:bg-emerald-400 transition-colors"
              >
                <Sparkles className="h-5 w-5 shrink-0" />
                Try AI Tools
                <ArrowRight className="h-4 w-4 shrink-0" />
              </Link>
              <Link
                href="/ai/history"
                data-testid="ai-system-saved-recommendations-button"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-5 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20 transition-colors"
              >
                <BookmarkCheck className="h-5 w-5 shrink-0" />
                Saved AI Results
              </Link>
            </div>
          </section>
        </div>
      </article>

      <footer className="border-t py-6 text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        <div className="mx-auto flex flex-wrap items-center justify-center gap-3 px-4">
          <Link href="/" className="hover:underline">Home</Link>
          <span style={{ color: 'var(--muted2)' }}>·</span>
          <Link href="/app" className="hover:underline">App</Link>
          <span style={{ color: 'var(--muted2)' }}>·</span>
          <Link href="/chimmy" className="hover:underline">Chimmy</Link>
        </div>
      </footer>
    </main>
  )
}

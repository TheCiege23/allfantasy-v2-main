"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  LayoutDashboard,
  Trophy,
  DraftingCompass,
  Bot,
  BarChart3,
  ClipboardList,
  Target,
  MessageCircle,
  Sparkles,
  ArrowRight,
} from "lucide-react"
import type { OnboardingStepId } from "@/lib/onboarding-funnel"

const WALKTHROUGH_CARDS = [
  {
    icon: LayoutDashboard,
    title: "Dashboard",
    description: "Your home base: leagues, matchups, and quick actions.",
  },
  {
    icon: Trophy,
    title: "Leagues",
    description: "Create or join leagues, manage rosters, and track standings.",
  },
  {
    icon: DraftingCompass,
    title: "Draft & tools",
    description: "Mock drafts, war room, trade analyzer, and waiver AI.",
  },
  {
    icon: Bot,
    title: "AI assistant",
    description: "Chimmy helps with trades, waivers, drafts, and strategy.",
  },
]

const AI_FEATURE_CARDS = [
  {
    icon: BarChart3,
    title: "Trade Analyzer",
    description: "AI fairness grades and counter-offers for any trade.",
    href: "/trade-analyzer",
  },
  {
    icon: ClipboardList,
    title: "Waiver AI",
    description: "Pickup priorities and lineup suggestions for your league.",
    href: "/waiver-ai",
  },
  {
    icon: Target,
    title: "AF Legacy Draft",
    description: "Mock drafts and AI pick suggestions in real time.",
    href: "/mock-draft",
  },
  {
    icon: MessageCircle,
    title: "Chimmy Chat",
    description: "Ask anything about your league—drafts, trades, waivers.",
    href: "/chimmy",
  },
]

const STEP_ORDER: OnboardingStepId[] = [
  "welcome",
  "app_walkthrough",
  "sport_selection",
  "tool_suggestions",
  "league_prompt",
]

interface OnboardingFunnelClientProps {
  initialStep: OnboardingStepId
  sportOptions: { value: string; label: string }[]
  preferredSportsInitial: string[]
  redirectOnComplete?: boolean
}

export default function OnboardingFunnelClient({
  initialStep,
  sportOptions,
  preferredSportsInitial,
  redirectOnComplete = true,
}: OnboardingFunnelClientProps) {
  const router = useRouter()
  const [step, setStep] = useState<OnboardingStepId>(initialStep)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedSports, setSelectedSports] = useState<string[]>(preferredSportsInitial)
  const selectedSportsRef = useRef<string[]>(preferredSportsInitial)

  useEffect(() => {
    setStep(initialStep)
  }, [initialStep])

  useEffect(() => {
    selectedSportsRef.current = selectedSports
  }, [selectedSports])

  useEffect(() => {
    if (step === "completed" && redirectOnComplete) {
      router.replace("/dashboard")
      return
    }
  }, [step, router, redirectOnComplete])

  async function recordMilestone(
    milestone: "onboarding_sport_selection" | "onboarding_tool_visit",
    meta?: Record<string, unknown>
  ) {
    try {
      await fetch("/api/onboarding/checklist", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestone, meta }),
      })
    } catch {}
  }

  async function advance(completeFunnel = false) {
    setLoading(true)
    setError("")
    try {
      const body: { step: OnboardingStepId; completeFunnel?: boolean; preferredSports?: string[] } = {
        step,
        ...(completeFunnel && { completeFunnel: true }),
      }
      if (step === "sport_selection") {
        body.preferredSports = selectedSportsRef.current
      }
      const res = await fetch("/api/onboarding/funnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.")
        setLoading(false)
        return
      }
      setStep(data.nextStep ?? "completed")
    } catch {
      setError("Something went wrong. Please try again.")
    }
    setLoading(false)
  }

  function toggleSport(value: string) {
    const current = selectedSportsRef.current
    const next = current.includes(value)
      ? current.filter((s) => s !== value)
      : [...current, value]
    selectedSportsRef.current = next
    setSelectedSports(next)
  }

  const stepIndex = STEP_ORDER.indexOf(step)
  const stepLabel = stepIndex >= 0 ? `Step ${stepIndex + 1} of ${STEP_ORDER.length}` : ""

  if (step === "completed") {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-white/80">
        <p>Taking you to your dashboard…</p>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Welcome */}
      {step === "welcome" && (
        <div data-testid="onboarding-step-welcome" className="space-y-6">
          <h2 className="text-xl font-semibold text-white">Welcome to AllFantasy</h2>
          <p className="text-white/80">
            We&apos;ll walk you through the app, your favorite sports, AI features, and how to find or create a league. Takes about a minute—or skip and explore on your own.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => advance(false)}
              data-testid="onboarding-next-welcome"
              disabled={loading}
              className="min-h-[44px] rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50 touch-manipulation"
            >
              Start walkthrough
            </button>
            <button
              type="button"
              onClick={() => advance(true)}
              data-testid="onboarding-skip-welcome"
              disabled={loading}
              className="min-h-[44px] rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-50 touch-manipulation"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* App walkthrough */}
      {step === "app_walkthrough" && (
        <div data-testid="onboarding-step-app-walkthrough" className="space-y-6">
          <h2 className="text-xl font-semibold text-white">Quick app tour</h2>
          <p className="text-white/80">
            Here&apos;s what you&apos;ll find inside AllFantasy:
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {WALKTHROUGH_CARDS.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-white">{title}</span>
                </div>
                <p className="text-xs text-white/70">{description}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => advance(false)}
              data-testid="onboarding-next-app-walkthrough"
              disabled={loading}
              className="min-h-[44px] rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50 touch-manipulation"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => advance(true)}
              data-testid="onboarding-skip-app-walkthrough"
              disabled={loading}
              className="min-h-[44px] rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-50 touch-manipulation"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Sport selection */}
      {step === "sport_selection" && (
        <div data-testid="onboarding-step-sport-selection" className="space-y-6">
          <h2 className="text-xl font-semibold text-white">Pick your favorite sports</h2>
          <p className="text-white/80">
            We&apos;ll use this to suggest leagues and personalize your experience.
          </p>
          <div className="flex flex-wrap gap-2">
            {sportOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleSport(opt.value)}
                data-testid={`onboarding-sport-option-${opt.value}`}
                className={`min-h-[44px] rounded-lg border px-3 py-2 text-sm touch-manipulation ${
                  selectedSports.includes(opt.value)
                    ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                    : "border-white/20 text-white/80 hover:bg-white/10"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => advance(false)}
              data-testid="onboarding-next-sport-selection"
              disabled={loading}
              className="min-h-[44px] rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50 touch-manipulation"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => advance(true)}
              data-testid="onboarding-skip-sport-selection"
              disabled={loading}
              className="min-h-[44px] rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-50 touch-manipulation"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* AI features */}
      {step === "tool_suggestions" && (
        <div data-testid="onboarding-step-tool-suggestions" className="space-y-6">
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-cyan-400" />
            AI features to try
          </h2>
          <p className="text-white/80">
            Trade grades, waiver priorities, draft help, and Chimmy—your AI assistant. Click any card to try it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {AI_FEATURE_CARDS.map(({ icon: Icon, title, description, href }) => (
              <Link
                key={href}
                href={href}
                data-testid={`onboarding-tool-link-${title.toLowerCase().replace(/\s+/g, "-")}`}
                onClick={async (event) => {
                  event.preventDefault()
                  await recordMilestone("onboarding_tool_visit", {
                    tool: title,
                    href,
                    source: "onboarding_funnel",
                  })
                  router.push(href)
                }}
                className="flex flex-col rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/10 hover:border-cyan-400/30 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="font-medium text-white">{title}</span>
                </div>
                <p className="text-xs text-white/70 mb-3 flex-1">{description}</p>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-cyan-400">
                  Try it <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => advance(false)}
              data-testid="onboarding-next-tool-suggestions"
              disabled={loading}
              className="min-h-[44px] rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50 touch-manipulation"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => advance(true)}
              data-testid="onboarding-skip-tool-suggestions"
              disabled={loading}
              className="min-h-[44px] rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white/90 hover:bg-white/10 disabled:opacity-50 touch-manipulation"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* League suggest */}
      {step === "league_prompt" && (
        <div data-testid="onboarding-step-league-prompt" className="space-y-6">
          <h2 className="text-xl font-semibold text-white">Create or join a league</h2>
          <p className="text-white/80">
            You&apos;re all set. Create your own league, discover leagues we suggest based on your sports, or join one with a code.
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/create-league"
              data-testid="onboarding-league-create-link"
              className="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-600 text-center touch-manipulation"
            >
              Create league
            </Link>
            <Link
              href="/app/discover"
              data-testid="onboarding-league-discover-link"
              className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/50 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20 text-center touch-manipulation"
            >
              <Sparkles className="h-4 w-4" />
              Discover suggested leagues
            </Link>
            <Link
              href="/brackets/leagues/new"
              data-testid="onboarding-league-create-bracket-link"
              className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-white/20 px-4 py-2.5 text-sm font-medium text-white/90 hover:bg-white/10 text-center touch-manipulation"
            >
              Create bracket pool
            </Link>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => advance(true)}
              data-testid="onboarding-skip-league-prompt"
              disabled={loading}
              className="min-h-[44px] rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-white/70 hover:bg-white/10 disabled:opacity-50 touch-manipulation"
            >
              Skip — go to dashboard
            </button>
          </div>
        </div>
      )}

      {stepLabel && (
        <p className="text-xs text-white/50">{stepLabel}</p>
      )}
    </div>
  )
}

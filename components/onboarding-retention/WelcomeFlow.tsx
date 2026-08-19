"use client"

import { useState } from "react"
import Link from "next/link"
import type { OnboardingStepId } from "@/lib/onboarding-funnel"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"

/**
 * PROMPT 149 — WelcomeFlow: first-time user flow (sports, tools, league, AI, referral).
 * Can be used as a full-page welcome or embedded; steps align with onboarding funnel API.
 */
export interface WelcomeFlowProps {
  initialStep?: OnboardingStepId
  preferredSportsInitial?: string[]
  onComplete?: () => void
  onSkip?: () => void
  compact?: boolean
  className?: string
}

const TOOL_LINKS = [
  { label: "Trade analyzer", href: "/legacy?tab=trade" },
  { label: "Mock draft", href: "/legacy?tab=mock-draft" },
  { label: "Brackets", href: "/brackets" },
  { label: "Chimmy AI", href: "/chimmy" },
]

const SPORT_LABELS: Record<string, string> = {
  NFL: "NFL",
  NHL: "NHL",
  NBA: "NBA",
  MLB: "MLB",
  NCAAB: "NCAA Basketball",
  NCAAF: "NCAA Football",
  SOCCER: "Soccer",
}

export function WelcomeFlow({
  initialStep = "welcome",
  preferredSportsInitial = [],
  onComplete,
  onSkip,
  compact = false,
  className = "",
}: WelcomeFlowProps) {
  const [step, setStep] = useState<OnboardingStepId>(initialStep)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [selectedSports, setSelectedSports] = useState<string[]>(preferredSportsInitial)
  const sportOptions = SUPPORTED_SPORTS.map((sport) => ({
    value: sport,
    label: SPORT_LABELS[sport] ?? sport,
  }))

  async function advance(completeFunnel = false) {
    setLoading(true)
    setError("")
    try {
      const body: { step: OnboardingStepId; completeFunnel?: boolean; preferredSports?: string[] } = {
        step,
        ...(completeFunnel && { completeFunnel: true }),
      }
      if (step === "sport_selection" && selectedSports.length > 0) body.preferredSports = selectedSports

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
      const next = (data.nextStep as OnboardingStepId) ?? "completed"
      setStep(next)
      if (next === "completed") onComplete?.()
      if (completeFunnel) onSkip?.()
    } catch {
      setError("Something went wrong. Please try again.")
    }
    setLoading(false)
  }

  function toggleSport(value: string) {
    setSelectedSports((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    )
  }

  const btnClass = "rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50 transition"
  const primaryBtn = "bg-cyan-500 text-white hover:bg-cyan-600"
  const secondaryBtn = "border border-white/20 text-white/90 hover:bg-white/10"

  if (step === "completed") {
    return (
      <div className={`text-center py-6 text-white/80 ${className}`}>
        <p>You’re all set. Head to your dashboard to explore.</p>
        <Link href="/dashboard" className="mt-3 inline-block text-cyan-400 hover:text-cyan-300 text-sm">
          Go to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${compact ? "max-w-md" : "max-w-lg"} ${className}`}>
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {step === "welcome" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Welcome to AllFantasy</h2>
          <p className="text-white/80 text-sm">
            Get started by picking your sports, trying our tools, and joining or creating a league.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => advance(false)} disabled={loading} className={`${btnClass} ${primaryBtn}`}>
              Next
            </button>
            <button type="button" onClick={() => advance(true)} disabled={loading} className={`${btnClass} ${secondaryBtn}`}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step === "sport_selection" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Choose your sports</h2>
          <p className="text-white/80 text-sm">We’ll personalize content and leagues for you.</p>
          <div className="flex flex-wrap gap-2">
            {sportOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleSport(opt.value)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${
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
            <button type="button" onClick={() => advance(false)} disabled={loading} className={`${btnClass} ${primaryBtn}`}>
              Next
            </button>
            <button type="button" onClick={() => advance(true)} disabled={loading} className={`${btnClass} ${secondaryBtn}`}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step === "tool_suggestions" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Try these tools</h2>
          <p className="text-white/80 text-sm">Trade analyzer, mock draft, brackets, and Chimmy AI.</p>
          <ul className="space-y-2">
            {TOOL_LINKS.map((tool) => (
              <li key={tool.href}>
                <Link href={tool.href} className="text-cyan-400 hover:text-cyan-300 underline text-sm">
                  {tool.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => advance(false)} disabled={loading} className={`${btnClass} ${primaryBtn}`}>
              Next
            </button>
            <button type="button" onClick={() => advance(true)} disabled={loading} className={`${btnClass} ${secondaryBtn}`}>
              Skip
            </button>
          </div>
        </div>
      )}

      {step === "league_prompt" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Create or join a league</h2>
          <p className="text-white/80 text-sm">You’re almost done. Create a league, join with a code, or start a bracket pool.</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href="/leagues" className={`${btnClass} ${primaryBtn} text-center`}>
              Create league
            </Link>
            <Link href="/app/discover" className={`${btnClass} ${secondaryBtn} text-center`}>
              Join league
            </Link>
            <Link href="/brackets/leagues/new" className={`${btnClass} ${secondaryBtn} text-center`}>
              Create bracket
            </Link>
          </div>
          <button
            type="button"
            onClick={() => advance(true)}
            disabled={loading}
            className={`${btnClass} ${secondaryBtn}`}
          >
            Skip — go to dashboard
          </button>
        </div>
      )}

      {!compact && (
        <p className="text-xs text-white/50">
          Step {["welcome", "sport_selection", "tool_suggestions", "league_prompt"].indexOf(step) + 1} of 4
        </p>
      )}
    </div>
  )
}

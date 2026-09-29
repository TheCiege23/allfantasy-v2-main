"use client"

import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

interface SignupProgressIndicatorProps {
  /** 3 is never passed — it only ever renders as an upcoming/future node, reached later on the separate /verify/email page. */
  currentStepIndex: 1 | 2
}

const STEPS = [
  { id: 1, labelKey: "signup.progress.step1" },
  { id: 2, labelKey: "signup.progress.step2" },
  { id: 3, labelKey: "signup.progress.step3" },
] as const

export default function SignupProgressIndicator({ currentStepIndex }: SignupProgressIndicatorProps) {
  const { t } = useOptionalLanguage()

  return (
    <div className="mb-10 flex items-start justify-center">
      {STEPS.map((step, index) => (
        <div key={step.id} className="flex items-start">
          <div className="relative flex flex-col items-center">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition-all"
              style={{
                borderColor:
                  currentStepIndex === step.id
                    ? "transparent"
                    : currentStepIndex > step.id
                      ? "color-mix(in srgb, var(--accent-emerald-strong) 60%, transparent)"
                      : "var(--border)",
                background:
                  currentStepIndex === step.id
                    ? "linear-gradient(135deg, var(--accent-cyan), #3b82f6)"
                    : currentStepIndex > step.id
                      ? "color-mix(in srgb, var(--accent-emerald-strong) 14%, transparent)"
                      : "var(--panel)",
                color:
                  currentStepIndex === step.id
                    ? "#fff"
                    : currentStepIndex > step.id
                      ? "var(--accent-emerald-strong)"
                      : "var(--muted)",
              }}
            >
              {currentStepIndex > step.id ? "✓" : step.id}
            </div>
            <span
              className="absolute top-10 w-16 text-center text-[11px] font-semibold uppercase leading-tight tracking-[0.06em] sm:w-20 sm:text-[11px] sm:tracking-[0.1em]"
              style={{ color: currentStepIndex >= step.id ? "var(--muted)" : "var(--muted2)" }}
            >
              {t(step.labelKey)}
            </span>
          </div>
          {index < STEPS.length - 1 && (
            <div
              className="mx-1 mt-4 h-[2px] w-10 rounded-full"
              style={{
                background: currentStepIndex > step.id ? "var(--accent-emerald-strong)" : "var(--border)",
                opacity: currentStepIndex > step.id ? 0.5 : 1,
              }}
            />
          )}
        </div>
      ))}
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Coins, Loader2, Lock, Sparkles } from "lucide-react"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import {
  confirmWorldCupTokenSpend,
  isWorldCupTokenConfirmationResponse,
} from "@/lib/world-cup/worldCupClientTokenConfirm"

type ExplainResult = {
  summary: string
  lines: string[]
  generative: boolean
}

export default function WorldCupExplainBracketCard({
  challengeId,
  entryId,
  hasBracketBrainAi,
  hideTierChip = false,
}: {
  challengeId: string
  entryId: string | null
  hasBracketBrainAi: boolean
  /** When true, suppress the per-card AF Pro/Locked chip — the section-level chip is canonical. */
  hideTierChip?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExplainResult | null>(null)

  async function handleGenerate(confirmTokenSpend = false) {
    if (!entryId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/brackets/world-cup/${challengeId}/entries/${entryId}/explain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmTokenSpend }),
        }
      )
      const body = await res.json().catch(() => ({}))
      if (isWorldCupTokenConfirmationResponse(res.status, body)) {
        if (confirmWorldCupTokenSpend(body)) {
          setLoading(false)
          await handleGenerate(true)
        } else {
          setError("Token spend was not confirmed.")
        }
        return
      }
      if (!res.ok) {
        setError(
          typeof body?.error === "string"
            ? body.error
            : t("wc.explain.error.generic")
        )
        return
      }
      setResult({
        summary: String(body.summary ?? ""),
        lines: Array.isArray(body.lines) ? body.lines.map(String) : [],
        generative: Boolean(body.generative),
      })
    } catch {
      setError(t("wc.explain.error.network"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      data-testid="world-cup-explain-bracket"
      className="rounded-xl border border-cyan-300/20 bg-gradient-to-b from-cyan-300/[0.06] to-white/[0.03] p-4 backdrop-blur"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10">
            <Sparkles className="h-4 w-4 text-white/85" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/40">
              {t("wc.explain.eyebrow")}
            </p>
            <h3 className="text-base font-black text-white sm:text-lg">
              {t("wc.explain.title")}
            </h3>
            <p className="mt-0.5 text-xs text-white/55">
              {t("wc.explain.subtitle")}
            </p>
          </div>
        </div>
        {hideTierChip ? null : (
          <span
            data-testid="world-cup-explain-bracket-tier"
            className={
              hasBracketBrainAi
                ? "shrink-0 rounded-full border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/90"
                : "shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/65"
            }
          >
            {hasBracketBrainAi ? t("wc.explain.tierPro") : t("wc.explain.tierLocked")}
          </span>
        )}
      </div>

      {!hasBracketBrainAi ? (
        <div
          data-testid="world-cup-explain-bracket-locked"
          className="space-y-2.5"
        >
          <div className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs leading-5 text-white/65">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/45" aria-hidden />
            <span>
              {t("wc.explain.locked")}
            </span>
          </div>
          <Link
            href="/upgrade?plan=af_pro"
            data-testid="world-cup-explain-bracket-upgrade-link"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/30 bg-cyan-300/[0.08] px-3 py-2 text-xs font-bold text-white/90 transition-colors hover:bg-cyan-300/[0.14] hover:text-white"
          >
            <Sparkles className="h-3 w-3" aria-hidden />
            {t("wc.explain.upgradeCta")}
          </Link>
        </div>
      ) : null}

      {!result ? (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={loading || !entryId}
            data-testid="world-cup-explain-bracket-generate"
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-black transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100 sm:w-auto"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {loading
              ? t("wc.explain.generating")
              : entryId
                ? t("wc.explain.generate")
                : t("wc.explain.selectFirst")}
          </button>
          {!loading && entryId && (
            <span className="inline-flex items-center gap-1 text-[11px] text-white/40 sm:ml-1">
              <Coins className="h-3 w-3" />
              Uses AI tokens
            </span>
          )}
        </div>
      ) : null}

      {error ? (
        <p
          data-testid="world-cup-explain-bracket-error"
          className="mt-2 rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-white/85"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <div
          data-testid="world-cup-explain-bracket-result"
          className="mt-2 space-y-2"
        >
          <p
            data-testid="world-cup-explain-bracket-summary"
            className="rounded-lg border border-cyan-300/30 bg-cyan-300/[0.08] px-3 py-2 text-sm font-bold leading-5 text-white"
          >
            {result.summary}
          </p>
          <div className="space-y-1.5">
            {result.lines.slice(1).map((line, idx) => (
              <p
                key={idx}
                data-testid={`world-cup-explain-bracket-line-${idx}`}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs leading-5 text-white/80"
              >
                {line}
              </p>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={loading}
              data-testid="world-cup-explain-bracket-regenerate"
              className="rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-[11px] font-bold text-white/70 hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? t("wc.explain.regenerating") : t("wc.explain.regenerate")}
            </button>
            {!result.generative ? (
              <span
                data-testid="world-cup-explain-bracket-fallback-badge"
                className="rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-white/80"
              >
                {t("wc.explain.fallbackBadge")}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-[11px] text-white/40">
        {t("wc.explain.privacyNote")}
      </p>
    </section>
  )
}

"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Copy, Lock, Share2, Sparkles } from "lucide-react"
import {
  buildWorldCupAiBracketShareCard,
  type BuildWorldCupAiShareCardInput,
  type WorldCupAiShareCardResult,
} from "@/lib/world-cup/worldCupAiShareCard"
import {
  buildWorldCupBracketUniquenessInsights,
  type UniquenessInsight,
} from "@/lib/world-cup/worldCupUniquenessInsights"
import type { WorldCupRound } from "@/lib/world-cup/types"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

type UniquenessApiResponse = {
  ok: boolean
  finalizedEntryCount?: number
  distributions?: Record<string, Array<{ teamName: string; count: number }>>
  ownChampionTeamName?: string | null
  ownPicksByRound?: Partial<Record<WorldCupRound, string[]>>
}

type Props = Omit<BuildWorldCupAiShareCardInput, "topUniquenessInsight"> & {
  challengeId: string
  entryId: string | null
  /** Pre-computed top uniqueness insight (skips the fetch when provided). */
  topUniquenessInsight?: UniquenessInsight | null
  /** When true, suppress the per-card AF Pro/Basic preview chip — the section-level chip is canonical. */
  hideTierChip?: boolean
}

export default function WorldCupAiBracketShareCard({
  challengeId,
  entryId,
  topUniquenessInsight: precomputedUniqueness,
  hideTierChip = false,
  ...rest
}: Props) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])
  const [copied, setCopied] = useState(false)
  const [fetchedUniqueness, setFetchedUniqueness] = useState<UniquenessInsight | null>(null)

  // Lazy-fetch uniqueness data only when Pro user, entry selected, and not precomputed.
  useEffect(() => {
    if (!rest.hasBracketBrainAi || !entryId || precomputedUniqueness) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/brackets/world-cup/${challengeId}/entries/${entryId}/explain?action=uniqueness`
        )
        if (!res.ok || cancelled) return
        const body = (await res.json()) as UniquenessApiResponse
        if (cancelled) return
        const result = buildWorldCupBracketUniquenessInsights({
          ownChampionTeamName: body.ownChampionTeamName ?? null,
          ownPicksByRound: body.ownPicksByRound ?? {},
          poolDistributions: body.distributions ?? {},
          finalizedEntryCount: body.finalizedEntryCount ?? 0,
          hasBracketBrainAi: true,
        })
        if (result.status === "ready" && result.insights.length > 0) {
          setFetchedUniqueness(result.insights[0])
        }
      } catch {
        // Silent — share card just omits uniqueness line on fetch failure.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [challengeId, entryId, rest.hasBracketBrainAi, precomputedUniqueness])

  const result: WorldCupAiShareCardResult = useMemo(
    () =>
      buildWorldCupAiBracketShareCard({
        ...rest,
        topUniquenessInsight: precomputedUniqueness ?? fetchedUniqueness ?? null,
      }),
    [rest, precomputedUniqueness, fetchedUniqueness]
  )

  async function copyShareText() {
    if (typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(result.shareText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  async function nativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: result.title, text: result.shareText })
        return
      } catch {
        // Fall back to clipboard when native share is cancelled or unsupported.
      }
    }
    await copyShareText()
  }

  return (
    <section
      data-testid="world-cup-ai-share-card"
      className="rounded-2xl border border-cyan-300/20 bg-gradient-to-br from-cyan-300/[0.09] to-white/[0.035] p-4 backdrop-blur"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/30 bg-cyan-300/10">
            <Sparkles className="h-4 w-4 text-white/85" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/50">
              {t("wc.aiShareCard.eyebrow")}
            </p>
            <h3 className="text-base font-black text-white sm:text-lg">{result.title}</h3>
            <p className="mt-0.5 text-xs leading-5 text-white/50">
              {t("wc.aiShareCard.subtitle")}
            </p>
          </div>
        </div>
        {hideTierChip ? null : (
          <span
            data-testid="world-cup-ai-share-card-tier"
            className={
              rest.hasBracketBrainAi
                ? "shrink-0 rounded-full border border-cyan-300/30 bg-cyan-300/[0.08] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/90"
                : "shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white/65"
            }
          >
            {rest.hasBracketBrainAi ? t("wc.aiShareCard.tierPro") : t("wc.aiShareCard.tierPreview")}
          </span>
        )}
      </div>

      {result.status === "no_entry" ? (
        <p
          data-testid="world-cup-ai-share-card-empty"
          className="rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-xs text-white/65"
        >
          {t("wc.aiShareCard.emptyNoEntry")}
        </p>
      ) : (
        <>
          <div
            data-testid="world-cup-ai-share-card-preview"
            className="whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-5 text-white/80"
          >
            {result.shareText}
          </div>

          {result.lockedLines && result.lockedLines.length > 0 ? (
            <div className="mt-3 space-y-1">
              {result.lockedLines.map((line, idx) => (
                <p
                  key={idx}
                  data-testid={`world-cup-ai-share-card-locked-${idx}`}
                  className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-[11px] leading-5 text-white/55"
                >
                  <Lock className="mt-0.5 h-3 w-3 shrink-0 text-white/40" aria-hidden />
                  {line}
                </p>
              ))}
            </div>
          ) : null}

          <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onClick={copyShareText}
              data-testid="world-cup-ai-share-card-copy"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-black transition-transform hover:scale-[1.01] active:scale-[0.99] touch-manipulation sm:w-auto"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t("wc.aiShareCard.copyShareDone") : t("wc.aiShareCard.copyShare")}
            </button>
            <button
              type="button"
              onClick={nativeShare}
              data-testid="world-cup-ai-share-card-share"
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2.5 text-sm font-bold text-white/75 touch-manipulation sm:w-auto"
            >
              <Share2 className="h-4 w-4" />
              {t("wc.aiShareCard.share")}
            </button>
          </div>
        </>
      )}

      <p className="mt-3 text-[11px] text-white/40">
        {t("wc.aiShareCard.privacyNote")}
      </p>
    </section>
  )
}

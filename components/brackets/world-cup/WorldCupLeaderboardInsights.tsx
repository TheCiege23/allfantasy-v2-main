"use client"

import { useMemo } from "react"
import type { WorldCupLeaderboardRow } from "@/lib/world-cup/types"
import { calculateWorldCupLeaderboardAiInsights } from "@/lib/world-cup/worldCupAiSubscriptionInsights"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"

export default function WorldCupLeaderboardInsights({
  leaderboard,
  aiInsightsUnlocked = false,
}: {
  leaderboard: WorldCupLeaderboardRow[]
  aiInsightsUnlocked?: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  if (!leaderboard.length) {
    return (
      <div className="mx-4 mt-4 space-y-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/50">
          {t("wc.insights.empty")}
        </div>
        <LeaderboardAiSummaryCard
          leaderboard={[]}
          aiInsightsUnlocked={aiInsightsUnlocked}
        />
      </div>
    )
  }

  const sorted = [...leaderboard].sort((a, b) => a.rank - b.rank || b.totalScore - a.totalScore)
  const leader = sorted[0]
  const runnerUp = sorted[1] ?? null
  const scoreGap = runnerUp ? Math.max(0, leader.totalScore - runnerUp.totalScore) : 0
  const aliveChampionCount = sorted.filter((r) => r.championStillAlive).length
  const mostCorrect = sorted.reduce((best, row) => (row.correctPicks > best.correctPicks ? row : best), sorted[0])

  let widestGap = 0
  for (let i = 1; i < sorted.length; i++) {
    widestGap = Math.max(widestGap, sorted[i - 1].totalScore - sorted[i].totalScore)
  }

  // Entry names (`leader.entryName`, `runnerUp.entryName`) are user-supplied
  // and must NOT be translated — keep raw.
  const closestRace = runnerUp && scoreGap <= 5 ? `${leader.entryName} vs ${runnerUp.entryName}` : null

  return (
    <div className="mx-4 mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/45">
        {t("wc.insights.title")}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
        <InsightCard label={t("wc.insights.currentLeader")} value={leader.entryName} />
        <InsightCard
          label={t("wc.insights.largestGap")}
          value={t("wc.insights.gapPts", { n: widestGap })}
        />
        <InsightCard label={t("wc.insights.entries")} value={String(sorted.length)} />
        <InsightCard
          label={t("wc.insights.championsAlive")}
          value={String(aliveChampionCount)}
        />
        <InsightCard
          label={t("wc.insights.mostCorrect")}
          value={t("wc.insights.mostCorrectValue", {
            name: mostCorrect.entryName,
            count: mostCorrect.correctPicks,
          })}
        />
        <InsightCard
          label={t("wc.insights.closestRace")}
          value={closestRace ?? t("wc.insights.notClose")}
        />
      </div>
      <LeaderboardAiSummaryCard leaderboard={sorted} aiInsightsUnlocked={aiInsightsUnlocked} />
    </div>
  )
}

function LeaderboardAiSummaryCard({
  leaderboard,
  aiInsightsUnlocked,
}: {
  leaderboard: WorldCupLeaderboardRow[]
  aiInsightsUnlocked: boolean
}) {
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const championCounts = new Map<string, number>()
  for (const row of leaderboard) {
    const champion = row.championPickName?.trim()
    if (champion) championCounts.set(champion, (championCounts.get(champion) ?? 0) + 1)
  }
  // Champion / team names are raw data — never translated.
  const commonChampion =
    [...championCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    t("wc.insights.aiNotAvailable")
  const leader = leaderboard[0] ?? null
  const aiInsights = calculateWorldCupLeaderboardAiInsights(leaderboard)
  const leaderAiInsight = aiInsights.find((insight) => insight.entryId === leader?.entryId) ?? null
  const runnerUp = leaderboard[1] ?? null
  const closeRace = leader && runnerUp && Math.abs(leader.totalScore - runnerUp.totalScore) <= 5

  const countLine =
    leaderboard.length === 1
      ? t("wc.insights.aiSummaryCountOne", { count: leaderboard.length })
      : t("wc.insights.aiSummaryCountOther", { count: leaderboard.length })

  return (
    <details data-testid="world-cup-leaderboard-ai-summary" className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3 text-xs text-white/85">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-black">
        <span>{t("wc.insights.aiSummaryTitle")}</span>
        <span className="rounded-full border border-cyan-200/25 px-2 py-0.5 text-[11px] uppercase tracking-wide">
          {aiInsightsUnlocked
            ? t("wc.insights.aiBadgeUnlocked")
            : t("wc.insights.aiBadgeLocked")}
        </span>
      </summary>
      {aiInsightsUnlocked ? (
        <div className="mt-3 space-y-2 leading-5 text-white/75">
          <p>
            <span className="font-black text-white">{t("wc.insights.aiSummaryLabel")}</span>{" "}
            {countLine}
          </p>
          <p>
            <span className="font-black text-white">{t("wc.insights.aiCommonChampionLabel")}</span>{" "}
            {commonChampion}.
          </p>
          <p>
            <span className="font-black text-white">{t("wc.insights.aiRaceLabel")}</span>{" "}
            {closeRace
              ? t("wc.insights.aiRaceClose")
              : t("wc.insights.aiRaceNotClose")}
          </p>
          {leaderAiInsight && leader ? (
            <p>
              <span className="font-black text-white">{t("wc.insights.aiWinReadLabel")}</span>{" "}
              {t("wc.insights.aiWinReadBody", {
                name: leader.entryName,
                pct: leaderAiInsight.aiWinProbability,
                health: leaderAiInsight.bracketHealth.toLowerCase(),
              })}
            </p>
          ) : null}
          <p className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-white/55">
            {t("wc.insights.aiPrivacyNote")}
          </p>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[11px] leading-5 text-white/60" hidden>
          {t("wc.insights.aiUpgradeNote")}
        </p>
      )}
    </details>
  )
}

function InsightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-2">
      <div className="text-[11px] text-white/40">{label}</div>
      <div className="mt-1 font-bold text-white/85">{value}</div>
    </div>
  )
}

"use client"

import { Send, TrendingUp, Shield, Flame, Trophy } from "lucide-react"
import type {
  InsightCard,
  RootingGuideCard,
  PoolSwingAlertCard,
  ChampionPickRiskCard,
  CommissionerRecapCard,
} from "@/lib/world-cup/worldCupInsightCards"

// ─── Public types re-exported for Panel use ──────────────────────────────────
export type { InsightCard }

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

function CardShell({
  icon,
  title,
  badge,
  children,
  onPostToChat,
  postLabel = "Post to chat",
  className = "",
}: {
  icon: React.ReactNode
  title: string
  badge?: string
  children: React.ReactNode
  onPostToChat?: () => void
  postLabel?: string
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.035] overflow-hidden ${className}`}
    >
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <span className="text-white/70">{icon}</span>
        <span className="text-[13px] font-black text-white">{title}</span>
        {badge && (
          <span className="ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white/55">
            {badge}
          </span>
        )}
      </div>

      {/* body */}
      <div className="space-y-4 p-4">{children}</div>

      {/* footer */}
      {onPostToChat && (
        <div className="border-t border-white/[0.07] px-4 py-3">
          <button
            type="button"
            onClick={onPostToChat}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-[11px] font-bold text-white/85 transition-colors hover:bg-cyan-400/15"
          >
            <Send className="h-3.5 w-3.5" />
            {postLabel}
          </button>
        </div>
      )}
    </div>
  )
}

function DataRow({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-white/50">{label}</span>
      <span
        className={`text-right text-[13px] font-bold ${
          accent ? "text-cyan-300" : "text-white/90"
        }`}
      >
        {value}
      </span>
    </div>
  )
}

function NarrativePill({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-white/[0.07] bg-black/25 px-3 py-2.5 text-[12px] italic leading-relaxed text-white/65">
      {text}
    </p>
  )
}

function ChaosBar({ rating }: { rating: number }) {
  const pct = Math.round((rating / 10) * 100)
  const color =
    rating >= 8 ? "bg-rose-400" : rating >= 5 ? "bg-amber-400" : "bg-emerald-400"
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] font-black ${color.replace("bg-", "text-")}`}>
        {rating}/10
      </span>
    </div>
  )
}

function PickSplitBar({
  favoredTeam,
  underdogTeam,
  favoredCount,
  underdogCount,
}: {
  favoredTeam: string
  underdogTeam: string
  favoredCount: number
  underdogCount: number
}) {
  const total = favoredCount + underdogCount
  const pct = total > 0 ? Math.round((favoredCount / total) * 100) : 50
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] text-white/60">
        <span className="font-semibold text-white/85">{favoredTeam}</span>
        <span className="font-semibold text-white/85">{underdogTeam}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-cyan-400"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-white/50">
        <span>{favoredCount} {favoredCount === 1 ? "entry" : "entries"}</span>
        <span>{underdogCount} {underdogCount === 1 ? "entry" : "entries"}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual card components
// ─────────────────────────────────────────────────────────────────────────────

function RootingGuideCardView({
  card,
  onPostToChat,
}: {
  card: RootingGuideCard
  onPostToChat?: (text: string) => void
}) {
  const handlePost = card.aiNarrative && onPostToChat
    ? () => onPostToChat(card.aiNarrative!)
    : undefined

  return (
    <CardShell
      icon={<TrendingUp className="h-4 w-4" />}
      title="Rooting Guide"
      badge={`Rank #${card.rank}`}
      onPostToChat={handlePost}
    >
      {/* Hero stat */}
      <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-center">
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {card.entryName} needs
        </p>
        <p className="mt-1 text-[22px] font-black leading-none text-white">
          {card.rootFor}
        </p>
        <p className="mt-0.5 text-[11px] text-white/55">
          to beat {card.threatTeam} · {card.roundLabel}
          {card.kickoffEt ? ` · ${card.kickoffEt}` : ""}
        </p>
      </div>

      {/* Deterministic numbers */}
      <div className="space-y-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
        <DataRow
          label="Points at risk if threat wins"
          value={`−${card.pointsAtRisk} pts`}
          accent
        />
        <DataRow
          label="Higher-ranked entries backing threat"
          value={card.usersAboveWithThreat.length}
        />
        <DataRow label="Best outcome" value={card.bestOutcomeLabel} />
        {card.usersAboveWithThreat.length > 0 && (
          <div className="pt-1">
            <p className="text-[11px] text-white/35">
              Rivals: {card.usersAboveWithThreat.join(", ")}
            </p>
          </div>
        )}
      </div>

      {/* Score gap */}
      <DataRow
        label={`${card.entryName}'s score`}
        value={`${card.currentScore} pts (leader: ${card.leaderScore})`}
      />

      {/* AI narrative */}
      {card.aiNarrative && <NarrativePill text={card.aiNarrative} />}
    </CardShell>
  )
}

function PoolSwingAlertCardView({
  card,
  onPostToChat,
}: {
  card: PoolSwingAlertCard
  onPostToChat?: (text: string) => void
}) {
  const handlePost = card.aiNarrative && onPostToChat
    ? () => onPostToChat(card.aiNarrative!)
    : undefined

  return (
    <CardShell
      icon={<Flame className="h-4 w-4" />}
      title="Pool Swing Alert"
      badge={card.roundLabel}
      onPostToChat={handlePost}
    >
      {/* Match header */}
      <div className="text-center">
        <p className="text-[18px] font-black text-white">
          {card.homeTeam} vs {card.awayTeam}
        </p>
        {card.kickoffEt && (
          <p className="mt-0.5 text-[11px] text-white/45">{card.kickoffEt}</p>
        )}
      </div>

      {/* Pick split bar */}
      <PickSplitBar
        favoredTeam={card.favoredTeam}
        underdogTeam={card.underdogTeam}
        favoredCount={card.favoredCount}
        underdogCount={card.underdogCount}
      />

      {/* Key numbers */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">
            Points at risk
          </p>
          <p className="mt-1 text-[20px] font-black text-rose-300">
            {card.maxPointsAtRisk}
          </p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">
            Chaos rating
          </p>
          <div className="mt-1">
            <ChaosBar rating={card.chaosRating} />
          </div>
        </div>
      </div>

      {/* Impacted names */}
      {card.highImpactDisplayNames.length > 0 && (
        <DataRow
          label="Highest-impact users"
          value={card.highImpactDisplayNames.join(", ")}
        />
      )}

      {/* AI narrative */}
      {card.aiNarrative && <NarrativePill text={card.aiNarrative} />}
    </CardShell>
  )
}

function ChampionPickRiskCardView({
  card,
  onPostToChat,
}: {
  card: ChampionPickRiskCard
  onPostToChat?: (text: string) => void
}) {
  const handlePost = card.aiNarrative && onPostToChat
    ? () => onPostToChat(card.aiNarrative!)
    : undefined

  const diffColor =
    card.differentiation === "low"
      ? "text-amber-300 border-amber-400/30 bg-amber-400/[0.06]"
      : card.differentiation === "medium"
        ? "text-cyan-300 border-cyan-400/30 bg-cyan-400/[0.06]"
        : "text-emerald-300 border-emerald-400/30 bg-emerald-400/[0.06]"

  const diffLabel =
    card.differentiation === "low"
      ? "Low differentiation"
      : card.differentiation === "medium"
        ? "Medium differentiation"
        : "High differentiation"

  // Popularity bar
  const pct = card.poolPickPercent

  return (
    <CardShell
      icon={<Shield className="h-4 w-4" />}
      title="Champion Pick Risk"
      badge={card.entryName ?? "Pool-wide"}
      onPostToChat={handlePost}
    >
      {/* Champion hero */}
      <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.06] px-4 py-3 text-center">
        <p className="text-[11px] font-bold uppercase tracking-widest text-white/40">
          {card.entryName ? `${card.entryName}'s champion` : "Top champion pick"}
        </p>
        <p className="mt-1 text-[22px] font-black text-white">{card.topChampion}</p>
      </div>

      {/* Pool popularity */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-white/50">Pool popularity</span>
          <span className="font-black text-white">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-violet-400"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-right text-[11px] text-white/40">
          {card.topChampionCount} of {card.totalEntries} {card.totalEntries === 1 ? "entry" : "entries"}
        </p>
      </div>

      {/* Differentiation badge */}
      <div
        className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-bold ${diffColor}`}
      >
        {diffLabel}
      </div>

      <DataRow label="Upside" value={card.upsideLabel} />

      {card.alternativeLeverage.length > 0 && (
        <DataRow
          label="Alternative leverage"
          value={card.alternativeLeverage.join(" / ")}
        />
      )}

      {card.aiNarrative && <NarrativePill text={card.aiNarrative} />}
    </CardShell>
  )
}

function CommissionerRecapCardView({
  card,
  onPostToChat,
}: {
  card: CommissionerRecapCard
  onPostToChat?: (text: string) => void
}) {
  const handlePost = card.suggestedPost && onPostToChat
    ? () => onPostToChat(card.suggestedPost!)
    : undefined

  return (
    <CardShell
      icon={<Trophy className="h-4 w-4" />}
      title="Commissioner Recap"
      badge={card.periodLabel}
      onPostToChat={handlePost}
      postLabel="Post suggested message"
    >
      {/* Biggest winner */}
      {card.biggestWinner && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5">
          <span className="text-[20px]">🏆</span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">
              Biggest winner this round
            </p>
            <p className="text-[13px] font-black text-white">
              {card.biggestWinner.displayName}
            </p>
            <p className="text-[11px] text-white/55">
              {card.biggestWinner.entryName} · +{card.biggestWinner.roundScore} pts · rank #{card.biggestWinner.rank}
            </p>
          </div>
        </div>
      )}

      {/* Biggest loser */}
      {card.biggestLoser && (
        <div className="flex items-center gap-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5">
          <span className="text-[20px]">📉</span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/40">
              Struggled most
            </p>
            <p className="text-[13px] font-black text-white">
              {card.biggestLoser.displayName}
            </p>
            <p className="text-[11px] text-white/55">
              {card.biggestLoser.entryName} · {card.biggestLoser.roundScore} pts this round · rank #{card.biggestLoser.rank}
            </p>
          </div>
        </div>
      )}

      {/* Best upcoming match */}
      {card.bestUpcomingMatch && (
        <div className="space-y-1.5 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">
            Best upcoming match
          </p>
          <p className="text-[14px] font-black text-white">
            {card.bestUpcomingMatch.homeTeam} vs {card.bestUpcomingMatch.awayTeam}
          </p>
          <p className="text-[11px] text-white/50">
            {card.bestUpcomingMatch.roundLabel}
            {card.bestUpcomingMatch.kickoffEt ? ` · ${card.bestUpcomingMatch.kickoffEt}` : ""}
          </p>
          <ChaosBar rating={card.bestUpcomingMatch.chaosRating} />
        </div>
      )}

      {/* Leaderboard summary */}
      <div className="grid grid-cols-2 gap-2">
        <DataRow label="Leader" value={card.leaderName ?? "—"} />
        <DataRow label="Leader score" value={`${card.leaderScore} pts`} accent />
        <DataRow label="Total entries" value={card.totalEntries} />
      </div>

      {/* AI suggested post */}
      {card.suggestedPost && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">
            Suggested post to group chat
          </p>
          <NarrativePill text={card.suggestedPost} />
        </div>
      )}
    </CardShell>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher — renders the correct card for any InsightCard kind
// ─────────────────────────────────────────────────────────────────────────────

export function InsightCardView({
  card,
  onPostToChat,
}: {
  card: InsightCard
  /** Called with the text that should be posted to chat. */
  onPostToChat?: (text: string) => void
}) {
  if (card.kind === "rooting_guide") {
    return <RootingGuideCardView card={card} onPostToChat={onPostToChat} />
  }
  if (card.kind === "pool_swing") {
    return <PoolSwingAlertCardView card={card} onPostToChat={onPostToChat} />
  }
  if (card.kind === "champion_risk") {
    return <ChampionPickRiskCardView card={card} onPostToChat={onPostToChat} />
  }
  if (card.kind === "commissioner_recap") {
    return <CommissionerRecapCardView card={card} onPostToChat={onPostToChat} />
  }
  return null
}

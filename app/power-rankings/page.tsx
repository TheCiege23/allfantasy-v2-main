"use client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { ManagerRoleBadge } from "@/components/ManagerRoleBadge";
import {
  DEFAULT_SPORT,
  normalizeToSupportedSport,
  type SupportedSport,
} from "@/lib/sport-scope";
import { useLanguage } from "@/components/i18n/LanguageProviderClient";

type LeagueFormat = "redraft" | "dynasty" | "keeper";
type RankingView = "power" | "dynasty" | "composite";
type Trend = "up" | "down" | "neutral";
type JobKind = "refresh" | "psychology" | "roadmap";

interface UserLeague {
  id: string;
  name: string;
  platform: string;
  sport: SupportedSport;
  format: LeagueFormat;
  scoring: string;
  teamCount: number;
  season: string;
  avatarUrl: string | null;
  synced: boolean;
  sleeperLeagueId: string | null;
}

interface RawDriver {
  id: string;
  polarity: "UP" | "DOWN" | "NEUTRAL";
  impact: number;
  evidence: Record<string, unknown>;
}

interface RawAction {
  id: string;
  title: string;
  why: string;
  expectedImpact: "LOW" | "MEDIUM" | "HIGH";
  cta: { label: string; href: string };
}

interface RawRankExplanation {
  confidence: {
    score: number;
    rating: "HIGH" | "MEDIUM" | "LEARNING";
    drivers: RawDriver[];
  };
  drivers: RawDriver[];
  nextActions: RawAction[];
  valid: boolean;
}

interface RawForwardOdds {
  playoffPct: number;
  top3Pct: number;
  titlePct: number;
  simCount: number;
}

interface RawConfidenceBadge {
  tier: "GOLD" | "SILVER" | "BRONZE";
  label: string;
  tooltip: string;
}

interface RawRankChangeDriver {
  id: string;
  label: string;
  polarity: "UP" | "DOWN" | "NEUTRAL";
  value: number;
  prevValue: number | null;
  delta: number | null;
  unit: string;
}

interface RawMotivationalFrame {
  headline: string;
  subtext: string;
  suggestedAction: string;
  tone: "encouraging" | "cautionary" | "neutral" | "celebratory";
  trigger: string;
}

interface RawTeam {
  rosterId: number;
  ownerId: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  role?: string | null;
  isOrphan?: boolean;
  winScore: number;
  powerScore: number;
  luckScore: number;
  marketValueScore: number;
  managerSkillScore: number;
  composite: number;
  rank: number;
  prevRank: number | null;
  rankDelta: number | null;
  record: { wins: number; losses: number; ties: number };
  pointsFor: number;
  pointsAgainst: number;
  expectedWins: number;
  streak: number;
  luckDelta: number;
  shouldBeRecord: { wins: number; losses: number };
  bounceBackIndex: number;
  motivationalFrame: RawMotivationalFrame;
  starterValue: number;
  benchValue: number;
  totalRosterValue: number;
  pickValue: number;
  positionValues: Record<string, { starter: number; bench: number; total: number }>;
  rosterExposure: Record<string, number>;
  marketAdj: number;
  phase: string;
  explanation: RawRankExplanation;
  rankChangeDrivers: RawRankChangeDriver[];
  forwardOdds: RawForwardOdds;
  confidenceBadge: RawConfidenceBadge;
  rankSparkline: number[];
}

interface RankingsResponse {
  leagueId: string;
  leagueName: string;
  season: string;
  week: number;
  phase: string;
  isDynasty: boolean;
  isSuperFlex: boolean;
  computedAt: number;
  teams: RawTeam[];
  marketInsights?: Array<{
    position: string;
    premiumPct: number;
    sample: number;
    label: string;
  }>;
}

interface RankExplanationView {
  confidence: "Good" | "Fair" | "Low";
  rankLabel: string;
  tooEarly: boolean;
  win: number;
  pwr: number;
  lck: number;
  mkt: number;
  mgr: number;
  whyChanged: Array<{ label: string; direction: "up" | "down"; value: string }>;
}

interface ForwardOddsView {
  playoffs: number;
  top3: number;
  title: number;
  simCount: number;
}

interface LuckMeterView {
  status: "Lucky" | "Neutral" | "Unlucky";
  position: number;
  actualRecord: string;
  shouldBeRecord: string;
  luckWins: number;
  insight: string;
}

interface KeyDriverView {
  label: string;
  direction: "positive" | "negative";
  weight: number;
  detail: string;
}

interface WinWindowView {
  label: string;
  detail: string;
  confidence: string;
}

interface PositionValuesView {
  QB: number;
  RB: number;
  WR: number;
  TE: number;
  starterValue: number;
  benchDepth: number;
}

interface NextStepView {
  label: string;
  impact: "LOW" | "MEDIUM" | "HIGH";
  detail: string;
}

interface ManagerPsychology {
  archetype: string;
  emoji: string;
  summary: string;
  traits: Array<{ trait: string; score: number; description: string }>;
  tendencies: string[];
  blindSpot: string;
  negotiationStyle: string;
  riskProfile: "LOW" | "MEDIUM" | "HIGH";
  decisionSpeed: "IMPULSIVE" | "DELIBERATE" | "REACTIVE";
}

interface DynastyRoadmap {
  horizon: string;
  currentPhase: string;
  overallStrategy: string;
  yearPlans: Array<{
    year: number;
    label: string;
    priorities: string[];
    targetPositions: string[];
    keyMoves: string[];
  }>;
  riskFactors: string[];
  confidence: string;
}

interface TeamRanking {
  rank: number;
  rosterId: number;
  teamName: string;
  managerName: string;
  role: string;
  isOrphan: boolean;
  record: string;
  score: number;
  winScore: number;
  powerScore: number;
  mvScore: number;
  trend: Trend;
  strength: string;
  risk: string;
  phase: string;
  avatar: string | null;
  raw: RawTeam;
  detailLoaded: boolean;
  rankExplanation?: RankExplanationView;
  forwardOdds?: ForwardOddsView;
  luckMeter?: LuckMeterView;
  keyDrivers?: KeyDriverView[];
  winWindow?: WinWindowView;
  positionValues?: PositionValuesView;
  nextSteps?: NextStepView[];
  insight?: string;
  psychology?: ManagerPsychology;
  dynastyRoadmap?: DynastyRoadmap;
}

interface ActiveJob {
  jobId: string;
  kind: JobKind;
  rosterId?: number;
  progress: number;
  status: string;
}

const PLATFORM_LABELS: Record<
  string,
  { emoji: string; label: string; color: string }
> = {
  sleeper: { emoji: "🌙", label: "Sleeper", color: "#818cf8" },
  yahoo: { emoji: "🟣", label: "Yahoo", color: "#7c3aed" },
  mfl: { emoji: "🏆", label: "MFL", color: "#fbbf24" },
  fantrax: { emoji: "📊", label: "Fantrax", color: "#34d399" },
  espn: { emoji: "🔴", label: "ESPN", color: "#f97316" },
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function phaseTranslationKey(phase: string): string {
  switch (phase) {
    case "Contender":
      return "powerRankingsPage.phase.contender";
    case "Rebuilding":
      return "powerRankingsPage.phase.rebuilding";
    case "Mid-Pack":
      return "powerRankingsPage.phase.midPack";
    default:
      return "powerRankingsPage.phase.flexible";
  }
}

function luckStatusTranslationKey(status: string): string {
  const s = status.toLowerCase();
  if (s === "lucky") return "powerRankingsPage.luck.status.lucky";
  if (s === "unlucky") return "powerRankingsPage.luck.status.unlucky";
  return "powerRankingsPage.luck.status.neutral";
}

function winWindowLabelKey(label: string): string {
  if (label === "Win Now") return "powerRankingsPage.winWindow.winNow";
  if (label === "Rebuild") return "powerRankingsPage.winWindow.rebuild";
  return "powerRankingsPage.winWindow.flexible";
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberFromUnknown(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function inferLeagueFormat(raw: Record<string, unknown>): LeagueFormat {
  const format = stringFromUnknown(raw.format)?.toLowerCase();
  const variant = stringFromUnknown(raw.league_variant)?.toLowerCase();
  if (format === "redraft" || format === "dynasty" || format === "keeper") {
    return format;
  }
  if (raw.isDynasty === true) return "dynasty";
  if (variant?.includes("keeper")) return "keeper";
  return "redraft";
}

function getTargetLeagueId(league: UserLeague): string {
  return league.sleeperLeagueId ?? league.id;
}

function normalizeLeagueFromList(rawLeague: unknown): UserLeague | null {
  const raw = recordFromUnknown(rawLeague);
  if (!raw) return null;

  const id = stringFromUnknown(raw.id);
  const name = stringFromUnknown(raw.name);
  if (!id || !name) return null;

  const platform = stringFromUnknown(raw.platform) ?? "sleeper";
  const sleeperLeagueId =
    platform === "sleeper"
      ? stringFromUnknown(raw.platformLeagueId) ?? id
      : stringFromUnknown(raw.platformLeagueId);

  return {
    id,
    name,
    platform,
    sport: normalizeToSupportedSport(
      stringFromUnknown(raw.sport_type) ?? stringFromUnknown(raw.sport) ?? DEFAULT_SPORT
    ),
    format: inferLeagueFormat(raw),
    scoring:
      stringFromUnknown(raw.scoring) ??
      stringFromUnknown(raw.scoringType) ??
      "standard",
    teamCount: numberFromUnknown(raw.leagueSize) ?? numberFromUnknown(raw.totalTeams) ?? 0,
    season: String(
      numberFromUnknown(raw.season) ??
        stringFromUnknown(raw.season) ??
        new Date().getFullYear()
    ),
    avatarUrl: stringFromUnknown(raw.avatarUrl) ?? null,
    synced: raw.hasUnifiedRecord !== false,
    sleeperLeagueId,
  };
}

function normalizeLeagueFromSleeperFallback(rawLeague: unknown): UserLeague | null {
  const raw = recordFromUnknown(rawLeague);
  if (!raw) return null;

  const sleeperLeagueId = stringFromUnknown(raw.sleeperLeagueId);
  const name = stringFromUnknown(raw.name);
  if (!sleeperLeagueId || !name) return null;

  return {
    id: sleeperLeagueId,
    name,
    platform: "sleeper",
    sport: DEFAULT_SPORT,
    format: raw.isDynasty === true ? "dynasty" : "redraft",
    scoring: stringFromUnknown(raw.scoringType) ?? "standard",
    teamCount: numberFromUnknown(raw.totalTeams) ?? 0,
    season: stringFromUnknown(raw.season) ?? String(new Date().getFullYear()),
    avatarUrl: null,
    synced: raw.alreadySynced === true,
    sleeperLeagueId,
  };
}

function formatRecord(record: { wins: number; losses: number; ties: number }) {
  return record.ties > 0
    ? `${record.wins}-${record.losses}-${record.ties}`
    : `${record.wins}-${record.losses}`;
}

function humanizeKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function phaseLabelFromTeam(team: RawTeam): string {
  const pickExposure = team.rosterExposure?.PICK ?? 0;
  if (team.composite >= 90 || team.expectedWins >= 9) return "Contender";
  if (pickExposure > 20 || team.marketAdj < -8) return "Rebuilding";
  if (team.expectedWins >= 6) return "Mid-Pack";
  return "Flexible";
}

function confidenceLabel(rating: "HIGH" | "MEDIUM" | "LEARNING") {
  if (rating === "HIGH") return "Good";
  if (rating === "MEDIUM") return "Fair";
  return "Low";
}

function detailDirection(polarity: "UP" | "DOWN" | "NEUTRAL"): "up" | "down" {
  return polarity === "DOWN" ? "down" : "up";
}

function buildDriverDetail(driver: RawDriver): string {
  const evidence = recordFromUnknown(driver.evidence);
  if (!evidence) return "Deterministic ranking engine signal.";

  const detail = Object.entries(evidence)
    .slice(0, 3)
    .map(([key, value]) => `${humanizeKey(key)}: ${String(value)}`)
    .join(" · ");

  return detail || "Deterministic ranking engine signal.";
}

function buildWinWindow(team: RawTeam): WinWindowView {
  const pickExposure = team.rosterExposure?.PICK ?? 0;

  if (team.expectedWins >= 9 && team.marketAdj > 5) {
    return {
      label: "Win Now",
      detail: "This roster is built to push for the title immediately.",
      confidence: "High",
    };
  }

  if (pickExposure > 20 || team.marketAdj < -5) {
    return {
      label: "Rebuild",
      detail: "Future-focused roster construction is driving the current profile.",
      confidence: "Medium",
    };
  }

  return {
    label: "Flexible",
    detail: "Could pivot either way depending on the next two roster moves.",
    confidence: "Low",
  };
}

function buildPositionValues(team: RawTeam): PositionValuesView {
  return {
    QB: team.positionValues.QB?.total ?? 0,
    RB: team.positionValues.RB?.total ?? 0,
    WR: team.positionValues.WR?.total ?? 0,
    TE: team.positionValues.TE?.total ?? 0,
    starterValue: team.starterValue,
    benchDepth: team.benchValue,
  };
}

function buildLuckMeter(team: RawTeam): LuckMeterView {
  return {
    status:
      team.luckScore >= 60 ? "Lucky" : team.luckScore <= 40 ? "Unlucky" : "Neutral",
    position: Math.max(0, Math.min(100, Math.round(team.luckScore))),
    actualRecord: formatRecord(team.record),
    shouldBeRecord: `${team.shouldBeRecord.wins}-${team.shouldBeRecord.losses}`,
    luckWins: team.luckDelta,
    insight:
      team.motivationalFrame?.subtext ||
      "No additional luck insight is available for this roster yet.",
  };
}

function mapTeamSummary(raw: RawTeam): TeamRanking {
  const positiveDriver = raw.explanation?.drivers?.find((driver) => driver.polarity === "UP");
  const negativeDriver = raw.explanation?.drivers?.find((driver) => driver.polarity === "DOWN");
  const teamName = raw.displayName ?? raw.username ?? `Roster ${raw.rosterId}`;
  const managerName = raw.username ?? raw.displayName ?? teamName;

  return {
    rank: raw.rank,
    rosterId: raw.rosterId,
    teamName,
    managerName,
    role: raw.role ?? "member",
    isOrphan: raw.isOrphan === true,
    record: formatRecord(raw.record),
    score: Math.round(raw.composite),
    winScore: Math.round(raw.winScore),
    powerScore: Math.round(raw.powerScore),
    mvScore: Math.round(raw.marketValueScore),
    trend:
      raw.rankDelta == null || raw.rankDelta === 0
        ? "neutral"
        : raw.rankDelta < 0
          ? "up"
          : "down",
    strength:
      positiveDriver != null
        ? humanizeKey(positiveDriver.id)
        : `Starter value ${Math.round(raw.starterValue).toLocaleString()}`,
    risk:
      negativeDriver != null
        ? humanizeKey(negativeDriver.id)
        : `Luck ${Math.round(raw.luckScore)}`,
    phase: phaseLabelFromTeam(raw),
    avatar: raw.avatar,
    raw,
    detailLoaded: false,
  };
}

function mapTeamDetail(raw: RawTeam): Partial<TeamRanking> {
  const gamesPlayed = raw.record.wins + raw.record.losses + raw.record.ties;
  const whyChangedSource =
    raw.rankChangeDrivers.length > 0
      ? raw.rankChangeDrivers.slice(0, 3).map((driver) => ({
          label: driver.label,
          direction: driver.polarity === "DOWN" ? ("down" as const) : ("up" as const),
          value: driver.unit
            ? `${driver.value}${driver.unit}`
            : String(driver.value),
        }))
      : raw.explanation.drivers.slice(0, 3).map((driver) => ({
          label: humanizeKey(driver.id),
          direction: detailDirection(driver.polarity),
          value: `${Math.round(driver.impact * 100)} percentile`,
        }));

  const keyDrivers = raw.explanation.drivers.slice(0, 4).map((driver) => ({
    label: humanizeKey(driver.id),
    direction:
      driver.polarity === "DOWN" ? ("negative" as const) : ("positive" as const),
    weight: Math.round(driver.impact * 100),
    detail: buildDriverDetail(driver),
  }));

  const nextSteps = raw.explanation.nextActions.map((action) => ({
    label: action.title,
    impact: action.expectedImpact,
    detail: action.why,
  }));

  return {
    detailLoaded: true,
    rankExplanation: {
      confidence: confidenceLabel(raw.explanation.confidence.rating),
      rankLabel: `${phaseLabelFromTeam(raw).toUpperCase()} (${Math.round(raw.composite)})`,
      tooEarly: gamesPlayed < 3,
      win: Math.round(raw.winScore),
      pwr: Math.round(raw.powerScore),
      lck: Math.round(raw.luckScore),
      mkt: Math.round(raw.marketValueScore),
      mgr: Math.round(raw.managerSkillScore),
      whyChanged: whyChangedSource,
    },
    forwardOdds: {
      playoffs: Math.round(raw.forwardOdds.playoffPct * 10) / 10,
      top3: Math.round(raw.forwardOdds.top3Pct * 10) / 10,
      title: Math.round(raw.forwardOdds.titlePct * 10) / 10,
      simCount: raw.forwardOdds.simCount,
    },
    luckMeter: buildLuckMeter(raw),
    keyDrivers,
    winWindow: buildWinWindow(raw),
    positionValues: buildPositionValues(raw),
    nextSteps,
    insight: raw.motivationalFrame?.suggestedAction ?? raw.motivationalFrame?.headline,
  };
}

function buildAvatarUrl(avatar: string | null) {
  return avatar ? `https://sleepercdn.com/avatars/thumbs/${avatar}` : null;
}

function formatCurrency(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

function barWidth(value: number) {
  return `${Math.max(0, Math.min(100, value))}%`;
}

function trendGlyph(trend: Trend) {
  if (trend === "up") return "▲";
  if (trend === "down") return "▼";
  return "—";
}

function trendClass(trend: Trend) {
  if (trend === "up") return "text-emerald-400";
  if (trend === "down") return "text-red-400";
  return "text-white/35";
}

function rowBorderClass(rank: number) {
  if (rank === 1) return "border-l-4 border-yellow-400";
  if (rank === 2) return "border-l-4 border-gray-300";
  if (rank === 3) return "border-l-4 border-amber-600";
  return "border-l-4 border-transparent";
}

function phaseBadgeClass(label: string) {
  if (label === "Rebuilding") return "bg-blue-500/15 text-blue-200 border-blue-500/20";
  if (label === "Contender") return "bg-emerald-500/15 text-emerald-200 border-emerald-500/20";
  return "bg-white/[0.04] text-white/70 border-white/10";
}

function personalityStrengths(profile: ManagerPsychology): string[] {
  const highTraits = profile.traits
    .filter((trait) => trait.score >= 60)
    .map((trait) => trait.trait);
  return [...highTraits, ...profile.tendencies].slice(0, 4);
}

function personalityWeaknesses(profile: ManagerPsychology): string[] {
  const lowTraits = profile.traits
    .filter((trait) => trait.score < 45)
    .map((trait) => `${trait.trait.toLowerCase()} pressure`);
  return [profile.blindSpot, ...lowTraits].slice(0, 4);
}

function LoadingCard() {
  return <div className="h-28 animate-pulse rounded-2xl border border-white/8 bg-[#0c0c1e]" />;
}

function LoginRequiredState() {
  const { t, tInterpolate } = useLanguage();
  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-300">
            {t("powerRankingsPage.badge")}
          </div>
          <h1 className="mt-4 text-3xl font-black">{t("powerRankingsPage.loginTitle")}</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">{t("powerRankingsPage.loginBody")}</p>
          <Link
            href="/login?callbackUrl=%2Fpower-rankings"
            className="mt-6 inline-flex rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm font-bold text-amber-200 hover:bg-amber-500/20"
          >
            {t("powerRankingsPage.goToLogin")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function LeagueGate({
  leagues,
  loading,
  error,
  onSelect,
}: {
  leagues: UserLeague[];
  loading: boolean;
  error: string | null;
  onSelect: (league: UserLeague) => void;
}) {
  const { t, tInterpolate } = useLanguage();
  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-300">
              {t("powerRankingsPage.badge")}
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-black">{t("powerRankingsPage.selectLeagueTitle")}</h1>
          <p className="mt-2 text-sm text-white/45">{t("powerRankingsPage.selectLeagueBody")}</p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <LoadingCard key={item} />
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {!loading && !error && leagues.length === 0 ? (
          <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-8 text-center">
            <div className="text-5xl">🏆</div>
            <h2 className="mt-4 text-2xl font-black text-white">{t("powerRankingsPage.noLeaguesTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-white/50">{t("powerRankingsPage.noLeaguesBody")}</p>
            <Link
              href="/af-legacy"
              className="mt-6 inline-flex rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm font-bold text-amber-200 hover:bg-amber-500/20"
            >
              {t("powerRankingsPage.importLeagueCta")}
            </Link>
          </div>
        ) : null}

        {!loading && leagues.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {leagues.map((league) => {
              const platform = PLATFORM_LABELS[league.platform] ?? PLATFORM_LABELS.sleeper;
              return (
                <button
                  key={league.id}
                  type="button"
                  onClick={() => onSelect(league)}
                  className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-5 text-left transition-all hover:border-white/15 hover:bg-white/[0.03]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{platform.emoji}</span>
                      <span
                        className="text-xs font-bold uppercase tracking-[0.24em]"
                        style={{ color: platform.color }}
                      >
                        {platform.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50">
                        {t(`powerRankingsPage.sport.${league.sport}`)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/50">
                        {t(`powerRankingsPage.format.${league.format}`)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 text-lg font-bold text-white">{league.name}</div>
                  <div className="mt-2 text-sm text-white/45">
                    {tInterpolate("powerRankingsPage.leagueTeamsLine", {
                      n: league.teamCount,
                      scoring: league.scoring,
                      season: league.season,
                    })}
                  </div>
                  <div className="mt-4 flex items-center justify-between text-xs text-white/40">
                    <span>
                      {league.sleeperLeagueId
                        ? t("powerRankingsPage.sleeperReady")
                        : t("powerRankingsPage.genericSync")}
                    </span>
                    <span className={league.synced ? "text-emerald-300" : "text-amber-300"}>
                      {league.synced ? t("powerRankingsPage.statusReady") : t("powerRankingsPage.statusNeedsSync")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CollapsibleCard({
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
            {title}
          </span>
          {badge ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/45">
              {badge}
            </span>
          ) : null}
        </div>
        <span className={cx("text-xs text-white/40 transition-transform", open && "rotate-180")}>
          ▼
        </span>
      </button>
      <div
        className={cx(
          "overflow-hidden transition-all duration-300",
          open ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <div className="border-t border-white/6 px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

function ScorePill({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: number;
  colorClass: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-white/35">
        <span>{label}</span>
        <span className="font-bold text-white/60">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={cx("h-full rounded-full transition-all duration-700", colorClass)} style={{ width: barWidth(value) }} />
      </div>
    </div>
  );
}

function HeroCard({
  title,
  headline,
  detail,
  accent,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  headline: string;
  detail: string;
  accent: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div className={cx("rounded-3xl border p-4 sm:p-5", accent)}>
      <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
        {title}
      </div>
      <div className="mt-3 text-lg font-black text-white">{headline}</div>
      <div className="mt-2 text-sm leading-6 text-white/60">{detail}</div>
      {ctaHref && ctaLabel ? (
        <Link
          href={ctaHref}
          className="mt-4 inline-flex text-xs font-bold uppercase tracking-[0.18em] text-cyan-200 hover:text-white"
        >
          {ctaLabel} →
        </Link>
      ) : null}
    </div>
  );
}

function ExpandedTeamDetail({
  team,
  currentJob,
  onCoach,
  onRoadmap,
}: {
  team: TeamRanking;
  currentJob: ActiveJob | null;
  onCoach: (team: TeamRanking) => void;
  onRoadmap: (team: TeamRanking) => void;
}) {
  const { t, tInterpolate } = useLanguage();
  const rankExplanation = team.rankExplanation;
  const psychologyLoading =
    currentJob?.kind === "psychology" && currentJob.rosterId === team.rosterId;
  const roadmapLoading =
    currentJob?.kind === "roadmap" && currentJob.rosterId === team.rosterId;
  const psychologyStrengths = team.psychology ? personalityStrengths(team.psychology) : [];
  const psychologyWeaknesses = team.psychology ? personalityWeaknesses(team.psychology) : [];

  return (
    <div className="border-t border-cyan-500/20 bg-white/[0.02] px-4 py-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/8 bg-[#0c0c1e] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
              {t("powerRankingsPage.detail.manager")}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <div className="text-xl font-black text-white">{team.managerName}</div>
              <ManagerRoleBadge role={team.isOrphan ? "orphan" : team.role ?? "member"} />
            </div>
            <div className="mt-1 text-sm text-white/45">
              {team.teamName} · {team.record}
            </div>
          </div>

          {rankExplanation ? (
            <CollapsibleCard
              title={t("powerRankingsPage.detail.rankExplanation")}
              badge={tInterpolate("powerRankingsPage.confidenceSuffix", {
                level: t(`powerRankingsPage.confidence.${rankExplanation.confidence.toLowerCase()}`),
              })}
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-200">
                    {rankExplanation.rankLabel}
                  </span>
                  {rankExplanation.tooEarly ? (
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-200">
                      {t("powerRankingsPage.tooEarly")}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ScorePill label={t("powerRankingsPage.scorePill.win")} value={rankExplanation.win} colorClass="bg-emerald-500" />
                  <ScorePill label={t("powerRankingsPage.scorePill.pwr")} value={rankExplanation.pwr} colorClass="bg-cyan-500" />
                  <ScorePill label={t("powerRankingsPage.scorePill.lck")} value={rankExplanation.lck} colorClass="bg-amber-500" />
                  <ScorePill label={t("powerRankingsPage.scorePill.mkt")} value={rankExplanation.mkt} colorClass="bg-purple-500" />
                  <ScorePill label={t("powerRankingsPage.scorePill.mgr")} value={rankExplanation.mgr} colorClass="bg-pink-500" />
                </div>
              </div>
            </CollapsibleCard>
          ) : null}

          {rankExplanation?.whyChanged.length ? (
            <CollapsibleCard title={t("powerRankingsPage.detail.whyRankChanged")}>
              <div className="space-y-2">
                {rankExplanation.whyChanged.map((item) => (
                  <div
                    key={`${item.label}-${item.value}`}
                    className="flex items-center justify-between rounded-xl border border-white/8 bg-[#0c0c1e] px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className={item.direction === "up" ? "text-emerald-400" : "text-red-400"}>
                        {item.direction === "up" ? "▲" : "▼"}
                      </span>
                      <span className="text-white/75">{item.label}</span>
                    </div>
                    <span className="text-white/45">{item.value}</span>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          ) : null}

          {team.forwardOdds ? (
            <CollapsibleCard
              title={t("powerRankingsPage.detail.forwardOdds")}
              badge={tInterpolate("powerRankingsPage.forwardOdds.sims", {
                n: team.forwardOdds.simCount.toLocaleString(),
              })}
            >
              <div className="space-y-3">
                {[
                  { label: t("powerRankingsPage.forwardOdds.playoffs"), value: team.forwardOdds.playoffs, bar: "bg-emerald-500" },
                  { label: t("powerRankingsPage.forwardOdds.top3"), value: team.forwardOdds.top3, bar: "bg-blue-500" },
                  { label: t("powerRankingsPage.forwardOdds.title"), value: team.forwardOdds.title, bar: "bg-amber-500" },
                ].map((item) => (
                  <div key={item.label} className="space-y-1">
                    <div className="flex items-center justify-between text-sm text-white/65">
                      <span>{item.label}</span>
                      <span>{item.value.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div className={cx("h-full rounded-full transition-all duration-700", item.bar)} style={{ width: `${item.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          ) : null}

          {team.keyDrivers && team.keyDrivers.length > 0 ? (
            <CollapsibleCard title={t("powerRankingsPage.detail.keyDrivers")}>
              <div className="grid gap-3 sm:grid-cols-2">
                {team.keyDrivers.map((driver) => (
                  <div
                    key={driver.label}
                    className={cx(
                      "rounded-2xl border bg-[#0c0c1e] p-4",
                      driver.direction === "positive"
                        ? "border-teal-500/25"
                        : "border-red-500/25"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className={driver.direction === "positive" ? "text-teal-300" : "text-red-300"}>
                        {driver.direction === "positive" ? "▲" : "▼"} {driver.label}
                      </div>
                      <div className="text-xs font-bold text-white/45">{driver.weight}%</div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/55">{driver.detail}</p>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          ) : null}

          {team.winWindow ? (
            <CollapsibleCard title={t("powerRankingsPage.detail.winWindow")}>
              <div className="space-y-2">
                <div
                  className={cx(
                    "text-2xl font-black",
                    team.winWindow.label === "Win Now"
                      ? "bg-gradient-to-r from-red-300 to-amber-300 bg-clip-text text-transparent"
                      : team.winWindow.label === "Rebuild"
                        ? "bg-gradient-to-r from-sky-300 to-blue-500 bg-clip-text text-transparent"
                        : "bg-gradient-to-r from-cyan-300 to-teal-400 bg-clip-text text-transparent"
                  )}
                >
                  {t(winWindowLabelKey(team.winWindow.label))}
                </div>
                <p className="text-sm leading-6 text-white/60">{team.winWindow.detail}</p>
                <div className="text-xs text-white/35">
                  {tInterpolate("powerRankingsPage.winWindow.confidenceLabel", {
                    level: t(`powerRankingsPage.level.${team.winWindow.confidence.toLowerCase()}`),
                  })}
                </div>
              </div>
            </CollapsibleCard>
          ) : null}

          {team.luckMeter ? (
            <CollapsibleCard title={t("powerRankingsPage.detail.luckMeter")} badge={t(luckStatusTranslationKey(team.luckMeter.status))}>
              <div className="space-y-4">
                <div className="text-xs text-white/35">{t("powerRankingsPage.luck.scale")}</div>
                <div className="relative h-3 rounded-full bg-[linear-gradient(90deg,#ef4444,#fbbf24,#10b981)]">
                  <div
                    className="absolute -top-2 text-white"
                    style={{ left: `calc(${team.luckMeter.position}% - 6px)` }}
                  >
                    ▲
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-white/8 bg-[#0c0c1e] p-3 text-center">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">
                      {t("powerRankingsPage.luck.actualRecord")}
                    </div>
                    <div className="mt-2 text-lg font-black text-white">{team.luckMeter.actualRecord}</div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-[#0c0c1e] p-3 text-center">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">
                      {t("powerRankingsPage.luck.shouldBeRecord")}
                    </div>
                    <div className="mt-2 text-lg font-black text-white">{team.luckMeter.shouldBeRecord}</div>
                  </div>
                </div>
                <div className="text-sm text-white/60">
                  {tInterpolate("powerRankingsPage.luck.winsLine", {
                    sign: team.luckMeter.luckWins > 0 ? "+" : "",
                    n: team.luckMeter.luckWins.toFixed(1),
                  })}
                </div>
                <p className="text-sm leading-6 text-white/60">{team.luckMeter.insight}</p>
                {team.insight ? (
                  <div className="border-l-2 border-cyan-500 pl-3 text-sm italic leading-6 text-cyan-100/75">
                    {team.insight}
                  </div>
                ) : null}
              </div>
            </CollapsibleCard>
          ) : null}

          {team.positionValues ? (
            <CollapsibleCard title={t("powerRankingsPage.detail.positionValues")}>
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "QB", value: team.positionValues.QB },
                  { label: "RB", value: team.positionValues.RB },
                  { label: "WR", value: team.positionValues.WR },
                  { label: "TE", value: team.positionValues.TE },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/8 bg-[#0c0c1e] p-3 text-center">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/35">{item.label}</div>
                    <div className="mt-2 text-lg font-black text-white">{formatCurrency(item.value)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/8 bg-[#0c0c1e] p-3 text-sm text-white/65">
                  {t("powerRankingsPage.position.starterValue")}{" "}
                  <span className="font-bold text-white">{team.positionValues.starterValue.toLocaleString()}</span>
                </div>
                <div className="rounded-xl border border-white/8 bg-[#0c0c1e] p-3 text-sm text-white/65">
                  {t("powerRankingsPage.position.benchDepth")}{" "}
                  <span className="font-bold text-white">{team.positionValues.benchDepth.toLocaleString()}</span>
                </div>
              </div>
            </CollapsibleCard>
          ) : null}

          {team.nextSteps && team.nextSteps.length > 0 ? (
            <CollapsibleCard title={t("powerRankingsPage.detail.nextSteps")}>
              <div className="space-y-3">
                {team.nextSteps.map((step) => (
                  <div key={step.label} className="rounded-xl border border-white/8 bg-[#0c0c1e] p-4">
                    <div className="flex items-center gap-2">
                      <span
                        className={cx(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold",
                          step.impact === "HIGH"
                            ? "bg-red-500/15 text-red-200"
                            : step.impact === "MEDIUM"
                              ? "bg-amber-500/15 text-amber-200"
                              : "bg-white/[0.06] text-white/55"
                        )}
                      >
                        {t(`powerRankingsPage.impact.${step.impact.toLowerCase()}`)}
                        {t("powerRankingsPage.impact.suffix")}
                      </span>
                      <span className="text-sm font-semibold text-white">{step.label}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-white/60">{step.detail}</p>
                  </div>
                ))}
              </div>
            </CollapsibleCard>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="sticky top-24 rounded-3xl border border-white/8 bg-[#0c0c1e] p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
                {t("powerRankingsPage.coach.title")}
              </div>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/45">
                {team.rankExplanation?.rankLabel ??
                  tInterpolate("powerRankingsPage.coach.scoreFallback", { n: team.score })}
              </span>
            </div>

            <div className="mt-4 grid gap-3">
              <button
                type="button"
                onClick={() => onCoach(team)}
                disabled={psychologyLoading}
                className="rounded-2xl px-4 py-3 text-sm font-black text-black transition-all disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, #14b8a6, #06b6d4)",
                  boxShadow: "0 10px 30px rgba(6,182,212,0.18)",
                }}
              >
                {psychologyLoading
                  ? t("powerRankingsPage.coach.loadingInsight")
                  : t("powerRankingsPage.coach.getInsight")}
              </button>
              <button
                type="button"
                onClick={() => onRoadmap(team)}
                disabled={roadmapLoading}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/75 transition-all hover:border-white/20 hover:text-white disabled:opacity-50"
              >
                {roadmapLoading
                  ? t("powerRankingsPage.coach.generatingPlan")
                  : t("powerRankingsPage.coach.generatePlan")}
              </button>
            </div>

            {(psychologyLoading || roadmapLoading) && currentJob ? (
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs text-white/45">
                  <span>
                    {tInterpolate("powerRankingsPage.job.label", {
                      kind:
                        currentJob.kind === "psychology"
                          ? t("powerRankingsPage.job.psychology")
                          : t("powerRankingsPage.job.roadmap"),
                    })}
                  </span>
                  <span>{currentJob.progress}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full bg-cyan-500 transition-all duration-300" style={{ width: `${currentJob.progress}%` }} />
                </div>
              </div>
            ) : null}

            {team.psychology ? (
              <div className="mt-5 rounded-2xl border border-violet-500/20 bg-violet-500/10 p-4">
                <div className="inline-flex rounded-full bg-violet-500/20 px-2.5 py-1 text-xs font-bold text-violet-200">
                  {team.psychology.emoji} {team.psychology.archetype}
                </div>
                <div className="mt-4 space-y-2 text-sm text-white/70">
                  <div>
                    <span className="text-white/45">{t("powerRankingsPage.psychology.decisionStyle")}</span>{" "}
                    {humanizeKey(team.psychology.decisionSpeed.toLowerCase())}
                  </div>
                  <div>
                    <span className="text-white/45">{t("powerRankingsPage.psychology.tradeTendencies")}</span>{" "}
                    {team.psychology.tendencies[0] ?? team.psychology.negotiationStyle}
                  </div>
                  <div>
                    <span className="text-white/45">{t("powerRankingsPage.psychology.draftStyle")}</span>{" "}
                    {team.psychology.tendencies[1] ?? team.psychology.summary}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                      {t("powerRankingsPage.psychology.strengths")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {psychologyStrengths.map((item) => (
                        <span key={item} className="rounded-full bg-green-500/20 px-2.5 py-1 text-xs text-green-200">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/35">
                      {t("powerRankingsPage.psychology.weaknesses")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {psychologyWeaknesses.map((item) => (
                        <span key={item} className="rounded-full bg-red-500/20 px-2.5 py-1 text-xs text-red-200">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-l-2 border-cyan-500 pl-3 text-sm italic leading-6 text-cyan-100/75">
                  {team.psychology.summary}
                </div>
              </div>
            ) : null}

            {team.dynastyRoadmap ? (
              <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
                    {t("powerRankingsPage.roadmap.title")}
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/45">
                    {team.dynastyRoadmap.confidence}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-white/60">
                  {team.dynastyRoadmap.overallStrategy}
                </p>
                <div className="mt-4 overflow-x-auto">
                  <div className="flex min-w-max gap-3">
                    {team.dynastyRoadmap.yearPlans.map((year) => (
                      <div key={year.year} className="w-60 rounded-2xl border border-white/10 bg-[#0c0c1e] p-4">
                        <div className="inline-flex rounded-full bg-gradient-to-r from-cyan-500/20 to-teal-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">
                          {tInterpolate("powerRankingsPage.roadmap.year", { n: year.year })}
                        </div>
                        <div className="mt-3 text-sm font-bold text-white">
                          {year.label.replace(`Year ${year.year}: `, "")}
                        </div>
                        <div className="mt-3 space-y-2 text-sm leading-6 text-white/60">
                          {year.priorities.slice(0, 2).map((priority) => (
                            <div key={priority}>{priority}</div>
                          ))}
                        </div>
                        {year.targetPositions.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {year.targetPositions.map((position) => (
                              <span key={position} className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200">
                                {position}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {year.keyMoves.length > 0 ? (
                          <div className="mt-3 text-xs leading-5 text-white/45">
                            {year.keyMoves[0]}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamRow({
  team,
  displayRank,
  expanded,
  detailLoading,
  onToggle,
  currentJob,
  onCoach,
  onRoadmap,
}: {
  team: TeamRanking;
  displayRank: number;
  expanded: boolean;
  detailLoading: boolean;
  onToggle: () => void;
  currentJob: ActiveJob | null;
  onCoach: (team: TeamRanking) => void;
  onRoadmap: (team: TeamRanking) => void;
}) {
  const { t, tInterpolate } = useLanguage();
  const avatarUrl = buildAvatarUrl(team.avatar);
  const phaseLabel = t(phaseTranslationKey(team.phase));

  return (
    <div className={cx("overflow-hidden rounded-3xl border border-white/8 bg-[#0c0c1e]", rowBorderClass(displayRank))}>
      <button
        type="button"
        onClick={onToggle}
        className="hidden w-full grid-cols-[52px_minmax(0,1.5fr)_90px_180px_80px_120px_120px_42px] items-center gap-3 px-4 py-4 text-left md:grid hover:bg-white/[0.03]"
      >
        <div className="flex items-center gap-2">
          <div className="text-xl font-black text-white">#{displayRank}</div>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-black text-white">
              {team.teamName[0]?.toUpperCase() ?? "T"}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-white">{team.teamName}</div>
            <div className="flex items-center gap-1.5 truncate text-xs text-white/40">
              <span className="truncate">{team.managerName}</span>
              <ManagerRoleBadge role={team.isOrphan ? "orphan" : team.role ?? "member"} />
            </div>
          </div>
        </div>
        <div className="text-center text-sm text-white/65">{team.record}</div>
        <div className="text-center">
          <div className="text-xl font-black text-white">{team.score}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">{t("powerRankingsPage.col.score")}</div>
        </div>
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: barWidth(team.winScore) }} />
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full bg-cyan-500" style={{ width: barWidth(team.powerScore) }} />
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full bg-purple-500" style={{ width: barWidth(team.mvScore) }} />
          </div>
        </div>
        <div className={cx("text-center text-sm font-bold", trendClass(team.trend))}>
          {trendGlyph(team.trend)}
        </div>
        <div className="text-sm text-white/60">{team.strength}</div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-white/45">{team.risk}</span>
          <span className={cx("rounded-full border px-2 py-0.5 text-[10px]", phaseBadgeClass(team.phase))}>
            {phaseLabel}
          </span>
        </div>
        <div className={cx("text-xs text-white/40 transition-transform", expanded && "rotate-180")}>
          ▼
        </div>
      </button>

      <button
        type="button"
        onClick={onToggle}
        className="block w-full px-4 py-4 text-left md:hidden hover:bg-white/[0.03]"
      >
        <div className="flex items-start gap-3">
          <div className="text-lg font-black text-white">#{displayRank}</div>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-black text-white">
              {team.teamName[0]?.toUpperCase() ?? "T"}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-bold text-white">{team.teamName}</div>
              <span className={cx("rounded-full border px-2 py-0.5 text-[10px]", phaseBadgeClass(team.phase))}>
                {phaseLabel}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-xs text-white/40">
              <span className="truncate">{team.managerName}</span>
              <ManagerRoleBadge role={team.isOrphan ? "orphan" : team.role ?? "member"} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">{t("powerRankingsPage.col.record")}</div>
                <div className="mt-1 text-sm font-bold text-white">{team.record}</div>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">{t("powerRankingsPage.col.score")}</div>
                <div className="mt-1 text-sm font-bold text-white">{team.score}</div>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">{t("powerRankingsPage.col.trend")}</div>
                <div className={cx("mt-1 text-sm font-bold", trendClass(team.trend))}>
                  {trendGlyph(team.trend)}
                </div>
              </div>
            </div>
          </div>
          <div className={cx("text-xs text-white/40 transition-transform", expanded && "rotate-180")}>
            ▼
          </div>
        </div>
      </button>

      <div
        className={cx(
          "overflow-hidden transition-all duration-300",
          expanded ? "max-h-[4000px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        {expanded ? (
          detailLoading ? (
            <div className="px-4 py-6 text-sm text-white/45">{t("powerRankingsPage.loadingDetail")}</div>
          ) : (
            <ExpandedTeamDetail team={team} currentJob={currentJob} onCoach={onCoach} onRoadmap={onRoadmap} />
          )
        ) : null}
      </div>
    </div>
  );
}

export default function PowerRankingsPage() {
  const { data: session, status } = useSession();
  const { t, tInterpolate } = useLanguage();
  const [leagues, setLeagues] = useState<UserLeague[]>([]);
  const [leagueLoading, setLeagueLoading] = useState(false);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [selectedLeague, setSelectedLeague] = useState<UserLeague | null>(null);

  const [view, setView] = useState<RankingView>("composite");
  const [rankingsMeta, setRankingsMeta] = useState<RankingsResponse | null>(null);
  const [teams, setTeams] = useState<TeamRanking[]>([]);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError] = useState<string | null>(null);
  /** Distinguishes a signed-out/expired session and a non-member from a generic failure, so each
   *  gets an actionable state instead of a raw API string in a red box. */
  const [rankingsErrorKind, setRankingsErrorKind] = useState<
    "auth" | "forbidden" | "generic" | null
  >(null);
  const [expandedRosterId, setExpandedRosterId] = useState<number | null>(null);
  const [detailLoadingRosterId, setDetailLoadingRosterId] = useState<number | null>(null);

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const loadRankings = useCallback(async (league: UserLeague) => {
    setRankingsLoading(true);
    setRankingsError(null);
    setRankingsErrorKind(null);

    try {
      const targetLeagueId = getTargetLeagueId(league);
      const response = await fetch(
        `/api/rankings/league-v2?leagueId=${encodeURIComponent(targetLeagueId)}`,
        { cache: "no-store" }
      );

      // The rankings endpoint is member-gated. Map its two rejection codes to states the reader can
      // act on, rather than surfacing the raw server string.
      if (response.status === 401 || response.status === 403) {
        setRankingsMeta(null);
        setTeams([]);
        setRankingsErrorKind(response.status === 401 ? "auth" : "forbidden");
        setRankingsError(
          response.status === 401
            ? "Your session has expired. Sign in again to see these rankings."
            : "You're not a member of this league, so its rankings aren't available."
        );
        return;
      }

      const payload = (await response.json().catch(() => ({}))) as RankingsResponse & {
        error?: string;
      };

      if (!response.ok || !Array.isArray(payload.teams)) {
        throw new Error(payload.error ?? "Failed to load league rankings.");
      }

      setRankingsMeta(payload);
      setTeams(payload.teams.map(mapTeamSummary));
    } catch (error) {
      setRankingsMeta(null);
      setTeams([]);
      setRankingsErrorKind("generic");
      setRankingsError(
        error instanceof Error ? error.message : "Failed to load league rankings."
      );
    } finally {
      setRankingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function loadLeagues() {
      setLeagueLoading(true);
      setLeagueError(null);

      try {
        const response = await fetch("/api/league/list", { cache: "no-store" });
        if (response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            leagues?: unknown[];
          };
          const mapped = arrayFromUnknown(payload.leagues)
            .map((entry) => normalizeLeagueFromList(entry))
            .filter((entry): entry is UserLeague => entry != null);
          if (!cancelled) setLeagues(mapped);
          return;
        }

        const sleeperFallback = await fetch("/api/league/sleeper-user-leagues", {
          cache: "no-store",
        });
        const fallbackPayload = (await sleeperFallback.json().catch(() => ({}))) as {
          leagues?: unknown[];
          error?: string;
        };
        if (!sleeperFallback.ok) {
          throw new Error(fallbackPayload.error ?? "Could not load leagues.");
        }

        const mapped = arrayFromUnknown(fallbackPayload.leagues)
          .map((entry) => normalizeLeagueFromSleeperFallback(entry))
          .filter((entry): entry is UserLeague => entry != null);
        if (!cancelled) setLeagues(mapped);
      } catch (error) {
        if (!cancelled) {
          setLeagueError(error instanceof Error ? error.message : "Could not load leagues.");
        }
      } finally {
        if (!cancelled) setLeagueLoading(false);
      }
    }

    void loadLeagues();
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (!selectedLeague) return;
    void loadRankings(selectedLeague);
  }, [loadRankings, selectedLeague]);

  const displayedTeams = useMemo(() => {
    const next = [...teams];
    if (view === "power") {
      next.sort((left, right) => right.powerScore - left.powerScore);
    } else if (view === "dynasty") {
      next.sort((left, right) => right.mvScore - left.mvScore);
    } else {
      next.sort((left, right) => left.rank - right.rank);
    }
    return next;
  }, [teams, view]);

  const heroData = useMemo(() => {
    if (!rankingsMeta || displayedTeams.length === 0) return null;

    const champion = displayedTeams[0];
    const strongest = [...displayedTeams].sort(
      (left, right) =>
        right.raw.starterValue + right.raw.benchValue - (left.raw.starterValue + left.raw.benchValue)
    )[0];
    const marketLeader = [...displayedTeams].sort((left, right) => right.mvScore - left.mvScore)[0];
    const marketInsight = rankingsMeta.marketInsights?.[0] ?? null;

    return { champion, strongest, marketLeader, marketInsight };
  }, [displayedTeams, rankingsMeta]);

  const pollJob = useCallback(
    async (jobId: string, kind: JobKind, rosterId?: number) => {
      const response = await fetch(
        `/api/power-rankings/worker?jobId=${encodeURIComponent(jobId)}`,
        { cache: "no-store" }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        status?: string;
        progress?: number;
        result?: {
          psychology?: unknown;
          roadmap?: unknown;
        };
        failedReason?: string | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to read job status.");
      }

      const nextStatus = payload.status ?? "waiting";
      const nextProgress = payload.progress ?? 0;

      setActiveJob((current) =>
        current && current.jobId === jobId
          ? { ...current, status: nextStatus, progress: nextProgress }
          : current
      );

      if (nextStatus === "completed") {
        stopPolling();

        if (kind === "refresh" && selectedLeague) {
          await loadRankings(selectedLeague);
        }

        if (kind === "psychology" && rosterId != null && payload.result?.psychology) {
          setTeams((current) =>
            current.map((team) =>
              team.rosterId === rosterId
                ? { ...team, psychology: payload.result?.psychology as ManagerPsychology }
                : team
            )
          );
        }

        if (kind === "roadmap" && rosterId != null && payload.result?.roadmap) {
          setTeams((current) =>
            current.map((team) =>
              team.rosterId === rosterId
                ? { ...team, dynastyRoadmap: payload.result?.roadmap as DynastyRoadmap }
                : team
            )
          );
        }

        setActiveJob(null);
      }

      if (nextStatus === "failed") {
        stopPolling();
        setActiveJob(null);
        throw new Error(payload.failedReason ?? "Background job failed.");
      }
    },
    [loadRankings, selectedLeague, stopPolling]
  );

  const startJob = useCallback(
    async (kind: JobKind, body: { jobType: string; leagueId: string; rosterId?: number; managerName?: string }) => {
      stopPolling();
      setJobError(null);

      const response = await fetch("/api/power-rankings/worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };

      if (!response.ok || !payload.jobId) {
        throw new Error(payload.error ?? "Failed to queue job.");
      }

      setActiveJob({
        jobId: payload.jobId,
        kind,
        rosterId: body.rosterId,
        progress: 0,
        status: "queued",
      });

      const tick = () => {
        void pollJob(payload.jobId as string, kind, body.rosterId).catch((error) => {
          stopPolling();
          setActiveJob(null);
          setJobError(error instanceof Error ? error.message : "Background job failed.");
        });
      };

      tick();
      pollRef.current = window.setInterval(tick, 2000);
    },
    [pollJob, stopPolling]
  );

  const refreshRankings = useCallback(async () => {
    if (!selectedLeague) return;
    try {
      await startJob("refresh", {
        jobType: "refresh-rankings",
        leagueId: getTargetLeagueId(selectedLeague),
      });
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "Failed to queue rankings refresh.");
    }
  }, [selectedLeague, startJob]);

  const loadTeamDetail = useCallback(
    async (team: TeamRanking) => {
      if (!selectedLeague || team.detailLoaded) return;

      setDetailLoadingRosterId(team.rosterId);
      try {
        const response = await fetch(
          `/api/rankings/league-v2?leagueId=${encodeURIComponent(getTargetLeagueId(selectedLeague))}`,
          { cache: "no-store" }
        );
        const payload = (await response.json().catch(() => ({}))) as RankingsResponse & {
          error?: string;
        };

        if (!response.ok || !Array.isArray(payload.teams)) {
          throw new Error(payload.error ?? "Failed to load team detail.");
        }

        const rawTeam = payload.teams.find((entry) => entry.rosterId === team.rosterId);
        if (!rawTeam) {
          throw new Error("Expanded roster detail was not found.");
        }

        setTeams((current) =>
          current.map((entry) =>
            entry.rosterId === team.rosterId
              ? { ...entry, raw: rawTeam, ...mapTeamDetail(rawTeam) }
              : entry
          )
        );
      } catch (error) {
        setJobError(error instanceof Error ? error.message : "Failed to load team detail.");
      } finally {
        setDetailLoadingRosterId(null);
      }
    },
    [selectedLeague]
  );

  const toggleExpanded = useCallback(
    async (team: TeamRanking) => {
      const nextExpanded = expandedRosterId === team.rosterId ? null : team.rosterId;
      setExpandedRosterId(nextExpanded);
      if (nextExpanded === team.rosterId) {
        await loadTeamDetail(team);
      }
    },
    [expandedRosterId, loadTeamDetail]
  );

  const requestCoach = useCallback(
    async (team: TeamRanking) => {
      if (!selectedLeague) return;
      try {
        await startJob("psychology", {
          jobType: "psychology",
          leagueId: getTargetLeagueId(selectedLeague),
          rosterId: team.rosterId,
          managerName: team.managerName,
        });
      } catch (error) {
        setJobError(error instanceof Error ? error.message : "Failed to queue psychology job.");
      }
    },
    [selectedLeague, startJob]
  );

  const requestRoadmap = useCallback(
    async (team: TeamRanking) => {
      if (!selectedLeague) return;
      try {
        await startJob("roadmap", {
          jobType: "dynasty-roadmap",
          leagueId: getTargetLeagueId(selectedLeague),
          rosterId: team.rosterId,
          managerName: team.managerName,
        });
      } catch (error) {
        setJobError(error instanceof Error ? error.message : "Failed to queue roadmap job.");
      }
    },
    [selectedLeague, startJob]
  );

  const resetLeague = useCallback(() => {
    stopPolling();
    setSelectedLeague(null);
    setRankingsMeta(null);
    setTeams([]);
    setExpandedRosterId(null);
    setActiveJob(null);
    setJobError(null);
    setRankingsError(null);
  }, [stopPolling]);

  if (status === "loading") {
    return <div className="min-h-screen bg-[#07071a]" />;
  }

  if (status === "unauthenticated") {
    return <LoginRequiredState />;
  }

  if (!selectedLeague) {
    return (
      <LeagueGate
        leagues={leagues}
        loading={leagueLoading}
        error={leagueError}
        onSelect={setSelectedLeague}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#07071a] text-white">
      <div className="sticky top-0 z-20 border-b border-white/6 bg-[#07071a]/90 backdrop-blur-xl">
        <div className="mx-auto max-w-[1480px] px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.24em] text-amber-300">
                  {t("powerRankingsPage.hubBadge")}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-black">{t("powerRankingsPage.hubTitle")}</h1>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="text-xs font-bold text-white">{selectedLeague.name}</div>
              <div className="text-[11px] text-white/40">
                {t(`powerRankingsPage.sport.${selectedLeague.sport}`)} ·{" "}
                {t(`powerRankingsPage.format.${selectedLeague.format}`)} · {selectedLeague.scoring}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
                {t("powerRankingsPage.viewLabel")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { id: "power" as RankingView, label: t("powerRankingsPage.viewPower") },
                  { id: "dynasty" as RankingView, label: t("powerRankingsPage.viewDynasty") },
                  { id: "composite" as RankingView, label: t("powerRankingsPage.viewComposite") },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setView(tab.id)}
                    className={cx(
                      "rounded-full border px-3 py-1 text-xs font-bold transition-all",
                      view === tab.id
                        ? "border-cyan-500/30 bg-cyan-500/10 text-white"
                        : "border-white/10 bg-white/[0.02] text-white/45 hover:text-white"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void refreshRankings()}
                disabled={activeJob?.kind === "refresh"}
                className="rounded-2xl px-4 py-3 text-sm font-black text-black transition-all disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
                  boxShadow: "0 10px 32px rgba(245,158,11,0.18)",
                }}
              >
                {activeJob?.kind === "refresh"
                  ? t("powerRankingsPage.refreshingRankings")
                  : t("powerRankingsPage.refreshRankings")}
              </button>
              <button
                type="button"
                onClick={resetLeague}
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 hover:border-white/20 hover:text-white"
              >
                {t("powerRankingsPage.changeLeague")}
              </button>
            </div>
          </div>

          {activeJob?.kind === "refresh" ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between text-xs text-white/45">
                <span>{t("powerRankingsPage.backgroundRefresh")}</span>
                <span>{activeJob.progress}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div className="h-full rounded-full bg-amber-400 transition-all duration-300" style={{ width: `${activeJob.progress}%` }} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6">
        <div className="mb-6 rounded-3xl border border-white/8 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_45%),#0a0d1a] p-6">
          <div className="max-w-3xl">
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-300/80">
              {t("powerRankingsPage.introKicker")}
            </div>
            <h2 className="mt-3 text-3xl font-black leading-tight">{t("powerRankingsPage.introTitle")}</h2>
            <p className="mt-3 text-sm leading-6 text-white/55">{t("powerRankingsPage.introBody")}</p>
          </div>
        </div>

        {jobError ? (
          <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            {jobError}
          </div>
        ) : null}

        {rankingsLoading ? (
          <div className="space-y-4">
            <LoadingCard />
            <LoadingCard />
            <LoadingCard />
          </div>
        ) : null}

        {!rankingsLoading && rankingsError ? (
          rankingsErrorKind === "auth" || rankingsErrorKind === "forbidden" ? (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-sm text-slate-200">
              <p>{rankingsError}</p>
              {rankingsErrorKind === "auth" ? (
                <Link
                  href="/login"
                  className="mt-4 inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
                >
                  Sign in
                </Link>
              ) : (
                <Link
                  href="/dashboard"
                  className="mt-4 inline-flex items-center rounded-full border border-white/20 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Back to your leagues
                </Link>
              )}
            </div>
          ) : (
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-200">
              {rankingsError}
            </div>
          )
        ) : null}

        {!rankingsLoading && !rankingsError && heroData ? (
          <>
            <div className="mb-6 grid gap-4 lg:grid-cols-4">
              <HeroCard
                title={t("powerRankingsPage.hero.champion")}
                headline={heroData.champion.teamName}
                detail={tInterpolate("powerRankingsPage.hero.championDetail", {
                  rank: heroData.champion.rank,
                  record: heroData.champion.record,
                  score: heroData.champion.score,
                })}
                accent="border-amber-500/20 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.15),transparent_45%),#0c0c1e]"
              />
              <HeroCard
                title={t("powerRankingsPage.hero.strongest")}
                headline={heroData.strongest.teamName}
                detail={tInterpolate("powerRankingsPage.hero.strongestDetail", {
                  value: Math.round(
                    heroData.strongest.raw.starterValue + heroData.strongest.raw.benchValue
                  ).toLocaleString(),
                })}
                accent="border-emerald-500/20 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.15),transparent_45%),#0c0c1e]"
              />
              <HeroCard
                title={t("powerRankingsPage.hero.marketLeader")}
                headline={heroData.marketLeader.teamName}
                detail={tInterpolate("powerRankingsPage.hero.marketLeaderDetail", {
                  mv: heroData.marketLeader.mvScore,
                })}
                accent="border-cyan-500/20 bg-[radial-gradient(circle_at_top,rgba(6,182,212,0.15),transparent_45%),#0c0c1e]"
              />
              <HeroCard
                title={t("powerRankingsPage.hero.tradeMarket")}
                headline={
                  heroData.marketInsight
                    ? tInterpolate("powerRankingsPage.hero.tradeDemand", {
                        position: heroData.marketInsight.position,
                      })
                    : t("powerRankingsPage.hero.tradeNoData")
                }
                detail={
                  heroData.marketInsight?.label ?? t("powerRankingsPage.hero.tradeDetailFallback")
                }
                accent="border-violet-500/20 bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.15),transparent_45%),#0c0c1e]"
                ctaHref="/trade-evaluator"
                ctaLabel={t("powerRankingsPage.hero.openTradeHub")}
              />
            </div>

            <div className="rounded-3xl border border-white/8 bg-[#0c0c1e] p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/40">
                    {t("powerRankingsPage.tableTitle")}
                  </div>
                  <div className="mt-1 text-sm text-white/45">
                    {rankingsMeta
                      ? tInterpolate("powerRankingsPage.tableMeta", {
                          name: rankingsMeta.leagueName,
                          week: String(rankingsMeta.week),
                          updated: rankingsMeta.computedAt
                            ? tInterpolate("powerRankingsPage.updatedPrefix", {
                                time: new Date(rankingsMeta.computedAt).toLocaleString(),
                              })
                            : t("powerRankingsPage.freshLoad"),
                        })
                      : null}
                  </div>
                </div>
                <div className="text-xs text-white/35">
                  {tInterpolate("powerRankingsPage.managerCount", {
                    n: displayedTeams.length,
                  })}
                </div>
              </div>

              <div className="mb-3 hidden md:grid grid-cols-[52px_minmax(0,1.5fr)_90px_180px_80px_120px_120px_42px] gap-3 px-4 text-[10px] font-bold uppercase tracking-[0.24em] text-white/30">
                <div>{t("powerRankingsPage.col.rank")}</div>
                <div>{t("powerRankingsPage.col.team")}</div>
                <div className="text-center">{t("powerRankingsPage.col.record")}</div>
                <div className="text-center">{t("powerRankingsPage.col.score")}</div>
                <div className="text-center">{t("powerRankingsPage.col.wsPsMvs")}</div>
                <div className="text-center">{t("powerRankingsPage.col.trend")}</div>
                <div>{t("powerRankingsPage.col.strengthRisk")}</div>
                <div />
              </div>

              <div className="space-y-3">
                {displayedTeams.map((team, index) => (
                  <TeamRow
                    key={team.rosterId}
                    team={team}
                    displayRank={index + 1}
                    expanded={expandedRosterId === team.rosterId}
                    detailLoading={detailLoadingRosterId === team.rosterId}
                    onToggle={() => void toggleExpanded(team)}
                    currentJob={activeJob}
                    onCoach={requestCoach}
                    onRoadmap={requestRoadmap}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

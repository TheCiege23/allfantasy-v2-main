"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Check, GripVertical, Loader2, Sparkles } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  fetchWorldCupGroupStageView,
  saveWorldCupGroupRankingClient,
  saveWorldCupThirdPlaceAdvancersClient,
  type WorldCupGroupStageTeamClient,
  type WorldCupGroupStageViewClient,
} from "@/lib/world-cup/worldCupClientApi"
import WorldCupTeamFlag from "./WorldCupTeamFlag"
import {
  buildWorldCupGroupStageGroupInsights,
  buildWorldCupGroupStageThirdPlaceInsights,
} from "@/lib/world-cup/worldCupAiInsights"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

type TranslateFn = ReturnType<typeof makeWcT>

type Props = {
  challengeId: string
  entryId: string
  onCompletionChanged?: () => void
  onDirtyChange?: (hasUnsavedChanges: boolean) => void
  onContinueToKnockouts?: () => void
  aiInsightsUnlocked?: boolean
}

type GroupSaveState = "idle" | "dirty" | "saving" | "saved" | "error"

function orderedTeamIdsForGroup(view: WorldCupGroupStageViewClient, groupId: string): string[] {
  const group = view.groups.find((row) => row.id === groupId)
  const picks = view.groupRankingPicks
    .filter((pick) => pick.groupId === groupId)
    .sort((a, b) => a.predictedRank - b.predictedRank)
    .map((pick) => pick.teamId)
  if (picks.length === 4) return picks
  return group?.teams.slice().sort((a, b) => a.seedOrder - b.seedOrder).map((team) => team.teamId) ?? []
}

function isGroupRanked(view: WorldCupGroupStageViewClient, groupId: string): boolean {
  const ranks = new Set(
    view.groupRankingPicks
      .filter((pick) => pick.groupId === groupId)
      .map((pick) => pick.predictedRank)
  )
  return [1, 2, 3, 4].every((rank) => ranks.has(rank))
}

function findTeam(groupTeams: WorldCupGroupStageTeamClient[], teamId: string) {
  return groupTeams.find((team) => team.teamId === teamId) ?? null
}

function resultBorderClass(status: "correct" | "wrong" | "pending" | "none") {
  if (status === "correct") return "border-cyan-300/80 shadow-[0_0_0_1px_rgba(103,232,249,0.28)]"
  if (status === "wrong") return "border-rose-400/70 shadow-[0_0_0_1px_rgba(251,113,133,0.2)]"
  if (status === "pending") return "border-amber-300/70 shadow-[0_0_0_1px_rgba(252,211,77,0.22)]"
  return "border-white/10"
}

function resultBadge(
  status: "correct" | "wrong" | "pending" | "none",
  t: TranslateFn,
  pointsAwarded = 0
) {
  if (status === "correct")
    return {
      label: t("wc.groupStage.resultCorrect", { points: pointsAwarded }),
      className: "border-cyan-300/30 bg-cyan-300/10 text-white/90",
    }
  if (status === "wrong")
    return {
      label: t("wc.groupStage.resultWrong"),
      className: "border-rose-300/30 bg-rose-400/10 text-white/85",
    }
  if (status === "pending")
    return {
      label: t("wc.groupStage.resultPending"),
      className: "border-amber-300/25 bg-amber-400/10 text-white/80",
    }
  return null
}

function groupPickForTeam(view: WorldCupGroupStageViewClient, groupId: string, teamId: string) {
  return view.groupRankingPicks.find((pick) => pick.groupId === groupId && pick.teamId === teamId) ?? null
}

function groupRankingResultStatus(view: WorldCupGroupStageViewClient, groupId: string, teamId: string) {
  const pick = groupPickForTeam(view, groupId, teamId)
  if (!pick) return "none"
  if (pick.isCorrect === true) return "correct"
  if (pick.isCorrect === false) return "wrong"
  return pick.actualRank ? "pending" : "pending"
}

function thirdPlaceResultStatus(view: WorldCupGroupStageViewClient, teamId: string | null | undefined) {
  if (!teamId) return "none"
  const pick = view.thirdPlaceAdvancerPicks.find((row) => row.teamId === teamId && row.isSelected)
  if (!pick) return "none"
  if (pick.isCorrect === true) return "correct"
  if (pick.isCorrect === false) return "wrong"
  return "pending"
}

function moveItem(ids: string[], index: number, direction: -1 | 1) {
  const nextIndex = index + direction
  if (nextIndex < 0 || nextIndex >= ids.length) return ids
  const next = [...ids]
  const current = next[index]
  next[index] = next[nextIndex]
  next[nextIndex] = current
  return next
}

function sameOrderedValues(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameValueSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

function savedThirdPlaceTeamIds(view: WorldCupGroupStageViewClient): string[] {
  return view.thirdPlaceAdvancerPicks
    .filter((pick) => pick.isSelected)
    .map((pick) => pick.teamId)
}

function SortableTeamRow({
  teamId,
  index,
  orderLength,
  team,
  status,
  badge,
  groupKey,
  groupId,
  order,
  isLocked,
  t,
  setGroupOrder,
}: {
  teamId: string
  index: number
  orderLength: number
  team: WorldCupGroupStageTeamClient | null
  status: "correct" | "wrong" | "pending" | "none"
  badge: { label: string; className: string } | null
  groupKey: string
  groupId: string
  order: string[]
  isLocked: boolean
  t: TranslateFn
  setGroupOrder: (groupId: string, orderedTeamIds: string[]) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: teamId })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 10 } : {}),
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`world-cup-group-pick-result-${groupKey}-${teamId}`}
      data-result-state={status}
      className={`flex flex-wrap items-center gap-2 rounded-xl border bg-black/20 px-2 py-2 sm:flex-nowrap ${resultBorderClass(status)}${isDragging ? " opacity-60 ring-2 ring-cyan-300/40" : ""}`}
    >
      {/* Drag handle — 44 px touch target; sr-only Move Up/Down remain for keyboard/a11y */}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t("wc.groupStage.dragHandle", { team: team?.name ?? teamId })}
        disabled={isLocked}
        className={[
          "flex h-11 w-7 shrink-0 touch-none items-center justify-center rounded-lg text-white/30 transition hover:text-white/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300",
          isLocked ? "cursor-not-allowed opacity-30" : "cursor-grab active:cursor-grabbing",
        ].join(" ")}
        style={{ touchAction: "none" }}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <span className={[
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-black",
        index === 0
          ? "border border-amber-400/40 bg-amber-400/[0.12] text-amber-200"
          : index === 1
          ? "border border-white/20 bg-white/[0.08] text-white/80"
          : "border border-white/10 bg-white/[0.04] text-white/55",
      ].join(" ")}>
        {index + 1}
      </span>
      <WorldCupTeamFlag
        teamName={team?.name}
        countryCode={team?.fifaCode ?? undefined}
        flagUrl={team?.flagUrl ?? undefined}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        {/* Team name (team?.name) is intentionally NOT translated — see Phase 5 brief. */}
        <div className="truncate text-sm font-bold text-white">{team?.name ?? teamId}</div>
        <div className="truncate text-xs text-white/40">
          {team?.country ?? t("wc.groupStage.teamFallback")}
          {team?.actualRank ? ` · ${t("wc.groupStage.actualRank", { rank: team.actualRank })}` : ""}
        </div>
      </div>
      {badge ? (
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${badge.className}`}>
          {badge.label}
        </span>
      ) : null}
      {/* sr-only Move Up / Move Down — keyboard + assistive-tech fallback; existing tests rely on these */}
      <div className="sr-only">
        <button
          type="button"
          onClick={() => setGroupOrder(groupId, moveItem(order, index, -1))}
          disabled={isLocked || index === 0}
        >
          {t("wc.groupStage.moveUp")}
        </button>
        <button
          type="button"
          onClick={() => setGroupOrder(groupId, moveItem(order, index, 1))}
          disabled={isLocked || index === orderLength - 1}
        >
          {t("wc.groupStage.moveDown")}
        </button>
      </div>
    </div>
  )
}

function GroupAiInsightPanel({
  groupName,
  groupKey,
  order,
  teams,
  unlocked,
  t,
}: {
  groupName: string
  groupKey: string
  order: string[]
  teams: WorldCupGroupStageTeamClient[]
  unlocked: boolean
  t: TranslateFn
}) {
  const insightTeams = teams.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    seedOrder: team.seedOrder,
  }))
  const insights = buildWorldCupGroupStageGroupInsights({
    groupName,
    groupKey,
    teams: insightTeams,
    order,
  })
  return (
    <details
      data-testid={`world-cup-group-ai-insight-${groupName.replace(/\s+/g, "-").toLowerCase()}`}
      className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3 text-xs text-white/90"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-black">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          {t("wc.groupStage.aiTitle")}
        </span>
        <span className="rounded-full border border-cyan-200/25 px-2 py-0.5 text-[10px] uppercase tracking-wide">
          {unlocked ? t("wc.groupStage.aiTierOpen") : t("wc.groupStage.aiTierLocked")}
        </span>
      </summary>
      {unlocked ? (
        <div className="mt-3 space-y-2 leading-5 text-white/75">
          {insights.map((line, idx) => (
            <p key={idx} data-testid={`world-cup-group-ai-insight-line-${idx}`}>
              {line}
            </p>
          ))}
          <p className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-white/55">
            {t("wc.groupStage.aiPrivacyNote")}
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[11px] leading-5 text-white/60">
          {t("wc.groupStage.aiLockedBody")}
        </div>
      )}
    </details>
  )
}

function ThirdPlaceAiInsightPanel({
  groups,
  thirdPlacePicks,
  unlocked,
  t,
}: {
  groups: WorldCupGroupStageViewClient["groups"]
  thirdPlacePicks: WorldCupGroupStageViewClient["thirdPlaceAdvancerPicks"]
  unlocked: boolean
  t: TranslateFn
}) {
  const insightGroups = groups.map((g) => ({
    id: g.id,
    groupKey: g.groupKey,
    displayName: g.displayName,
    teams: g.teams.map((t) => ({ teamId: t.teamId, name: t.name, seedOrder: t.seedOrder })),
  }))
  const insights = buildWorldCupGroupStageThirdPlaceInsights({
    groups: insightGroups,
    thirdPlacePicks: thirdPlacePicks.map((p) => ({
      groupId: p.groupId,
      teamId: p.teamId,
      isSelected: p.isSelected,
    })),
  })
  return (
    <details data-testid="world-cup-third-place-ai-insight" className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.055] p-3 text-xs text-white/90">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-black">
        <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> {t("wc.thirdPlace.aiTitle")}</span>
        <span className="rounded-full border border-cyan-200/25 px-2 py-0.5 text-[10px] uppercase tracking-wide">{unlocked ? t("wc.groupStage.aiTierOpen") : t("wc.groupStage.aiTierLocked")}</span>
      </summary>
      {unlocked ? (
        <div className="mt-3 space-y-2 leading-5 text-white/75">
          {insights.map((line, idx) => (
            <p key={idx} data-testid={`world-cup-third-place-ai-insight-line-${idx}`}>
              {line}
            </p>
          ))}
          <p className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-white/55">
            {t("wc.groupStage.aiPrivacyNote")}
          </p>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[11px] leading-5 text-white/60">
          {t("wc.thirdPlace.aiLockedBody")}
        </div>
      )}
    </details>
  )
}

export default function WorldCupGroupStagePicks({ challengeId, entryId, onCompletionChanged, onDirtyChange, onContinueToKnockouts, aiInsightsUnlocked = false }: Props) {
  // Hydration-safe: locale flows from the global LanguageProviderClient
  // which reads <html data-lang> on first render — SSR HTML matches the
  // first CSR pass.
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const [view, setView] = useState<WorldCupGroupStageViewClient | null>(null)
  const [localOrders, setLocalOrders] = useState<Record<string, string[]>>({})
  const [saveStates, setSaveStates] = useState<Record<string, GroupSaveState>>({})
  const [thirdPlaceSelection, setThirdPlaceSelection] = useState<Set<string>>(new Set())
  const [thirdPlaceStatus, setThirdPlaceStatus] = useState<GroupSaveState>("idle")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [thirdPlaceError, setThirdPlaceError] = useState<string | null>(null)
  const savingGroupIdsRef = useRef<Set<string>>(new Set())
  const savingThirdPlaceRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    fetchWorldCupGroupStageView(challengeId, entryId)
      .then((nextView) => {
        if (cancelled) return
        setView(nextView)
        const nextOrders: Record<string, string[]> = {}
        const nextSaveStates: Record<string, GroupSaveState> = {}
        for (const group of nextView.groups) {
          nextOrders[group.id] = orderedTeamIdsForGroup(nextView, group.id)
          if (isGroupRanked(nextView, group.id)) nextSaveStates[group.id] = "saved"
        }
        setLocalOrders(nextOrders)
        setSaveStates(nextSaveStates)
        setThirdPlaceSelection(new Set(nextView.thirdPlaceAdvancerPicks.filter((pick) => pick.isSelected).map((pick) => pick.teamId)))
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : t("wc.groupStage.failedLoad"))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [challengeId, entryId, t])

  const isLocked = Boolean(view?.lock.isLocked)
  const hasUnsavedThirdPlaceChanges = Boolean(
    view && !sameValueSet([...thirdPlaceSelection], savedThirdPlaceTeamIds(view))
  )
  const hasUnsavedGroupOrderChanges = Boolean(
    view?.groups.some((group) =>
      !sameOrderedValues(
        localOrders[group.id] ?? orderedTeamIdsForGroup(view, group.id),
        orderedTeamIdsForGroup(view, group.id)
      )
    )
  )
  const hasUnsavedChanges = hasUnsavedGroupOrderChanges || hasUnsavedThirdPlaceChanges

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges)
    return () => onDirtyChange?.(false)
  }, [hasUnsavedChanges, onDirtyChange])

  const thirdPlaceCandidates = useMemo(() => {
    if (!view) return []
    return view.groups.map((group) => {
      const order = localOrders[group.id] ?? orderedTeamIdsForGroup(view, group.id)
      const teamId = order[2] ?? null
      const team = teamId ? findTeam(group.teams, teamId) : null
      return { groupId: group.id, groupKey: group.groupKey, displayName: group.displayName, team }
    })
  }, [localOrders, view])

  function setGroupOrder(groupId: string, orderedTeamIds: string[]) {
    setLocalOrders((prev) => ({ ...prev, [groupId]: orderedTeamIds }))
    setSaveStates((prev) => ({ ...prev, [groupId]: "dirty" }))
  }

  async function saveGroup(groupId: string) {
    if (savingGroupIdsRef.current.has(groupId)) return
    const orderedTeamIds = localOrders[groupId] ?? []
    const group = view?.groups.find((row) => row.id === groupId)
    // Only skip the API call if the group is already persisted in the DB with these exact picks.
    // If the group hasn't been ranked yet (no DB picks), we must call the API even when the
    // displayed order matches the default seed order — otherwise allGroupsRanked never becomes
    // true and third-place selection stays locked forever.
    const alreadyRanked = view ? isGroupRanked(view, groupId) : false
    if (alreadyRanked && view && sameOrderedValues(orderedTeamIds, orderedTeamIdsForGroup(view, groupId))) {
      setSaveStates((prev) => ({ ...prev, [groupId]: "saved" }))
      return
    }
    if (group && group.teams.length !== 4) {
      setSaveStates((prev) => ({ ...prev, [groupId]: "error" }))
      setError(t("wc.groupStage.needsFourTeams", { group: group.displayName }))
      return
    }
    savingGroupIdsRef.current.add(groupId)
    setSaveStates((prev) => ({ ...prev, [groupId]: "saving" }))
    setError(null)
    try {
      const nextView = await saveWorldCupGroupRankingClient(challengeId, entryId, groupId, orderedTeamIds)
      setView(nextView)
      // Only update the saved group's local order — do NOT clobber other groups'
      // in-progress edits that the user hasn't saved yet.
      setLocalOrders((prev) => ({
        ...prev,
        [groupId]: orderedTeamIdsForGroup(nextView, groupId),
      }))
      setSaveStates((prev) => ({ ...prev, [groupId]: "saved" }))
      setThirdPlaceSelection(new Set(nextView.thirdPlaceAdvancerPicks.filter((pick) => pick.isSelected).map((pick) => pick.teamId)))
      onCompletionChanged?.()
    } catch (err) {
      setSaveStates((prev) => ({ ...prev, [groupId]: "error" }))
      setError(err instanceof Error ? err.message : t("wc.groupStage.failedSave"))
    } finally {
      savingGroupIdsRef.current.delete(groupId)
    }
  }

  function toggleThirdPlace(teamId: string) {
    if (isLocked || !view?.completion.allGroupsRanked) return
    setThirdPlaceSelection((prev) => {
      const next = new Set(prev)
      if (next.has(teamId)) {
        next.delete(teamId)
      } else if (next.size < 8) {
        next.add(teamId)
      } else {
        setThirdPlaceError(t("wc.thirdPlace.errorChoose8"))
      }
      return next
    })
    setThirdPlaceStatus("dirty")
  }

  async function saveThirdPlace() {
    if (savingThirdPlaceRef.current) return
    setThirdPlaceError(null)
    if (!view?.completion.allGroupsRanked) {
      setThirdPlaceError(t("wc.thirdPlace.errorRankFirst"))
      return
    }
    if (thirdPlaceSelection.size !== 8) {
      setThirdPlaceError(t("wc.thirdPlace.errorChoose8"))
      return
    }
    savingThirdPlaceRef.current = true
    setThirdPlaceStatus("saving")
    try {
      const nextView = await saveWorldCupThirdPlaceAdvancersClient(challengeId, entryId, {
        selectedTeamIds: [...thirdPlaceSelection],
      })
      setView(nextView)
      setThirdPlaceSelection(new Set(nextView.thirdPlaceAdvancerPicks.filter((pick) => pick.isSelected).map((pick) => pick.teamId)))
      setThirdPlaceStatus("saved")
      onCompletionChanged?.()
    } catch (err) {
      setThirdPlaceStatus("error")
      setThirdPlaceError(err instanceof Error ? err.message : t("wc.thirdPlace.failedSave"))
    } finally {
      savingThirdPlaceRef.current = false
    }
  }

  if (isLoading) {
    return (
      <section data-testid="world-cup-group-stage-loading" className="mx-auto max-w-6xl rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-white/55">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        {t("wc.groupStage.loading")}
      </section>
    )
  }

  if (error && !view) {
    return (
      <section className="mx-auto max-w-4xl rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm text-white/85">
        {error}
      </section>
    )
  }

  if (!view) return null

  return (
    <section data-testid="world-cup-group-stage-picks" className="mx-auto max-w-6xl space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-white">{t("wc.groupStage.title")}</h2>
            <p className="mt-1 text-sm text-white/50">
              {t("wc.groupStage.subtitle")}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-bold text-white/70">
            {t("wc.groupStage.rankedCount", { done: view.completion.groupsRankedCount })}
          </div>
        </div>
        {isLocked ? (
          <p className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs font-bold text-white/85">
            {view.lock.lockReason
              ? t("wc.groupStage.lockedWithReason", { reason: view.lock.lockReason })
              : t("wc.groupStage.lockedNoReason")}
          </p>
        ) : null}
        {error ? <p className="mt-3 rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-white/85">{error}</p> : null}
        {view.warnings.length > 0 ? (
          <div className="mt-3 space-y-1 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs text-white/80">
            {view.warnings.slice(0, 4).map((warning) => (
              <p key={`${warning.code}-${warning.groupKey ?? warning.message}`}>{warning.message}</p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {view.groups.map((group) => {
          const order = localOrders[group.id] ?? orderedTeamIdsForGroup(view, group.id)
          const state = saveStates[group.id] ?? "idle"
          const hasCompleteTeams = group.teams.length === 4 && order.length === 4
          const hasUnsavedOrderChanges = !sameOrderedValues(order, orderedTeamIdsForGroup(view, group.id))
          return (
            <div
              key={group.id}
              data-testid={`world-cup-group-${group.groupKey}`}
              className={[
                "rounded-2xl border p-3 transition-colors",
                saveStates[group.id] === "saved" && !saveStates[group.id]
                  ? "border-cyan-300/20 bg-cyan-300/[0.03]"
                  : "border-white/10 bg-white/[0.03]",
              ].join(" ")}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {/* Prominent group badge */}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] text-sm font-black text-white/80">
                    {group.groupKey}
                  </span>
                  <h3 className="font-black text-white">{group.displayName}</h3>
                </div>
                <span className={[
                  "rounded-full px-2 py-0.5 text-[10px] font-black",
                  isGroupRanked(view, group.id)
                    ? "border border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-200"
                    : "border border-white/10 bg-white/[0.04] text-white/40",
                ].join(" ")}>
                  {isGroupRanked(view, group.id)
                    ? t("wc.groupStage.ranked")
                    : t("wc.groupStage.teamCount", { count: order.length })}
                </span>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  const { active, over } = event
                  if (!over || active.id === over.id) return
                  const oldIndex = order.indexOf(String(active.id))
                  const newIndex = order.indexOf(String(over.id))
                  if (oldIndex < 0 || newIndex < 0) return
                  setGroupOrder(group.id, arrayMove(order, oldIndex, newIndex))
                }}
              >
                <SortableContext items={order} strategy={verticalListSortingStrategy}>
                  <div className="space-y-2">
                    {order.map((teamId, index) => {
                      const team = findTeam(group.teams, teamId)
                      const pick = groupPickForTeam(view, group.id, teamId)
                      const status = groupRankingResultStatus(view, group.id, teamId)
                      const badge = resultBadge(status, t, pick?.pointsAwarded ?? 0)
                      return (
                        <SortableTeamRow
                          key={teamId}
                          teamId={teamId}
                          index={index}
                          orderLength={order.length}
                          team={team}
                          status={status}
                          badge={badge}
                          groupKey={group.groupKey}
                          groupId={group.id}
                          order={order}
                          isLocked={isLocked}
                          t={t}
                          setGroupOrder={setGroupOrder}
                        />
                      )
                    })}
                  </div>
                </SortableContext>
              </DndContext>
              {!hasCompleteTeams ? (
                <p className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs font-bold text-white/80">
                  {t("wc.groupStage.needsFourTeams", { group: group.displayName })}
                </p>
              ) : null}
              {hasUnsavedOrderChanges ? (
                <p className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-white/90">
                  {t("wc.groupStage.unsavedOrder")}
                </p>
              ) : state === "saved" ? (
                <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-white/90">
                  {t("wc.groupStage.savedReviewUses")}
                </p>
              ) : null}
              <GroupAiInsightPanel
                groupName={group.displayName}
                groupKey={group.groupKey}
                order={order}
                teams={group.teams}
                unlocked={aiInsightsUnlocked}
                t={t}
              />
              <button
                type="button"
                onClick={() => void saveGroup(group.id)}
                disabled={isLocked || state === "saving" || state === "saved" || !hasCompleteTeams}
                className="mt-3 min-h-11 w-full touch-manipulation rounded-xl bg-cyan-300 px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-45"
              >
                {state === "saving"
                  ? t("wc.groupStage.saving")
                  : state === "saved" && !hasUnsavedOrderChanges
                    ? t("wc.groupStage.saved")
                    : state === "error"
                      ? t("wc.groupStage.retrySave")
                      : t("wc.groupStage.saveGroup")}
              </button>
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-white">{t("wc.thirdPlace.title")}</h3>
            <p className="mt-1 text-sm text-white/50">
              {t("wc.thirdPlace.subtitle")}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div data-testid="world-cup-third-place-count" className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-bold text-white/70">
              {t("wc.thirdPlace.selectedCount", { count: thirdPlaceSelection.size })}
            </div>
            <button
              type="button"
              onClick={() => void saveThirdPlace()}
              disabled={isLocked || !view.completion.allGroupsRanked || thirdPlaceStatus === "saving" || !hasUnsavedThirdPlaceChanges}
              className="min-h-11 rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-black touch-manipulation disabled:cursor-not-allowed disabled:opacity-45"
            >
              {thirdPlaceStatus === "saving"
                ? t("wc.thirdPlace.saving")
                : thirdPlaceStatus === "saved"
                  ? t("wc.thirdPlace.saved")
                  : t("wc.thirdPlace.saveBtn")}
            </button>
          </div>
        </div>

        {!view.completion.allGroupsRanked ? (
          <p className="mt-3 rounded-lg border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs text-white/80">
            {t("wc.thirdPlace.rankAllFirst")}
          </p>
        ) : null}
        {thirdPlaceError ? <p className="mt-3 rounded-lg bg-rose-400/10 px-3 py-2 text-xs text-white/85">{thirdPlaceError}</p> : null}
        {hasUnsavedThirdPlaceChanges ? (
          <p className="mt-3 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-white/90">
            {t("wc.thirdPlace.unsaved")}
          </p>
        ) : thirdPlaceStatus === "saved" ? (
          <p className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-white/90">
            {t("wc.thirdPlace.savedReviewUses")}
          </p>
        ) : null}
        <ThirdPlaceAiInsightPanel
          groups={view.groups}
          thirdPlacePicks={view.thirdPlaceAdvancerPicks.map((pick) => ({
            ...pick,
            isSelected: thirdPlaceSelection.has(pick.teamId),
          }))}
          unlocked={aiInsightsUnlocked}
          t={t}
        />

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {thirdPlaceCandidates.map((candidate) => {
            const isSelected = Boolean(candidate.team?.teamId && thirdPlaceSelection.has(candidate.team.teamId))
            const status = thirdPlaceResultStatus(view, candidate.team?.teamId)
            const pick = candidate.team?.teamId
              ? view.thirdPlaceAdvancerPicks.find((row) => row.teamId === candidate.team?.teamId && row.isSelected)
              : null
            const badge = resultBadge(status, t, pick?.pointsAwarded ?? 0)
            return (
              <label
                key={candidate.groupId}
                data-testid={`world-cup-third-place-result-${candidate.groupKey}`}
                data-result-state={status}
                data-selected={isSelected ? "true" : "false"}
                className={[
                  "flex min-h-[4.75rem] items-center gap-3 rounded-2xl border px-3 py-3 text-sm transition",
                  resultBorderClass(status),
                  isSelected
                    ? "border-cyan-200 bg-cyan-300/[0.18] text-white/90 shadow-[0_0_0_2px_rgba(103,232,249,0.35),0_14px_36px_rgba(8,145,178,0.22)]"
                    : "border-white/10 bg-black/25 text-white/75",
                  isLocked || !view.completion.allGroupsRanked || !candidate.team ? "opacity-60" : "cursor-pointer hover:border-cyan-200/50 hover:bg-cyan-300/10",
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => candidate.team && toggleThirdPlace(candidate.team.teamId)}
                  disabled={isLocked || !view.completion.allGroupsRanked || !candidate.team}
                  className="sr-only"
                  aria-label={t("wc.thirdPlace.selectAria", {
                    name: candidate.team?.name ?? candidate.displayName,
                  })}
                />
                <span
                  aria-hidden
                  className={[
                    "grid h-9 w-9 shrink-0 place-items-center rounded-xl border text-sm font-black",
                    isSelected
                      ? "border-cyan-100 bg-cyan-200 text-slate-950 shadow-[0_0_18px_rgba(103,232,249,0.45)]"
                      : "border-white/15 bg-white/[0.06] text-white/30",
                  ].join(" ")}
                >
                  {isSelected ? <Check className="h-5 w-5 stroke-[3]" /> : candidate.groupKey}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={isSelected ? "block text-xs font-black uppercase tracking-wide text-white/90" : "block text-xs font-black uppercase tracking-wide text-white/45"}>
                    {candidate.displayName}
                  </span>
                  {/* Team name (candidate.team?.name) intentionally untranslated — Phase 5 brief. */}
                  <span className="block truncate text-base font-black text-white">{candidate.team?.name ?? t("wc.thirdPlace.noPickYet")}</span>
                  <span className={isSelected ? "mt-0.5 block text-[11px] font-bold text-white/90" : "mt-0.5 block text-[11px] text-white/40"}>
                    {isSelected ? t("wc.thirdPlace.selectedToAdvance") : t("wc.thirdPlace.tapToSelect")}
                  </span>
                </span>
                {badge ? (
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${badge.className}`}>
                    {badge.label}
                  </span>
                ) : null}
              </label>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => void saveThirdPlace()}
          disabled={isLocked || !view.completion.allGroupsRanked || thirdPlaceStatus === "saving" || !hasUnsavedThirdPlaceChanges}
          className="mt-4 min-h-11 w-full rounded-xl bg-cyan-300 px-4 py-2 text-sm font-black text-black touch-manipulation disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
        >
          {thirdPlaceStatus === "saving"
            ? t("wc.thirdPlace.saving")
            : thirdPlaceStatus === "saved"
              ? t("wc.thirdPlace.savePicksDone")
              : t("wc.thirdPlace.savePrimaryBtn")}
        </button>
      </div>

      {/* Continue to Knockout Bracket — shown when all groups and third-place picks are saved */}
      {onContinueToKnockouts && view.completion.allGroupsRanked && (
        <div
          data-testid="group-stage-continue-knockouts"
          className="rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.06] p-4 sm:p-5"
        >
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-black text-white">{t("wc.groupStage.continueTitle")}</h3>
              <p className="mt-1 text-sm text-white/55">{t("wc.groupStage.continueBody")}</p>
            </div>
            <button
              type="button"
              onClick={onContinueToKnockouts}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-b from-cyan-300 to-cyan-400 px-5 py-2.5 text-sm font-black text-slate-950 shadow-[0_6px_24px_-8px_rgba(34,211,238,0.55)] transition-transform hover:scale-[1.02] active:scale-[0.98] touch-manipulation"
              data-testid="group-stage-continue-btn"
            >
              {t("wc.groupStage.continueBtn")}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

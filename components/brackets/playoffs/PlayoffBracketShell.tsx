"use client"

import { useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { useSession } from "next-auth/react"
import { ArrowLeft, RefreshCw, Trophy, Plus, Link2, Clipboard, Settings2, ArrowRightCircle, AlertTriangle, Users, Gamepad2, Lock } from "lucide-react"
import { toast } from "sonner"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import {
  createPlayoffBracketEntryClient,
  getPlayoffBracketViewClient,
} from "@/lib/playoffs/playoffClientApi"
import { hasPoolAdminAccess } from "@/lib/auth/admin"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import LanguageToggle from "@/components/i18n/LanguageToggle"
import { poolDashboardCopy } from "@/lib/brackets/poolDashboardCopy"
import PlayoffSyncDiagnosticsPanel from "./PlayoffSyncDiagnosticsPanel"
import "../bracket-experience.css"
import "./pool-dashboard.css"

type Props = {
  initialView: PlayoffChallengeView
}

type PlayoffDashboardSyncMode = "teams_schedule_only" | "results_only" | "official_bracket" | "autofill_results"

const SYNC_SUCCESS_MESSAGES: Record<PlayoffDashboardSyncMode, string> = {
  teams_schedule_only: "Teams and schedule updated. User picks were not changed.",
  results_only: "Results synced. Reopen the entry or use Show Pick Results to verify Correct/Wrong picks.",
  official_bracket: "Official bracket data synced. User picks were not changed.",
  autofill_results: "Testing only sync completed. Picks were filled from official winners.",
}

/*
 * ⚠ SAME CANVAS AS THE BRACKET HUB, IN EVERY APP MODE. The hub
 * (app/brackets/page.tsx, bracket-experience.css) is deliberately the approved
 * dark bracket canvas in light, dark and AF modes; this page used to be
 * light-only cards, which made it the one bracket surface that changed
 * personality when you clicked into a league. Colours are scoped to `.af-pd`,
 * so `html[data-mode]` cannot leak a page palette in.
 *
 * Commissioner sync tools stay English on purpose: they are staff and
 * commissioner diagnostics, and their messages are asserted verbatim.
 */
export default function PlayoffBracketShell({ initialView }: Props) {
  const router = useRouter()
  const { data: session } = useSession()
  const { language } = useOptionalLanguage()
  const copy = poolDashboardCopy(language)
  const syncToolsRef = useRef<HTMLElement | null>(null)
  const [view, setView] = useState(initialView)
  const [refreshing, startRefreshing] = useTransition()
  const [creatingEntry, startCreatingEntry] = useTransition()
  const [syncingSeries, startSyncingSeries] = useTransition()
  const [syncDiagnostics, setSyncDiagnostics] = useState<unknown>(null)
  const [syncStatus, setSyncStatus] = useState<{ type: "success" | "error"; message: string } | null>(null)

  const safeChallenge = {
    id: view?.challenge?.id || "unknown-challenge",
    name: view?.challenge?.name || "Pool Dashboard",
    sport: view?.challenge?.sport || "nba",
    seasonYear: view?.challenge?.seasonYear ?? new Date().getUTCFullYear(),
    maxEntriesPerParticipant: Number(view?.challenge?.maxEntriesPerParticipant ?? 5),
    inviteUrl: view?.challenge?.inviteUrl || "/brackets",
    inviteCode: view?.challenge?.inviteCode || "",
    visibility: view?.challenge?.visibility || "private",
    maxParticipants: Number(view?.challenge?.maxParticipants ?? 0),
    scoringStyle: view?.challenge?.scoringStyle || "series_winner",
    lockRule: view?.challenge?.lockRule || "first_tipoff",
    isTestMode: Boolean(view?.challenge?.isTestMode),
    ownerUserId: view?.challenge?.ownerUserId || null,
  }
  const participants = Array.isArray(view?.participants) ? view.participants : []
  const entries = Array.isArray(view?.entries) ? view.entries : []
  const series = Array.isArray(view?.series) ? view.series : []
  const totalSeries = series.length
  const singleGameSport = ["ncaaf", "nba_cup", "nfl"].includes(String(safeChallenge.sport ?? "").toLowerCase())
  const nflPool = String(safeChallenge.sport ?? "").toLowerCase() === "nfl"
  const hasTemplateSeries = singleGameSport
    ? !safeChallenge.isTestMode && series.some((item) => (!item.startsAt && (!nflPool || item.round === "nfl_wild_card")) || /^(?:CFP|EAST|WEST|AFC|NFC)\d+$/i.test(item.homeTeamName) || /^(?:CFP|EAST|WEST|AFC|NFC)\d+$/i.test(item.awayTeamName))
    : series.some((item) => /^Winner\s+S\d+$/i.test(item.homeTeamName) || /^Winner\s+S\d+$/i.test(item.awayTeamName)) ||
      (safeChallenge.isTestMode && !series.some((item) => item.winnerTeamName || item.status === "in_progress" || item.status === "final"))
  const myEntries = entries.filter((entry) => entry.userId === view?.viewerUserId)
  const viewerEntryCount = myEntries.length
  const tournamentLimit = view.viewerTournamentBracketLimit ?? null
  const tournamentUsed = view.viewerTournamentBracketUsed ?? null
  const tournamentQuotaReached = tournamentLimit != null && tournamentUsed != null && tournamentUsed >= tournamentLimit
  const rollingCup = safeChallenge.sport === "nba_cup" && !safeChallenge.isTestMode
  const tournamentLocked = singleGameSport && !rollingCup && !safeChallenge.isTestMode && view.challenge.firstGameStartsAt != null && Date.now() >= Date.parse(view.challenge.firstGameStartsAt)
  const canCreateEntry = viewerEntryCount < safeChallenge.maxEntriesPerParticipant && !tournamentLocked && !tournamentQuotaReached
  const primaryEntry = useMemo(() => {
    if (myEntries.length === 0) return null
    const activeViewerEntry = view.activeEntry && view.activeEntry.userId === view?.viewerUserId
      ? myEntries.find((entry) => entry.id === view.activeEntry?.id) ?? null
      : null
    return myEntries.find((entry) => !entry.isComplete) ?? activeViewerEntry ?? myEntries[0] ?? null
  }, [myEntries, view.activeEntry, view?.viewerUserId])
  const primaryButtonLabel = !primaryEntry
    ? tournamentLocked ? copy.entryClosed : !canCreateEntry ? copy.limitReached : copy.createFirst
    : primaryEntry.isComplete
      ? copy.viewEdit
      : copy.complete
  const leaderboardRows = useMemo(
    () => {
      const hasScoredResults = entries.some((entry) => (entry.resolvedPicks ?? 0) > 0 || (entry.totalScore ?? 0) > 0 || (entry.correctPicks ?? 0) > 0)
      return [...entries]
        .filter((entry) => !singleGameSport || entry.isComplete)
        .sort((a, b) => singleGameSport
          ? (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
          : hasScoredResults
            ? (b.totalScore ?? 0) - (a.totalScore ?? 0) || (b.correctPicks ?? 0) - (a.correctPicks ?? 0) || b.pickCount - a.pickCount
            : b.pickCount - a.pickCount)
        .map((entry, index) => ({
          rank: singleGameSport ? entry.rank ?? index + 1 : index + 1,
          id: entry.id,
          userId: entry.userId,
          name: entry.name || copy.bracketN(index + 1),
          picks: entry.pickCount,
          totalScore: entry.totalScore ?? 0,
          potentialTotal: entry.potentialTotal ?? 0,
          correctPicks: entry.correctPicks ?? 0,
          resolvedPicks: entry.resolvedPicks ?? 0,
          hasScoredResults,
        }))
    },
    [entries, singleGameSport, copy]
  )
  const bestViewerRow = singleGameSport && view.viewerUserId
    ? leaderboardRows.find((row) => row.userId === view.viewerUserId) ?? null
    : null
  const nearbyRivals = bestViewerRow
    ? leaderboardRows
      .filter((row) => row.userId !== view.viewerUserId)
      .sort((a, b) => Math.abs(a.rank - bestViewerRow.rank) - Math.abs(b.rank - bestViewerRow.rank) || a.rank - b.rank)
      .slice(0, 2)
    : []
  const hasScoredLeaderboard = leaderboardRows.some((row) => row.hasScoredResults)
  const hasClientAdminAccess = hasPoolAdminAccess(session?.user)
  const hasServerAdminAccess = view.lockDiagnostics?.hasPoolAdminAccess === true
  const hasAdminAccess = hasClientAdminAccess || hasServerAdminAccess
  const canManagePlayoffPool = safeChallenge.ownerUserId === view?.viewerUserId || hasAdminAccess
  const canSyncPlayoffPool = canManagePlayoffPool && !singleGameSport
  const canUseAutofillResults = safeChallenge.isTestMode && hasAdminAccess
  const isOwner = safeChallenge.ownerUserId === view?.viewerUserId
  const sportKey = String(safeChallenge.sport ?? "").toLowerCase()
  const sportName = copy.sportName[sportKey] ?? sportKey.toUpperCase()

  function handleRefresh() {
    startRefreshing(async () => {
      const latest = await getPlayoffBracketViewClient(safeChallenge.id)
      setView(latest)
    })
  }

  function openEntry(entryId: string) {
    router.push(`/brackets/leagues/${safeChallenge.id}/entries/${encodeURIComponent(entryId)}`)
  }

  function handleCreateEntry() {
    startCreatingEntry(async () => {
      try {
        const nextEntryIndex = viewerEntryCount + 1
        if (nextEntryIndex > safeChallenge.maxEntriesPerParticipant) {
          toast.error(copy.perUserLimit(safeChallenge.maxEntriesPerParticipant))
          return
        }

        const created = await createPlayoffBracketEntryClient({
          challengeId: safeChallenge.id,
        })

        toast.success(copy.created(nextEntryIndex))
        router.push(created.redirectUrl)
        const latest = await getPlayoffBracketViewClient(safeChallenge.id)
        setView(latest)
      } catch (error) {
        const message = error instanceof Error ? error.message : copy.createFailed
        toast.error(message)
      }
    })
  }

  function handleSyncSeries(mode: PlayoffDashboardSyncMode = "official_bracket") {
    startSyncingSeries(async () => {
      try {
        setSyncStatus(null)
        const response = await fetch(`/api/brackets/playoffs/${safeChallenge.id}/admin/sync-series?mode=${mode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to sync playoff series")
        }
        setSyncDiagnostics(payload)
        const warnings = Array.isArray(payload?.warnings) ? payload.warnings : []
        const ignoredPlayInGames = Number(payload?.diagnostics?.ignoredPlayInGames ?? 0)
        const trueWarnings = warnings.filter((warning: unknown) => !String(warning).toLowerCase().includes("play-in games ignored"))
        const successMessage = SYNC_SUCCESS_MESSAGES[mode]
        if (Number(payload?.seriesUpdated ?? 0) > 0) {
          toast.success(successMessage)
          if (ignoredPlayInGames > 0) {
            toast.info("Play-In games were ignored for this bracket.")
          }
          if (trueWarnings.length > 0) {
            toast.warning(trueWarnings[0])
          }
        } else if (trueWarnings.length > 0) {
          toast.warning(trueWarnings[0])
        } else {
          toast.success(successMessage)
        }
        setSyncStatus({ type: "success", message: successMessage })
        const latest = await getPlayoffBracketViewClient(safeChallenge.id)
        setView(latest)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to sync playoff series"
        setSyncStatus({ type: "error", message })
        toast.error(message)
      }
    })
  }

  async function copyInvite() {
    try {
      const absoluteUrl = `${window.location.origin}${safeChallenge.inviteUrl}`
      await navigator.clipboard.writeText(`${absoluteUrl}?code=${safeChallenge.inviteCode}`)
      toast.success(copy.inviteCopied)
    } catch {
      toast.error(copy.inviteCopyFailed)
    }
  }

  async function copyBestBracket() {
    if (!bestViewerRow) return
    try {
      const path = `/brackets/leagues/${safeChallenge.id}/entries/${bestViewerRow.id}/view`
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      toast.success(copy.bestCopied)
    } catch {
      toast.error(copy.bestCopyFailed)
    }
  }

  return (
    <main className="af-bracket-experience af-pd">
      <div className="af-bx-top af-pd-top">
        <Link href="/brackets" className="af-pd-back"><ArrowLeft className="h-4 w-4" aria-hidden />{copy.allBrackets}</Link>
        <Image src="/brand/allfantasy-wordmark-transparent.png" alt="AllFantasy" width={1198} height={306} className="af-pd-wordmark" />
        <LanguageToggle variant="compact" />
      </div>

      <div className="af-pd-shell">
        <section className="af-pd-hero">
          <svg className="af-pd-court" viewBox="0 0 1440 320" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <g>
              <line x1="720" y1="0" x2="720" y2="320" />
              <circle cx="720" cy="160" r="88" />
              <circle cx="720" cy="160" r="28" />
              <path d="M0 40 H150 A150 150 0 0 1 150 280 H0" />
              <path d="M1440 40 H1290 A150 150 0 0 0 1290 280 H1440" />
            </g>
          </svg>
          <div className="af-pd-hero-top">
            <div>
              <p className="af-pd-eyebrow">{copy.poolSeason(sportName, safeChallenge.seasonYear)}</p>
              <h1>{safeChallenge.name}</h1>
            </div>
            <button type="button" onClick={handleRefresh} disabled={refreshing} className="af-bx-btn">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              {copy.refresh}
            </button>
          </div>
          <div className="af-pd-chips">
            <span className="af-pd-chip af-pd-chip--accent"><Trophy className="h-3.5 w-3.5" aria-hidden />{copy.brackets(entries.length)}</span>
            <span className="af-pd-chip"><Users className="h-3.5 w-3.5" aria-hidden />{copy.participants(participants.length)}</span>
            <span className="af-pd-chip"><Gamepad2 className="h-3.5 w-3.5" aria-hidden />{copy.gamesOrSeries(totalSeries, singleGameSport)}</span>
            {singleGameSport && <span className="af-pd-chip"><Lock className="h-3.5 w-3.5" aria-hidden />{rollingCup ? copy.rollingLock : copy.fixedLock}</span>}
            {safeChallenge.isTestMode ? <span className="af-pd-chip af-pd-chip--warn">{copy.testMode}</span> : null}
          </div>
          {hasTemplateSeries ? (
            <div className="af-pd-banner">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span data-testid="playoff-template-warning">{singleGameSport
                ? rollingCup ? copy.cupTemplate : nflPool ? copy.nflTemplate : copy.singleTemplate
                : copy.seriesTemplate}</span>
            </div>
          ) : null}
        </section>

        <section className="af-pd-grid af-pd-grid--wide">
          <article className="af-bx-panel af-pd-card">
            <p className="af-pd-eyebrow">{copy.yourBracket}</p>
            <div className="af-pd-actions">
              <button
                type="button"
                onClick={() => {
                  if (!primaryEntry) {
                    handleCreateEntry()
                    return
                  }
                  openEntry(primaryEntry.id)
                }}
                disabled={creatingEntry || (!canCreateEntry && !primaryEntry)}
                data-testid="playoff-fill-bracket-cta"
                className="af-bx-btn af-bx-primary"
              >
                <ArrowRightCircle className="h-4 w-4" aria-hidden />
                {primaryButtonLabel}
              </button>
              {primaryEntry && canCreateEntry ? (
                <button type="button" onClick={handleCreateEntry} disabled={creatingEntry} className="af-bx-btn">
                  <Plus className="h-4 w-4" aria-hidden />
                  {copy.createAnother}
                </button>
              ) : null}
              {canManagePlayoffPool && (
                <button type="button" onClick={copyInvite} data-testid="playoff-copy-invite-btn" className="af-bx-btn">
                  <Clipboard className="h-4 w-4" aria-hidden />
                  {copy.invite}
                </button>
              )}
              {canSyncPlayoffPool ? (
                <button
                  type="button"
                  onClick={() => syncToolsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  className="af-bx-btn"
                >
                  <Settings2 className="h-4 w-4" aria-hidden />
                  {copy.commissionerTools}
                </button>
              ) : null}
            </div>
            {singleGameSport && tournamentLimit != null && tournamentUsed != null ? (
              <p className="af-pd-note">
                {copy.tournamentUsage(tournamentUsed, tournamentLimit)}
                {tournamentLimit === 1 ? copy.proNote : ""}
                {copy.noPrizesShort}
              </p>
            ) : null}
            {!canCreateEntry ? (
              <p className="af-pd-note af-pd-note--bad">
                {tournamentLocked
                  ? copy.closedFirstGame
                  : tournamentQuotaReached
                    ? copy.tournamentLimit(tournamentLimit)
                    : copy.leagueLimit(safeChallenge.maxEntriesPerParticipant)}
              </p>
            ) : null}

            <h2 className="af-pd-h2 af-pd-h2--spaced">{copy.poolDetails}</h2>
            <dl className="af-pd-details">
              <div><dt>{copy.visibility}</dt><dd>{copy.visibilityValue[safeChallenge.visibility] ?? safeChallenge.visibility}</dd></div>
              <div><dt>{copy.maxUsers}</dt><dd>{safeChallenge.maxParticipants}</dd></div>
              <div><dt>{copy.perUser}</dt><dd>{safeChallenge.maxEntriesPerParticipant}</dd></div>
              <div><dt>{copy.scoring}</dt><dd>{safeChallenge.scoringStyle.replace(/_/g, " ")}</dd></div>
              <div><dt>{copy.lockRule}</dt><dd>{safeChallenge.lockRule.replace(/_/g, " ")}</dd></div>
              {canManagePlayoffPool && (
                <div data-testid="playoff-invite-code-cell">
                  <dt>{copy.inviteCode}</dt>
                  <dd className="af-pd-code">{safeChallenge.inviteCode}</dd>
                </div>
              )}
            </dl>
          </article>

          {canManagePlayoffPool ? (
            <article data-testid="playoff-invite-panel" className="af-bx-panel af-pd-card">
              <h2 className="af-pd-h2">{copy.invitePanel}</h2>
              <p className="af-pd-muted">{copy.shareLink}</p>
              <div className="af-bx-invite af-pd-invite">
                <code>{safeChallenge.inviteUrl}?code={safeChallenge.inviteCode}</code>
              </div>
              <button type="button" onClick={copyInvite} data-testid="playoff-copy-invite-link-btn" className="af-bx-btn af-bx-wide af-pd-gap">
                <Link2 className="h-4 w-4" aria-hidden />
                {copy.copyInvite}
              </button>
            </article>
          ) : (
            <article data-testid="playoff-invite-member-banner" className="af-bx-panel af-pd-card">
              <h2 className="af-pd-h2">{copy.inviteMemberTitle}</h2>
              <p className="af-pd-muted">{copy.inviteMemberBody}</p>
            </article>
          )}
        </section>

        {canSyncPlayoffPool ? (
          <section
            ref={syncToolsRef}
            id="playoff-commissioner-sync-tools"
            data-testid="playoff-commissioner-sync-tools"
            className="af-bx-panel af-pd-card"
          >
            <div className="af-pd-row">
              <div>
                <h2 className="af-pd-h2">Commissioner Sync Tools</h2>
                <p className="af-pd-muted">
                  Provider sync updates official NBA/NHL playoff data. User picks are not created unless the testing-only auto-fill action is used.
                </p>
                <p data-testid="playoff-sync-tools-visibility-debug" className="af-pd-debug">
                  syncToolsVisible=true; isOwner={String(isOwner)}; isAdmin={String(hasAdminAccess)}; hasPoolAdminAccess={String(hasAdminAccess)}
                </p>
              </div>
              {syncingSeries ? (
                <span className="af-pd-chip af-pd-chip--accent">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  Syncing
                </span>
              ) : null}
            </div>

            <div className="af-pd-sync">
              <button type="button" onClick={() => handleSyncSeries("teams_schedule_only")} disabled={syncingSeries} data-testid="playoff-sync-schedule-only-button" className="af-pd-sync-btn" data-tone="warn">
                <span>Sync teams/schedule only</span>
                <small>Loads teams, dates, venues, broadcast. Does not import winners.</small>
              </button>
              <button type="button" onClick={() => handleSyncSeries("results_only")} disabled={syncingSeries} data-testid="playoff-sync-results-only-button" className="af-pd-sync-btn" data-tone="good">
                <span>Sync results only</span>
                <small>Imports final winners/results and scores saved picks.</small>
              </button>
              <button type="button" onClick={() => handleSyncSeries("official_bracket")} disabled={syncingSeries} data-testid="playoff-sync-series-button" className="af-pd-sync-btn" data-tone="info">
                <span>Sync official bracket</span>
                <small>Updates all known official bracket data. Does not fill user picks.</small>
              </button>
            </div>

            {canUseAutofillResults ? (
              <div className="af-pd-danger">
                <span className="af-pd-chip af-pd-chip--bad">Test-mode only</span>
                <button type="button" onClick={() => handleSyncSeries("autofill_results")} disabled={syncingSeries} data-testid="playoff-sync-autofill-results-button" className="af-bx-btn">
                  Auto-fill official results
                </button>
                <p className="af-pd-muted">Testing only — fills picks from official winners.</p>
              </div>
            ) : (
              <p data-testid="playoff-sync-autofill-unavailable" className="af-pd-note">
                Auto-fill official results is available only in test-mode pools (AllFantasy staff only).
              </p>
            )}

            {syncStatus ? (
              <p data-testid="playoff-sync-status-message" className={`af-pd-status ${syncStatus.type === "success" ? "af-pd-status--good" : "af-pd-status--bad"}`}>
                {syncStatus.message}
              </p>
            ) : null}
            <PlayoffSyncDiagnosticsPanel diagnostics={syncDiagnostics} />
          </section>
        ) : null}

        {singleGameSport && myEntries.length > 0 ? (
          <section data-testid="playoff-dashboard-your-race" className="af-bx-panel af-pd-card af-pd-race">
            <div className="af-pd-row">
              <div>
                <p className="af-pd-eyebrow">{copy.raceEyebrow}</p>
                {bestViewerRow ? (
                  <>
                    <h2 className="af-pd-rank">
                      #{bestViewerRow.rank} <span>{copy.ofFinalized(leaderboardRows.length)}</span>
                    </h2>
                    <p className="af-pd-muted">
                      {copy.bestBracket(bestViewerRow.name, bestViewerRow.totalScore, bestViewerRow.potentialTotal, bestViewerRow.correctPicks)}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="af-pd-h2 af-pd-h2--big">{copy.joinBoard}</h2>
                    <p className="af-pd-muted">{rollingCup ? copy.joinRolling : copy.joinFixed}</p>
                  </>
                )}
              </div>
              <div className="af-pd-actions">
                {bestViewerRow ? (
                  <button type="button" onClick={copyBestBracket} className="af-bx-btn af-bx-primary">
                    <Clipboard className="h-4 w-4" aria-hidden />
                    {copy.shareYours}
                  </button>
                ) : null}
                {canManagePlayoffPool && safeChallenge.inviteCode ? (
                  <button type="button" onClick={copyInvite} className="af-bx-btn">
                    <Link2 className="h-4 w-4" aria-hidden />
                    {copy.copyLeagueInvite}
                  </button>
                ) : null}
              </div>
            </div>
            {nearbyRivals.length > 0 ? (
              <div className="af-pd-rivals">
                <p className="af-pd-label">{copy.closest}</p>
                <div className="af-pd-grid">
                  {nearbyRivals.map((row) => (
                    <div key={row.id} className="af-pd-list-row">
                      <span className="af-pd-strong">#{row.rank} {row.name}</span>
                      <span className="af-pd-accent">{copy.pts(row.totalScore)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="af-pd-grid">
          <article className="af-bx-panel af-pd-card">
            <h2 className="af-pd-h2">{copy.participantsTitle}</h2>
            <p className="af-pd-muted">{copy.participants(participants.length)}</p>
            <ul className="af-pd-list">
              {participants.map((participant) => (
                <li key={participant.userId} className="af-pd-list-row">
                  <span className="af-pd-strong">{participant.displayName}</span>
                  <span className="af-pd-muted">{copy.entriesCount(participant.entryCount)}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="af-bx-panel af-pd-card">
            <h2 className="af-pd-h2">{copy.myEntries}</h2>
            {myEntries.length === 0 ? (
              <p className="af-pd-muted">{copy.noEntries}</p>
            ) : (
              <ul className="af-pd-list">
                {myEntries.map((entry, index) => (
                  <li key={entry.id} className="af-pd-list-row">
                    <div>
                      <p className="af-pd-strong">{entry.name || copy.bracketN(index + 1)}</p>
                      <p className="af-pd-muted">
                        {copy.picksOf(entry.pickCount, totalSeries)} · {entry.isComplete ? singleGameSport ? copy.finalized : copy.completeStatus : copy.draft}
                      </p>
                    </div>
                    <button type="button" onClick={() => openEntry(entry.id)} className="af-bx-btn af-pd-small">
                      {entry.isComplete ? copy.viewEdit : copy.complete}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        <section className="af-bx-panel af-pd-card" data-testid="playoff-dashboard-leaderboard">
          <div className="af-pd-row">
            <h2 className="af-pd-h2">{copy.leaderboard}</h2>
            {singleGameSport && <Link className="af-pd-link" href={`/brackets/standings?sport=${safeChallenge.sport}&season=${safeChallenge.seasonYear}`}>{copy.universalBoard}</Link>}
          </div>
          <p className="af-pd-muted">
            {singleGameSport ? copy.boardSingle : hasScoredLeaderboard ? copy.boardScored : copy.boardPicks}
          </p>
          {leaderboardRows.length === 0 ? (
            <p className="af-pd-empty">{copy.noBoard}</p>
          ) : (
            <ol className="af-pd-list">
              {leaderboardRows.map((row) => (
                <li key={row.id} className="af-pd-list-row" data-you={row.userId === view.viewerUserId ? "true" : undefined}>
                  <span className="af-pd-strong">#{row.rank} {row.name}</span>
                  <span className="af-pd-muted">
                    {singleGameSport ? copy.rowSingle(row.totalScore, row.potentialTotal, row.correctPicks) :
                      row.hasScoredResults ? copy.rowScored(row.totalScore, row.correctPicks, row.resolvedPicks, row.picks) : copy.rowPicks(row.picks)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        {singleGameSport && <p className="af-bx-disclaimer af-pd-disclaimer">{copy.disclaimer}</p>}
      </div>
    </main>
  )
}

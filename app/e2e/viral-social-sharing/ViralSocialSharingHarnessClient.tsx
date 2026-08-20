"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import { ACHIEVEMENT_SHARE_TYPES } from "@/lib/social-sharing"
import { getAchievementSharePayload } from "@/lib/social-sharing/SocialShareService"
import type { AchievementShareContext, AchievementShareType } from "@/lib/social-sharing/types"
import { SUPPORTED_PLATFORMS } from "@/lib/social-clips-grok/types"

type Target = {
  platform: string
  accountIdentifier: string | null
  autoPostingEnabled: boolean
  connected: boolean
  providerConfigured?: boolean
}

type PublishLog = {
  id: string
  platform: string
  status: string
  createdAt: string
}

const TYPE_LABELS: Record<AchievementShareType, string> = {
  winning_matchup: "Winning a matchup",
  winning_league: "Winning a league",
  high_scoring_team: "High scoring team",
  bracket_success: "Bracket success",
  rivalry_win: "Rivalry win",
  playoff_qualification: "Playoff qualification",
  championship_win: "Championship win",
  great_waiver_pickup: "Great waiver pickup",
  great_trade: "Great trade",
  major_upset: "Major upset",
  top_rank_legacy: "Top rank / legacy",
}

function getDefaultContext(type: AchievementShareType): AchievementShareContext {
  const base = { leagueName: "Viral League", teamName: "Alpha Squad" }
  switch (type) {
    case "winning_matchup":
      return { ...base, opponentName: "Beta Squad", week: 9, score: 142.8 }
    case "winning_league":
      return base
    case "high_scoring_team":
      return { ...base, week: 9, score: 172.4 }
    case "bracket_success":
      return { ...base, bracketName: "March Battle" }
    case "rivalry_win":
      return { ...base, rivalryName: "North Rivals", opponentName: "North Rivals" }
    case "playoff_qualification":
      return base
    case "championship_win":
      return base
    case "great_waiver_pickup":
      return { ...base, playerName: "Sleeper Gem" }
    case "great_trade":
      return { ...base, opponentName: "Trade Partner" }
    case "major_upset":
      return { ...base, opponentName: "Top Seed" }
    case "top_rank_legacy":
      return { ...base, rank: 1, tier: "Elite" }
    default:
      return base
  }
}

export default function ViralSocialSharingHarnessClient() {
  const [hydrated, setHydrated] = useState(false)
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0] ?? "NFL")
  const [selectedType, setSelectedType] = useState<AchievementShareType>("winning_matchup")
  const [selectedPlatform, setSelectedPlatform] = useState<string>("x")
  const [shareId, setShareId] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [previewTitle, setPreviewTitle] = useState("Harness viral share")
  const [previewCaption, setPreviewCaption] = useState("Harness caption")
  const [previewUrl, setPreviewUrl] = useState("")
  const [targets, setTargets] = useState<Target[]>([])
  const [logs, setLogs] = useState<PublishLog[]>([])
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  const context = useMemo(() => getDefaultContext(selectedType), [selectedType])
  const payload = useMemo(
    () => getAchievementSharePayload(selectedType, { ...context, sport }),
    [context, selectedType, sport]
  )
  const selectedTarget = useMemo(
    () => targets.find((target) => target.platform === selectedPlatform),
    [targets, selectedPlatform]
  )
  const retryableLog = useMemo(
    () =>
      logs.find(
        (log) => log.platform === selectedPlatform && (log.status === "failed" || log.status === "provider_unavailable")
      ) ?? null,
    [logs, selectedPlatform]
  )

  useEffect(() => {
    setHydrated(true)
  }, [])

  const fetchTargets = useCallback(async () => {
    const res = await fetch("/api/share/targets", { cache: "no-store" })
    const data = await res.json().catch(() => ({}))
    if (res.ok && Array.isArray(data.targets)) {
      setTargets(data.targets as Target[])
    }
  }, [])

  const fetchLogs = useCallback(
    async (id: string | null = shareId) => {
      if (!id) return
      const res = await fetch(`/api/share/publish?shareId=${encodeURIComponent(id)}`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.logs)) {
        setLogs(data.logs as PublishLog[])
      }
    },
    [shareId]
  )

  useEffect(() => {
    if (!hydrated) return
    void fetchTargets()
  }, [fetchTargets, hydrated])

  useEffect(() => {
    if (!shareId) return
    void fetchLogs(shareId)
  }, [fetchLogs, shareId])

  const handleGenerateShareCard = async () => {
    setLoadingAction("generate-card")
    const res = await fetch("/api/share/moment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareType: selectedType, sport, ...context }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && typeof data.shareId === "string") {
      setShareId(data.shareId)
      setApproved(false)
      setPreviewVisible(true)
      setPreviewTitle(String(data.title ?? "Generated title"))
      setPreviewCaption(String(data.summary ?? "Generated summary"))
      setPreviewUrl(String(data.shareUrl ?? `${window.location.origin}/share/${data.shareId}`))
      await fetchLogs(data.shareId)
    }
    setLoadingAction(null)
  }

  const handleGenerateCopy = async () => {
    setLoadingAction("generate-copy")
    const res = await fetch("/api/share/generate-copy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shareType: selectedType, sport, shareId, ...context }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setPreviewVisible(true)
      setPreviewTitle(String(data.headline ?? "Generated headline"))
      setPreviewCaption(String(data.caption ?? "Generated caption"))
      setPreviewUrl(shareId ? `${window.location.origin}/share/${shareId}` : payload.shareUrl)
    }
    setLoadingAction(null)
  }

  const handlePreview = async () => {
    if (!shareId) {
      setPreviewVisible(true)
      setPreviewTitle(payload.title)
      setPreviewCaption(payload.text)
      setPreviewUrl(payload.shareUrl)
      return
    }
    setLoadingAction("preview")
    const res = await fetch(`/api/share/preview?shareId=${encodeURIComponent(shareId)}`, { cache: "no-store" })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setPreviewVisible(true)
      setPreviewTitle(String(data.title ?? payload.title))
      setPreviewCaption(String(data.caption ?? payload.text))
      setPreviewUrl(String(data.shareUrl ?? `${window.location.origin}/share/${shareId}`))
      setApproved(!!data.approvedForPublish)
    }
    setLoadingAction(null)
  }

  const handleShare = async () => {
    const url = previewUrl || payload.shareUrl
    const text = previewCaption || payload.text
    const title = previewTitle || payload.title
    if (navigator.share && navigator.canShare?.({ title, url })) {
      await navigator.share({ title, url, text })
      return
    }
    window.open(payload.twitterUrl, "_blank", "noopener,noreferrer")
  }

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(previewUrl || payload.shareUrl)
  }

  const handleCopyCaption = async () => {
    await navigator.clipboard.writeText(previewCaption || payload.text)
  }

  const handleConnectAccount = async (action: "connect" | "disconnect") => {
    setLoadingAction(`${action}-${selectedPlatform}`)
    await fetch("/api/share/targets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: selectedPlatform, action }),
    })
    await fetchTargets()
    setLoadingAction(null)
  }

  const handleAutoPostToggle = async (enabled: boolean) => {
    setLoadingAction(`auto-${selectedPlatform}`)
    await fetch("/api/share/targets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        platform: selectedPlatform,
        action: "toggle_auto_post",
        autoPostingEnabled: enabled,
      }),
    })
    await fetchTargets()
    setLoadingAction(null)
  }

  const handleApprove = async (nextApproved: boolean) => {
    if (!shareId) return
    setLoadingAction("approve")
    const res = await fetch(`/api/share/${encodeURIComponent(shareId)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: nextApproved }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setApproved(nextApproved)
      if (Array.isArray(data.logs)) setLogs(data.logs as PublishLog[])
    }
    setLoadingAction(null)
  }

  const handlePublishNow = async () => {
    if (!shareId) return
    setLoadingAction("publish")
    const res = await fetch("/api/share/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "publish", shareId, platform: selectedPlatform }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && Array.isArray(data.logs)) {
      setLogs(data.logs as PublishLog[])
    }
    setLoadingAction(null)
  }

  const handleRetry = async (logId: string) => {
    setLoadingAction(`retry-${logId}`)
    await fetch("/api/share/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "retry", logId }),
    })
    await fetchLogs()
    setLoadingAction(null)
  }

  return (
    <main className="min-h-screen bg-[#040915] p-6 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Viral Social Sharing Harness</h1>
          <p className="text-sm text-white/70">
            Deterministic Prompt 121 harness with Grok copy generation, preview approval, and optional auto-post flows.
          </p>
          <p className="text-xs text-white/50" data-testid="viral-social-sharing-hydrated-flag">
            {hydrated ? "hydrated" : "hydrating"}
          </p>
          <Link href="/app/share-achievements" className="text-sm text-cyan-300 hover:underline" data-testid="viral-back-button">
            Back
          </Link>
        </header>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/60">Sport</label>
            <select
              value={sport}
              onChange={(event) => setSport(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              data-testid="viral-share-sport-selector"
            >
              {SUPPORTED_SPORTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Share type</label>
            <select
              value={selectedType}
              onChange={(event) => setSelectedType(event.target.value as AchievementShareType)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              data-testid="viral-share-type-selector"
            >
              {ACHIEVEMENT_SHARE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleGenerateShareCard()}
              className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200"
              data-testid="viral-generate-share-card-button"
            >
              {loadingAction === "generate-card" ? "Generating..." : "Generate share card"}
            </button>
            <button
              type="button"
              onClick={() => void handleGenerateCopy()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
              data-testid="viral-generate-social-copy-button"
            >
              {loadingAction === "generate-copy" ? "Generating..." : "Generate social copy"}
            </button>
            <button
              type="button"
              onClick={() => void handlePreview()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
              data-testid="viral-preview-card-button"
            >
              {loadingAction === "preview" ? "Loading..." : "Preview card"}
            </button>
          </div>
        </section>

        {previewVisible ? (
          <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3" data-testid="viral-preview-card">
            <p className="text-sm font-semibold">{previewTitle}</p>
            <p className="text-xs text-white/70">{previewCaption}</p>
            <p className="text-xs text-white/50">{previewUrl || payload.shareUrl}</p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleShare()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-share-button"
              >
                Share
              </button>
              <button
                type="button"
                onClick={() => window.open(payload.twitterUrl, "_blank", "noopener,noreferrer")}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-share-button-x"
              >
                Post to X
              </button>
              <button
                type="button"
                onClick={() => window.open(payload.facebookUrl, "_blank", "noopener,noreferrer")}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-share-button-facebook"
              >
                Share on Facebook
              </button>
              <button
                type="button"
                onClick={() => window.open(payload.redditUrl, "_blank", "noopener,noreferrer")}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-share-button-reddit"
              >
                Share on Reddit
              </button>
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-copy-link-button"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={() => void handleCopyCaption()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-copy-caption-button"
              >
                Copy caption
              </button>
              <button
                type="button"
                onClick={() => void handleShare()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-mobile-share-button"
              >
                Mobile share
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedPlatform}
                onChange={(event) => setSelectedPlatform(event.target.value)}
                className="rounded-lg border border-white/20 bg-black/30 px-2 py-1 text-xs"
                data-testid="viral-platform-selector"
              >
                {SUPPORTED_PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
              {!selectedTarget?.connected ? (
                <button
                  type="button"
                  onClick={() => void handleConnectAccount("connect")}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                  data-testid="viral-connect-account-button"
                >
                  Connect account
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnectAccount("disconnect")}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                  data-testid="viral-disconnect-account-button"
                >
                  Disconnect
                </button>
              )}
              <label className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={!!selectedTarget?.autoPostingEnabled}
                  disabled={!selectedTarget?.connected}
                  onChange={(event) => void handleAutoPostToggle(event.target.checked)}
                  data-testid="viral-auto-post-toggle"
                />
                Auto-post
              </label>
              <button
                type="button"
                onClick={() => void handleApprove(!approved)}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-approve-publish-button"
              >
                {approved ? "Revoke approval" : "Approve for publish"}
              </button>
              <button
                type="button"
                onClick={() => void handlePublishNow()}
                disabled={!approved || loadingAction === "publish"}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs disabled:opacity-50"
                data-testid="viral-publish-now-button"
              >
                Publish now
              </button>
              <button
                type="button"
                onClick={() => void fetchLogs()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-status-refresh-button"
              >
                Refresh status
              </button>
              {retryableLog ? (
                <button
                  type="button"
                  onClick={() => void handleRetry(retryableLog.id)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                  data-testid={`viral-retry-publish-button-${retryableLog.id}`}
                >
                  Retry publish
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setPreviewVisible(false)}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
                data-testid="viral-close-preview-button"
              >
                Close preview
              </button>
            </div>

            <ul className="space-y-1 text-xs text-white/70">
              {logs.map((log) => (
                <li key={log.id} data-testid={`viral-log-${log.id}`}>
                  {log.platform}: {log.status}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setPreviewVisible(true)}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
            data-testid="viral-open-preview-button"
          >
            Re-open preview
          </button>
        )}
      </div>
    </main>
  )
}

"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { SOCIAL_ASSET_TYPES, SUPPORTED_PLATFORMS, type SocialAssetType } from "@/lib/social-clips-grok/types"
import {
  CLIP_INPUT_TYPES,
  CLIP_OUTPUT_TYPES,
  type ClipInputType,
  type ClipOutputType,
} from "@/lib/ai-social-clip-engine/types"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"

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
  responseMetadata?: Record<string, unknown> | null
  createdAt?: string
}

const ASSET_TYPE_LABELS: Record<SocialAssetType, string> = {
  weekly_league_winners: "Weekly League Winners",
  biggest_upset: "Biggest Upset",
  top_scoring_team: "Top Scoring Team",
  trending_waiver_adds: "Trending Waiver Adds",
  draft_highlights: "Draft Highlights",
  rivalry_moments: "Rivalry Moments",
  bracket_challenge_highlights: "Bracket Challenge Highlights",
  ai_insight_moments: "AI Insight Moments",
  sport_platform_highlights: "Sport Platform Highlights",
}

export default function SocialClipsGrokHarnessClient() {
  const [hydrated, setHydrated] = useState(false)
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0] ?? "NFL")
  const [aiInputType, setAiInputType] = useState<ClipInputType>("matchup_result")
  const [aiOutputType, setAiOutputType] = useState<ClipOutputType>("short_post")
  const [aiFactsSummary, setAiFactsSummary] = useState("")
  const [aiStatus, setAiStatus] = useState<{ anyAvailable?: boolean } | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [assetType, setAssetType] = useState<SocialAssetType>("weekly_league_winners")
  const [tone, setTone] = useState("energetic and fun")
  const [brandingHint, setBrandingHint] = useState("AllFantasy — fantasy sports insights")
  const [assetId, setAssetId] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [previewVisible, setPreviewVisible] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState<string>("x")
  const [caption, setCaption] = useState("Harness caption")
  const [headline, setHeadline] = useState("Harness headline")
  const [editCaption, setEditCaption] = useState("Harness caption")
  const [editHeadline, setEditHeadline] = useState("Harness headline")
  const [targets, setTargets] = useState<Target[]>([])
  const [logs, setLogs] = useState<PublishLog[]>([])
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

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

  const fetchAIStatus = useCallback(async () => {
    const res = await fetch("/api/social-clips/ai/status", { cache: "no-store" })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setAiStatus({ anyAvailable: Boolean(data.anyAvailable) })
      return
    }
    setAiStatus({ anyAvailable: false })
  }, [])

  const fetchLogs = useCallback(async () => {
    if (!assetId) return
    const res = await fetch(`/api/social-clips/${encodeURIComponent(assetId)}/logs`, { cache: "no-store" })
    const data = await res.json().catch(() => ({}))
    if (res.ok && Array.isArray(data.logs)) {
      setLogs(data.logs as PublishLog[])
    }
  }, [assetId])

  useEffect(() => {
    if (!hydrated) return
    void fetchTargets()
    void fetchAIStatus()
  }, [hydrated, fetchTargets, fetchAIStatus])

  useEffect(() => {
    if (!assetId) return
    void fetchLogs()
  }, [assetId, fetchLogs])

  const selectedTarget = useMemo(
    () => targets.find((target) => target.platform === selectedPlatform),
    [selectedPlatform, targets]
  )

  const handleGenerate = async () => {
    setLoadingAction("generate")
    const res = await fetch("/api/social-clips/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sport, assetType, tone, brandingHint }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && typeof data.id === "string") {
      setAssetId(data.id)
      setApproved(false)
      setCaption(`Generated caption for ${sport}`)
      setHeadline(`Generated headline for ${ASSET_TYPE_LABELS[assetType]}`)
      setEditCaption(`Generated caption for ${sport}`)
      setEditHeadline(`Generated headline for ${ASSET_TYPE_LABELS[assetType]}`)
      setEditMode(false)
    }
    setLoadingAction(null)
  }

  const handleAIGenerate = async () => {
    setAiError(null)
    setLoadingAction("ai-generate")
    const body: Record<string, unknown> = {
      inputType: aiInputType,
      outputType: aiOutputType,
      sport,
    }
    if (aiFactsSummary.trim()) {
      body.deterministicFacts = { storySummary: aiFactsSummary.trim(), sport }
    }
    const res = await fetch("/api/social-clips/ai/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && typeof data.id === "string") {
      setAssetId(data.id)
      setApproved(false)
      setCaption(`AI ${aiInputType} caption for ${sport}`)
      setHeadline(`AI ${aiOutputType} headline`)
      setEditCaption(`AI ${aiInputType} caption for ${sport}`)
      setEditHeadline(`AI ${aiOutputType} headline`)
      setEditMode(false)
    } else {
      setAiError(typeof data.error === "string" ? data.error : "Generation failed")
    }
    setLoadingAction(null)
  }

  const handleApprove = async (nextApproved: boolean) => {
    if (!assetId) return
    setLoadingAction("approve")
    const res = await fetch(`/api/social-clips/${encodeURIComponent(assetId)}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: nextApproved }),
    })
    if (res.ok) {
      setApproved(nextApproved)
      await fetchLogs()
    }
    setLoadingAction(null)
  }

  const handlePublish = async (platform: string) => {
    if (!assetId) return
    setLoadingAction(`publish-${platform}`)
    await fetch(`/api/social-clips/${encodeURIComponent(assetId)}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform }),
    })
    await fetchLogs()
    setLoadingAction(null)
  }

  const handleRetry = async (logId: string) => {
    setLoadingAction(`retry-${logId}`)
    await fetch(`/api/social-clips/retry/${encodeURIComponent(logId)}`, { method: "POST" })
    await fetchLogs()
    setLoadingAction(null)
  }

  const handleConnect = async (platform: string) => {
    setLoadingAction(`connect-${platform}`)
    await fetch("/api/share/targets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform, action: "connect" }),
    })
    await fetchTargets()
    setLoadingAction(null)
  }

  const handleAutoToggle = async (platform: string, enabled: boolean) => {
    setLoadingAction(`auto-${platform}`)
    await fetch("/api/share/targets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform, action: "toggle_auto_post", autoPostingEnabled: enabled }),
    })
    await fetchTargets()
    setLoadingAction(null)
  }

  const handleCopyCaption = async () => {
    await navigator.clipboard.writeText(`${caption}\n#AllFantasy`)
  }

  const handleCopyText = async () => {
    await navigator.clipboard.writeText(caption)
  }

  const handleShareAsset = async () => {
    const url = `${window.location.origin}/social-clips/${assetId ?? "harness"}`
    if (navigator.share && navigator.canShare?.({ title: headline, url })) {
      await navigator.share({ title: headline, text: caption, url })
      return
    }
    await navigator.clipboard.writeText(url)
  }

  const handleDownloadAsset = () => {
    const payload = {
      id: assetId,
      sport,
      assetType,
      headline,
      caption,
    }
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `allfantasy-social-clip-${assetId ?? "harness"}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const handleEditSave = () => {
    setHeadline(editHeadline)
    setCaption(editCaption)
    setEditMode(false)
    setPreviewVisible(true)
  }

  const handleEditCancel = () => {
    setEditHeadline(headline)
    setEditCaption(caption)
    setEditMode(false)
  }

  return (
    <main className="min-h-screen bg-[#040915] p-6 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Social Clips Grok Harness</h1>
          <p className="text-sm text-white/70">
            Deterministic Prompt 116 harness for generation, approval, optional auto-posting, and publish retries.
          </p>
          <p className="text-xs text-white/50" data-testid="social-clip-harness-hydrated-flag">
            {hydrated ? "hydrated" : "hydrating"}
          </p>
          <Link
            href="/social-clips"
            className="inline-flex text-sm text-cyan-300 hover:underline"
            data-testid="social-clips-back-button"
            data-audit="back-button"
          >
            Back
          </Link>
        </header>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 space-y-2">
            <p className="text-xs text-amber-100">AI social clip engine (Prompt 146)</p>
            {aiStatus && !aiStatus.anyAvailable && (
              <p
                className="text-xs text-amber-300"
                data-testid="social-clip-ai-provider-unavailable-message"
              >
                No AI provider available.
              </p>
            )}
            {aiError ? (
              <p className="text-xs text-amber-300" data-testid="social-clip-ai-error-message">
                {aiError}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={aiInputType}
                onChange={(event) => setAiInputType(event.target.value as ClipInputType)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                data-testid="social-clip-ai-input-type-selector"
              >
                {CLIP_INPUT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <select
                value={aiOutputType}
                onChange={(event) => setAiOutputType(event.target.value as ClipOutputType)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                data-testid="social-clip-ai-output-type-selector"
              >
                {CLIP_OUTPUT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={aiFactsSummary}
              onChange={(event) => setAiFactsSummary(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              placeholder="Deterministic facts"
              rows={2}
              data-testid="social-clip-ai-facts-input"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void fetchAIStatus()}
                className="rounded-lg border border-white/20 px-3 py-2 text-xs"
                data-testid="social-clip-ai-status-refresh-button"
              >
                Refresh AI status
              </button>
              <button
                type="button"
                onClick={() => void handleAIGenerate()}
                disabled={loadingAction === "ai-generate" || aiStatus?.anyAvailable === false}
                className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200 disabled:opacity-60"
                data-testid="social-clip-ai-generate-button"
                data-audit="generate-ai-social-clip-button"
              >
                {loadingAction === "ai-generate" ? "Generating AI..." : "Generate clip"}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-white/60">Sport</label>
            <select
              value={sport}
              onChange={(event) => setSport(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              data-testid="social-clip-grok-sport-selector"
              data-audit="sport-selector"
            >
              {SUPPORTED_SPORTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Clip type</label>
            <select
              value={assetType}
              onChange={(event) => setAssetType(event.target.value as SocialAssetType)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              data-testid="social-clip-type-selector"
              data-audit="clip-type-selector"
            >
              {SOCIAL_ASSET_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ASSET_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Tone</label>
            <input
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              data-testid="social-clip-tone-input"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/60">Branding hint</label>
            <input
              value={brandingHint}
              onChange={(event) => setBrandingHint(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
              data-testid="social-clip-branding-input"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
            data-testid="social-clip-generate-button"
            data-audit="generate-social-clip-button"
          >
            {loadingAction === "generate" ? "Generating..." : "Generate social clip"}
          </button>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_PLATFORMS.map((platform) => (
              <button
                key={platform}
                type="button"
                onClick={() => setSelectedPlatform(platform)}
                className={`rounded-lg border px-3 py-1.5 text-xs ${
                  selectedPlatform === platform
                    ? "border-cyan-300/60 bg-cyan-400/20 text-cyan-100"
                    : "border-white/15 bg-black/20 text-white/70"
                }`}
                data-testid={`social-clip-platform-selection-button-${platform}`}
                data-audit="platform-selection-button"
              >
                {platform}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPreviewVisible((value) => !value)}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
            data-testid="social-clip-preview-content-button"
            data-audit="preview-content-button"
          >
            {previewVisible ? "Hide preview" : "Show preview"}
          </button>

          {editMode ? (
            <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
              <input
                value={editHeadline}
                onChange={(event) => setEditHeadline(event.target.value)}
                className="w-full rounded border border-white/20 bg-black/30 px-2 py-1 text-sm"
                data-testid="social-clip-edit-headline-input"
              />
              <textarea
                value={editCaption}
                onChange={(event) => setEditCaption(event.target.value)}
                rows={3}
                className="w-full rounded border border-white/20 bg-black/30 px-2 py-1 text-sm"
                data-testid="social-clip-edit-caption-input"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleEditSave}
                  className="rounded border border-white/20 px-2 py-1 text-xs"
                  data-testid="social-clip-edit-save-button"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="rounded border border-white/20 px-2 py-1 text-xs"
                  data-testid="social-clip-edit-cancel-button"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : previewVisible ? (
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-semibold">{headline}</p>
              <p className="mt-1 text-sm text-white/80">{caption}</p>
              <p className="mt-1 text-xs text-white/50">Selected platform: {selectedPlatform}</p>
            </div>
          ) : (
            <p className="text-xs text-white/50">Preview hidden</p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyCaption()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
              data-testid="social-clip-copy-caption-button"
              data-audit="copy-caption-button"
            >
              Copy caption
            </button>
            <button
              type="button"
              onClick={() => void handleCopyText()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
              data-testid="social-clip-copy-text-button"
              data-audit="copy-text-button"
            >
              Copy text
            </button>
            <button
              type="button"
              onClick={() => void handleShareAsset()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
              data-testid="social-clip-share-asset-button"
              data-audit="share-asset-button"
            >
              Share asset
            </button>
            <button
              type="button"
              onClick={handleDownloadAsset}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
              data-testid="social-clip-download-asset-button"
              data-audit="download-asset-button"
            >
              Download asset
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleApprove(!approved)}
            className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100"
            data-testid="social-clip-approve-for-publish-button"
            data-audit="approve-for-publish-button"
          >
            {approved ? "Revoke approval" : "Approve for publish"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditHeadline(headline)
              setEditCaption(caption)
              setEditMode(true)
            }}
            className="rounded-lg border border-white/20 px-3 py-2 text-sm"
            data-testid="social-clip-edit-mode-button"
            data-audit="edit-mode-button"
          >
            Edit mode
          </button>
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          {SUPPORTED_PLATFORMS.map((platform) => {
            const target = targets.find((entry) => entry.platform === platform)
            const connected = target?.connected ?? false
            const autoOn = target?.autoPostingEnabled ?? false
            return (
              <div key={platform} className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2">
                <span className="text-sm capitalize">{platform}</span>
                <div className="flex items-center gap-2">
                  {!connected ? (
                    <button
                      type="button"
                      onClick={() => void handleConnect(platform)}
                      className="rounded-lg border border-white/20 px-3 py-1 text-xs"
                      data-testid={`social-clip-connect-social-account-button-${platform}`}
                      data-audit="connect-social-account-button"
                    >
                      {loadingAction === `connect-${platform}` ? "Connecting..." : "Connect"}
                    </button>
                  ) : (
                    <>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={autoOn}
                          onChange={(event) => void handleAutoToggle(platform, event.target.checked)}
                          data-testid={`social-clip-auto-post-toggle-${platform}`}
                          data-audit="auto-post-toggle"
                        />
                        Auto-post
                      </label>
                      <button
                        type="button"
                        onClick={() => void handlePublish(platform)}
                        disabled={!approved}
                        className="rounded-lg border border-white/20 px-3 py-1 text-xs disabled:opacity-60"
                        data-testid={`social-clip-publish-now-button-${platform}`}
                        data-audit="publish-now-button"
                      >
                        Publish now
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
          <button
            type="button"
            onClick={() => void fetchLogs()}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs"
            data-testid="social-clip-status-refresh-button"
            data-audit="status-refresh-button"
          >
            Refresh status
          </button>
          <ul className="space-y-2">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center gap-2 text-xs">
                <span data-testid={`social-clip-log-${log.id}`}>{log.platform}</span>
                <span>{log.status}</span>
                {(log.status === "failed" || log.status === "provider_unavailable") && (
                  <button
                    type="button"
                    onClick={() => void handleRetry(log.id)}
                    className="rounded border border-white/20 px-2 py-1"
                    data-testid={`social-clip-retry-failed-publish-button-${log.id}`}
                    data-audit="retry-failed-publish-button"
                  >
                    Retry
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <button
          type="button"
          onClick={() => void handleGenerate()}
          className="rounded-lg border border-white/20 px-3 py-2 text-sm"
          data-testid="social-clip-regenerate-content-button"
          data-audit="regenerate-content-button"
        >
          Regenerate new clip
        </button>

        <div className="flex gap-2 sm:hidden">
          <button
            type="button"
            onClick={() => setPreviewVisible((value) => !value)}
            className="rounded-lg border border-white/20 px-3 py-2 text-xs"
            data-testid="social-clip-mobile-preview-action-button"
          >
            Mobile preview
          </button>
          <button
            type="button"
            onClick={() => void handlePublish(selectedTarget?.platform ?? "x")}
            className="rounded-lg border border-white/20 px-3 py-2 text-xs"
            data-testid="social-clip-mobile-publish-action-button"
          >
            Mobile publish
          </button>
        </div>
      </div>
    </main>
  )
}

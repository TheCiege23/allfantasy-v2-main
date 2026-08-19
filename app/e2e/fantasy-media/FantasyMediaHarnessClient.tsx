"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { MEDIA_TYPES, type MediaType } from "@/lib/fantasy-media/types"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"

type StatusValue = "generating" | "completed" | "failed"

export default function FantasyMediaHarnessClient() {
  const [hydrated, setHydrated] = useState(false)
  const [createdEpisodeId, setCreatedEpisodeId] = useState<string | null>(null)
  const [sport, setSport] = useState<string>(SUPPORTED_SPORTS[0] ?? "NFL")
  const [contentType, setContentType] = useState<MediaType>("weekly_recap")
  const [leagueName, setLeagueName] = useState("My League")
  const [previewScript, setPreviewScript] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editableScript, setEditableScript] = useState("")
  const [generating, setGenerating] = useState(false)
  const [status, setStatus] = useState<StatusValue>("generating")
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [shareState, setShareState] = useState("Copy link")
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [publishState, setPublishState] = useState<string | null>(null)
  const [publishLogs, setPublishLogs] = useState<Array<{ id: string; destinationType: string; status: string }>>([])

  useEffect(() => {
    setHydrated(true)
  }, [])

  const requestGenerate = async (overrideContentType?: MediaType) => {
    const requestedType = overrideContentType ?? contentType
    setGenerating(true)
    try {
      const response = await fetch("/api/fantasy-media/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sport,
          contentType: requestedType,
          leagueName,
          script: editing && editableScript ? editableScript : undefined,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data.id) {
        setCreatedEpisodeId(data.id as string)
      }
    } finally {
      setGenerating(false)
    }
  }

  const handlePreviewScript = async () => {
    const response = await fetch("/api/fantasy-media/script", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sport,
        contentType,
        leagueName,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok) {
      const script = String(data.script ?? "")
      setPreviewScript(script)
      setEditableScript(script)
    }
  }

  const handleRefreshStatus = async () => {
    const response = await fetch("/api/fantasy-media/episodes/media-e2e-1/status")
    const data = await response.json().catch(() => ({}))
    const nextStatus = data.status as StatusValue | undefined
    if (nextStatus) setStatus(nextStatus)
    if (typeof data.playbackUrl === "string") setPlaybackUrl(data.playbackUrl)
  }

  const handleRetry = async () => {
    const response = await fetch("/api/fantasy-media/episodes/media-e2e-1/retry", {
      method: "POST",
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok) {
      setStatus((data.status as StatusValue | undefined) ?? "generating")
      setPlaybackUrl(null)
    }
  }

  const handlePlaybackToggle = () => {
    const video = document.querySelector<HTMLVideoElement>('video[data-testid="fantasy-media-video-player"]')
    if (!video) return
    if (video.paused) {
      void video.play()
      setVideoPlaying(true)
    } else {
      video.pause()
      setVideoPlaying(false)
    }
  }

  const handleCopyShare = async () => {
    const url = `${window.location.origin}/fantasy-media/media-e2e-1`
    setShareState("Copy link")
    if (navigator.share && navigator.canShare?.({ url })) {
      await navigator.share({ title: "Fantasy media", url })
      setShareState("Copied!")
      return
    }
    await navigator.clipboard.writeText(url)
    setShareState("Copied!")
  }

  const fetchPublishLogs = async () => {
    const response = await fetch("/api/fantasy-media/episodes/media-e2e-1/publish-logs")
    const data = await response.json().catch(() => ({}))
    if (response.ok && Array.isArray(data.logs)) {
      setPublishLogs(
        data.logs.map((log: any) => ({
          id: String(log.id),
          destinationType: String(log.destinationType),
          status: String(log.status),
        }))
      )
    }
  }

  useEffect(() => {
    if (!hydrated) return
    void fetchPublishLogs()
  }, [hydrated])

  const handlePublish = async () => {
    const response = await fetch("/api/fantasy-media/episodes/media-e2e-1/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationType: "x" }),
    })
    const data = await response.json().catch(() => ({}))
    if (response.ok) {
      setPublishState(`${String(data.status ?? "pending")}: ${String(data.message ?? "Publish requested")}`)
      await fetchPublishLogs()
    } else {
      setPublishState(String(data.error ?? "Publish failed"))
    }
  }

  return (
    <main className="min-h-screen bg-[#040915] p-6 text-white">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Fantasy Media Harness</h1>
          <p className="text-sm text-white/70">
            Validates podcast/video generation controls, HeyGen dispatch, status refresh, retry, playback, share, and back links.
          </p>
          <p className="text-xs text-white/50" data-testid="fantasy-media-hydrated-flag">
            {hydrated ? "hydrated" : "hydrating"}
          </p>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" data-testid="fantasy-media-back-dashboard-link">
              ← Dashboard
            </Link>
            <Link href="/podcast" data-testid="fantasy-media-back-podcast-link">
              Podcast
            </Link>
          </div>
          <p className="text-xs text-white/60" data-testid="fantasy-media-created-episode-id">
            {createdEpisodeId ? `created:${createdEpisodeId}` : "created:none"}
          </p>
        </header>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-white">Generate video</h2>

          <div className="grid gap-3">
            <label className="block text-xs text-white/60">Sport</label>
            <select
              value={sport}
              onChange={(e) => setSport(e.target.value)}
              className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
              data-testid="fantasy-media-sport-selector"
              data-audit="sport-selector"
            >
              {SUPPORTED_SPORTS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <label className="block text-xs text-white/60">Content type</label>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value as MediaType)}
              className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
              data-testid="fantasy-media-content-type-selector"
            >
              {MEDIA_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <label className="block text-xs text-white/60">League name (optional)</label>
            <input
              type="text"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white"
              data-testid="fantasy-media-league-selector"
              data-audit="league-selector"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handlePreviewScript()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              data-testid="fantasy-media-preview-script-button"
              data-audit="preview-script-button"
            >
              Preview script
            </button>
            <button
              type="button"
              onClick={() => {
                if (!previewScript) {
                  const seed = editableScript || "Intro. Add your custom fantasy recap script here."
                  setPreviewScript(seed)
                  setEditableScript(seed)
                }
                setEditing((prev) => !prev)
              }}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              data-testid="fantasy-media-edit-script-button"
              data-audit="edit-script-button"
            >
              {editing ? "Stop editing script" : "Edit script"}
            </button>
            <button
              type="button"
              onClick={() => void requestGenerate()}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/20 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/30"
              data-testid="fantasy-media-generate-video-button"
              data-audit="generate-video-button"
            >
              {generating ? <span data-testid="fantasy-media-generate-loading-state">Sending to HeyGen…</span> : "Generate video"}
            </button>
            <button
              type="button"
              onClick={() => void requestGenerate("weekly_recap")}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              data-testid="fantasy-media-generate-weekly-recap-button"
              data-audit="generate-weekly-recap-button"
            >
              Generate weekly recap
            </button>
            <button
              type="button"
              onClick={() => void requestGenerate("waiver_targets")}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              data-testid="fantasy-media-generate-waiver-video-button"
              data-audit="generate-waiver-video-button"
            >
              Generate waiver video
            </button>
            <button
              type="button"
              onClick={() => void requestGenerate()}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
              data-testid="fantasy-media-send-to-heygen-button"
              data-audit="send-to-heygen-button"
            >
              Send to HeyGen
            </button>
          </div>

          {previewScript ? (
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              {editing ? (
                <textarea
                  value={editableScript}
                  onChange={(e) => setEditableScript(e.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white"
                  data-testid="fantasy-media-edit-script-textarea"
                />
              ) : (
                <p className="text-sm text-white/80 whitespace-pre-wrap">{previewScript}</p>
              )}
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-white/10 bg-white/5 p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.1em] text-white/60">Episode player harness</p>
          <div className="space-y-4">
            <Link
              href="/fantasy-media"
              className="text-sm text-white/60 hover:text-white/80 transition"
              data-testid="fantasy-media-back-button"
              data-audit="back-button"
            >
              ← All videos
            </Link>
            <p className="text-xs text-white/60">Status: {status}</p>
            {status === "generating" ? (
              <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200" data-testid="fantasy-media-status-generating">
                Video is being generated by HeyGen. This may take a few minutes.
              </div>
            ) : null}
            {status === "failed" ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                Video generation failed.
              </div>
            ) : null}
            {status === "completed" && playbackUrl ? (
              <video
                src={playbackUrl}
                controls
                playsInline
                className="w-full aspect-video rounded-lg border border-white/10"
                data-testid="fantasy-media-video-player"
                onPlay={() => setVideoPlaying(true)}
                onPause={() => setVideoPlaying(false)}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {status === "generating" ? (
                <button
                  type="button"
                  onClick={() => void handleRefreshStatus()}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                  data-testid="fantasy-media-refresh-status-button"
                  data-audit="refresh-status-button"
                >
                  Refresh status
                </button>
              ) : null}
              {status === "failed" ? (
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  className="rounded-lg border border-cyan-500/40 px-3 py-1.5 text-sm text-cyan-100 hover:bg-cyan-500/20"
                  data-testid="fantasy-media-retry-button"
                  data-audit="generate-retry-button"
                >
                  Retry generation
                </button>
              ) : null}
              {status === "completed" && playbackUrl ? (
                <button
                  type="button"
                  onClick={handlePlaybackToggle}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                  data-testid="fantasy-media-playback-button"
                  data-audit="playback-button"
                >
                  {videoPlaying ? "Pause playback" : "Play playback"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleCopyShare()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                data-testid="fantasy-media-copy-share-button"
                data-audit="copy-share-button"
              >
                {shareState}
              </button>
              <button
                type="button"
                onClick={() => void handlePublish()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                data-testid="fantasy-media-publish-button"
                data-audit="publish-button"
              >
                Publish
              </button>
              <button
                type="button"
                onClick={() => void fetchPublishLogs()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                data-testid="fantasy-media-refresh-publish-logs-button"
              >
                Refresh publish logs
              </button>
            </div>
            {publishState ? (
              <p className="text-sm text-cyan-200" data-testid="fantasy-media-publish-status">
                {publishState}
              </p>
            ) : null}
            <ul className="space-y-1">
              {publishLogs.map((log) => (
                <li
                  key={log.id}
                  className="text-xs text-white/70"
                  data-testid={`fantasy-media-publish-log-${log.id}`}
                >
                  {log.destinationType} · {log.status}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  )
}

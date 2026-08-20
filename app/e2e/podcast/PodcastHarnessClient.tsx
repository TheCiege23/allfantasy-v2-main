"use client"

import { useRef, useState } from "react"
import { Loader2, Mic, Pause, Play, Share2 } from "lucide-react"
import { DEFAULT_SPORT, SUPPORTED_SPORTS } from "@/lib/sport-scope"

type GeneratedEpisode = {
  id: string
  title: string
  script: string
  playbackUrl: string | null
  durationSeconds: number | null
}

export default function PodcastHarnessClient() {
  const [sport, setSport] = useState<string>(DEFAULT_SPORT)
  const [leagueName, setLeagueName] = useState("AllFantasy Pro League")
  const [weekLabel, setWeekLabel] = useState("Week 8")
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [episode, setEpisode] = useState<GeneratedEpisode | null>({
    id: "seed-episode",
    title: "Fantasy Recap — AllFantasy Pro League Week 8",
    script:
      "League recap. Big shifts in AllFantasy Pro League.\n\n" +
      "Top waiver targets. Prioritize opportunity and volume.\n\n" +
      `Player performance summary. Key performances from ${DEFAULT_SPORT} this week.`,
    playbackUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
    durationSeconds: 140,
  })
  const [generateClicks, setGenerateClicks] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [shareDone, setShareDone] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function handleGenerate() {
    setGenerateClicks((prev) => prev + 1)
    setGenerating(true)
    setError(null)
    setShareDone(false)
    setShareError(null)
    setPlaying(false)
    try {
      const title = `Fantasy Recap — ${leagueName} ${weekLabel}`
      const script =
        `League recap. Big shifts in ${leagueName}.\n\n` +
        `Top waiver targets. Prioritize opportunity and volume.\n\n` +
        `Player performance summary. Key performances from ${sport} this week.`
      setEpisode({
        id: `local-${Date.now()}`,
        title,
        script,
        playbackUrl:
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
        durationSeconds: 140,
      })
    } catch {
      setError("Failed to generate podcast")
    } finally {
      setGenerating(false)
    }
  }

  const handlePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    audio.play().catch(() => {
      setShareError("Playback failed")
    })
    setPlaying(true)
  }

  const handleShare = async () => {
    if (!episode) return
    setShareError(null)
    setShareDone(false)
    const url = `${window.location.origin}/podcast/${episode.id}`
    try {
      if (navigator.share && navigator.canShare?.({ url })) {
        await navigator.share({
          title: episode.title,
          text: `Fantasy podcast: ${episode.title}`,
          url,
        })
        setShareDone(true)
        return
      }
      await navigator.clipboard.writeText(url)
      setShareDone(true)
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setShareError("Share failed")
      }
    }
  }

  return (
    <main className="min-h-screen bg-[#0b1020] p-6 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Podcast Generator Harness</h1>
          <p className="text-sm text-white/70">
            Validates weekly podcast generation, playback, and share click paths.
          </p>
        </header>

        <section
          className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4"
          data-testid="podcast-generation-panel"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-white/70">Sport</span>
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-white"
                data-testid="podcast-sport-select"
              >
                {SUPPORTED_SPORTS.map((s) => (
                  <option key={s} value={s} className="bg-slate-900">
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-white/70">League name</span>
              <input
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-white"
                data-testid="podcast-league-input"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-white/70">Week label</span>
              <input
                value={weekLabel}
                onChange={(e) => setWeekLabel(e.target.value)}
                className="w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-white"
                data-testid="podcast-week-input"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-600 disabled:opacity-60"
            data-testid="podcast-generate-button"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {generating ? "Generating..." : "Generate weekly podcast"}
          </button>

          {error && (
            <p className="text-sm text-red-300" data-testid="podcast-generate-error">
              {error}
            </p>
          )}
          <p className="text-xs text-white/50" data-testid="podcast-generate-click-count">
            Click count: {generateClicks}
          </p>
        </section>

        {episode ? (
          <section
            className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-3"
            data-testid="podcast-generated-episode"
          >
            <p className="text-xs uppercase tracking-wide text-emerald-300">Generated</p>
            <h2 className="text-lg font-semibold" data-testid="podcast-generated-title">
              {episode.title}
            </h2>
            <p className="text-xs text-white/70">~{Math.ceil((episode.durationSeconds ?? 0) / 60)} min</p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handlePlay}
                data-testid="podcast-play-button"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500 text-white hover:bg-cyan-600 transition"
                aria-label={playing ? "Pause podcast" : "Play podcast"}
              >
                {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={handleShare}
                data-testid="podcast-share-button"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-white/90 hover:bg-white/10 transition"
              >
                <Share2 className="h-4 w-4" />
                {shareDone ? "Copied!" : "Share"}
              </button>
            </div>
            {shareDone && !shareError ? (
              <p className="text-xs text-emerald-300" data-testid="podcast-share-success">
                Share link ready.
              </p>
            ) : null}
            {shareError ? (
              <p className="text-xs text-red-300" data-testid="podcast-share-error">
                {shareError}
              </p>
            ) : null}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-medium text-white/50 uppercase tracking-wider mb-2">Script</p>
              <p className="text-sm text-white/80 whitespace-pre-wrap">{episode.script}</p>
            </div>
            <audio
              ref={audioRef}
              src={episode.playbackUrl ?? undefined}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
            />
          </section>
        ) : null}
      </div>
    </main>
  )
}

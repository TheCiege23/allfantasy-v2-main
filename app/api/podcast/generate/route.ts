import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getServedOrigin } from "@/lib/http/served-origin"
import { generateFantasyPodcastScript } from "@/lib/podcast-engine/FantasyPodcastGenerator"
import { synthesizeScriptToAudio } from "@/lib/podcast-engine/VoiceSynthesisService"
import {
  createEpisode,
  getShareUrl,
  getPlaybackUrl,
} from "@/lib/podcast-engine/PodcastDistributionService"
import { normalizeToSupportedSport } from "@/lib/sport-scope"

export const dynamic = "force-dynamic"

/**
 * POST /api/podcast/generate
 * Generates a weekly fantasy podcast (script + optional audio), stores episode, returns id and URLs.
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const options = {
    leagueName: body.leagueName,
    sport: body.sport ? normalizeToSupportedSport(body.sport) : undefined,
    weekLabel: body.weekLabel,
  }

  const { title, script } = generateFantasyPodcastScript(options)
  const synthesis = await synthesizeScriptToAudio(script)

  const episode = await createEpisode({
    userId: session.user.id,
    title,
    script,
    audioUrl: synthesis.audioUrl,
    durationSeconds: synthesis.durationSeconds ?? null,
  })

  if (!episode) {
    return NextResponse.json({ error: "Failed to create episode" }, { status: 500 })
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? getServedOrigin(req)
  const shareUrl = getShareUrl(episode.id, baseUrl || "https://allfantasy.ai")
  const playbackUrl = getPlaybackUrl(episode)

  return NextResponse.json({
    id: episode.id,
    title: episode.title,
    script: episode.script,
    playbackUrl,
    shareUrl,
    durationSeconds: episode.durationSeconds,
    createdAt: episode.createdAt,
  })
}

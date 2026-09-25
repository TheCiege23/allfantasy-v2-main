import * as prismaJson from '@/lib/prisma-json'
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getEpisode } from "@/lib/fantasy-media/FantasyMediaQueryService"
import { createHeyGenVideo } from "@/lib/fantasy-media/HeyGenVideoService"
import { trackVideoJob } from "@/lib/fantasy-media/VideoGenerationJobTracker"
import { MEDIA_TYPES, type MediaType } from "@/lib/fantasy-media/types"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

/**
 * POST /api/fantasy-media/episodes/[id]/retry
 * Retries a failed/generating HeyGen episode using stored title/script and context.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const episode = await getEpisode(id, session.user.id)
  if (!episode) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (episode.provider !== "heygen") {
    return NextResponse.json({ error: "Retry only supported for HeyGen episodes" }, { status: 400 })
  }

  const createResult = await createHeyGenVideo({
    title: episode.title,
    sport: episode.sport,
    contentType: (MEDIA_TYPES.includes(episode.mediaType as MediaType)
      ? episode.mediaType
      : "weekly_recap") as MediaType,
    script: episode.script,
  })
  if (!createResult) {
    return NextResponse.json({ error: "HeyGen retry failed" }, { status: 502 })
  }

  const previousMeta =
    episode.meta && typeof episode.meta === "object" && !Array.isArray(episode.meta)
      ? (episode.meta as Record<string, unknown>)
      : {}

  const updated = await prisma.fantasyMediaEpisode.update({
    where: { id: episode.id },
    data: {
      status: "generating",
      providerJobId: createResult.videoId,
      playbackUrl: null,
      meta: prismaJson.toPrismaJsonInput({
        ...previousMeta,
        heygen: createResult.payloadMetadata,
        retry: {
          at: new Date().toISOString(),
          previousJobId: episode.providerJobId ?? null,
        },
      }),
      updatedAt: new Date(),
    },
  })

  void trackVideoJob(updated.id).catch((err) => {
    console.error("[fantasy-media] retry trackVideoJob failed", updated.id, err)
  })

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    providerJobId: updated.providerJobId,
    updatedAt: updated.updatedAt,
  })
}

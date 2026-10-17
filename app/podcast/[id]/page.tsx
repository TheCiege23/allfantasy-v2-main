import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { getEpisode } from "@/lib/podcast-engine/PodcastDistributionService"
import PodcastPlayerClient from "./PodcastPlayerClient"

export const dynamic = "force-dynamic"

export default async function PodcastEpisodePage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=/podcast/${params.id}`)
  }

  const episode = await getEpisode(params.id, session.user.id)
  if (!episode) notFound()

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <PodcastPlayerClient
          episodeId={episode.id}
          title={episode.title}
          script={episode.script}
          playbackUrl={episode.audioUrl}
          durationSeconds={episode.durationSeconds}
        />
      </div>
    </div>
  )
}

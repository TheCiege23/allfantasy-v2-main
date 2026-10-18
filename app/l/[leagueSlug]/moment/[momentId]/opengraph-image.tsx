import { notFound } from 'next/navigation'
import { PUBLIC_IMAGE_CACHE_CONTROL } from '@/lib/survivor/shareCards/momentAccess'
import { loadMomentPageData } from '@/lib/survivor/shareCards/momentPage'
import { renderShareCard } from '@/lib/survivor/shareCards/renderCard'
import { SHARE_CARD_SIZES } from '@/lib/survivor/shareCards/types'

/**
 * og:image for the public moment page: the `link` render (1200×630), identical to
 * `/api/share/survivor/[momentId]?f=link`. Served from the page path rather than `/api/*` because
 * middleware refuses API calls from anonymized/data-centre addresses but lets link-preview crawlers
 * through on pages — and the preview is the whole point of the moment page.
 */
export const runtime = 'nodejs'
export const size = SHARE_CARD_SIZES.link
export const contentType = 'image/png'
export const alt = 'AllFantasy Survivor moment'

export default async function Image({ params }: { params: Promise<{ leagueSlug: string; momentId: string }> }) {
  const { leagueSlug, momentId } = await params
  // A private league (public moment pages off) gets no preview image either.
  const data = await loadMomentPageData(leagueSlug, momentId, { details: false })
  if (!data || data.state !== 'public') notFound()
  return renderShareCard(data.moment, 'link', PUBLIC_IMAGE_CACHE_CONTROL)
}

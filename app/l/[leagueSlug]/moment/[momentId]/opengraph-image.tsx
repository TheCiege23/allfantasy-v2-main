import { notFound } from 'next/navigation'
import { PUBLIC_IMAGE_CACHE_CONTROL } from '@/lib/survivor/shareCards/momentAccess'
import { loadPublicShareMoment } from '@/lib/survivor/shareCards/momentStore'
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
  const moment = await loadPublicShareMoment(leagueSlug, momentId)
  if (!moment) notFound()
  return renderShareCard(moment, 'link', PUBLIC_IMAGE_CACHE_CONTROL)
}

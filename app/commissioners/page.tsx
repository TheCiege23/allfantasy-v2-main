import type { Metadata } from 'next'
import { CommissionersV4 } from '@/components/core-app/screens/CommissionersV4'
import { COMMISSIONERS_META } from '@/components/core-app/screens/commissionersCopy'
import { getHomeInitialSession } from '@/lib/landing/get-home-initial-session'
import { buildSeoMeta } from '@/lib/seo'

/**
 * /commissioners — the Commissioner OS page. Every "For commissioners" link lands here, not on
 * /pricing, so a commissioner sees what the product does before being asked to pick a plan.
 *
 * Public, like `/` and `/pricing`: no middleware rule names this path, and a signed-out visitor is
 * the main audience.
 */

export const metadata: Metadata = buildSeoMeta({
  title: COMMISSIONERS_META.title,
  description: COMMISSIONERS_META.description,
  canonicalPath: '/commissioners',
  openGraphTitle: COMMISSIONERS_META.ogTitle,
  openGraphDescription: COMMISSIONERS_META.ogDescription,
  twitterTitle: COMMISSIONERS_META.ogTitle,
  twitterDescription: COMMISSIONERS_META.ogDescription,
  imagePath: '/og-image.jpg',
  keywords: [
    'fantasy commissioner tools',
    'Commissioner OS',
    'fantasy league health',
    'illegal lineup alerts',
    'fantasy trade evaluator',
    'anti-collusion fantasy',
    'fantasy league management',
  ],
})

export default async function CommissionersPage() {
  /*
   * Same session read and the same "signed in" test as `/` (app/page.tsx), so the primary CTA goes
   * straight to /import for a signed-in commissioner instead of asking them to sign up again.
   */
  const session = await getHomeInitialSession()
  const signedIn = typeof session?.user?.id === 'string' && session.user.id.trim() !== ''

  return <CommissionersV4 signedIn={signedIn} />
}

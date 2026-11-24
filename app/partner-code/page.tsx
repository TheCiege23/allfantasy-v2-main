import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isPartnerCodesEnabled, isPartnerDemoEnabled } from '@/lib/partner-codes/flags'
import { getPartnerDashboard } from '@/lib/partner-codes/dashboard'
import { PartnerCodeDashboard } from '@/components/partner-codes/PartnerCodeDashboard'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const metadata = { title: 'Partner Code · AllFantasy', robots: { index: false, follow: false } }

/**
 * The commissioner's Partner Code page (docs/partner-codes/README.md).
 * `?demo=1` shows the seeded DEMOCOMMISH data, only where PARTNER_DEMO is on.
 */
export default async function PartnerCodePage(props: { searchParams?: Promise<{ demo?: string }> }) {
  if (!isPartnerCodesEnabled()) notFound()
  const sp = (await props.searchParams) ?? {}
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent('/partner-code')}`)

  let viewUserId = userId
  let demo = false
  if (sp.demo === '1' && isPartnerDemoEnabled()) {
    const demoCode = await prisma.partnerCode.findFirst({ where: { isDemo: true }, select: { ownerUserId: true } })
    if (demoCode) {
      viewUserId = demoCode.ownerUserId
      demo = true
    }
  }
  const data = await getPartnerDashboard(viewUserId)
  return <PartnerCodeDashboard initial={data} demo={demo} />
}

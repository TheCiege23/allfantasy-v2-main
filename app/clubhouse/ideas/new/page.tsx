import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CLUBHOUSE_NAME, clubhouseChannelHref, getChannel } from '@/lib/community/channels'
import { IDEA_CHANNEL, NEW_IDEA_HREF } from '@/lib/community/ideas'
import { getCommunityViewer } from '@/lib/community/service'
import { ClubhouseFrame, PageHeader, loginHref } from '@/components/community/CommunityBits'
import { IdeaForm } from '@/components/community/IdeaClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `Pitch a league idea | ${CLUBHOUSE_NAME} | AllFantasy`,
  robots: { index: false },
}

export default async function NewIdeaPage() {
  const viewer = await getCommunityViewer()
  if (!viewer.userId) redirect(loginHref(NEW_IDEA_HREF))
  const lab = getChannel(IDEA_CHANNEL)

  return (
    <ClubhouseFrame
      narrow
      active={clubhouseChannelHref(IDEA_CHANNEL)}
      crumbs={[
        { href: '/clubhouse', label: CLUBHOUSE_NAME },
        { href: clubhouseChannelHref(IDEA_CHANNEL), label: lab?.label ?? 'League Lab' },
      ]}
    >
      <PageHeader
        channel={IDEA_CHANNEL}
        icon="💡"
        eyebrow="League Lab"
        title="Pitch a league idea"
        sub="Three boxes and you are done. The best-upvoted ideas get a look from the AllFantasy team."
      />
      <IdeaForm />
      <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>
        Have the whole format worked out, with edge cases and rules, and want to send it privately?{' '}
        <Link href="/submit-league" className="underline">
          Use the detailed submission form
        </Link>
        .
      </p>
    </ClubhouseFrame>
  )
}

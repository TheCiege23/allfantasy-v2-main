import { AndroidInviteAppPrompt } from '@/components/league-join/AndroidInviteAppPrompt'
import { IosInviteAppPrompt } from '@/components/league-join/IosInviteAppPrompt'

export const dynamic = 'force-dynamic'

export default function JoinLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      {/* Android browsers only: open this invite in the app, or get it on Google Play. */}
      <AndroidInviteAppPrompt />
      {/* iPhone browsers only: join here, then get the app on the App Store. */}
      <IosInviteAppPrompt />
    </>
  )
}

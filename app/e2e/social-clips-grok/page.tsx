import { notFound } from 'next/navigation'
import SocialClipsGrokHarnessClient from './SocialClipsGrokHarnessClient'

export default function SocialClipsGrokHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <SocialClipsGrokHarnessClient />
}

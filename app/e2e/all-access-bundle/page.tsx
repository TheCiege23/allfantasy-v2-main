import { notFound } from 'next/navigation'
import { AllAccessBundleHarnessClient } from './AllAccessBundleHarnessClient'

export default function E2EAllAccessBundlePage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <AllAccessBundleHarnessClient />
}

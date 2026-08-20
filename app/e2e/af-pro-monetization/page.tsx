import { notFound } from 'next/navigation'
import { AfProMonetizationHarnessClient } from './AfProMonetizationHarnessClient'

export default function E2EAfProMonetizationPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }

  return <AfProMonetizationHarnessClient />
}


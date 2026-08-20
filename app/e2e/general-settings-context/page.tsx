import { notFound } from 'next/navigation'
import { GeneralSettingsContextHarnessClient } from './GeneralSettingsContextHarnessClient'

export default function GeneralSettingsContextHarnessPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound()
  }
  return <GeneralSettingsContextHarnessClient />
}

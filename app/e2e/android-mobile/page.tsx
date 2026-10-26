import { notFound } from 'next/navigation'
import AndroidMobileHarness from './AndroidMobileHarness'
export default function Page() {
  if (process.env.NODE_ENV === 'production' || process.env.PLAYWRIGHT_E2E !== '1') notFound()
  return <AndroidMobileHarness />
}

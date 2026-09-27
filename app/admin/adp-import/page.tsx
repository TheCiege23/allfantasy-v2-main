import { redirect } from 'next/navigation'
import { getAdminAccessState } from '@/lib/adminAuth'
import AdpImportClient from './AdpImportClient'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

export default async function AdpImportPage() {
  if ((await getAdminAccessState()).status !== 'admin') redirect('/admin')
  return <main className="min-h-dvh bg-[#020817] px-4 py-8 text-white">
    <div className="mx-auto max-w-3xl">
      <a href="/admin" className="text-sm text-cyan-200">Back to admin</a>
      <h1 className="mt-4 text-3xl font-bold">Licensed market ADP import</h1>
      <p className="mt-3 text-sm text-white/70">Upload observed draft positions from a source you are licensed to use. Select the expected context, validate the export, then review the accepted count before importing.</p>
      <AdpImportClient />
    </div>
  </main>
}

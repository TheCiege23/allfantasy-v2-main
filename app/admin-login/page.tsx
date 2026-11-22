import { Suspense } from 'react'
import AdminLoginContent from './AdminLoginContent'
import { ADMIN_LOGIN_LIGHT_TOKENS } from './lightTokens'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Admin Login · AllFantasy',
  robots: { index: false, follow: false },
}

function AdminLoginFallback() {
  return (
    <div
      style={ADMIN_LOGIN_LIGHT_TOKENS}
      className="flex min-h-screen items-center justify-center bg-gradient-to-b from-white to-[#EEF1F7] text-[13px] text-[color:var(--muted)]"
    >
      Loading…
    </div>
  )
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<AdminLoginFallback />}>
      <AdminLoginContent />
    </Suspense>
  )
}

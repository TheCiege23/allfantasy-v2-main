'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const SLEEPER_LAUNCH_YEAR = 2017

export type SleeperImportResult = {
  imported: number
  uniqueLeagues?: number
  seasons: number
  years?: number[]
  sports?: Record<string, number>
  sleeperUserId?: string
  success?: boolean
  jobId?: string
  leagues?: { name: string; sport: string; seasons: string[] }[]
}

function getImportErrorMessage(data: { error?: string } | null | undefined, fallback: string) {
  if (data?.error === 'VERIFICATION_REQUIRED') return 'Verify your email or phone before importing leagues.'
  if (data?.error === 'AGE_REQUIRED') return 'Confirm that you are 18+ before importing leagues.'
  if (
    data?.error === 'UNAUTHENTICATED' ||
    data?.error === 'Unauthorized' ||
    data?.error === 'Not authenticated' ||
    data?.error === 'Authentication required'
  ) {
    return 'Sign in to import leagues.'
  }
  if (data?.error === 'No leagues found') {
    return 'No Sleeper leagues found for this account in any scanned season. If you only play NBA (or another sport), try again — we scan NFL, NBA, NHL, MLB, and MLS.'
  }
  if (
    (data as { code?: string })?.code === 'IMPORT_SCHEMA_UPDATE_REQUIRED' ||
    String(data?.error ?? '').includes('IMPORT_SCHEMA_UPDATE_REQUIRED')
  ) {
    return 'League import is temporarily unavailable while we update our servers. Please try again in a little while.'
  }
  return data?.error || fallback
}

export default function SleeperImportForm() {
  const router = useRouter()
  const [sleeperUsername, setSleeperUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SleeperImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scanEndYear = new Date().getFullYear() + 1

  async function handleImport() {
    if (!sleeperUsername.trim()) {
      setError('Please enter your Sleeper username')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/leagues/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: sleeperUsername.trim(), platform: 'sleeper' }),
      })

      const text = await res.text()
      let data: SleeperImportResult & { error?: string }
      try {
        data = JSON.parse(text) as SleeperImportResult & { error?: string }
      } catch {
        throw new Error(`Server error: ${text.slice(0, 100)}`)
      }

      if (!res.ok) throw new Error(getImportErrorMessage(data, data.error || `Import failed (${res.status})`))
      if (data.success === true && typeof (data as { jobId?: string }).jobId === 'string') {
        router.push(`/af-rankings?jobId=${encodeURIComponent((data as { jobId: string }).jobId)}`)
        return
      }
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Import failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-white/10 bg-[#0a1228]/90 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-3 text-xl text-white">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[16px] font-black text-white"
            style={{ background: 'linear-gradient(135deg, #1a9e5c, #16a34a)' }}
            aria-hidden
          >
            S
          </div>
          <span>Import from Sleeper</span>
        </CardTitle>
        <CardDescription className="text-slate-400">
          Connect your Sleeper account to import all your leagues and every season automatically — from {SLEEPER_LAUNCH_YEAR}{' '}
          to {scanEndYear}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label htmlFor="sleeper-username" className="mb-1 block text-sm text-slate-400">
            Sleeper Username
          </label>
          <input
            id="sleeper-username"
            type="text"
            value={sleeperUsername}
            onChange={(e) => setSleeperUsername(e.target.value)}
            placeholder="e.g. your Sleeper username"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={loading}
            className="w-full min-h-[44px] rounded-xl border border-white/[0.10] bg-white/[0.06] px-4 py-3 text-[14px] text-white placeholder:text-white/30 focus:border-cyan-500/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <ul className="space-y-1 text-sm text-slate-400">
          <li className="flex gap-2">
            <span className="text-emerald-500">✓</span> All major Sleeper API sports we scan (NFL, NBA, NHL, MLB, MLS)
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-500">✓</span> All seasons ({SLEEPER_LAUNCH_YEAR} → {scanEndYear})
          </li>
          <li className="flex gap-2">
            <span className="text-emerald-500">✓</span> Dynasty, redraft, and best ball
          </li>
        </ul>

        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={loading || !sleeperUsername.trim()}
          className="w-full rounded-xl bg-cyan-600 py-3 text-[14px] font-bold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Scanning all Sleeper seasons...
            </span>
          ) : (
            'Import All Leagues'
          )}
        </button>

        {error ? <p className="text-center text-[13px] text-red-400">⚠ {error}</p> : null}

        {result ? (
          <div className="mt-4 rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-center">
            <p className="mb-1 text-[16px] font-bold text-green-400">✅ Import Complete!</p>
            <p className="mb-1 text-[13px] text-white/70">
              {(result.uniqueLeagues ?? result.imported) || 0} unique league
              {(result.uniqueLeagues ?? result.imported) !== 1 ? 's' : ''} ({result.imported} league-season rows) across{' '}
              {result.seasons} season{result.seasons !== 1 ? 's' : ''}
            </p>
            {result.sports && Object.keys(result.sports).length > 0 ? (
              <p className="mb-3 text-[11px] text-white/40">
                {Object.entries(result.sports)
                  .map(([s, n]) => `${s}: ${n}`)
                  .join(' · ')}
              </p>
            ) : null}
            <Link
              href="/core"
              className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2 text-[13px] font-bold text-black hover:bg-cyan-400"
            >
              View My Leagues →
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

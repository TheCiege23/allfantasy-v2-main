'use client'

import { useEffect, useState } from 'react'
import type { WaiverIntelPayload } from '@/lib/waiver-intel/waiverIntelService'

export type WaiverIntelResponse =
  | { supported: false; platform: string }
  | { supported: true; intel: WaiverIntelPayload | null; error?: string }

/*
 * ONE REQUEST PER LEAGUE FOR EVERY PANEL THAT WANTS IT. The Waivers screen mounts both the bid
 * panel (`WaiverIntel`) and the lineup list, which now prints the same bid beside each add; two
 * independent fetches would be two copies of a slow, provider-backed read that could also come
 * back different. In-flight and settled promises are shared for a short window, so a remount on
 * navigation still refreshes.
 */
const SHARE_MS = 60_000
const inflight = new Map<string, { at: number; p: Promise<WaiverIntelResponse> }>()

export function fetchWaiverIntel(leagueId: string): Promise<WaiverIntelResponse> {
  const hit = inflight.get(leagueId)
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.p
  const p = fetch(`/api/league/waiver-intel?leagueId=${encodeURIComponent(leagueId)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
  })
    .then((res) => res.json() as Promise<WaiverIntelResponse>)
    .catch((): WaiverIntelResponse => ({ supported: true, intel: null, error: 'Request failed' }))
  inflight.set(leagueId, { at: Date.now(), p })
  return p
}

export function useWaiverIntel(leagueId: string, enabled = true): { data: WaiverIntelResponse | null; loading: boolean } {
  const [data, setData] = useState<WaiverIntelResponse | null>(null)
  const [loading, setLoading] = useState(enabled)
  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void fetchWaiverIntel(leagueId).then((payload) => {
      if (cancelled) return
      setData(payload)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [leagueId, enabled])
  return { data, loading }
}

'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { TribeBuff } from '@/components/survivor/late/TribeBuff'
import { SurvivorAvatar } from '@/components/survivor/weekly/SurvivorAvatar'
import { survivorBackgroundSrc } from '@/lib/survivor/survivorMood'
import '../survivor-core.css'

/**
 * First tribe reveal (survivor-core §6, MobileTribeReveal): the crest pops in, the buff drops, then
 * the tribemates and "Open tribe chat". Shown once per viewer per league; with reduced motion the
 * end state shows straight away (CSS). Only the viewer's own tribe and display names.
 */
export interface TribeRevealData {
  tribeName: string
  crestUrl: string | null
  color: string | null
  mates: { key: string; name: string; you: boolean }[]
}

const SEEN_KEY = (leagueId: string) => `af:survivor-tribe-reveal:${leagueId}`

export function hasSeenTribeReveal(leagueId: string): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY(leagueId)) === '1'
  } catch {
    return false
  }
}

export function markTribeRevealSeen(leagueId: string): void {
  try { window.localStorage.setItem(SEEN_KEY(leagueId), '1') } catch { /* storage blocked: shows again next visit */ }
}

export function SurvivorTribeReveal({ leagueId, sport, data, chatHref, onClose }: { leagueId: string; sport: string; data: TribeRevealData; chatHref: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    markTribeRevealSeen(leagueId)
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leagueId, onClose])
  const others = data.mates.filter(m => !m.you).length
  return <div className="svk svr" role="dialog" aria-modal="true" aria-labelledby="svr-title" data-testid="survivor-tribe-reveal">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img className="svr-bg" src={survivorBackgroundSrc('dusk', sport)} alt="" />
    <div className="svr-veil" aria-hidden />
    <div className="svr-in">
      <span className="svk-lbl svr-up" style={{ color: '#d9b45a' }}>The tribes are set</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {data.crestUrl ? <img className="svr-crest" src={data.crestUrl} alt={`Tribe ${data.tribeName} crest`} /> : null}
      <TribeBuff className="svr-buff" primary={data.color} label={`${data.tribeName} buff`} />
      <h2 id="svr-title" className="svr-up svr-title" style={{ animationDelay: '1.1s' }}>Welcome to {data.tribeName}</h2>
      <p className="svk-sub svr-up" style={{ animationDelay: '1.2s' }}>{others > 0 ? `You and ${others} ${others === 1 ? 'other' : 'others'}. Win the tribe race and nobody from ${data.tribeName} goes home.` : `Win the tribe race and nobody from ${data.tribeName} goes home.`}</p>
      <ul className="svr-mates svr-up" style={{ animationDelay: '1.35s' }}>
        {data.mates.map(m => <li key={m.key}>
          <SurvivorAvatar name={m.name} size={46} ringColor={m.you ? '#d9b45a' : data.color ?? '#8b7be0'} gapColor="#07080d" />
          <span>{m.you ? 'You' : m.name}</span>
        </li>)}
      </ul>
      <span className="svk-grow" />
      <Link href={chatHref} className="svk-btn svk-btn-gold svr-up svr-wide" style={{ animationDelay: '1.5s', minHeight: 50 }} onClick={onClose}>Open tribe chat</Link>
      <button ref={closeRef} type="button" className="svk-btn svr-up svr-wide" style={{ animationDelay: '1.5s' }} onClick={onClose}>Go to league home</button>
    </div>
  </div>
}

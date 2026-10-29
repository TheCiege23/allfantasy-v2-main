'use client'

import { useEffect, useState } from 'react'

const AVATAR_BG = ['#22314f', '#2a3a1a', '#3a1f30', '#1f3a3a', '#3a2a14', '#2b2350', '#14353a', '#40201c']

export function initialsFor(name: string): string {
  const clean = name.trim()
  if (!clean) return '?'
  const words = clean.split(/\s+/)
  if (words.length > 1) {
    const last = words[words.length - 1]!
    return (words[0]![0]! + (/^\d+$/.test(last) ? last : last[0]!)).toUpperCase().slice(0, 3)
  }
  return clean.slice(0, 2).toUpperCase()
}

export function avatarColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]!
}

export function LateAvatar({ id, name, size = 'md', ring, className = '' }: { id: string; name: string; size?: 'sm' | 'md'; ring?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`svl-av ${size === 'sm' ? 'svl-av-sm' : ''} ${className}`}
      style={{ background: avatarColor(id), ...(ring ? { borderColor: ring } : {}) }}
    >
      {initialsFor(name)}
    </span>
  )
}

/** True when the viewer asked the OS for reduced motion; animations then jump to their end state. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 640px)')
    setPhone(mq.matches)
    const on = () => setPhone(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return phone
}

export const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1)
export const fmtPts = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

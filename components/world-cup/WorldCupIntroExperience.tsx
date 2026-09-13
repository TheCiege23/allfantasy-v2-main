'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { safeInternalPathOr } from '@/lib/auth/auth-intent-resolver'

const SESSION_KEY = 'af_world_cup_intro_seen'
const AUTO_ADVANCE_MS = 4200

function safeIntroDestination(value: string | null | undefined) {
  return safeInternalPathOr(value, '/brackets')
}

/**
 * Full-bleed World Cup intro experience.
 *
 * Props (both optional — omitting them uses the standalone /world-cup-intro route defaults):
 *   nextDest   — where to navigate after intro completes; falls back to ?next URL param → /brackets
 *   onComplete — called instead of router.replace() when the gate embeds this inline
 *                (avoids a redundant navigation when already on the destination page)
 */
export default function WorldCupIntroExperience({
  nextDest: nextDestProp,
  onComplete,
}: {
  nextDest?: string
  onComplete?: () => void
} = {}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextDest = nextDestProp ?? safeIntroDestination(searchParams?.get('next'))
  const forceShow = searchParams?.get('force') === '1'

  const videoRef = useRef<HTMLVideoElement>(null)
  const hasAdvancedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)

  const advance = useCallback(() => {
    if (hasAdvancedRef.current) return
    hasAdvancedRef.current = true
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    try { sessionStorage.setItem(SESSION_KEY, 'true') } catch {}
    // When embedded via WorldCupIntroGate, onComplete handles the transition
    // (no navigation needed — the gate simply reveals the bracket page in place).
    // When used as a standalone route (/world-cup-intro), router.replace navigates away.
    if (onComplete) {
      onComplete()
    } else {
      router.replace(nextDest)
    }
  }, [router, nextDest, onComplete])

  useEffect(() => {
    // prefers-reduced-motion: show static screen briefly, then advance
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const t = setTimeout(advance, 300)
      return () => clearTimeout(t)
    }

    // Already seen this session — skip unless ?force=1
    if (!forceShow) {
      let seen = false
      try { seen = sessionStorage.getItem(SESSION_KEY) === 'true' } catch {}
      if (seen) {
        advance()
        return
      }
    }

    // Auto-advance after duration
    timerRef.current = setTimeout(advance, AUTO_ADVANCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [advance, forceShow])

  return (
    <div
      aria-modal="true"
      role="dialog"
      aria-label="AF World Cup Pools intro"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        overflow: 'hidden',
        background:
          'radial-gradient(ellipse 80% 65% at 50% 38%, rgba(6,182,212,0.18) 0%, transparent 65%),' +
          'radial-gradient(ellipse 60% 52% at 50% 62%, rgba(139,92,246,0.12) 0%, transparent 68%),' +
          '#030712',
      }}
    >
      {/* Full-bleed video */}
      {!videoFailed && (
        <video
          ref={videoRef}
          src="/videos/brackets/world-cup/af-world-cup-hero.mp4"
          autoPlay
          muted
          playsInline
          preload="auto"
          onError={() => setVideoFailed(true)}
          onEnded={advance}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: 0.92,
          }}
        />
      )}

      {/* Fallback content — shown only when video fails to load */}
      {videoFailed && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '0 28px',
            gap: 20,
          }}
        >
          {/* Glow orb */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(6,182,212,0.22) 0%, transparent 60%),' +
                'radial-gradient(ellipse 55% 50% at 50% 65%, rgba(139,92,246,0.14) 0%, transparent 68%)',
              pointerEvents: 'none',
            }}
          />
          <p
            style={{
              position: 'relative',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(6,182,212,0.85)',
              margin: 0,
            }}
          >
            You have finally made it to greatness.
          </p>
          <h1
            style={{
              position: 'relative',
              margin: 0,
              fontSize: 'clamp(30px, 8vw, 60px)',
              fontWeight: 900,
              lineHeight: 1.05,
              backgroundImage: 'linear-gradient(90deg, #22d3ee, #818cf8)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Welcome to
            <br />
            AF World Cup Pools.
          </h1>
        </div>
      )}

      {/* Skip intro button — always visible */}
      <button
        type="button"
        onClick={advance}
        aria-label="Skip intro"
        style={{
          position: 'absolute',
          bottom: 'max(32px, calc(env(safe-area-inset-bottom, 0px) + 20px))',
          right: 20,
          zIndex: 10,
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderRadius: 999,
          color: 'rgba(255,255,255,0.82)',
          fontSize: 13,
          fontWeight: 600,
          padding: '8px 22px',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          letterSpacing: '0.04em',
          transition: 'background 0.15s, opacity 0.15s',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.18)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)' }}
      >
        Skip intro →
      </button>
    </div>
  )
}

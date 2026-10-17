'use client'

import React, { useState, useEffect, useRef } from 'react'

export default function CrestImpactAnimation() {
  const [phase, setPhase] = useState<'waiting' | 'flying' | 'impact' | 'cracks' | 'fade' | 'done'>('waiting')
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const hasPlayed = sessionStorage.getItem('af-crest-played')
    if (hasPlayed) {
      setPhase('done')
      return
    }

    requestAnimationFrame(() => setPhase('flying'))

    const timers = [
      setTimeout(() => setPhase('impact'), 850),
      setTimeout(() => setPhase('cracks'), 950),
      setTimeout(() => setPhase('fade'), 2400),
      setTimeout(() => {
        setPhase('done')
        sessionStorage.setItem('af-crest-played', '1')
      }, 3200),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  if (phase === 'done') return null

  const sparkDirs = [
    { x: 110, y: 0 }, { x: 95, y: 55 }, { x: 55, y: 95 }, { x: 0, y: 110 },
    { x: -55, y: 95 }, { x: -95, y: 55 }, { x: -110, y: 0 }, { x: -95, y: -55 },
    { x: -55, y: -95 }, { x: 0, y: -110 }, { x: 55, y: -95 }, { x: 95, y: -55 },
  ]

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes af-fly-in {
          0% { transform: translate(-50%, -50%) scale(4) rotate(-20deg); opacity: 0; filter: blur(12px); }
          50% { opacity: 1; filter: blur(4px); }
          85% { transform: translate(-50%, -50%) scale(1.05) rotate(2deg); filter: blur(0px); }
          100% { transform: translate(-50%, -50%) scale(1) rotate(0deg); opacity: 1; filter: blur(0px); }
        }
        @keyframes af-impact-pulse {
          0% { transform: translate(-50%, -50%) scale(1); }
          40% { transform: translate(-50%, -50%) scale(1.2); }
          100% { transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes af-shatter-out {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 1; filter: blur(0); }
          50% { transform: translate(-50%, -50%) scale(1.08); opacity: 0.7; }
          100% { transform: translate(-50%, -50%) scale(0.2) rotate(15deg); opacity: 0; filter: blur(10px); }
        }
        @keyframes af-flash {
          0% { opacity: 0.4; }
          100% { opacity: 0; }
        }
        @keyframes af-crack-grow {
          0% { stroke-dashoffset: 900; opacity: 0; }
          8% { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 0.9; }
        }
        @keyframes af-crack-branch {
          0% { stroke-dashoffset: 400; opacity: 0; }
          35% { opacity: 0; }
          45% { opacity: 0.6; }
          100% { stroke-dashoffset: 0; opacity: 0.6; }
        }
        @keyframes af-spark-burst {
          0% { transform: translate(0,0) scale(1.2); opacity: 1; }
          100% { transform: translate(var(--sx), var(--sy)) scale(0); opacity: 0; }
        }
        @keyframes af-screen-shake {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-4px, 3px); }
          20% { transform: translate(3px, -4px); }
          30% { transform: translate(-3px, -2px); }
          40% { transform: translate(4px, 2px); }
          50% { transform: translate(-2px, 4px); }
          60% { transform: translate(3px, -3px); }
          70% { transform: translate(-4px, 1px); }
          80% { transform: translate(2px, -3px); }
          90% { transform: translate(-1px, 3px); }
        }
        @keyframes af-ring-expand {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0.8; }
          100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }
      `}} />

      <div
        ref={overlayRef}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          pointerEvents: 'none',
          opacity: phase === 'fade' ? 0 : 1,
          transition: 'opacity 0.8s ease-out',
          animation: (phase === 'impact' || phase === 'cracks') ? 'af-screen-shake 0.4s ease-out' : 'none',
        }}
      >
        {(phase === 'impact' || phase === 'cracks') && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(circle at center, rgba(139,92,246,0.35), rgba(6,182,212,0.15), transparent 70%)',
            animation: 'af-flash 0.5s ease-out forwards',
          }} />
        )}

        {(phase === 'impact' || phase === 'cracks') && (
          <div style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 200,
            height: 200,
            borderRadius: '50%',
            border: '2px solid rgba(139,92,246,0.6)',
            animation: 'af-ring-expand 0.8s ease-out forwards',
            pointerEvents: 'none',
          }} />
        )}

        <svg
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          viewBox="0 0 1920 1080"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="af-glow">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {(phase === 'cracks' || phase === 'fade') && (
            <g filter="url(#af-glow)">
              {[
                { x1: 960, y1: 540, x2: 680, y2: 160, c: 'rgba(139,92,246,0.9)', w: 3.5, d: 0 },
                { x1: 960, y1: 540, x2: 1250, y2: 140, c: 'rgba(6,182,212,0.85)', w: 3, d: 0.04 },
                { x1: 960, y1: 540, x2: 550, y2: 620, c: 'rgba(139,92,246,0.8)', w: 2.8, d: 0.07 },
                { x1: 960, y1: 540, x2: 1400, y2: 680, c: 'rgba(6,182,212,0.8)', w: 2.5, d: 0.1 },
                { x1: 960, y1: 540, x2: 750, y2: 950, c: 'rgba(139,92,246,0.75)', w: 2.5, d: 0.13 },
                { x1: 960, y1: 540, x2: 1200, y2: 920, c: 'rgba(6,182,212,0.75)', w: 2.8, d: 0.16 },
                { x1: 960, y1: 540, x2: 450, y2: 380, c: 'rgba(139,92,246,0.6)', w: 2, d: 0.19 },
                { x1: 960, y1: 540, x2: 1450, y2: 320, c: 'rgba(6,182,212,0.6)', w: 2, d: 0.22 },
              ].map((l, i) => (
                <line key={`m-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke={l.c} strokeWidth={l.w} strokeLinecap="round"
                  strokeDasharray="900" strokeDashoffset="900"
                  style={{ animation: `af-crack-grow 0.6s ${l.d}s ease-out forwards` }}
                />
              ))}
              {[
                { x1: 680, y1: 160, x2: 600, y2: 20, c: 'rgba(139,92,246,0.5)', d: 0.32 },
                { x1: 680, y1: 160, x2: 520, y2: 120, c: 'rgba(139,92,246,0.4)', d: 0.36 },
                { x1: 1250, y1: 140, x2: 1400, y2: 20, c: 'rgba(6,182,212,0.5)', d: 0.34 },
                { x1: 1250, y1: 140, x2: 1360, y2: 80, c: 'rgba(6,182,212,0.4)', d: 0.38 },
                { x1: 550, y1: 620, x2: 350, y2: 720, c: 'rgba(139,92,246,0.4)', d: 0.4 },
                { x1: 1400, y1: 680, x2: 1580, y2: 790, c: 'rgba(6,182,212,0.4)', d: 0.42 },
                { x1: 750, y1: 950, x2: 640, y2: 1080, c: 'rgba(139,92,246,0.35)', d: 0.44 },
                { x1: 1200, y1: 920, x2: 1320, y2: 1080, c: 'rgba(6,182,212,0.35)', d: 0.46 },
                { x1: 450, y1: 380, x2: 280, y2: 300, c: 'rgba(139,92,246,0.3)', d: 0.48 },
                { x1: 1450, y1: 320, x2: 1620, y2: 240, c: 'rgba(6,182,212,0.3)', d: 0.5 },
              ].map((l, i) => (
                <line key={`b-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                  stroke={l.c} strokeWidth={1.5} strokeLinecap="round"
                  strokeDasharray="400" strokeDashoffset="400"
                  style={{ animation: `af-crack-branch 0.4s ${l.d}s ease-out forwards` }}
                />
              ))}
            </g>
          )}
        </svg>

        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          animation:
            phase === 'flying' ? 'af-fly-in 0.8s cubic-bezier(0.16,1,0.3,1) forwards' :
            phase === 'impact' ? 'af-impact-pulse 0.15s ease-out forwards' :
            (phase === 'cracks' || phase === 'fade') ? 'af-shatter-out 1.2s cubic-bezier(0.4,0,0.2,1) forwards' :
            'none',
          transform: phase === 'waiting' ? 'translate(-50%, -50%) scale(4)' : undefined,
          opacity: phase === 'waiting' ? 0 : undefined,
        }}>
          <div style={{ position: 'relative' }}>
            {/*
              Transparent crest, so the glow is a drop-shadow that follows the
              shield's outline. A box-shadow (and the inset ring that used to
              sit over it) traced the old JPEG's black square instead.
            */}
            <img
              src="/af-crest.svg"
              alt="AF Crest"
              style={{
                width: 140,
                height: 140,
                objectFit: 'contain',
                filter: 'drop-shadow(0 0 30px rgba(139,92,246,0.6)) drop-shadow(0 0 60px rgba(6,182,212,0.3))',
                display: 'block',
              }}
            />
          </div>
        </div>

        {(phase === 'impact' || phase === 'cracks') && (
          <div style={{ position: 'absolute', left: '50%', top: '50%' }}>
            {sparkDirs.map((d, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: i % 2 === 0 ? '#8b5cf6' : '#06b6d4',
                  boxShadow: `0 0 6px ${i % 2 === 0 ? '#8b5cf6' : '#06b6d4'}`,
                  '--sx': `${d.x}px`,
                  '--sy': `${d.y}px`,
                  animation: `af-spark-burst 0.55s ${i * 0.03}s ease-out forwards`,
                } as React.CSSProperties}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}

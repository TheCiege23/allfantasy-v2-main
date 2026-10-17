'use client'

import { useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AccentTone } from '@/lib/create-league-v2/theme'
import type { ResolvedCreateLeagueMedia } from '@/lib/create-league-v2/media-priority'

export function CreateLeagueHeroMedia({
  media,
  accent,
}: {
  media: ResolvedCreateLeagueMedia
  accent: AccentTone
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] shadow-[0_24px_80px_-30px_rgba(0,0,0,0.9)]">
      <AnimatePresence mode="wait">
        <motion.div
          key={media.mediaKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
          className="relative"
        >
          <video
            ref={videoRef}
            className="block aspect-[16/9] w-full object-cover sm:aspect-[21/9] sm:max-h-[min(52vh,420px)]"
            src={media.video}
            poster={media.poster}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            onError={() => {
              const el = videoRef.current
              if (!el) return
              if (media.fallback && el.src !== new URL(media.fallback, window.location.origin).href) {
                el.src = media.fallback
                el.load()
              }
            }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#060a18] via-[#060a18]/40 to-transparent"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent"
            aria-hidden
          />
          {media.badge ? (
            <div className="absolute left-4 top-4 rounded-full border border-white/15 bg-black/45 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/85 backdrop-blur-md">
              {media.badge}
            </div>
          ) : null}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 opacity-80"
            style={{ background: `linear-gradient(to top, ${accent.hex}44 0%, transparent 100%)` }}
            aria-hidden
          />
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

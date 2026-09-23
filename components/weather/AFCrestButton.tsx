'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import { emptyAFProjectionDisplay } from '@/lib/weather/afProjectionAdapter'
import type { AFCrestButtonProps } from '@/components/weather/afCrestTypes'
import { useAFProjection } from '@/components/weather/useAFProjection'
import { AFProjectionPopover } from '@/components/weather/AFProjectionPopover'

function resolvedSize(size: AFCrestButtonProps['size']): 'xs' | 'sm' {
  if (size === 'xs' || size === 'sm') return size
  return 'sm'
}

export function AFCrestButton(props: AFCrestButtonProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [isMobile, setIsMobile] = useState(false)

  const { loading, data, fetched, fetch } = useAFProjection(props)

  const sportKey = props.sport.trim().toUpperCase()
  const allowed = isWeatherSensitiveSport(sportKey) && !props.isIndoor && !props.isDome

  const size = resolvedSize(props.size ?? 'xs')
  const side = props.popoverSide ?? 'top'

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (
        btnRef.current &&
        !btnRef.current.contains(e.target as Node) &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const handleClick = useCallback(() => {
    if (!open && !fetched) {
      void fetch()
    }
    setOpen((o) => !o)
  }, [open, fetched, fetch])

  if (!allowed) return null

  const hasDelta = data && Math.abs(data.delta) > 0.05

  const crestContent = (
    <span
      className="bg-gradient-to-r from-cyan-400 via-sky-300 to-violet-400 bg-clip-text text-transparent font-black"
      style={{ fontSize: size === 'xs' ? '9px' : '10px', letterSpacing: '0.02em' }}
    >
      AF
    </span>
  )

  const deltaDisplay =
    hasDelta && data ? (
      <span
        className={`text-[9px] font-semibold ${data.delta > 0 ? 'text-green-400' : 'text-red-400'}`}
      >
        {data.delta > 0 ? '↑' : '↓'}
        {data.deltaStr}
      </span>
    ) : null

  const popoverData =
    data ??
    emptyAFProjectionDisplay({
      isLoading: loading,
      hasData: false,
    })

  return (
    <div className={`relative inline-flex items-center ${props.className ?? ''}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={handleClick}
        aria-label={`AF weather-adjusted projection for ${props.playerName}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={[
          'inline-flex items-center gap-0.5 rounded-md border transition-all duration-150 touch-manipulation',
          'border-cyan-500/20 bg-cyan-500/[0.06] hover:bg-cyan-500/[0.12]',
          size === 'xs' ? 'px-1.5 py-0.5 min-h-[22px]' : 'px-2 py-1 min-h-[26px]',
          open ? 'ring-1 ring-cyan-500/30 border-cyan-500/40' : '',
          loading ? 'opacity-60' : '',
        ].join(' ')}
        data-testid="af-crest-button"
      >
        {loading ? (
          <div className="h-2.5 w-2.5 animate-spin rounded-full border border-cyan-400/40 border-t-cyan-400" />
        ) : (
          crestContent
        )}
        {deltaDisplay}
      </button>

      {open && !isMobile && (
        <div
          ref={panelRef}
          className={[
            'absolute z-50 w-52 rounded-xl',
            'bg-slate-800/95 border border-white/10 shadow-xl backdrop-blur-sm',
            'p-3',
            side === 'bottom' ? 'top-full left-1/2 -translate-x-1/2 mt-2' : 'bottom-full left-1/2 -translate-x-1/2 mb-2',
          ].join(' ')}
          role="dialog"
          aria-label="AF projection details"
        >
          <AFProjectionPopover data={popoverData} onClose={() => setOpen(false)} />
          <div
            className={[
              'pointer-events-none absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-800/95 border-white/10',
              side === 'bottom' ? '-top-[5px] border-t border-l' : '-bottom-[5px] border-b border-r',
            ].join(' ')}
          />
        </div>
      )}

      {open && isMobile && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={panelRef}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl bg-slate-800/98 border-t border-white/10 shadow-2xl p-4 pb-[max(2rem,calc(1rem+env(safe-area-inset-bottom)))]"
            role="dialog"
            aria-label="AF projection details"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <AFProjectionPopover data={popoverData} onClose={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  )
}

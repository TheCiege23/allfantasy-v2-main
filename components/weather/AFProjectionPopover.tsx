'use client'

import type { AFProjectionDisplay } from '@/lib/weather/afProjectionAdapter'

type Props = {
  data: AFProjectionDisplay
  onClose: () => void
}

export function AFProjectionPopover({ data, onClose }: Props) {
  const deltaColor =
    data.delta > 0.05 ? 'text-green-400' : data.delta < -0.05 ? 'text-red-400' : 'text-white/60'

  const deltaGlyph =
    data.delta > 0.05 ? '↑' : data.delta < -0.05 ? '↓' : '—'

  if (data.isLoading) {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400/40 border-t-cyan-400" />
        <span className="text-[11px] text-white/50">Loading AF projection…</span>
      </div>
    )
  }

  return (
    <div className="w-52 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-widest text-cyan-400/80">AF Projection</span>
        <button
          type="button"
          onClick={onClose}
          className="text-white/30 hover:text-white/60 transition-colors"
          aria-label="Close AF projection"
        >
          ×
        </button>
      </div>

      {data.error ? (
        <p className="text-[11px] text-amber-200/90">{data.error}</p>
      ) : null}

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5">
          <div className="text-[11px] uppercase tracking-widest text-white/35 mb-0.5">Standard</div>
          <div className="text-sm font-bold text-white">{data.standard.toFixed(1)}</div>
        </div>
        <div
          className={`rounded-lg border px-2 py-1.5 ${
            data.delta > 0.05
              ? 'border-green-500/20 bg-green-500/10'
              : data.delta < -0.05
                ? 'border-red-500/20 bg-red-500/10'
                : 'border-white/8 bg-white/[0.03]'
          }`}
        >
          <div className="text-[11px] uppercase tracking-widest text-white/35 mb-0.5">AF</div>
          <div className={`text-sm font-bold ${deltaColor}`}>{data.af.toFixed(1)}</div>
        </div>
        <div className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5">
          <div className="text-[11px] uppercase tracking-widest text-white/35 mb-0.5">Delta</div>
          <div className={`text-sm font-bold ${deltaColor}`}>
            {data.delta > 0.05 || data.delta < -0.05 ? (
              <>
                <span aria-hidden="true">{deltaGlyph}</span>{' '}
                {data.deltaStr}
              </>
            ) : (
              '—'
            )}
          </div>
        </div>
      </div>

      {data.weatherLabel && (
        <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-white/55">
          {data.weatherLabel}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-white/70">{data.reason}</p>

      {data.factors.length > 0 && (
        <div className="space-y-1">
          {data.factors.slice(0, 3).map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-[11px] text-white/50">
              <span className="truncate flex-1">{f.label}</span>
              <span
                className={
                  f.direction === 'pos'
                    ? 'text-green-400 font-semibold'
                    : f.direction === 'neg'
                      ? 'text-red-400 font-semibold'
                      : 'text-white/35'
                }
              >
                {f.direction === 'pos' ? '↑ ' : f.direction === 'neg' ? '↓ ' : ''}
                {f.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.hasData && (
        <div className="flex items-center justify-between pt-1 border-t border-white/6">
          <span className="text-[11px] text-white/25 uppercase tracking-widest">Confidence</span>
          <span className="text-[11px] text-white/40 capitalize">{data.confidence}</span>
        </div>
      )}

      {!data.hasData && !data.isLoading && (
        <div className="text-[11px] text-white/35 text-center py-1">
          {data.isOutdoor === false ? 'Indoor venue · no weather adjustment' : 'Weather data unavailable'}
        </div>
      )}
    </div>
  )
}

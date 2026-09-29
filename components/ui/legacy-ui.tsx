'use client'

import React from 'react'

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

export function Card({
  children,
  className,
  glow,
  accent = 'cyan',
  padding = 'default',
  hover = true,
}: {
  children: React.ReactNode
  className?: string
  glow?: boolean
  accent?: 'cyan' | 'purple' | 'amber' | 'emerald' | 'rose' | 'slate'
  padding?: 'none' | 'sm' | 'default' | 'lg'
  hover?: boolean
}) {
  const gradients = {
    cyan: 'from-cyan-400 via-purple-500 to-cyan-400',
    purple: 'from-purple-400 via-cyan-500 to-purple-400',
    amber: 'from-amber-400 via-orange-500 to-amber-400',
    emerald: 'from-emerald-400 via-cyan-500 to-emerald-400',
    rose: 'from-rose-400 via-pink-500 to-rose-400',
    slate: 'from-slate-400 via-slate-500 to-slate-400',
  }
  const borders = {
    cyan: 'border-cyan-500/20',
    purple: 'border-purple-500/20',
    amber: 'border-amber-500/20',
    emerald: 'border-emerald-500/20',
    rose: 'border-rose-500/20',
    slate: 'border-white/10',
  }
  const paddings = {
    none: '',
    sm: 'p-3 sm:p-4',
    default: 'p-4 sm:p-6',
    lg: 'p-5 sm:p-8',
  }
  
  return (
    <div
      className={cx(
        'relative rounded-2xl sm:rounded-3xl bg-gradient-to-br from-slate-900/80 to-slate-950/80 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.4)] border overflow-hidden transition-all duration-300',
        borders[accent],
        paddings[padding],
        hover && 'hover:shadow-[0_25px_70px_rgba(0,0,0,0.5)] hover:border-opacity-40',
        className
      )}
    >
      {glow && (
        <div
          className={cx(
            'pointer-events-none absolute -inset-0.5 -z-10 rounded-3xl bg-gradient-to-r opacity-30 blur-xl animate-pulse',
            gradients[accent]
          )}
        />
      )}
      {children}
    </div>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  loading,
  variant = 'primary',
  size = 'default',
  className,
  type = 'button',
  fullWidth,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'default' | 'lg'
  className?: string
  type?: 'button' | 'submit'
  fullWidth?: boolean
}) {
  const variants = {
    primary: 'bg-gradient-to-r from-cyan-500 to-purple-600 text-white shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
    secondary: 'bg-white/10 text-white border border-white/20 hover:bg-white/15 hover:border-white/30 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
    ghost: 'bg-transparent text-white/70 hover:bg-white/5 hover:text-white active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
    danger: 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25 hover:shadow-rose-500/40 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
  }
  const sizes = {
    sm: 'px-3 py-1.5 text-xs sm:text-sm rounded-lg sm:rounded-xl min-h-[32px] sm:min-h-[36px]',
    default: 'px-4 py-2.5 sm:px-5 sm:py-3 text-sm sm:text-base rounded-xl sm:rounded-2xl min-h-[44px] sm:min-h-[48px]',
    lg: 'px-6 py-3.5 sm:px-8 sm:py-4 text-base sm:text-lg rounded-2xl min-h-[52px] sm:min-h-[56px]',
  }
  
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cx(
        'font-semibold transition-all duration-200 flex items-center justify-center gap-2 touch-manipulation',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className
      )}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {children}
    </button>
  )
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  className,
  disabled,
  error,
  icon,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  className?: string
  disabled?: boolean
  error?: string
  icon?: React.ReactNode
}) {
  return (
    <div className="relative">
      {icon && (
        <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-white/40">
          {icon}
        </div>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cx(
          'w-full px-4 py-3 sm:py-3.5 bg-black/30 border rounded-xl sm:rounded-2xl text-white text-base placeholder:text-white/30 focus:outline-none transition-all duration-200 min-h-[48px] sm:min-h-[52px] touch-manipulation',
          icon ? 'pl-10 sm:pl-12' : '',
          error
            ? 'border-rose-400/60 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 focus-visible:ring-rose-400/40'
            : 'border-white/10 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 focus-visible:outline-none',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      />
      {error && <p className="mt-1.5 text-xs text-rose-400">{error}</p>}
    </div>
  )
}

export function Select({
  value,
  onChange,
  options,
  className,
  disabled,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  className?: string
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cx(
        'w-full px-4 py-3 sm:py-3.5 bg-black/30 border border-white/10 rounded-xl sm:rounded-2xl text-white text-base focus:outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20 transition-all duration-200 min-h-[48px] sm:min-h-[52px] touch-manipulation appearance-none cursor-pointer',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        backgroundSize: '16px',
      }}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900">
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Pill({
  children,
  tone = 'default',
  size = 'default',
}: {
  children: React.ReactNode
  tone?: 'cyan' | 'purple' | 'emerald' | 'amber' | 'rose' | 'default'
  size?: 'sm' | 'default'
}) {
  const tones = {
    cyan: 'bg-cyan-500/15 border-cyan-400/30 text-cyan-200',
    purple: 'bg-purple-500/15 border-purple-400/30 text-purple-200',
    emerald: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200',
    amber: 'bg-amber-500/15 border-amber-400/30 text-amber-200',
    rose: 'bg-rose-500/15 border-rose-400/30 text-rose-200',
    default: 'bg-white/5 border-white/10 text-white/60',
  }
  const sizes = {
    sm: 'px-2 py-0.5 text-[11px]',
    default: 'px-2.5 py-1 text-[11px] sm:text-xs',
  }
  
  return (
    <span className={cx('rounded-full border font-medium', tones[tone], sizes[size])}>
      {children}
    </span>
  )
}

export function TabNav({
  tabs,
  activeTab,
  onChange,
  className,
}: {
  tabs: Array<{ id: string; label: string; icon?: string }>
  activeTab: string
  onChange: (id: string) => void
  className?: string
}) {
  return (
    <div className={cx('w-full overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0', className)}>
      <div className="flex gap-1 sm:gap-2 p-1 bg-black/20 rounded-xl sm:rounded-2xl min-w-max sm:min-w-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cx(
              'flex items-center gap-1.5 sm:gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 whitespace-nowrap touch-manipulation min-h-[40px] sm:min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50',
              activeTab === tab.id
                ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-cyan-400/30'
                : 'text-white/50 hover:text-white/80 hover:bg-white/5'
            )}
          >
            {tab.icon && <span className="text-sm sm:text-base">{tab.icon}</span>}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function StatCard({
  label,
  value,
  icon,
  accent = 'cyan',
  trend,
  subValue,
}: {
  label: string
  value: string | number
  icon?: string
  accent?: 'cyan' | 'purple' | 'emerald' | 'amber' | 'rose'
  trend?: 'up' | 'down' | 'neutral'
  subValue?: string
}) {
  const accentClasses = {
    cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-400/25 hover:border-cyan-400/40',
    purple: 'from-purple-500/20 to-purple-500/5 border-purple-400/25 hover:border-purple-400/40',
    emerald: 'from-emerald-500/20 to-emerald-500/5 border-emerald-400/25 hover:border-emerald-400/40',
    amber: 'from-amber-500/20 to-amber-500/5 border-amber-400/25 hover:border-amber-400/40',
    rose: 'from-rose-500/20 to-rose-500/5 border-rose-400/25 hover:border-rose-400/40',
  }
  const valueColors = {
    cyan: 'text-cyan-200',
    purple: 'text-purple-200',
    emerald: 'text-emerald-200',
    amber: 'text-amber-200',
    rose: 'text-rose-200',
  }
  const trendIcons = {
    up: '↑',
    down: '↓',
    neutral: '→',
  }
  const trendColors = {
    up: 'text-emerald-400',
    down: 'text-rose-400',
    neutral: 'text-white/40',
  }

  return (
    <div
      className={cx(
        'rounded-xl sm:rounded-2xl bg-gradient-to-br border p-3 sm:p-4 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg',
        accentClasses[accent]
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          {icon && <span className="text-base sm:text-lg flex-shrink-0">{icon}</span>}
          <span className="text-[11px] sm:text-[11px] uppercase tracking-wide text-white/50 truncate">
            {label}
          </span>
        </div>
        {trend && (
          <span className={cx('text-xs sm:text-sm font-bold flex-shrink-0', trendColors[trend])}>
            {trendIcons[trend]}
          </span>
        )}
      </div>
      <div className={cx('mt-1.5 sm:mt-2 text-xl sm:text-2xl font-extrabold leading-none', valueColors[accent])}>
        {value}
      </div>
      {subValue && <div className="mt-1 text-[11px] sm:text-xs text-white/40">{subValue}</div>}
    </div>
  )
}

export function GradeBadge({ grade, size = 'default' }: { grade: string | null; size?: 'sm' | 'default' | 'lg' }) {
  if (!grade) return null
  
  const getColors = (g: string) => {
    if (g.startsWith('A')) return 'from-emerald-400 to-emerald-600 text-white shadow-emerald-500/30'
    if (g.startsWith('B')) return 'from-cyan-400 to-cyan-600 text-white shadow-cyan-500/30'
    if (g.startsWith('C')) return 'from-yellow-400 to-yellow-600 text-black shadow-yellow-500/30'
    if (g.startsWith('D')) return 'from-orange-400 to-orange-600 text-white shadow-orange-500/30'
    return 'from-rose-400 to-rose-600 text-white shadow-rose-500/30'
  }
  
  const sizes = {
    sm: 'w-8 h-8 sm:w-10 sm:h-10 text-sm sm:text-base',
    default: 'w-12 h-12 sm:w-14 sm:h-14 text-lg sm:text-xl',
    lg: 'w-16 h-16 sm:w-20 sm:h-20 text-2xl sm:text-3xl',
  }
  
  return (
    <div
      className={cx(
        'flex items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-br font-black shadow-lg',
        getColors(grade),
        sizes[size]
      )}
    >
      {grade}
    </div>
  )
}

export function Skeleton({
  className,
  variant = 'default',
}: {
  className?: string
  variant?: 'default' | 'text' | 'circle' | 'card'
}) {
  const variants = {
    default: 'h-4 w-full rounded',
    text: 'h-4 w-3/4 rounded',
    circle: 'w-12 h-12 rounded-full',
    card: 'h-32 w-full rounded-2xl',
  }
  
  return (
    <div
      className={cx(
        'animate-pulse bg-gradient-to-r from-white/5 via-white/10 to-white/5 bg-[length:200%_100%]',
        variants[variant],
        className
      )}
    />
  )
}

export function LoadingSpinner({ size = 'default' }: { size?: 'sm' | 'default' | 'lg' }) {
  const sizes = {
    sm: 'w-4 h-4',
    default: 'w-6 h-6',
    lg: 'w-10 h-10',
  }
  
  return (
    <svg className={cx('animate-spin', sizes[size])} viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 sm:py-12 px-4 text-center">
      {icon && <span className="text-4xl sm:text-5xl mb-3 sm:mb-4 opacity-50">{icon}</span>}
      <h3 className="text-base sm:text-lg font-semibold text-white/80">{title}</h3>
      {description && <p className="mt-1.5 sm:mt-2 text-sm text-white/50 max-w-sm">{description}</p>}
      {action && <div className="mt-4 sm:mt-6">{action}</div>}
    </div>
  )
}

export function ProgressBar({
  value,
  max = 100,
  accent = 'cyan',
  showLabel,
  size = 'default',
}: {
  value: number
  max?: number
  accent?: 'cyan' | 'purple' | 'emerald' | 'amber'
  showLabel?: boolean
  size?: 'sm' | 'default'
}) {
  const percent = Math.min(100, Math.max(0, (value / max) * 100))
  
  const gradients = {
    cyan: 'from-cyan-400 to-cyan-600',
    purple: 'from-purple-400 to-purple-600',
    emerald: 'from-emerald-400 to-emerald-600',
    amber: 'from-amber-400 to-amber-600',
  }
  
  const heights = {
    sm: 'h-1.5',
    default: 'h-2 sm:h-2.5',
  }
  
  return (
    <div className="w-full">
      <div className={cx('w-full bg-white/10 rounded-full overflow-hidden', heights[size])}>
        <div
          className={cx('h-full bg-gradient-to-r rounded-full transition-all duration-500 ease-out', gradients[accent])}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-[11px] sm:text-xs text-white/50 text-right">{Math.round(percent)}%</div>
      )}
    </div>
  )
}

export function Chip({
  label,
  onRemove,
  accent = 'cyan',
}: {
  label: string
  onRemove?: () => void
  accent?: 'cyan' | 'purple' | 'emerald'
}) {
  const accents = {
    cyan: 'border-cyan-400/30 bg-cyan-500/10',
    purple: 'border-purple-400/30 bg-purple-500/10',
    emerald: 'border-emerald-400/30 bg-emerald-500/10',
  }
  
  return (
    <div
      className={cx(
        'inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border text-xs sm:text-sm text-white/80',
        accents[accent]
      )}
    >
      <span className="truncate max-w-[140px] sm:max-w-[200px]">{label}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-white/40 hover:text-white/80 transition text-base sm:text-lg leading-none p-0.5 touch-manipulation"
          title="Remove"
        >
          ×
        </button>
      )}
    </div>
  )
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px bg-gradient-to-r from-transparent via-white/10 to-transparent', className)} />
}

export function SectionHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string
  subtitle?: string
  icon?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 mb-4 sm:mb-6">
      <div className="flex items-center gap-2 sm:gap-3">
        {icon && <span className="text-xl sm:text-2xl">{icon}</span>}
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white">{title}</h2>
          {subtitle && <p className="text-xs sm:text-sm text-white/50">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

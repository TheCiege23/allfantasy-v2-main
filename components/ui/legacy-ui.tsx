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

export function Divider({ className }: { className?: string }) {
  return <div className={cx('h-px bg-gradient-to-r from-transparent via-white/10 to-transparent', className)} />
}


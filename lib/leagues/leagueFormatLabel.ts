export function buildLeagueFormatLabel(league: {
  format?: string | null
  scoring?: string | null
  isDynasty?: boolean
  leagueVariant?: string | null
  teamCount?: number | null
  season?: number | string | null
}): string {
  const parts: string[] = []

  const year = league.season
  if (year !== undefined && year !== null && String(year).trim() !== '') {
    parts.push(String(year))
  }

  const count = league.teamCount
  if (count && count > 0) {
    const variant = (league.leagueVariant ?? '').toLowerCase()
    const format = (league.format ?? '').toLowerCase()
    const isDynasty = league.isDynasty

    let typeLabel = 'Redraft'
    if (isDynasty || variant.includes('dynasty') || format.includes('dynasty')) {
      typeLabel = 'Dynasty'
    } else if (variant.includes('keeper') || format.includes('keeper')) {
      typeLabel = 'Keeper'
    } else if (
      variant.includes('guillotine') ||
      format.includes('guillotine') ||
      variant.includes('guillo')
    ) {
      typeLabel = 'Guilly'
    } else if (
      variant.includes('best_ball') ||
      variant.includes('bestball') ||
      format.includes('best ball') ||
      format.includes('bestball')
    ) {
      typeLabel = 'Best Ball'
    } else if (variant.includes('survivor')) {
      typeLabel = 'Survivor'
    } else if (variant.includes('big_brother')) {
      typeLabel = 'Big Brother'
    } else if (variant.includes('zombie')) {
      typeLabel = 'Zombie'
    } else if (variant.includes('tournament')) {
      typeLabel = 'Tournament'
    }

    parts.push(`${count}-Team ${typeLabel}`)
  }

  const scoring = (league.scoring ?? '').toLowerCase().trim()
  if (scoring && scoring !== 'standard' && scoring !== '') {
    if (scoring.includes('half') || scoring.includes('0.5')) {
      parts.push('Half-PPR')
    } else if (scoring === 'ppr' || scoring.includes('ppr')) {
      parts.push('PPR')
    } else if (scoring.includes('standard')) {
      // omit — already implied
    } else {
      parts.push(scoring.charAt(0).toUpperCase() + scoring.slice(1))
    }
  }

  return parts.join(' • ')
}

export function buildStatusConfig(status: string | undefined): {
  label: string
  dotColor: string
  textColor: string
  bgColor: string
  borderColor: string
} {
  const s = (status ?? '').toLowerCase().replace(/-/g, '_')

  if (s === 'pre_draft') {
    return {
      label: 'PRE-DRAFT',
      dotColor: 'bg-blue-400',
      textColor: 'text-blue-400',
      bgColor: 'bg-blue-500/15',
      borderColor: 'border-blue-500/25',
    }
  }
  if (s === 'drafting') {
    return {
      label: 'DRAFTING',
      dotColor: 'bg-yellow-400',
      textColor: 'text-yellow-400',
      bgColor: 'bg-yellow-500/15',
      borderColor: 'border-yellow-500/25',
    }
  }
  if (s === 'in_season' || s === 'active') {
    return {
      label: 'ACTIVE',
      dotColor: 'bg-green-400',
      textColor: 'text-green-400',
      bgColor: 'bg-green-500/15',
      borderColor: 'border-green-500/25',
    }
  }
  if (s === 'complete' || s === 'completed') {
    return {
      label: 'COMPLETED',
      dotColor: 'bg-white/30',
      textColor: 'text-white/35',
      bgColor: 'bg-white/[0.05]',
      borderColor: 'border-white/[0.08]',
    }
  }
  if (s === 'off_season') {
    return {
      label: 'OFF-SEASON',
      dotColor: 'bg-white/30',
      textColor: 'text-white/35',
      bgColor: 'bg-white/[0.05]',
      borderColor: 'border-white/[0.08]',
    }
  }
  return {
    label: s.replace(/_/g, ' ').toUpperCase() || '—',
    dotColor: 'bg-white/25',
    textColor: 'text-white/40',
    bgColor: 'bg-white/[0.03]',
    borderColor: 'border-white/8',
  }
}

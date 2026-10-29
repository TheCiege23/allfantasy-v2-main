'use client'

import { useId, useMemo } from 'react'
import { buffSvg, MERGE_BUFF_COLORS } from '@/lib/survivor/buffSvg'

export interface TribeBuffProps {
  primary?: string | null
  secondary?: string | null
  /** Gold merge buff (buff-merge colours). */
  merge?: boolean
  className?: string
  style?: React.CSSProperties
  /** Decorative by default; pass a label when the buff carries meaning on its own. */
  label?: string
}

/**
 * Inline tribe buff rendered from the tribe's colours (lib/survivor/buffSvg). buffSvg accepts
 * only #rrggbb colours and an alphanumeric uid, so the markup is built from safe values only.
 */
export function TribeBuff({ primary, secondary, merge, className, style, label }: TribeBuffProps) {
  const reactId = useId()
  const uid = `bf${reactId.replace(/[^A-Za-z0-9]/g, '')}`
  const svg = useMemo(
    () =>
      buffSvg(
        merge ? MERGE_BUFF_COLORS.primary : primary ?? '',
        merge ? MERGE_BUFF_COLORS.secondary : secondary ?? '',
        uid,
      ).replace('width="260" height="200"', 'width="100%" height="100%"'),
    [merge, primary, secondary, uid],
  )
  return (
    <span
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ display: 'inline-block', lineHeight: 0, aspectRatio: '260 / 200', ...style }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

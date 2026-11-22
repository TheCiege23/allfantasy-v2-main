import type { UseAFProjectionParams } from '@/components/weather/useAFProjection'

type AFCrestSize = 'xs' | 'sm' | 'md'

export type AFCrestButtonProps = UseAFProjectionParams & {
  size?: AFCrestSize
  className?: string
  /** Desktop popover placement; mobile always uses bottom sheet. */
  popoverSide?: 'top' | 'bottom'
}

'use client'

import { useEffect, useState } from 'react'
import './survivorMoodScene.css'

type Layer = { src: string; key: number }

/**
 * The island scene behind a Survivor header. When the mood changes the new scene cross-fades in
 * over 0.5s (opacity only). With reduced motion the new scene simply replaces the old one.
 */
export function SurvivorMoodScene({ src, className }: { src: string; className?: string }) {
  const [layers, setLayers] = useState<Layer[]>([{ src, key: 0 }])

  useEffect(() => {
    setLayers(current => {
      const top = current[current.length - 1]
      return top.src === src ? current : [top, { src, key: top.key + 1 }]
    })
  }, [src])

  return <>
    {layers.map((layer, index) => {
      const entering = layers.length > 1 && index === layers.length - 1
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={layer.key}
          className={className ? `sv-scene ${className}` : 'sv-scene'}
          src={layer.src}
          alt=""
          aria-hidden
          data-scene-entering={entering || undefined}
          onAnimationEnd={entering ? () => setLayers(current => current.slice(-1)) : undefined}
        />
      )
    })}
  </>
}

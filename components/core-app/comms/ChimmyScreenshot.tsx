'use client'
import { useRef } from 'react'
export function ChimmyScreenshot({ src, name }: { src: string; name?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  return <>
    <button type="button" className="af-cm-image-open" aria-label="Enlarge attached screenshot" onClick={() => dialog.current?.showModal()}>
      <img src={src} alt={'Screenshot: ' + (name ?? 'attachment')} /><span>Enlarge screenshot</span>
    </button>
    <dialog className="af-cm-image-dialog" ref={dialog} aria-label="Screenshot preview">
      <button type="button" onClick={() => dialog.current?.close()} autoFocus>Close screenshot</button>
      <img src={src} alt={'Full screenshot: ' + (name ?? 'attachment')} />
    </dialog>
  </>
}

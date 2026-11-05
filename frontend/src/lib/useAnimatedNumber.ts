import { useEffect, useRef, useState } from 'react'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Devuelve un número que "corre" desde el valor anterior hasta `target`.
 * Con movimiento reducido (o en pruebas sin requestAnimationFrame) salta directo al valor final.
 * Quien lo muestre debe dar el valor final a los lectores de pantalla, no cada cuadro.
 */
export function useAnimatedNumber(target: number, duration = 300): number {
  const [shown, setShown] = useState(target)
  const current = useRef(target)

  useEffect(() => {
    if (reducedMotion() || typeof requestAnimationFrame === 'undefined' || current.current === target) {
      current.current = target
      setShown(target)
      return
    }
    const from = current.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      current.current = from + (target - from) * (1 - (1 - p) ** 3)
      setShown(current.current)
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    // Si el objetivo cambia a mitad de camino, la siguiente animación parte del valor que se ve.
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  return shown
}

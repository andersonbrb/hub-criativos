import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// Versão celular/computador escolhida no botão do topo. Sem escolha, segue a largura da tela.
const OVERRIDE_KEY = "hub:layout-mode"
const CHANGE_EVENT = "hub:layout-mode"
type Override = "mobile" | "desktop" | null

function readOverride(): Override {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY)
    return v === "mobile" || v === "desktop" ? v : null
  } catch {
    return null
  }
}

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    mql.removeEventListener("change", onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

const narrow = () => window.matchMedia(QUERY).matches

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => {
      const o = readOverride()
      return o ? o === "mobile" : narrow()
    },
    () => false
  )
}

// Para o botão do topo: estado atual, se a tela é estreita de verdade e a troca.
export function useLayoutMode() {
  const isMobile = useIsMobile()
  const isNarrow = React.useSyncExternalStore(subscribe, narrow, () => false)
  const toggle = React.useCallback(() => {
    const next = !isMobile
    try {
      // Guarda só quando contraria a largura da tela; senão volta ao automático.
      if (next === narrow()) localStorage.removeItem(OVERRIDE_KEY)
      else localStorage.setItem(OVERRIDE_KEY, next ? "mobile" : "desktop")
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [isMobile])
  return { isMobile, isNarrow, toggle }
}

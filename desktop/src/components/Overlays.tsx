// Things that sit above the page: toasts and dialogs.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/lib/util'

type ToastTone = 'ok' | 'bad' | 'info'
interface Toast {
  id: number
  tone: ToastTone
  text: string
}

const ToastCtx = createContext<(text: string, tone?: ToastTone) => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200)
  }, [])

  const icon = { ok: CheckCircle2, bad: AlertTriangle, info: Info }
  const colour = { ok: 'var(--ok)', bad: 'var(--bad)', info: 'var(--accent)' }

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map((t) => {
            const Icon = icon[t.tone]
            return (
              <div
                key={t.id}
                className="pointer-events-auto flex max-w-[520px] items-start gap-2.5 border bg-[var(--ink-deep)]/95 px-4 py-3 shadow-[var(--shadow-panel)]"
                style={{ animation: 'toast-in 260ms var(--ease-out-soft)' }}
              >
                <Icon size={16} style={{ color: colour[t.tone] }} className="mt-0.5 shrink-0" />
                <p className="selectable text-[13px] leading-snug">{t.text}</p>
                <button
                  onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                  className="ml-1 shrink-0 text-[var(--fg-faint)] transition hover:text-[var(--fg)]"
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>,
        document.body,
      )}
      <style>{`@keyframes toast-in { from { opacity: 0; transform: translateY(10px) scale(0.97) } to { opacity: 1; transform: none } }`}</style>
    </ToastCtx.Provider>
  )
}

export function Modal({
  open,
  onClose,
  title,
  lede,
  children,
  footer,
  wide,
  lg,
  xl,
  plain,
}: {
  open: boolean
  onClose: () => void
  title: string
  lede?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  /** For a dialog that reads something beside what it decides — a loop's
   *  recipe, a task's record of work. */
  lg?: boolean
  xl?: boolean
  /** No header: the body carries its own heading, and the title is only what
   *  a screen reader announces. */
  plain?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
        style={{ animation: 'fade-in 180ms ease-out' }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative flex max-h-[86vh] w-full flex-col overflow-hidden  border',
          'bg-[var(--ink-deep)]/97 shadow-[var(--shadow-panel)] backdrop-blur-2xl',
          xl ? 'max-w-[1040px]' : lg ? 'max-w-[880px]' : wide ? 'max-w-[680px]' : 'max-w-[500px]',
        )}
        style={{ animation: 'modal-in 240ms var(--ease-out-soft)' }}
      >
        {plain ? (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 z-10 grid size-8 place-items-center text-[var(--fg-faint)] transition hover:bg-[var(--skin-2)] hover:text-[var(--fg)]"
          >
            <X size={16} />
          </button>
        ) : (
          <header className="flex items-start justify-between gap-4 border-b px-6 py-5">
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
              {lede && <p className="mt-1 max-w-[52ch] text-[13px] text-[var(--fg-dim)]">{lede}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center text-[var(--fg-faint)] transition hover:bg-[var(--skin-2)] hover:text-[var(--fg)]"
            >
              <X size={16} />
            </button>
          </header>
        )}
        <div className={cn('min-h-0 flex-1 overflow-y-auto', plain ? 'px-8 py-8' : 'px-6 py-5')}>{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t px-6 py-4">{footer}</footer>}
      </div>
      <style>{`
        @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes modal-in { from { opacity: 0; transform: translateY(12px) scale(0.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>,
    document.body,
  )
}

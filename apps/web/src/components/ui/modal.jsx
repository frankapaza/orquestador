'use client'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl', '2xl': 'max-w-3xl' }

// Modal estándar: portal a document.body (overlay cubre toda la pantalla, incl. navbar),
// cierra con Escape o clic en el fondo, cabecera con icono + título.
export function Modal({ open, onClose, title, description, icon: Icon, iconClass, size = 'lg', children, footer }) {
  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 animate-in fade-in-0" onClick={onClose}>
      <div className={cn('flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-xl animate-in zoom-in-95', SIZES[size] ?? SIZES.lg)}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600', iconClass)}>
                <Icon size={18} strokeWidth={1.75} />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-foreground">{title}</h2>
              {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar" className="h-8 w-8 shrink-0 text-muted-foreground"><X size={18} /></Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

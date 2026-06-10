'use client'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check, Loader2 } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

// Select con menú propio (portal) y opciones diseñadas. Reemplaza al <select>
// nativo cuyo desplegable no se puede estilizar.
// options: [{ value, label, icon? }]
export function SelectMenu({ value, onChange, options, placeholder = 'Seleccionar', disabled, loading, leadingIcon, className }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const panelRef = useRef(null)
  const selected = options.find(o => o.value === value)

  function toggle() {
    if (disabled) return
    if (open) { setOpen(false); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDoc = e => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button type="button" ref={btnRef} onClick={toggle} disabled={disabled}
        className={cn(
          'flex h-11 w-full items-center gap-2 rounded-xl border bg-muted/40 px-2.5 text-left text-sm transition-colors hover:bg-muted focus:border-ring focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}>
        {leadingIcon}
        <span className={cn('flex-1 truncate font-medium', selected ? 'text-foreground' : 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        {loading
          ? <Loader2 size={15} className="shrink-0 animate-spin text-jungle-green-600" />
          : <ChevronDown size={15} className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />}
      </button>

      {open && pos && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, minWidth: 200 }}
          className="z-[100] overflow-hidden rounded-xl border bg-card p-1.5 shadow-xl animate-in fade-in-0 zoom-in-95">
          <div className="scrollbar-thin max-h-64 overflow-y-auto">
            {options.map(o => {
              const active = o.value === value
              return (
                <button key={o.value || '__none__'} type="button"
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-jungle-green-50',
                    active && 'bg-jungle-green-50 font-medium',
                  )}>
                  {o.icon}
                  <span className="flex-1 truncate text-foreground">{o.label}</span>
                  {active && <Check size={15} className="shrink-0 text-jungle-green-600" />}
                </button>
              )
            })}
            {options.length === 0 && <p className="px-2.5 py-4 text-center text-sm text-muted-foreground">Sin opciones</p>}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

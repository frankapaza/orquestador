'use client'
import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search, ChevronDown } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

// Países con código de marcación (bandera vía ISO con imagen real)
export const COUNTRIES = [
  { code: 'PE', dial: '+51', name: 'Perú' },
  { code: 'MX', dial: '+52', name: 'México' },
  { code: 'CO', dial: '+57', name: 'Colombia' },
  { code: 'AR', dial: '+54', name: 'Argentina' },
  { code: 'CL', dial: '+56', name: 'Chile' },
  { code: 'EC', dial: '+593', name: 'Ecuador' },
  { code: 'BO', dial: '+591', name: 'Bolivia' },
  { code: 'VE', dial: '+58', name: 'Venezuela' },
  { code: 'PY', dial: '+595', name: 'Paraguay' },
  { code: 'UY', dial: '+598', name: 'Uruguay' },
  { code: 'US', dial: '+1', name: 'Estados Unidos' },
  { code: 'CA', dial: '+1', name: 'Canadá' },
  { code: 'ES', dial: '+34', name: 'España' },
  { code: 'BR', dial: '+55', name: 'Brasil' },
  { code: 'GT', dial: '+502', name: 'Guatemala' },
  { code: 'CR', dial: '+506', name: 'Costa Rica' },
  { code: 'PA', dial: '+507', name: 'Panamá' },
  { code: 'DO', dial: '+1', name: 'República Dominicana' },
  { code: 'HN', dial: '+504', name: 'Honduras' },
  { code: 'SV', dial: '+503', name: 'El Salvador' },
  { code: 'NI', dial: '+505', name: 'Nicaragua' },
  { code: 'CU', dial: '+53', name: 'Cuba' },
  { code: 'PR', dial: '+1', name: 'Puerto Rico' },
  { code: 'GB', dial: '+44', name: 'Reino Unido' },
  { code: 'FR', dial: '+33', name: 'Francia' },
  { code: 'DE', dial: '+49', name: 'Alemania' },
  { code: 'IT', dial: '+39', name: 'Italia' },
  { code: 'PT', dial: '+351', name: 'Portugal' },
  { code: 'NL', dial: '+31', name: 'Países Bajos' },
  { code: 'BE', dial: '+32', name: 'Bélgica' },
  { code: 'CH', dial: '+41', name: 'Suiza' },
  { code: 'SE', dial: '+46', name: 'Suecia' },
  { code: 'NO', dial: '+47', name: 'Noruega' },
  { code: 'DK', dial: '+45', name: 'Dinamarca' },
  { code: 'FI', dial: '+358', name: 'Finlandia' },
  { code: 'IE', dial: '+353', name: 'Irlanda' },
  { code: 'AT', dial: '+43', name: 'Austria' },
  { code: 'PL', dial: '+48', name: 'Polonia' },
  { code: 'RU', dial: '+7', name: 'Rusia' },
  { code: 'TR', dial: '+90', name: 'Turquía' },
  { code: 'CN', dial: '+86', name: 'China' },
  { code: 'JP', dial: '+81', name: 'Japón' },
  { code: 'KR', dial: '+82', name: 'Corea del Sur' },
  { code: 'IN', dial: '+91', name: 'India' },
  { code: 'ID', dial: '+62', name: 'Indonesia' },
  { code: 'PH', dial: '+63', name: 'Filipinas' },
  { code: 'TH', dial: '+66', name: 'Tailandia' },
  { code: 'VN', dial: '+84', name: 'Vietnam' },
  { code: 'MY', dial: '+60', name: 'Malasia' },
  { code: 'SG', dial: '+65', name: 'Singapur' },
  { code: 'AU', dial: '+61', name: 'Australia' },
  { code: 'NZ', dial: '+64', name: 'Nueva Zelanda' },
  { code: 'ZA', dial: '+27', name: 'Sudáfrica' },
  { code: 'EG', dial: '+20', name: 'Egipto' },
  { code: 'MA', dial: '+212', name: 'Marruecos' },
  { code: 'NG', dial: '+234', name: 'Nigeria' },
  { code: 'SA', dial: '+966', name: 'Arabia Saudita' },
  { code: 'AE', dial: '+971', name: 'Emiratos Árabes Unidos' },
  { code: 'IL', dial: '+972', name: 'Israel' },
]
export const DEFAULT_COUNTRY = COUNTRIES[0]
export const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c]))
const DIAL_SORTED = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

// Resuelve el país: usa el código ISO si se da; si no, lo infiere del E.164.
export function resolveCountry({ phone_country, phone }) {
  if (phone_country && COUNTRY_BY_CODE[phone_country]) return COUNTRY_BY_CODE[phone_country]
  if (!phone) return null
  return DIAL_SORTED.find(c => phone.startsWith(c.dial)) ?? null
}
export function nationalNumber(phone, country) {
  if (!phone) return ''
  if (country && phone.startsWith(country.dial)) return phone.slice(country.dial.length)
  return phone
}

// Bandera por código ISO (imagen real; los emoji de bandera no renderizan en Windows)
export function Flag({ code, className }) {
  return (
    <img
      src={`https://flagcdn.com/${code.toLowerCase()}.svg`}
      alt={code}
      loading="lazy"
      className={cn('h-3.5 w-5 shrink-0 rounded-sm object-cover ring-1 ring-black/5', className)}
    />
  )
}

// Input de teléfono con selector de país buscable. El menú va en un portal con
// posición fija para no recortarse dentro de modales (overflow).
export function CountryPhoneInput({ country, setCountry, number, setNumber, placeholder = '995 241 264' }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState(null)
  const groupRef = useRef(null)
  const panelRef = useRef(null)

  function toggle() {
    if (open) { setOpen(false); return }
    const r = groupRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width })
    setQ(''); setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDoc = e => {
      if (panelRef.current?.contains(e.target) || groupRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const filtered = COUNTRIES.filter(c =>
    !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.dial.includes(q))

  return (
    <div ref={groupRef}
      className="flex h-[52px] items-center overflow-hidden rounded-xl bg-muted/60 transition-colors focus-within:bg-background focus-within:ring-1 focus-within:ring-ring">
      <button type="button" onClick={toggle}
        className="flex h-full items-center gap-2 px-3.5 text-sm transition-colors hover:bg-muted">
        <Flag code={country.code} />
        <span className="font-medium text-foreground">{country.dial}</span>
        <ChevronDown size={14} className={cn('text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      <span className="h-7 w-px bg-border" />
      <input type="tel" value={number} onChange={e => setNumber(e.target.value)}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-base outline-none placeholder:text-muted-foreground" />

      {open && pos && createPortal(
        <div ref={panelRef} style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, minWidth: 260 }}
          className="z-[100] overflow-hidden rounded-xl border bg-card shadow-xl animate-in fade-in-0 zoom-in-95">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar país o código..."
                className="h-10 w-full rounded-lg bg-muted/60 pl-9 pr-3 text-sm outline-none focus:bg-background focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="scrollbar-thin max-h-64 overflow-y-auto p-1.5">
            {filtered.map(c => (
              <button key={c.code} type="button"
                onClick={() => { setCountry(c); setOpen(false) }}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-jungle-green-50',
                  c.code === country.code && 'bg-jungle-green-50 font-medium')}>
                <Flag code={c.code} />
                <span className="flex-1 truncate text-foreground">{c.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{c.dial}</span>
              </button>
            ))}
            {!filtered.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sin resultados</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

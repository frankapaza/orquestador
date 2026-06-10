'use client'
import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import * as XLSX from 'xlsx'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { SectionCard } from '../../../components/ui/section-card'
import { EmptyState } from '../../../components/ui/empty-state'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Label } from '../../../components/ui/label'
import { cn } from '@/lib/utils'
import {
  Upload, Trash2, Search, Plus, Mail, Smartphone, Users, X,
  FileText, FolderOpen, CheckCircle, AlertCircle, Loader2,
  ArrowRight, ArrowLeft, Eye, BarChart2, ChevronDown, UserPlus,
} from '../../../components/ui/icons'

const inputBase =
  'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'

const num = v => Number(v ?? 0).toLocaleString('es')

const TILE_TONES = {
  green: 'bg-jungle-green-50 text-jungle-green-600',
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
}

// Tarjeta de resumen compacta (horizontal, sin espacios vacíos)
function SummaryStat({ icon: Icon, label, value, sub, tone = 'green' }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm">
      <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', TILE_TONES[tone] ?? TILE_TONES.green)}>
        <Icon size={20} strokeWidth={2} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular-nums text-foreground">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{sub ? `${label} · ${sub}` : label}</p>
      </div>
    </div>
  )
}

// Países con código de marcación para el selector telefónico (bandera vía ISO)
const COUNTRIES = [
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
const DEFAULT_COUNTRY = COUNTRIES[0]
const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map(c => [c.code, c]))
const DIAL_SORTED = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

// Resuelve el país de un contacto: usa phone_country si existe; si no, lo infiere
// del prefijo del número guardado (mejor esfuerzo, para contactos antiguos).
function resolveCountry(contact) {
  if (contact.phone_country && COUNTRY_BY_CODE[contact.phone_country]) return COUNTRY_BY_CODE[contact.phone_country]
  const p = contact.phone
  if (!p) return null
  return DIAL_SORTED.find(c => p.startsWith(c.dial)) ?? null
}
function nationalNumber(phone, country) {
  if (!phone) return ''
  if (country && phone.startsWith(country.dial)) return phone.slice(country.dial.length)
  return phone
}

// Bandera por código ISO (imagen real; los emoji de bandera no renderizan en Windows)
function Flag({ code, className }) {
  return (
    <img
      src={`https://flagcdn.com/${code.toLowerCase()}.svg`}
      alt={code}
      loading="lazy"
      className={cn('h-3.5 w-5 shrink-0 rounded-sm object-cover ring-1 ring-black/5', className)}
    />
  )
}

// Input de teléfono con selector de país (bandera + código), buscable.
// El menú se renderiza en un portal con posición fija para que NO lo recorte
// el overflow del modal y no se distorsione.
function CountryPhoneInput({ country, setCountry, number, setNumber }) {
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
        placeholder="995 241 264"
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

// ─── Modal importar CSV/Excel ───────────────────────────────────────────────
function ImportModal({ list, onClose, onDone }) {
  const fileRef = useRef(null)
  const [file, setFile]           = useState(null)
  const [preview, setPreview]     = useState(null)
  const [mapping, setMapping]     = useState({})
  const [uploading, setUploading] = useState(false)
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState('')

  const FIELD_OPTIONS = [
    { value: '',           label: 'Ignorar' },
    { value: 'email',      label: 'Email' },
    { value: 'phone',      label: 'Teléfono' },
    { value: 'first_name', label: 'Nombre' },
    { value: 'last_name',  label: 'Apellido' },
    { value: 'meta',       label: 'Metadata extra' },
  ]

  function handleFile(f) {
    if (!f) return
    setFile(f); setResult(null); setError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(e.target.result, { type: 'array', cellDates: true })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false })
        if (!rows.length) { setError('El archivo no tiene filas'); return }
        const headers = Object.keys(rows[0])
        const norm    = s => s.toLowerCase().replace(/[\s_-]/g, '')
        const auto    = {}
        for (const h of headers) {
          const n = norm(h)
          if (['email','correo','mail'].includes(n))               auto[h] = 'email'
          else if (['phone','telefono','celular','movil'].includes(n)) auto[h] = 'phone'
          else if (['nombre','name','firstname'].includes(n))      auto[h] = 'first_name'
          else if (['apellido','lastname','surname'].includes(n))  auto[h] = 'last_name'
          else auto[h] = 'meta'
        }
        setMapping(auto)
        setPreview({ headers, rows: rows.slice(0, 5) })
      } catch { setError('No se pudo leer el archivo') }
    }
    reader.readAsArrayBuffer(f)
  }

  async function doImport() {
    const hasKey = Object.values(mapping).some(v => v === 'email' || v === 'phone')
    if (!hasKey) { setError('Mapea al menos Email o Teléfono'); return }
    setUploading(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', file, file.name)
      const { data } = await api.post(`/lists/${list.id}/contacts/import`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } })
      setResult(data); onDone()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al importar')
    } finally { setUploading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-lg">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Importar a "{list.name}"</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={1.75} />
          </Button>
        </div>
        <div className="space-y-5 overflow-y-auto p-6">
          {!preview && !result && (
            <>
              <div onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
                className="cursor-pointer rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors hover:border-jungle-green-400 hover:bg-jungle-green-50">
                <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-jungle-green-50 text-jungle-green-600">
                  <FolderOpen size={22} strokeWidth={1.75} />
                </span>
                <p className="font-medium text-foreground">Arrastra tu archivo aquí</p>
                <p className="mt-1 text-sm text-muted-foreground">o haz click para seleccionar</p>
                <p className="mt-3 text-xs text-muted-foreground">CSV, XLSX, XLS. Máximo 10 MB</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={e => handleFile(e.target.files[0])} />
              </div>
              <div className="rounded-xl bg-muted/60 p-4 text-xs text-muted-foreground">
                <p className="mb-2 font-semibold text-foreground">Columnas reconocidas automáticamente:</p>
                <div className="grid grid-cols-2 gap-1">
                  {[['email / correo / mail','Email'],['phone / telefono / celular','Teléfono'],
                    ['nombre / name / firstname','Nombre'],['apellido / lastname','Apellido']].map(([k,v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="rounded bg-muted px-1 font-mono text-foreground">{k}</span>
                      <ArrowRight size={12} className="shrink-0" />
                      <span>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {preview && !result && (
            <>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-jungle-green-50 text-jungle-green-600">
                  <FileText size={18} strokeWidth={1.75} />
                </span>
                <div>
                  <p className="text-sm font-medium text-foreground">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{preview.rows.length}+ filas (vista previa)</p>
                </div>
                <Button variant="ghost" size="sm" className="ml-auto"
                  onClick={() => { setPreview(null); setFile(null) }}>
                  Cambiar archivo
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Mapeo de columnas</p>
                {preview.headers.map(h => (
                  <div key={h} className="flex items-center gap-3">
                    <span className="w-40 truncate rounded bg-muted px-2 py-1 font-mono text-sm text-foreground">{h}</span>
                    <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
                    <select value={mapping[h] ?? ''} onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                      {preview.headers.map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.rows.map((row, i) => (
                      <tr key={i}>{preview.headers.map(h => <td key={h} className="max-w-[120px] truncate px-3 py-2">{String(row[h] ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div className="space-y-3 py-6 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-jungle-green-100 text-jungle-green-700">
                <CheckCircle size={28} strokeWidth={1.75} />
              </span>
              <p className="text-xl font-bold text-jungle-green-700">{num(result.imported)} contactos importados</p>
              <p className="text-sm text-muted-foreground">Omitidos: {num(result.skipped)} · Total en archivo: {num(result.total_in_file)}</p>
              <Button onClick={onClose}>Cerrar</Button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-100 p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {preview && !result && (
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={doImport} disabled={uploading}>
                {uploading && <Loader2 size={16} className="animate-spin" />}
                {uploading ? 'Importando...' : 'Importar contactos'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal agregar contacto individual ──────────────────────────────────────
function AddContactModal({ list, onClose, onDone }) {
  const EMPTY = { email: '', first_name: '', last_name: '' }
  const [form, setForm]         = useState(EMPTY)
  const [country, setCountry]   = useState(DEFAULT_COUNTRY)
  const [phoneNum, setPhoneNum] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [success, setSuccess]   = useState(false)

  const field = k => ({ value: form[k], onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) })

  async function submit(e) {
    e.preventDefault()
    const digits = phoneNum.replace(/\D/g, '')
    if (!form.email && !digits) { setError('Ingresa al menos email o teléfono'); return }
    setLoading(true); setError(null)
    try {
      await api.post(`/lists/${list.id}/contacts`, {
        email:         form.email || undefined,
        phone:         digits || undefined,              // número nacional (sin código)
        phone_dial:    digits ? country.dial : undefined, // '+51'
        phone_country: digits ? country.code : undefined, // 'PE'
        first_name:    form.first_name || undefined,
        last_name:     form.last_name  || undefined,
      })
      setSuccess(true)
      onDone()
      setForm(EMPTY); setPhoneNum('')
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border bg-card shadow-xl">
        <div className="flex items-center gap-3 border-b px-6 py-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600">
            <UserPlus size={20} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">Nuevo contacto</h2>
            <p className="truncate text-xs text-muted-foreground">En la lista "{list.name}"</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar">
            <X size={18} strokeWidth={1.75} />
          </Button>
        </div>
        <form onSubmit={submit} className="space-y-5 p-6">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-100 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 rounded-lg bg-jungle-green-100 px-4 py-3 text-sm text-jungle-green-700">
              <CheckCircle size={16} className="shrink-0" /> Contacto guardado
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ac-first">Nombre</Label>
              <Input id="ac-first" {...field('first_name')} placeholder="Juan" className={inputBase} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ac-last">Apellido</Label>
              <Input id="ac-last" {...field('last_name')} placeholder="Pérez" className={inputBase} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ac-email" className="flex items-center gap-1.5">
              <Mail size={14} strokeWidth={1.75} /> Email
              <span className="font-normal text-muted-foreground">(campañas de email)</span>
            </Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input id="ac-email" {...field('email')} type="email" placeholder="juan@ejemplo.com" className={`${inputBase} pl-11`} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Smartphone size={14} strokeWidth={1.75} /> Teléfono
              <span className="font-normal text-muted-foreground">(WhatsApp y SMS)</span>
            </Label>
            <CountryPhoneInput country={country} setCountry={setCountry} number={phoneNum} setNumber={setPhoneNum} />
            <p className="text-xs text-muted-foreground">Selecciona el país y escribe el número sin el código.</p>
          </div>

          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Puedes ingresar solo email, solo teléfono, o ambos. El canal de la campaña determinará cuál se usa.
          </p>

          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Guardando...' : 'Agregar contacto'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cerrar
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Panel de detalle: contactos de la lista seleccionada (en línea) ─────────
function ListDetail({ list, onChanged, onDeleteList }) {
  const [contacts, setContacts] = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)
  const [adding, setAdding]     = useState(false)
  const [importing, setImporting] = useState(false)

  async function load(p = 1) {
    setLoading(true)
    try {
      const { data } = await api.get(`/lists/${list.id}/contacts?page=${p}&limit=20`)
      setContacts(data.contacts)
      setTotal(data.total)
      setPage(p)
    } finally { setLoading(false) }
  }

  useEffect(() => { setSearch(''); load(1) }, [list.id])

  async function remove(contactId) {
    if (!confirm('¿Eliminar este contacto?')) return
    await api.delete(`/lists/${list.id}/contacts/${contactId}`)
    load(page); onChanged?.()
  }

  function refreshAll() { load(page); onChanged?.() }

  const filtered = contacts.filter(c =>
    !search || [c.first_name, c.last_name, c.email, c.phone]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  )
  const totalPages = Math.ceil(total / 20)

  return (
    <SectionCard
      noPadding
      title={list.name}
      description={`${num(total)} ${total === 1 ? 'contacto' : 'contactos'}`}
      action={
        <Button variant="ghost" size="icon" onClick={() => onDeleteList(list)}
          className="text-muted-foreground hover:text-red-600" aria-label="Eliminar lista">
          <Trash2 size={16} strokeWidth={1.75} />
        </Button>
      }
    >
      {/* Barra de herramientas */}
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o teléfono..."
            className={`${inputBase} pl-11`} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} strokeWidth={1.75} /> Agregar
          </Button>
          <Button variant="outline" onClick={() => setImporting(true)}>
            <Upload size={16} strokeWidth={1.75} /> Importar
          </Button>
        </div>
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 size={20} className="mr-2 animate-spin text-jungle-green-600" /> Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? 'Sin resultados' : 'Lista vacía'}
          description={search ? 'No hay contactos que coincidan con tu búsqueda.' : 'Agrega contactos uno a uno o importa desde CSV/Excel.'}
          action={!search && (
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} strokeWidth={1.75} /> Agregar contacto
            </Button>
          )}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-3 font-medium">Nombre</th>
                <th className="px-5 py-3 font-medium">Email</th>
                <th className="px-5 py-3 font-medium">País</th>
                <th className="px-5 py-3 font-medium">Número</th>
                <th className="px-5 py-3 font-medium">Canales</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map(c => {
                const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
                const ctry = resolveCountry(c)
                const national = nationalNumber(c.phone, ctry)
                return (
                  <tr key={c.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-jungle-green-100 text-xs font-semibold uppercase text-jungle-green-700">
                          {(name || c.email || c.phone || '?')[0]}
                        </span>
                        <span className="font-medium text-foreground">{name || <span className="text-muted-foreground">Sin nombre</span>}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{c.email || <span className="text-muted-foreground/50">—</span>}</td>
                    <td className="px-5 py-3">
                      {ctry
                        ? <span className="inline-flex items-center gap-1.5"><Flag code={ctry.code} /><span className="tabular-nums text-muted-foreground">{ctry.dial}</span></span>
                        : <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-5 py-3 font-mono text-muted-foreground">{national || <span className="font-sans text-muted-foreground/50">—</span>}</td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1">
                        {c.email && <span className="inline-flex items-center rounded-full bg-jungle-green-100 px-1.5 py-0.5 text-jungle-green-700"><Mail size={12} /></span>}
                        {c.phone && <span className="inline-flex items-center rounded-full bg-blue-100 px-1.5 py-0.5 text-blue-700"><Smartphone size={12} /></span>}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild variant="ghost" size="sm">
                          <a href={`/dashboard/contacts/${c.id}`}><Eye size={14} strokeWidth={1.75} /> 360°</a>
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(c.id)}
                          className="text-muted-foreground hover:text-red-600" aria-label="Eliminar contacto">
                          <Trash2 size={16} strokeWidth={1.75} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => load(page - 1)} disabled={page === 1}>
            <ArrowLeft size={14} /> Anterior
          </Button>
          <span className="text-sm text-muted-foreground">Página {page} de {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => load(page + 1)} disabled={page === totalPages}>
            Siguiente <ArrowRight size={14} />
          </Button>
        </div>
      )}

      {adding && <AddContactModal list={list} onClose={() => setAdding(false)} onDone={refreshAll} />}
      {importing && <ImportModal list={list} onClose={() => setImporting(false)} onDone={refreshAll} />}
    </SectionCard>
  )
}

// ─── Página principal ───────────────────────────────────────────────────────
export default function ContactsPage() {
  const [lists, setLists]     = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [newList, setNewList] = useState('')
  const [showListForm, setShowListForm] = useState(false)
  const [listSearch, setListSearch] = useState('')

  async function load(selectId) {
    const { data } = await api.get('/lists')
    setLists(data)
    setSelectedId(prev => {
      if (selectId) return selectId
      if (prev && data.some(l => l.id === prev)) return prev
      return data[0]?.id ?? null
    })
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  async function addList(e) {
    e.preventDefault()
    const { data } = await api.post('/lists', { name: newList })
    setNewList(''); setShowListForm(false)
    load(data?.id)
  }

  async function deleteList(list) {
    if (!confirm(`¿Eliminar la lista "${list.name}" y todos sus contactos?`)) return
    await api.delete(`/lists/${list.id}`)
    if (selectedId === list.id) setSelectedId(null)
    load()
  }

  const selected = lists.find(l => l.id === selectedId) ?? null
  const filteredLists = lists.filter(l => !listSearch || l.name.toLowerCase().includes(listSearch.toLowerCase()))
  const totalContacts = lists.reduce((a, l) => a + Number(l.total_count || 0), 0)
  const biggest = lists.reduce((a, l) => (Number(l.total_count || 0) > Number(a?.total_count || 0) ? l : a), null)

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-muted-foreground">
      <Loader2 size={20} className="mr-2 animate-spin text-jungle-green-600" /> Cargando...
    </div>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={Users}
        title="Contactos"
        description="Gestiona tus listas de contactos para email, WhatsApp y SMS"
        action={
          <Button onClick={() => setShowListForm(v => !v)}>
            <Plus size={16} strokeWidth={1.75} /> Nueva lista
          </Button>
        }
      />

      {/* Resumen */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryStat icon={FolderOpen} label="Listas de contactos" value={num(lists.length)} tone="green" />
        <SummaryStat icon={Users} label="Contactos totales" value={num(totalContacts)} tone="blue" />
        <SummaryStat icon={BarChart2} label="Lista más grande" value={num(biggest?.total_count ?? 0)} sub={biggest?.name} tone="violet" />
      </div>

      {lists.length === 0 && !showListForm ? (
        <SectionCard>
          <EmptyState
            icon={Users}
            title="Sin listas de contactos"
            description="Crea una lista y agrega contactos uno a uno o importa desde CSV/Excel."
            action={
              <Button onClick={() => setShowListForm(true)}>
                <Plus size={16} strokeWidth={1.75} /> Crear primera lista
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* Panel de listas */}
          <SectionCard noPadding title="Tus listas" description={`${num(lists.length)} ${lists.length === 1 ? 'lista' : 'listas'}`} className="self-start">
            {showListForm && (
              <form onSubmit={addList} className="space-y-2 border-b p-3">
                <Input type="text" placeholder="Nombre de la lista" value={newList}
                  onChange={e => setNewList(e.target.value)} className={inputBase} autoFocus required />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" className="flex-1">Crear</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowListForm(false)}>Cancelar</Button>
                </div>
              </form>
            )}
            {lists.length > 6 && (
              <div className="border-b p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="Buscar lista..."
                    className="h-10 w-full rounded-lg bg-muted/60 pl-9 pr-2 text-sm outline-none transition-colors focus:bg-background focus:ring-1 focus:ring-ring" />
                </div>
              </div>
            )}
            <div className="scrollbar-thin max-h-[60vh] space-y-1 overflow-y-auto p-2">
              {filteredLists.map(l => {
                const active = l.id === selectedId
                return (
                  <button key={l.id} onClick={() => setSelectedId(l.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                      active ? 'bg-jungle-green-600 text-white shadow-sm' : 'text-foreground hover:bg-jungle-green-50',
                    )}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.name}</span>
                      {l.description && <span className={cn('block truncate text-xs', active ? 'text-white/70' : 'text-muted-foreground')}>{l.description}</span>}
                    </span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', active ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground')}>
                      {num(l.total_count)}
                    </span>
                  </button>
                )
              })}
              {!filteredLists.length && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ninguna lista coincide.</p>
              )}
            </div>
          </SectionCard>

          {/* Panel de detalle */}
          {selected ? (
            <ListDetail list={selected} onChanged={() => load(selectedId)} onDeleteList={deleteList} />
          ) : (
            <SectionCard>
              <EmptyState icon={FolderOpen} title="Selecciona una lista" description="Elige una lista de la izquierda para ver y gestionar sus contactos." />
            </SectionCard>
          )}
        </div>
      )}
    </div>
  )
}

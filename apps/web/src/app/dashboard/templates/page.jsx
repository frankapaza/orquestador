'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { PageHeader } from '@/components/ui/PageHeader'
import { SectionCard } from '@/components/ui/section-card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { FileText, Pencil, Trash2, Eye, Save, Plus, ArrowRight, Loader2, Mail, AtSign } from '@/components/ui/icons'

const EMPTY = { name: '', subject: '', from_name: '', html_content: '', text_content: '' }

const SAMPLE_TEMPLATES = [
  { name: 'Bienvenida', subject: 'Bienvenido {{first_name}} a {{company}}', from_name: 'Equipo de ventas',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#2563eb">¡Bienvenido {{first_name}}!</h2>
  <p>Gracias por unirte a nosotros. Estamos felices de tenerte.</p>
  <p>Si tienes alguna consulta, no dudes en contactarnos.</p>
  <p>Saludos,<br><strong>El equipo</strong></p>
</div>` },
  { name: 'Seguimiento de venta', subject: '{{first_name}}, ¿cómo podemos ayudarte?', from_name: 'Asesor comercial',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <p>Hola {{first_name}},</p>
  <p>Quería hacer un seguimiento a nuestra conversación anterior.</p>
  <p>¿Tienes alguna pregunta sobre nuestra propuesta?</p>
  <p>Saludos,<br><strong>El equipo comercial</strong></p>
</div>` },
  { name: 'Recordatorio de pago', subject: 'Recordatorio: Pago pendiente', from_name: 'Administración',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <p>Estimado {{first_name}},</p>
  <p>Le recordamos que tiene un pago pendiente.</p>
  <p>Por favor regularice su situación a la brevedad.</p>
  <p>Atentamente,<br><strong>Administración</strong></p>
</div>` },
]

const inputClass = 'h-[52px] rounded-xl border-transparent bg-muted/60 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0'

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([])
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(EMPTY)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [preview, setPreview]     = useState(null)
  const [listLoading, setListLoading] = useState(true)

  const load = () => api.get('/templates').then(r => setTemplates(r.data)).finally(() => setListLoading(false))
  useEffect(() => { load() }, [])

  function openNew(sample = null) { setForm(sample ? { ...EMPTY, ...sample } : EMPTY); setEditing(null); setError(null); setShowForm(true) }
  function openEdit(t) {
    setForm({ name: t.name, subject: t.subject, from_name: t.from_name, html_content: t.html_content, text_content: t.text_content ?? '' })
    setEditing(t.id); setError(null); setShowForm(true)
  }
  function closeForm() { setShowForm(false); setEditing(null) }

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      if (editing) await api.patch(`/templates/${editing}`, form)
      else         await api.post('/templates', form)
      closeForm(); setForm(EMPTY); load()
    } catch (err) { setError(err.response?.data?.error ?? 'Error al guardar') }
    finally { setLoading(false) }
  }

  async function remove(id, name) {
    if (!confirm(`¿Eliminar la plantilla "${name}"?`)) return
    await api.delete(`/templates/${id}`); load()
  }

  const field = k => ({ value: form[k] ?? '', onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) })

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={FileText}
        title="Plantillas de email"
        description="Guarda y reutiliza contenido HTML para tus campañas."
        action={<Button onClick={() => openNew()}><Plus size={16} strokeWidth={2} /> Nueva plantilla</Button>}
      />

      {/* Inicio rápido cuando no hay ninguna */}
      {!listLoading && templates.length === 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Empieza con una plantilla de ejemplo</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SAMPLE_TEMPLATES.map((s, i) => (
              <button key={i} onClick={() => openNew(s)}
                className="group rounded-2xl border border-dashed bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-jungle-green-300 hover:bg-jungle-green-50/40 hover:shadow-md">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600"><Mail size={18} strokeWidth={1.75} /></span>
                <p className="mt-3 text-sm font-semibold text-foreground">{s.name}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{s.subject}</p>
                <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-jungle-green-700">
                  Usar esta plantilla <ArrowRight size={14} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lista */}
      {listLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 size={18} className="animate-spin text-jungle-green-600" /> Cargando...
        </div>
      ) : templates.length === 0 ? (
        <SectionCard>
          <EmptyState icon={FileText} title="Sin plantillas guardadas"
            description="Crea una plantilla para reutilizarla en tus campañas."
            action={<Button onClick={() => openNew()}><Plus size={16} strokeWidth={2} /> Nueva plantilla</Button>} />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map(t => (
            <div key={t.id} className="group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              {/* Mini-preview del HTML */}
              <div className="relative h-28 overflow-hidden border-b bg-muted/30">
                <div className="pointer-events-none absolute left-0 top-0 origin-top-left scale-[0.5] opacity-90"
                  style={{ width: '200%' }} dangerouslySetInnerHTML={{ __html: t.html_content }} />
                <button onClick={() => setPreview(t)}
                  className="absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition-opacity hover:bg-foreground/40 group-hover:opacity-100">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow"><Eye size={14} /> Vista previa</span>
                </button>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-foreground">{t.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(t.updated_at).toLocaleDateString('es', { day: '2-digit', month: '2-digit' })}</span>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={t.subject}>{t.subject}</p>
                <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground"><AtSign size={11} /> {t.from_name}</p>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(t)} className="flex-1"><Pencil size={15} strokeWidth={1.75} /> Editar</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(t.id, t.name)} className="px-3 text-red-600 hover:bg-red-50 hover:text-red-700"><Trash2 size={15} strokeWidth={1.75} /></Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal formulario */}
      <Modal open={showForm} onClose={closeForm} size="2xl"
        icon={editing ? Pencil : Plus} title={editing ? 'Editar plantilla' : 'Nueva plantilla'}>
        <form onSubmit={submit} className="space-y-5 p-6">
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Nombre de la plantilla</Label>
              <Input id="tpl-name" {...field('name')} required placeholder="Ej: Bienvenida cliente" className={inputClass} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-from">Remitente</Label>
              <Input id="tpl-from" {...field('from_name')} required placeholder="Ej: Equipo de ventas" className={inputClass} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-subject">Asunto</Label>
            <Input id="tpl-subject" {...field('subject')} required placeholder="Ej: {{first_name}}, tenemos algo para ti" className={inputClass} />
            <p className="text-xs text-muted-foreground">Variables: <code className="rounded bg-muted px-1">{'{{first_name}}'}</code> <code className="rounded bg-muted px-1">{'{{last_name}}'}</code> <code className="rounded bg-muted px-1">{'{{email}}'}</code></p>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="tpl-html">Contenido HTML</Label>
              {form.html_content && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPreview({ name: form.name || 'Vista previa', html_content: form.html_content })}>
                  <Eye size={15} strokeWidth={1.75} /> Vista previa
                </Button>
              )}
            </div>
            <textarea id="tpl-html" {...field('html_content')} required rows={10}
              placeholder="<h1>Hola {{first_name}}</h1><p>Tu mensaje aquí...</p>"
              className="w-full resize-y rounded-xl border-transparent bg-muted/60 px-4 py-3 font-mono text-sm shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:outline-none focus-visible:ring-0" />
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? <><Loader2 size={16} className="animate-spin" /> Guardando...</> : <><Save size={16} strokeWidth={1.75} /> Guardar plantilla</>}
            </Button>
            <Button type="button" variant="outline" onClick={closeForm} className="flex-1">Cancelar</Button>
          </div>
        </form>
      </Modal>

      {/* Modal vista previa */}
      <Modal open={!!preview} onClose={() => setPreview(null)} size="2xl" icon={Eye} title={preview?.name ?? 'Vista previa'}
        description={preview?.subject}>
        <div className="bg-muted/30 p-6">
          <div className="mx-auto max-w-2xl rounded-xl border bg-white p-6 shadow-sm" dangerouslySetInnerHTML={{ __html: preview?.html_content ?? '' }} />
        </div>
      </Modal>
    </div>
  )
}

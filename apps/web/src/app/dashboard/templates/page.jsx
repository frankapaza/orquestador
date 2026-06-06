'use client'
import { useEffect, useState } from 'react'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { FileText, Pencil, Trash2, Eye, Save, Plus, ClipboardList } from '../../../components/ui/icons'

const EMPTY = { name: '', subject: '', from_name: '', html_content: '', text_content: '' }

const SAMPLE_TEMPLATES = [
  {
    name: 'Bienvenida',
    subject: 'Bienvenido {{first_name}} a {{company}}',
    from_name: 'Equipo de ventas',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#2563eb">¡Bienvenido {{first_name}}!</h2>
  <p>Gracias por unirte a nosotros. Estamos felices de tenerte.</p>
  <p>Si tienes alguna consulta, no dudes en contactarnos.</p>
  <p>Saludos,<br><strong>El equipo</strong></p>
</div>`,
  },
  {
    name: 'Seguimiento de venta',
    subject: '{{first_name}}, ¿cómo podemos ayudarte?',
    from_name: 'Asesor comercial',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <p>Hola {{first_name}},</p>
  <p>Quería hacer un seguimiento a nuestra conversación anterior.</p>
  <p>¿Tienes alguna pregunta sobre nuestra propuesta?</p>
  <p>Quedo a tu disposición.</p>
  <p>Saludos,<br><strong>El equipo comercial</strong></p>
</div>`,
  },
  {
    name: 'Recordatorio de pago',
    subject: 'Recordatorio: Pago pendiente',
    from_name: 'Administración',
    html_content: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <p>Estimado {{first_name}},</p>
  <p>Le recordamos que tiene un pago pendiente.</p>
  <p>Por favor regularice su situación a la brevedad.</p>
  <p>Ante cualquier consulta, estamos a su disposición.</p>
  <p>Atentamente,<br><strong>Administración</strong></p>
</div>`,
  },
]

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([])
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(EMPTY)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [preview, setPreview]     = useState(null)

  const load = () => api.get('/templates').then(r => setTemplates(r.data))
  useEffect(() => { load() }, [])

  function openNew(sample = null) {
    setForm(sample ? { ...EMPTY, ...sample } : EMPTY)
    setEditing(null)
    setError(null)
    setShowForm(true)
  }

  function openEdit(t) {
    setForm({ name: t.name, subject: t.subject, from_name: t.from_name, html_content: t.html_content, text_content: t.text_content ?? '' })
    setEditing(t.id)
    setError(null)
    setShowForm(true)
  }

  async function submit(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      if (editing) await api.patch(`/templates/${editing}`, form)
      else         await api.post('/templates', form)
      setShowForm(false); setEditing(null); setForm(EMPTY)
      load()
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar')
    } finally { setLoading(false) }
  }

  async function remove(id, name) {
    if (!confirm(`¿Eliminar la plantilla "${name}"?`)) return
    await api.delete(`/templates/${id}`)
    load()
  }

  const field = k => ({ value: form[k] ?? '', onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) })

  return (
    <div>
      <PageHeader
        icon={FileText}
        title="Plantillas de email"
        description="Guarda y reutiliza contenido HTML para tus campañas"
        action={
          <button onClick={() => openNew()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5">
            <Plus size={14} /> Nueva plantilla
          </button>
        }
      />

      {/* Plantillas de muestra */}
      {templates.length === 0 && !showForm && (
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-600 mb-3">Plantillas de inicio rápido:</p>
          <div className="grid grid-cols-3 gap-3">
            {SAMPLE_TEMPLATES.map((s, i) => (
              <button key={i} onClick={() => openNew(s)}
                className="text-left border-2 border-dashed border-gray-200 rounded-xl p-4 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <p className="font-medium text-gray-800 text-sm">{s.name}</p>
                <p className="text-xs text-gray-500 mt-1 truncate">{s.subject}</p>
                <p className="text-xs text-blue-600 mt-2 font-medium">Usar esta plantilla →</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Formulario */}
      {showForm && (
        <div className="modal-overlay fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="modal-content bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-lg font-semibold flex items-center gap-2">{editing ? <><Pencil size={16} /> Editar plantilla</> : <><Plus size={16} /> Nueva plantilla</>}</h2>
            </div>
            {error && <div className="mx-6 mt-4 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-200">{error}</div>}
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Nombre de la plantilla</label>
                  <input {...field('name')} required placeholder="Ej: Bienvenida cliente"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 block mb-1">Remitente</label>
                  <input {...field('from_name')} required placeholder="Ej: Equipo de ventas"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 block mb-1">Asunto</label>
                <input {...field('subject')} required placeholder="Ej: {{first_name}}, tenemos algo para ti"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                <p className="text-xs text-gray-400 mt-1">Variables disponibles: <code className="bg-gray-100 px-1 rounded">{'{{first_name}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{last_name}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{email}}'}</code></p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-gray-700">Contenido HTML</label>
                  {form.html_content && (
                    <button type="button" onClick={() => setPreview(form.html_content)}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                      <Eye size={12} /> Vista previa
                    </button>
                  )}
                </div>
                <textarea {...field('html_content')} required rows={10}
                  placeholder="<h1>Hola {{first_name}}</h1><p>Tu mensaje aquí...</p>"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={loading}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                  {loading ? 'Guardando...' : <><Save size={14} /> Guardar plantilla</>}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditing(null) }}
                  className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal vista previa */}
      {preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <p className="font-semibold text-gray-800">Vista previa</p>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="overflow-y-auto p-6" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        </div>
      )}

      {/* Lista de plantillas */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {templates.map(t => (
          <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-semibold text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate" title={t.subject}>{t.subject}</p>
                <p className="text-xs text-gray-400 mt-0.5">De: {t.from_name}</p>
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">
                {new Date(t.updated_at).toLocaleDateString('es', { day:'2-digit', month:'2-digit' })}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => openEdit(t)}
                className="flex-1 border border-gray-200 text-gray-700 text-xs py-1.5 rounded-lg hover:bg-gray-50 flex items-center justify-center gap-1">
                <Pencil size={12} /> Editar
              </button>
              <button onClick={() => remove(t.id, t.name)}
                className="border border-red-200 text-red-500 text-xs py-1.5 px-3 rounded-lg hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}

        {templates.length === 0 && !showForm && (
          <div className="col-span-3 text-center py-16 text-gray-400">
            <p className="text-4xl mb-3">📋</p>
            <p className="font-medium">Sin plantillas guardadas</p>
            <p className="text-sm mt-1">Crea una plantilla para reutilizarla en tus campañas</p>
          </div>
        )}
      </div>
    </div>
  )
}

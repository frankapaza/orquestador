'use client'
import { useEffect, useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import api from '../../../lib/api'
import { PageHeader } from '../../../components/ui/PageHeader'
import { Upload, Trash2, Search, Plus, Mail, Smartphone, Users } from '../../../components/ui/icons'

// ─── Modal importar CSV/Excel ────────────────────────────────────────────────
function ImportModal({ list, onClose, onDone }) {
  const fileRef = useRef(null)
  const [file, setFile]           = useState(null)
  const [preview, setPreview]     = useState(null)
  const [mapping, setMapping]     = useState({})
  const [uploading, setUploading] = useState(false)
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState('')

  const FIELD_OPTIONS = [
    { value: '',           label: '— ignorar —' },
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Importar a "{list.name}"</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-5">
          {!preview && !result && (
            <>
              <div onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
                className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <p className="text-4xl mb-3">📂</p>
                <p className="font-medium text-gray-700">Arrastra tu archivo aquí</p>
                <p className="text-sm text-gray-400 mt-1">o haz click para seleccionar</p>
                <p className="text-xs text-gray-400 mt-3">CSV, XLSX, XLS — máx 10 MB</p>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={e => handleFile(e.target.files[0])} />
              </div>
              <div className="bg-gray-50 rounded-xl p-4 text-xs text-gray-500">
                <p className="font-semibold mb-2">Columnas reconocidas automáticamente:</p>
                <div className="grid grid-cols-2 gap-1">
                  {[['email / correo / mail','Email'],['phone / telefono / celular','Teléfono'],
                    ['nombre / name / firstname','Nombre'],['apellido / lastname','Apellido']].map(([k,v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="font-mono bg-gray-200 px-1 rounded">{k}</span>
                      <span className="text-gray-400">→ {v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {preview && !result && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-2xl">📄</span>
                <div>
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-gray-400">{preview.rows.length}+ filas (preview)</p>
                </div>
                <button onClick={() => { setPreview(null); setFile(null) }}
                  className="ml-auto text-xs text-gray-400 underline hover:text-gray-600">
                  Cambiar archivo
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-gray-700">Mapeo de columnas</p>
                {preview.headers.map(h => (
                  <div key={h} className="flex items-center gap-3">
                    <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded w-40 truncate">{h}</span>
                    <span className="text-gray-400 text-xs">→</span>
                    <select value={mapping[h] ?? ''} onChange={e => setMapping(m => ({ ...m, [h]: e.target.value }))}
                      className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500">
                      {FIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50">
                    <tr>{preview.headers.map(h => <th key={h} className="px-3 py-2 text-left border-r border-gray-100 last:border-0">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.rows.map((row, i) => (
                      <tr key={i}>{preview.headers.map(h => <td key={h} className="px-3 py-2 border-r border-gray-100 last:border-0 truncate max-w-[120px]">{String(row[h] ?? '')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {result && (
            <div className="text-center space-y-3 py-6">
              <p className="text-5xl">✅</p>
              <p className="text-xl font-bold text-green-700">{Number(result.imported).toLocaleString()} contactos importados</p>
              <p className="text-sm text-gray-500">Omitidos: {Number(result.skipped).toLocaleString()} · Total en archivo: {Number(result.total_in_file).toLocaleString()}</p>
              <button onClick={onClose} className="px-6 py-2 bg-green-600 text-white rounded-xl text-sm font-medium hover:bg-green-700">Cerrar</button>
            </div>
          )}

          {error && <p className="text-red-500 text-sm bg-red-50 p-3 rounded-lg">{error}</p>}

          {preview && !result && (
            <div className="flex justify-end gap-3 pt-2 border-t">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-xl hover:bg-gray-50">Cancelar</button>
              <button onClick={doImport} disabled={uploading}
                className="px-6 py-2 text-sm bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50">
                {uploading ? 'Importando...' : 'Importar contactos'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Modal agregar contacto individual ───────────────────────────────────────
function AddContactModal({ list, onClose, onDone }) {
  const EMPTY = { email: '', phone: '', first_name: '', last_name: '' }
  const [form, setForm]       = useState(EMPTY)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [success, setSuccess] = useState(false)

  const field = k => ({ value: form[k], onChange: e => setForm(f => ({ ...f, [k]: e.target.value })) })

  async function submit(e) {
    e.preventDefault()
    if (!form.email && !form.phone) { setError('Ingresa al menos email o teléfono'); return }
    setLoading(true); setError(null)
    try {
      await api.post(`/lists/${list.id}/contacts`, {
        email:      form.email || undefined,
        phone:      form.phone || undefined,
        first_name: form.first_name || undefined,
        last_name:  form.last_name  || undefined,
      })
      setSuccess(true)
      onDone()
      setForm(EMPTY)
      setTimeout(() => setSuccess(false), 2000)
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al guardar')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Agregar contacto a "{list.name}"</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>}
          {success && <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg">✅ Contacto guardado</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-700">Nombre</label>
              <input {...field('first_name')} placeholder="Juan"
                className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-700">Apellido</label>
              <input {...field('last_name')} placeholder="Pérez"
                className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
              <Mail size={12} /> Email
              <span className="text-gray-400 font-normal">(para campañas de email)</span>
            </label>
            <input {...field('email')} type="email" placeholder="juan@ejemplo.com"
              className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
              <Smartphone size={12} /> Teléfono
              <span className="text-gray-400 font-normal">(para WhatsApp y SMS)</span>
            </label>
            <input {...field('phone')} type="tel" placeholder="+51910462070"
              className="mt-1.5 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            <p className="text-xs text-gray-400 mt-1">Incluye el código de país. Ej: +51 para Perú</p>
          </div>

          <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
            💡 Puedes ingresar solo email, solo teléfono, o ambos. El canal de la campaña determinará cuál se usa.
          </p>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading}
              className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Guardando...' : '+ Agregar contacto'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 border border-gray-300 py-2.5 rounded-xl text-sm text-gray-700 hover:bg-gray-50">
              Cerrar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Modal ver contactos de una lista ────────────────────────────────────────
function ContactsListModal({ list, onClose }) {
  const [contacts, setContacts] = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(true)

  async function load(p = 1) {
    setLoading(true)
    try {
      const { data } = await api.get(`/lists/${list.id}/contacts?page=${p}&limit=20`)
      setContacts(data.contacts)
      setTotal(data.total)
      setPage(p)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function remove(contactId) {
    if (!confirm('¿Eliminar este contacto?')) return
    await api.delete(`/lists/${list.id}/contacts/${contactId}`)
    load(page)
  }

  const filtered = contacts.filter(c =>
    !search || [c.first_name, c.last_name, c.email, c.phone]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  )
  const totalPages = Math.ceil(total / 20)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold">{list.name}</h2>
            <p className="text-sm text-gray-500">{total.toLocaleString()} contactos</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        <div className="px-6 py-3 border-b flex-shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email o teléfono..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">Cargando...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-400">Sin contactos</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Nombre</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Teléfono</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Canales</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {[c.first_name, c.last_name].filter(Boolean).join(' ') || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.email || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-gray-600">{c.phone || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {c.email && <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Mail size={10} /></span>}
                        {c.phone && <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><Smartphone size={10} /></span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <a href={`/dashboard/contacts/${c.id}`}
                          className="text-xs text-purple-600 hover:underline font-medium flex items-center gap-1">
                          <Search size={11} /> 360°
                        </a>
                        <button onClick={() => remove(c.id)} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t flex-shrink-0">
            <button onClick={() => load(page - 1)} disabled={page === 1}
              className="text-sm text-gray-600 border px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-gray-50">
              ← Anterior
            </button>
            <span className="text-sm text-gray-500">Página {page} de {totalPages}</span>
            <button onClick={() => load(page + 1)} disabled={page === totalPages}
              className="text-sm text-gray-600 border px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-gray-50">
              Siguiente →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ContactsPage() {
  const [lists, setLists]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [newList, setNewList]     = useState('')
  const [showListForm, setShowListForm] = useState(false)
  const [importing, setImporting]   = useState(null)
  const [addingTo, setAddingTo]     = useState(null)
  const [viewingList, setViewingList] = useState(null)

  async function load() {
    const { data } = await api.get('/lists')
    setLists(data)
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  async function addList(e) {
    e.preventDefault()
    await api.post('/lists', { name: newList })
    setNewList(''); setShowListForm(false); load()
  }

  async function deleteList(id) {
    if (!confirm('¿Eliminar esta lista y todos sus contactos?')) return
    await api.delete(`/lists/${id}`)
    load()
  }

  if (loading) return <div className="text-gray-400 py-20 text-center">Cargando...</div>

  return (
    <div>
      <PageHeader
        icon={Users}
        title="Contactos"
        description="Gestiona tus listas de contactos para email, WhatsApp y SMS"
        action={
          <button onClick={() => setShowListForm(v => !v)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            + Nueva lista
          </button>
        }
      />

      {showListForm && (
        <form onSubmit={addList} className="bg-white rounded-xl border border-gray-200 p-4 flex gap-3 mb-4">
          <input type="text" placeholder="Nombre de la lista (ej: Clientes Peru SMS)"
            value={newList} onChange={e => setNewList(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus required />
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            Crear lista
          </button>
          <button type="button" onClick={() => setShowListForm(false)}
            className="text-gray-500 px-3 py-2 text-sm hover:text-gray-700">
            Cancelar
          </button>
        </form>
      )}

      <div className="space-y-3">
        {lists.map(l => (
          <div key={l.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">{l.name}</p>
                {l.description && <p className="text-sm text-gray-400 mt-0.5">{l.description}</p>}
                <button onClick={() => setViewingList(l)}
                  className="text-sm text-blue-600 hover:underline mt-1">
                  {Number(l.total_count).toLocaleString()} contactos →
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setAddingTo(l)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-green-700 border border-green-200 rounded-lg hover:bg-green-50 font-medium">
                  <Plus size={14} /> Agregar uno
                </button>
                <button onClick={() => setImporting(l)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 font-medium">
                  <Upload size={14} /> Importar CSV / Excel
                </button>
                <button onClick={() => deleteList(l.id)}
                  className="text-red-400 hover:text-red-600 text-sm px-2">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {!lists.length && (
          <div className="bg-white rounded-xl border-2 border-dashed border-gray-200 p-16 text-center">
            <p className="text-4xl mb-3">👥</p>
            <p className="text-lg font-semibold text-gray-700">Sin listas de contactos</p>
            <p className="text-sm text-gray-400 mt-2">
              Crea una lista y agrega contactos uno a uno o importa desde CSV/Excel.
            </p>
            <button onClick={() => setShowListForm(true)}
              className="mt-6 bg-blue-600 text-white px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-blue-700">
              + Crear primera lista
            </button>
          </div>
        )}
      </div>

      {importing   && <ImportModal      list={importing}    onClose={() => setImporting(null)}    onDone={load} />}
      {addingTo    && <AddContactModal  list={addingTo}     onClose={() => setAddingTo(null)}     onDone={load} />}
      {viewingList && <ContactsListModal list={viewingList} onClose={() => setViewingList(null)} />}
    </div>
  )
}

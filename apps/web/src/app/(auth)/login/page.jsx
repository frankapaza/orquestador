'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Lock, Eye, EyeOff, Box, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import api from '../../../lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'

const VENTAJAS = [
  'Envíos por WhatsApp, email y SMS',
  'Programación de campañas',
  'Seguimiento de aperturas y entregas',
  'Plantillas y contactos centralizados',
  'Reportes en tiempo real',
]

function Logo({ tono = 'oscuro' }) {
  const cuadro = tono === 'oscuro' ? 'bg-white/10 text-white' : 'bg-jungle-green-600 text-white'
  const titulo = tono === 'oscuro' ? 'text-white' : 'text-foreground'
  const sub = tono === 'oscuro' ? 'text-white/60' : 'text-muted-foreground'
  return (
    <div className="flex items-center gap-2.5">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${cuadro}`}>
        <Box className="h-5 w-5" />
      </div>
      <div className="leading-none">
        <span className={`text-base font-semibold tracking-tight ${titulo}`}>Kubo</span>
        <span className={`ml-1.5 text-xs ${sub}`}>Orquestador</span>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ email: '', password: '' })
  const [remember, setRemember] = useState(true)
  const [showPass, setShowPass] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      const maxAge = remember ? `; max-age=${7 * 24 * 3600}` : ''
      document.cookie = `kubo_token=${data.token}; path=/${maxAge}; SameSite=Lax`
      localStorage.setItem('kubo_token', data.token)
      router.push('/dashboard')
    } catch (err) {
      setError(err.response?.data?.error ?? 'No pudimos iniciar sesión. Revisa tus datos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* Formulario */}
      <main className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-md duration-500 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
          <Logo tono="claro" />

          <div className="mb-8 mt-10">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Iniciar sesión</h1>
            <p className="mt-2 text-[15px] text-muted-foreground">Ingresa tus credenciales para continuar.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">Usuario</Label>
              <div className="relative">
                <Mail aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="h-[52px] rounded-xl border-transparent bg-muted/60 pl-11 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0"
                  placeholder="ejemplo@kuboti.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">Contraseña</Label>
              <div className="relative">
                <Lock aria-hidden className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="h-[52px] rounded-xl border-transparent bg-muted/60 pl-11 pr-11 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:bg-background focus-visible:ring-0"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPass ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" checked={remember} onCheckedChange={v => setRemember(Boolean(v))} />
                <Label htmlFor="remember" className="cursor-pointer text-sm font-normal text-muted-foreground">Recordarme</Label>
              </div>
              <button
                type="button"
                onClick={() => setShowHint(h => !h)}
                className="text-sm font-medium text-primary transition-colors hover:text-jungle-green-700"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {showHint && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                Pídele a tu administrador que la restablezca desde el panel de seguridad.
              </p>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={loading} className="h-[52px] w-full rounded-xl text-base font-semibold">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ingresando...
                </>
              ) : (
                'Entrar'
              )}
            </Button>
          </form>

          <p className="mt-10 text-center text-xs text-muted-foreground">
            v1.0.0 · Plataforma interna de Kubo
          </p>
        </div>
      </main>

      {/* Panel de marca (solo desktop) */}
      <aside className="hidden p-4 lg:block lg:p-6">
        <div className="relative flex h-full flex-col justify-between overflow-hidden rounded-[2rem] bg-gradient-to-br from-jungle-green-800 to-jungle-green-950 p-10 text-white xl:p-14">
          {/* Cubos decorativos */}
          <Box aria-hidden className="pointer-events-none absolute right-16 top-28 h-20 w-20 rotate-12 text-white/[0.06]" />
          <Box aria-hidden className="pointer-events-none absolute -bottom-4 right-24 h-28 w-28 -rotate-12 text-white/[0.05]" />
          <Box aria-hidden className="pointer-events-none absolute left-10 top-1/2 h-12 w-12 rotate-6 text-white/[0.06]" />
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-jungle-green-500/20 blur-3xl" />

          {/* Logo arriba */}
          <div className="relative flex items-center justify-end gap-2">
            <Box className="h-6 w-6" />
            <span className="text-lg font-semibold tracking-widest">KUBO</span>
          </div>

          {/* Contenido */}
          <div className="relative max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-jungle-green-200/70">
              Orquestador de campañas
            </p>
            <h2 className="mt-5 text-balance text-4xl font-bold leading-[1.1] tracking-tight xl:text-5xl">
              Un panel para todos tus envíos.
            </h2>
            <p className="mt-5 max-w-sm text-pretty text-[15px] leading-relaxed text-jungle-green-100/80">
              Coordina WhatsApp, email y SMS, programa campañas y mide resultados sin cambiar de herramienta.
            </p>

            <ul className="mt-10 space-y-3.5">
              {VENTAJAS.map(v => (
                <li key={v} className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-jungle-green-300" />
                  <span className="text-[15px] text-jungle-green-50/90">{v}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-sm text-jungle-green-100/50">
            © 2026 Kubo. Todos los derechos reservados.
          </p>
        </div>
      </aside>
    </div>
  )
}

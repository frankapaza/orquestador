'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, ChevronLeft, ChevronRight, LogOut, Settings, ChevronDown } from 'lucide-react'
import api from '../../lib/api'
import { cn } from '@/lib/utils'
import SidebarContent from '@/components/dashboard/sidebar-content'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// Secciones del menú con soporte de roles
// adminOnly: solo visible para is_admin · memberOnly: solo asesores (member_id)
const MENU_SECTIONS = [
  {
    label: 'General',
    items: [
      { href: '/dashboard', label: 'Resumen', icon: '📊', exact: true },
    ],
  },
  {
    label: 'Comunicaciones',
    items: [
      { href: '/dashboard/inbox',     label: 'Inbox',    icon: '💬' },
      { href: '/dashboard/campaigns', label: 'Campañas', icon: '📨', notRole: 'asesor' },
    ],
  },
  {
    label: 'Mis canales',
    memberOnly: true,
    items: [
      { href: '/dashboard/my-phone', label: 'Mi teléfono', icon: '📱' },
    ],
  },
  {
    label: 'Contactos',
    items: [
      { href: '/dashboard/contacts', label: 'Contactos', icon: '👥' },
    ],
  },
  {
    label: 'Canal Email',
    adminOnly: true,
    items: [
      { href: '/dashboard/domains',      label: 'Dominios',      icon: '🌐' },
      { href: '/dashboard/templates',    label: 'Plantillas',    icon: '📋' },
      { href: '/dashboard/integrations', label: 'Integraciones', icon: '🔌' },
    ],
  },
  {
    label: 'Administración',
    adminOnly: true,
    items: [
      { href: '/dashboard/whatsapp-accounts',     label: 'WhatsApp',      icon: '💚' },
      { href: '/dashboard/assistants',            label: 'Asistentes IA', icon: '🤖' },
      { href: '/dashboard/warmup',                label: 'Calentamiento', icon: '🔥' },
      { href: '/dashboard/sms-accounts',          label: 'SMS',           icon: '📲' },
      { href: '/dashboard/webhook-subscriptions', label: 'Webhooks',      icon: '🔗' },
      { href: '/dashboard/settings',              label: 'Configuración', icon: '⚙️' },
      { href: '/dashboard/reports',               label: 'Reportes',      icon: '📈' },
      { href: '/dashboard/docs',                  label: 'API Docs',      icon: '📖' },
    ],
  },
]

export default function DashboardLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.data)).catch(() => {})
  }, [])

  // Cerrar el drawer móvil al navegar
  useEffect(() => { setMobileOpen(false) }, [pathname])

  function logout() {
    localStorage.removeItem('kubo_token')
    document.cookie = 'kubo_token=; path=/; max-age=0'
    router.push('/login')
  }

  const isAdmin = user?.is_admin
  const isMember = !!user?.member_id
  const memberRole = user?.role ?? null

  const visibleSections = MENU_SECTIONS
    .filter(s => {
      if (s.adminOnly && !isAdmin) return false
      if (s.memberOnly && !isMember) return false
      return true
    })
    .map(s => ({
      ...s,
      items: s.items.filter(item => !(item.notRole && memberRole === item.notRole)),
    }))
    .filter(s => s.items.length > 0)

  function isActive(item) {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + '/')
  }

  const pageTitle =
    visibleSections.flatMap(s => s.items).find(i => isActive(i))?.label ??
    (pathname.startsWith('/admin') ? 'Panel Admin' : 'Dashboard')

  const sidebarProps = { sections: visibleSections, isActive, user, isAdmin, isMember, pathname }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar desktop */}
      <aside
        className={cn(
          'relative hidden shrink-0 border-r border-jungle-green-100 sidebar-transition lg:block',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <SidebarContent {...sidebarProps} collapsed={collapsed} />
        {/* Toggle colapsar (borde) */}
        <button
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          className="absolute -right-3 top-7 z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors hover:text-foreground"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* Drawer móvil */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-0 p-0">
          <SheetTitle className="sr-only">Navegación</SheetTitle>
          <SidebarContent {...sidebarProps} collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Columna principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background px-4 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <Menu size={20} />
          </button>

          <h1 className="truncate text-base font-semibold text-foreground">{pageTitle}</h1>

          <div className="ml-auto flex items-center gap-3">
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold uppercase text-primary-foreground">
                    {user.name?.[0] ?? user.email?.[0] ?? 'U'}
                  </span>
                  <span className="hidden max-w-[140px] truncate font-medium text-foreground sm:block">
                    {user.name ?? user.email}
                  </span>
                  <ChevronDown size={16} className="hidden text-muted-foreground sm:block" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="text-sm font-medium">{user.name ?? 'Usuario'}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings" className="cursor-pointer">
                      <Settings size={16} />
                      Configuración
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} className="cursor-pointer text-red-600 focus:text-red-600">
                    <LogOut size={16} />
                    Cerrar sesión
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {/* Contenido */}
        <main className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-muted/40 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

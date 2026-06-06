'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import api from '../../lib/api'
import {
  LayoutDashboard, MessageSquare, Megaphone, Users, Globe, Puzzle,
  Smartphone, Webhook, Settings, BarChart2, BookOpen, Shield,
  PhoneCall, MessageCircle, ChevronLeft, ChevronRight, LogOut,
  Phone, Mail, FileText, User, Inbox
} from 'lucide-react'

const ICON_MAP = {
  '📊': LayoutDashboard,
  '💬': MessageCircle,
  '📨': Megaphone,
  '📱': Smartphone,
  '👤': User,
  '👥': Users,
  '🌐': Globe,
  '📋': FileText,
  '🔌': Puzzle,
  '💚': PhoneCall,
  '📲': Phone,
  '🔗': Webhook,
  '⚙️': Settings,
  '📈': BarChart2,
  '📖': BookOpen,
  '🛡️': Shield,
  '📧': Mail,
}

// Secciones del menú con soporte de roles
// adminOnly: solo visible para is_admin
// memberOnly: solo visible para asesores (tienen member_id)
// alwaysVisible: visible para todos
const MENU_SECTIONS = [
  {
    label: 'General',
    items: [
      { href: '/dashboard', label: 'Resumen', icon: '📊', exact: true, description: 'Vista general del sistema' },
    ],
  },
  {
    label: 'Comunicaciones',
    items: [
      { href: '/dashboard/inbox',     label: 'Inbox',    icon: '💬', description: 'Conversaciones de WhatsApp y SMS en tiempo real' },
      { href: '/dashboard/campaigns', label: 'Campañas', icon: '📨', description: 'Crear y gestionar envíos masivos', notRole: 'asesor' },
    ],
  },
  {
    label: 'Mis canales',
    memberOnly: true,
    items: [
      { href: '/dashboard/my-phone', label: 'Mi teléfono', icon: '📱', description: 'Conecta tu número de WhatsApp y SMS' },
    ],
  },
  {
    label: 'Contactos',
    items: [
      { href: '/dashboard/contacts', label: 'Contactos', icon: '👥', description: 'Listas de contactos y segmentación' },
    ],
  },
  {
    label: 'Canal Email',
    adminOnly: true,
    items: [
      { href: '/dashboard/domains',      label: 'Dominios',      icon: '🌐', description: 'Gestión de dominios de envío' },
      { href: '/dashboard/templates',    label: 'Plantillas',    icon: '📋', description: 'Plantillas de email reutilizables' },
      { href: '/dashboard/integrations', label: 'Integraciones', icon: '🔌', description: 'SendGrid, Mailchimp, Brevo y más' },
    ],
  },
  {
    label: 'Administración',
    adminOnly: true,
    items: [
      { href: '/dashboard/whatsapp-accounts',      label: 'WhatsApp',         icon: '💚', description: 'Números y conexiones Evolution API' },
      { href: '/dashboard/sms-accounts',           label: 'SMS',              icon: '📲', description: 'Teléfonos Android Gateway' },
      { href: '/dashboard/webhook-subscriptions',  label: 'Webhooks',         icon: '🔗', description: 'Notificaciones hacia CRM externos' },
      { href: '/dashboard/settings',               label: 'Configuración',    icon: '⚙️', description: 'Ajustes generales de la cuenta' },
      { href: '/dashboard/reports',                label: 'Reportes',         icon: '📈', description: 'Estadísticas de envíos' },
      { href: '/dashboard/docs',                   label: 'API Docs',          icon: '📖', description: 'Manual de integración para CRMs externos' },
    ],
  },
]

function NavItem({ item, active }) {
  const [tip, setTip] = useState(null)
  const ref = useRef(null)
  // item.icon puede ser un emoji string o un componente Lucide directamente
  const IconComp = typeof item.icon === 'string' ? (ICON_MAP[item.icon] ?? null) : item.icon

  function handleEnter() {
    if (!item.description) return
    const sidebarRect = ref.current?.closest('aside')?.getBoundingClientRect()
    const itemRect    = ref.current?.getBoundingClientRect()
    if (sidebarRect && itemRect) setTip({ top: itemRect.top, left: sidebarRect.right + 8 })
  }

  return (
    <div ref={ref} onMouseEnter={handleEnter} onMouseLeave={() => setTip(null)}>
      <Link href={item.href}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          active
            ? 'bg-blue-600 text-white'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        }`}>
        {IconComp
          ? <IconComp size={16} strokeWidth={1.75} className="flex-shrink-0" />
          : <span className="text-sm leading-none flex-shrink-0">{item.icon}</span>
        }
        <span className="truncate">{item.label}</span>
      </Link>
      {tip && item.description && (
        <div style={{ position: 'fixed', top: tip.top, left: tip.left }}
          className="z-[200] w-52 bg-gray-950 text-white text-xs rounded-xl px-3 py-2.5 shadow-2xl pointer-events-none border border-gray-700">
          <p className="font-medium text-gray-200 mb-0.5">{item.label}</p>
          <p className="text-gray-400 leading-relaxed">{item.description}</p>
        </div>
      )}
    </div>
  )
}

export default function DashboardLayout({ children }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [user, setUser]         = useState(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.data)).catch(() => {})
  }, [])

  function logout() {
    localStorage.removeItem('kubo_token')
    document.cookie = 'kubo_token=; path=/; max-age=0'
    router.push('/login')
  }

  const isAdmin  = user?.is_admin
  const isMember = !!user?.member_id

  const memberRole = user?.role ?? null

  const visibleSections = MENU_SECTIONS
    .filter(s => {
      if (s.adminOnly  && !isAdmin)  return false
      if (s.memberOnly && !isMember) return false
      return true
    })
    .map(s => ({
      ...s,
      items: s.items.filter(item => {
        // notRole: ocultar si el usuario tiene ese rol
        if (item.notRole && memberRole === item.notRole) return false
        return true
      }),
    }))
    .filter(s => s.items.length > 0)

  function isActive(item) {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(item.href + '/')
  }

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-14' : 'w-60'} bg-gray-900 text-white flex flex-col sidebar-transition flex-shrink-0`}>
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-gray-800">
          {!collapsed && (
            <div>
              <span className="text-base font-bold text-white">Kubo</span>
              <span className="text-base font-bold text-blue-400"> Orquestador</span>
            </div>
          )}
          <button onClick={() => setCollapsed(c => !c)}
            className="text-gray-500 hover:text-white transition-colors ml-auto">
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        {/* Rol badge */}
        {!collapsed && user && (
          <div className="px-4 py-2 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {user.name?.[0]?.toUpperCase() ?? 'U'}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-white truncate">{user.name ?? user.email}</p>
                <p className="text-xs text-gray-500">
                  {isAdmin ? '🔑 Administrador' : isMember ? `👤 ${user.role ?? 'Asesor'}` : 'Owner'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navegación */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {visibleSections.map(section => (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map(item => (
                  <NavItem key={item.href} item={item} active={isActive(item)} />
                ))}
              </div>
            </div>
          ))}

          {/* Admin panel link (siempre al fondo para admins) */}
          {isAdmin && !collapsed && (
            <div>
              <p className="px-3 mb-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">Sistema</p>
              <NavItem
                item={{ href: '/admin', label: 'Panel Admin', icon: Shield, description: 'Gestión de clientes del sistema' }}
                active={pathname.startsWith('/admin')}
              />
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800">
          {!collapsed && user && (
            <p className="text-xs text-gray-500 mb-2 px-1 truncate">{user.email}</p>
          )}
          <button onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
            <LogOut size={14} className="flex-shrink-0" />
          {!collapsed && <span>Cerrar sesión</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-h-0 bg-gray-50">
        {/* Topbar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between flex-shrink-0 z-10">
          <div className="text-sm text-gray-500">
            {visibleSections.flatMap(s => s.items).find(i => isActive(i))?.label ?? 'Dashboard'}
          </div>
          {user && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className={`w-2 h-2 rounded-full ${isAdmin ? 'bg-purple-500' : 'bg-green-500'}`} />
              {isAdmin ? 'Admin' : user.role ?? 'Asesor'}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-6">
          {children}
        </div>
      </main>
    </div>
  )
}

'use client'
import Link from 'next/link'
import {
  Box, LayoutDashboard, MessageCircle, Megaphone, Smartphone, User, Users,
  Globe, FileText, Puzzle, PhoneCall, Phone, Webhook, Settings, BarChart2,
  BookOpen, Mail, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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

function NavLink({ item, active, collapsed, onNavigate }) {
  const Icon = typeof item.icon === 'string' ? ICON_MAP[item.icon] ?? null : item.icon
  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        collapsed && 'justify-center px-0',
        active
          ? 'bg-jungle-green-600 text-white shadow-sm'
          : 'text-jungle-green-900/70 hover:bg-jungle-green-100 hover:text-jungle-green-800',
      )}
    >
      {Icon ? (
        <Icon size={18} strokeWidth={2} className="shrink-0" />
      ) : (
        <span className="shrink-0 text-sm leading-none">{item.icon}</span>
      )}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )

  // Colapsado: solo iconos → tooltip con el nombre al pasar el mouse
  if (!collapsed) return link

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>{item.label}</TooltipContent>
    </Tooltip>
  )
}

export default function SidebarContent({
  sections,
  isActive,
  user,
  isAdmin,
  isMember,
  pathname,
  collapsed = false,
  onNavigate,
}) {
  return (
    <TooltipProvider delayDuration={0}>
    <div className="flex h-full flex-col bg-jungle-green-50">
      {/* Marca */}
      <div className={cn('flex h-16 items-center gap-2.5 border-b border-jungle-green-100 px-4', collapsed && 'justify-center px-0')}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-jungle-green-600 text-white">
          <Box className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="leading-none">
            <span className="text-base font-semibold tracking-tight text-foreground">Kubo</span>
            <span className="ml-1.5 text-xs text-muted-foreground">Orquestador</span>
          </div>
        )}
      </div>

      {/* Navegación */}
      <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {sections.map(section => (
          <div key={section.label}>
            {!collapsed && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-jungle-green-800/50">
                {section.label}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map(item => (
                <NavLink key={item.href} item={item} active={isActive(item)} collapsed={collapsed} onNavigate={onNavigate} />
              ))}
            </div>
          </div>
        ))}

        {isAdmin && (
          <div>
            {!collapsed && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-jungle-green-800/50">
                Sistema
              </p>
            )}
            <NavLink
              item={{ href: '/admin', label: 'Panel Admin', icon: Shield }}
              active={pathname.startsWith('/admin')}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          </div>
        )}
      </nav>

      {/* Identidad del usuario */}
      {user && (
        <div className={cn('border-t border-jungle-green-100 p-3', collapsed && 'flex justify-center')}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-jungle-green-600 text-sm font-semibold uppercase text-white">
              {user.name?.[0] ?? user.email?.[0] ?? 'U'}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{user.name ?? user.email}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {isAdmin ? 'Administrador' : isMember ? user.role ?? 'Asesor' : 'Owner'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}

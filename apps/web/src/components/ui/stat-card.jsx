import Link from 'next/link'
import { cn } from '@/lib/utils'

// Tarjeta de métrica unificada. Diseño cohesivo: card blanca, chip de icono
// con acento (verde por defecto), valor grande, sublínea opcional.
const TONES = {
  green:  'bg-jungle-green-50 text-jungle-green-600',
  blue:   'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  amber:  'bg-amber-50 text-amber-600',
  rose:   'bg-rose-50 text-rose-600',
  slate:  'bg-muted text-muted-foreground',
}

export function StatCard({ icon: Icon, label, value, sub, href, tone = 'green' }) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', TONES[tone] ?? TONES.green)}>
            <Icon size={18} strokeWidth={2} />
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight tabular-nums text-foreground">{value ?? '0'}</p>
      {sub && <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>}
    </>
  )

  const cls = cn(
    'block rounded-xl border bg-card p-5 shadow-sm transition-all',
    href && 'hover:-translate-y-0.5 hover:shadow-md',
  )

  return href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>
}

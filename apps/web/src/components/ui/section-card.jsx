import { cn } from '@/lib/utils'

// Tarjeta de sección con cabecera (título + acción) y cuerpo. Base para
// paneles, tablas y bloques de contenido en todo el dashboard.
export function SectionCard({ title, description, action, children, className, bodyClassName, noPadding }) {
  return (
    <div className={cn('rounded-xl border bg-card shadow-sm', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="truncate text-base font-semibold text-foreground">{title}</h2>}
            {description && <p className="mt-0.5 truncate text-sm text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={cn(!noPadding && 'p-5', bodyClassName)}>{children}</div>
    </div>
  )
}

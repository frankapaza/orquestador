import { cn } from '@/lib/utils'

// Estado vacío consistente: chip de icono, título, descripción y acción opcional.
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {Icon && (
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon size={22} strokeWidth={1.75} />
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

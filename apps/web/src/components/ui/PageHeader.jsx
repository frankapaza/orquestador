export function PageHeader({ icon: Icon, title, description, action }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-jungle-green-50 text-jungle-green-600">
            {typeof Icon === 'string'
              ? <span className="text-xl">{Icon}</span>
              : <Icon size={22} strokeWidth={1.75} />
            }
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

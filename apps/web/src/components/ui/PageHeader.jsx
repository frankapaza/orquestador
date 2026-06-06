export function PageHeader({ icon: Icon, title, description, action }) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            {typeof Icon === 'string'
              ? <span className="text-xl">{Icon}</span>
              : <Icon size={20} strokeWidth={1.75} className="text-blue-600" />
            }
          </div>
        )}
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          {description && <p className="text-sm text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

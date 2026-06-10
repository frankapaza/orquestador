import { cn } from '@/lib/utils'

// Bloque de carga con pulso. Úsalo para construir esqueletos de loading.
export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />
}

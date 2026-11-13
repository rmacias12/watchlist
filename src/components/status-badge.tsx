import { Badge } from '@/components/ui/badge'
import { STATUS_LABELS, type ItemStatus } from '@/lib/types'

const styles: Record<ItemStatus, string> = {
  watching: 'bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30',
  watched: 'bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <Badge variant="outline" className={styles[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

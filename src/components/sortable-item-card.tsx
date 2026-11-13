import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { ItemCard } from '@/components/item-card'
import type { Item } from '@/lib/types'

interface SortableItemCardProps {
  item: Item
  /** 1-based rank in the list's full ordering. */
  rank: number
  /** False when a status filter hides part of the list (reordering disabled). */
  draggable: boolean
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
  /** Moves the item to rank #1 in the list's full ordering. */
  onMoveToTop: (item: Item) => void
}

export function SortableItemCard({
  item,
  rank,
  draggable,
  onEdit,
  onDelete,
  onMoveToTop,
}: SortableItemCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !draggable,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'relative z-10 opacity-60' : undefined}
      data-item-id={item.id}
    >
      <ItemCard
        item={item}
        rank={rank}
        onEdit={onEdit}
        onDelete={onDelete}
        onMoveToTop={onMoveToTop}
        dragHandle={
          draggable ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${item.title}`}
              className="flex h-7 w-6 cursor-grab touch-none items-center justify-center rounded text-muted-foreground active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </button>
          ) : undefined
        }
      />
    </div>
  )
}

import { ArrowUpToLine, Clapperboard, ExternalLink, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/status-badge'
import type { Item } from '@/lib/types'

interface ItemCardProps {
  item: Item
  /** 1-based rank in the list's full ordering. */
  rank: number
  onEdit: (item: Item) => void
  onDelete: (item: Item) => void
  /** Moves the item to rank #1 in the list's full ordering. */
  onMoveToTop: (item: Item) => void
  /** Optional drag handle node, rendered left of the actions menu. */
  dragHandle?: React.ReactNode
}

export function ItemCard({ item, rank, onEdit, onDelete, onMoveToTop, dragHandle }: ItemCardProps) {
  return (
    <Card className="flex-row items-start gap-3 p-3">
      {/* Poster — fixed thumbnail; its height sets the card height */}
      <a
        href={item.url ?? undefined}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={item.url ? 0 : -1}
        aria-hidden={item.url ? undefined : true}
        className="shrink-0"
      >
        <div className="h-24 w-16 overflow-hidden rounded-md bg-muted flex items-center justify-center">
          {item.poster_url ? (
            <img
              src={item.poster_url}
              alt={`${item.title} poster`}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <Clapperboard className="h-7 w-7 text-muted-foreground/50" />
          )}
        </div>
      </a>

      {/* Body — compact rows: title+controls / link+status / notes teaser */}
      <CardContent className="flex min-w-0 flex-1 flex-col gap-1 p-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate font-semibold leading-tight">{item.title}</h3>
          <div className="flex shrink-0 items-center gap-0.5">
            <span className="text-xs font-medium tabular-nums text-muted-foreground/70">
              #{rank}
            </span>
            {dragHandle}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Actions for {item.title}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onMoveToTop(item)}>
                  <ArrowUpToLine className="h-4 w-4" /> Move to top
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(item)}>
                  <Pencil className="h-4 w-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => onDelete(item)}>
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              IMDb
            </a>
          )}
          <StatusBadge status={item.status} />
        </div>

        {item.notes && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{item.notes}</p>
        )}
      </CardContent>
    </Card>
  )
}

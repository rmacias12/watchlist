import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clapperboard, Moon, Plus, Sun } from 'lucide-react'
import { toast, Toaster } from 'sonner'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, rectSortingStrategy, SortableContext } from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { applyTheme, getInitialTheme, type Theme } from '@/lib/theme'
import { STATUS_LABELS, type Item, type ItemStatus, type List } from '@/lib/types'
import { SortableItemCard } from '@/components/sortable-item-card'
import { ItemFormDialog, type ItemFormValues } from '@/components/item-form-dialog'
import { ListSelector } from '@/components/list-selector'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type Filter = 'all' | ItemStatus

function errToast(err: unknown) {
  toast.error(err instanceof Error ? err.message : 'Something went wrong')
}

function App() {
  const [lists, setLists] = useState<List[]>([])
  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [filter, setFilter] = useState<Filter>('watching')
  const [loadingLists, setLoadingLists] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [deletingItem, setDeletingItem] = useState<Item | null>(null)
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  const loadLists = useCallback(async () => {
    try {
      setLists(await api.getLists())
    } catch (err) {
      errToast(err)
    } finally {
      setLoadingLists(false)
    }
  }, [])

  const loadItems = useCallback(async (listId: number) => {
    setLoadingItems(true)
    try {
      setItems(await api.getItems(listId))
    } catch (err) {
      errToast(err)
    } finally {
      setLoadingItems(false)
    }
  }, [])

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  // Keep the selection valid: pick the first list when none is selected or the
  // selected one disappeared (deleted).
  useEffect(() => {
    if (selectedListId !== null && lists.some((l) => l.id === selectedListId)) return
    setSelectedListId(lists.length > 0 ? lists[0].id : null)
  }, [lists, selectedListId])

  useEffect(() => {
    if (selectedListId !== null) void loadItems(selectedListId)
    else setItems([])
  }, [selectedListId, loadItems])

  // ---- List actions ----
  async function handleCreateList(name: string) {
    const created = await api.createList(name)
    setLists((ls) => [...ls, { ...created, item_count: 0 }])
    setSelectedListId(created.id)
    toast.success(`List "${name}" created`)
  }

  async function handleRenameList(id: number, name: string) {
    const updated = await api.renameList(id, name)
    setLists((ls) => ls.map((l) => (l.id === id ? { ...l, name: updated.name } : l)))
    toast.success('List renamed')
  }

  async function handleDeleteList(id: number) {
    try {
      await api.deleteList(id)
      setLists((ls) => ls.filter((l) => l.id !== id))
      toast.success('List deleted')
    } catch (err) {
      errToast(err)
    }
  }

  // ---- Item actions ----
  async function handleSubmitItem(values: ItemFormValues) {
    const payload = {
      title: values.title.trim(),
      url: values.url.trim() || null,
      poster_url: values.poster_url.trim() || null,
      status: values.status,
      notes: values.notes.trim() || null,
    }
    if (editingItem) {
      const updated = await api.updateItem(editingItem.id, payload)
      setItems((its) => its.map((i) => (i.id === updated.id ? updated : i)))
      toast.success('Item updated')
    } else {
      // The dialog can only be opened while a list is selected (Add is disabled otherwise).
      const created = await api.createItem({
        list_id: selectedListId!,
        ...payload,
        tmdb_id: values.tmdb_id,
      })
      setItems((its) => [...its, created])
      setLists((ls) =>
        ls.map((l) => (l.id === selectedListId ? { ...l, item_count: l.item_count + 1 } : l))
      )
      toast.success(`Added "${created.title}"`)
    }
  }

  async function handleDeleteItem(item: Item) {
    try {
      await api.deleteItem(item.id)
      setItems((its) => its.filter((i) => i.id !== item.id))
      setLists((ls) =>
        ls.map((l) =>
          l.id === selectedListId ? { ...l, item_count: Math.max(0, l.item_count - 1) } : l
        )
      )
      setDeletingItem(null)
      toast.success('Item deleted')
    } catch (err) {
      errToast(err)
    }
  }

  const filteredItems = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.status === filter)),
    [items, filter]
  )

  // Rank shown on each card = its position in the VISIBLE (filtered) order,
  // so every tab numbers from #1. In the All view this equals the full list
  // order and still follows live drags.
  const rankById = useMemo(
    () => new Map(filteredItems.map((i, idx) => [i.id, idx + 1])),
    [filteredItems]
  )

  // TMDB ids already in the selected list — the add dialog offers matching
  // search results disabled ("In list"). Derived from the unfiltered `items`.
  const existingTmdbIds = useMemo(
    () => new Set(items.map((i) => i.tmdb_id).filter((id): id is number => id !== null)),
    [items]
  )

  // ---- Drag-to-reorder (works in every filter view) ----
  // Pointer drag for touch/mouse (handle has touch-action:none so the page
  // still scrolls normally); keyboard via the default 25px arrow steps.
  // In filtered views the drop target's FULL-list slot is taken by the
  // dragged item, so hidden items keep their relative positions.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor)
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((i) => i.id === active.id)
      const newIndex = items.findIndex((i) => i.id === over.id)
      const next = arrayMove(items, oldIndex, newIndex)
      setItems(next)
      // The dialog/drag can only run while a list is selected.
      const listId = selectedListId!
      api.reorderItems(listId, next.map((i) => i.id)).catch((err) => {
        errToast(err)
        void loadItems(listId)
      })
    }
  }

  function handleMoveToTop(item: Item) {
    // Works in filtered views too: the order is rebuilt from the FULL item
    // list, so hidden items keep their relative positions.
    const next = [item, ...items.filter((i) => i.id !== item.id)]
    setItems(next)
    // Cards only render while a list is selected.
    const listId = selectedListId!
    api.reorderItems(listId, next.map((i) => i.id)).catch((err) => {
      errToast(err)
      void loadItems(listId)
    })
  }

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: items.length,
      watching: 0,
      watched: 0,
    }
    for (const i of items) c[i.status]++
    return c
  }, [items])

  return (
    <div className="min-h-dvh bg-background">
      <Toaster position="top-center" richColors />

      {/* Sticky mobile-first header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Clapperboard className="h-5 w-5" />
            <h1 className="text-lg font-bold tracking-tight">Watchlist</h1>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                size="sm"
                disabled={selectedListId === null}
                onClick={() => {
                  setEditingItem(null)
                  setFormOpen(true)
                }}
              >
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </div>
          <ListSelector
            lists={lists}
            selectedId={selectedListId}
            onSelect={setSelectedListId}
            onCreate={handleCreateList}
            onRename={handleRenameList}
            onDelete={handleDeleteList}
          />
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((s) => (
                <TabsTrigger key={s} value={s} className="shrink-0">
                  {STATUS_LABELS[s]} ({counts[s]})
                </TabsTrigger>
              ))}
              <TabsTrigger value="all" className="shrink-0">
                All ({counts.all})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-4 pb-24">
        {loadingLists ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
        ) : selectedListId === null ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Clapperboard className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              You don't have any lists yet.
              <br />
              Create one to start tracking movies and shows.
            </p>
          </div>
        ) : loadingItems ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading items…</p>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {items.length === 0
                ? 'Nothing here yet. Tap "Add" to add your first movie or show.'
                : 'No items match this filter.'}
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleDragEnd}>
            <SortableContext items={filteredItems.map((i) => i.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredItems.map((item) => (
                  <SortableItemCard
                    key={item.id}
                    item={item}
                    rank={rankById.get(item.id)!}
                    draggable
                    onEdit={(i) => {
                      setEditingItem(i)
                      setFormOpen(true)
                    }}
                    onDelete={setDeletingItem}
                    onMoveToTop={handleMoveToTop}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

      <ItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editingItem}
        onSubmit={handleSubmitItem}
        existingTmdbIds={existingTmdbIds}
      />

      {deletingItem && (
        <AlertDialog open onOpenChange={() => setDeletingItem(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deletingItem.title}"?</AlertDialogTitle>
              <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void handleDeleteItem(deletingItem)}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}

export default App

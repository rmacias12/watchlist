import { useEffect, useState } from 'react'
import { Check, ChevronDown, ListPlus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import type { List } from '@/lib/types'

interface ListSelectorProps {
  lists: List[]
  selectedId: number | null
  onSelect: (id: number) => void
  onCreate: (name: string) => Promise<void>
  onRename: (id: number, name: string) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

export function ListSelector({
  lists,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ListSelectorProps) {
  const [nameDialogOpen, setNameDialogOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [renamingList, setRenamingList] = useState<List | null>(null)
  const [deletingList, setDeletingList] = useState<List | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = lists.find((l) => l.id === selectedId) ?? null

  useEffect(() => {
    if (nameDialogOpen) {
      setName(renamingList ? renamingList.name : '')
      setError(null)
    }
  }, [nameDialogOpen, renamingList])

  async function submitName(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    setBusy(true)
    setError(null)
    try {
      if (renamingList) {
        await onRename(renamingList.id, trimmed)
      } else {
        await onCreate(trimmed)
      }
      setNameDialogOpen(false)
      setRenamingList(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete(list: List) {
    setBusy(true)
    try {
      await onDelete(list.id)
      setDeletingList(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="min-w-0 flex-1 justify-between px-3 font-medium">
              <span className="truncate">{selected ? selected.name : 'Select a list'}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[50dvh] w-56 overflow-y-auto">
            {lists.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">No lists yet</div>
            )}
            {lists.map((list) => (
              <div key={list.id} className="group relative">
                <DropdownMenuItem
                  onSelect={() => onSelect(list.id)}
                  className="pr-16"
                >
                  <span className="truncate">{list.name}</span>
                  <span className="ml-auto pl-2 text-xs text-muted-foreground">
                    {list.item_count}
                  </span>
                  {list.id === selectedId && <Check className="ml-1 h-4 w-4 shrink-0" />}
                </DropdownMenuItem>
                <div className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-50 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      setRenamingList(list)
                      setNameDialogOpen(true)
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                    <span className="sr-only">Rename {list.name}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive opacity-50 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuOpen(false)
                      setDeletingList(list)
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                    <span className="sr-only">Delete {list.name}</span>
                  </Button>
                </div>
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setRenamingList(null)
                setNameDialogOpen(true)
              }}
            >
              <ListPlus className="h-4 w-4" /> New list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => {
            setRenamingList(null)
            setNameDialogOpen(true)
          }}
        >
          <ListPlus className="h-4 w-4" />
          <span className="sr-only">New list</span>
        </Button>
      </div>

      {/* Create / rename dialog */}
      <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{renamingList ? 'Rename list' : 'New list'}</DialogTitle>
            <DialogDescription>
              {renamingList ? `Rename "${renamingList.name}".` : 'Give your list a name.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitName} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="list-name">Name</Label>
              <Input
                id="list-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sci-Fi Movies"
                autoComplete="off"
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNameDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                {renamingList ? 'Save' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      {deletingList && (
        <AlertDialog open onOpenChange={() => setDeletingList(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deletingList.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the list and its {deletingList.item_count} item(s). This
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void confirmDelete(deletingList)}
                className="bg-destructive text-white hover:bg-destructive/90"
                disabled={busy}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}

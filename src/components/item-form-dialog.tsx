import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { STATUS_LABELS, type Item, type ItemStatus, type TMDBSearchResult } from '@/lib/types'

export interface ItemFormValues {
  title: string
  url: string
  poster_url: string
  /** Set when the form was filled from a TMDB search result; null for manual entries. */
  tmdb_id: number | null
  status: ItemStatus
  notes: string
}

interface ItemFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = add mode, Item = edit mode */
  editing: Item | null
  onSubmit: (values: ItemFormValues) => Promise<void>
  /** TMDB ids already present in the target list — matching results are offered disabled. */
  existingTmdbIds: ReadonlySet<number>
}

const emptyForm: ItemFormValues = {
  title: '',
  url: '',
  poster_url: '',
  tmdb_id: null,
  status: 'watching',
  notes: '',
}

export function ItemFormDialog({
  open,
  onOpenChange,
  editing,
  onSubmit,
  existingTmdbIds,
}: ItemFormDialogProps) {
  const [form, setForm] = useState<ItemFormValues>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // TMDB search state
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<TMDBSearchResult[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              title: editing.title,
              url: editing.url ?? '',
              poster_url: editing.poster_url ?? '',
              tmdb_id: editing.tmdb_id,
              status: editing.status,
              notes: editing.notes ?? '',
            }
          : emptyForm
      )
      setError(null)
      setQuery('')
      setResults(null)
      setSearchError(null)
      setSearching(false)
    }
  }, [open, editing])

  // Debounced TMDB search
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setSearchError(null)
      setSearching(false)
      return
    }
    setSearching(true)
    setResults(null)
    const t = setTimeout(() => {
      api
        .searchMedia(q)
        .then((r) => {
          setResults(r)
          setSearchError(null)
        })
        .catch((err) => {
          setResults(null)
          setSearchError(err instanceof Error ? err.message : 'Search failed')
        })
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  async function pickResult(r: TMDBSearchResult) {
    setForm((f) => ({
      ...f,
      title: r.title,
      poster_url: r.poster_url ?? '',
      tmdb_id: r.tmdb_id,
    }))
    try {
      const d = await api.searchDetail(r.media_type, r.tmdb_id)
      setForm((f) => ({ ...f, url: d.url }))
    } catch {
      // Detail lookup failed — fall back to the TMDB page link.
      setForm((f) => ({ ...f, url: `https://www.themoviedb.org/${r.media_type}/${r.tmdb_id}` }))
    }
    setQuery('')
    setResults(null)
  }

  const set = (patch: Partial<ItemFormValues>) => setForm((f) => ({ ...f, ...patch }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('Title is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSubmit(form)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit item' : 'Add movie or show'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Update the details for this item.'
              : 'Search TMDB to auto-fill, or enter everything manually.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="grid gap-2 rounded-lg border p-3">
            <Label htmlFor="tmdb-search">Search TMDB</Label>
            <Input
              id="tmdb-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a title to auto-fill…"
              autoComplete="off"
            />
            {searching && <p className="text-sm text-muted-foreground">Searching…</p>}
            {searchError && <p className="text-sm text-destructive">{searchError}</p>}
            {results && results.length === 0 && (
              <p className="text-sm text-muted-foreground">No matches.</p>
            )}
            {results && results.length > 0 && (
              <ul className="grid max-h-56 gap-1 overflow-y-auto">
                {results.map((r) => {
                  const inList = existingTmdbIds.has(r.tmdb_id)
                  return (
                    <li key={`${r.media_type}-${r.tmdb_id}`}>
                      <button
                        type="button"
                        onClick={() => pickResult(r)}
                        disabled={inList}
                        className={
                          'flex w-full items-center gap-3 rounded-md p-2 text-left' +
                          (inList ? ' cursor-not-allowed opacity-50' : ' hover:bg-accent')
                        }
                      >
                        {r.poster_url ? (
                          <img
                            src={r.poster_url}
                            alt={r.title + ' poster'}
                            className="h-14 w-10 rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-10 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                            No poster
                          </div>
                        )}
                        <span className="grid flex-1 gap-0.5">
                          <span className="text-sm font-medium">{r.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {r.year ?? '—'} · {r.media_type === 'movie' ? 'Movie' : 'TV'}
                          </span>
                        </span>
                        {inList && (
                          <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                            In list
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="text-[10px] leading-tight text-muted-foreground">
              This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="e.g. The Matrix"
              autoComplete="off"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="url">IMDb / website link</Label>
            <Input
              id="url"
              type="url"
              inputMode="url"
              value={form.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://www.imdb.com/title/tt0133093/"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="poster">Poster image URL</Label>
            <Input
              id="poster"
              type="url"
              inputMode="url"
              value={form.poster_url}
              onChange={(e) => set({ poster_url: e.target.value })}
              placeholder="https://…/poster.jpg (optional)"
            />
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => set({ status: v as ItemStatus })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as ItemStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Season 2 starts where…"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

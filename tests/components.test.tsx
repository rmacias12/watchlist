import { describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'
import { ItemFormDialog, type ItemFormValues } from '@/components/item-form-dialog'
import { ListSelector } from '@/components/list-selector'
import { SortableItemCard } from '@/components/sortable-item-card'
import { cn } from '@/lib/utils'
import type { Item, List } from '@/lib/types'
import { makeDb, mockFetch } from './helpers'

afterEach(cleanup)

const fullItem: Item = {
  id: 1,
  list_id: 1,
  title: 'Full Item',
  url: 'https://imdb/full',
  poster_url: 'https://img/full.jpg',
  tmdb_id: 4242,
  status: 'watching',
  notes: 'has everything',
  position: 1,
  created_at: '',
  updated_at: '',
}

const twoLists: List[] = [
  { id: 1, name: 'One', item_count: 3, created_at: '' },
  { id: 2, name: 'Two', item_count: 0, created_at: '' },
]

describe('cn()', () => {
  it('merges class names with tailwind-merge semantics', () => {
    expect(cn('p-1', 'p-2')).toBe('p-2')
    expect(cn('a', undefined, 'b')).toBe('a b')
  })
})

describe('ItemFormDialog', () => {
  it('prefills all fields when editing a fully populated item', () => {
    render(
      <ItemFormDialog open onOpenChange={() => {}} editing={fullItem} onSubmit={async () => {}} existingTmdbIds={new Set()} />
    )
    expect(screen.getByLabelText(/Title/)).toHaveValue('Full Item')
    expect(screen.getByLabelText(/IMDb/)).toHaveValue('https://imdb/full')
    expect(screen.getByLabelText(/Poster/)).toHaveValue('https://img/full.jpg')
    expect(screen.getByLabelText('Notes')).toHaveValue('has everything')
    expect(screen.getByRole('combobox')).toHaveTextContent('Watching')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy()
  })

  it('prefills empty strings for null optional fields when editing', () => {
    const bare: Item = { ...fullItem, id: 2, url: null, poster_url: null, notes: null }
    render(
      <ItemFormDialog open onOpenChange={() => {}} editing={bare} onSubmit={async () => {}} existingTmdbIds={new Set()} />
    )
    expect(screen.getByLabelText(/IMDb/)).toHaveValue('')
    expect(screen.getByLabelText(/Poster/)).toHaveValue('')
    expect(screen.getByLabelText('Notes')).toHaveValue('')
  })

  it('shows Saving… and disables submit while onSubmit is pending', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    let resolveSubmit!: (v: void) => void
    const onSubmit = vi.fn(
      (_v: ItemFormValues) =>
        new Promise<void>((r) => {
          resolveSubmit = r
        })
    )
    render(<ItemFormDialog open onOpenChange={() => {}} editing={null} onSubmit={onSubmit} existingTmdbIds={new Set()} />)
    await user.type(screen.getByLabelText(/Title/), 'Pending')
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    const saving = await screen.findByRole('button', { name: 'Saving…' })
    expect(saving).toHaveProperty('disabled', true)
    resolveSubmit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  })

  it('shows a generic error when onSubmit rejects with a non-Error', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onSubmit = vi.fn(async () => {
      throw 'plain string'
    })
    render(<ItemFormDialog open onOpenChange={() => {}} editing={null} onSubmit={onSubmit} existingTmdbIds={new Set()} />)
    await user.type(screen.getByLabelText(/Title/), 'Boom')
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
  })

  it("carries the item's tmdb_id when editing", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onSubmit = vi.fn(async () => {})
    render(
      <ItemFormDialog open onOpenChange={() => {}} editing={fullItem} onSubmit={onSubmit} existingTmdbIds={new Set()} />
    )
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tmdb_id: 4242 }))
    )
  })

  it('submits tmdb_id null for manual entries', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onSubmit = vi.fn(async () => {})
    render(
      <ItemFormDialog open onOpenChange={() => {}} editing={null} onSubmit={onSubmit} existingTmdbIds={new Set()} />
    )
    await user.type(screen.getByLabelText(/Title/), 'Hand typed')
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tmdb_id: null }))
    )
  })
})

describe('ListSelector', () => {
  const noop = async () => {}

  it('shows "Select a list" and an empty dropdown when there are no lists', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <ListSelector
        lists={[]}
        selectedId={null}
        onSelect={() => {}}
        onCreate={noop}
        onRename={noop}
        onDelete={noop}
      />
    )
    expect(screen.getByText('Select a list')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Select a list/ }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('No lists yet')).toBeTruthy()
  })

  it('disables submit while the name is blank', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <ListSelector
        lists={twoLists}
        selectedId={1}
        onSelect={() => {}}
        onCreate={noop}
        onRename={noop}
        onDelete={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: 'New list' }))
    const create = await screen.findByRole('button', { name: 'Create' })
    expect(create).toHaveProperty('disabled', true)
  })

  it('disables submit while onCreate is pending (busy)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    let resolveCreate!: (v: void) => void
    const onCreate = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolveCreate = r
        })
    )
    render(
      <ListSelector
        lists={twoLists}
        selectedId={1}
        onSelect={() => {}}
        onCreate={onCreate}
        onRename={noop}
        onDelete={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: 'New list' }))
    await user.type(await screen.findByLabelText('Name'), 'Slow')
    const create = screen.getByRole('button', { name: 'Create' })
    await user.click(create)
    await waitFor(() => expect(create).toHaveProperty('disabled', true))
    resolveCreate()
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Slow'))
  })

  it('opens the create dialog from the dropdown menu item too', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <ListSelector
        lists={twoLists}
        selectedId={1}
        onSelect={() => {}}
        onCreate={noop}
        onRename={noop}
        onDelete={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /One/ }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /New list/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('New list')
    expect(screen.getByLabelText('Name')).toHaveValue('')
    // The flyout autoclosed when the dialog opened.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('closes the dropdown after selecting a list', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onSelect = vi.fn()
    render(
      <ListSelector
        lists={twoLists}
        selectedId={1}
        onSelect={onSelect}
        onCreate={noop}
        onRename={noop}
        onDelete={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /One/ }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /Two/ }))
    expect(onSelect).toHaveBeenCalledWith(2)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('rename failure surfaces a non-Error message', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const onRename = vi.fn(async () => {
      throw 'plain string failure'
    })
    render(
      <ListSelector
        lists={twoLists}
        selectedId={1}
        onSelect={() => {}}
        onCreate={noop}
        onRename={onRename}
        onDelete={noop}
      />
    )
    await user.click(screen.getByRole('button', { name: /One/ }))
    await user.click(await screen.findByRole('button', { name: 'Rename One' }))
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
  })
})

describe('SortableItemCard', () => {
  it('renders the card with rank and a drag handle when draggable', () => {
    const onEdit = vi.fn()
    render(
      <SortableItemCard
        item={fullItem}
        rank={3}
        draggable
        onEdit={onEdit}
        onDelete={() => {}}
        onMoveToTop={() => {}}
      />
    )
    const handle = screen.getByRole('button', { name: 'Reorder Full Item' })
    expect(handle).toBeTruthy()
    expect(screen.getByText('#3')).toBeTruthy()
    expect(document.querySelector('[data-item-id="1"]')).toBeTruthy()
    // Card content still renders
    expect(screen.getByText('Full Item')).toBeTruthy()
  })

  it('omits the drag handle when not draggable', () => {
    render(
      <SortableItemCard
        item={fullItem}
        rank={1}
        draggable={false}
        onEdit={() => {}}
        onDelete={() => {}}
        onMoveToTop={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: /Reorder/ })).toBeNull()
    expect(screen.getByText('#1')).toBeTruthy()
    expect(screen.getByText('Full Item')).toBeTruthy()
  })

  it('offers "Move to top" in the actions menu', async () => {
    const onMoveToTop = vi.fn()
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <SortableItemCard
        item={fullItem}
        rank={3}
        draggable
        onEdit={() => {}}
        onDelete={() => {}}
        onMoveToTop={onMoveToTop}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Actions for Full Item' }))
    await user.click(await screen.findByRole('menuitem', { name: /Move to top/ }))
    expect(onMoveToTop).toHaveBeenCalledWith(fullItem)
  })
})

describe('ItemFormDialog — TMDB search', () => {
  const matrix = {
    tmdb_id: 603,
    media_type: 'movie' as const,
    title: 'The Matrix',
    year: '1999',
    poster_url: 'https://image.tmdb.org/t/p/w500/p.jpg',
    overview: null,
  }
  const got = {
    tmdb_id: 1399,
    media_type: 'tv' as const,
    title: 'Game of Thrones',
    year: null,
    poster_url: null,
    overview: null,
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderDialog(db: ReturnType<typeof makeDb>) {
    mockFetch(db)
    return render(
      <ItemFormDialog open onOpenChange={() => {}} editing={null} onSubmit={async () => {}} existingTmdbIds={new Set()} />
    )
  }

  it('does not search until the query has 2+ characters', async () => {
    const db = makeDb()
    db.tmdb = { results: [matrix] }
    const fetchMock = mockFetch(db)
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <ItemFormDialog open onOpenChange={() => {}} editing={null} onSubmit={async () => {}} existingTmdbIds={new Set()} />
    )
    await user.type(screen.getByLabelText('Search TMDB'), 'm')
    await new Promise((r) => setTimeout(r, 400))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('Searching…')).toBeNull()
  })

  it('shows Searching… then results with poster, type and year', async () => {
    const db = makeDb()
    db.tmdb = { results: [matrix, got] }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog(db)
    await user.type(screen.getByLabelText('Search TMDB'), 'ma')
    expect(screen.getByText('Searching…')).toBeTruthy()
    expect(await screen.findByText('The Matrix')).toBeTruthy()
    expect(screen.queryByText('Searching…')).toBeNull()
    expect(screen.getByText('1999 · Movie')).toBeTruthy()
    expect(screen.getByText('— · TV')).toBeTruthy()
    expect(screen.getByRole('img')).toBeTruthy()
    expect(screen.getByText('No poster')).toBeTruthy()
    expect(screen.getByText(/not endorsed or certified by TMDB/)).toBeTruthy()
  })

  it('shows "No matches." when results are empty', async () => {
    const db = makeDb()
    db.tmdb = { results: [] }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog(db)
    await user.type(screen.getByLabelText('Search TMDB'), 'zz')
    expect(await screen.findByText('No matches.')).toBeTruthy()
  })

  it('shows the API error when TMDB is not configured', async () => {
    const db = makeDb() // db.tmdb undefined -> 503
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog(db)
    await user.type(screen.getByLabelText('Search TMDB'), 'ma')
    expect(await screen.findByText('TMDB search is not configured')).toBeTruthy()
  })

  it('shows "Search failed" when the request rejects with a non-Error', async () => {
    const db = makeDb()
    db.tmdb = { results: [matrix] }
    db.rejectNext = { url: '/api/search', error: 'socket gone' }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog(db)
    await user.type(screen.getByLabelText('Search TMDB'), 'ma')
    expect(await screen.findByText('Search failed')).toBeTruthy()
  })

  it('picking a result fills title, poster and IMDb url, then clears search', async () => {
    const db = makeDb()
    db.tmdb = {
      results: [matrix],
      detail: {
        url: 'https://www.imdb.com/title/tt0133093/',
        imdb_url: 'https://www.imdb.com/title/tt0133093/',
        tmdb_url: 'https://www.themoviedb.org/movie/603',
      },
    }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog(db)
    await user.type(screen.getByLabelText('Search TMDB'), 'matrix')
    await user.click(await screen.findByRole('button', { name: /The Matrix/ }))
    expect(screen.getByLabelText(/Title/)).toHaveValue('The Matrix')
    expect(screen.getByLabelText(/Poster/)).toHaveValue('https://image.tmdb.org/t/p/w500/p.jpg')
    await waitFor(() =>
      expect(screen.getByLabelText(/IMDb/)).toHaveValue('https://www.imdb.com/title/tt0133093/')
    )
    expect(screen.getByLabelText('Search TMDB')).toHaveValue('')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('falls back to the TMDB url when the detail lookup fails', async () => {
    const db = makeDb()
    db.tmdb = { results: [got], detailFail: true }
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    renderDialog(db)
    await user.type(screen.getByLabelText('Search TMDB'), 'game')
    await user.click(await screen.findByRole('button', { name: /Game of Thrones/ }))
    expect(screen.getByLabelText(/Title/)).toHaveValue('Game of Thrones')
    expect(screen.getByLabelText(/Poster/)).toHaveValue('')
    await waitFor(() =>
      expect(screen.getByLabelText(/IMDb/)).toHaveValue('https://www.themoviedb.org/tv/1399')
    )
  })

  it('disables results already in the list with an "In list" pill', async () => {
    const db = makeDb()
    db.tmdb = { results: [matrix, got] }
    mockFetch(db)
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <ItemFormDialog
        open
        onOpenChange={() => {}}
        editing={null}
        onSubmit={async () => {}}
        existingTmdbIds={new Set([603])}
      />
    )
    await user.type(screen.getByLabelText('Search TMDB'), 'matrix')
    const dupe = await screen.findByRole('button', { name: /The Matrix/ })
    expect(dupe).toHaveProperty('disabled', true)
    expect(screen.getByText('In list')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Game of Thrones/ })).toHaveProperty(
      'disabled',
      false
    )
  })

  it('picking a result carries its tmdb_id into the submitted values', async () => {
    const db = makeDb()
    db.tmdb = { results: [matrix] }
    mockFetch(db)
    const onSubmit = vi.fn(async () => {})
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    render(
      <ItemFormDialog
        open
        onOpenChange={() => {}}
        editing={null}
        onSubmit={onSubmit}
        existingTmdbIds={new Set()}
      />
    )
    await user.type(screen.getByLabelText('Search TMDB'), 'matrix')
    await user.click(await screen.findByRole('button', { name: /The Matrix/ }))
    await waitFor(() =>
      expect(screen.getByLabelText(/IMDb/)).toHaveValue('https://www.imdb.com/title/tt0000603/')
    )
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ tmdb_id: 603 }))
    )
  })
})

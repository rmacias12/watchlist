import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import App from '@/App'
import { flush, item, list, makeDb, mockFetch, type MockDb } from './helpers'

let db: MockDb

// Sonner keeps a global toast store that survives cleanup(); stale toasts
// would remount into the next test's <Toaster> and pollute text queries.
function clearToasts() {
  toast.dismiss()
}

function seedStandard() {
  db = makeDb()
  list(db, { id: 1, name: 'Sci-Fi' })
  list(db, { id: 2, name: 'Comedy' })
  item(db, {
    id: 10,
    list_id: 1,
    title: 'The Matrix',
    status: 'watched',
    url: 'https://imdb/x',
    tmdb_id: 603,
  })
  item(db, { id: 11, list_id: 1, title: 'Dune', status: 'watching', notes: 'part two next' })
  item(db, { id: 12, list_id: 1, title: 'Arrival', status: 'watching' })
  item(db, { id: 20, list_id: 2, title: 'Groundhog Day', status: 'watching' })
  mockFetch(db)
}

beforeEach(() => {
  clearToasts()
  seedStandard()
})

afterEach(() => {
  clearToasts()
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

async function renderApp() {
  render(<App />)
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
  await flush()
}

describe('App — initial load', () => {
  it('renders lists, items, and counts', async () => {
    render(<App />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
    await flush()
    expect(screen.getByRole('button', { name: /Sci-Fi/ })).toBeTruthy()
    // Default filter is Watching: the watched Matrix stays hidden.
    for (const t of ['Dune', 'Arrival']) {
      expect(screen.getByText(t)).toBeTruthy()
    }
    expect(screen.queryByText('The Matrix')).toBeNull()
    // Tab order: Watching, Watched, All.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Watching (2)',
      'Watched (1)',
      'All (3)',
    ])
    expect(screen.queryByRole('tab', { name: /Want to watch/ })).toBeNull()
  })

  it('shows empty state when no lists exist', async () => {
    db = makeDb()
    mockFetch(db)
    await renderApp()
    expect(screen.getByText(/You don't have any lists yet/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Add/ })).toHaveProperty('disabled', true)
  })

  it('toasts a message when list loading fails with an Error', async () => {
    db = makeDb()
    db.rejectNext = { url: '/api/lists', error: new Error('kaboom') }
    mockFetch(db)
    await renderApp()
    expect(await screen.findByText('kaboom')).toBeTruthy()
  })

  it('toasts a generic message when list loading fails with a non-Error', async () => {
    db = makeDb()
    db.rejectNext = { url: '/api/lists', error: 'weird failure' }
    mockFetch(db)
    await renderApp()
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
  })

  it('toasts when item loading fails', async () => {
    db = makeDb()
    list(db, { id: 1, name: 'L' })
    db.rejectNext = { url: '/api/items', error: new Error('items down') }
    mockFetch(db)
    await renderApp()
    expect(await screen.findByText('items down')).toBeTruthy()
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy()
  })

  it('shows the loading-items state while items are in flight', async () => {
    db = makeDb()
    list(db, { id: 1, name: 'L' })
    // Custom fetch: lists resolve instantly, items hang until released.
    let releaseItems!: (r: Response) => void
    const hanging = new Promise<Response>((r) => {
      releaseItems = r
    })
    const realMock = mockFetch(db)
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const p = realMock(input, init)
        if (String(input).includes('/api/items')) return hanging
        return p
      })
    )
    render(<App />)
    expect(await screen.findByText('Loading items…')).toBeTruthy()
    releaseItems(
      new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } })
    )
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy()
  })
})

describe('App — list management', () => {
  it('creates a list and switches to it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'New list' }))
    await user.type(screen.getByLabelText('Name'), 'Horror')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('List "Horror" created')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Horror/ })).toBeTruthy()
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy()
  })

  it('surfaces create errors inside the dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db.failNext = { method: 'POST', url: '/api/lists', status: 500, body: { error: 'no db' } }
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'New list' }))
    await user.type(screen.getByLabelText('Name'), 'Fail')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('no db')).toBeTruthy()
    // dialog stays open; close via Cancel
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull())
  })

  it('renames a list from the dropdown', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Sci-Fi/ }))
    await user.click(await screen.findByRole('button', { name: 'Rename Sci-Fi' }))
    const input = await screen.findByLabelText('Name')
    expect(input).toHaveValue('Sci-Fi')
    await user.clear(input)
    await user.type(input, 'Space Epics')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('List renamed')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Space Epics/ })).toBeTruthy()
  })

  it('switches lists from the dropdown', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Sci-Fi/ }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /Comedy/ }))
    await flush()
    expect(await screen.findByText('Groundhog Day')).toBeTruthy()
    expect(screen.queryByText('The Matrix')).toBeNull()
  })

  it('deletes the selected list and falls back to the next one', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Sci-Fi/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete Sci-Fi' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('3 item(s)')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('List deleted')).toBeTruthy()
    await flush()
    expect(screen.getByRole('button', { name: /Comedy/ })).toBeTruthy()
    expect(await screen.findByText('Groundhog Day')).toBeTruthy()
  })

  it('deleting a non-selected list keeps the selection', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Sci-Fi/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete Comedy' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    // now actually delete it
    await user.click(screen.getByRole('button', { name: /Sci-Fi/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete Comedy' }))
    const dialog2 = await screen.findByRole('alertdialog')
    await user.click(within(dialog2).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('List deleted')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Sci-Fi/ })).toBeTruthy()
  })

  it('deleting the last list returns to the no-lists empty state', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db = makeDb()
    list(db, { id: 1, name: 'Only' })
    mockFetch(db)
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Only/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete Only' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/You don't have any lists yet/)).toBeTruthy()
  })

  it('toasts when list deletion fails', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db.failNext = { method: 'DELETE', status: 500, body: { error: 'delete failed' } }
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Sci-Fi/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete Sci-Fi' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('delete failed')).toBeTruthy()
  })
})

describe('App — item management', () => {
  it('adds an item via the dialog', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Add/ }))
    await user.type(screen.getByLabelText(/Title/), 'Interstellar')
    await user.type(screen.getByLabelText(/IMDb/), 'https://www.imdb.com/title/tt0816692/')
    await user.type(screen.getByLabelText(/Poster/), 'https://img.example/p.jpg')
    await user.type(screen.getByLabelText('Notes'), 'nope')
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Watching' }))
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByText('Added "Interstellar"')).toBeTruthy()
    expect(screen.getByText('Interstellar')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'All (4)' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Watching (3)' })).toBeTruthy()
    // New items append to the END of the list, not the top.
    const cards = [...document.querySelectorAll('[data-item-id]')]
    expect(cards[cards.length - 1].textContent).toContain('Interstellar')
  })

  it('adds an item via TMDB search end-to-end, disabling results already in the list', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db.tmdb = {
      results: [
        {
          tmdb_id: 603,
          media_type: 'movie',
          title: 'The Matrix (1999)',
          year: '1999',
          poster_url: 'https://image.tmdb.org/t/p/w500/p.jpg',
          overview: null,
        },
        {
          tmdb_id: 624860,
          media_type: 'movie',
          title: 'The Matrix Resurrections',
          year: '2021',
          poster_url: null,
          overview: null,
        },
      ],
    }
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Add/ }))
    await user.type(screen.getByLabelText('Search TMDB'), 'matrix')
    // The seeded Matrix (tmdb_id 603) is offered disabled with an "In list" pill.
    const dupe = await screen.findByRole('button', { name: /The Matrix \(1999\)/ })
    expect(dupe).toHaveProperty('disabled', true)
    expect(screen.getByText('In list')).toBeTruthy()
    // A different title from the same franchise stays pickable.
    await user.click(screen.getByRole('button', { name: /The Matrix Resurrections/ }))
    expect(screen.getByLabelText(/Title/)).toHaveValue('The Matrix Resurrections')
    expect(screen.getByLabelText(/IMDb/)).toHaveValue('https://www.imdb.com/title/tt0000624860/')
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByText('Added "The Matrix Resurrections"')).toBeTruthy()
    // The POST carried the picked result's tmdb_id (the mock API stored it).
    const created = db.items.find((i) => i.title === 'The Matrix Resurrections')
    expect(created?.tmdb_id).toBe(624860)
  })

  it('shows validation error for blank title', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Add/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Add item' }))
    expect(await screen.findByText('Title is required.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
  })

  it('shows submit errors from the API', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db.failNext = { method: 'POST', url: '/api/items', status: 400, body: { error: 'bad item' } }
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Add/ }))
    await user.type(screen.getByLabelText(/Title/), 'X')
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByText('bad item')).toBeTruthy()
  })

  it('shows a generic submit error for non-Error rejections', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db.rejectNext = { method: 'POST', url: '/api/items', error: 'weird' }
    await renderApp()
    await user.click(screen.getByRole('button', { name: /Add/ }))
    await user.type(screen.getByLabelText(/Title/), 'X')
    await user.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
  })

  it('edits an item', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Actions for Dune' }))
    await user.click(await screen.findByRole('menuitem', { name: /Edit/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText(/Title/)).toHaveValue('Dune')
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('part two next')
    await user.clear(within(dialog).getByLabelText('Notes'))
    await user.click(within(dialog).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Watched' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Item updated')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Watched (2)' })).toBeTruthy()
  })

  it('moves an item to the top via the actions menu', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    // Seed order: The Matrix (10), Dune (11), Arrival (12).
    await user.click(screen.getByRole('button', { name: 'Actions for Dune' }))
    await user.click(await screen.findByRole('menuitem', { name: /Move to top/ }))
    await flush()
    const cards = [...document.querySelectorAll('[data-item-id]')]
    expect(cards[0].getAttribute('data-item-id')).toBe('11')
    expect(within(cards[0] as HTMLElement).getByText('#1')).toBeTruthy()
    // Persisted through the reorder endpoint (the mock db now sorts by position).
    expect(
      db.items
        .filter((i) => i.list_id === 1)
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((i) => i.id)
    ).toEqual([11, 10, 12])
  })

  it('toasts and reloads server order when move-to-top persistence fails', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db.failNext = {
      method: 'POST',
      url: '/api/items/reorder',
      status: 500,
      body: { error: 'reorder boom' },
    }
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Actions for Dune' }))
    await user.click(await screen.findByRole('menuitem', { name: /Move to top/ }))
    expect(await screen.findByText('reorder boom')).toBeTruthy()
    await flush()
    // Optimistic move was rolled back by the reload — in the default Watching
    // view Dune (11) leads again (the watched Matrix stays hidden).
    const cards = [...document.querySelectorAll('[data-item-id]')]
    expect(cards[0].getAttribute('data-item-id')).toBe('11')
  })

  it('deletes an item with confirmation', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Actions for Arrival' }))
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Delete "Arrival"?')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Item deleted')).toBeTruthy()
    expect(screen.queryByText('Arrival')).toBeNull()
    expect(screen.getByRole('tab', { name: 'All (2)' })).toBeTruthy()
  })

  it('cancels item deletion', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Actions for Arrival' }))
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText('Arrival')).toBeTruthy()
  })

  it('toasts when item deletion fails', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db.failNext = { method: 'DELETE', status: 500, body: { error: 'cannot delete' } }
    await renderApp()
    await user.click(screen.getByRole('button', { name: 'Actions for Arrival' }))
    await user.click(await screen.findByRole('menuitem', { name: /Delete/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('cannot delete')).toBeTruthy()
  })
})

describe('App — filters', () => {
  it('filters by status and shows the no-match message', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    await user.click(screen.getByRole('tab', { name: 'Watched (1)' }))
    expect(screen.getByText('The Matrix')).toBeTruthy()
    expect(screen.queryByText('Dune')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Watching (2)' }))
    expect(screen.getByText('Dune')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'All (3)' }))
    expect(screen.getByText('Arrival')).toBeTruthy()
  })

  it('shows no-match message for an empty status tab', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db = makeDb()
    list(db, { id: 1, name: 'L' })
    item(db, { id: 1, list_id: 1, title: 'Only Watched', status: 'watched' })
    mockFetch(db)
    await renderApp()
    await user.click(screen.getByRole('tab', { name: 'Watching (0)' }))
    expect(screen.getByText('No items match this filter.')).toBeTruthy()
  })
})

describe('App — dark mode', () => {
  it('toggles the theme and persists the choice', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await renderApp()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('mq_theme')).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('mq_theme')).toBe('light')
  })

  it('restores a stored dark theme on load', async () => {
    localStorage.setItem('mq_theme', 'dark')
    await renderApp()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy()
  })
})

describe('App — session expiry', () => {
  it('reloads the page on a 401 from the API', async () => {
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })
    db = makeDb()
    list(db, { id: 1, name: 'L' })
    db.failNext = { method: 'GET', url: '/api/items', status: 401, body: { error: 'unauthorized' } }
    mockFetch(db)
    await renderApp()
    expect(reload).toHaveBeenCalled()
    expect(window.location).toBeDefined()
  })
})

describe('App — drag to reorder', () => {
  // jsdom has no layout: give each sortable card a synthetic 300x90 rect,
  // stacked 100px apart in DOM order, so dnd-kit collision math works.
  function mockItemRects() {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const node = this.closest('[data-item-id]')
      const all = Array.from(document.querySelectorAll('[data-item-id]'))
      const idx = node ? all.indexOf(node) : -1
      const top = idx >= 0 ? idx * 100 : 0
      return {
        x: 10,
        y: top,
        width: 300,
        height: idx >= 0 ? 90 : 768,
        top,
        left: 10,
        right: 310,
        bottom: top + (idx >= 0 ? 90 : 768),
        toJSON: () => ({}),
      } as DOMRect
    })
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
  }

  // user-event prevents the default on Space keydown for buttons, which stops
  // dnd-kit's KeyboardSensor from activating — dispatch raw key events instead.
  function pressKey(target: Element, code: string) {
    const keys: Record<string, [string, number]> = {
      Space: [' ', 32],
      Enter: ['Enter', 13],
      ArrowDown: ['ArrowDown', 40],
      ArrowUp: ['ArrowUp', 38],
    }
    const [key, keyCode] = keys[code]!
    fireEvent.keyDown(target, { code, key, keyCode, which: keyCode, bubbles: true })
  }

  async function pressKeys(target: Element, code: string, times: number) {
    for (let i = 0; i < times; i++) {
      pressKey(target, code)
      await flush(1)
    }
  }

  function seedQueue() {
    db = makeDb()
    list(db, { id: 1, name: 'Queue' })
    item(db, { id: 10, list_id: 1, title: 'Alpha' })
    item(db, { id: 11, list_id: 1, title: 'Bravo' })
    item(db, { id: 12, list_id: 1, title: 'Charlie' })
    return mockFetch(db)
  }

  function cardTitles() {
    return Array.from(document.querySelectorAll('[data-item-id] h3')).map((h) => h.textContent)
  }

  function cardRanks() {
    return Array.from(document.querySelectorAll('[data-item-id] span.tabular-nums')).map(
      (s) => s.textContent
    )
  }

  function reorderCall(fetchMock: ReturnType<typeof mockFetch>) {
    return fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/items/reorder'))
  }

  it('reorders with a keyboard drag and persists the new order', async () => {
    const fetchMock = seedQueue()
    mockItemRects()
    await renderApp()
    // Drag handles only exist in the All view, which is no longer the default.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await user.click(screen.getByRole('tab', { name: 'All (3)' }))
    await flush()
    expect(cardTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])

    const handle = screen.getByRole('button', { name: 'Reorder Alpha' })
    handle.focus()
    pressKey(handle, 'Space') // pick up
    await flush(2)
    expect(document.querySelector('[data-item-id="10"]')!.className).toContain('opacity-60')
    // Default keyboard coordinate getter moves 25px per press; Bravo starts at y=100.
    await pressKeys(handle, 'ArrowDown', 4)
    pressKey(handle, 'Space') // drop
    await flush(4)

    const call = reorderCall(fetchMock)
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      list_id: 1,
      ordered_ids: [11, 10, 12],
    })
    expect(cardTitles()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    // Ranks follow the visible order: Bravo is now #1, Alpha #2.
    expect(cardRanks()).toEqual(['#1', '#2', '#3'])
    expect(document.querySelector('[data-item-id="11"]')!.textContent).toContain('#1')
  })

  it('dropping in place changes nothing', async () => {
    const fetchMock = seedQueue()
    mockItemRects()
    await renderApp()
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await user.click(screen.getByRole('tab', { name: 'All (3)' }))
    await flush()
    const handle = screen.getByRole('button', { name: 'Reorder Bravo' })
    handle.focus()
    pressKey(handle, 'Space')
    await flush(2)
    pressKey(handle, 'Space')
    await flush(2)
    expect(reorderCall(fetchMock)).toBeUndefined()
    expect(cardTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('dropping outside any card changes nothing', async () => {
    const fetchMock = seedQueue()
    mockItemRects()
    await renderApp()
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await user.click(screen.getByRole('tab', { name: 'All (3)' }))
    await flush()
    const handle = screen.getByRole('button', { name: 'Reorder Charlie' })
    handle.focus()
    pressKey(handle, 'Space')
    await flush(2)
    // March far below the last card (y=200..290): 8 presses * 25px = 200px down.
    await pressKeys(handle, 'ArrowDown', 8)
    pressKey(handle, 'Space')
    await flush(4)
    expect(reorderCall(fetchMock)).toBeUndefined()
    expect(cardTitles()).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('toasts and reloads items when the reorder request fails', async () => {
    const fetchMock = seedQueue()
    mockItemRects()
    await renderApp()
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await user.click(screen.getByRole('tab', { name: 'All (3)' }))
    await flush()
    db.failNext = { method: 'POST', url: '/api/items/reorder', status: 500, body: { error: 'nope' } }

    const handle = screen.getByRole('button', { name: 'Reorder Alpha' })
    handle.focus()
    pressKey(handle, 'Space')
    await flush(2)
    await pressKeys(handle, 'ArrowDown', 4)
    pressKey(handle, 'Space')

    expect(await screen.findByText('nope')).toBeTruthy()
    // After the reload from the server, the original order is back.
    await waitFor(() => expect(cardTitles()).toEqual(['Alpha', 'Bravo', 'Charlie']))
    expect(reorderCall(fetchMock)).toBeTruthy()
  })

  it('shows drag handles in every filter view', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    db = makeDb()
    list(db, { id: 1, name: 'Queue' })
    item(db, { id: 10, list_id: 1, title: 'Alpha', status: 'watched' })
    item(db, { id: 11, list_id: 1, title: 'Bravo' })
    mockFetch(db)
    await renderApp()
    // Default Watching view: only Bravo, numbered within the visible tab.
    expect(screen.getAllByRole('button', { name: /Reorder/ }).length).toBe(1)
    expect(cardRanks()).toEqual(['#1'])
    await user.click(screen.getByRole('tab', { name: 'All (2)' }))
    expect(screen.getAllByRole('button', { name: /Reorder/ }).length).toBe(2)
    expect(cardRanks()).toEqual(['#1', '#2'])
    await user.click(screen.getByRole('tab', { name: 'Watched (1)' }))
    expect(screen.getAllByRole('button', { name: /Reorder/ }).length).toBe(1)
    expect(cardRanks()).toEqual(['#1'])
  })

  it('reordering in a filtered view persists the full-list order', async () => {
    db = makeDb()
    list(db, { id: 1, name: 'Queue' })
    item(db, { id: 10, list_id: 1, title: 'Alpha', status: 'watched' })
    item(db, { id: 11, list_id: 1, title: 'Bravo' })
    item(db, { id: 12, list_id: 1, title: 'Charlie' })
    const fetchMock = mockFetch(db)
    mockItemRects()
    await renderApp()
    // Watching view shows Bravo, Charlie; drag Bravo below Charlie.
    expect(cardTitles()).toEqual(['Bravo', 'Charlie'])
    const handle = screen.getByRole('button', { name: 'Reorder Bravo' })
    handle.focus()
    pressKey(handle, 'Space')
    await flush(2)
    await pressKeys(handle, 'ArrowDown', 4)
    pressKey(handle, 'Space')
    await flush(4)
    // The persisted order includes the hidden watched Alpha, unmoved at #1.
    const call = reorderCall(fetchMock)
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      list_id: 1,
      ordered_ids: [10, 12, 11],
    })
    expect(cardTitles()).toEqual(['Charlie', 'Bravo'])
    expect(cardRanks()).toEqual(['#1', '#2'])
  })
})

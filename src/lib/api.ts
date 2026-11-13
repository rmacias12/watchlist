import type { Item, ItemStatus, List, TMDBDetail, TMDBSearchResult } from '@/lib/types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (res.status === 401) {
    // Passcode cookie missing/expired — reload so the middleware serves the login page.
    window.location.reload()
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body.error) message = body.error
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export const api = {
  // Lists
  getLists: () => request<List[]>('/api/lists'),
  createList: (name: string) =>
    request<List>('/api/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameList: (id: number, name: string) =>
    request<List>(`/api/lists/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteList: (id: number) =>
    request<{ ok: true }>(`/api/lists/${id}`, { method: 'DELETE' }),

  // Items
  getItems: (listId: number) => request<Item[]>(`/api/items?list_id=${listId}`),
  createItem: (data: {
    list_id: number
    title: string
    url?: string | null
    poster_url?: string | null
    tmdb_id?: number | null
    status: ItemStatus
    notes?: string | null
  }) =>
    request<Item>('/api/items', { method: 'POST', body: JSON.stringify(data) }),
  updateItem: (
    id: number,
    data: Partial<{
      title: string
      url: string | null
      poster_url: string | null
      status: ItemStatus
      notes: string | null
    }>
  ) =>
    request<Item>(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteItem: (id: number) =>
    request<{ ok: true }>(`/api/items/${id}`, { method: 'DELETE' }),
  reorderItems: (listId: number, orderedIds: number[]) =>
    request<{ ok: true }>('/api/items/reorder', {
      method: 'POST',
      body: JSON.stringify({ list_id: listId, ordered_ids: orderedIds }),
    }),

  // TMDB search (proxied server-side)
  searchMedia: (q: string) =>
    request<TMDBSearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  searchDetail: (mediaType: 'movie' | 'tv', tmdbId: number) =>
    request<TMDBDetail>(`/api/search?media_type=${mediaType}&tmdb_id=${tmdbId}`),
}

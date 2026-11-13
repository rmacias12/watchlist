export type ItemStatus = 'watching' | 'watched'

export const STATUS_LABELS: Record<ItemStatus, string> = {
  watching: 'Watching',
  watched: 'Watched',
}

export interface List {
  id: number
  name: string
  item_count: number
  created_at: string
}

export interface Item {
  id: number
  list_id: number
  title: string
  url: string | null
  poster_url: string | null
  /** TMDB id when added via search; null for manual entries. Unique per list. */
  tmdb_id: number | null
  status: ItemStatus
  notes: string | null
  /** Manual sort order within a list (lower = higher priority). */
  position: number
  created_at: string
  updated_at: string
}

export interface TMDBSearchResult {
  tmdb_id: number
  media_type: 'movie' | 'tv'
  title: string
  year: string | null
  poster_url: string | null
  overview: string | null
}

export interface TMDBDetail {
  /** Best link for the item: IMDb if known, otherwise the TMDB page. */
  url: string
  imdb_url: string | null
  tmdb_url: string
}

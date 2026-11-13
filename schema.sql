-- Movie Queue schema — run this in the Neon SQL editor once.

CREATE TABLE IF NOT EXISTS lists (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT,                -- IMDB or related link
  poster_url TEXT,         -- optional poster image URL
  tmdb_id INTEGER,         -- TMDB id when added via search; NULL for manual entries
  status TEXT NOT NULL DEFAULT 'watching'
    CHECK (status IN ('watching', 'watched')),
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,  -- manual sort order (lower = higher priority)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_list_id_idx ON items(list_id);
CREATE INDEX IF NOT EXISTS items_list_position_idx ON items(list_id, position);
-- One copy of a TMDB title per list (NULLs = manual entries, never collide).
CREATE UNIQUE INDEX IF NOT EXISTS items_list_tmdb_uniq
  ON items (list_id, tmdb_id) WHERE tmdb_id IS NOT NULL;

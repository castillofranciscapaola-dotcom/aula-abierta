CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  summary         TEXT NOT NULL DEFAULT '',
  subject         TEXT NOT NULL DEFAULT '',
  grade           TEXT NOT NULL DEFAULT '',
  read_time       INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('published','draft','scheduled','trash')),
  cover_image     TEXT NOT NULL DEFAULT '',
  cover_alt       TEXT NOT NULL DEFAULT '',
  author          TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL DEFAULT '',
  views           INTEGER NOT NULL DEFAULT 0,
  content         TEXT NOT NULL DEFAULT '',
  tags            JSONB NOT NULL DEFAULT '[]',
  previous_status TEXT,
  trashed_at      BIGINT,
  extra           JSONB NOT NULL DEFAULT '{}',
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT
);
CREATE INDEX IF NOT EXISTS idx_articles_status  ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id             TEXT PRIMARY KEY,
  article_id     TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  author_name    TEXT NOT NULL DEFAULT '',
  author_type    TEXT NOT NULL DEFAULT 'guest',
  author_badge   TEXT NOT NULL DEFAULT '',
  school_info    TEXT NOT NULL DEFAULT '',
  content        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected','spam')),
  is_spam_alert  BOOLEAN NOT NULL DEFAULT FALSE,
  teacher_reply  TEXT,
  extra          JSONB NOT NULL DEFAULT '{}',
  created_at     BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_article ON comments(article_id);
CREATE INDEX IF NOT EXISTS idx_comments_status  ON comments(status);

CREATE TABLE IF NOT EXISTS media (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL DEFAULT '',
  url                 TEXT NOT NULL DEFAULT '',
  size_kb             INTEGER NOT NULL DEFAULT 0,
  dimensions          TEXT NOT NULL DEFAULT '',
  alt_text            TEXT NOT NULL DEFAULT '',
  associated_article  TEXT NOT NULL DEFAULT '',
  extra               JSONB NOT NULL DEFAULT '{}',
  created_at          BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at BIGINT
);

-- ============================================================
-- Parser App — Supabase Database Schema
-- Запустите этот SQL в Supabase SQL Editor:
-- Supabase Dashboard → SQL Editor → New Query → вставьте и выполните
-- ============================================================

-- Таблица источников (сайты для парсинга)
CREATE TABLE IF NOT EXISTS "Source" (
  "id"      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "name"    TEXT NOT NULL,
  "url"     TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true
);

-- Таблица ключевых слов
CREATE TABLE IF NOT EXISTS "Keyword" (
  "id"   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "word" TEXT UNIQUE NOT NULL
);

-- Таблица конфигурации расписания
CREATE TABLE IF NOT EXISTS "AppConfig" (
  "id"              TEXT PRIMARY KEY DEFAULT 'main',
  "scheduleTime"    TEXT NOT NULL DEFAULT '09:00',
  "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false
);

-- Таблица результатов поиска
CREATE TABLE IF NOT EXISTS "SearchResult" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "sourceUrl"       TEXT NOT NULL,
  "sourceName"      TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "description"     TEXT NOT NULL DEFAULT '',
  "link"            TEXT NOT NULL DEFAULT '',
  "matchedKeywords" TEXT NOT NULL DEFAULT '',
  "foundAt"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "sessionId"       TEXT NOT NULL DEFAULT ''
);

-- Индексы для ускорения запросов
CREATE INDEX IF NOT EXISTS idx_search_result_found_at ON "SearchResult" ("foundAt" DESC);
CREATE INDEX IF NOT EXISTS idx_search_result_session  ON "SearchResult" ("sessionId");

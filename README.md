# Parser App — Мониторинг объявлений и тендеров

Автоматизированный поиск объявлений на сайтах закупок Казахстана по ключевым словам.

## Функции

- 🔍 **Автоматический поиск** по сайтам eep.mitwork.kz, zakup.sk.kz, public.tizilim.gov.kz
- 📅 **Расписание** — настройте время ежедневного автопоиска
- 🏷️ **Ключевые слова** — MAN, Perkins, Deutz, Scania, Mitsubishi, двигатель и др.
- 📊 **Экспорт** результатов в Excel (.xlsx) и Word (.docx)
- ➕ **Добавление** новых источников и ключевых слов

---

## Быстрый старт (локально)

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка переменных окружения

Скопируйте `.env.example` в `.env` и заполните данные Supabase:

```bash
cp .env.example .env
```

Замените `[YOUR-PASSWORD]` на пароль базы данных (Supabase Dashboard → Settings → Database).

### 3. Создание таблиц в Supabase

**Вариант A — через Prisma (рекомендуется):**

```bash
npx prisma db push
```

**Вариант B — вручную через SQL Editor:**

Откройте `supabase/migrations.sql` и запустите SQL в Supabase Dashboard → SQL Editor.

### 4. Запуск приложения

```bash
# Запустить веб-приложение
npm run dev

# В отдельном терминале — запустить планировщик
npm run scheduler
```

Откройте [http://localhost:3000](http://localhost:3000).

---

## Деплой на Vercel

### 1. Настройка переменных окружения в Vercel

Перейдите в Vercel Dashboard → Settings → Environment Variables и добавьте:

| Переменная | Где взять |
|-----------|-----------|
| `DATABASE_URL` | Supabase → Settings → Database → Connection pooling → Transaction mode (port 6543) |
| `DIRECT_URL` | Supabase → Settings → Database → Connection string → URI (port 5432) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://rumovdeqpbmsysiidjja.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_QaA8Cy2S484VWn3URusAVg_4YHK9AV8` |

### 2. Деплой

Импортируйте репозиторий на [vercel.com/new](https://vercel.com/new) или через CLI:

```bash
npx vercel --prod
```

### 3. Создание таблиц

После первого деплоя выполните миграцию:

```bash
npx prisma migrate deploy
```

Или через CLI Vercel с переменными production.

### 4. Расписание (Vercel Cron)

Настроено на ежедневный запуск в 9:00 UTC через `vercel.json`.
Для изменения времени — отредактируйте `schedule` в `vercel.json`.

---

## Структура проекта

```
parser-app/
├── src/
│   ├── app/
│   │   ├── page.tsx                # Главная страница (дашборд)
│   │   ├── components/
│   │   │   ├── SourceManager.tsx   # Управление источниками
│   │   │   ├── KeywordManager.tsx  # Ключевые слова
│   │   │   ├── ScheduleSettings.tsx# Расписание
│   │   │   └── ResultsView.tsx     # Результаты + экспорт
│   │   └── api/
│   │       ├── sources/            # CRUD источников
│   │       ├── keywords/           # CRUD ключевых слов
│   │       ├── schedule/           # Расписание
│   │       ├── search/             # Запуск поиска
│   │       ├── results/            # Результаты
│   │       ├── export/             # Экспорт xlsx/docx
│   │       └── cron/               # Vercel Cron endpoint
│   └── lib/
│       ├── db.ts                   # Prisma клиент
│       ├── scraper.ts              # Парсер (fetch + cheerio)
│       └── reportGenerator.ts     # Отчёты Excel/Word
├── prisma/schema.prisma            # Схема БД
├── supabase/migrations.sql         # SQL для создания таблиц
├── scheduler.js                    # Планировщик (локальный)
├── vercel.json                     # Vercel + Cron конфигурация
└── .env.example                    # Шаблон переменных окружения
```

---

## Технологии

- **Next.js 16** + **React 19**
- **Prisma** + **PostgreSQL** (Supabase)
- **Cheerio** + **Fetch** — парсинг
- **ExcelJS** + **docx** — отчёты
- **node-cron** — планировщик
- **Tailwind CSS** — стили

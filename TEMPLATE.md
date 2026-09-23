# Шаблон: next-shadcn-dashboard-starter без авторизации

Форк [Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter)
@ `7705dfc` (2026-08-25). Clerk вырезан полностью, авторизации нет — `/dashboard` открыт всем.

## Старт нового проекта

```sh
cp -R ~/templates/next-dashboard ~/projects/МОЙ-ПРОЕКТ
cd ~/projects/МОЙ-ПРОЕКТ
rm -rf .git && git init && git add -A && git commit -m "Initial commit"
bun install          # node_modules уже лежат, отработает мгновенно
bun run dev
```

Открывается `/` → редиректит на `/dashboard/overview`.

## Что уже убрано

- **Clerk** — авторизация, организации, биллинг, профиль, RBAC-навигация
- **Examples** — демо-формы, React Query demo, витрина иконок
- **Sentry** — трекинг ошибок (не нужен DSN, быстрее сборка)
- **husky + lint-staged** — pre-commit/pre-push хуки не тормозят коммиты агента

## Что осталось как образец для ИИ-агента

`/dashboard/product` и `/dashboard/users` — самый полный пример сквозного паттерна:
серверная таблица (tanstack-table), фильтры в URL через nuqs, формы, API-роуты в
`src/app/api/`. Данные фейковые (`@faker-js/faker`), БД не нужна. Проси агента
делать новые разделы по образцу именно этих двух.

`AGENTS.md` в корне — карта репозитория, Claude Code подхватывает её автоматически.

## Что можно снести дальше, когда поймёшь идею

```sh
bun scripts/cleanup.js kanban chat ai-chat notifications   # выбери ненужное
bun scripts/cleanup.js --list                              # весь список
bun scripts/cleanup.js --dry-run kanban                    # посмотреть без изменений
```

Если какая-то из этих фич близка к твоей идее — наоборот, оставь её и переделывай,
это готовый каркас. Темы (10 штук в `src/styles/themes/`) оставлены: переключатель
тем хорошо смотрится на демо, а контекст агенту почти не засоряет.

## Осторожно: два бага в upstream-скрипте cleanup.js

Уже исправлены здесь, но всплывут, если запускать скрипт на чистом репозитории:

1. `cleanup.js clerk` не убирает `await auth.protect()` и импорт Clerk из
   `src/app/dashboard/layout.tsx` — сборка падает.
2. `cleanup.js sentry` подменяет только `@bar_stats/error.tsx`, а `overview/error.tsx`,
   `@area_stats`, `@pie_stats`, `@sales` остаются с `import * as Sentry from '@sentry/nextjs'`
   при удалённом пакете. `next build` это не ловит (error-boundary не рендерятся при
   статической генерации), падает только в рантайме при реальной ошибке.

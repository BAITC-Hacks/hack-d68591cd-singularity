# AGENTS.md — OrgDiff

ИИ-агент анализа организационной структуры и функционала (HackAlem, трек 11). Сравнивает комплекты документов «до» и «после» реорганизации и выдаёт: изменения подразделений, потерю и сужение функций, дублирование и пересечения, признаки конфликта интересов, итоговое заключение. У каждого вывода есть источник: документ, пункт и дословная цитата. Подробности и запуск — в [README.md](./README.md).

## Команды

```sh
bun install
bun run dev            # http://localhost:3000 → /dashboard/orgdiff
bun run analyze:demo   # пайплайн на тестовом комплекте без сервера
bun scripts/analyze-files.ts --before a.pdf --after b.docx --after c.xlsx   # свой комплект (docx/pdf/xlsx/txt)
bun run eval           # проверка по эталону data/control/GOLD.md + контрольный комплект (16 проверок)
bun run verify         # запуск из чистого клона + демо-анализ + заключение + eval без ключа
bun run typecheck && bun run lint
```

Тестовый и контрольный комплекты отвечают из кэша `data/cache/` без сети и без ключа. Новые документы требуют `OPENAI_API_KEY` (лежит в `.env`).

## Карта кода

| Путь | Роль |
|---|---|
| `src/features/orgdiff/types.ts` | контракт пайплайн ↔ интерфейс (`AnalysisResult`, `Finding`, `Evidence`…) |
| `src/features/orgdiff/lib/analyze.ts` | оркестратор: шаги агента (PIPELINE_STEPS), trace, сборка и проверка выводов |
| `src/features/orgdiff/lib/parse-clauses.ts` | документ → пункты с номерами (склеенные пункты, оглавление) |
| `src/features/orgdiff/lib/units.ts` | подразделения, должности, подчинённость, носители функций (правила) |
| `src/features/orgdiff/lib/functions.ts` | функции = пункты с носителями |
| `src/features/orgdiff/lib/judge.ts` | промпты LLM со строгими JSON-схемами, каталог правил конфликта интересов |
| `src/features/orgdiff/lib/compliance.ts` | опция 1 ТЗ: сверка новой редакции с `data/requirements.json` (IIA, Закон РК «Об АО», 208-ФЗ), один LLM-вызов, цитаты проверяются |
| `src/features/orgdiff/lib/llm.ts` | OpenAI Responses API + дисковый кэш |
| `src/app/api/report/` | `POST /api/report` — заключение из присланного результата и решений сотрудника |
| `src/app/api/analyze/` | `POST /api/analyze` (файлы или `?demo=1`) → `GET /api/analyze/{jobId}` → `GET …/{jobId}/report` (.docx / `?format=md`) |
| `src/features/orgdiff/components/`, `src/app/dashboard/orgdiff/` | интерфейс: загрузка, ход анализа, схема «до/после» |
| `scripts/eval.ts` | метрики качества; `--prune` чистит устаревший кэш |

## Инварианты

- Вывод без подтверждённой цитаты не показывается: каждая цитата проверяется на вхождение в текст пункта.
- Формулировки выводов — гипотезы («признаки дублирования»), итог носит рекомендательный характер.
- Структура и носители функций — детерминированными правилами; LLM — только там, где нужен смысл.
- Изменили промпт или пайплайн → `bun run eval --prune` и закоммитить `data/cache/`, иначе демо пойдёт в сеть.
- Пакетный менеджер — только bun.

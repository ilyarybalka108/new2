<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Рекламный кабинет

Это кабинет для ведения рекламы в Яндекс Директе. Владелец наблюдает за картиной в интерфейсе, а кабинеты ведёт сессия Claude.

- Если задача — вести, проверять или оптимизировать рекламу, сначала прочитай `docs/playbook.md`: там порядок работы, границы самостоятельных действий и то, что всегда выносится владельцу.
- Работа с кабинетами идёт через `npm run ads -- <команда>` (список команд — в начале `scripts/ads.mts`). Каждое изменение сопровождается причиной.
- Устройство кода и ограничения текущей версии описаны в `README.md`.

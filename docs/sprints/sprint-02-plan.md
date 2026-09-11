# Sprint 02 — план по урокам

Статус: ⬜ не начат, ✅ готово. Детали каждого урока обсуждаем перед его началом.

| № | Тема | Паттерн/принцип | Файлы | Критерий готовности | Статус |
|---|---|---|---|---|---|
| 1 | TypeScript-контур | — (typecheck/тесты как обратная связь) | `package.json`, `tsconfig.json`, `.nvmrc` | `typecheck`, `test`, `dev` выполняются без ошибок | ✅ |
| 2 | `AppError` и порт `ErrorReporter` | Абстрактный класс, Порт | `shared/errors/app-error.ts(+test)`, `error-reporter.ts` | Наследники `AppError` корректно несут code/severity/context/cause | ⬜ |
| 3 | `CompositeErrorReporter` | Композит | `shared/errors/composite-error-reporter.ts(+test)`, `console-error-sink.ts(+test)` | Ошибка уходит во все приёмники; сбой одного не мешает другим | ⬜ |
| 4 | Ограничитель повторов, маскировка | Декоратор | `shared/errors/rate-limited-error-reporter.ts(+test)`, `mask-secrets.ts(+test)` | Дубли ошибок не спамят; токены в тексте замаскированы | ⬜ |
| 5 | `installProcessGuards`, `NotImplementedError` | Операционные vs программные ошибки, YAGNI | `app/process-guards.ts`, `shared/errors/not-implemented-error.ts(+test)` | `uncaughtException`/`unhandledRejection` уходят в `ErrorReporter` | ⬜ |
| 6 | `Money` | Value Object | `shared/money/money.ts(+test)` | `add` иммутабелен; несовпадение валют — ошибка | ⬜ |
| 7 | `Quantity` | Value Object (повтор) | `shared/quantity/quantity.ts(+test)` | знак количества: заявка > 0, позиция может быть < 0 — решить на уроке | ⬜ |
| 8 | `Clock` | Порт + адаптеры (Test Double) | `shared/time/clock.ts`, `fake-clock.ts(+test)` | `FakeClock` управляемо продвигает время в тестах | ⬜ |
| 9 | `Logger` | Порт + адаптер | `shared/logging/logger.ts`, `console-logger.ts(+test)` | Уровни логирования фильтруются корректно | ⬜ |
| 10 | `EventBus` | Наблюдатель | `shared/events/event-bus.ts`, `in-memory-event-bus.ts(+test)` | Несколько подписчиков получают событие; сбой одного не мешает | ⬜ |
| 11 | `AppConfig` | Fail fast, схема как контракт | `shared/config/app-config.ts(+test)`, `.env.example` | Невалидный `.env` → понятная `ConfigError` при старте | ⬜ |
| 12 | Заглушки модулей (identity, tenancy, signals, billing, уведомления) | Заглушка на границе, YAGNI | `modules/identity/*`, `modules/tenancy/*`, `modules/signals/*`, `modules/billing/*`,`modules/notifications/*` | Вызов заглушки бросает `NotImplementedError`; `typecheck` проходит | ⬜ |
| 13 | `composition-root.ts` + `main-worker.ts` | Pure DI / Composition Root | `app/composition-root.ts`, `app/main-worker.ts`, `src/interfaces/cli/smoke.ts` | Искусственное исключение в `main-worker` → консоль, токен замаскирован, npm run smoke работает через новые классы | ⬜ |
| 14 | ADR 001–010 и закрытие спринта | — (документирование решений) | `docs/architecture/adr/00N-*.md`, `docs/sprints/sprint-02-*.md`, `docs/ROADMAP.md` | `typecheck`/`test` зелёные; ADR и статус спринта зафиксированы | ⬜ |

ADR пишем в уроке, где принимается решение; урок 14 — сверка и закрытие

## Открытые вопросы

- **К уроку 13.** Сейчас `tsx` — в `devDependencies` (урок 1), потому что предполагался
  «продакшен-бандл» после сборки. Но по архитектуре сборки не будет: PM2 в проде запускает
  робота тем же `tsx`, без отдельного шага `tsc`-компиляции в `.js` (в проде — просто `tsx
  src/app/main-worker.ts`, без `watch`; `watch` — только режим разработки, `npm run dev`).
  Значит `tsx` как исполнитель нужен и в проде — вероятно, его место в `dependencies`, а не
  `devDependencies`. Обсудить и решить в уроке 13 вместе с содержимым `composition-root.ts`.

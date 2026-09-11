/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/index.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки, публичный API модуля
 * РОЛЬ:          Единственная точка, через которую другие модули видят errors/:
 *                внутренние файлы модуля извне не импортируются
 * ИСПОЛЬЗУЕТСЯ:  Composition Root и любой код, которому нужны AppError/ErrorReporter
 * 1С:            ключевое слово Экспорт — без него процедура недоступна снаружи модуля
 * ────────────────────────────────────────────────────────────────────────────
 */

// AppError — класс, существует в рантайме как значение (можно написать instanceof AppError) —
// обычный export. Severity и ErrorReporter — только типы, в рантайме их не существует:
// export type обязателен при verbatimModuleSyntax (tsconfig.json), иначе esbuild (tsx/vitest)
// сгенерирует реэкспорт несуществующего значения, и он упадёт при запуске.
export { AppError } from './app-error.ts';
export type { Severity } from './app-error.ts';
export type { ErrorReporter } from './error-reporter.ts';

// CompositeErrorReporter и ConsoleErrorSink — классы (значения), ErrorSink и ErrorEvent —
// только типы. toErrorEvent НЕ экспортируется: это внутренняя деталь реализации
// CompositeErrorReporter, снаружи модуля она не нужна. Принцип минимального публичного
// API — наружу отдаём только то, чем реально пользуются другие модули; чем меньше
// публичная поверхность, тем свободнее потом менять внутренности errors/ без последствий
// для остального кода.
export { CompositeErrorReporter } from './composite-error-reporter.ts';
export { ConsoleErrorSink } from './console-error-sink.ts';
export type { ErrorEvent } from './error-event.ts';
export type { ErrorSink } from './error-sink.ts';

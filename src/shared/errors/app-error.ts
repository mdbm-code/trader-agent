/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/app-error.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки
 * РОЛЬ:          Базовый класс всех ошибок приложения: несёт машиночитаемый код,
 *                серьёзность, признак «временная ли» и контекст
 * ПАТТЕРН:       Абстрактный класс — общий контракт (code/severity обязаны быть у
 *                каждого наследника) плюс общая реализация (конструктор, name),
 *                которую не нужно повторять в каждом наследнике
 * ИСПОЛЬЗУЕТСЯ:  ErrorReporter.report() принимает любой AppError; конкретные
 *                наследники (ExternalServiceError, ConfigError и др.) появятся
 *                в следующих уроках
 * ТЕСТЫ:         app-error.test.ts
 * 1С:            структура с описанием ошибки, которую передают в ВызватьИсключение,
 *                только с кодом, серьёзностью и контекстом
 * ────────────────────────────────────────────────────────────────────────────
 */

export type Severity = 'info' | 'warning' | 'error' | 'critical';

export abstract class AppError extends Error {
  abstract readonly code: string; // 'BROKER_REJECTED' — для машин и фильтров
  abstract readonly severity: Severity; // от неё зависит, будить ли владельца ночью

  /** true — сбой внешнего мира, операцию можно повторить. Наследники переопределяют. */
  readonly transient: boolean = false;

  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    context: Record<string, unknown> = {},
    options?: ErrorOptions, // { cause } — исходная ошибка: цепочка «что к чему привело»
  ) {
    super(message, options);

    // Readonly<...> в типе поля — это только проверка tsc: она не пускает
    // error.context.foo = 1 мимо компилятора, но в рантайме объект остаётся обычным
    // изменяемым. Поэтому Object.freeze — обещание рантайму, а не только компилятору.
    // { ...context } — копия, а не ссылка: если вызывающий код потом поменяет свой
    // объект, это не должно задним числом изменить уже брошенную ошибку.
    this.context = Object.freeze({ ...context });

    // new.target — реальный класс-наследник (например, ConfigError), а не AppError.
    this.name = new.target.name;

    // Здесь нельзя прочитать this.code или this.severity, хотя наследник их
    // «уже объявил»: super() — первое действие конструктора наследника, а поля класса
    // наследника (readonly code = '...') присваиваются ПОСЛЕ возврата из super().
    // В этой точке их ещё нет.

    // Object.setPrototypeOf(this, new.target.prototype) здесь не нужен. Это обходной
    // путь для случая, когда extends встроенного класса (Error) компилируется в цель
    // ES5 — там ломается instanceof. Наш tsconfig.json целится в ES2022: extends
    // остаётся нативным, instanceof работает без костылей (см. тест на это).
  }
}

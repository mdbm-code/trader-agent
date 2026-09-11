/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/error-event.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки
 * РОЛЬ:          Приводит что угодно, брошенное в report() (AppError, чужой Error,
 *                строку, произвольный объект), к одному виду — ErrorEvent, с которым
 *                дальше работают все приёмники (ErrorSink)
 * ПАТТЕРН:       Нормализация на границе — не GoF-паттерн, а приём: снаружи модуля
 *                report() принимает unknown, внутри всё дальше работает с одним типом
 * ИСПОЛЬЗУЕТСЯ:  CompositeErrorReporter.report() (урок 3)
 * ТЕСТЫ:         error-event.test.ts
 * 1С:            обработчик, который перед записью в журнал регистрации приводит
 *                разные источники ошибки (исключение, ошибка обмена, ошибка записи)
 *                к одной структуре
 * ────────────────────────────────────────────────────────────────────────────
 */
import { AppError, type Severity } from './app-error.ts';

export interface ErrorEvent {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  readonly stack?: string;
}

// Событие уходит одним и тем же объектом сразу нескольким приёмникам параллельно
// (CompositeErrorReporter, урок 3) — значит ни один приёмник не должен иметь
// возможности поменять его для остальных. Копия + Object.freeze — тот же приём,
// что AppError.context в уроке 2, только теперь ещё и на верхнем уровне события.
function freezeEvent(
  context: Record<string, unknown>,
  rest: Omit<ErrorEvent, 'context'>,
): ErrorEvent {
  return Object.freeze({ ...rest, context: Object.freeze({ ...context }) });
}

export function toErrorEvent(error: unknown, context: Record<string, unknown> = {}): ErrorEvent {
  try {
    if (error instanceof AppError) {
      // Контекст самой ошибки задан в месте сбоя (например, { orderId }) — он
      // конкретнее, чем context, переданный в report() (обычно общий фон вроде
      // { source: 'uncaughtException' }). Конкретное перекрывает общее: при
      // совпадении ключей побеждает error.context, а не аргумент report().
      return freezeEvent(
        { ...context, ...error.context },
        {
          code: error.code,
          severity: error.severity,
          message: error.message,
          cause: error.cause,
          stack: error.stack,
        },
      );
    }

    if (error instanceof Error) {
      return freezeEvent(context, {
        code: 'UNKNOWN_ERROR',
        severity: 'error',
        message: error.message,
        cause: error,
        stack: error.stack,
      });
    }

    // String(error) может бросить: у объекта без прототипа (Object.create(null))
    // нет toString/valueOf, и попытка привести его к строке падает с TypeError.
    // Это ловит catch ниже.
    return freezeEvent(context, {
      code: 'UNKNOWN_ERROR',
      severity: 'error',
      message: String(error),
      cause: error,
    });
  } catch {
    // У toErrorEvent нет и не может быть типа "эта функция не бросает" — в TypeScript
    // такой аннотации не существует: компилятор проверяет форму значений, а не то,
    // кинет ли функция исключение по дороге к return. Поэтому гарантию "переживает
    // любой мусор на входе" обеспечиваем сами, явным try/catch, а не типами.
    return freezeEvent(context, {
      code: 'UNKNOWN_ERROR',
      severity: 'error',
      message: 'Не удалось нормализовать ошибку',
    });
  }
}

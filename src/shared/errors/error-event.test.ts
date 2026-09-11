/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/error-event.test.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки (тест)
 * РОЛЬ:          Проверяет, что toErrorEvent приводит любые входные данные
 *                (AppError, чужой Error, строку, объект без прототипа) к одному
 *                виду и не падает даже на мусоре
 * ИСПОЛЬЗУЕТСЯ:  npm run test
 * ТЕСТЫ:         это и есть тест
 * 1С:            —
 * ────────────────────────────────────────────────────────────────────────────
 */
import { describe, expect, test } from 'vitest';
import { AppError, type Severity } from './app-error.ts';
import { toErrorEvent } from './error-event.ts';

class FakeAppError extends AppError {
  readonly code = 'FAKE';
  readonly severity: Severity = 'critical';
}

describe('toErrorEvent', () => {
  test('AppError -> code/severity/message берутся из ошибки', () => {
    const error = new FakeAppError('что-то сломалось', { orderId: '1' });

    const event = toErrorEvent(error);

    expect(event.code).toBe('FAKE');
    expect(event.severity).toBe('critical');
    expect(event.message).toBe('что-то сломалось');
    expect(event.context).toEqual({ orderId: '1' });
  });

  test('при совпадении ключей контекст ошибки перекрывает контекст вызова report() (конкретное сильнее общего)', () => {
    const error = new FakeAppError('x', { orderId: '1', source: 'внутри-обработчика' });

    const event = toErrorEvent(error, { source: 'uncaughtException', extra: 'a' });

    expect(event.context).toEqual({
      source: 'внутри-обработчика',
      orderId: '1',
      extra: 'a',
    });
  });

  test('cause и stack пробрасываются из AppError', () => {
    const cause = new Error('исходная причина');
    const error = new FakeAppError('x', {}, { cause });

    const event = toErrorEvent(error);

    expect(event.cause).toBe(cause);
    expect(event.stack).toBe(error.stack);
  });

  test('чужой Error (не AppError) -> UNKNOWN_ERROR, severity error, cause = сама ошибка', () => {
    const error = new Error('boom');

    const event = toErrorEvent(error);

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.severity).toBe('error');
    expect(event.message).toBe('boom');
    expect(event.cause).toBe(error);
    expect(event.stack).toBe(error.stack);
  });

  test('брошенная строка -> message через String()', () => {
    const event = toErrorEvent('просто строка');

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.message).toBe('просто строка');
    expect(event.cause).toBe('просто строка');
  });

  test('объект без прототипа не роняет нормализацию, хотя String() на нём бросает', () => {
    const garbage: unknown = Object.create(null);

    const event = toErrorEvent(garbage);

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.severity).toBe('error');
    expect(event.message).toBe('Не удалось нормализовать ошибку');
  });

  test('событие и его context заморожены: запись бросает TypeError', () => {
    const event = toErrorEvent(new Error('x'), { a: 1 });

    expect(() => {
      (event.context as Record<string, unknown>).a = 2;
    }).toThrow(TypeError);
    expect(() => {
      (event as { message: string }).message = 'изменено';
    }).toThrow(TypeError);
  });
});

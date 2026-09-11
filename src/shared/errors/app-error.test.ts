/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/app-error.test.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки (тест)
 * РОЛЬ:          Проверяет базовое поведение AppError через минимальный
 *                тестовый подкласс — сам AppError абстрактный, его нельзя
 *                создать напрямую
 * ИСПОЛЬЗУЕТСЯ:  npm run test
 * ТЕСТЫ:         это и есть тест
 * 1С:            —
 * ────────────────────────────────────────────────────────────────────────────
 */
import { describe, expect, test } from 'vitest';
import { AppError, type Severity } from './app-error.ts';

class FakeAppError extends AppError {
  readonly code = 'FAKE';
  readonly severity: Severity = 'error';
}

class FakeTransientError extends AppError {
  readonly code = 'FAKE_TRANSIENT';
  readonly severity: Severity = 'warning';
  readonly transient = true;
}

describe('AppError', () => {
  test('несёт message, code, severity, заданные наследником', () => {
    const error = new FakeAppError('что-то пошло не так');

    expect(error.message).toBe('что-то пошло не так');
    expect(error.code).toBe('FAKE');
    expect(error.severity).toBe('error');
  });

  test('name — имя конкретного класса-наследника, а не AppError', () => {
    const error = new FakeAppError('x');

    expect(error.name).toBe('FakeAppError');
  });

  test('context по умолчанию — пустой объект', () => {
    const error = new FakeAppError('x');

    expect(error.context).toEqual({});
  });

  test('context — копия: мутация исходного объекта после создания ошибки не видна в error.context', () => {
    const source: Record<string, unknown> = { orderId: '1' };
    const error = new FakeAppError('x', source);

    source.orderId = '2';
    source.extra = 'leaked';

    expect(error.context).toEqual({ orderId: '1' });
  });

  test('context заморожен: запись в него бросает TypeError', () => {
    const error = new FakeAppError('x', { orderId: '1' });

    expect(() => {
      (error.context as Record<string, unknown>).orderId = '2';
    }).toThrow(TypeError);
  });

  test('cause доходит через стандартный Error.cause', () => {
    const cause = new Error('исходная причина');
    const error = new FakeAppError('x', {}, { cause });

    expect(error.cause).toBe(cause);
  });

  test('transient по умолчанию false, наследник может переопределить в true', () => {
    const error = new FakeAppError('x');
    const transientError = new FakeTransientError('x');

    expect(error.transient).toBe(false);
    expect(transientError.transient).toBe(true);
  });

  test('instanceof AppError и instanceof Error — оба true', () => {
    const error = new FakeAppError('x');

    expect(error).toBeInstanceOf(AppError);
    expect(error).toBeInstanceOf(Error);
  });
});

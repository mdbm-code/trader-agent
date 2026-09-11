/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/console-error-sink.test.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки (тест)
 * РОЛЬ:          Проверяет, что ConsoleErrorSink выбирает правильный console.*
 *                по severity, печатает всё одним вызовом и переживает мусор
 *                в context (bigint, циклические ссылки)
 * ИСПОЛЬЗУЕТСЯ:  npm run test
 * ТЕСТЫ:         это и есть тест
 * 1С:            —
 * ────────────────────────────────────────────────────────────────────────────
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Severity } from './app-error.ts';
import { ConsoleErrorSink } from './console-error-sink.ts';
import type { ErrorEvent } from './error-event.ts';

function fakeEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    code: 'FAKE',
    severity: 'error',
    message: 'что-то сломалось',
    context: {},
    ...overrides,
  };
}

describe('ConsoleErrorSink', () => {
  // vi.spyOn подменяет console.* только на время теста, но подмену нужно снять руками:
  // без restoreAllMocks шпион, поставленный в одном тесте, остался бы активен в
  // следующих — их вызовы console.* тоже попадали бы в тот же мок, а toHaveBeenCalledTimes
  // считал бы вызовы вперемешку из разных тестов.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[Severity, 'info' | 'warn' | 'error']>([
    ['info', 'info'],
    ['warning', 'warn'],
    ['error', 'error'],
    ['critical', 'error'],
  ])('severity %s печатается через console.%s', async (severity, method) => {
    const spy = vi.spyOn(console, method).mockImplementation(() => {});
    const sink = new ConsoleErrorSink();
    const event = fakeEvent({ severity, code: 'X', message: 'сообщение' });

    await sink.send(event);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('[' + severity.toUpperCase() + '] X: сообщение');
  });

  it('accepts() всегда true — фильтровать пока не от чего', () => {
    const sink = new ConsoleErrorSink();

    expect(sink.accepts()).toBe(true);
  });

  it('context передаётся отдельным аргументом console.*, без JSON.stringify', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new ConsoleErrorSink();
    const context: Record<string, unknown> = { amountNano: 100n };
    context.self = context; // циклическая ссылка

    await expect(sink.send(fakeEvent({ severity: 'error', context }))).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[1]).toBe(context);
  });

  it('для error печатает stack и cause одним вызовом console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new ConsoleErrorSink();
    const cause = new Error('исходная причина');
    const event = fakeEvent({ severity: 'error', stack: 'stack-трейс', cause });

    await sink.send(event);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([
      '[ERROR] FAKE: что-то сломалось',
      event.context,
      'stack-трейс',
      cause,
    ]);
  });

  it('для critical тоже печатает stack и cause', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = new ConsoleErrorSink();
    const cause = new Error('исходная причина');

    await sink.send(fakeEvent({ severity: 'critical', stack: 'stack-трейс', cause }));

    expect(spy.mock.calls[0]).toEqual([
      '[CRITICAL] FAKE: что-то сломалось',
      {},
      'stack-трейс',
      cause,
    ]);
  });

  it('для info НЕ печатает stack/cause, даже если они заданы', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const sink = new ConsoleErrorSink();

    await sink.send(
      fakeEvent({ severity: 'info', stack: 'stack-трейс', cause: new Error('x') }),
    );

    expect(spy.mock.calls[0]).toEqual(['[INFO] FAKE: что-то сломалось', {}]);
  });

  it('для warning НЕ печатает stack/cause, даже если они заданы', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = new ConsoleErrorSink();

    await sink.send(
      fakeEvent({ severity: 'warning', stack: 'stack-трейс', cause: new Error('x') }),
    );

    expect(spy.mock.calls[0]).toEqual(['[WARNING] FAKE: что-то сломалось', {}]);
  });
});

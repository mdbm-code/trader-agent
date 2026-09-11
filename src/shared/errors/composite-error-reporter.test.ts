/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/composite-error-reporter.test.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки (тест)
 * РОЛЬ:          Проверяет критерий готовности урока 3: ошибка уходит во все
 *                приёмники, и сбой одного (синхронный, асинхронный, даже сбой
 *                самого логирования) не мешает остальным и не роняет report()
 * ИСПОЛЬЗУЕТСЯ:  npm run test
 * ТЕСТЫ:         это и есть тест
 * 1С:            —
 * ────────────────────────────────────────────────────────────────────────────
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompositeErrorReporter } from './composite-error-reporter.ts';
import type { ErrorEvent } from './error-event.ts';
import type { ErrorSink } from './error-sink.ts';

class NormalSink implements ErrorSink {
  readonly sent: ErrorEvent[] = [];

  accepts(): boolean {
    return true;
  }

  async send(event: ErrorEvent): Promise<void> {
    this.sent.push(event);
  }
}

class FilteringSink implements ErrorSink {
  readonly sent: ErrorEvent[] = [];

  accepts(): boolean {
    return false;
  }

  async send(event: ErrorEvent): Promise<void> {
    this.sent.push(event);
  }
}

class SyncThrowSink implements ErrorSink {
  accepts(): boolean {
    return true;
  }

  // Намеренно не async: бросает синхронно, до того как вернуть Promise — тип обещает
  // Promise<void>, но ничего в рантайме это не проверяет.
  send(_event: ErrorEvent): Promise<void> {
    throw new Error('sink send сломан синхронно');
  }
}

class AcceptsThrowSink implements ErrorSink {
  accepts(): boolean {
    throw new Error('accepts сломан');
  }

  async send(_event: ErrorEvent): Promise<void> {
    // Не должен вызываться: accepts() бросает раньше.
  }
}

class RejectingSink implements ErrorSink {
  accepts(): boolean {
    return true;
  }

  async send(_event: ErrorEvent): Promise<void> {
    throw new Error('асинхронный сбой приёмника');
  }
}

function fakeError(): Error {
  return new Error('что-то сломалось');
}

describe('CompositeErrorReporter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('нормальный приёмник получает событие, даже если другие сломаны синхронно', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const normal = new NormalSink();
    const reporter = new CompositeErrorReporter([
      new SyncThrowSink(),
      new AcceptsThrowSink(),
      normal,
    ]);

    await expect(reporter.report(fakeError())).resolves.toBeUndefined();

    expect(normal.sent).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2); // по разу на каждый сломанный приёмник
  });

  it('в сообщении о сбое указано имя сломанного приёмника', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = new CompositeErrorReporter([new SyncThrowSink()]);

    await reporter.report(fakeError());

    expect(spy.mock.calls[0]?.[0]).toBe('ErrorSink failed: SyncThrowSink');
  });

  it('приёмник, который не accepts() событие, не получает send()', async () => {
    const filtering = new FilteringSink();
    const reporter = new CompositeErrorReporter([filtering]);

    await reporter.report(fakeError());

    expect(filtering.sent).toHaveLength(0);
  });

  it('пустой список приёмников — report() резолвится', async () => {
    const reporter = new CompositeErrorReporter([]);

    await expect(reporter.report(fakeError())).resolves.toBeUndefined();
  });

  it('один и тот же объект event доходит до всех приёмников', async () => {
    const first = new NormalSink();
    const second = new NormalSink();
    const reporter = new CompositeErrorReporter([first, second]);

    await reporter.report(fakeError());

    expect(first.sent[0]).toBe(second.sent[0]);
  });

  it('асинхронный сбой приёмника (rejected promise) логируется в console.error напрямую', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const reporter = new CompositeErrorReporter([new RejectingSink()]);

    await reporter.report(fakeError());

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('ErrorSink failed: RejectingSink');
  });

  it('report() резолвится, даже если сам console.error бросает (последний рубеж)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('EPIPE: поток вывода закрыт');
    });
    const reporter = new CompositeErrorReporter([new SyncThrowSink()]);

    await expect(reporter.report(fakeError())).resolves.toBeUndefined();
  });
});

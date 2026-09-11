/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/composite-error-reporter.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки
 * РОЛЬ:          Первая реализация порта ErrorReporter: одна ошибка расходится
 *                сразу по всем приёмникам (ErrorSink); сбой одного не мешает другим
 * ПАТТЕРН:       Композит — снаружи обычный ErrorReporter, внутри рассылка по списку
 *                однотипных ErrorSink
 * ИСПОЛЬЗУЕТСЯ:  Composition Root (урок 13)
 * ТЕСТЫ:         composite-error-reporter.test.ts
 * 1С:            одна запись события одновременно идёт в журнал регистрации и письмом администратору
 * ────────────────────────────────────────────────────────────────────────────
 */
import { toErrorEvent } from './error-event.ts';
import type { ErrorReporter } from './error-reporter.ts';
import type { ErrorSink } from './error-sink.ts';

export class CompositeErrorReporter implements ErrorReporter {
  constructor(private readonly sinks: readonly ErrorSink[]) {}

  async report(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const event = toErrorEvent(error, context);

    // Каждый приёмник вызываем через свою async-функцию и сами ловим его сбой рядом с
    // ним же (try/catch внутри колбэка), а не через Promise.allSettled + сопоставление
    // индекса результата с индексом this.sinks задним числом: два параллельных массива,
    // которые нужно вручную удерживать в синхронизации, — источник ошибок сам по себе
    // (noUncheckedIndexedAccess в tsconfig.json как раз про это: this.sinks[index] мог бы
    // оказаться undefined, если индексация где-то разъедется). Возвращая пару
    // { sink, reason } прямо оттуда, где сбой произошёл, мы вообще не индексируем массив.
    //
    // ErrorSink.send по типу обещает Promise<void>, но рантайм это не проверяет — обычная
    // (не async) функция может бросить СИНХРОННО, до того как вернуть хоть какой-то
    // Promise. Синхронный throw внутри колбэка Array.prototype.map прервал бы саму
    // итерацию — приёмники ПОСЛЕ сломанного вообще не получили бы вызов. async (sink) =>
    // {...} с try/catch внутри ловит и такой throw, и throw из accepts(), не давая ему
    // прервать map() и не роняя Promise.all.
    const failures = (
      await Promise.all(
        this.sinks.map(async (sink) => {
          try {
            if (sink.accepts(event.severity)) {
              await sink.send(event);
            }
            return null;
          } catch (reason) {
            return { sink, reason };
          }
        }),
      )
    ).filter((failure): failure is { sink: ErrorSink; reason: unknown } => failure !== null);

    // Сбой самого приёмника (не приложения) логируем в console.error напрямую, а не
    // через this.report(...): если сломан именно приёмник, повторный report() пройдёт
    // по тем же приёмникам и либо зациклится, либо снова тихо упадёт тем же путём.
    // console.error — независимый нижний уровень, не зависящий от здоровья sinks.
    try {
      for (const { sink, reason } of failures) {
        console.error(`ErrorSink failed: ${sink.constructor.name}`, reason);
      }
    } catch {
      // Последний рубеж. report() обещает не бросать НИКОГДА (раздел 15 архитектуры), а
      // console.error сам способен бросить — например, EPIPE, если под PM2 поток вывода
      // процесса уже закрыт с другой стороны. Пустой catch обычно признак проглоченной
      // ошибки, про которую забыли, но здесь это осознанный выбор: логировать сбой самого
      // логирования уже некуда — мы и так на нижнем уровне отчётности. Единственная
      // альтернатива — уронить report() целиком, что нарушило бы его главную гарантию.
    }
  }
}

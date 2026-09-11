/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/console-error-sink.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки, адаптер
 * РОЛЬ:          Первая реализация порта ErrorSink — печатает нормализованное
 *                событие в консоль на уровне, соответствующем severity
 * ПАТТЕРН:       Адаптер — конкретный канал для порта ErrorSink
 * ИСПОЛЬЗУЕТСЯ:  CompositeErrorReporter (следующий шаг урока 3)
 * ТЕСТЫ:         console-error-sink.test.ts
 * 1С:            строка в журнале регистрации с уровнем (Информация/Предупреждение/Ошибка)
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { Severity } from './app-error.ts';
import type { ErrorEvent } from './error-event.ts';
import type { ErrorSink } from './error-sink.ts';

// Имя метода console, а не сама функция: console[method] ищет метод заново при каждом
// вызове send(). Если бы здесь лежала ссылка на саму функцию (console.info),
// vi.spyOn(console, 'info') в тестах подменяет console.info уже ПОСЛЕ того, как этот
// модуль загружен, — сохранённая ссылка на старую функцию так и осталась бы старой,
// и шпион ничего бы не увидел.
const CONSOLE_METHOD_BY_SEVERITY: Record<Severity, 'info' | 'warn' | 'error'> = {
  info: 'info',
  warning: 'warn',
  error: 'error',
  critical: 'error',
};

export class ConsoleErrorSink implements ErrorSink {
  // Единственный приёмник пока — фильтровать не от чего. Смысл появится со вторым
  // приёмником (например, Telegram, который не должен будить владельца на 'info').
  accepts(): boolean {
    return true;
  }

  async send(event: ErrorEvent): Promise<void> {
    const method = CONSOLE_METHOD_BY_SEVERITY[event.severity];
    const line = `[${event.severity.toUpperCase()}] ${event.code}: ${event.message}`;

    // event.context передаём отдельным аргументом console.*, а не через
    // JSON.stringify(event.context): деньги в проекте — bigint (Money, урок 6), а
    // JSON.stringify бросает TypeError на bigint ("Do not know how to serialize a BigInt")
    // и на циклических ссылках ("Converting circular structure to JSON"). console.*
    // печатает объект через util.inspect, который спокойно переживает и то, и другое.
    const extras: unknown[] = [event.context];

    // Стек и цепочку причин показываем только для error/critical — на info/warning это
    // шум. Оба добавляем В ТОТ ЖЕ вызов console.*, а не отдельными console.error(...)
    // после: под PM2 несколько процессов пишут в один и тот же поток вывода, и строки от
    // разных вызовов одного события могут перемежаться со строками совсем другого события.
    if (event.severity === 'error' || event.severity === 'critical') {
      if (event.stack !== undefined) {
        extras.push(event.stack);
      }
      if (event.cause !== undefined) {
        // cause печатаем как объект, а не как строку: Node (util.inspect) сам развернёт
        // цепочку причин со стеками, если cause — тоже Error.
        extras.push(event.cause);
      }
    }

    console[method](line, ...extras);
  }
}

# Урок 4 (Sprint 02) — план: 4a (маскировка) + 4b (ограничитель) + ритуал «шести вопросов»

## Контекст

Спринт 02 — `docs/sprints/sprint-02-plan.md`, уроки 1–3 готовы (✅) в `src/shared/errors/`.
Урок 4 (Декоратор) разбит на **4a — маскировка** и **4b — ограничитель повторов**. Процесс
(`CLAUDE.md`/`.claude/output-styles/mentor.md`, ритуал шести вопросов) закреплён и закоммичен
ранее — в этом плане не трогаем.

Это финальная (четвёртая) версия плана: три раунда ревью нашли баги в дизайне, включая баги
**в самих предыдущих исправлениях** — не в исходном коде, а в том, что чинили. Главный урок:
защита от одного риска может тихо создать другой (упрощение логирования в композите сняло
защиту от синхронного throw при вычислении имени приёмника; попытка сохранить тип честной
кастом-строкой `as string` сама была нечестной; независимые пределы `depth`/`items`
перемножаются, если их не завязать на общий бюджет). Раздел «Четыре раунда ревью» в шаге 8
разбирает это подробно как часть конспекта.

---

## 4a — маскировка

### Шаг 1 — `mask-secrets.ts` + `mask-secrets.test.ts`

Три шаблона — T-Invest, Telegram-бот, `Bearer`-заголовок любого формата (закрывает часть
открытого вопроса «токен Telegram в URL» раньше срока — вместе с `URL`→`href` из шага 2):

```ts
const SECRET_PATTERNS: readonly { pattern: RegExp; mask: string }[] = [
  { pattern: /\bt\.[\w-]{20,}/g, mask: 't.***' }, // токен T-Invest API
  { pattern: /\b\d{6,}:[\w-]{30,}/g, mask: '[telegram-bot-token]' }, // токен Telegram-бота
  { pattern: /\bBearer\s+[\w.-]{10,}/gi, mask: 'Bearer [masked]' }, // Authorization: Bearer …
];

export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, { pattern, mask }) => acc.replaceAll(pattern, mask), text);
}
```

**Таблица шести вопросов:**

| Вопрос | Ответ |
|---|---|
| `[исключение]` | Не применимо: чистая функция над `string`, `replaceAll` с корректным regex-литералом не бросает |
| `[гонка]` | Не применимо: `replaceAll` не полагается на `lastIndex` общего regex-объекта |
| `[завершение]` | Не применимо: синхронная операция без побочных эффектов |
| `[секрет]` | Тест: токен T-Invest в начале/середине/конце строки; несколько токенов; токен на `-`; короткая последовательность ниже порога — не маскируется; telegram-токен маскируется; `Bearer <токен>` маскируется, префикс `Bearer ` остаётся читаемым; T-Invest и Telegram-токен в одной строке маскируются независимо |
| `[рост]` | Не применимо: результат не накапливается |
| `[типы]` | Ответственность разделена: сама функция закрыта тестами со строками; проверка `typeof === 'string'` до вызова — у каждого вызывающего места (тест в `error-event.ts`) |

Untagged: identity (без секретов), пустая строка, регресс на `lastIndex` (два вызова подряд —
одинаковый результат).

**Открытый вопрос:** токен Telegram-бота в URL — Sprint 03 (частично закрыт: `SECRET_PATTERNS`
и `URL → href` в шаге 2 уже ловят его в тексте/адресе).

`maskSecrets` не экспортируется из `index.ts` — до урока 9 (`Logger`).

### Шаг 2 — правка `error-event.ts` (+ тесты)

Общий, не сбрасывающийся `depth` + общий бюджет узлов на весь вызов `toErrorEvent` — иначе
чередование `cause`↔`context` обходит оба предела по отдельности, а независимые пределы
глубины/размера коллекции перемножаются на патологическом входе (до 50⁶ узлов):

```ts
interface MaskWalk {
  readonly ancestors: Set<object>; // предки текущего пути рекурсии — для циклов
  budget: number;                  // общий бюджет узлов на весь вызов — против N^depth
}

// 8 — с запасом покрывает любую реалистичную ошибку (cause-цепочка в несколько уровней +
// context в несколько уровней), но не даёт зацикленной библиотеке-обёртке или намеренно
// патологическому входу рекурсировать бесконечно. Один счётчик на cause И context вместе —
// раздельные счётчики обходятся чередованием типов на границе.
const MAX_DEPTH = 8;
// 50 сущностей в context/cause — то, что разработчик мог положить руками (список ордеров за
// тик, батч свечей). Больше — почти наверняка не диагностика, а целый датасет, попавший в
// context по ошибке.
const MAX_COLLECTION_ITEMS = 50;
// 1000 контейнеров суммарно за вызов — с запасом покрывает любую реалистичную ошибку на полную
// глубину и с полными коллекциями на каждом уровне, но не даёт патологическому 50-на-каждом-
// из-6-уровней входу (до 50⁶ узлов) обработаться за неприемлемое время.
const MAX_NODE_BUDGET = 1000;
```

Честные типы вместо `as string` — нормализация ГАРАНТИРУЕТ `message: string`/
`stack: string | undefined`, а не лжёт компилятору приведением типа:

```ts
function toSafeString(value: unknown): string {
  try {
    return truncateAfterMasking(maskSecrets(typeof value === 'string' ? value : String(value)));
  } catch {
    return '[unprintable]'; // String(value) тоже может бросить — Object.create(null), урок 3
  }
}

function toSafeStack(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined; // тип соврал — отбрасываем, не пробрасываем как есть
  return truncateAfterMasking(maskSecrets(value));
}
```

Обрезка длины — ПОСЛЕ маскировки, не до (иначе токен, разрезанный обрезкой пополам, может
остаться короче порога шаблона `{20,}` и не совпасть с regex — видимый хвост утечёт):

```ts
// 2000 символов с запасом покрывает любое человекочитаемое сообщение об ошибке и разумный
// stack trace. Длиннее — уже не диагностика для человека, а вероятный сериализованный дамп
// данных, случайно попавший в message при throw.
const MAX_STRING_LENGTH = 2000;

function truncateAfterMasking(masked: string): string {
  return masked.length > MAX_STRING_LENGTH ? `${masked.slice(0, MAX_STRING_LENGTH)}[...truncated]` : masked;
}
```

Мердж контекста по ключам (не спред: `{ ...context, ...error.context }` вычисляет все геттеры
сразу — один бросающий роняет `toErrorEvent` целиком, ретрофикс урока 3):

```ts
function mergeContext(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const k of Object.keys(base)) {
    try { result[k] = base[k]; } catch { result[k] = '[unreadable]'; }
  }
  for (const k of Object.keys(overrides)) {
    try { result[k] = overrides[k]; } catch { result[k] = '[unreadable]'; }
  }
  return result;
}
```

Полная маскировка `cause`/`context` — единый бюджет обхода (`walk`), `Map`/`Set` — не как
обычные объекты, `Date`/`URL`/`Buffer`/`TypedArray` — по своим правилам, собственные поля
системных ошибок (`code`/`errno`/`syscall`/`hostname`) и `AggregateError.errors` — через ту же
рекурсию, маскировка по имени ключа (включая объект-значение, не только строку), ancestors —
по предкам текущего пути (не «посещённые навсегда» — общая ссылка в `cause` и `context`
одновременно не цикл), локальная деградация поля при бросающем геттере:

```ts
const SENSITIVE_KEY =
  /token|secret|password|authorization|api[-_]?key|private[-_]?key|mnemonic|seed|cookie|credential|passphrase/i;
const RESERVED_ERROR_KEYS = new Set(['message', 'stack', 'cause', 'name']);

function maskCause(cause: unknown, depth: number, walk: MaskWalk): unknown {
  if (typeof cause === 'string') return truncateAfterMasking(maskSecrets(cause));
  if (cause === null || typeof cause !== 'object') return cause;
  if (walk.ancestors.has(cause)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[depth exceeded]';
  if (walk.budget <= 0) return '[budget exceeded]';
  walk.budget--;

  if (!(cause instanceof Error)) return maskContextValue(null, cause, depth + 1, walk);

  walk.ancestors.add(cause);
  try {
    const masked = new Error(toSafeString(cause.message));
    masked.name = cause.name; // геттер name/stack, бросающий при чтении, — открытый вопрос
    masked.stack = toSafeStack(cause.stack);
    if ('cause' in cause) (masked as { cause?: unknown }).cause = maskCause(cause.cause, depth + 1, walk);

    // Node-овые системные ошибки кладут суть сбоя в собственные перечисляемые поля —
    // code ('ECONNRESET'), errno, syscall, hostname, port — не в message/stack.
    const skipKeys = cause instanceof AggregateError ? new Set([...RESERVED_ERROR_KEYS, 'errors']) : RESERVED_ERROR_KEYS;
    for (const k of Object.keys(cause)) {
      if (skipKeys.has(k)) continue;
      try {
        (masked as Record<string, unknown>)[k] = maskContextValue(k, (cause as Record<string, unknown>)[k], depth + 1, walk);
      } catch {
        (masked as Record<string, unknown>)[k] = '[unreadable]';
      }
    }
    if (cause instanceof AggregateError) {
      // fetch в Node заворачивает сетевой сбой сюда — продолжаем ТОТ ЖЕ depth, не сбрасываем.
      (masked as { errors?: unknown[] }).errors = cause.errors.map((e) => maskCause(e, depth + 1, walk));
    }
    if (cause instanceof AppError) {
      Object.assign(masked, { code: cause.code, severity: cause.severity, context: maskContextValue(null, cause.context, depth + 1, walk) });
    }
    return Object.freeze(masked);
  } finally {
    walk.ancestors.delete(cause);
  }
}

function maskContextValue(key: string | null, value: unknown, depth: number, walk: MaskWalk): unknown {
  const sensitiveKey = key !== null && SENSITIVE_KEY.test(key);
  if (sensitiveKey && (typeof value === 'string' || (value !== null && typeof value === 'object'))) return '[masked]';
  if (typeof value === 'string') return truncateAfterMasking(maskSecrets(value));
  if (value === null || typeof value !== 'object') return value; // bigint, число — не трогаем

  if (value instanceof Date) return value; // МУТАБЕЛЕН по ссылке — открытый вопрос
  if (value instanceof URL) return maskSecrets(value.href);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;
  if (value instanceof Error) return maskCause(value, depth + 1, walk);

  if (walk.ancestors.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[depth exceeded]';
  if (walk.budget <= 0) return '[budget exceeded]';
  walk.budget--;

  walk.ancestors.add(value);
  try {
    if (value instanceof Map) {
      const entries = [...value.entries()];
      const limited = entries.slice(0, MAX_COLLECTION_ITEMS).map(([k, v]) => Object.freeze([
        maskContextValue(null, k, depth + 1, walk),
        // Ключ Map — тоже имя поля: new Map([['authorization', 'Bearer …']]) обязан
        // маскироваться по ключу так же, как { authorization: '...' } в обычном объекте.
        maskContextValue(typeof k === 'string' ? k : null, v, depth + 1, walk),
      ]));
      if (entries.length > MAX_COLLECTION_ITEMS) limited.push(`[...ещё ${entries.length - MAX_COLLECTION_ITEMS}]`);
      return Object.freeze(limited);
    }
    if (value instanceof Set) {
      const items = [...value.values()];
      const limited = items.slice(0, MAX_COLLECTION_ITEMS).map((v) => maskContextValue(null, v, depth + 1, walk));
      if (items.length > MAX_COLLECTION_ITEMS) limited.push(`[...ещё ${items.length - MAX_COLLECTION_ITEMS}]`);
      return Object.freeze(limited);
    }
    if (Array.isArray(value)) {
      const limited = value.slice(0, MAX_COLLECTION_ITEMS).map((item) => maskContextValue(null, item, depth + 1, walk));
      if (value.length > MAX_COLLECTION_ITEMS) limited.push(`[...ещё ${value.length - MAX_COLLECTION_ITEMS}]`);
      return Object.freeze(limited);
    }
    const keys = Object.keys(value); // не видит #private-поля класса — открытый вопрос
    const result: Record<string, unknown> = {};
    for (const k of keys.slice(0, MAX_COLLECTION_ITEMS)) {
      try { result[k] = maskContextValue(k, (value as Record<string, unknown>)[k], depth + 1, walk); }
      catch { result[k] = '[unreadable]'; } // геттер поля бросил — деградируем локально
    }
    if (keys.length > MAX_COLLECTION_ITEMS) result['__truncated__'] = `[...ещё ${keys.length - MAX_COLLECTION_ITEMS} полей]`;
    return Object.freeze(result); // глубокая заморозка — каждый построенный узел
  } finally {
    walk.ancestors.delete(value);
  }
}

function freezeEvent(context: Record<string, unknown>, rest: Omit<ErrorEvent, 'context'>): ErrorEvent {
  const walk: MaskWalk = { ancestors: new Set<object>(), budget: MAX_NODE_BUDGET };
  return Object.freeze({
    ...rest,
    message: toSafeString(rest.message),
    stack: toSafeStack(rest.stack),
    cause: rest.cause === undefined ? undefined : maskCause(rest.cause, 0, walk),
    context: maskContextValue(null, context, 0, walk) as Readonly<Record<string, unknown>>,
  });
}
```

В ветке `AppError` внутри `toErrorEvent` — `mergeContext(context, error.context)` вместо
`{ ...context, ...error.context }`.

**Таблица шести вопросов:**

| Вопрос | Ответ |
|---|---|
| `[исключение]` | Тесты: геттер, бросающий на верхнем уровне `context`/`error.context` (`mergeContext`) и на вложенном поле (`maskContextValue`) — деградирует только затронутый ключ, не роняет `toErrorEvent` |
| `[гонка]` | Не применимо: чистое синхронное преобразование, `walk` создаётся заново на каждый вызов |
| `[завершение]` | Не применимо: между вызовами ничего не накапливается |
| `[секрет]` | Токен в `message`/`stack`/цепочке `cause` (глубже `MAX_DEPTH` — обрезается); циклический `cause`/`context` — не зацикливается; плоский/вложенный/массивный `context`; ключ `Authorization` — строка ИЛИ объект скрыты целиком; `api_key`/`private_key`/`mnemonic`/`seed`/`cookie`/`credential`/`passphrase` — тоже распознаются; `Map` с ключом `'authorization'` — по имени ключа; `URL` с токеном в query — через `href`; `Error` напрямую в `context` — через `maskCause`; объект-не-`Error` в `cause` — как context; системная ошибка (`code`/`errno`/`syscall`/`hostname`) в `cause` — поля скопированы и замаскированы; `AggregateError.errors` — вложенные причины замаскированы; токен на границе `MAX_STRING_LENGTH` — маскируется целиком (маска → обрезка, не наоборот) |
| `[рост]` | Цепочка `cause` из 10 звеньев — остановка на `MAX_DEPTH`; общая ссылка на один объект одновременно в `cause` и `context` — не цикл; объект 50×50×50 — обрабатывается быстро, обрезан по бюджету; цепочка `Error → объект → Error → …` глубиной 100 — ограничена общим `MAX_DEPTH`, не сбрасывается на переходах типов |
| `[типы]` | `Error` напрямую в `context` — `stack` не enumerable, нужен явный `instanceof Error`; bigint под ключом `token` — не тронут; `Date`/`Map`/`Set` — не превращаются в `{}`; `Buffer`/`TypedArray` — `[binary N bytes]`; `err.message = 123` и `Object.create(null)` — `toSafeString` не бросает, даёт `'123'`/`'[unprintable]'`, не мусор с ложной гарантией `string` |

Untagged: построенное дерево заморожено на каждом уровне. Прогнать все существующие тесты
`error-event.test.ts`.

---

## 4b — общий хелпер логирования, ограничитель, ретрофикс композита, `index.ts`, ADR-011

### Шаг 3 — `log-delivery-failure.ts` + тест

Общая точка безопасного логирования сбоя ДОСТАВКИ отчёта (не самой ошибки) — использует
`CompositeErrorReporter` и `RateLimitedErrorReporter`. Не экспортируется из `index.ts`.

```ts
import { toErrorEvent } from './error-event.ts';

export function logDeliveryFailure(label: string, reason: unknown): void {
  try {
    const safe = toErrorEvent(reason);
    // stack — отдельным аргументом console.error, не полем объекта: многострочный текст
    // стека не тонет внутри однострочной печати объекта.
    console.error(label, { message: safe.message, cause: safe.cause, context: safe.context }, safe.stack);
  } catch {
    // последний рубеж — сюда уже некуда логировать сбой самого логирования
  }
}
```

**Таблица шести вопросов:**

| Вопрос | Ответ |
|---|---|
| `[исключение]` | Тест: `console.error` сам бросает — `logDeliveryFailure` не пробрасывает исключение |
| `[гонка]` | Не применимо: нет общего состояния |
| `[завершение]` | Не применимо: синхронная печать |
| `[секрет]` | Тест: `reason` с токеном в `message` и в `stack` — ни в одном аргументе `console.error` токена нет |
| `[рост]` | Не применимо |
| `[типы]` | Не применимо: `reason: unknown` уходит в уже безопасную `toErrorEvent` |

### Шаг 4 — `rate-limited-error-reporter.ts` + тест

Параметры — объектом опций; критические-но-не-фатальные ошибки участвуют в троттлинге со
своим коротким окном (не обходят его совсем); ключ — `severity:code` с отпечатком ≤ 200
символов (UUID/hex тоже → `#`) и отдельной корзиной переполнения на severity; `fatal` — из
исходного `context` вызова, не из смерженного `event.context`; снимок `event.context`, не
ссылка на объект вызывающего; тело `report()` целиком — «последний рубеж»; после `flushAll()`
— необратимый режим слива без троттлинга.

```ts
export interface RateLimitedErrorReporterOptions {
  readonly windowMs?: number;
  readonly criticalWindowMs?: number;
  readonly maxTrackedKeys?: number;
}

const OVERFLOW_KEY = '__overflow__';
// 200 символов — отпечаток используется как ключ Map, а не как диагностика для человека:
// message уже мог быть обрезан до 2000 символов (MAX_STRING_LENGTH), этого достаточно для
// читаемости, но избыточно много для ключа коллекции.
const MAX_FINGERPRINT_LENGTH = 200;

export class RateLimitedErrorReporter implements ErrorReporter {
  private readonly windowMs: number;
  private readonly criticalWindowMs: number;
  private readonly maxTrackedKeys: number;
  private readonly state = new Map<string, {
    count: number; error: unknown; context: Readonly<Record<string, unknown>>;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private drained = false;

  constructor(private readonly inner: ErrorReporter, options: RateLimitedErrorReporterOptions = {}) {
    // 5 минут — дословно из раздела 15 архитектуры: «через несколько минут приходит
    // "повторилась 37 раз"».
    this.windowMs = options.windowMs ?? 5 * 60 * 1000;
    // 1 минута — короче обычного: критическая ошибка обязана дойти быстро, но всё ещё гасит
    // короткий всплеск повторов одной причины. Без предела шторм РАЗНЫХ критических кодов
    // завалил бы канал доставки так же, как без ограничителя вовсе.
    this.criticalWindowMs = options.criticalWindowMs ?? 60 * 1000;
    // 500 ключей — с запасом покрывает число реальных типов сбоёв; то, что не укладывается,
    // скорее всего, уже не код ошибки, а строка, сгенерированная на лету (см. переполнение).
    this.maxTrackedKeys = options.maxTrackedKeys ?? 500;
  }

  async report(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    try {
      const event = toErrorEvent(error, context);

      // fatal — из ИСХОДНОГО context вызова, не из event.context: собственный context
      // ошибки может случайно перекрыть { fatal: true } вызывающего своим { fatal: false }.
      // drained — после flushAll() новые окна больше не заводим.
      if (this.drained || context.fatal === true) {
        try { await this.inner.report(error, context); }
        catch (reason) { logDeliveryFailure('RateLimitedErrorReporter: inner.report failed', reason); }
        return;
      }

      const windowMs = event.severity === 'critical' ? this.criticalWindowMs : this.windowMs;
      const key = this.resolveKey(event);
      const existing = this.state.get(key);

      if (existing !== undefined) {
        existing.count++;
        existing.error = error;
        existing.context = event.context; // снимок, не ссылка на context вызывающего
        return;
      }

      const timer = setTimeout(() => void this.flush(key), windowMs);
      timer.unref?.();
      this.state.set(key, { count: 0, error, context: event.context, timer });

      try {
        await this.inner.report(error, context);
      } catch (reason) {
        logDeliveryFailure('RateLimitedErrorReporter: inner.report failed', reason);
      }
    } catch (reason) {
      // «Последний рубеж» на весь метод, не только на вызов inner.report.
      logDeliveryFailure('RateLimitedErrorReporter: report() failed internally', reason);
    }
  }

  async flushAll(): Promise<void> {
    this.drained = true; // до await — новые report() увидят это сразу
    await Promise.all([...this.state.keys()].map((key) => this.flush(key)));
  }

  private async flush(key: string): Promise<void> {
    const entry = this.state.get(key);
    this.state.delete(key);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    if (entry.count === 0) return;
    try {
      await this.inner.report(entry.error, { ...entry.context, repeatCount: entry.count });
    } catch (reason) {
      logDeliveryFailure('RateLimitedErrorReporter: inner.report failed', reason);
    }
  }

  private resolveKey(event: ErrorEvent): string {
    const fingerprint = event.code === 'UNKNOWN_ERROR' ? this.fingerprintMessage(event.message) : event.code;
    const rawKey = `${event.severity}:${fingerprint}`;
    const overflowKey = `${OVERFLOW_KEY}:${event.severity}`;
    if (rawKey !== overflowKey && !this.state.has(rawKey) && this.state.size >= this.maxTrackedKeys) {
      return overflowKey;
    }
    return rawKey;
  }

  private fingerprintMessage(message: string): string {
    const normalized = message
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#') // UUID — раньше hex
      .replace(/\b[0-9a-f]{16,}\b/gi, '#') // длинный hex (хэши, id)
      .replace(/\d+/g, '#');
    return normalized.length > MAX_FINGERPRINT_LENGTH ? normalized.slice(0, MAX_FINGERPRINT_LENGTH) : normalized;
  }
}
```

**Таблица шести вопросов:**

| Вопрос | Ответ |
|---|---|
| `[исключение]` | Сбой немедленной отправки; сбой внутри `flush()`; вся `report()` в защите |
| `[гонка]` | Несколько `report()` без await между ними — 1 вызов `inner.report` |
| `[завершение]` | `flushAll()` не теряет накопленное, переходит в режим слива; `context.fatal: true` — всегда немедленно, даже если `error.context.fatal === false`; `severity: 'critical'` (не fatal) — не безусловный обход, троттлится своим коротким окном |
| `[секрет]` | Сбой `inner.report` с токеном — не светит его через `logDeliveryFailure` |
| `[рост]` | Отпечаток `UNKNOWN_ERROR`; переполнение `maxTrackedKeys` по каждому severity; UUID/длинный hex → `#`; сообщение длиннее 200 символов — отпечаток обрезан |
| `[типы]` | Синхронный `throw` в не-`async` `inner.report` — не роняет `report()` |

Untagged: базовое поведение декоратора, снимок контекста от мутации вызывающим, `severity:code`
— критическая и обычная ошибка с одинаковым `code` троттлятся раздельно.

### Шаг 5 — ретроактивный фикс `composite-error-reporter.ts`

Внешний `try/catch` вокруг цикла — обязателен: `sink.constructor.name` вычисляется ДО входа в
`logDeliveryFailure`, вне её защиты. Приёмник без прототипа (`Object.create(null)`) не имеет
`constructor` — `.name` на `undefined` бросает `TypeError`, ничем не перехваченный без внешней
защиты.

```ts
try {
  for (const { sink, reason } of failures) {
    logDeliveryFailure(`ErrorSink failed: ${sink.constructor.name}`, reason);
  }
} catch {
  // последний рубеж — sink.constructor.name сам может бросить, и это происходит ДО
  // logDeliveryFailure, вне её собственной защиты
}
```

**Шесть вопросов:** только `[секрет]` (не изменился от прошлой правки) и новый
`[исключение]` — тест: приёмник из `Object.create(null)`, чей `send()` отклоняется, —
`report()` композита всё равно резолвится.

### Шаг 6 — правка `index.ts`

Экспортировать `RateLimitedErrorReporter` и `RateLimitedErrorReporterOptions`. `maskSecrets`,
`logDeliveryFailure` — не экспортировать.

### Шаг 7 — ADR-011

`docs/architecture/adr/011-error-reporter-pipeline.md`.

- **Контекст.** Единый контракт, рассылка без взаимного влияния сбоев, отсутствие спама
  дублями (включая критические — без потери самих критических), отсутствие утечки секретов (в
  самой ошибке и в отчёте о сбое её доставки), устойчивость к гонкам, к завершению процесса, к
  неограниченно большим/глубоким данным ошибки.
- **Решение.** `new RateLimitedErrorReporter(new CompositeErrorReporter([...sinks]))`.
  Маскировка — часть нормализации `toErrorEvent`: единый бюджет обхода (`ancestors` + `budget`,
  не сбрасывается на границе `cause`/`context`); честные типы через `toSafeString`/`toSafeStack`
  без `as`; обрезка длины строго после маскировки; `Map`/`Set`/`Date`/`URL`/`Buffer` — по своим
  правилам; маскировка по имени ключа (`token|secret|password|authorization|api[-_]?key|
  private[-_]?key|mnemonic|seed|cookie|credential|passphrase`) независимо от формата значения;
  собственные поля системных ошибок и `AggregateError.errors` в `cause`; циклы — по предкам
  текущего пути, не «всё когда-либо посещённое»; локальная деградация поля при бросающем
  геттере, включая верхний уровень мерджа `context`/`error.context`; глубокая заморозка.
  Троттлинг — ключ `severity:code` (отпечаток для `UNKNOWN_ERROR`, UUID/hex → `#`, ≤ 200
  символов), окно `windowMs` (5 мин), для `critical` (не fatal) — отдельное короткое
  `criticalWindowMs` (60с), `maxTrackedKeys` (500) с корзиной переполнения на каждый severity.
  `fatal` — из исходного `context` вызова, не из смерженного `event.context`. Состояние —
  снимок `event.context`, не ссылка на объект вызывающего. После `flushAll()` — необратимый
  режим слива без троттлинга. Тело `report()` целиком — «последний рубеж». Вычисление имени
  приёмника в `CompositeErrorReporter` — внутри защищённой зоны (внешний `try/catch`). Сбой
  самого `inner.report`/`ErrorSink.send` — через общий `logDeliveryFailure`. Добавлены форматы
  секретов: токен Telegram-бота, `Authorization: Bearer …` любого формата.
- **Альтернативы (отклонены).** Маскировка внутри декоратора; чистый троттлинг без сводки;
  ключ строго по `code` без `severity`/отпечатка; порт `Clock` сейчас (YAGNI); запись в `Map`
  после `await`; неограниченный `Map` ключей; логирование сбоя доставки напрямую, без
  `toErrorEvent`; безусловный обход ограничителя для всех критических ошибок; хранение ссылки
  на `context` вызывающего вместо снимка; маскировка без пределов глубины/размера; раздельные
  независимые пределы глубины для `cause` и `context` без общего бюджета — перемножаются на
  патологическом входе; `as string` вместо гарантирующей нормализации; обрезка строки до
  маскировки; чтение `fatal` из `event.context`; временный слив с возвратом к троттлингу после
  `flushAll()` — не нужен, `flushAll()` вызывается один раз, на завершении процесса (YAGNI).
- **Последствия.** Расширенный `SENSITIVE_KEY` — осознанный компромисс в пользу ложных
  срабатываний (`seed` может встретиться в невинном поле — принято, цена пропущенного секрета
  выше). Маскировка по формату — T-Invest, Telegram-бот, `Bearer` — расширяется по мере
  появления новых форматов. Корзина переполнения группирует разнородные ошибки грубо.
  `flushAll()` ждёт `inner.report` без таймаута — кандидат в седьмой вопрос ритуала
  `[таймаут]` (урок 5). Известные, сознательно отложенные пробелы — см. открытые вопросы ниже.

### Шаг 8 — конспекты и закрытие

`docs/lessons/sprint-02/lesson-04a-mask-secrets.md` и
`docs/lessons/sprint-02/lesson-04b-rate-limited-error-reporter.md`, структура — как
`lesson-03...md`. В 4b — раздел **«Четыре раунда ревью»**:

| Раунд | Что нашли | Какой вопрос | Что было бы в бою, если бы не нашли |
|---|---|---|---|
| 1. Первое применение ритуала к готовому дизайну (до кода) | `Error`, положенный в `context` напрямую (не через `cause`), маскировался не полностью — `stack` не enumerable; сбой доставки логировался сырым `reason` | `[типы]`, `[секрет]` | Токен в `stack` чужой ошибки в `context` утёк бы в лог; токен из текста сетевого сбоя приёмника ушёл бы в консоль/Telegram в обход маскировки |
| 2. Первый код-ревью готового наброска 4a/4b | «Посещённые навсегда» `WeakSet` путал общую ссылку с циклом; `Map` с секретным именем ключа маскировался не по ключу; список чувствительных имён был узким; критические ошибки предлагалось пропускать без предела | `[рост]`, `[секрет]` | Общая ссылка в `cause` и `context` ошибочно превращалась бы в `'[circular]'`, теряя данные; `new Map([['authorization', 'Bearer …']])` тихо пропускал бы токен; шторм разных критических ошибок заваливал бы Telegram так же, как без ограничителя |
| 3. Второй код-ревью — по исправлениям раунда 2 | Независимые пределы глубины/размера перемножаются (до 50⁶ узлов); глубина сбрасывалась на границе `cause`↔`context`; обрезка строки была до маскировки; `fatal` читался из смерженного `context`; ключ не учитывал `severity`; после `flushAll()` окна продолжали копиться | `[рост]`, `[секрет]`, `[завершение]` | Глубокая/чередующаяся структура могла зависнуть на маскировке; урезанный токен оставался бы частично виден; `{ fatal: false }` в `context` ошибки тихо отключал бы обязательный алерт о падении процесса |
| 4. Аудит исправлений раунда 3 | Уборка внешнего `try/catch` в композите сняла защиту с `sink.constructor.name`; `as string` соврал компилятору о типе `message` | `[исключение]`, `[типы]` | Нестандартный приёмник (`Object.create(null)`) или ошибка с нечисловым `message` превращали бы «`ErrorReporter` не бросает никогда» в ложь, ровно когда отчёт нужнее всего |

**Главный вывод:** исправление — тоже новый код, и шесть вопросов задаются ему заново, а не
только первой версии. Раунд 4 — самый показательный пример: попытка закрыть один риск (утечку
секрета через прямой `console.error`) породила код, который сам не прошёл `[исключение]`; а
`as string` вместо честной проверки выдало желаемое за действительное по `[типы]` — и оба раза
цена была та же: нарушение главной гарантии модуля («не бросает никогда»), только что
казавшейся закрытой.

**Открытые вопросы:**
- Токен Telegram-бота в URL — Sprint 03 (частично закрыт: `SECRET_PATTERNS` и `URL → href` уже
  ловят его в тексте/адресе).
- `flushAll()` без таймаута на сетевой `inner.report` — урок 5, кандидат в `[таймаут]`.
- Исходная ошибка (`entry.error`) хранится в `Map` целиком до конца окна — потенциально
  большой объект держится в памяти дольше, чем нужно для одной лишь дедупликации по ключу.
- Геттеры `name`/`message`/`stack`, бросающие при чтении, у самого `cause` —
  `masked.name = cause.name` не обёрнут в try/catch, в отличие от собственных полей ошибки.
- `Date` в `context` копируется по ссылке, не клонируется — `Object.freeze` контейнера не
  мешает вызвать `date.setTime(...)` на самом объекте.
- `Object.keys` не видит `#private`-поля класса — общего решения для произвольных классов нет,
  только точечные случаи (`Error`, `Date`, `Map`, `Set`, `URL`).

Обновить статус 4a/4b на ✅, разбив строку 4 в `docs/sprints/sprint-02-plan.md`.

---

## Порядок и почему

1. `mask-secrets.ts` — разогрев + три формата секретов.
2. `error-event.ts` — общий бюджет обхода, честные типы, обрезка после маскировки.
3. `log-delivery-failure.ts` — общий хелпер.
4. `rate-limited-error-reporter.ts` — на готовых 2 и 3.
5. `composite-error-reporter.ts` — ретрофикс на готовом 3.
6. `index.ts`.
7. ADR-011.
8. Конспекты + статус спринта.

## Проверка

- `npm run typecheck`/`npm test` зелёные на каждом шаге, включая весь код уроков 1–3.
- Критерий 4a: токен нигде не утекает — ни полностью, ни обрезанным по длине; патологические
  структуры обрабатываются быстро и предсказуемо.
- Критерий 4b: `report()` не отклоняется ни при каких данных; фатальные — всегда немедленно, по
  исходному `context`; критические не обходят ограничитель безусловно; после `flushAll()` —
  троттлинга больше нет; сбой доставки нигде не светит секрет.
- `git status`/`git diff` — список файлов по плану.

## Критические файлы

- `src/shared/errors/mask-secrets.ts` (новый, 4a)
- `src/shared/errors/error-event.ts` (правка, 4a)
- `src/shared/errors/log-delivery-failure.ts` (новый, 4b)
- `src/shared/errors/rate-limited-error-reporter.ts` (новый, 4b)
- `src/shared/errors/composite-error-reporter.ts` (ретроактивная правка, 4b)
- `src/shared/errors/index.ts` (правка экспортов, 4b)
- `docs/architecture/adr/011-error-reporter-pipeline.md` (новый, 4b)
- `docs/lessons/sprint-02/lesson-04a-mask-secrets.md` (новый)
- `docs/lessons/sprint-02/lesson-04b-rate-limited-error-reporter.md` (новый)
- `docs/sprints/sprint-02-plan.md` (строка 4 → 4a/4b, статусы → ✅)

Не трогаем: `CLAUDE.md`, `.claude/output-styles/mentor.md` (сделано и закоммичено ранее).

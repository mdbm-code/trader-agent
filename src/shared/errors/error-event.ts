/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/error-event.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки
 * РОЛЬ:          Приводит что угодно, брошенное в report() (AppError, чужой Error,
 *                строку, произвольный объект), к одному виду — ErrorEvent, попутно
 *                маскируя секреты в message/stack/cause/context. Это единственная
 *                точка, где секрет нельзя не заметить: дальше с ErrorEvent работают
 *                все приёмники (ErrorSink), и им уже гарантированно безопасно
 * ПАТТЕРН:       Нормализация на границе — не GoF-паттерн, а приём: снаружи модуля
 *                report() принимает unknown, внутри всё дальше работает с одним
 *                безопасным типом. Обход cause/context — рекурсивный walker с общим
 *                бюджетом узлов на весь вызов (не независимые пределы по измерениям)
 * ИСПОЛЬЗУЕТСЯ:  CompositeErrorReporter.report() (урок 3)
 * ТЕСТЫ:         error-event.test.ts
 * 1С:            обработчик, который перед записью в журнал регистрации приводит
 *                разные источники ошибки (исключение, ошибка обмена, ошибка записи)
 *                к одной структуре и вырезает из неё пароли подключения
 * ────────────────────────────────────────────────────────────────────────────
 */
import { AppError, type Severity } from './app-error.ts';
import { maskSecrets } from './mask-secrets.ts';

export interface ErrorEvent {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
  readonly stack?: string;
}

// 8 — с запасом покрывает любую реалистичную ошибку (cause-цепочка в несколько уровней +
// context в несколько уровней), но не даёт зацикленной библиотеке-обёртке или намеренно
// патологическому входу рекурсировать бесконечно. Один счётчик на cause И context вместе —
// раздельные счётчики обходятся чередованием типов на границе (cause → объект → cause → …).
const MAX_DEPTH = 8;
// 50 сущностей в context/cause — то, что разработчик мог положить руками (список ордеров за
// тик, батч свечей). Больше — почти наверняка не диагностика, а целый датасет, попавший в
// context по ошибке.
const MAX_COLLECTION_ITEMS = 50;
// 1000 контейнеров суммарно за вызов — с запасом покрывает любую реалистичную ошибку на полную
// глубину и с полными коллекциями на каждом уровне, но не даёт патологическому
// 50-на-каждом-из-6-уровней входу (до 50⁶ узлов при независимых пределах) обработаться за
// неприемлемое время. Один общий счётчик вместо отдельных пределов на depth и на items —
// иначе пределы перемножаются.
const MAX_NODE_BUDGET = 1000;
// 2000 символов с запасом покрывает любое человекочитаемое сообщение об ошибке и разумный
// stack trace. Длиннее — уже не диагностика для человека, а вероятный сериализованный дамп
// данных, случайно попавший в message при throw.
const MAX_STRING_LENGTH = 2000;

// Список умышленно шире формальных названий полей: seed/mnemonic (крипто-кошельки),
// credential/passphrase — синонимы, которые встречаются в чужих библиотеках. Ложные
// срабатывания (поле seed для чего-то невинного) — принятая цена: пропущенный секрет
// обходится дороже.
const SENSITIVE_KEY =
  /token|secret|password|authorization|api[-_]?key|private[-_]?key|mnemonic|seed|cookie|credential|passphrase/i;
// Эти поля Error обрабатываются отдельно (message/stack — через toSafeString/toSafeStack,
// cause — рекурсивно через maskCause, name — читается отдельно) — цикл по Object.keys(cause)
// ниже не должен трогать их второй раз.
const RESERVED_ERROR_KEYS = new Set(['message', 'stack', 'cause', 'name']);

// Общее состояние одного вызова toErrorEvent, которое разделяют maskCause и
// maskContextValue: ancestors — предки ТЕКУЩЕГО пути рекурсии (не «когда-либо посещённое» —
// иначе общая ссылка на один объект в cause и в context ошибочно считалась бы циклом), budget
// — общий бюджет узлов на весь вызов (убывает и в cause, и в context, не сбрасывается на
// границе между ними).
interface MaskWalk {
  readonly ancestors: Set<object>;
  budget: number;
}

function truncateAfterMasking(masked: string): string {
  // Обрезка ПОСЛЕ маскировки, не до: если сначала обрезать длинную строку с токеном пополам,
  // остаток токена может оказаться короче порога шаблона (например, {20,} у T-Invest) и не
  // совпасть с regex — видимый хвост секрета утечёт в усечённой строке.
  return masked.length > MAX_STRING_LENGTH ? `${masked.slice(0, MAX_STRING_LENGTH)}[...truncated]` : masked;
}

// Честная альтернатива `as string`: `as` — обещание компилятору, не гарантия во время
// выполнения. message у Error по типам lib.d.ts всегда string, но ничто в рантайме этого не
// проверяет — код вида err.message = 123 компилятор не остановит нигде, кроме места
// присваивания с явным as. toSafeString проверяет typeof сам и гарантирует string на выходе
// независимо от того, что реально лежит в поле.
function toSafeString(value: unknown): string {
  try {
    return truncateAfterMasking(maskSecrets(typeof value === 'string' ? value : String(value)));
  } catch {
    // String(value) тоже может бросить — например, Object.create(null) (урок 3): у объекта
    // без прототипа нет ни toString, ни valueOf.
    return '[unprintable]';
  }
}

function toSafeStack(value: unknown): string | undefined {
  // В отличие от message, у stack нет осмысленной строки-замены при неверном типе — просто
  // отбрасываем: пробрасывать значение как есть означало бы соврать о типе дальше по цепочке.
  if (typeof value !== 'string') return undefined;
  return truncateAfterMasking(maskSecrets(value));
}

// Один геттер (name/message/stack/cause/errors у cause, у верхнеуровневой ошибки — cause/
// message/stack, сама перечень ключей через Object.keys — и у cause, и при мердже context)
// не должен ронять всю нормализацию — деградируем именно то поле, которое не удалось
// прочитать, вместо того чтобы дать исключению уйти наверх и обрушить всё событие до
// UNKNOWN_ERROR.
function safeRead<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

// Замена `{ ...base, ...overrides }`: спред читает ВСЕ геттеры обоих объектов сразу, и один
// бросающий геттер роняет весь мердж (а с ним — весь toErrorEvent). Обход по ключам с
// try/catch на каждый — как построчная обработка табличной части: одна плохая строка не
// должна ронять обработку всего документа. Само перечисление ключей (Object.keys) — тоже
// риск (Proxy с бросающим ownKeys), и это НЕ чтение отдельного значения — обычный try/catch
// на строку цикла его не поймает, нужен safeRead вокруг самого Object.keys, для обеих сторон
// мерджа: base приходит из вызова report() (может быть чем угодно), overrides — из
// error.context (у AppError это всегда собственный простой объект, но симметрия дешевле, чем
// объяснение, почему один аргумент защищён, а другой — нет).
function mergeContext(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of safeRead(() => Object.keys(base), [] as string[])) {
    try {
      result[key] = base[key];
    } catch {
      result[key] = '[unreadable]';
    }
  }
  for (const key of safeRead(() => Object.keys(overrides), [] as string[])) {
    try {
      result[key] = overrides[key];
    } catch {
      result[key] = '[unreadable]';
    }
  }
  return result;
}

// Рекурсивно маскирует cause: строку — как текст, Error — воссоздавая безопасную копию со
// своими полями, что угодно ещё — как обычное значение context (объект без прототипа Error
// маскируется по тем же правилам, что и вложенный объект в context).
//
// Не-Error cause (ветка ниже) расходует ОДИН узел бюджета и ОДНУ единицу глубины здесь, а
// затем ЕЩЁ раз — внутри maskContextValue, к которому делегирует эта ветка (у неё свой
// собственный guard на ancestors/depth/budget). Итого не-Error значение в cause стоит вдвое
// дороже по бюджету и на единицу глубже, чем то же значение, встреченное сразу в context.
// Не унифицировано намеренно: убрать двойной guard — значит завести третий код-путь только
// ради этого случая ради экономии одного узла бюджета из тысячи.
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
    // Плоский объект, а не new Error(...): решение см. ADR-011 (шаг 7). Коротко — копия
    // не притворяется «настоящей» ошибкой (в ней бывают строки-маркеры вида '[circular]'
    // вместо вложенной cause), а message/stack как обычные перечисляемые поля видны в
    // JSON.stringify и в console.*/util.inspect без специальных ухищрений. Цена: стек
    // печатается одной экранированной строкой, а не многострочным блоком — стек уже
    // решено передавать отдельным аргументом console.*, где это важно (logDeliveryFailure,
    // урок 4b), так что для человека в консоли ничего не теряется.
    const masked: Record<string, unknown> = {
      name: safeRead(() => cause.name, '[unreadable]'),
      message: safeRead(() => toSafeString(cause.message), '[unreadable]'),
      stack: safeRead(() => toSafeStack(cause.stack), '[unreadable]'),
    };
    // cause.cause — единственное чтение поля чужой ошибки здесь, которое раньше не шло через
    // safeRead: 'cause' in cause не читает значение (только проверяет наличие свойства), а вот
    // cause.cause — читает, и это тот же класс риска, что у name/message/stack. Без safeRead
    // бросок здесь уходил мимо finally этого try (там нет catch) прямо в общий catch
    // toErrorEvent — вся цепочка причин теряется, а с ней и code/context.
    if ('cause' in cause) {
      masked.cause = safeRead(() => maskCause(cause.cause, depth + 1, walk), '[unreadable]');
    }

    // Node-овые системные ошибки кладут суть сбоя в собственные перечисляемые поля —
    // code ('ECONNRESET'), errno, syscall, hostname, port — не в message/stack. Общий цикл
    // по Object.keys копирует и маскирует их вместе с любыми пользовательскими полями.
    const skipKeys =
      cause instanceof AggregateError ? new Set([...RESERVED_ERROR_KEYS, 'errors']) : RESERVED_ERROR_KEYS;
    const ownKeys = safeRead(() => Object.keys(cause), null);
    if (ownKeys !== null) {
      for (const key of ownKeys) {
        if (skipKeys.has(key)) continue;
        try {
          masked[key] = maskContextValue(key, (cause as unknown as Record<string, unknown>)[key], depth + 1, walk);
        } catch {
          masked[key] = '[unreadable]';
        }
      }
    }
    if (cause instanceof AggregateError) {
      // fetch в Node заворачивает сетевой сбой сюда — продолжаем ТОТ ЖЕ depth, не сбрасываем:
      // иначе цепочка Error → AggregateError → Error → … обходила бы предел глубины по кругу.
      masked.errors = safeRead<unknown[] | string>(
        () => cause.errors.map((e) => maskCause(e, depth + 1, walk)),
        '[unreadable]',
      );
    }
    if (cause instanceof AppError) {
      // Дублирует часть общего цикла выше: code/severity/context не входят в skipKeys, и
      // цикл по Object.keys уже мог их обработать (или деградировать в '[unreadable]', если
      // геттер конкретно этого поля бросил). Явное присваивание здесь гарантирует
      // ПРАВИЛЬНЫЙ результат для этих трёх полей независимо от того, что случилось в общем
      // цикле — осознанная избыточность, а не забытая оптимизация.
      //
      // Каждое поле — через свой safeRead, а не одним try/catch на весь Object.assign:
      // гранулярность деградации здесь намеренно выровнена с верхним уровнем toErrorEvent
      // (где то же самое сделано для code/severity/context AppError) — решение, а не копия.
      masked.code = safeRead(() => cause.code, 'UNKNOWN_ERROR');
      masked.severity = safeRead(() => cause.severity, 'error');
      // '[unreadable]', не {}: на верхнем уровне toErrorEvent пустой объект уместен — он
      // сливается с аргументом report() в mergeContext, и «ничего не добавилось» — честный
      // исход. Здесь никакого мерджа нет — context вложенной причины стоит сам по себе, и
      // {} выглядел бы как «контекста не было», а не как «не смогли прочитать».
      masked.context = safeRead(() => maskContextValue(null, cause.context, depth + 1, walk), '[unreadable]');
    }
    return Object.freeze(masked);
  } finally {
    // Убираем из ancestors при выходе из ветки, а не в конце всего обхода: ancestors — это
    // предки ТЕКУЩЕГО пути, поэтому один и тот же объект, встреченный в двух разных ветках
    // (а не как предок самого себя), не должен считаться циклом.
    walk.ancestors.delete(cause);
  }
}

function maskContextValue(key: string | null, value: unknown, depth: number, walk: MaskWalk): unknown {
  // Маскировка по имени ключа — для строк и объектов (не только форматных секретов):
  // `{ authorization: {...} }` прячется целиком, даже если это не строка, а вложенный объект
  // с токеном внутри. Примитивы (число, bool, bigint) НЕ маскируются даже под чувствительным
  // именем — сознательно: SENSITIVE_KEY специально широкий (совпадает с tokenExpiresAt,
  // secretVersion, refreshTokenTtl), и маскировка любого примитива под ним убила бы полезную
  // диагностику; секретов-примитивов (не строк) в этом проекте нет — токены T-Invest/Telegram
  // всегда строки.
  const sensitiveKey = key !== null && SENSITIVE_KEY.test(key);
  if (sensitiveKey && (typeof value === 'string' || (value !== null && typeof value === 'object'))) {
    return '[masked]';
  }
  if (typeof value === 'string') return truncateAfterMasking(maskSecrets(value));
  if (value === null || typeof value !== 'object') return value; // bigint, число — не трогаем

  if (value instanceof Date) return value; // мутабелен по ссылке — открытый вопрос
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
      // Не [...value.entries()].slice(...): спред материализует ВСЮ коллекцию (хоть 200 000
      // записей) прежде чем взять первые 50 — предел переставал бы ограничивать саму работу
      // обхода, а не только результат. Читаем итератор вручную и останавливаемся на 51-м
      // шаге (50 полезных + один, который обнаруживает, что дальше есть что-то ещё).
      // Точное число хвоста — через .size (O(1)), а не досчитыванием итератора.
      const limited: unknown[] = [];
      const iterator = value.entries();
      for (
        let step = iterator.next();
        !step.done && limited.length < MAX_COLLECTION_ITEMS;
        step = iterator.next()
      ) {
        const [k, v] = step.value;
        limited.push(
          Object.freeze([
            maskContextValue(null, k, depth + 1, walk),
            // Ключ Map — тоже имя поля: new Map([['authorization', 'Bearer …']]) обязан
            // маскироваться по ключу так же, как { authorization: '...' } в обычном объекте.
            maskContextValue(typeof k === 'string' ? k : null, v, depth + 1, walk),
          ]),
        );
      }
      if (value.size > MAX_COLLECTION_ITEMS) {
        limited.push(`[...ещё ${value.size - MAX_COLLECTION_ITEMS}]`);
      }
      return Object.freeze(limited);
    }
    if (value instanceof Set) {
      const limited: unknown[] = [];
      const iterator = value.values();
      for (
        let step = iterator.next();
        !step.done && limited.length < MAX_COLLECTION_ITEMS;
        step = iterator.next()
      ) {
        limited.push(maskContextValue(null, step.value, depth + 1, walk));
      }
      if (value.size > MAX_COLLECTION_ITEMS) {
        limited.push(`[...ещё ${value.size - MAX_COLLECTION_ITEMS}]`);
      }
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
      // Маскируем и имя ключа тем же форматным maskSecrets, что и текст: у Map ключ уже
      // маскируется (выше), у обычного объекта — нет, и `{ [`session-${token}`]: 1 }` утекал
      // бы через имя поля целиком мимо любой проверки значения. Если два РАЗНЫХ исходных
      // ключа после маскировки схлопываются в одно и то же имя (два токена одного формата с
      // одинаковым текстом вокруг) — побеждает тот, что обработан ПОСЛЕДНИМ по порядку
      // Object.keys. Не гонка (порядок детерминирован) и не диспетчеризация: осознанный
      // компромисс, суффиксы/счётчики для разрешения коллизий сознательно не вводим.
      const maskedKey = truncateAfterMasking(maskSecrets(k));
      try {
        result[maskedKey] = maskContextValue(k, (value as Record<string, unknown>)[k], depth + 1, walk);
      } catch {
        result[maskedKey] = '[unreadable]'; // геттер поля бросил — деградируем локально, не роняем всё
      }
    }
    if (keys.length > MAX_COLLECTION_ITEMS) {
      result['__truncated__'] = `[...ещё ${keys.length - MAX_COLLECTION_ITEMS} полей]`;
    }
    return Object.freeze(result); // глубокая заморозка — каждый построенный узел, не только верхний
  } finally {
    walk.ancestors.delete(value);
  }
}

// Событие уходит одним и тем же объектом сразу нескольким приёмникам параллельно
// (CompositeErrorReporter, урок 3) — значит ни один приёмник не должен иметь возможности
// поменять его для остальных. walk создаётся заново на каждый вызов — один общий бюджет узлов
// на cause И context вместе, без сброса между ними.
function freezeEvent(context: Record<string, unknown>, rest: Omit<ErrorEvent, 'context'>): ErrorEvent {
  const walk: MaskWalk = { ancestors: new Set<object>(), budget: MAX_NODE_BUDGET };

  // context и cause — каждый в своём try/catch, по той же причине: Object.keys/[...iterator]/
  // instanceof на самом ВЕРХНЕМ уровне ни того, ни другого не прикрыты ничьим внешним per-key
  // try/catch (он появляется только ВНУТРИ веток maskContextValue/maskCause, для вложенных
  // полей). Proxy с бросающим ownKeys на верхнем уровне context, или НЕ-Error объект с тем же
  // дефектом прямо в cause (maskCause делегирует такому в maskContextValue без всякой обёртки —
  // см. её же комментарий), уронили бы это без отдельной защиты здесь — а с ним и всё событие.
  let safeContext: Record<string, unknown>;
  try {
    safeContext = maskContextValue(null, context, 0, walk) as Record<string, unknown>;
  } catch {
    safeContext = { __context__: '[unreadable]' };
  }

  let safeCause: unknown;
  try {
    safeCause = rest.cause === undefined ? undefined : maskCause(rest.cause, 0, walk);
  } catch {
    safeCause = '[unreadable]';
  }

  return Object.freeze({
    ...rest,
    message: toSafeString(rest.message),
    stack: toSafeStack(rest.stack),
    cause: safeCause,
    context: Object.freeze(safeContext) as Readonly<Record<string, unknown>>,
  });
}

export function toErrorEvent(error: unknown, context: Record<string, unknown> = {}): ErrorEvent {
  try {
    if (error instanceof AppError) {
      // Контекст самой ошибки задан в месте сбоя (например, { orderId }) — он
      // конкретнее, чем context, переданный в report() (обычно общий фон вроде
      // { source: 'uncaughtException' }). Конкретное перекрывает общее: при
      // совпадении ключей побеждает error.context, а не аргумент report().
      //
      // code/severity/context — та же асимметрия, что уже была у message/cause/stack в этом
      // же литерале: обычное чтение свойства чужого (в смысле — не гарантированно нашего)
      // класса-наследника AppError, способное упасть на переопределённом геттере, и это
      // чтение — аргумент вызова freezeEvent()/mergeContext(), то есть выполняется ДО входа
      // в них, раньше любой защиты внутри. Симметрия здесь дешевле, чем объяснение, почему
      // соседнее поле в том же объекте защищено, а это — нет (тот же довод, что и у
      // mergeContext про обе стороны мерджа).
      return freezeEvent(mergeContext(context, safeRead(() => error.context, {})), {
        code: safeRead(() => error.code, 'UNKNOWN_ERROR'),
        severity: safeRead(() => error.severity, 'error'),
        message: safeRead(() => error.message, '[unreadable]'),
        // Та же асимметрия, что была у message/stack: error.cause — обычное чтение свойства,
        // способное упасть на бросающем геттере, и это чтение — аргумент вызова freezeEvent(),
        // то есть выполняется ДО входа в неё, раньше любой защиты внутри.
        cause: safeRead(() => error.cause, '[unreadable]'),
        stack: safeRead(() => error.stack, '[unreadable]'),
      });
    }

    if (error instanceof Error) {
      return freezeEvent(context, {
        code: 'UNKNOWN_ERROR',
        severity: 'error',
        message: safeRead(() => error.message, '[unreadable]'),
        cause: error,
        stack: safeRead(() => error.stack, '[unreadable]'),
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
    // Аварийная ветка НЕ переиспользует входной context: если мы здесь, что-то в обходе уже
    // однажды бросило — заново трогать те же (возможно, отравленные — Proxy с бросающим
    // ownKeys и т.п.) данные незачем, freezeEvent получает заведомо безопасный пустой объект.
    //
    // У toErrorEvent нет и не может быть типа "эта функция не бросает" — в TypeScript
    // такой аннотации не существует: компилятор проверяет форму значений, а не то,
    // кинет ли функция исключение по дороге к return. Поэтому гарантию "переживает
    // любой мусор на входе" обеспечиваем сами, явным try/catch, а не типами.
    return freezeEvent(
      {},
      {
        code: 'UNKNOWN_ERROR',
        severity: 'error',
        message: 'Не удалось нормализовать ошибку',
      },
    );
  }
}

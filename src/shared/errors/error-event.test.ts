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

    // С шага 2 cause проходит через maskCause — это уже не тот же объект, а безопасная
    // копия с тем же содержимым (см. описание [секрет]/[типы] ниже в этом файле).
    expect(event.cause).not.toBe(cause);
    expect((event.cause as Error).message).toBe(cause.message);
    expect(event.stack).toBe(error.stack);
  });

  test('чужой Error (не AppError) -> UNKNOWN_ERROR, severity error, cause = безопасная копия самой ошибки', () => {
    const error = new Error('boom');

    const event = toErrorEvent(error);

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.severity).toBe('error');
    expect(event.message).toBe('boom');
    expect(event.cause).not.toBe(error);
    expect((event.cause as Error).message).toBe(error.message);
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

  test('вложенный узел context заморожен так же, как верхний уровень', () => {
    const event = toErrorEvent(new Error('x'), { nested: { a: 1 } });

    expect(() => {
      (event.context.nested as Record<string, unknown>).a = 2;
    }).toThrow(TypeError);
  });
});

// Токены — не через mask-secrets.test.ts (там проверен сам regex), а как строительный
// материал: важно, что toErrorEvent находит их там, куда мы их положили (message, stack,
// cause, context, Map, URL), а не то, что regex вообще умеет их находить.
const T_INVEST_TOKEN = `t.${'x'.repeat(25)}`;

describe('toErrorEvent — маскировка секретов [секрет]', () => {
  test('токен в message маскируется', () => {
    const event = toErrorEvent(new Error(`запрос упал: ${T_INVEST_TOKEN}`));

    expect(event.message).not.toContain(T_INVEST_TOKEN);
    expect(event.message).toContain('t.***');
  });

  test('токен в stack маскируется', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at ${T_INVEST_TOKEN}`;

    const event = toErrorEvent(error);

    expect(event.stack).not.toContain(T_INVEST_TOKEN);
    expect(event.stack).toContain('t.***');
  });

  test('токен в цепочке cause (в пределах MAX_DEPTH) маскируется', () => {
    const inner = new Error(T_INVEST_TOKEN);
    const outer = new Error('outer', { cause: inner });

    const event = toErrorEvent(outer);

    // event.cause — замаскированная копия outer (см. ветку Error в toErrorEvent), а сам
    // inner виден через её .cause — маскировка обязана достать и туда.
    const maskedInner = (event.cause as { cause?: unknown }).cause as Error;
    expect(maskedInner.message).not.toContain(T_INVEST_TOKEN);
    expect(maskedInner.message).toContain('t.***');
  });

  // Значения ниже намеренно НЕ похожи ни на один формат из mask-secrets.ts (не начинаются
  // с 't.', не 'Bearer <10+ символов>', не 'цифры:строка') — иначе тест не отличал бы
  // маскировку по имени ключа от маскировки по формату значения (которая сработала бы и
  // без сенситивного имени ключа вовсе).
  test('ключ Authorization со строковым значением маскируется целиком', () => {
    const event = toErrorEvent(new Error('x'), {
      headers: { Authorization: 'plain-value-not-a-known-format' },
    });

    expect(event.context.headers).toEqual({ Authorization: '[masked]' });
  });

  test('ключ authorization с объектным значением скрыт целиком, не только строковый формат', () => {
    const event = toErrorEvent(new Error('x'), {
      authorization: { scheme: 'custom', value: 'plain-value' },
    });

    expect(event.context.authorization).toBe('[masked]');
  });

  test('api_key/private_key/mnemonic/seed/cookie/credential/passphrase распознаются по имени ключа', () => {
    const event = toErrorEvent(new Error('x'), {
      api_key: 'a',
      private_key: 'b',
      mnemonic: 'c',
      seed: 'd',
      cookie: 'e',
      credential: 'f',
      passphrase: 'g',
      normal: 'h',
    });

    for (const key of ['api_key', 'private_key', 'mnemonic', 'seed', 'cookie', 'credential', 'passphrase']) {
      expect(event.context[key]).toBe('[masked]');
    }
    expect(event.context.normal).toBe('h');
  });

  test('Map с ключом authorization маскируется по ключу, не по формату значения', () => {
    const headers = new Map([['authorization', 'plain-value-not-a-known-format']]);

    const event = toErrorEvent(new Error('x'), { headers });

    expect(event.context.headers).toEqual([['authorization', '[masked]']]);
  });

  test('имя ключа обычного объекта, содержащее токен, тоже маскируется (не только у Map)', () => {
    const key = `session-${T_INVEST_TOKEN}`;

    const event = toErrorEvent(new Error('x'), { [key]: 'value' });

    const keys = Object.keys(event.context);
    expect(keys).toEqual(['session-t.***']);
    expect(keys.some((k) => k.includes(T_INVEST_TOKEN))).toBe(false);
  });

  test('два разных ключа, маскирующихся в одно и то же имя, схлопываются — последний по порядку побеждает (осознанное решение, не гонка)', () => {
    const tokenA = `t.${'a'.repeat(25)}`;
    const tokenB = `t.${'b'.repeat(25)}`;

    const event = toErrorEvent(new Error('x'), {
      [`session-${tokenA}`]: 'first',
      [`session-${tokenB}`]: 'second',
    });

    expect(Object.keys(event.context)).toEqual(['session-t.***']);
    expect(event.context['session-t.***']).toBe('second');
  });

  test('URL с токеном в query маскируется через href', () => {
    const url = new URL(`https://api.example.com/path?token=${T_INVEST_TOKEN}`);

    const event = toErrorEvent(new Error('x'), { url });

    expect(typeof event.context.url).toBe('string');
    expect(event.context.url as string).not.toContain(T_INVEST_TOKEN);
    expect(event.context.url as string).toContain('t.***');
  });

  test('Error, положенный напрямую в context (не через cause), тоже маскируется', () => {
    const inner = new Error(T_INVEST_TOKEN);

    const event = toErrorEvent(new Error('outer'), { inner });

    const masked = event.context.inner as { message: string };
    expect(masked.message).not.toContain(T_INVEST_TOKEN);
  });

  test('собственные поля системной ошибки (code/errno/syscall/hostname) в cause копируются и маскируются', () => {
    const systemError = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      hostname: T_INVEST_TOKEN,
    });
    const outer = new Error('wrapped', { cause: systemError });

    const event = toErrorEvent(outer);

    // event.cause — замаскированная копия outer, systemError виден через её .cause.
    const masked = (event.cause as { cause?: unknown }).cause as {
      code: string;
      errno: number;
      syscall: string;
      hostname: string;
    };
    expect(masked.code).toBe('ECONNREFUSED');
    expect(masked.errno).toBe(-111);
    expect(masked.syscall).toBe('connect');
    expect(masked.hostname).not.toContain(T_INVEST_TOKEN);
  });

  test('AggregateError.errors — вложенные причины замаскированы', () => {
    const agg = new AggregateError([new Error(T_INVEST_TOKEN), new Error('ok')], 'multiple failures');
    const outer = new Error('wrapped', { cause: agg });

    const event = toErrorEvent(outer);

    // event.cause — замаскированная копия outer, agg виден через её .cause.
    const masked = (event.cause as { cause?: unknown }).cause as { errors: { message: string }[] };
    expect(masked.errors[0]?.message).not.toContain(T_INVEST_TOKEN);
    expect(masked.errors[1]?.message).toBe('ok');
  });

  test('токен на границе MAX_STRING_LENGTH маскируется целиком: маска, потом обрезка, не наоборот', () => {
    // 2000 — должно совпадать с MAX_STRING_LENGTH в error-event.ts. Токен намеренно
    // помещён так, чтобы граница обрезки прошла ВНУТРИ него, если бы обрезка шла первой.
    // Пробелы вокруг токена — граница \b в regex токена требует перехода между \w и не-\w:
    // приклеенный вплотную к 'a' токен ('a' и 't' — оба \w) не считался бы началом токена.
    const prefixLength = 1990;
    const message = `${'a'.repeat(prefixLength)} ${T_INVEST_TOKEN} ${'b'.repeat(50)}`;

    const event = toErrorEvent(new Error(message));

    expect(event.message).not.toContain('x'.repeat(20));
    expect(event.message).toContain('t.***');
  });
});

describe('toErrorEvent — обход дерева с общим бюджетом [рост]', () => {
  test('цепочка cause глубже MAX_DEPTH обрезается, токен из самого глубокого звена не течёт', () => {
    let deepCause: Error = new Error(T_INVEST_TOKEN);
    for (let i = 0; i < 11; i++) {
      deepCause = new Error(`level-${i}`, { cause: deepCause });
    }

    const event = toErrorEvent(deepCause);

    // Явный обход по .cause, а не JSON.stringify(event): message замаскированной копии —
    // обычное перечисляемое поле плоского объекта (см. maskCause), но полагаться на то,
    // что сериализация вообще видит это поле, — обходной путь; читаем .message напрямую.
    let node: unknown = event.cause;
    let reachedDepthExceeded = false;
    for (let i = 0; i < 12 && node !== undefined; i++) {
      if (node === '[depth exceeded]') {
        reachedDepthExceeded = true;
        break;
      }
      expect((node as { message: string }).message).not.toContain(T_INVEST_TOKEN);
      node = (node as { cause?: unknown }).cause;
    }
    expect(reachedDepthExceeded).toBe(true);
  });

  test('циклический cause (объект ссылается сам на себя) не зацикливается и не бросает', () => {
    const error = new Error('x');
    (error as { cause?: unknown }).cause = error;

    expect(() => toErrorEvent(error)).not.toThrow();
    const event = toErrorEvent(error);

    expect((event.cause as { cause?: unknown }).cause).toBe('[circular]');
  });

  test('общая ссылка на один объект одновременно в cause и в context — не считается циклом', () => {
    const shared = { note: 'shared-ref' };
    const error = new FakeAppError('x', { data: shared }, { cause: shared });

    const event = toErrorEvent(error);

    expect(event.cause).toEqual({ note: 'shared-ref' });
    expect(event.context.data).toEqual({ note: 'shared-ref' });
  });

  test('циклическая ссылка внутри context (не в cause) не зацикливается', () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;

    const event = toErrorEvent(new Error('x'), { obj });

    expect((event.context.obj as { self: unknown }).self).toBe('[circular]');
  });

  test('чередование cause↔context не сбрасывает счётчик глубины: обрыв на точной, предсказуемой позиции', () => {
    // Один "уровень" здесь — это Error → (поле 'extra', плоский объект) → (поле 'wrapped',
    // следующий Error). Вход в maskCause для очередного Error происходит на depth, на 3
    // больше, чем у предыдущего Error (плюс 1 — переход в maskContextValue на 'extra', плюс
    // 1 — на 'wrapped' внутри него, плюс 1 — переход обратно в maskCause на следующем Error).
    // При MAX_DEPTH = 8 входы лежат на глубинах 0, 3, 6, 9 — девятая уже >= 8 и обрезается.
    // Три "уровня" (три wrap-итерации ниже) дают ровно 4 объекта: корень (depth 0), затем
    // depth 3 и depth 6 (оба реальные), затем depth 9 — обрубленный маркер вместо четвёртого
    // (самого глубокого, с токеном) объекта. Если бы счётчик сбрасывался на границе
    // cause/context, обход ушёл бы вместо этого в бюджет — токен всё равно был бы не виден,
    // но '[depth exceeded]' оказался бы не в этой позиции (или не оказался бы вовсе).
    let node: Error = new Error(T_INVEST_TOKEN);
    for (let i = 0; i < 3; i++) {
      node = Object.assign(new Error(`level-${i}`), { extra: { wrapped: node } });
    }

    const event = toErrorEvent(node);

    const level1 = (event.cause as { extra?: { wrapped?: unknown } }).extra?.wrapped as {
      extra?: { wrapped?: unknown };
    };
    const level2 = level1.extra?.wrapped as { extra?: { wrapped?: unknown } };
    expect(level2.extra?.wrapped).toBe('[depth exceeded]');
  });

  test('массив в context длиннее MAX_COLLECTION_ITEMS обрезается и получает маркер переполнения', () => {
    const items = Array.from({ length: 60 }, (_, i) => i);

    const event = toErrorEvent(new Error('x'), { items });

    const limited = event.context.items as unknown[];
    expect(limited).toHaveLength(51); // 50 элементов + маркер переполнения
    expect(limited.slice(0, 50)).toEqual(items.slice(0, 50));
    expect(limited[50]).toBe('[...ещё 10]');
  });

  test('широкий и глубокий объект в context ограничен общим бюджетом узлов, а не только глубиной', () => {
    function buildWide(width: number, levels: number): unknown {
      if (levels === 0) return 'leaf';
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < width; i++) obj[`k${i}`] = buildWide(width, levels - 1);
      return obj;
    }
    // 10 + 100 + 1000 + 10000 = 11110 узлов — далеко за MAX_NODE_BUDGET (1000), но глубина
    // (4 уровня) меньше MAX_DEPTH (8): без общего бюджета узлов это не остановилось бы вовсе.
    const huge = buildWide(10, 4);

    const event = toErrorEvent(new Error('x'), { huge });

    // Настоящая проверка — маркер бюджета, а не время выполнения (хрупко на CI).
    expect(JSON.stringify(event.context)).toContain('[budget exceeded]');
  });

  // Считает, сколько раз реально дёрнули итератор — вместо секундомера (хрупко на CI).
  // instanceof Map у наследника сохраняется, .size работает как у обычного Map.
  class CountingMap<K, V> extends Map<K, V> {
    advances = 0;

    entries(): MapIterator<[K, V]> {
      const inner = super.entries();
      const iterator = {
        next: (): IteratorResult<[K, V]> => {
          this.advances++;
          return inner.next();
        },
        [Symbol.iterator]: () => iterator,
      } as unknown as MapIterator<[K, V]>;
      return iterator;
    }
  }

  class CountingSet<V> extends Set<V> {
    advances = 0;

    values(): SetIterator<V> {
      const inner = super.values();
      const iterator = {
        next: (): IteratorResult<V> => {
          this.advances++;
          return inner.next();
        },
        [Symbol.iterator]: () => iterator,
      } as unknown as SetIterator<V>;
      return iterator;
    }
  }

  test('Map на 200 000 записей не обходится целиком — маскировка останавливается сразу после предела', () => {
    const map = new CountingMap<number, number>();
    for (let i = 0; i < 200_000; i++) map.set(i, i);

    const event = toErrorEvent(new Error('x'), { map });

    // MAX_COLLECTION_ITEMS (50) полезных шагов + 1 "разведывательный", который обнаруживает,
    // что записи ещё остались, и не используется — не 200 000 и не пропорционально им.
    expect(map.advances).toBe(51);
    expect(event.context.map as unknown[]).toHaveLength(51); // 50 записей + маркер
  });

  test('Set на 200 000 записей не обходится целиком', () => {
    const set = new CountingSet<number>();
    for (let i = 0; i < 200_000; i++) set.add(i);

    const event = toErrorEvent(new Error('x'), { set });

    expect(set.advances).toBe(51);
    expect(event.context.set as unknown[]).toHaveLength(51);
  });
});

describe('toErrorEvent — честные типы [типы]', () => {
  test('копия cause — плоский объект, а не Error (ADR-011): message вложенной причины виден в JSON.stringify(event)', () => {
    // new Error(...) не годится здесь: message/stack — неперечисляемые собственные поля
    // спецификации Error, и JSON.stringify их не видит ни у какого Error, замаскированного
    // или нет. Плоский объект решает это тем, что message/stack — обычные, перечисляемые
    // поля. Именно это (а не то, что .message читается кастом в других тестах) проверяет
    // выбор представления cause — .message доступен и у Error, разницы не видно.
    const inner = new Error('исходная причина');
    const outer = new Error('wrapped', { cause: inner });

    const event = toErrorEvent(outer);

    expect(JSON.stringify(event)).toContain('исходная причина');
  });

  test('примитив (bigint) под чувствительным именем ключа сознательно не маскируется — SENSITIVE_KEY слишком широкий (tokenExpiresAt, secretVersion), чтобы прятать любые примитивы без потери диагностики', () => {
    const event = toErrorEvent(new Error('x'), { token: 123n });

    expect(event.context.token).toBe(123n);
  });

  test('Date/Map/Set не превращаются в {}', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const map = new Map([['a', 1]]);
    const set = new Set([1, 2, 3]);

    const event = toErrorEvent(new Error('x'), { date, map, set });

    expect(event.context.date).toBe(date);
    expect(event.context.map).toEqual([['a', 1]]);
    expect(event.context.set).toEqual([1, 2, 3]);
  });

  test('TypedArray становится [binary N bytes], а не разворачивается в объект с индексами', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]);

    const event = toErrorEvent(new Error('x'), { bytes });

    expect(event.context.bytes).toBe(`[binary ${bytes.byteLength} bytes]`);
  });

  test('err.message = 123 не бросает и не лжёт компилятору: toSafeString даёт честную строку', () => {
    const error = new Error('placeholder');
    (error as unknown as { message: unknown }).message = 123;

    const event = toErrorEvent(error);

    expect(event.message).toBe('123');
  });
});

describe('toErrorEvent — бросающие геттеры не роняют нормализацию [исключение]', () => {
  test('бросающий геттер в context верхнего уровня (mergeContext) деградирует только этот ключ', () => {
    const badContext: Record<string, unknown> = { good: 'ok' };
    Object.defineProperty(badContext, 'bad', {
      enumerable: true,
      get(): never {
        throw new Error('geter context boom');
      },
    });
    const error = new FakeAppError('x', { fine: 'value' });

    const event = toErrorEvent(error, badContext);

    expect(event.context).toEqual({ good: 'ok', bad: '[unreadable]', fine: 'value' });
  });

  test('бросающий геттер на вложенном поле context (maskContextValue) деградирует только этот ключ', () => {
    const nested: Record<string, unknown> = { fine: 'value' };
    Object.defineProperty(nested, 'bad', {
      enumerable: true,
      get(): never {
        throw new Error('geter nested boom');
      },
    });

    const event = toErrorEvent(new Error('x'), { nested });

    expect(event.context.nested).toEqual({ fine: 'value', bad: '[unreadable]' });
  });

  test('геттер name у cause бросает — код/severity и остальные поля события целы', () => {
    const cause = new Error('исходная причина');
    Object.defineProperty(cause, 'name', {
      configurable: true,
      get(): never {
        throw new Error('name boom');
      },
    });
    const outer = new Error('wrapped', { cause });

    const event = toErrorEvent(outer);

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.message).toBe('wrapped');
    const maskedCause = (event.cause as { cause?: unknown }).cause as { name: unknown; message: string };
    expect(maskedCause.name).toBe('[unreadable]');
    expect(maskedCause.message).toBe('исходная причина');
  });

  test('геттер message у cause бросает — деградирует только это поле', () => {
    const cause = new Error('исходная причина');
    Object.defineProperty(cause, 'message', {
      configurable: true,
      get(): never {
        throw new Error('message boom');
      },
    });
    const outer = new Error('wrapped', { cause });

    const event = toErrorEvent(outer);

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.message).toBe('wrapped');
    const maskedCause = (event.cause as { cause?: unknown }).cause as { name: unknown; message: unknown };
    expect(maskedCause.name).toBe('Error');
    expect(maskedCause.message).toBe('[unreadable]');
  });

  test('геттер message у верхнеуровневой AppError бросает — code/severity/context целы', () => {
    const error = new FakeAppError('placeholder', { fine: 'value' });
    Object.defineProperty(error, 'message', {
      configurable: true,
      get(): never {
        throw new Error('message boom');
      },
    });

    const event = toErrorEvent(error);

    expect(event.code).toBe('FAKE');
    expect(event.severity).toBe('critical');
    expect(event.context).toEqual({ fine: 'value' });
    expect(event.message).toBe('[unreadable]');
  });

  // Отдельно от AppError-варианта выше: ветка toErrorEvent для чужого (не AppError) Error —
  // свой код (code/severity — константы 'UNKNOWN_ERROR'/'error', а не поля error), свой путь.
  // Без этого теста откат safeRead именно в этой ветке не красит ни один тест в файле —
  // проверено мутационно при ревью.
  test('геттер message у верхнеуровневого чужого Error бросает — событие не деградирует целиком', () => {
    const error = new Error('placeholder');
    Object.defineProperty(error, 'message', {
      configurable: true,
      get(): never {
        throw new Error('message boom');
      },
    });

    const event = toErrorEvent(error, { fine: 'value' });

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.severity).toBe('error');
    expect(event.context).toEqual({ fine: 'value' });
    expect(event.message).toBe('[unreadable]');
  });

  test('геттер errors у AggregateError в cause бросает — message и code остальных полей целы', () => {
    const agg = new AggregateError([new Error('a')], 'multiple failures');
    Object.defineProperty(agg, 'errors', {
      configurable: true,
      get(): never {
        throw new Error('errors boom');
      },
    });
    const outer = new Error('wrapped', { cause: agg });

    const event = toErrorEvent(outer);

    expect(event.message).toBe('wrapped');
    const maskedAgg = (event.cause as { cause?: unknown }).cause as { message: unknown; errors: unknown };
    expect(maskedAgg.message).toBe('multiple failures');
    expect(maskedAgg.errors).toBe('[unreadable]');
  });

  test('Proxy с бросающим ownKeys на верхнем уровне context не роняет toErrorEvent целиком', () => {
    const poisoned = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('ownKeys boom');
        },
      },
    );

    expect(() => toErrorEvent(new Error('x'), poisoned)).not.toThrow();
    const event = toErrorEvent(new Error('x'), poisoned);

    expect(event.message).toBe('x');
    expect(event.context).toEqual({ __context__: '[unreadable]' });
  });

  test('Proxy с бросающим ownKeys во ВЛОЖЕННОМ поле context деградирует только это поле', () => {
    const poisonedNested = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('ownKeys boom');
        },
      },
    );

    const event = toErrorEvent(new Error('x'), { nested: poisonedNested, fine: 'ok' });

    expect(event.context.nested).toBe('[unreadable]');
    expect(event.context.fine).toBe('ok');
  });

  test('AppError + Proxy с бросающим ownKeys в аргументе context — code/severity/message целы, error.context не теряется', () => {
    const poisonedCallSiteContext = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('ownKeys boom');
        },
      },
    );
    const error = new FakeAppError('что-то сломалось', { orderId: 42 });

    const event = toErrorEvent(error, poisonedCallSiteContext);

    expect(event.code).toBe('FAKE');
    expect(event.severity).toBe('critical');
    expect(event.message).toBe('что-то сломалось');
    // mergeContext деградирует только непрочитанную половину (аргумент context), а не
    // весь итоговый context: error.context читается нормально и не теряется.
    expect(event.context).toEqual({ orderId: 42 });
  });

  test('отравленный объект (Proxy с бросающим ownKeys) в цепочке cause — message/code/context целы, деградировало только это звено', () => {
    const poisoned = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('ownKeys boom');
        },
      },
    );
    const outer = new Error('outer', { cause: poisoned });

    const event = toErrorEvent(outer, { fine: 'value' });

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.message).toBe('outer');
    expect(event.context).toEqual({ fine: 'value' });
    expect((event.cause as { cause?: unknown }).cause).toBe('[unreadable]');
  });

  test('отравленный объект (Proxy с бросающим ownKeys) как cause ВЕРХНЕГО уровня (ветка "не Error") — message/context целы', () => {
    const poisoned = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('ownKeys boom');
        },
      },
    );

    const event = toErrorEvent(poisoned, { fine: 'value' });

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.message).toBe('[object Object]');
    expect(event.context).toEqual({ fine: 'value' });
    expect(event.cause).toBe('[unreadable]');
  });

  test('геттер .cause у верхнеуровневой AppError бросает — code/severity/context целы', () => {
    const error = new FakeAppError('placeholder', { fine: 'value' });
    Object.defineProperty(error, 'cause', {
      configurable: true,
      get(): never {
        throw new Error('cause boom');
      },
    });

    const event = toErrorEvent(error);

    expect(event.code).toBe('FAKE');
    expect(event.severity).toBe('critical');
    expect(event.context).toEqual({ fine: 'value' });
    expect(event.cause).toBe('[unreadable]');
  });

  test('геттер .cause у верхнеуровневого чужого Error бросает — событие не деградирует целиком', () => {
    const error = new Error('placeholder');
    Object.defineProperty(error, 'cause', {
      configurable: true,
      get(): never {
        throw new Error('cause boom');
      },
    });

    const event = toErrorEvent(error, { fine: 'value' });

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.message).toBe('placeholder');
    expect(event.context).toEqual({ fine: 'value' });
    expect((event.cause as { cause?: unknown }).cause).toBe('[unreadable]');
  });

  test('геттер .cause у ВЛОЖЕННОЙ причины бросает — деградирует только эта причина', () => {
    const inner = new Error('inner');
    Object.defineProperty(inner, 'cause', {
      configurable: true,
      get(): never {
        throw new Error('cause boom');
      },
    });
    const outer = new Error('outer', { cause: inner });

    const event = toErrorEvent(outer);

    expect(event.message).toBe('outer');
    const maskedInner = (event.cause as { cause?: unknown }).cause as { message: string; cause?: unknown };
    expect(maskedInner.message).toBe('inner');
    expect(maskedInner.cause).toBe('[unreadable]');
  });

  // Отдельно от теста на message: чтение .stack само по себе может бросить, если message
  // переопределён бросающим геттером (V8 лениво форматирует заголовок стека, читая message) —
  // НО только пока .stack не отформатирован ни разу; если что-то (логирование, консоль,
  // сам тест-раннер) уже прочитало .stack раньше, эта связь пропадает — формат уже в кэше.
  // Полагаться на такое совпадение нельзя: нужен тест, где throws именно stack, а не message.
  test('геттер stack у cause бросает независимо от message — деградирует только это поле', () => {
    const cause = new Error('исходная причина');
    Object.defineProperty(cause, 'stack', {
      configurable: true,
      get(): never {
        throw new Error('stack boom');
      },
    });
    const outer = new Error('wrapped', { cause });

    const event = toErrorEvent(outer);

    expect(event.message).toBe('wrapped');
    const maskedCause = (event.cause as { cause?: unknown }).cause as { message: string; stack: unknown };
    expect(maskedCause.message).toBe('исходная причина');
    expect(maskedCause.stack).toBe('[unreadable]');
  });

  test('геттер code у верхнеуровневой AppError бросает — message/severity/остальное целы', () => {
    const error = new FakeAppError('что-то сломалось', { orderId: 1 });
    Object.defineProperty(error, 'code', {
      configurable: true,
      get(): never {
        throw new Error('code boom');
      },
    });

    const event = toErrorEvent(error);

    expect(event.code).toBe('UNKNOWN_ERROR');
    expect(event.severity).toBe('critical');
    expect(event.message).toBe('что-то сломалось');
    expect(event.context).toEqual({ orderId: 1 });
  });

  test('геттер context у верхнеуровневой AppError бросает — message/code/severity целы', () => {
    const error = new FakeAppError('что-то сломалось', { orderId: 1 });
    Object.defineProperty(error, 'context', {
      configurable: true,
      get(): never {
        throw new Error('context boom');
      },
    });

    const event = toErrorEvent(error);

    expect(event.code).toBe('FAKE');
    expect(event.severity).toBe('critical');
    expect(event.message).toBe('что-то сломалось');
    expect(event.context).toEqual({});
  });

  test('геттер code у AppError во ВЛОЖЕННОЙ причине бросает — message/severity/context этой причины целы', () => {
    const inner = new FakeAppError('inner-msg', { orderId: 1 });
    Object.defineProperty(inner, 'code', {
      configurable: true,
      get(): never {
        throw new Error('code boom');
      },
    });
    const outer = new Error('outer', { cause: inner });

    const event = toErrorEvent(outer);

    expect(event.message).toBe('outer');
    const maskedInner = (event.cause as { cause?: unknown }).cause as {
      message: string;
      code: unknown;
      severity: unknown;
      context: unknown;
    };
    expect(maskedInner.message).toBe('inner-msg');
    expect(maskedInner.severity).toBe('critical');
    expect(maskedInner.context).toEqual({ orderId: 1 });
    expect(maskedInner.code).toBe('UNKNOWN_ERROR');
  });

  test('геттер severity у AppError во ВЛОЖЕННОЙ причине бросает — message/code/context этой причины целы', () => {
    const inner = new FakeAppError('inner-msg', { orderId: 1 });
    Object.defineProperty(inner, 'severity', {
      configurable: true,
      get(): never {
        throw new Error('severity boom');
      },
    });
    const outer = new Error('outer', { cause: inner });

    const event = toErrorEvent(outer);

    expect(event.message).toBe('outer');
    const maskedInner = (event.cause as { cause?: unknown }).cause as {
      message: string;
      code: unknown;
      severity: unknown;
      context: unknown;
    };
    expect(maskedInner.message).toBe('inner-msg');
    expect(maskedInner.code).toBe('FAKE');
    expect(maskedInner.context).toEqual({ orderId: 1 });
    expect(maskedInner.severity).toBe('error');
  });

  test('геттер context у AppError во ВЛОЖЕННОЙ причине бросает — message/code/severity этой причины целы', () => {
    const inner = new FakeAppError('inner-msg', { orderId: 1 });
    Object.defineProperty(inner, 'context', {
      configurable: true,
      get(): never {
        throw new Error('context boom');
      },
    });
    const outer = new Error('outer', { cause: inner });

    const event = toErrorEvent(outer);

    expect(event.message).toBe('outer');
    const maskedInner = (event.cause as { cause?: unknown }).cause as {
      message: string;
      code: unknown;
      severity: unknown;
      context: unknown;
    };
    expect(maskedInner.message).toBe('inner-msg');
    expect(maskedInner.code).toBe('FAKE');
    expect(maskedInner.severity).toBe('critical');
    expect(maskedInner.context).toBe('[unreadable]');
  });
});

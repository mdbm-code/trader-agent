# Урок 4 (Sprint 02) — план: 4a (маскировка) + 4b (ограничитель) + ритуал «шести вопросов»

## Контекст

Спринт 02 — `docs/sprints/sprint-02-plan.md`, уроки 1–3 готовы (✅) в `src/shared/errors/`.
Урок 4 в исходном плане спринта (паттерн Декоратор) разбит на **4a — маскировка** и
**4b — ограничитель повторов**. Дополнительно введён чек-лист
`docs/checklists/six-questions.md` — «ритуал шести вопросов устойчивости»: при планировании
каждого шага с кодом и при проектировании тестов проходить шесть вопросов (`[исключение]`,
`[гонка]`, `[завершение]`, `[секрет]`, `[рост]`, `[типы]`), фиксировать в плане таблицей
«вопрос → тест или "не применимо, потому что…"», в названиях тестов — теги вопросов.

Чек-лист уже содержит готовые примеры именно для урока 4a/4b (написан заранее, как ориентир):
маскировка в `toErrorEvent`, запись ключа в `Map` до `await`, `flush()` до `await`, отпечаток
`UNKNOWN_ERROR` цифры→`#`, `maxTrackedKeys` с корзиной переполнения, ограничение глубины
`cause`, `timer.unref()`, метод `flushAll()` — накопленные сводки ограничителя не должны
теряться при `process.exit` (раздел 3 чек-листа, `[завершение]`). Применение ритуала к уже
спроектированным шагам 4a/4b вскрыло ещё два реальных пробела — см. находки в шаге 3 ниже.

## Шаг 0 — правки процесса (выполнено ✅)

`CLAUDE.md` — добавлен раздел «Шесть вопросов устойчивости» после «Правила кода» (ссылка на
чек-лист, требование таблицы в плане шага, теги тестов, требование к ревью diff).

`.claude/output-styles/mentor.md` — три правки: в разделе «План» — таблица шести вопросов для
шагов с кодом + разовое предложение студенту назвать самый опасный вопрос до показа таблицы;
в «Конец урока» — один из двух контрольных вопросов теперь из шести вопросов устойчивости, на
новом материале; в «Ревью кода студента» — пункт «пройди шесть вопросов по коду».

---

## 4a — маскировка

### Шаг 1 — `mask-secrets.ts` + `mask-secrets.test.ts`

Шаблоны — массивом (новый формат секрета = одна строка); ведущий `\b`, без завершающего
(токен может кончаться на `-`):

```ts
const SECRET_PATTERNS: readonly { pattern: RegExp; mask: string }[] = [
  { pattern: /\bt\.[\w-]{20,}/g, mask: 't.***' }, // токен T-Invest API
];

export function maskSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((acc, { pattern, mask }) => acc.replaceAll(pattern, mask), text);
}
```

**Таблица шести вопросов:**

| Вопрос | Ответ |
|---|---|
| `[исключение]` | Не применимо: чистая функция над гарантированным TS-типом `string`, `replaceAll` с корректным regex-литералом не бросает |
| `[гонка]` | Не применимо: нет общего состояния, каждый вызов независим |
| `[завершение]` | Не применимо: синхронная операция без побочных эффектов, нечего терять |
| `[секрет]` | Тест: `[секрет]` токен в начале/середине/конце строки маскируется; несколько токенов в одной строке; токен, заканчивающийся на `-`, маскируется целиком (регресс на убранный завершающий `\b`); короткая последовательность `t.abc` ниже порога не маскируется |
| `[рост]` | Не применимо: результат не накапливается, нет коллекций |
| `[типы]` | Не применимо: параметр — гарантированный `string`; `[\w-]{20,}` без вложенных квантификаторов — не ReDoS |

Тесты без тега (обычная корректность, не про устойчивость): без секретов — identity; пустая
строка.

**Открытый вопрос (в конспект):** токен Telegram-бота в URL — Sprint 03, отдельная строка в
`SECRET_PATTERNS`, когда появится `TelegramAlertSink`.

`maskSecrets` пока **не экспортируется** из `index.ts` — до урока 9 (`Logger`).

### Шаг 2 — правка `error-event.ts` (+ тесты в `error-event.test.ts`)

Маскировка `message`/`stack` верхнего уровня — базовый случай. Плюс:

**Цепочка `cause`** — приватная `maskCause(cause, depth, seen)`, глубина ≤ 5, `WeakSet` против
циклов, снимок — plain-object (`name`/`message`/`stack`/`cause`), не «живой» `Error`.

**Контекст рекурсивно** — приватная `maskContextValue(key, value, seen)`: строки — маскировка
по содержимому (`maskSecrets`) или, если имя ключа подозрительное
(`token|secret|password|authorization|apikey`, без регистра), — маскировка целиком независимо
от формата; объекты/массивы — рекурсия с тем же `WeakSet`; нестроковые значения (`bigint`,
числа) не трогаем.

**Исправление от ритуала (найдено на вопросе `[типы]`, применяем сразу):** если в `context`
кладут `Error` напрямую (не через `cause`, например `{ lastError: someError }`), `stack` у
`Error` в V8 — не всегда enumerable-свойство, обычный `Object.entries` его может не увидеть —
маскировка молча пропустит `stack`, а в нём может быть токен. Фикс: `maskContextValue`
проверяет `value instanceof Error` **до** попытки перечисления свойств и делегирует в тот же
`maskCause`, что и для `cause` (он читает `.message`/`.stack`/`.cause` по имени, а не через
`Object.entries`):

```ts
function maskContextValue(key: string | null, value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return key !== null && SENSITIVE_KEY.test(key) ? '[masked]' : maskSecrets(value);
  }
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return maskCause(value, 0, seen); // см. исправление выше
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => maskContextValue(null, item, seen));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskContextValue(k, v, seen)]));
}
```

`cause` и `context` используют **один и тот же `WeakSet`** за один вызов `toErrorEvent` (а не
два отдельных) — защищает и от патологического случая, когда один и тот же объект встречается
и в `cause`, и в `context`.

**Таблица шести вопросов:**

| Вопрос | Ответ |
|---|---|
| `[исключение]` | Тест: `context` содержит значение с геттером, бросающим при чтении — `toErrorEvent` не падает (расширяем на маскировку зону действия существующего try/catch урока 3) |
| `[гонка]` | Не применимо: чистое синхронное преобразование, `WeakSet` локален одному вызову |
| `[завершение]` | Не применимо: между вызовами ничего не накапливается |
| `[секрет]` | Тесты: токен в `message`; в `stack`; в `cause.message` (1 уровень); цепочка `cause` глубже 5 — обрезается меткой; `cause`, ссылающийся сам на себя — не зацикливается; токен в плоском `context`; во вложенном объекте; в массиве; циклический `context`; ключ `Authorization` (регистр не важен) со значением-непохожим-на-токен — всё равно скрыт; `Error` напрямую в `context` (не в `cause`) с токеном в `stack` — тоже замаскирован (тест на исправление выше) |
| `[рост]` | Тест: цепочка `cause` из 10 звеньев — рекурсия останавливается на глубине 5; циклический `cause`/`context` — не растит стек бесконечно |
| `[типы]` | Тест: `Error`, положенный в `context` напрямую — `stack` не enumerable, `Object.entries` его не увидит без явной проверки `instanceof Error`; bigint под ключом `token` — не тронут (не строка, маскировать нечего) |

Прогнать все существующие тесты `error-event.test.ts` — не должны сломаться.

---

## 4b — ограничитель повторов, `index.ts`, ADR-011

### Шаг 3 — `rate-limited-error-reporter.ts` + тест

```ts
export class RateLimitedErrorReporter implements ErrorReporter {
  private readonly state = new Map<string, {
    count: number; error: unknown; context: Record<string, unknown>;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(
    private readonly inner: ErrorReporter,
    private readonly windowMs: number = 5 * 60 * 1000,
    private readonly maxTrackedKeys: number = 500,
  ) {}

  async report(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const event = toErrorEvent(error, context);
    const key = this.resolveKey(event);
    const existing = this.state.get(key);

    if (existing !== undefined) {
      existing.count++;
      existing.error = error;      // сводка несёт ПОСЛЕДНИЙ подавленный повтор
      existing.context = context;
      return;
    }

    // Ключ пишем в Map СИНХРОННО, ДО await ниже — см. [гонка]. Между report() без await
    // между ними JS не переключится на другой вызов посреди синхронного участка: второй
    // вызов уже увидит ключ в Map и будет подавлен. Тот же принцип — в flush(): delete до await.
    const timer = setTimeout(() => void this.flush(key), this.windowMs);
    timer.unref?.();
    this.state.set(key, { count: 0, error, context, timer });

    try {
      await this.inner.report(error, context);
    } catch (reason) {
      this.logFailure(reason);
    }
  }

  /** Забрать все накопленные сводки немедленно — вызывается при graceful shutdown (урок 5/13). */
  async flushAll(): Promise<void> {
    await Promise.all([...this.state.keys()].map((key) => this.flush(key)));
  }

  private async flush(key: string): Promise<void> {
    const entry = this.state.get(key);
    this.state.delete(key); // до await — см. комментарий в report()
    if (entry === undefined) return;
    clearTimeout(entry.timer); // на случай ручного flushAll() раньше срабатывания таймера
    if (entry.count === 0) return; // повторов не было — сводка не нужна

    try {
      await this.inner.report(entry.error, { ...entry.context, repeatCount: entry.count });
    } catch (reason) {
      this.logFailure(reason);
    }
  }

  private resolveKey(event: ErrorEvent): string {
    const rawKey = event.code === 'UNKNOWN_ERROR'
      ? `UNKNOWN_ERROR:${event.message.replace(/\d+/g, '#')}` // отпечаток — [рост]
      : event.code;

    if (rawKey !== OVERFLOW_KEY && !this.state.has(rawKey) && this.state.size >= this.maxTrackedKeys) {
      return OVERFLOW_KEY; // предел ключей — [рост]
    }
    return rawKey;
  }

  private logFailure(reason: unknown): void {
    // Исправление от ритуала ([секрет]): reason — сырой сбой inner.report (например,
    // сетевая ошибка Telegram-sink с токеном бота прямо в URL, см. six-questions.md
    // раздел 4). Раньше здесь напрямую печатали reason в console.error — прямая утечка
    // мимо всей маскировки toErrorEvent. Прогоняем reason через тот же toErrorEvent —
    // тем же путём, что обычная ошибка, получаем уже замаскированные message/context.
    try {
      const safe = toErrorEvent(reason);
      console.error('RateLimitedErrorReporter: inner.report failed', safe.message, safe.context);
    } catch {
      // последний рубеж, тот же приём, что в CompositeErrorReporter
    }
  }
}

const OVERFLOW_KEY = '__overflow__';
```

**Таблица шести вопросов:**

| Вопрос | Ответ |
|---|---|
| `[исключение]` | Тесты: `[исключение]` сбой `inner.report` при немедленной отправке не роняет `report()`; `[исключение]` сбой `inner.report` внутри `flush()` не роняет её и не даёт `unhandledRejection` |
| `[гонка]` | Тест: `[гонка]` несколько `report()` с одинаковым ключом подряд без `await` между ними — `inner.report` вызван ровно 1 раз, остальные подавлены |
| `[завершение]` | Тест: `[завершение]` накоплены подавленные повторы на двух разных ключах, вызван `flushAll()` до срабатывания таймеров — обе сводки отправлены, `state` пуст, все таймеры очищены (`vi.getTimerCount() === 0`) |
| `[секрет]` | Тест: `[секрет]` `inner.report` отклоняется ошибкой с токеном в `message` — то, что попадает в `console.error` через `logFailure`, токена не содержит (использован тот же `toErrorEvent`) |
| `[рост]` | Тесты: `[рост]` отпечаток — `UNKNOWN_ERROR` с разными числами в сообщении считаются одним ключом, с разным текстом — разными; `[рост]` переполнение — при `maxTrackedKeys: 2` третий отличный код уходит в `OVERFLOW_KEY`, `Map` не растёт дальше лимита |
| `[типы]` | Тест: `[типы]` `inner.report` — обычная (не `async`) функция, бросающая **синхронно** при вызове, до возврата какого-либо `Promise` — `report()` всё равно не бросает (тип `Promise<void>` в `ErrorReporter` не гарантирует, что реализация асинхронна; `try { await ... }` ловит и синхронный throw при вызове выражения внутри `try`) |

Дополнительные обычные тесты (без тега — они про базовое поведение декоратора, не про
устойчивость): первая ошибка уходит сразу; вторая того же кода в пределах окна (последовательно,
с `await`) не уходит сразу; сводка приходит после `vi.advanceTimersByTimeAsync(windowMs)` с
верным `repeatCount`; без повторов за окно — сводки нет; разные коды не блокируют друг друга;
тот же код после закрытия окна — снова считается первым; сводка несёт контекст **последнего**
подавленного повтора, а не первого.

`timer.unref()` отдельным тестом не проверяется (не тестируется содержательно под fake timers)
— фиксируется как ручная проверка в конце урока.

### Шаг 4 — правка `index.ts`

Экспортировать только `RateLimitedErrorReporter`. `maskSecrets` — не экспортировать (см. 4a,
шаг 1). Ритуал шести вопросов к этой правке не применяется — реэкспорт без своего поведения,
нет ни одного применимого вопроса, тестов нет.

### Шаг 5 — ADR-011

`docs/architecture/adr/011-error-reporter-pipeline.md`, формат как `001-typescript.md`.

- **Контекст.** Требования уроков 2–4: единый контракт, рассылка без взаимного влияния сбоев,
  отсутствие спама дублями, отсутствие утечки секретов, устойчивость к гонкам и к завершению
  процесса с несохранённым состоянием.
- **Решение.** `new RateLimitedErrorReporter(new CompositeErrorReporter([...sinks]))`.
  Маскировка — часть нормализации `toErrorEvent` (`message`/`stack`/цепочка `cause` до глубины
  5/`context` рекурсивно, включая `Error` как значение `context` напрямую), а не отдельный слой.
  Троттлинг — ключ `code` (для `UNKNOWN_ERROR` — отпечаток `message`, цифры → `#`), окно
  `windowMs` (5 мин по умолчанию), `maxTrackedKeys` (500 по умолчанию) с корзиной
  переполнения. Состояние пишется в `Map` синхронно до `await` — и при отправке, и при
  `flush()`. `flushAll()` — забрать накопленные сводки при штатном завершении процесса
  (используется из `installProcessGuards`, урок 5). Сбой самого `inner.report` логируется через
  `toErrorEvent` — тем же путём маскировки, что обычная ошибка, а не напрямую.
- **Альтернативы (отклонены):** маскировка внутри декоратора; чистый троттлинг без сводки;
  ключ строго по `code` без отпечатка; порт `Clock` сейчас (YAGNI, `vi.useFakeTimers()`
  достаточно — Clock появится в уроке 8); запись в `Map` после `await`; неограниченный `Map`
  ключей; логирование сбоя `inner.report` напрямую (без прогона через `toErrorEvent`) — нашли
  на ритуале шести вопросов, отклонено как прямая утечка секрета в обход маскировки.
- **Последствия.** Троттлинг не различает `severity`; маскировка по формату — только токен
  T-Invest (расширяется по мере появления новых форматов, `SECRET_PATTERNS` — массив);
  корзина переполнения группирует разнородные ошибки грубо; `flushAll()` объявлен, но не
  подключён к сигналам процесса — это задача урока 5.

### Шаг 6 — конспекты и закрытие

`docs/lessons/sprint-02/lesson-04a-mask-secrets.md` и
`docs/lessons/sprint-02/lesson-04b-rate-limited-error-reporter.md`, структура — как
`lesson-03...md`. В 4b обязательно разобрать письменно: гонку (`[гонка]`) с примером «что было
бы, если писать в Map после await», и находку `[секрет]` про `logFailure`/`toErrorEvent` — обе
найдены именно благодаря ритуалу, это стоит явно показать студенту как пример его пользы, а
не абстрактно хвалить чек-лист. По одному контрольному вопросу «из шести» на новом материале
каждого подурока (по правке `mentor.md` из шага 0).

Обновить статус 4a/4b на ✅, разбив строку 4 в `docs/sprints/sprint-02-plan.md`.

---

## Порядок и почему

0. Правки `CLAUDE.md`/`mentor.md` — процесс фиксируется до того, как по нему начинают работать
   (✅ выполнено).
1. `mask-secrets.ts` — независимая чистая функция, разогрев, первая таблица шести вопросов —
   самая короткая (много «не применимо»), хороший постепенный вход в ритуал.
2. Правка `error-event.ts` — маскировка проверяется через уже знакомый `toErrorEvent`,
   независимо от декоратора; здесь же ритуал сразу окупается находкой про `Error` в `context`.
3. `rate-limited-error-reporter.ts` — на готовой маскировке, отдельно гонки/рост/завершение;
   вторая находка ритуала (`logFailure`) — здесь.
4. `index.ts` — минимальная правка после готового класса.
5. ADR-011 — когда все решения 4a/4b, включая находки ритуала, существуют.
6. Конспекты + статус спринта.

Каждый шаг с кодом — по процессу «Разбор»: план с таблицей шести вопросов → (раз за урок)
предложение студенту назвать самый опасный вопрос → остановка → код → `npm run typecheck`/
`npm test` → путеводитель → контрольный вопрос → остановка.

## Проверка

- `npm run typecheck`/`npm test` зелёные на каждом шаге, включая весь код уроков 1–3.
- Критерий 4a: токен нигде не читается открытым текстом — ни в `message`, ни в `stack`, ни в
  цепочке `cause`, ни в `context` (плоском, вложенном, в `Error`-значении); циклы не роняют
  нормализацию.
- Критерий 4b: шторм из N одинаковых ошибок без await между ними → 1 немедленный вызов
  `inner` + 1 сводка с `repeatCount = N-1` и данными последнего повтора; `flushAll()` не теряет
  накопленное; сбой `inner.report` нигде не светит секрет и не роняет ни `report()`, ни `flush()`.
- `git status`/`git diff` — список файлов по плану, отдельно для 4a и 4b.

## Критические файлы

- `CLAUDE.md` (правка: раздел «Шесть вопросов устойчивости», выполнено ✅)
- `.claude/output-styles/mentor.md` (правки: План / Конец урока / Ревью кода студента, выполнено ✅)
- `docs/checklists/six-questions.md` (существует, только читаем — источник вопросов/тегов)
- `src/shared/errors/mask-secrets.ts` (новый, 4a)
- `src/shared/errors/error-event.ts` (правка: маскировка message/stack/cause/context, 4a)
- `src/shared/errors/rate-limited-error-reporter.ts` (новый, 4b, с `flushAll()`)
- `src/shared/errors/index.ts` (правка экспортов, только `RateLimitedErrorReporter`, 4b)
- `docs/architecture/adr/011-error-reporter-pipeline.md` (новый, 4b)
- `docs/lessons/sprint-02/lesson-04a-mask-secrets.md` (новый)
- `docs/lessons/sprint-02/lesson-04b-rate-limited-error-reporter.md` (новый)
- `docs/sprints/sprint-02-plan.md` (строка 4 → 4a/4b, статусы → ✅)

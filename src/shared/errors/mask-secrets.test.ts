/**
 * ────────────────────────────────────────────────────────────────────────────
 * ФАЙЛ:          src/shared/errors/mask-secrets.test.ts
 * СЛОЙ:          Общее ядро (shared) → ошибки (тест)
 * РОЛЬ:          Проверяет, что maskSecrets распознаёт все поддерживаемые форматы секретов
 *                и не портит текст без секретов; отвечает на вопрос [секрет] ритуала
 *                шести вопросов (docs/checklists/six-questions.md)
 * ИСПОЛЬЗУЕТСЯ:  npm run test
 * ТЕСТЫ:         это и есть тест
 * 1С:            —
 * ────────────────────────────────────────────────────────────────────────────
 */
import { describe, expect, it } from 'vitest';
import { maskSecrets } from './mask-secrets.ts';

describe('maskSecrets', () => {
  it('строку без секретов возвращает без изменений', () => {
    expect(maskSecrets('обычное сообщение об ошибке')).toBe('обычное сообщение об ошибке');
  });

  it('пустую строку возвращает как есть', () => {
    expect(maskSecrets('')).toBe('');
  });

  it('[секрет] токен T-Invest в начале строки маскируется', () => {
    const token = 't.' + 'a'.repeat(25);
    expect(maskSecrets(`${token} остальной текст`)).toBe('t.*** остальной текст');
  });

  it('[секрет] токен T-Invest в середине и в конце строки маскируется', () => {
    const token = 't.' + 'b'.repeat(30);
    expect(maskSecrets(`Authorization: Bearer тут не токен, а вот ${token}`).endsWith('t.***')).toBe(true);
  });

  it('[секрет] несколько токенов T-Invest в одной строке маскируются оба', () => {
    const a = 't.' + 'a'.repeat(20);
    const b = 't.' + 'b'.repeat(20);
    expect(maskSecrets(`${a} и ${b}`)).toBe('t.*** и t.***');
  });

  it('[секрет] токен T-Invest, заканчивающийся на "-", маскируется целиком', () => {
    // Регресс на убранный завершающий \b: `-` — не \w-символ, и \b на границе
    // «не-\w → конец строки/пробел» не сработал бы, обрезая совпадение раньше времени.
    const token = 't.' + 'a'.repeat(19) + '-';
    expect(maskSecrets(`токен ${token} тут`)).toBe('токен t.*** тут');
  });

  it('[секрет] короткая последовательность ниже порога не маскируется', () => {
    const short = 't.abc'; // меньше 20 символов после t.
    expect(maskSecrets(`случайное ${short} в тексте`)).toBe(`случайное ${short} в тексте`);
  });

  it('[секрет] токен Telegram-бота маскируется', () => {
    const token = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567890';
    expect(maskSecrets(`бот ${token} недоступен`)).toBe('бот [telegram-bot-token] недоступен');
  });

  it('[секрет] Bearer-токен любого формата маскируется, префикс Bearer остаётся читаемым', () => {
    expect(maskSecrets('Authorization: Bearer some-opaque-token-xyz')).toBe(
      'Authorization: Bearer [masked]',
    );
  });

  it('[секрет] Bearer маскируется без учёта регистра', () => {
    expect(maskSecrets('authorization: bearer some-opaque-token-xyz')).toBe(
      'authorization: Bearer [masked]',
    );
  });

  it('[секрет] T-Invest и Telegram-токен в одной строке маскируются независимо', () => {
    const tInvest = 't.' + 'a'.repeat(20);
    const telegram = '987654321:XyzABCdefGhIJKlmNoPQRsTUVwxyZ1234';
    expect(maskSecrets(`${tInvest} и ${telegram}`)).toBe('t.*** и [telegram-bot-token]');
  });

  it('регресс на lastIndex: два вызова подряд дают одинаковый результат', () => {
    const text = 't.' + 'a'.repeat(25) + ' и ещё раз t.' + 'b'.repeat(25);
    expect(maskSecrets(text)).toBe(maskSecrets(text));
  });
});

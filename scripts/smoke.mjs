const TOKEN = process.env.TINVEST_SANDBOX_TOKEN;
if (!TOKEN) { console.error('❌ Нет TINVEST_SANDBOX_TOKEN в .env'); process.exit(1); }

const BASE = 'https://sandbox-invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1';

async function call(service, method, body = {}) {
  const res = await fetch(`${BASE}.${service}/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${service}/${method} → HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// Quotation/MoneyValue { units: "123", nano: 450000000 } → 123.45 (нулевые поля API опускает)
const num = (q) => Number(q?.units ?? 0) + (q?.nano ?? 0) / 1e9;

// 1. Счёт в песочнице: берём существующий или открываем новый на 1 млн ₽
const { accounts = [] } = await call('SandboxService', 'GetSandboxAccounts');
let accountId = accounts[0]?.id;
if (!accountId) {
  ({ accountId } = await call('SandboxService', 'OpenSandboxAccount'));
  await call('SandboxService', 'SandboxPayIn', {
    accountId, amount: { currency: 'rub', units: '1000000', nano: 0 },
  });
  console.log(`Открыт новый счёт в песочнице: ${accountId}`);
} else {
  console.log(`Счёт в песочнице: ${accountId}`);
}

const pf = await call('SandboxService', 'GetSandboxPortfolio', { accountId });
console.log(`Стоимость портфеля: ${num(pf.totalAmountPortfolio).toLocaleString('ru-RU')} ₽`);

// 2. Сбер в основном режиме торгов TQBR
const { instruments = [] } = await call('InstrumentsService', 'FindInstrument', { query: 'SBER' });
const sber = instruments.find((i) => i.ticker === 'SBER' && i.classCode === 'TQBR');
if (!sber) throw new Error('SBER / TQBR не найден');
console.log(`SBER: uid=${sber.uid}, figi=${sber.figi}`);

// 3. Дневные свечи за последние 10 дней (даты — по Москве)
const to = new Date();
const from = new Date(to.getTime() - 10 * 86400_000);
const { candles = [] } = await call('MarketDataService', 'GetCandles', {
  instrumentId: sber.uid, from: from.toISOString(), to: to.toISOString(), interval: 'CANDLE_INTERVAL_DAY',
});
for (const c of candles) {
  const d = new Date(c.time).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
  console.log(`${d}  O ${num(c.open)}  H ${num(c.high)}  L ${num(c.low)}  C ${num(c.close)}  V ${c.volume}`);
}
console.log('✅ Песочница и рыночные данные работают');

# Sprint 01 — Развёртывание окружения

| | |
|---|---|
| Статус | ✅ завершён |
| Дата | 10.09.2026 |
| Коммиты | `ac57872` (bootstrap), этот документ |
| Тег | `sprint-01` |

## Итог спринта

- На VPS (Ubuntu 24.04) создан изолированный пользователь `trader` без sudo. Робот и Claude Code работают только под ним, MERN-проекты остаются под `root`.
- SSH — только по ключам, вход по паролю отключён.
- Установлены Node.js 24 (через nvm) и Claude Code.
- Доступ к T-Invest API: сертификаты НУЦ Минцифры подключаются только к процессам робота через `NODE_EXTRA_CA_CERTS`.
- Smoke-тест `npm run smoke` проходит: счёт в песочнице (виртуальный 1 млн ₽), поиск инструмента, дневные свечи.

## Архитектура

```
Домашний ПК ─┐                     VPS (Ubuntu 24.04)
Офисный ПК  ─┼─ VS Code ── SSH ──┬─ root   → MERN-проекты, Caddy, PM2, MongoDB
Ноутбук     ─┘  Remote-SSH       └─ trader → ~/trader-agent (робот), Claude Code, ~/certs
                                                │
                                                └─ HTTPS → T-Invest API (песочница / прод)
```

Принципы:

- Робот работает в **одном экземпляре на сервере**, никогда на локальных машинах.
- Токены живут **только** в `.env` на сервере (права 600). Не в чате, не в командах терминала, не в git.
- У `trader` нет sudo: ни робот, ни ИИ-агент не могут трогать систему и другие проекты.

## Требования

**Сервер**
- Ubuntu 24.04 LTS, x86_64.
- От 2 vCPU и от 4 ГБ RAM (минимум для Claude Code), плюс swap 2–4 ГБ; от 20 ГБ свободного диска.
- Сервер должен стоять в стране, где работает Claude Code: <https://www.anthropic.com/supported-countries>. Россия в этот список не входит.

**Аккаунты**
- Брокерский счёт в Т-Инвестициях. В настройках отключено «Подтверждение сделок кодом».
- Подписка Claude Pro или Max (для Claude Code).
- Приватный репозиторий `trader-agent` на GitHub.

---

## Шаг 0. Токены Т-Инвестиций

Токены выпускаются в разделе «Настройки → Токены T-Invest API» (<https://www.tbank.ru/invest/settings/>). Делайте это с компьютера, а не с телефона.

| Токен | Для чего | Когда выпускать |
|---|---|---|
| Sandbox | Песочница, разработка, тесты | Сразу |
| Read-only | MCP-сервер, аналитика | Сразу |
| Full-access на **конкретный счёт робота** | Боевая торговля | Только перед выходом в бой |

- Токен показывается один раз, поэтому сразу сохраняйте его в менеджер паролей.
- Токен истекает через 3 месяца с даты последнего использования.
- Отозвать токен: <https://www.tbank.ru/mybank/profile/security/> → «Приложения, у которых есть доступ к данным для входа».
- ⚠️ Токен, попавший в чат, на скриншот, в команду терминала или в git, считается скомпрометированным. Его нужно отозвать и перевыпустить.

## Шаг 1. Локальные компьютеры (Windows)

**1.1. SSH-ключ.** Если ключа нет, создайте его: `ssh-keygen -t ed25519`. Парольную фразу задавать можно и нужно.

**1.2. ssh-agent**, чтобы вводить парольную фразу один раз. PowerShell от администратора:

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
```

Затем в обычном PowerShell:

```powershell
ssh-add $env:USERPROFILE\.ssh\id_ed25519
```

**1.3. `C:\Users\<вы>\.ssh\config`** — по одному алиасу на каждого пользователя:

```ssh_config
Host domtat
    HostName <IP_СЕРВЕРА>
    User root

Host trader
    HostName <IP_СЕРВЕРА>
    User trader
```

- Не допускайте дублей `Host`. SSH берёт первое совпадение, а второй блок с тем же именем молча игнорирует.
- `ForwardAgent` для `trader` не включать: иначе процессы на сервере получат доступ к вашим личным ключам.

**1.4. VS Code.** Установите расширение Remote-SSH. В Remote Explorer появятся хосты `domtat` и `trader`, каждый открывается в своём окне. Каждое подключение запускает на сервере свой VS Code Server (около 1 ГБ RAM), поэтому неиспользуемые окна лучше закрывать.

## Шаг 2. Сервер, под root

**2.1. Ключи.** При первом входе провайдер обычно даёт root с паролем. Добавьте ключи всех своих компьютеров, выполнив команду с каждого:

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@<IP_СЕРВЕРА> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Затем проверьте с каждого компьютера:

```powershell
ssh -o PreferredAuthentications=publickey domtat "echo KEY_OK"
```

**2.2. Отключение входа по паролю.** Делайте это, только когда `KEY_OK` проходит со всех компьютеров:

```bash
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl restart ssh
sshd -T | grep -Ei '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin)'
```

Ожидаемый результат: `no`, `no`, `without-password`. Текущую сессию не закрывайте, пока не проверите вход в новом окне. Аварийный доступ — веб-консоль (VNC) хостера.

Имя файла начинается с `00-`, чтобы он читался раньше `50-cloud-init.conf`: sshd использует первое найденное значение параметра.

**2.3. Swap**, если его нет (проверка: `free -h`):

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**2.4. Файрвол.** Роботу входящие порты не нужны.

```bash
ufw allow OpenSSH
ufw allow 80,443/tcp      # только если на сервере есть веб
ufw enable
ufw status
```

Порты dev-серверов (5173, 3001 и подобные) наружу не открывайте. Для доступа к ним есть Caddy или SSH-туннель.

**2.5. Пользователь `trader`:**

```bash
adduser --disabled-password --comment "" trader
install -d -m 700 -o trader -g trader /home/trader/.ssh
install -m 600 -o trader -g trader /root/.ssh/authorized_keys /home/trader/.ssh/authorized_keys
awk '{print $1, $NF}' /home/trader/.ssh/authorized_keys
```

- В `authorized_keys` оставьте только ключи своих компьютеров. Ключи CI и деплоя роботу не нужны.
- sudo пользователю `trader` **не давать**.

Проверка с локального компьютера: `ssh trader "whoami"` выводит `trader`.

## Шаг 3. Сервер, под trader: доступ к репозиторию

Дальше всё делается в VS Code на хосте `trader`. Следите за приглашением терминала: там должно быть `trader@…`, а не `root@…`.

Создайте ключ для репозитория:

```bash
ssh-keygen -t ed25519 -C "trader-agent@$(hostname)" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Добавьте его на GitHub: репозиторий `trader-agent` → Settings → Deploy keys → Add deploy key, отметьте ✅ Allow write access. Deploy key даёт доступ только к одному репозиторию. Затем:

```bash
ssh -T git@github.com     # ожидаемо: "Hi <login>/trader-agent! You've successfully authenticated..."
git clone git@github.com:<login>/trader-agent.git ~/trader-agent
git config --global user.name "Ваше Имя"
git config --global user.email "ваш@email"
```

## Шаг 4. Node.js и Claude Code

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
cd ~/trader-agent && nvm install          # версия Node берётся из .nvmrc
curl -fsSL https://claude.ai/install.sh | bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
node -v && claude --version
```

При первом запуске `claude` предложит войти через браузер.

## Шаг 5. Сертификаты НУЦ Минцифры

T-Invest API работает на сертификатах Минцифры, которых нет в стандартных хранилищах. Без них запросы падают с ошибкой `SSL certificate problem: self-signed certificate in certificate chain`.

Сертификаты ставим не в систему, а в `~/certs`, и подключаем только к процессам робота через `NODE_EXTRA_CA_CERTS` в `package.json`. Node.js системное хранилище всё равно не использует, а остальной сервер продолжает доверять только стандартным центрам сертификации.

```bash
mkdir -p ~/certs && cd ~/certs
curl -fsSLO https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
curl -fsSLO https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
for f in russian_trusted_root_ca_pem.crt russian_trusted_sub_ca_pem.crt; do openssl x509 -in "$f"; done > russian-trusted-ca.pem
grep -c 'BEGIN CERTIFICATE' russian-trusted-ca.pem
for f in russian_trusted_*_pem.crt; do openssl x509 -in "$f" -noout -subject -enddate; done
curl -sS -o /dev/null -w "sandbox: HTTP %{http_code}\n" --cacert ~/certs/russian-trusted-ca.pem \
  -X POST -H "Content-Type: application/json" -d '{}' \
  https://sandbox-invest-public-api.tbank.ru/rest/tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts
```

Ожидаемый результат:
- `2`;
- subject `Russian Trusted Root CA` и `Russian Trusted Sub CA`;
- `sandbox: HTTP 401`. Ответ 401 означает, что TLS в порядке и сервер просто просит токен.

⚠️ Не склеивайте сертификаты через `cat`. Первый файл заканчивается без перевода строки, и получается битый PEM: `curl: (77)` и `bad end line` в Node. Собирайте только через `openssl x509`.

Источники: портал Госуслуг <https://www.gosuslugi.ru/crt>, инструкция Т-Банка <https://developer.tbank.ru/docs/tls-settings>.

## Шаг 6. Токен и smoke-тест

```bash
cd ~/trader-agent
cp .env.example .env && chmod 600 .env
```

Откройте `.env` в VS Code и впишите **настоящий** токен после `=`, без кавычек и пробелов:

```
TINVEST_SANDBOX_TOKEN=t.xxxxxxxxxxxxxxxx
```

Проверьте, что токен на месте, не показывая его целиком, и запустите тест:

```bash
sed -E 's/=(.{6}).*/=\1…/' .env     # ожидаемо: TINVEST_SANDBOX_TOKEN=t.XXXX…
npm run smoke
```

Ожидаемый результат: номер счёта в песочнице, портфель около 1 000 000 ₽, uid и figi SBER, дневные свечи за 10 дней и строка `✅ Песочница и рыночные данные работают`.

| Файл | Содержимое | В git? |
|---|---|---|
| `.env` | Секреты (токены) | ❌ никогда |
| `.env.example` | Шаблон: только имена переменных, без значений | ✅ |

Когда в проекте появятся зависимости, в этот шаг добавится `npm ci`.

---

## Грабли, на которые наступили

| Симптом | Причина | Решение |
|---|---|---|
| Токены отправлены в чат или набраны в команде `printf` | Токен остался в истории переписки и в `~/.bash_history` | Отозвать и перевыпустить. Токены вводить только в редакторе |
| Настоящий токен в `.env.example` | Спутаны шаблон и секреты | В `.env.example` только `KEY=` без значений |
| `ByteString ... index 7 has a value of 1074` | В `.env` осталась кириллица: плейсхолдер вместо токена. Индекс 7 — первый символ после `Bearer ` | Вписать настоящий токен |
| `SSL certificate problem: self-signed certificate in certificate chain` | Нет сертификатов Минцифры | Шаг 5 |
| `curl: (77) error setting certificate file`, `PEM routines::bad end line` | Сертификаты склеены через `cat` без перевода строки | Пересобрать через `openssl x509` |
| SSH просит пароль для `trader` | Пользователь не создан или его ключа нет в `authorized_keys` | Шаг 2.5 |
| Подключение по IP всегда идёт не под тем пользователем | Два блока `Host` с одинаковым именем в `~/.ssh/config` | Уникальные алиасы: `domtat`, `trader` |
| `Enter passphrase for key ...` | Это парольная фраза локального ключа, а не пароль сервера | ssh-agent (Шаг 1.2) |
| `claude: command not found` после установки | `~/.local/bin` не в PATH | Добавить в `~/.bashrc` (Шаг 4) |
| Команды выполнились под `root` вместо `trader` | Открыт не тот терминал или хост | Проверять приглашение `user@host` |
| Многострочный блок сработал как одна строка | При копировании потерялись переносы строк | Вставлять блоки целиком, не склеивать `{ ... }` в одну строку |
| `warning: re-init: ignored --initial-branch=main` | Повторный `git init` | Безвредно |

## Наблюдения по данным (для следующих спринтов)

- **Выходные сессии.** Объём торгов в 5–10 раз ниже, чем в будни, спреды шире. Стратегия должна явно решать, торгует ли она в выходные.
- **Незавершённая свеча.** Последняя свеча интервала может быть ещё не закрыта (`isComplete: false`). Использовать её для сигналов нельзя.
- **Объём в лотах.** `volume` в свечах указан в лотах, а не в штуках. У SBER 1 лот = 10 акций.
- **Денежные значения** приходят как `{ units, nano }`. Нулевые поля в JSON опускаются.
- **Идентификатор инструмента** — `uid`. Искать его через `FindInstrument` с фильтром по `classCode` (для акций основной режим торгов — `TQBR`).
- **Время.** API и сервер работают в UTC. Московское время используется только для отображения и в логике торгового расписания.

## Регламент обслуживания

| Что | Когда | Действие |
|---|---|---|
| Russian Trusted Sub CA | Истекает 06.03.2027 | В феврале 2027 скачать заново (Шаг 5) |
| Russian Trusted Root CA | Истекает 27.02.2032 | — |
| Токены T-Invest | Истекают через 3 мес. без использования | Перевыпустить, обновить `.env` |
| Ключи в `authorized_keys` | При смене компьютера | Удалить ключи устройств, которыми больше не пользуетесь |

## Следующий спринт

**Sprint 02 — первая стратегия:** описание → исторические данные → бэктест → песочница. Параллельно строим каркас робота: выбор SDK или клиента, логирование, риск-лимиты, запуск под PM2.

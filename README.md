# CS2 Scope

Современный сервис поиска публичных CS2-профилей. Введите Steam ID64, ссылку на профиль Steam / FACEIT или никнейм FACEIT, чтобы увидеть доступные данные игрока.

## Что умеет

- отображает публичный Steam-профиль и общее время в Counter-Strike 2;
- находит связанный FACEIT-профиль по Steam ID;
- показывает FACEIT level, Elo, число матчей, победы, win rate, K/D и другие lifetime-показатели;
- выводит до 20 последних матчей FACEIT и персональные показатели в них;
- показывает первые 100 предметов публичного CS2-инвентаря Steam;
- аккуратно сообщает о закрытом профиле, ограничениях API и временной недоступности данных;
- не передаёт Steam или FACEIT API-ключи в браузер.

## Важная граница данных

Valve **не предоставляет публичный API** с историей матчей, Premier-рейтингом, K/D и win rate для произвольного Steam-профиля. Поэтому этот проект не выдаёт данные FACEIT за данные Premier:

| Данные | Источник |
| --- | --- |
| Имя, аватар, время в CS2 | Steam Web API |
| Публичный инвентарь | Steam Community Inventory |
| Матчи, K/D, win rate, Elo и уровень | FACEIT Data API |

Если у игрока нет связанного FACEIT-аккаунта или профиль закрыт, соответствующий раздел будет недоступен. Для собственной полной истории Valve Matchmaking нужно отдельное добровольное подключение владельца аккаунта через Steam Game Authentication Code и обработку демок; это намеренно не реализовано для произвольных пользователей.

## Архитектура

```text
Браузер (GitHub Pages / любой статический хостинг)
  └── config.js: только URL API
        └── Cloudflare Worker (/v1/profile)
              ├── Steam Web API       — ключ остаётся в Worker
              ├── Steam Community     — публичный инвентарь
              └── FACEIT Data API     — ключ остаётся в Worker
```

`api/src/normalize.js` содержит преобразование ответов внешних API в единый формат и покрыт простыми тестами. `api/src/index.js` — Worker API: он валидирует вход, не раскрывает секреты, обрабатывает ошибки источников и кэширует успешный ответ на 5 минут.

## Быстрый запуск

Нужны Node.js 20+ и аккаунт Cloudflare для API.

```powershell
npm test
Copy-Item .dev.vars.example .dev.vars
npx wrangler@latest dev
```

В `.dev.vars` укажите свои ключи. Этот файл игнорируется Git и никогда не должен попадать в репозиторий.

Откройте статические файлы через локальный веб-сервер и настройте `config.js` на адрес запущенного Worker. Например, при разработке:

```js
window.CS2_SCOPE_CONFIG = { apiBase: 'http://127.0.0.1:8787' };
```

## Развёртывание

1. Создайте Steam Web API key и FACEIT Data API key в кабинетах соответствующих платформ.
2. Авторизуйтесь в Cloudflare и задайте секреты — **не** добавляйте их в `config.js`:

   ```powershell
   npx wrangler@latest secret put STEAM_API_KEY
   npx wrangler@latest secret put FACEIT_API_KEY
   npx wrangler@latest deploy
   ```

3. Скопируйте `config.example.js` в `config.js` и укажите URL развёрнутого Worker.
4. Опубликуйте корень репозитория на GitHub Pages, Cloudflare Pages, Netlify или другом статическом хостинге.

Для открытого production API дополнительно включите rate limiting / WAF на уровне Cloudflare и ограничьте CORS разрешённым доменом, если фронтенд размещён на известном домене.

## API

```text
GET /v1/profile?query={steam-id|steam-url|faceit-url|nickname}&inventory=1
GET /health
```

Успешный ответ объединяет блоки `profile`, `steam`, `faceit`, `notices` и `sources`. Клиент рендерит текст через DOM API, а не через `innerHTML`, поэтому названия предметов из внешнего источника не могут стать HTML-кодом страницы.

## Проверка

```powershell
npm test
node --check app.js
node --check api/src/index.js
```

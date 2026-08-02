# Веб-поиск ботов — свой SearXNG

Поставлен 02.08.2026 вместо покупных поисковых API. Ключей нет, квот нет, платить не за что.

## Где что стоит

| Сервер | Что на нём | Роль в поиске |
|---|---|---|
| `46.62.142.237` | контейнер `searxng` в `/opt/searxng`; бот с агентами `razryv`, `trezvost` | **хост SearXNG**, ходит в него напрямую по `127.0.0.1:8888` |
| `89.167.101.53` | Логос (`@AIMarketingExpert`), все утренние автопрогоны | клиент, через SSH-туннель |
| `204.168.146.130` | Ляпис (`@lapis_aibot`), «Хайп Новости» | клиент, через SSH-туннель |

## Как устроен доступ

SearXNG слушает **только `127.0.0.1:8888`** на своём сервере — наружу порт не
опубликован вообще. Боты с других серверов ходят через SSH-туннель:

- юнит `searxng-tunnel.service` (systemd, `Restart=always`) держит
  `ssh -N -L 127.0.0.1:8888:127.0.0.1:8888 searx-tunnel@46.62.142.237`;
- ключ `/root/.ssh/searx_tunnel_ed25519`, отдельный на каждом сервере;
- на стороне SearXNG — служебный пользователь `searx-tunnel` с `nologin`, в
  `authorized_keys` стоит `restrict,port-forwarding,permitopen="127.0.0.1:8888"`,
  то есть ключ умеет ровно один проброс и ничего больше.

Туннель нужен не только ради безопасности: openclaw отказывается работать с
`http://` на публичный IP — «SearXNG HTTP base URL must target a trusted private
or loopback host». Через туннель адрес становится loopback и проверка проходит.

Есть ещё ACL в `DOCKER-USER` (`/opt/searxng/firewall.sh`, юнит
`searxng-firewall.service`) — подстраховка на случай, если порт когда-нибудь снова
опубликуют наружу.

## Конфиг бота

```json
"tools": { "web": { "search": { "provider": "searxng", "enabled": true } } },
"plugins": { "entries": { "searxng": { "enabled": true, "config": { "webSearch": {
  "baseUrl": "http://127.0.0.1:8888",
  "categories": "general,news,social media"
} } } } }
```

`categories` по ботам: Логос и razryv/trezvost — `general,news,social media`
(истории, форумы), Ляпис — `general,news,science` (научный радар).

На openclaw 2026.7+ плагина searxng нет в комплекте, ставится отдельно:
`openclaw plugins install @openclaw/searxng-plugin`.

⚠️ `openclaw.json` в корне этого репозитория настройки SearXNG **не содержит**, а
`deploy-marketing.ps1` заливает его на сервер поверх. Сейчас это не стреляет: на
46.62.142.237 бот работает нативно из `/root/.openclaw`, а контейнеры из
`/opt/marketing-bot` остановлены. Но если соберётесь деплоить этим скриптом —
сначала перенесите в репозиторный `openclaw.json` блоки `tools.web.search` и
`plugins.entries.searxng`.

## Движки

С серверных IP половина движков отдаёт CAPTCHA. Проверено 02.08.2026, в
`/opt/searxng/config/settings.yml` отключены нерабочие и включены рабочие:

- **работают:** google cse, duckduckgo (через SearXNG — он умеет обходить то, на чём
  падает прямой запрос), qwant news, duckduckgo news, dogpile news, bing news,
  wikinews, boardreader (форумы), lemmy, mastodon, arxiv, pubmed, semantic scholar,
  google scholar, openaire;
- **отключены как мёртвые:** google news, reuters, startpage, brave, fireball news,
  tusksearch news, mojeek news, 9gag, tootfinder.

Если поиск снова начнёт пустеть — сначала прогнать эту проверку, движки со временем
закрываются:

```bash
curl -s 'http://127.0.0.1:8888/search?q=test&format=json' | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['results']), d['unresponsive_engines'])"
```

## Reddit — мимо SearXNG

Движка reddit в этой сборке SearXNG нет, а прямые запросы к reddit.com отдают **403**
(блок по TLS-отпечатку: не помогает ни браузерный User-Agent, ни валидный OAuth-токен
анонимного клиента — проверено 02.08.2026 со всех четырёх серверов и с домашнего
компьютера). Зато **RSS-ленты отдаются нормально**, если ходить браузерными заголовками
и не частить.

Отсюда отдельный инструмент `/root/.openclaw/customskills/reddit/reddit.mjs` на сервере
Логоса — команды `sub`, `search`, `thread`. Он даёт полные тексты постов и комментарии,
чего поисковая выдача не даёт. Внутри троттлинг: пауза 12 с между запросами и ретраи с
backoff на 429, иначе Reddit блокирует пачку запросов почти сразу.

Подробности использования — в [ИНСТРУКЦИЯ_АВТОПРОГОНЫ.md](ИНСТРУКЦИЯ_АВТОПРОГОНЫ.md),
раздел «Reddit напрямую».

## Диагностика

```bash
systemctl is-active searxng-tunnel
curl -s 'http://127.0.0.1:8888/search?q=test&format=json' | head -c 200
docker logs --tail 50 searxng
```

## Почему ушли с Brave

02.08.2026 в 3:36 МСК прилетело «Перерасход веб-поиска» — месячная квота Brave
выбрана (`x-ratelimit-remaining: 49, 0` — 49 в секунду, 0 на месяц). В 3:52 всех
ботов переключили на DuckDuckGo, а он с серверных IP отдаёт бот-детект — и утром
02.08 не отработал ни один крон ни на одном боте. SearXNG снимает обе проблемы
сразу: своя инфраструктура, лимитов нет.

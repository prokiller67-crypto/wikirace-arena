@AGENTS.md

# WikiRace Arena — состояние проекта (JecHacks 2026)

Сабмит на хакатон JecHacks (https://jechacks.devpost.com/), дедлайн 11 июля 2026, 21:00 EDT.
Проект ГОТОВ и задеплоен; протестирован вживую, включая реальную мультиплеер-гонку двух игроков.

## Ссылки
- Прод: https://wikirace-arena.vercel.app (Vercel, проект wikirace-arena, команда virtbasket-9565s-projects)
- GitHub: https://github.com/prokiller67-crypto/wikirace-arena (public)
- Текст для Devpost: `../DEVPOST_SUBMISSION.md` (в соседней папке JecHacks)

## Что это
Гонки по Википедии: от стартовой статьи до целевой только по ссылкам внутри статей.
Три режима:
1. Соло против бота-призрака (3 сложности: chill/sweaty/goated) — `/race?start=X&target=Y&ghost=Z`
2. Challenge-ссылки — весь забег (путь+тайминги) кодируется в base64url в хэш URL (`/race#c=...`), друг гонится против «живого призрака» без всякого бэкенда
3. Live-комнаты до 8 игроков — `/room/CODE`, синхронный отсчёт, живые бары прогресса

## Архитектура
- Next.js 16 + React 19 + Tailwind 4, TypeScript, App Router
- Статьи Википедии качаются ИЗ БРАУЗЕРА (REST API, CORS открыт) и санитизируются клиентски (lib/wiki.ts: DOMParser, скрипты вырезаются, ссылки переписываются на data-wl-title, служебные неймспейсы блокируются)
- Комнаты: serverless API (app/api/room/*) + Upstash Redis (Marketplace-ресурс upstash-kv-pink-garden, env KV_REST_API_URL/KV_REST_API_TOKEN — sensitive, локально не читаются), поллинг 1.5 c; локально без env — in-memory fallback
- Победа определяется сравнением КАНОНИЧЕСКИХ тайтлов (редиректы учтены)
- Прокси /api/wiki/{html,summary,random} с CDN-кэшем: клиент гоняет прокси и прямую Википедию ПАРАЛЛЕЛЬНО (Promise.any в lib/wiki.ts), быстрейший побеждает

## Важные грабли, которые уже прошли (НЕ ломать)
- Tailwind v4: CSS-переменные в утилитах пишутся `text-(--acid)`, НЕ `text-[--acid]`
- Навигация по статье — на `pointerdown`, НЕ на `click`: физические прожатия макбучного тачпада глотаются браузером как микро-выделения (это стоило нам часа дебага «ссылки не кликаются»)
- Синхронизация старта комнат — по времени СЕРВЕРА (clockOffset в RoomClient/RaceClient), у игроков бывают сбитые часы; вотчдог снимает застрявший отсчёт через 15 c
- Git-тег `stable-good` — проверенная версия без прокси, на случай отката

## Осталось сделать
- Засабмитить на Devpost руками Никиты (текст готов в DEVPOST_SUBMISSION.md)
- Опционально: Quick Match (матчмейкинг случайных соперников) — НЕ начинали

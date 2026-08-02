#!/usr/bin/env node
/**
 * Чтение Reddit через RSS-ленты.
 *
 * JSON API и oauth.reddit.com с наших серверов отдают 403 (блок по TLS-отпечатку,
 * токен не помогает — проверено 02.08.2026). А вот .rss отдаётся нормально, если
 * ходить браузерными заголовками и не частить: подряд идущие запросы ловят 429.
 * Поэтому здесь встроен троттлинг — пауза между запросами и ретраи с backoff.
 *
 * Команды:
 *   reddit.mjs sub <саб> [--limit N]
 *   reddit.mjs search <запрос> [--sub САБ] [--time hour|day|week|month|year|all]
 *                              [--sort relevance|top|new|comments] [--limit N]
 *   reddit.mjs thread <url поста> [--limit N]
 *
 * Флаг --json — выдать структурой вместо текста.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const STAMP = "/tmp/.reddit-rss-last";
const MIN_GAP_MS = 12_000;
const RETRY_WAITS_MS = [30_000, 60_000];

function argFlag(args, name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
}

/** Держит паузу между запросами: Reddit жёстко режет пачки. */
async function throttle() {
  let last = 0;
  try {
    last = Number(readFileSync(STAMP, "utf8")) || 0;
  } catch {
    /* первого запуска ещё не было */
  }
  const wait = last + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  writeFileSync(STAMP, String(Date.now()));
}

async function fetchFeed(url) {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/atom+xml,text/xml,*/*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    if (res.ok) return await res.text();
    if (res.status === 429 && attempt < RETRY_WAITS_MS.length) {
      await sleep(RETRY_WAITS_MS[attempt]);
      continue;
    }
    throw new Error(
      `Reddit ответил ${res.status}. ` +
        (res.status === 429
          ? "Слишком часто — подожди пару минут."
          : "Возможно, саб приватный или его нет."),
    );
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescapeOnce = (s) =>
  s
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** В лентах Reddit html экранирован дважды. */
function toText(html) {
  const decoded = unescapeOnce(unescapeOnce(html));
  return decoded
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    // Хвост, который Reddit клеит к каждой записи ленты.
    .replace(/submitted by\s*\/u\/\S+\s*\[link\]\s*\[comments\]\s*$/i, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseEntries(xml) {
  const out = [];
  for (const [, block] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const pick = (re) => (block.match(re) || [, ""])[1];
    out.push({
      title: toText(pick(/<title[^>]*>([\s\S]*?)<\/title>/)),
      url: pick(/<link[^>]*href="([^"]+)"/),
      author: toText(pick(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/)),
      published: pick(/<(?:published|updated)>([^<]+)</),
      text: toText(pick(/<content[^>]*>([\s\S]*?)<\/content>/)),
    });
  }
  return out;
}

function render(items, { withText }) {
  if (!items.length) return "Ничего не нашлось.";
  return items
    .map((it, i) => {
      const head = `${i + 1}. ${it.title}`;
      const meta = `   ${it.author || "?"} | ${(it.published || "").slice(0, 10)} | ${it.url}`;
      if (!withText || !it.text) return `${head}\n${meta}`;
      const body = it.text.length > 1200 ? `${it.text.slice(0, 1200)}…` : it.text;
      return `${head}\n${meta}\n${body.replace(/^/gm, "   ")}`;
    })
    .join("\n\n");
}

const [, , cmd, ...rest] = process.argv;
const asJson = rest.includes("--json");
const limit = Number(argFlag(rest, "limit", "10"));
const positional = rest.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && rest[i - 1].startsWith("--")),
);

try {
  let url;
  let withText = true;

  if (cmd === "sub") {
    const sub = (positional[0] || "").replace(/^r\//, "");
    if (!sub) throw new Error("Укажи саб: reddit.mjs sub BreakUps");
    url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/.rss`;
  } else if (cmd === "search") {
    const q = positional.join(" ");
    if (!q) throw new Error("Укажи запрос: reddit.mjs search breakup regret");
    const sub = argFlag(rest, "sub");
    const params = new URLSearchParams({
      q,
      sort: argFlag(rest, "sort", "top"),
      t: argFlag(rest, "time", "week"),
    });
    if (sub) {
      params.set("restrict_sr", "on");
      url = `https://www.reddit.com/r/${encodeURIComponent(sub.replace(/^r\//, ""))}/search.rss?${params}`;
    } else {
      url = `https://www.reddit.com/search.rss?${params}`;
    }
    withText = false; // в поисковой выдаче тела постов нет, только заголовки
  } else if (cmd === "thread") {
    const link = positional[0];
    if (!link || !link.includes("/comments/")) {
      throw new Error("Укажи ссылку на пост: reddit.mjs thread https://www.reddit.com/r/.../comments/...");
    }
    url = `${link.replace(/\/+$/, "").replace(/\.rss$/, "")}.rss`;
  } else {
    console.log(
      [
        "Чтение Reddit. Команды:",
        "  sub <саб> [--limit N]                    — свежие посты сабреддита с текстом",
        "  search <запрос> [--sub САБ] [--time week] [--sort top] [--limit N]",
        "  thread <url поста> [--limit N]           — пост целиком + комментарии",
        "",
        "Между запросами автоматическая пауза 12 с — Reddit режет пачки (429).",
        "Планируй 3-5 вызовов на прогон, не больше.",
      ].join("\n"),
    );
    process.exit(0);
  }

  const items = parseEntries(await fetchFeed(url)).slice(0, limit);
  console.log(asJson ? JSON.stringify(items, null, 2) : render(items, { withText }));
} catch (err) {
  console.error(`ОШИБКА: ${err.message}`);
  process.exit(1);
}

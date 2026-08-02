#!/usr/bin/env node
// sp.mjs — надёжная обёртка над SmartPosting bot-API для агента Логос.
// Строит валидный JSON в коде, грузит локальные картинки, читает/правит рассылки,
// опрашивает задачу и честно печатает ref/ошибку.
//
//   node sp.mjs whoami                 — паспорт аккаунта ключа (ВЫЗЫВАТЬ ПЕРВЫМ)
//   node sp.mjs projects               — какие проекты настроены в окружении
//   (к любой команде можно добавить --project <slug> → возьмёт ключ SP_KEY_<SLUG>)
//   node sp.mjs find "<ник|email>"
//   node sp.mjs draft --title "T" --textfile /tmp/t.txt [--segment all] [--button-text "X" --button-url "U"]
//        [--lastimage | --imagefile <localpath>] [--bank-asset ID] [--banner-prompt "P"] [--schedule "<ISO+03:00>"]
//   node sp.mjs get <broadcastId>
//   node sp.mjs edit <broadcastId> [--textfile F] [--title T] [--button-text X --button-url U]
//        [--lastimage | --imagefile <localpath>] [--segment S] [--schedule "<ISO+03:00>"]
//   node sp.mjs bank [--lastimage | --file <localpath>] [--category review|stats|result|other] [--tags a,b] [--note "..."]
//   node sp.mjs send <broadcastId>   |   schedule <broadcastId> "<ISO+03:00>"   |   grant <ник> <plan> <days>
//   node sp.mjs query <action> [--args '<json>']
//
// ПОСТЫ (контент-конвейер: концепт → пост → план):
//   node sp.mjs post --textfile /tmp/post.txt --platform threads|telegram [--schedule "<ISO+03:00>"]
//        [--lastimage | --imagefile <localpath> | --bank-asset ID | --image-url U | --banner-prompt "P"]
//   node sp.mjs posts [--status draft|scheduled|published] [--limit 20]
//   node sp.mjs getpost <postId>
//   node sp.mjs postplan <postId> "<ISO+03:00>"      — запланировать УЖЕ созданный пост
//   node sp.mjs postedit <postId> [--textfile F] [--platform P] [--schedule ISO] [--status S]
//   node sp.mjs postrewrite <postId> "<инструкция>"  — переписать текст моделью
//   node sp.mjs postdel <postId>
//   node sp.mjs postpublish <postId>                 — ОПУБЛИКОВАТЬ СЕЙЧАС (только telegram-канал)
//   node sp.mjs contentplan --topic "тема" [--days 7]  — контент-план (как вкладка «План»)
//
// СОВЕТ: чтобы прикрепить ТОЛЬКО ЧТО присланную Петром картинку — добавь флаг --lastimage
// (скрипт сам возьмёт последний файл из инбокса, путь искать не нужно).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const API = (process.env.SMARTPOSTING_API_URL || "").replace(/\/+$/, "");

// МУЛЬТИПРОЕКТНОСТЬ: у владельца несколько аккаунтов-проектов, у каждого свой бот-ключ.
// SMARTPOSTING_BOT_KEY — проект по умолчанию; SP_KEY_<SLUG> — конкретный проект,
// выбирается флагом --project <slug> (регистр не важен). Ключ РЕШАЕТ, в каком аккаунте
// произойдёт действие, поэтому промах ключом = работа в чужом проекте (уже случалось).
const PROJECTS = Object.keys(process.env)
  .filter((k) => k.startsWith("SP_KEY_") && process.env[k])
  .map((k) => k.slice("SP_KEY_".length).toLowerCase());

// --project нужно знать ДО разбора команд, поэтому argv сканируем сразу.
const projArgIdx = process.argv.indexOf("--project");
const PROJECT = projArgIdx > -1 ? String(process.argv[projArgIdx + 1] || "").toLowerCase() : "";

let KEY = process.env.SMARTPOSTING_BOT_KEY || "";
if (PROJECT) {
  const k = process.env[`SP_KEY_${PROJECT.toUpperCase()}`];
  if (!k) {
    console.error(
      `ERROR: проект "${PROJECT}" не настроен. Есть: ${PROJECTS.length ? PROJECTS.join(", ") : "(только проект по умолчанию)"}`
    );
    process.exit(2);
  }
  KEY = k;
}
if (!API || !KEY) { console.error("ERROR: env SMARTPOSTING_API_URL / SMARTPOSTING_BOT_KEY не заданы"); process.exit(2); }
const AUTH = { "Authorization": `Bearer ${KEY}` };
const H = { ...AUTH, "Content-Type": "application/json" };
const INBOUND = (process.env.OPENCLAW_STATE_DIR ? process.env.OPENCLAW_STATE_DIR.replace(/\/+$/, "") + "/media/inbound" : "/root/.openclaw/media/inbound");

function flags(argv) {
  const f = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = (argv[i + 1] && !argv[i + 1].startsWith("--")) ? argv[++i] : "true"; f[k] = v; }
    else pos.push(a);
  }
  return { f, pos };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fail(m, x) { console.error(`ERROR: ${m}${x ? " | " + x : ""}`); process.exit(1); }

// PAST-GUARD: планирование в прошлое = мгновенная отправка кроном. Запрещаем.
function assertFuture(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) fail("scheduledAt не парсится: " + iso + " — используй ISO с таймзоной, напр. 2026-07-03T14:30:00+03:00");
  if (d.getTime() < Date.now() + 2 * 60 * 1000) fail("scheduledAt в ПРОШЛОМ или ближе 2 мин (" + iso + ") — крон отправит СРАЗУ ЖЕ! Укажи будущее время с +03:00 (МСК)");
}


// PLATFORM-GUARD: у поста НЕТ безопасного умолчания — публикатор без platform шлёт в telegram.
// Для Threads-персон это публикация не туда, поэтому платформу требуем явно.
function assertPlatform(v) {
  const p = String(v || "").toLowerCase();
  if (p !== "threads" && p !== "telegram")
    fail(`нужен --platform threads|telegram (задано: ${v || "ничего"}). Без него пост уйдёт в TELEGRAM, даже если проект ведётся в Threads — сверься с паспортом проекта`);
  return p;
}

// Медиа к посту: локальный файл / последняя присланная картинка / ассет банка / URL / баннер по промпту.
async function mediaParams(f) {
  const out = {};
  const img = resolveImg(f);
  if (img) { out.mediaUrls = [await uploadFile(img)]; out.mediaType = "photo"; }
  else if (f["bank-asset"]) out.bankAssetId = f["bank-asset"];
  else if (f["image-url"]) out.imageUrl = f["image-url"];
  else if (f["banner-prompt"]) out.bannerPrompt = f["banner-prompt"];
  return out;
}

const IMG_EXT = /\.(jpg|jpeg|png|webp|gif)$/i;
function newestInbound() {
  let files;
  try { files = readdirSync(INBOUND); } catch { throw new Error(`инбокс не найден: ${INBOUND}`); }
  const imgs = files.filter(f => IMG_EXT.test(f)).map(f => { const p = join(INBOUND, f); return { p, m: statSync(p).mtimeMs }; }).sort((a, b) => b.m - a.m);
  if (!imgs.length) throw new Error(`в инбоксе нет картинок (${INBOUND}) — попроси Петра прислать фото ещё раз`);
  return imgs[0].p;
}
// разрешить путь картинки: --lastimage / --imagefile last → последний из инбокса; иначе как дан
function resolveImg(f, key = "imagefile") {
  if (f.lastimage) return newestInbound();
  const v = f[key];
  if (!v) return null;
  if (v === "last" || v === "newest") return newestInbound();
  return v;
}

async function apiPost(p, body) {
  const r = await fetch(`${API}${p}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { status: r.status, ok: r.ok, j };
}
async function apiGet(p) {
  const r = await fetch(`${API}${p}`, { headers: H });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  return { status: r.status, ok: r.ok, j };
}
function mime(p) { const e = p.toLowerCase().split(".").pop(); return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", pdf: "application/pdf" })[e] || "application/octet-stream"; }
async function uploadFile(localPath) {
  const buf = readFileSync(localPath);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: mime(localPath) }), basename(localPath));
  const r = await fetch(`${API}/api/bot/upload`, { method: "POST", headers: AUTH, body: fd });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; }
  if (!r.ok || !j.url) throw new Error(`upload HTTP ${r.status} ${t.slice(0, 200)}`);
  return j.url;
}
async function createTask(title, step, { sending = false } = {}) {
  const res = await apiPost("/api/bot/tasks", { type: "mixed", title, plan: [{ order: 1, action: step.action, summary: step.summary || step.action, params: step.params }] });
  if (!res.ok) throw new Error(`создание задачи HTTP ${res.status}: ${JSON.stringify(res.j)}`);
  let task = res.j.task || res.j; const id = task._id || task.id;
  if (Array.isArray(task.results) && task.results.length) return task;
  if (sending && id) {
    const ex = await apiPost(`/api/bot/tasks/${id}/execute`, {});
    if (!ex.ok) throw new Error(`execute HTTP ${ex.status}: ${JSON.stringify(ex.j)}`);
    const et = ex.j.task || ex.j;
    if (Array.isArray(et.results) && et.results.length) return et;
  }
  if (!id) return task;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const g = await apiGet(`/api/bot/tasks/${id}`);
    const t = g.j.task || g.j;
    if ((Array.isArray(t.results) && t.results.length) || ["completed", "failed", "cancelled"].includes(t.status)) return t;
  }
  throw new Error("задача не завершилась за отведённое время (проверь в приложении)");
}
function okRef(task) {
  const rs = Array.isArray(task.results) ? task.results : [];
  const ok = rs.find(r => r && r.ok);
  if (!ok) throw new Error("действие не выполнено: " + (rs.map(r => r.error || r.summary).join("; ") || `статус ${task.status}`));
  return { ref: ok.ref, summary: ok.summary || "" };
}

const [cmd, ...rest] = process.argv.slice(2);
const { f, pos } = flags(rest);

try {
  if (cmd === "projects") {
    // Какие проекты вообще настроены в окружении (ключи не печатаем).
    console.log(`проект по умолчанию: ${process.env.SMARTPOSTING_BOT_KEY ? "есть (--project не указывать)" : "НЕТ"}`);
    console.log(`именованные проекты: ${PROJECTS.length ? PROJECTS.join(", ") : "(нет)"}`);
    console.log(`сейчас выбран: ${PROJECT || "по умолчанию"}`);
    console.log(`чтобы узнать, что за аккаунт: sp.mjs whoami${PROJECT ? ` --project ${PROJECT}` : ""}`);
    process.exit(0);
  }
  else if (cmd === "whoami") {
    // Паспорт аккаунта, которым работает ключ. Вызывать ПЕРВЫМ в новой сессии:
    // иначе можно молча работать в чужом проекте (реальный случай — мозг проекта
    // ходил ключом другого аккаунта, где Threads вообще не подключён).
    const r = await apiPost("/api/bot/query", { action: "whoami" });
    if (!r.ok) fail(`whoami HTTP ${r.status}`, JSON.stringify(r.j));
    const d = r.j?.data || {};
    // API отдаёт неизвестное действие как ok:true + data.error — не молчим об этом.
    if (d.error) fail(`whoami недоступен: ${d.error}. Приложение обновлено? Пока проверяй проект по listBankAssets/subscribersCount`);
    const a = d.account || {}, p = d.project || {}, c = d.counts || {};
    console.log(`ПРОЕКТ: ${p.name || a.name || "(без имени)"}  [ключ: ${PROJECT || "по умолчанию"}]`);
    console.log(`аккаунт: ${a.email} | роль: ${a.role}${a.plan ? " | тариф: " + a.plan : ""}`);
    console.log(`Threads: ${d.threads ? "@" + (d.threads.username || "?") : "НЕ ПОДКЛЮЧЁН — про посты/аналитику Threads не отвечай"}`);
    if (d.threads) console.log(`  токен продлён: ${d.threads.lastRefreshedAt ? new Date(d.threads.lastRefreshedAt).toLocaleDateString("ru-RU") : "никогда"}`);
    console.log(`база: ${p.audience === "global" ? "ОБЩАЯ (главный бот)" : "своя (свой бот)"} | людей: ${c.audience ?? "?"}`);
    if (p.sharedContent) console.log(`⚠️ контент ОБЩИЙ с другими проектами на общей базе — правки видны всем`);
    console.log(`постов: ${c.posts} (опубликовано ${c.published}) | воронок: ${c.funnels} | рассылок: ${c.broadcasts} | банк: ${c.bank}`);
    process.exit(0);
  }
  else if (cmd === "find") {
    const q = pos[0] || f.query; if (!q) fail("укажи ник/email");
    const r = await apiPost("/api/bot/query", { action: "findUser", args: { query: q } });
    if (!r.ok) fail(`query HTTP ${r.status}`, JSON.stringify(r.j));
    const users = r.j?.data?.users || [];
    if (!users.length) { console.log(`не найдено: ${q}`); process.exit(0); }
    for (const u of users) console.log(`• ${u.name || "?"} | ${u.email || ""} | @${u.username || "-"} | тариф: ${u.plan}${u.expiresAt ? " до " + new Date(u.expiresAt).toLocaleDateString("ru-RU") : ""}`);
    process.exit(0);
  }
  else if (cmd === "query") {
    const action = pos[0]; if (!action) fail("укажи action");
    let args = {}; if (f.args) { try { args = JSON.parse(f.args); } catch { fail("--args не валидный JSON"); } }
    const r = await apiPost("/api/bot/query", { action, args });
    console.log(JSON.stringify(r.j, null, 2)); process.exit(r.ok ? 0 : 1);
  }
  else if (cmd === "get") {
    const id = pos[0]; if (!id) fail("укажи broadcastId");
    const r = await apiPost("/api/bot/query", { action: "getBroadcast", args: { broadcastId: id } });
    const b = r.j?.data?.broadcast || r.j?.broadcast;
    if (!b) fail("рассылка не найдена", JSON.stringify(r.j));
    console.log(`НАЗВАНИЕ: ${b.name}\nСТАТУС: ${b.status}\nСЕГМЕНТ: ${b.segment}${b.button ? `\nКНОПКА: ${b.button.text} → ${b.button.url}` : ""}\nМЕДИА: ${b.mediaUrls?.length || 0} шт\n--- ТЕКСТ ---\n${b.text}`);
    process.exit(0);
  }
  else if (cmd === "bank") {
    const p = resolveImg(f, "file") || f.file || pos[0]; if (!p) fail("нужен --file <путь> или --lastimage");
    const url = await uploadFile(p);
    const task = await createTask("Банк", { action: "save_to_bank", summary: "Сохранить в банк", params: { imageUrl: url, category: f.category, tags: f.tags, note: f.note } });
    const { ref, summary } = okRef(task);
    console.log(`OK: ${summary} | bankAssetId=${ref}`); process.exit(0);
  }
  else if (cmd === "draft") {
    if (!f.textfile && !f.text) fail("нужен --textfile (файл с текстом рассылки)");
    const text = f.textfile ? readFileSync(f.textfile, "utf-8") : f.text;
    const params = { title: f.title || `Рассылка ${new Date().toLocaleDateString("ru")}`, text, segment: f.segment || "all" };
    if (f["button-text"] && f["button-url"]) params.button = { text: f["button-text"], url: f["button-url"] };
    const img = resolveImg(f);
    if (img) { params.mediaUrls = [await uploadFile(img)]; params.mediaType = "photo"; }
    if (f["bank-asset"]) params.bankAssetId = f["bank-asset"];
    if (f["banner-prompt"]) params.bannerPrompt = f["banner-prompt"];
    if (f["image-url"]) params.imageUrl = f["image-url"];
    if (f.schedule) { assertFuture(f.schedule); params.scheduledAt = f.schedule; }
    const task = await createTask(f.title || "Рассылка", { action: "draft_broadcast", summary: "Черновик рассылки", params });
    const { ref, summary } = okRef(task);
    const im = (params.mediaUrls || params.bankAssetId || params.imageUrl || params.bannerPrompt) ? " (картинка прикреплена)" : "";
    console.log(`OK: ${summary}${im} | ref=${ref}`); process.exit(0);
  }
  else if (cmd === "edit") {
    const id = pos[0]; if (!id) fail("укажи broadcastId");
    const params = { broadcastId: id };
    if (f.textfile) params.text = readFileSync(f.textfile, "utf-8");
    else if (f.text) params.text = f.text;
    if (f.title) params.title = f.title;
    if (f.segment) params.segment = f.segment;
    if (f["button-text"] && f["button-url"]) params.button = { text: f["button-text"], url: f["button-url"] };
    const img = resolveImg(f);
    if (img) { params.mediaUrls = [await uploadFile(img)]; params.mediaType = "photo"; }
    else if (f["bank-asset"]) params.bankAssetId = f["bank-asset"];
    else if (f["image-url"]) params.imageUrl = f["image-url"];
    if (f.schedule) { assertFuture(f.schedule); params.scheduledAt = f.schedule; }
    if (Object.keys(params).length <= 1) fail("нечего менять: дай хотя бы одно из --textfile/--title/--button-*/--imagefile/--lastimage/--segment/--schedule");
    const task = await createTask("Правка рассылки", { action: "update_broadcast", summary: "Правка рассылки", params });
    const { ref, summary } = okRef(task);
    console.log(`OK: ${summary} | ref=${ref}`); process.exit(0);
  }
  else if (cmd === "send") {
    const id = pos[0]; if (!id) fail("укажи broadcastId");
    const task = await createTask("Отправка рассылки", { action: "send_broadcast", summary: "Отправка", params: { broadcastId: id } }, { sending: true });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary}${ref ? ` | ref=${ref}` : ""}`); process.exit(0);
  }
  else if (cmd === "schedule") {
    const id = pos[0], iso = pos[1]; if (!id || !iso) fail("укажи <broadcastId> <ISO>"); assertFuture(iso);
    const task = await createTask("Планирование рассылки", { action: "schedule_broadcast", summary: "Планирование", params: { broadcastId: id, scheduledAt: iso } });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary}${ref ? ` | ref=${ref}` : ""}`); process.exit(0);
  }
  else if (cmd === "grant") {
    const user = pos[0], plan = pos[1] || "pro", days = Number(pos[2] || 7);
    if (!user) fail("укажи ник/email");
    const task = await createTask("Выдать доступ", { action: "grant_access", summary: "Выдача тарифа", params: { username: user, plan, days } }, { sending: true });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary}${ref ? ` | ref=${ref}` : ""}`); process.exit(0);
  }
  // ——— ПОСТЫ ———
  else if (cmd === "post") {
    if (!f.textfile && !f.text) fail("нужен --textfile (файл с текстом поста) — русский текст руками в JSON не собирать");
    const content = f.textfile ? readFileSync(f.textfile, "utf-8") : f.text;
    const platform = assertPlatform(f.platform);
    const params = { content, platform, ...(await mediaParams(f)) };
    if (f.schedule) { assertFuture(f.schedule); params.scheduledAt = f.schedule; }
    else if (f.status) params.status = f.status;
    const action = f.schedule ? "schedule_post" : "create_post";
    const task = await createTask(f.schedule ? "Планирование поста" : "Черновик поста", { action, summary: action, params });
    const { ref, summary } = okRef(task);
    console.log(`OK: ${summary} | платформа: ${platform} | postId=${ref}`); process.exit(0);
  }
  else if (cmd === "posts") {
    const args = { limit: Number(f.limit || 20) };
    if (f.status) args.status = f.status;
    const r = await apiPost("/api/bot/query", { action: "listPosts", args });
    const posts = r.j?.data?.posts || [];
    if (!posts.length) { console.log(`постов нет${f.status ? ` (статус ${f.status})` : ""}`); process.exit(0); }
    for (const p of posts) {
      const when = p.scheduledAt ? ` → ${new Date(p.scheduledAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК` : p.publishedAt ? ` (опубликован ${new Date(p.publishedAt).toLocaleDateString("ru-RU")})` : "";
      console.log(`• [${p.status}${p.platform ? "/" + p.platform : "/БЕЗ ПЛАТФОРМЫ"}]${when} ${p.id}\n  ${(p.preview || "").replace(/\s+/g, " ").slice(0, 110)}`);
    }
    process.exit(0);
  }
  else if (cmd === "getpost") {
    const id = pos[0]; if (!id) fail("укажи postId");
    const r = await apiPost("/api/bot/query", { action: "getPost", args: { postId: id } });
    const p = r.j?.data;
    if (!p || p.error) fail("пост не найден", JSON.stringify(r.j));
    console.log(`СТАТУС: ${p.status} | ПЛАТФОРМА: ${p.platform || "НЕ ЗАДАНА (уйдёт в telegram!)"}${p.scheduledAt ? `\nЗАПЛАНИРОВАН: ${new Date(p.scheduledAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК` : ""}${p.url ? `\nURL: ${p.url}` : ""}\n--- ТЕКСТ ---\n${p.content}`);
    process.exit(0);
  }
  else if (cmd === "postplan") {
    const id = pos[0], iso = pos[1]; if (!id || !iso) fail("укажи <postId> <ISO+03:00>"); assertFuture(iso);
    const task = await createTask("Планирование поста", { action: "schedule_post", summary: "schedule_post", params: { postId: id, scheduledAt: iso } });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary} | postId=${ref}`); process.exit(0);
  }
  else if (cmd === "postedit") {
    const id = pos[0]; if (!id) fail("укажи postId");
    const params = { postId: id };
    if (f.textfile) params.content = readFileSync(f.textfile, "utf-8");
    else if (f.text) params.content = f.text;
    if (f.platform) params.platform = assertPlatform(f.platform);
    if (f.status) params.status = f.status;
    if (f.schedule) { assertFuture(f.schedule); params.scheduledAt = f.schedule; }
    if (Object.keys(params).length <= 1) fail("нечего менять: дай --textfile / --platform / --status / --schedule");
    const task = await createTask("Правка поста", { action: "update_post", summary: "update_post", params });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary} | postId=${ref}`); process.exit(0);
  }
  else if (cmd === "postrewrite") {
    const id = pos[0]; if (!id) fail("укажи postId");
    const instruction = pos[1] || f.instruction;
    const task = await createTask("Переписать пост", { action: "rewrite_post", summary: "rewrite_post", params: { postId: id, ...(instruction ? { instruction } : {}) } });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary} | postId=${ref}\nПрочитай результат: sp.mjs getpost ${id}`); process.exit(0);
  }
  else if (cmd === "postdel") {
    const id = pos[0]; if (!id) fail("укажи postId");
    const task = await createTask("Удалить пост", { action: "delete_post", summary: "delete_post", params: { postId: id } });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary} | postId=${ref}`); process.exit(0);
  }
  else if (cmd === "postpublish") {
    const id = pos[0]; if (!id) fail("укажи postId");
    // ⚠️ publish_post на сервере всегда шлёт в ТЕЛЕГРАМ-КАНАЛ, платформу поста он не смотрит.
    // Поэтому Threads-пост «сейчас» публиковать нельзя — это публикация не туда.
    const chk = await apiPost("/api/bot/query", { action: "getPost", args: { postId: id } });
    const pl = chk.j?.data?.platform;
    if (pl === "threads") fail(`это Threads-пост: немедленная публикация из бота уходит в TELEGRAM-канал, не в Threads. Запланируй ближайшим слотом — sp.mjs postplan ${id} "<ISO+03:00 через 5-10 мин>", публикатор заберёт его в течение 5 минут`);
    const task = await createTask("Публикация поста", { action: "publish_post", summary: "publish_post", params: { postId: id } }, { sending: true });
    const { ref, summary } = okRef(task); console.log(`OK: ${summary}${ref ? ` | ref=${ref}` : ""}`); process.exit(0);
  }
  else if (cmd === "contentplan") {
    const topic = f.topic || pos[0]; if (!topic) fail("нужна --topic \"тема\"");
    const days = Number(f.days || 7);
    const task = await createTask("Контент-план", { action: "generate_content_plan", summary: "generate_content_plan", params: { topic, days } });
    const { ref, summary } = okRef(task);
    console.log(`OK: ${summary} | planId=${ref}\nЭто ПЛАН (темы), постов он не создаёт. Читать: sp.mjs query listPlans | Пост по пункту: sp.mjs post --textfile ... --platform ...`);
    process.exit(0);
  }
  else fail(`неизвестная команда: ${cmd || "(пусто)"}. Рассылки: whoami | projects | find | query | get | bank | draft | edit | send | schedule | grant. Посты: post | posts | getpost | postplan | postedit | postrewrite | postdel | postpublish | contentplan.  (+ --project <slug> к любой)`);
} catch (e) {
  fail(e?.message || String(e));
}

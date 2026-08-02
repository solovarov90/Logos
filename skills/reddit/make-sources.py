#!/usr/bin/env python3
"""Собирает Источники.md из строк «Где:» в Столпах проекта.

Столпы остаются описанием ниши, а Источники.md — рабочим списком каналов, который
автопрогон читает и в который бот дописывает новые после подтверждения Петра.
"""
import io
import os
import re
from datetime import date

VAULT = "/root/.openclaw/MarketingVault/Проекты"
TODAY = date.today().isoformat()

HEADER = """# Источники — {title}

Рабочий список каналов, откуда берём сырьё. **Автопрогон читает этот файл.**
Столпы отвечают на вопрос «о чём пишем», этот файл — «где ищем».

Новые источники добавляются только после явного «да» Петра. Протокол — в `PROJECTS.md`,
раздел «🧭 Поиск новых источников». Каждый кандидат перед добавлением проверяется на
живость, мёртвый в таблицу не попадает.

Статусы: `активен` — используем; `на паузе` — временно не берём; `мёртвый` — не отвечает
или заброшен, оставляем строку с датой, чтобы не предлагать повторно.

| Тип | Адрес | Столп | Статус | Добавлен | Заметка |
|---|---|---|---|---|---|
"""

TITLES = {
    "stories": "Истории (a.vot.istoriya)",
    "razryv": "Расставания и исповеди",
    "trezvost": "АА — дневник трезвости",
}


def kind_of(item: str) -> str:
    if item.startswith("r/"):
        return "reddit"
    if item.startswith("@") or "t.me" in item:
        return "telegram"
    if "форум" in item.lower():
        return "форумы"
    if item.startswith("http"):
        return "сайт"
    return "прочее"


def rows_from_pillars(slug: str) -> list[str]:
    path = f"{VAULT}/{slug}/Столпы/00_Столпы.md"
    if not os.path.exists(path):
        return []
    pillar = ""
    rows = []
    for line in io.open(path, encoding="utf-8"):
        head = re.match(r"^##\s+\d+\.\s*(.+?)\s*$", line)
        if head:
            pillar = head.group(1)
            continue
        where = re.match(r"^\*\*Где:\*\*\s*(.+?)\s*$", line)
        if not where or not pillar:
            continue
        for raw in where.group(1).rstrip(".").split(","):
            item = raw.strip().strip("`")
            if not item:
                continue
            note = ""
            # «комментарии под нашими же постами — золотая жила (навык ...)»
            if "—" in item:
                item, note = (p.strip() for p in item.split("—", 1))
            rows.append(
                f"| {kind_of(item)} | {item} | {pillar} | активен | из Столпов | {note} |"
            )
    return rows


for slug, title in TITLES.items():
    rows = rows_from_pillars(slug)
    path = f"{VAULT}/{slug}/Источники.md"
    if os.path.exists(path):
        print(f"{slug}: файл уже есть, пропускаю")
        continue
    head = HEADER.format(title=title)
    if not rows:
        # Заглушку ставим ДО таблицы: новые строки дописываются в конец файла,
        # и любой текст после таблицы окажется у неё в середине.
        head = head.replace(
            "| Тип | Адрес |",
            "_Список пуст: источники ещё не подобраны. Попроси в топике проекта "
            "«найди новые источники» — бот подберёт и проверит кандидатов._\n\n"
            "| Тип | Адрес |",
        )
    body = head + "\n".join(rows) + "\n"
    io.open(path, "w", encoding="utf-8").write(body)
    print(f"{slug}: создан, строк {len(rows)}")

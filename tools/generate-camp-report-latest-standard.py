#!/usr/bin/env python3
"""Generate summer camp report standard data from an Apple Numbers file."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Iterable

from numbers_parser import Document


STAGE_TO_MAJOR = {
    "L2营": "L2",
}


def read_sheet_rows(document: Document, sheet_name: str) -> list[list[str]]:
    sheet = next((item for item in document.sheets if item.name == sheet_name), None)
    if sheet is None:
        raise ValueError(f"Sheet not found: {sheet_name}")
    if not sheet.tables:
        raise ValueError(f"Sheet has no tables: {sheet_name}")

    rows: list[list[str]] = []
    for row in sheet.tables[0].rows():
        values: list[str] = []
        for cell in row:
            value = cell.value if cell is not None else None
            values.append("" if value is None else str(value).strip())
        rows.append(values)
    return rows


def normalize_date(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError("Missing date value")
    match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if match:
        year, month, day = match.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day):02d}"
    parsed = datetime.fromisoformat(text)
    return parsed.strftime("%Y-%m-%d")


def normalize_minor_camp(value: object) -> str:
    match = re.search(r"\d+", str(value or ""))
    if not match:
        raise ValueError(f"Unsupported camp value: {value!r}")
    return f"Camp {int(match.group(0))}"


def expand_minor_camps(value: object) -> list[str]:
    text = str(value or "").replace("，", ",")
    numbers = [int(match) for match in re.findall(r"\d+", text)]
    if not numbers:
        raise ValueError(f"Unsupported minor camp group: {value!r}")
    return [f"Camp {number}" for number in numbers]


def clean_goal(value: object) -> str:
    text = str(value or "").strip()
    if not text or text in {"0", "0.0", "None"}:
        return ""
    return text


def read_topic_content(rows: list[list[str]]) -> dict[str, dict[str, object]]:
    content: dict[str, dict[str, object]] = {}
    for row in rows[2:]:
        if not row or not row[0]:
            continue
        topic = row[0]
        content[topic] = {
            "teachingGoals": [goal for goal in [clean_goal(row[1]), clean_goal(row[2])] if goal],
            "moralGoals": [goal for goal in [clean_goal(row[3])] if goal],
            "afterClass": clean_goal(row[5]) if len(row) > 5 else "",
        }
    return content


def read_daily_goal_entries(rows: list[list[str]], topic_content: dict[str, dict[str, object]]) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    seen: set[tuple[str, str]] = set()
    for row in rows[2:]:
        if len(row) < 5 or not row[0] or not row[2]:
            continue
        major_camp = row[3]
        if major_camp != "Sparkchat":
            continue
        date = normalize_date(row[0])
        topic = row[2]
        after_class = str(topic_content.get(topic, {}).get("afterClass") or "")
        teaching_goals = [goal for goal in [clean_goal(row[5]), clean_goal(row[6])] if goal]
        moral_goals = [goal for goal in [clean_goal(row[7]), clean_goal(row[8]) if len(row) > 8 else ""] if goal]
        for minor_camp in expand_minor_camps(row[4]):
            key = (date, minor_camp)
            if key in seen:
                raise ValueError(f"Duplicate daily goal entry: {key}")
            seen.add(key)
            entries.append({
                "date": date,
                "majorLevel": "L2",
                "minorCamp": minor_camp,
                "dayLabel": row[1],
                "topic": topic,
                "teachingGoals": teaching_goals,
                "moralGoals": moral_goals,
                "afterClass": after_class,
            })
    entries.sort(key=lambda item: (str(item["date"]), int(re.search(r"\d+", str(item["minorCamp"])).group(0))))
    return entries


def read_activity_entries(rows: list[list[str]]) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    seen: set[tuple[str, str, str]] = set()
    for row in rows[1:]:
        if len(row) < 8 or not row[0]:
            continue
        stage = row[1]
        if stage not in STAGE_TO_MAJOR:
            raise ValueError(f"Unsupported stage: {stage!r}")
        date = normalize_date(row[0])
        minor_camp = normalize_minor_camp(row[2])
        key = (date, STAGE_TO_MAJOR[stage], minor_camp)
        if key in seen:
            raise ValueError(f"Duplicate activity entry: {key}")
        seen.add(key)
        entries.append({
            "date": date,
            "majorLevel": STAGE_TO_MAJOR[stage],
            "minorCamp": minor_camp,
            "periodLabel": row[3],
            "time": row[4],
            "activityName": row[5],
            "activityType": row[6],
            "noticeText": row[7].strip(),
        })
    entries.sort(key=lambda item: (item["date"], int(re.search(r"\d+", item["minorCamp"]).group(0))))
    return entries


def ts_string(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def write_object(lines: list[str], item: dict[str, object], keys: Iterable[str], indent: str = "  ") -> None:
    lines.append(f"{indent}{{")
    for key in keys:
        lines.append(f"{indent}  {key}: {ts_string(item[key])},")
    lines.append(f"{indent}}},")


def write_ts(
    output_path: Path,
    topic_content: dict[str, dict[str, object]],
    daily_goal_entries: list[dict[str, object]],
    activity_entries: list[dict[str, str]],
) -> None:
    lines: list[str] = []
    lines.append("// Generated by tools/generate-camp-report-latest-standard.py from 苦日报概览.numbers.")
    lines.append("")
    lines.append("export interface SparkchatTopicContent {")
    lines.append("  teachingGoals: string[];")
    lines.append("  moralGoals: string[];")
    lines.append("  afterClass: string;")
    lines.append("}")
    lines.append("")
    lines.append("export interface SparkchatDailyGoalEntry extends SparkchatTopicContent {")
    lines.append("  date: string;")
    lines.append("  majorLevel: 'L2';")
    lines.append("  minorCamp: string;")
    lines.append("  dayLabel: string;")
    lines.append("  topic: string;")
    lines.append("}")
    lines.append("")
    lines.append("export interface SparkchatActivityNoticeEntry {")
    lines.append("  date: string;")
    lines.append("  majorLevel: 'L2';")
    lines.append("  minorCamp: string;")
    lines.append("  periodLabel: string;")
    lines.append("  time: string;")
    lines.append("  activityName: string;")
    lines.append("  activityType: string;")
    lines.append("  noticeText: string;")
    lines.append("}")
    lines.append("")
    lines.append("export const SPARKCHAT_TOPIC_CONTENT: Record<string, SparkchatTopicContent> = {")
    for topic in sorted(topic_content, key=lambda value: (not value.startswith("Topic"), value)):
        lines.append(f"  {ts_string(topic)}: {{")
        lines.append(f"    teachingGoals: {ts_string(topic_content[topic]['teachingGoals'])},")
        lines.append(f"    moralGoals: {ts_string(topic_content[topic]['moralGoals'])},")
        lines.append(f"    afterClass: {ts_string(topic_content[topic]['afterClass'])},")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    lines.append("export const SPARKCHAT_DAILY_GOAL_ENTRIES = [")
    for entry in daily_goal_entries:
        write_object(lines, entry, [
            "date",
            "majorLevel",
            "minorCamp",
            "dayLabel",
            "topic",
            "teachingGoals",
            "moralGoals",
            "afterClass",
        ])
    lines.append("] satisfies readonly SparkchatDailyGoalEntry[];")
    lines.append("")
    lines.append("export const SPARKCHAT_ACTIVITY_NOTICE_ENTRIES = [")
    for entry in activity_entries:
        write_object(lines, entry, [
            "date",
            "majorLevel",
            "minorCamp",
            "periodLabel",
            "time",
            "activityName",
            "activityType",
            "noticeText",
        ])
    lines.append("] as const satisfies readonly SparkchatActivityNoticeEntry[];")
    lines.append("")
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("numbers_file", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("frontend/src/data/campLatestStandard.ts"),
    )
    args = parser.parse_args()

    document = Document(args.numbers_file)
    topic_content = read_topic_content(read_sheet_rows(document, "话题&目标"))
    daily_goal_entries = read_daily_goal_entries(read_sheet_rows(document, "每日目标汇总"), topic_content)
    activity_entries = read_activity_entries(read_sheet_rows(document, "活动课"))
    write_ts(args.output, topic_content, daily_goal_entries, activity_entries)
    print(
        f"Wrote {len(topic_content)} topics, "
        f"{len(daily_goal_entries)} daily goal entries, "
        f"and {len(activity_entries)} activity entries to {args.output}"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Minimal helper for the lite-team skill. Python standard library only."""

from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

MAX_HISTORY = 9
MAX_SUMMARY_CHARS = 120
MAX_MESSAGES = 7
MAX_MESSAGE_SUMMARY_CHARS = 500

CORE_FIELDS = ("from", "to", "type", "summary")
OPTIONAL_FIELDS = ("files", "verify", "need", "risk", "decision", "detail", "reply_to")



def bbs_path(root: Path) -> Path:
    return root / "docs" / "bbs" / "lite-team-bbs.md"


def template_path() -> Path:
    return Path(__file__).resolve().parent.parent / "assets" / "bbs.template.md"


def load_template() -> bytes:
    path = template_path()
    if not path.exists():
        raise FileNotFoundError(f"未找到 BBS 模板：{path}")
    return path.read_bytes()


def read_text(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"未找到 BBS：{path}")
    return path.read_text(encoding="utf-8")


def get_block(text: str, tag: str) -> str:
    match = re.search(rf"<{tag}>\n?(.*?)\n?</{tag}>", text, flags=re.S)
    if not match:
        raise ValueError(f"BBS 格式错误：缺少 <{tag}>...</{tag}> 区域")
    return match.group(1)


def replace_block(text: str, tag: str, body: str) -> str:
    replacement = f"<{tag}>\n{body.rstrip()}\n</{tag}>" if body.strip() else f"<{tag}>\n</{tag}>"
    result, count = re.subn(
        rf"<{tag}>\n?(.*?)\n?</{tag}>",
        replacement,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise ValueError(f"BBS 格式错误：无法替换 <{tag}> 区域")
    return result


def active_count(message_block: str) -> int:
    return len(re.findall(r"(?m)^-\s+id:\s+\S+", message_block))


def history_entries(history_block: str) -> list[str]:
    cleaned = history_block.strip()
    if not cleaned:
        return []
    starts = list(re.finditer(r"(?m)^-\s+date:\s+", cleaned))
    if not starts:
        raise ValueError("<history> 中的条目必须以 '- date:' 开始")
    entries: list[str] = []
    for index, start in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(cleaned)
        entries.append(cleaned[start.start():end].strip())
    return entries


def normalise_summary(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def next_message_id(message_block: str, record_date: str) -> str:
    prefix = f"m-{record_date.replace('-', '')}"
    used = [int(n) for n in re.findall(rf"(?m)^-\s+id:\s+{re.escape(prefix)}-(\d+)", message_block)]
    return f"{prefix}-{max(used, default=0) + 1:02d}"


def render_message(fields: dict[str, str]) -> str:
    lines = []
    for key in ("id",) + CORE_FIELDS + OPTIONAL_FIELDS:
        value = fields.get(key)
        if value is None or value == "":
            continue
        prefix = "- " if not lines else "  "
        # reply_to 字段在 BBS 中写作 reply_to，与文档一致
        lines.append(f"{prefix}{key}: {value}")
    return "\n".join(lines)


def cmd_add(args: argparse.Namespace) -> int:
    summary = normalise_summary(args.summary)
    if not summary:
        print("summary 不能为空。", file=sys.stderr)
        return 2
    if len(summary) > MAX_MESSAGE_SUMMARY_CHARS:
        print(
            f"summary 超过 {MAX_MESSAGE_SUMMARY_CHARS} 字符（当前 {len(summary)}）；"
            "请先与用户确认是否拆分，或把详细内容转入 docs/bbs/<topic>.md 再用 detail 引用。",
            file=sys.stderr,
        )
        return 2

    path = bbs_path(Path(args.root).resolve())
    text = read_text(path)
    message = get_block(text, "message")
    if active_count(message) >= MAX_MESSAGES:
        print(
            f"<message> 已有 {MAX_MESSAGES} 条；请先处理已完成项或合并重复项，再写入新消息。",
            file=sys.stderr,
        )
        return 3

    record_date = args.date or date.today().isoformat()
    fields = {
        "id": next_message_id(message, record_date),
        "from": args.from_,
        "to": args.to,
        "type": args.type,
        "summary": summary,
    }
    for key in OPTIONAL_FIELDS:
        value = getattr(args, key, None)
        if value:
            fields[key] = value.strip() if key == "reply_to" else value

    entry = render_message(fields)
    body = f"{message.strip()}\n{entry}" if message.strip() else entry
    path.write_text(replace_block(text, "message", body), encoding="utf-8")
    print(f"已写入 BBS：{fields['id']}（{args.from_} → {args.to}，{args.type}）。")
    return 0


def cmd_init(args: argparse.Namespace) -> int:
    path = bbs_path(Path(args.root).resolve())
    if path.exists() and not args.force:
        print(f"BBS 已存在：{path}")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(load_template())
    print(f"已初始化：{path}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    path = bbs_path(Path(args.root).resolve())
    text = read_text(path)
    message = get_block(text, "message")
    history = get_block(text, "history")
    print(f"BBS：{path}")
    print(f"当前消息：{active_count(message)}")
    print(f"历史摘要：{len(history_entries(history))}")
    return 0


def cmd_clear(args: argparse.Namespace) -> int:
    if not args.yes:
        print("为避免误清空，请添加 --yes。", file=sys.stderr)
        return 2
    path = bbs_path(Path(args.root).resolve())
    text = read_text(path)
    path.write_text(replace_block(text, "message", ""), encoding="utf-8")
    print("已清空 <message>；<history> 未改动。")
    return 0


def cmd_archive(args: argparse.Namespace) -> int:
    summary = normalise_summary(args.summary)
    if not summary:
        print("summary 不能为空。", file=sys.stderr)
        return 2
    if len(summary) > MAX_SUMMARY_CHARS:
        print(f"summary 超过 {MAX_SUMMARY_CHARS} 字符：当前 {len(summary)}。", file=sys.stderr)
        return 2

    path = bbs_path(Path(args.root).resolve())
    text = read_text(path)
    message = get_block(text, "message")
    if message.strip():
        print("<message> 仍有未处理事项；请先处理或显式 clear，再归档。", file=sys.stderr)
        return 3

    history = get_block(text, "history")
    entries = history_entries(history)
    record_date = args.date or date.today().isoformat()
    entries.append(f"- date: {record_date}\n  summary: {summary}")
    entries = entries[-MAX_HISTORY:]

    updated = replace_block(text, "history", "\n".join(entries))
    updated = replace_block(updated, "message", "")
    path.write_text(updated, encoding="utf-8")
    print(f"已归档；history 保留 {len(entries)} 条，message 已清空。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="轻量 BBS 协作板助手")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_root(p: argparse.ArgumentParser) -> None:
        p.add_argument("--root", default=".", help="项目根目录，默认当前目录")

    p_init = sub.add_parser("init", help="初始化 docs/bbs/lite-team-bbs.md")
    add_root(p_init)
    p_init.add_argument("--force", action="store_true", help="覆盖已有 BBS")
    p_init.set_defaults(func=cmd_init)

    p_status = sub.add_parser("status", help="显示当前消息和历史数量")
    add_root(p_status)
    p_status.set_defaults(func=cmd_status)

    p_add = sub.add_parser("add", help="写入一条交接消息（自动生成 id）")
    add_root(p_add)
    p_add.add_argument("--from", dest="from_", required=True, help="发出方角色")
    p_add.add_argument("--to", required=True, help="接收方角色、all 或 user")
    p_add.add_argument("--type", required=True, help="handoff/question/risk/bug/decision/verify 等")
    p_add.add_argument("--summary", required=True, help=f"必填，建议不超过 {MAX_MESSAGE_SUMMARY_CHARS} 字符")
    p_add.add_argument("--files", help="相关路径，如 'src/auth/*, tests/auth/*'")
    p_add.add_argument("--verify", help="验证命令")
    p_add.add_argument("--need", help="需要对方做什么")
    p_add.add_argument("--risk", help="风险说明")
    p_add.add_argument("--decision", help="决策说明")
    p_add.add_argument("--detail", help="详细依据，通常指向 docs/bbs/<topic>.md")
    p_add.add_argument("--reply-to", dest="reply_to", help="回复的原消息 id")
    p_add.add_argument("--date", help="YYYY-MM-DD，默认本机日期")
    p_add.set_defaults(func=cmd_add)

    p_clear = sub.add_parser("clear", help="清空 <message>，保留 <history>")
    add_root(p_clear)
    p_clear.add_argument("--yes", action="store_true", help="确认清空")
    p_clear.set_defaults(func=cmd_clear)

    p_archive = sub.add_parser("archive", help="写入一条历史摘要")
    add_root(p_archive)
    p_archive.add_argument("--summary", required=True, help=f"不超过 {MAX_SUMMARY_CHARS} 字符")
    p_archive.add_argument("--date", help="YYYY-MM-DD，默认本机日期")
    p_archive.set_defaults(func=cmd_archive)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except (FileNotFoundError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Classify and archive SVG files that are not referenced by any Markdown file."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


MARKDOWN_PATTERNS = (
    re.compile(r"!\[[^\]]*]\(([^)]+\.svg(?:#[^)]+)?)\)"),
    re.compile(r"\[[^\]]*]\(([^)]+\.svg(?:#[^)]+)?)\)"),
    re.compile(r"<img[^>]+src=[\"']([^\"']+\.svg)[\"']", re.IGNORECASE),
    re.compile(r"(?<![A-Za-z0-9_/.-])([A-Za-z0-9_./-]+\.svg)(?![A-Za-z0-9_./-])"),
)


@dataclass(frozen=True)
class ScanResult:
    all_svg: set[Path]
    referenced_svg: set[Path]
    unreferenced_svg: set[Path]


def find_repo_root(start: Path) -> Path:
    current = start.resolve()
    while current != current.parent:
        if (current / ".git").exists():
            return current
        current = current.parent
    raise RuntimeError("Could not find repository root (.git).")


def collect_files(repo_root: Path) -> tuple[list[Path], list[Path]]:
    md_files = []
    svg_files = []
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(repo_root)
        if "node_modules" in rel.parts or ".git" in rel.parts:
            continue
        if rel.parts[:3] == ("Docs", "Archive", "unreferenced_svg"):
            continue
        if path.suffix.lower() == ".md":
            md_files.append(path)
        elif path.suffix.lower() == ".svg":
            svg_files.append(path)
    return md_files, svg_files


def extract_svg_refs(markdown: str) -> set[str]:
    refs = set()
    for pattern in MARKDOWN_PATTERNS:
        for match in pattern.finditer(markdown):
            ref = match.group(1).split("#", 1)[0].split("?", 1)[0].strip()
            if ref:
                refs.add(ref.replace("\\", "/"))
    return refs


def resolve_ref(md_file: Path, ref: str, repo_root: Path) -> Path | None:
    if ref.startswith(("http://", "https://")):
        return None

    # Absolute path: keep only if it points into current repo.
    if ref.startswith("/"):
        abs_path = Path(ref).resolve()
        try:
            abs_path.relative_to(repo_root)
        except ValueError:
            return None
        return abs_path if abs_path.exists() else None

    rel_candidate = (md_file.parent / ref).resolve()
    if rel_candidate.exists() and rel_candidate.suffix.lower() == ".svg":
        return rel_candidate

    root_candidate = (repo_root / ref).resolve()
    if root_candidate.exists() and root_candidate.suffix.lower() == ".svg":
        return root_candidate

    return None


def scan(repo_root: Path) -> ScanResult:
    md_files, svg_files = collect_files(repo_root)
    all_svg = {p.resolve() for p in svg_files}
    referenced = set()

    for md in md_files:
        text = md.read_text(encoding="utf-8", errors="ignore")
        refs = extract_svg_refs(text)
        for ref in refs:
            resolved = resolve_ref(md, ref, repo_root)
            if resolved:
                referenced.add(resolved.resolve())

    unreferenced = all_svg - referenced
    return ScanResult(all_svg=all_svg, referenced_svg=referenced, unreferenced_svg=unreferenced)


def classify(rel_path: Path) -> str:
    if rel_path.parts[:3] == ("Docs", "TestDocs", "charts"):
        if len(rel_path.parts) > 3 and rel_path.parts[3] == "ja":
            return "testdocs_charts_ja"
        if len(rel_path.parts) > 3 and rel_path.parts[3] == "agent_observability":
            return "testdocs_charts_agent_observability"
        return "testdocs_charts"
    if rel_path.parts[:3] == ("Docs", "assets", "slides_charts"):
        if len(rel_path.parts) > 3 and rel_path.parts[3] == "ja":
            return "assets_slides_charts_ja"
        return "assets_slides_charts"
    if rel_path.parts[:3] == ("Docs", "assets", "svgs"):
        return "assets_svgs_legacy"
    if rel_path.parts and rel_path.parts[0] == "public":
        return "runtime_public_svg"
    return "other"


def is_archive_candidate(category: str) -> bool:
    return category in {
        "testdocs_charts",
        "testdocs_charts_ja",
        "testdocs_charts_agent_observability",
        "assets_slides_charts",
        "assets_slides_charts_ja",
        "assets_svgs_legacy",
    }


def archive_unreferenced(repo_root: Path, apply_move: bool) -> dict:
    result = scan(repo_root)
    archive_root = repo_root / "Docs" / "Archive" / "unreferenced_svg"
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    manifest_dir = archive_root / ts
    manifest_dir.mkdir(parents=True, exist_ok=True)

    groups = defaultdict(list)
    skipped = []
    archived = []

    for abs_path in sorted(result.unreferenced_svg):
        rel = abs_path.relative_to(repo_root)
        category = classify(rel)
        if is_archive_candidate(category):
            groups[category].append(str(rel))
            target = manifest_dir / "files" / rel
            archived.append((abs_path, target))
        else:
            skipped.append({"path": str(rel), "category": category, "reason": "non-doc runtime or unknown"})

    if apply_move:
        for src, dst in archived:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))

    summary = {
        "timestamp": ts,
        "apply": apply_move,
        "totals": {
            "svg_total": len(result.all_svg),
            "referenced_in_md": len(result.referenced_svg),
            "unreferenced_in_md": len(result.unreferenced_svg),
            "archived": len(archived),
            "skipped": len(skipped),
        },
        "groups": groups,
        "skipped": skipped,
        "archive_root": str(manifest_dir.relative_to(repo_root)),
    }

    manifest_json = manifest_dir / "archive_manifest.json"
    manifest_json.write_text(
        json.dumps(
            {
                **summary,
                "groups": {k: v for k, v in sorted(groups.items())},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    report_md = manifest_dir / "archive_report.md"
    lines = [
        "# SVG 未引用文件归档报告",
        "",
        f"- 扫描时间: `{ts}`",
        f"- 执行模式: `{'apply' if apply_move else 'dry-run'}`",
        f"- SVG 总数: **{summary['totals']['svg_total']}**",
        f"- 被 Markdown 引用: **{summary['totals']['referenced_in_md']}**",
        f"- Markdown 未引用: **{summary['totals']['unreferenced_in_md']}**",
        f"- 已归档: **{summary['totals']['archived']}**",
        f"- 跳过: **{summary['totals']['skipped']}**",
        "",
        "## 归档分类",
    ]

    for category in sorted(groups.keys()):
        files = groups[category]
        lines.append(f"- **{category}**: {len(files)}")

    lines.append("")
    lines.append("## 归档文件明细")
    for category in sorted(groups.keys()):
        lines.append(f"### {category}")
        for file_path in groups[category]:
            lines.append(f"- `{file_path}`")
        lines.append("")

    if skipped:
        lines.append("## 跳过文件")
        for item in skipped:
            lines.append(f"- `{item['path']}` ({item['category']}): {item['reason']}")

    report_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Archive SVG files not referenced by any Markdown docs.")
    parser.add_argument("--apply", action="store_true", help="Actually move files into archive.")
    args = parser.parse_args()

    repo_root = find_repo_root(Path(__file__).parent)
    summary = archive_unreferenced(repo_root, apply_move=args.apply)
    print(json.dumps({**summary, "groups": {k: len(v) for k, v in summary["groups"].items()}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

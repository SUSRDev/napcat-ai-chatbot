#!/usr/bin/env python3
"""
NapCat 聊天机器人插件 — 一键发布 CLI

用法: python scripts/release.py

API Key 优先级: 环境变量 XIAVIEWER_API_KEY > scripts/.release-local.json
切勿将含 Key 的本地配置提交到 Git。
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import textwrap
from datetime import date
from pathlib import Path
from typing import Any
from urllib import error, request

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
DASHBOARD_HTML = ROOT / "webui" / "dashboard.html"
CHANGELOG = ROOT / "CHANGELOG.md"
LOCAL_CONFIG = Path(__file__).resolve().parent / ".release-local.json"

DEFAULT_API_BASE = "https://api.xiavier.com/v1"
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def clear() -> None:
    if sys.platform == "win32":
        subprocess.run("cls", shell=True, check=False)
    else:
        print("\033[2J\033[H", end="")


def pause(msg: str = "按 Enter 继续…") -> None:
    try:
        input(msg)
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(0)


def run(cmd: list[str], *, cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    print(f"\n▶ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=str(cwd or ROOT), text=True, check=check, capture_output=True)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_local_config() -> dict[str, str]:
    cfg: dict[str, str] = {
        "api_base": DEFAULT_API_BASE,
        "model": DEFAULT_MODEL,
        "api_key": "",
    }
    if LOCAL_CONFIG.exists():
        try:
            raw = json.loads(LOCAL_CONFIG.read_text(encoding="utf-8"))
            for k in cfg:
                if raw.get(k):
                    cfg[k] = str(raw[k])
        except json.JSONDecodeError:
            pass
    env_key = __import__("os").environ.get("XIAVIEWER_API_KEY", "").strip()
    if env_key:
        cfg["api_key"] = env_key
    return cfg


def save_local_config(cfg: dict[str, str]) -> None:
    to_save = {k: cfg[k] for k in ("api_base", "model", "api_key") if cfg.get(k)}
    LOCAL_CONFIG.write_text(json.dumps(to_save, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已保存配置到 {LOCAL_CONFIG}")


def get_current_version() -> str:
    return str(read_json(PACKAGE_JSON).get("version", "0.0.0"))


def git_output(*args: str) -> str:
    r = run(["git", *args], check=False)
    return (r.stdout or r.stderr or "").strip()


def git_diff_stat() -> str:
    r = run(["git", "diff", "--stat"], check=False)
    r2 = run(["git", "diff", "--cached", "--stat"], check=False)
    out = (r.stdout or "") + (r2.stdout or "")
    return out.strip() or "（无未提交改动）"


def git_status_short() -> str:
    return git_output("status", "-sb")


def compare_versions(a: str, b: str) -> int:
    pa = [int(x) for x in a.split(".")]
    pb = [int(x) for x in b.split(".")]
    for i in range(3):
        if pa[i] != pb[i]:
            return 1 if pa[i] > pb[i] else -1
    return 0


def prompt_version(current: str) -> str:
    while True:
        v = input(f"新版本号 (当前 {current}): ").strip()
        if not v:
            print("已取消")
            return ""
        if not SEMVER_RE.match(v):
            print("格式须为 x.y.z，例如 2.4.5")
            continue
        if compare_versions(v, current) <= 0:
            print(f"新版本须大于当前版本 {current}")
            continue
        return v


def update_package_version(version: str) -> None:
    data = read_json(PACKAGE_JSON)
    data["version"] = version
    write_json(PACKAGE_JSON, data)


def update_sidebar_version(version: str) -> None:
    text = DASHBOARD_HTML.read_text(encoding="utf-8")
    new_text, n = re.subn(
        r'(<span id="sidebar-version">NapCat 插件 · v)[\d.]+(</span>)',
        rf"\g<1>{version}\2",
        text,
        count=1,
    )
    if n:
        DASHBOARD_HTML.write_text(new_text, encoding="utf-8")
    else:
        print("警告: 未找到 sidebar-version，请手动更新 dashboard.html")


def build_changelog_header(version: str) -> str:
    today = date.today().isoformat()
    return f"## [{version}] — {today}\n\n"


def insert_changelog_entry(version: str, body: str) -> None:
    header = build_changelog_header(version)
    content = CHANGELOG.read_text(encoding="utf-8")
    marker = "# 更新日志\n\n"
    entry = header + body.rstrip() + "\n\n---\n\n"
    if marker in content:
        content = content.replace(marker, marker + entry, 1)
    else:
        content = marker + entry + content
    CHANGELOG.write_text(content, encoding="utf-8")


def ai_summarize_changelog(cfg: dict[str, str], version: str, diff_text: str) -> str:
    api_key = cfg.get("api_key", "").strip()
    if not api_key:
        raise RuntimeError("未配置 API Key，请在菜单中设置或导出 XIAVIEWER_API_KEY")

    api_base = cfg.get("api_base", DEFAULT_API_BASE).rstrip("/")
    model = cfg.get("model", DEFAULT_MODEL)
    url = f"{api_base}/chat/completions"

    system = (
        "你是开源项目发布助手。根据 git diff 摘要，用简体中文撰写 CHANGELOG 条目正文。"
        "只输出 Markdown 正文，不要版本标题行。使用 ### 新增、### 改进、### 修复 分组（无内容的分组可省略）。"
        "每条以 - **简短标题**：说明 格式，聚焦用户可感知的变化，2-6 条为宜。"
    )
    user = f"即将发布版本 {version}。以下是代码改动摘要：\n\n```\n{diff_text[:12000]}\n```"

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.3,
        "max_tokens": 1500,
    }).encode("utf-8")

    req = request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"API 请求失败 HTTP {e.code}: {detail}") from e
    except error.URLError as e:
        raise RuntimeError(f"网络错误: {e.reason}") from e

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("API 返回为空")
    content = (choices[0].get("message") or {}).get("content", "").strip()
    if not content:
        raise RuntimeError("AI 未返回内容")
    return content


def edit_multiline(initial: str) -> str:
    print("\n--- 编辑更新说明（多行，单独一行输入 END 结束）---")
    if initial:
        print(initial)
        print("---")
        use = input("直接回车采用以上内容，或输入 e 进入编辑: ").strip().lower()
        if use != "e":
            return initial
    print("请输入 CHANGELOG 正文（不含 ## 版本标题），END 结束:")
    lines: list[str] = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == "END":
            break
        lines.append(line)
    return "\n".join(lines).strip()


def choose_changelog_body(cfg: dict[str, str], version: str, diff_text: str) -> str:
    print("\n更新说明来源:")
    print("  1) AI 总结 (Xiavier)")
    print("  2) 手动编写")
    print("  3) AI 总结后可编辑")
    choice = input("选择 [1/2/3] (默认 3): ").strip() or "3"

    body = ""
    if choice in ("1", "3"):
        print("\n正在调用 AI 生成更新说明…")
        try:
            body = ai_summarize_changelog(cfg, version, diff_text)
            print("\n--- AI 生成 ---\n")
            print(body)
            print("---")
        except Exception as e:
            print(f"AI 失败: {e}")
            if choice == "1":
                body = edit_multiline("")
            else:
                cont = input("改用手动编写? [Y/n]: ").strip().lower()
                body = edit_multiline("") if cont != "n" else ""
    if choice == "2" or (choice == "3" and not body):
        body = edit_multiline(body)
    elif choice == "3" and body:
        body = edit_multiline(body)

    if not body:
        body = "### 改进\n\n- **常规更新**：详见代码改动。\n"
    return body


def confirm(msg: str) -> bool:
    return input(f"{msg} [y/N]: ").strip().lower() in ("y", "yes")


def do_publish(version: str, changelog_body: str, cfg: dict[str, str]) -> None:
    tag = f"v{version}"
    zip_name = f"napcat-plugin-chat-bot-v{version}.zip"

    print("\n更新版本文件…")
    update_package_version(version)
    update_sidebar_version(version)
    insert_changelog_entry(version, changelog_body)

    print("\n当前状态:")
    print(git_status_short())

    if not confirm(f"确认提交并发布 {tag}?"):
        print("已取消（文件已修改，请自行 git checkout 还原）")
        return

    run(["git", "add", "package.json", "webui/dashboard.html", "CHANGELOG.md", "index.mjs", "webui/", "scripts/"])
    commit_msg = f"Release {tag}: {changelog_body.split(chr(10))[0].replace('#', '').strip()[:72]}"
    r = run(["git", "commit", "-m", commit_msg], check=False)
    if r.returncode != 0:
        print(r.stdout or r.stderr)
        if not confirm("提交失败，是否继续打 tag / 发布?"):
            return

    run(["git", "tag", tag], check=False)
    run(["git", "archive", "--format=zip", "--prefix=napcat-plugin-chat-bot/", "-o", zip_name, "HEAD"])

    print("\n推送到远程…")
    run(["git", "push", "origin", "HEAD"])
    run(["git", "push", "origin", tag])

    notes = changelog_body.strip()
    release_title = tag
    gh = run([
        "gh", "release", "create", tag, zip_name,
        "--title", release_title,
        "--notes", notes,
    ], check=False)
    if gh.returncode != 0:
        print(gh.stderr or gh.stdout)
        print(f"\n请手动: gh release create {tag} {zip_name} --title {tag}")
    else:
        print(f"\n✅ 发布完成: https://github.com/SUSRDev/napcat-ai-chatbot/releases/tag/{tag}")


def menu_configure(cfg: dict[str, str]) -> dict[str, str]:
    print("\n--- API 配置 ---")
    print(f"当前 API Base: {cfg.get('api_base')}")
    print(f"当前 Model:    {cfg.get('model')}")
    masked = (cfg.get("api_key") or "")[:8] + "…" if cfg.get("api_key") else "（未设置）"
    print(f"当前 API Key:  {masked}")
    api_base = input(f"API Base [{cfg.get('api_base')}]: ").strip() or cfg["api_base"]
    model = input(f"Model [{cfg.get('model')}]: ").strip() or cfg["model"]
    key_in = input("API Key (留空保持不变): ").strip()
    cfg["api_base"] = api_base.rstrip("/")
    cfg["model"] = model
    if key_in:
        cfg["api_key"] = key_in
    save_local_config(cfg)
    return cfg


def menu_publish(cfg: dict[str, str]) -> None:
    current = get_current_version()
    print(f"\n当前版本: v{current}")
    print(git_status_short())
    print("\n未提交改动:")
    print(git_diff_stat())

    version = prompt_version(current)
    if not version:
        return

    diff_text = git_output("diff") + "\n" + git_output("diff", "--cached")
    if len(diff_text) < 20:
        diff_text = git_output("log", "-5", "--oneline")

    body = choose_changelog_body(cfg, version, diff_text)

    print("\n--- 预览 CHANGELOG ---")
    print(build_changelog_header(version) + body)
    print("---")

    if confirm("写入文件并继续发布?"):
        do_publish(version, body, cfg)


def main() -> None:
    cfg = load_local_config()
    while True:
        clear()
        current = get_current_version()
        print("=" * 48)
        print("  NapCat 聊天机器人 — 一键发布")
        print("=" * 48)
        print(f"  当前版本: v{current}")
        print(f"  仓库:     {ROOT}")
        print(f"  Git:      {git_status_short() or '干净'}")
        print("-" * 48)
        print("  1) 发布新版本")
        print("  2) 查看当前版本与改动")
        print("  3) 配置 AI API (Xiavier)")
        print("  4) 仅更新版本号与 CHANGELOG（不推送）")
        print("  0) 退出")
        print("-" * 48)
        choice = input("请选择: ").strip()

        if choice == "0":
            break
        elif choice == "1":
            menu_publish(cfg)
            pause()
        elif choice == "2":
            print(f"\npackage.json 版本: {get_current_version()}")
            print("\n" + git_status_short())
            print("\n" + git_diff_stat())
            pause()
        elif choice == "3":
            cfg = menu_configure(cfg)
            pause()
        elif choice == "4":
            current = get_current_version()
            version = prompt_version(current)
            if version:
                diff_text = git_output("diff") + "\n" + git_output("diff", "--cached")
                body = choose_changelog_body(cfg, version, diff_text)
                update_package_version(version)
                update_sidebar_version(version)
                insert_changelog_entry(version, body)
                print("已更新本地文件，未提交。")
            pause()
        else:
            print("无效选项")
            pause()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n已退出")

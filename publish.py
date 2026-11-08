#!/usr/bin/env python3
"""导出 -> 加密 -> 发布到 GitHub Pages 的 gh-pages 分支。

  python3 publish.py --local          # 只导出并加密到 site/data.enc.json，不推送（本地预览用）
  python3 publish.py                  # 导出 + 加密 + 推送（每次都是一个孤儿提交、强推，公开历史里只有最新一份）
  python3 publish.py --set-password   # 设置/更换页面密码（存进 macOS 钥匙串，不落盘）

数据流：~/Documents/health/whoop/export_status.py 写明文 status.json（只在 whoop/data/ 里，不进这个仓库）
        -> 这里用 AES-256-GCM 加密（密钥 = PBKDF2-SHA256(密码, salt, 600k 轮)）-> site/data.enc.json（只有密文）
浏览器端用 WebCrypto 做同样的推导和解密，密码永远不会离开看的人的设备。

需要 `cryptography`（anaconda 自带）。密码在钥匙串里：service = daily-status-page。
"""
from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "site"
STATE = ROOT / "state"          # gitignored：salt 等本地状态
SALT_FILE = STATE / "salt.b64"
ENC = SITE / "data.enc.json"
WHOOP = Path.home() / "Documents" / "health" / "whoop"
EXPORT = WHOOP / "export_status.py"
STATUS = WHOOP / "data" / "status.json"
KEYCHAIN_SERVICE = "daily-status-page"
ITERATIONS = 600_000
BRANCH = "gh-pages"


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def password() -> str:
    pw = os.environ.get("STATUS_PAGE_PASSWORD")  # 只给本地测试用
    if pw:
        return pw
    r = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", os.environ.get("USER", ""), "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("钥匙串里没有页面密码，先跑：python3 publish.py --set-password")
    return r.stdout.rstrip("\n")


def set_password() -> None:
    pw = getpass.getpass("新的页面密码（建议 4 个以上随机词组成的短语）: ")
    if len(pw) < 10:
        sys.exit("太短了：密文是公开的，短密码能被离线暴力破解。至少 10 个字符，最好更长。")
    if getpass.getpass("再输一次: ") != pw:
        sys.exit("两次不一致。")
    subprocess.run(["/usr/bin/security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
                    "-a", os.environ.get("USER", ""), "-w", pw], check=True)
    STATE.mkdir(exist_ok=True)
    SALT_FILE.write_text(b64(os.urandom(16)))  # 换密码顺便换 salt，旧设备上记住的密钥自动失效
    print("已存进钥匙串。下次发布后，看的人需要输入新密码。")


def salt() -> bytes:
    if not SALT_FILE.exists():
        STATE.mkdir(exist_ok=True)
        SALT_FILE.write_text(b64(os.urandom(16)))
    return base64.b64decode(SALT_FILE.read_text())


def encrypt(plaintext: bytes, pw: str) -> dict:
    s = salt()
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=s, iterations=ITERATIONS).derive(pw.encode())
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, plaintext, None)
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS, "salt": b64(s), "iv": b64(iv), "ct": b64(ct)}


def git(*args: str, env: dict | None = None) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True, text=True,
                          env={**os.environ, **(env or {})}).stdout.strip()


def deploy() -> None:
    """把 site/ 当前内容做成一个没有父提交的提交，强推到 gh-pages。公开历史里永远只有这一份。"""
    with tempfile.TemporaryDirectory() as tmp:
        env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        git("--work-tree", str(SITE), "add", "-A", "--", ".", ":(exclude,glob)**/.DS_Store", env=env)
        tree = git("write-tree", env=env)
        commit = git("commit-tree", tree, "-m", "update", env=env)
    git("push", "--force", "--quiet", "origin", f"{commit}:refs/heads/{BRANCH}")
    print(f"已推送 -> {BRANCH} ({commit[:7]})")


def main() -> int:
    ap = argparse.ArgumentParser(description="导出 -> 加密 -> 推送")
    ap.add_argument("--local", action="store_true", help="只生成 site/data.enc.json，不推送")
    ap.add_argument("--set-password", action="store_true")
    args = ap.parse_args()
    if args.set_password:
        set_password()
        return 0
    subprocess.run([sys.executable, str(EXPORT), "--out", str(STATUS)], check=True)
    blob = encrypt(STATUS.read_bytes(), password())
    tmp = ENC.with_suffix(".tmp")
    tmp.write_text(json.dumps(blob))
    tmp.replace(ENC)
    print(f"已加密 -> {ENC.relative_to(ROOT)}")
    if not args.local:
        deploy()
    return 0


if __name__ == "__main__":
    sys.exit(main())

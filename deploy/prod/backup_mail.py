#!/usr/bin/env python3
"""Email the newest encrypted DB backup (off-site copy), via the Resend API.

Runs on the server (stdlib only). The dump is encrypted with AES-256 using the
key file /opt/nhg-manabi-v2/backup.key BEFORE it leaves the machine; the key is
never emailed. The recipient comes from BACKUP_MAIL_TO in /opt/nhg-manabi-v2/.env
(set by the operator, never hard-coded here). Over MAX_BYTES the attachment is
skipped and an alert mail is sent instead, so a silent failure never looks like
a backup.

Decrypt:  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in X.dump.enc \
          -out X.dump -pass file:backup.key     then   pg_restore -d <db> X.dump
"""
import base64
import glob
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime

ROOT = "/opt/nhg-manabi-v2"
KEY = f"{ROOT}/backup.key"
MAX_BYTES = 25 * 1024 * 1024  # base64 of this stays under Resend's 40 MB cap


def env() -> dict:
    out = {}
    for line in open(f"{ROOT}/.env", encoding="utf-8"):
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.rstrip("\n").split("=", 1)
            out[k] = v
    return out


def send(cfg: dict, subject: str, text: str, attachment: tuple | None) -> str:
    body = {"from": cfg["MAIL_FROM"], "to": [cfg["BACKUP_MAIL_TO"]],
            "subject": subject, "text": text}
    if attachment:
        body["attachments"] = [{"filename": attachment[0],
                                "content": base64.b64encode(attachment[1]).decode()}]
    req = urllib.request.Request(
        "https://api.resend.com/emails", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {cfg['RESEND_API_KEY']}",
                 "Content-Type": "application/json",
                 "User-Agent": "backup-script/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read()).get("id", "?")


def main() -> int:
    cfg = env()
    if not cfg.get("BACKUP_MAIL_TO"):
        print("BACKUP_MAIL_TO is not set in .env; nothing sent", file=sys.stderr)
        return 3
    dumps = sorted(glob.glob(f"{ROOT}/backups/db/nhg_manabi_v2-*.dump"))
    if not dumps:
        send(cfg, "[nhg-manabi-v2] 备份邮件失败：没有找到备份文件",
             "服务器上没有可发送的备份。", None)
        return 1
    dump = dumps[-1]
    name = os.path.basename(dump)
    with tempfile.TemporaryDirectory() as tmp:
        enc = f"{tmp}/{name}.enc"
        subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
                        "-in", dump, "-out", enc, "-pass", f"file:{KEY}"], check=True)
        data = open(enc, "rb").read()
    day = datetime.now().strftime("%Y-%m-%d")
    how = (f"解密：openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in {name}.enc "
           f"-out {name} -pass file:backup.key，然后 pg_restore。密钥文件 backup.key 不在邮件里。")
    if len(data) > MAX_BYTES:
        mid = send(cfg, f"[nhg-manabi-v2] 备份太大，未附带 {day}",
                   f"{name} 加密后 {len(data)} 字节，超过 {MAX_BYTES}，本次没有附带。"
                   "请改用其他异地方式。", None)
        print("too large, alert sent", mid)
        return 2
    mid = send(cfg, f"[nhg-manabi-v2] 数据库备份 {day}",
               f"附件为加密后的数据库备份（{name}，{len(data)} 字节）。\n{how}\n",
               (name + ".enc", data))
    print("sent", name, len(data), "bytes, resend id", mid)
    return 0


if __name__ == "__main__":
    sys.exit(main())

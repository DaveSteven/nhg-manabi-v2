"""Administrator management CLI (ADR-0009). Passwords are read with getpass,
never from arguments, environment or files, and are never printed.

    python -m app.admin_cli create-admin <username> --role reviewer [--display-name "Name"]
    python -m app.admin_cli reset-password <username>
    python -m app.admin_cli deactivate <username>
    python -m app.admin_cli activate <username>
"""
import argparse
import getpass
import json
import sys

from app.admin_auth import (AdminError, create_admin, reset_password,
                            set_active, ROLES)
from app.db.engine import get_engine


def _ask_password() -> str:
    first = getpass.getpass("Password: ")
    second = getpass.getpass("Repeat password: ")
    if first != second:
        raise AdminError("passwords do not match")
    return first


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="JLPT GO administrator management")
    sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("create-admin")
    c.add_argument("username")
    c.add_argument("--role", choices=ROLES, required=True)
    c.add_argument("--display-name", default=None)
    for name in ("reset-password", "deactivate", "activate"):
        sub.add_parser(name).add_argument("username")
    args = p.parse_args(argv)
    engine = get_engine()
    try:
        if args.command == "create-admin":
            out = create_admin(engine, args.username, _ask_password(), args.role,
                               display_name=args.display_name)
        elif args.command == "reset-password":
            reset_password(engine, args.username, _ask_password())
            out = {"username": args.username, "password_reset": True,
                   "sessions_revoked": True}
        else:
            set_active(engine, args.username, args.command == "activate")
            out = {"username": args.username,
                   "is_active": args.command == "activate"}
    except AdminError as e:
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stderr)
        return 1
    print(json.dumps({"ok": True, **out}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

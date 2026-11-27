"""Dear Editor disk workspace (Python standard library, loopback only)."""
import argparse
from contextlib import contextmanager, nullcontext
import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import uuid
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from desktop_widget import DesktopWidget

ROOT = Path(__file__).resolve().parent
COOKIE = "de_local_session"
MAX_BODY = 24 * 1024 * 1024
STATIC = {
    "app.js", "app.css", "accounts.js", "languages.js", "local-mode.js", "local-memory.js",
    "vendor/opencc-cn2t.js", "progress.js", "citations.js",
}
PUBLIC_FEEDBACK_FIELDS = ("email", "phone", "wechat", "welcome", "wechatQr", "alipayQr")


def public_feedback_script(path=ROOT / "demo.js"):
    """Reuse only the project contact already shipped in the public demo."""
    try:
        source = path.read_text(encoding="utf-8-sig").split("const demo=", 1)[1]
        demo = json.JSONDecoder().raw_decode(source.lstrip())[0]
        feedback = demo["settings"]["feedback"]
        fields = {k: feedback[k] for k in PUBLIC_FEEDBACK_FIELDS if isinstance(feedback.get(k), str)}
    except (OSError, ValueError, IndexError, KeyError, TypeError, AttributeError):
        fields = {}
    return ("window.dearEditorProjectFeedback=" + json.dumps(fields, ensure_ascii=True) + ";\n").encode("ascii")


class Problem(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def password_digest(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 210000).hex()


def credentials(body, register=False):
    username, password = body.get("username"), body.get("password")
    if (not isinstance(username, str) or not 1 <= len(username.strip()) <= 100
            or not isinstance(password, str) or not (6 if register else 1) <= len(password) <= 1024):
        raise Problem(400, "请输入有效的用户名和密码（注册密码至少 6 位）。")
    return username.strip(), password


class LocalServer(ThreadingHTTPServer):
    def __init__(self, port, db_path):
        self.desktop = DesktopWidget(self.widget_dismissed)
        super().__init__(("127.0.0.1", port), Handler)
        self.db_path = db_path
        self.public_feedback = public_feedback_script()
        self.origin = f"http://127.0.0.1:{self.server_port}"
        self.tabs = BrowserTabs()
        self.widget_events = WidgetEvents()
        with self.db() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS accounts (
                    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                    revision INTEGER NOT NULL, workspace TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    token TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                    expires INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS desktop_preferences (
                    owner TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
                    enabled INTEGER NOT NULL CHECK(enabled IN (0, 1))
                );
            """)
            db.execute("DELETE FROM sessions WHERE expires <= ?", (int(time.time()),))

    def server_close(self):
        self.desktop.shutdown()
        if hasattr(self, "widget_events"):
            self.widget_events.close()
        super().server_close()

    @staticmethod
    def widget_enabled(db, row):
        value = db.execute("SELECT enabled FROM desktop_preferences WHERE owner=?", (row["id"],)).fetchone()
        if value is not None:
            return bool(value["enabled"])
        widgets = (json.loads(row["workspace"]).get("settings") or {}).get("widgets")
        return not isinstance(widgets, dict) or widgets.get("desktop") is not False

    def set_widget_enabled(self, owner, enabled):
        with self.db() as db:
            db.execute("INSERT INTO desktop_preferences(owner,enabled) SELECT id,? FROM accounts WHERE id=? "
                       "ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled", (int(enabled), owner))
        self.widget_events.publish(owner)

    def widget_dismissed(self, owner):
        self.set_widget_enabled(owner, False)

    def db(self):
        from contextlib import closing, contextmanager

        @contextmanager
        def transaction():
            with closing(sqlite3.connect(self.db_path, timeout=5)) as conn, conn:
                conn.row_factory = sqlite3.Row
                conn.execute("PRAGMA foreign_keys=ON")
                yield conn

        return transaction()


class BrowserTabs:
    startup_grace = 90
    lease = 180
    close_grace = 2

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.tabs = {}
        self.deadline = clock() + self.startup_grace
        self.pending_writes = 0

    def update(self, body):
        tab, sequence, active = body.get("tab"), body.get("sequence"), body.get("active")
        if (not isinstance(tab, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,64}", tab)
                or type(sequence) is not int or not 0 < sequence <= 2**53-1 or type(active) is not bool):
            raise Problem(400, "标签页请求格式不正确。")
        with self.lock:
            now = self.clock()
            self.prune(now)
            previous = self.tabs.get(tab)
            if previous and sequence <= previous[0]:
                return
            if not previous and len(self.tabs) >= 4096:
                raise Problem(429, "本地标签页过多。")
            self.tabs[tab] = (sequence, now + self.lease, active)
            if active:
                self.deadline = now + self.lease
            elif not previous or previous[2]:
                self.deadline = max((t[1] for t in self.tabs.values() if t[2]), default=now + self.close_grace)

    @contextmanager
    def writing(self):
        with self.lock:
            self.pending_writes += 1
        try:
            yield
        finally:
            with self.lock:
                self.pending_writes -= 1

    def prune(self, now):
        self.tabs = {key: value for key, value in self.tabs.items() if value[1] > now}

    def expired(self):
        with self.lock:
            now = self.clock()
            self.prune(now)
            return now >= self.deadline and not self.pending_writes and not any(t[2] for t in self.tabs.values())

class WidgetEvents:
    """Wake the account's browser tabs when its desktop preference changes."""
    def __init__(self):
        self.condition = threading.Condition()
        self.events = {}
        self.closed = False

    def publish(self, owner):
        with self.condition:
            self.events[owner] = self.events.get(owner, 0) + 1
            self.condition.notify_all()

    def wait(self, owner, cursor, timeout=20):
        with self.condition:
            if cursor is not None and cursor == self.events.get(owner, 0):
                self.condition.wait_for(lambda: self.closed or self.events.get(owner, 0) != cursor, timeout)
            return self.events.get(owner, 0)

    def close(self):
        with self.condition:
            self.closed = True
            self.condition.notify_all()


class Handler(BaseHTTPRequestHandler):
    def log_request(self, code="-", size="-"):
        if self.path not in ("/api/tab", "/api/tab-close", "/api/desktop-events"):
            super().log_request(code, size)

    def reply(self, status, body, content_type="application/json; charset=utf-8", cookie=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        try:
            self.end_headers()
            self.wfile.write(body)
        except ConnectionError:
            # A local tab can close while its widget event request is pending.
            pass

    def token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie[COOKIE].value if COOKIE in cookie else ""

    def account(self, db):
        row = db.execute(
            "SELECT a.* FROM accounts a JOIN sessions s ON a.id=s.owner "
            "WHERE s.token=? AND s.expires>?", (self.token(), int(time.time()))
        ).fetchone()
        if row is None:
            raise Problem(401, "请重新登录本地工作空间。")
        return row

    def result(self, row, db):
        return {"id": row["id"], "revision": row["revision"], "workspace": json.loads(row["workspace"]),
                "desktopAvailable": os.name == "nt", "desktopEnabled": self.server.widget_enabled(db, row)}

    def checked(self, post=False):
        if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            raise Problem(403, "请通过本机启动地址访问。")
        if post and (self.headers.get("Origin") != self.server.origin
                     or (self.path != "/api/tab-close" and self.headers.get("X-Dear-Editor-Local") != "1")
                     or self.headers.get_content_type() != "application/json"):
            raise Problem(403, "只接受本地页面发起的请求。")

    def do_GET(self):
        try:
            self.checked()
            path = self.path.split("?", 1)[0]
            if path == "/api/session":
                with self.server.db() as db:
                    self.reply(200, self.result(self.account(db), db))
            elif path in ("/", "/index.html"):
                html = (ROOT / "index.html").read_text(encoding="utf-8")
                html = html.replace('<script src="demo.js"></script>', '<script src="project-feedback.js"></script>')
                html = html.replace('<script src="accounts.js"></script>',
                                    '<script src="local-memory.js"></script><script src="accounts.js"></script>')
                html = html.replace('<script src="app.js"></script>',
                                    '<script src="app.js"></script><script src="local-mode.js"></script>')
                self.reply(200, html.encode(), "text/html; charset=utf-8")
            elif path == "/project-feedback.js":
                self.reply(200, self.server.public_feedback, "application/javascript; charset=utf-8")
            elif path[1:] in STATIC:
                file = ROOT / path[1:]
                self.reply(200, file.read_bytes(), mimetypes.guess_type(file)[0] or "application/octet-stream")
            else:
                raise Problem(404, "找不到页面。")
        except Problem as exc:
            self.reply(exc.status, {"error": exc.message})
        except sqlite3.Error:
            self.reply(500, {"error": "无法读取本地数据库。请检查磁盘与访问权限。"})

    def do_POST(self):
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= MAX_BODY:
                raise Problem(413, "提交的数据为空或超出 24 MB。")
            try:
                self.checked(post=True)
            except Problem:
                # Drain small rejected requests so Windows does not reset the
                # connection before the client receives the error response.
                if size <= 4096:
                    self.rfile.read(size)
                raise
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise Problem(400, "请求格式不正确。")
            mutating = self.path in ("/api/save", "/api/register", "/api/login", "/api/logout", "/api/delete", "/api/desktop-widget")
            with self.server.tabs.writing() if mutating else nullcontext():
                response, cookie = self.action(body)
                if self.path == "/api/save":
                    self.server.desktop.refresh(body["id"], response["revision"], body["workspace"]["settings"].get("widgets"))
            self.reply(200, response, cookie=cookie)
        except Problem as exc:
            self.reply(exc.status, {"error": exc.message})
        except (ValueError, TypeError):
            self.reply(400, {"error": "请求格式不正确。"})
        except ConnectionError:
            pass
        except sqlite3.Error:
            self.reply(500, {"error": "无法写入本地数据库。请检查磁盘空间和权限后重试。"})

    def action(self, body):
        route = self.path
        cookie = None
        if route in ("/api/tab", "/api/tab-close"):
            if route == "/api/tab-close" and body.get("active") is not False:
                raise Problem(400, "此接口仅用于关闭标签页。")
            self.server.tabs.update(body)
            return {}, None
        if route == "/api/desktop-events":
            cursor = body.get("cursor")
            if cursor is not None and (type(cursor) is not int or cursor < 0):
                raise Problem(400, "浮窗事件请求格式不正确。")
            with self.server.db() as db:
                row = self.account(db)
                if body.get("id") != row["id"]:
                    raise Problem(409, "此页面的账号已变化，请刷新后重试。")
                owner = row["id"]
            cursor = self.server.widget_events.wait(owner, cursor)
            with self.server.db() as db:
                row = self.account(db)
                if owner != row["id"]:
                    raise Problem(409, "此页面的账号已变化，请刷新后重试。")
                return {"cursor": cursor, "enabled": self.server.widget_enabled(db, row)}, None
        with self.server.db() as db:
            if route == "/api/desktop-widget":
                row = self.account(db)
                if body.get("id") != row["id"]:
                    raise Problem(409, "此页面的账号已变化，请刷新后重试。")
                enabled = body.get("enabled")
                if enabled is not None and type(enabled) is not bool:
                    raise Problem(400, "浮窗请求格式不正确。")
                automatic = body.get("automatic", False)
                if type(automatic) is not bool:
                    raise Problem(400, "浮窗请求格式不正确。")
                theme = body.get("theme")
                if theme is not None and theme not in ("light", "dark"):
                    raise Problem(400, "浮窗配色无效。")
                if os.name != "nt":
                    return {"available": False, "visible": False}, None
                wanted = self.server.widget_enabled(db, row)
                if enabled is True:
                    fields = ("title", "rest", "off", "done", "free", "remaining", "next",
                              "countdowns", "todos", "vacation", "empty", "weekend", "today_off", "unset")
                    supplied = body.get("labels")
                    labels = {k: supplied[k][:80] for k in fields
                              if isinstance(supplied, dict) and isinstance(supplied.get(k), str) and supplied[k].strip()}
                    widgets = (json.loads(row["workspace"]).get("settings") or {}).get("widgets")
                    if automatic and not wanted:
                        return {"available": True, "enabled": False, "visible": False}, None
                    if not automatic:
                        self.server.set_widget_enabled(row["id"], True)
                    try:
                        self.server.desktop.open(row["id"], row["revision"], widgets, labels, theme or "light", automatic)
                    except RuntimeError as exc:
                        if not automatic:
                            self.server.set_widget_enabled(row["id"], wanted)
                        raise Problem(409, str(exc)) from exc
                elif enabled is False:
                    self.server.set_widget_enabled(row["id"], False)
                    self.server.desktop.close(row["id"])
                elif theme is not None:
                    self.server.desktop.set_theme(row["id"], theme)
                return {"available": True, "enabled": self.server.widget_enabled(db, row),
                        "visible": self.server.desktop.visible(row["id"])}, None
            if route in ("/api/login", "/api/register"):
                register = route == "/api/register"
                username, password = credentials(body, register)
                if register:
                    owner, salt = uuid.uuid4().hex, secrets.token_hex(16)
                    profile = dict(username=username, name=username, role="student", degree="",
                                   salt=salt, hash=password_digest(password, salt))
                    workspace = dict(records=[], authors=[], profile=profile, settings=None)
                    try:
                        db.execute("INSERT INTO accounts VALUES (?,?,0,?)",
                                   (owner, username.casefold(), json.dumps(workspace, ensure_ascii=False)))
                    except sqlite3.IntegrityError:
                        raise Problem(409, "用户名已存在。") from None
                    row = db.execute("SELECT * FROM accounts WHERE id=?", (owner,)).fetchone()
                else:
                    row = db.execute("SELECT * FROM accounts WHERE username=?", (username.casefold(),)).fetchone()
                    profile = json.loads(row["workspace"])["profile"] if row else None
                    if not profile or not hmac.compare_digest(password_digest(password, profile["salt"]), profile["hash"]):
                        raise Problem(401, "用户名或密码错误。")
                token = secrets.token_urlsafe(32)
                last_owner = db.execute("SELECT owner FROM sessions WHERE token=?", (self.token(),)).fetchone()
                if last_owner and last_owner["owner"] != row["id"]:
                    self.server.desktop.close(last_owner["owner"], signout=True)
                db.execute("DELETE FROM sessions WHERE token=?", (self.token(),))
                db.execute("INSERT INTO sessions VALUES (?,?,?)", (token, row["id"], int(time.time()) + 86400))
                return self.result(row, db), f"{COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict"
            if route == "/api/logout":
                authenticated = db.execute("SELECT owner FROM sessions WHERE token=?", (self.token(),)).fetchone()
                if authenticated and body.get("id") != authenticated["owner"]:
                    raise Problem(409, "此页面的账号已变化，请刷新页面。")
                if authenticated:
                    self.server.desktop.close(authenticated["owner"], signout=True)
                db.execute("DELETE FROM sessions WHERE token=?", (self.token(),))
                return {}, f"{COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"
            if route not in ("/api/save", "/api/delete"):
                raise Problem(404, "找不到接口。")
            db.execute("BEGIN IMMEDIATE")
            row = self.account(db)
            if body.get("id") != row["id"]:
                raise Problem(409, "此页面的账号已变化，请刷新后重新登录。")
            if body.get("revision") != row["revision"]:
                raise Problem(409, "此账号已在另一页面更新。请刷新后重试，本次修改未保存。")
            if route == "/api/delete":
                self.verify_current_password(row, body)
                self.server.desktop.close(row["id"], signout=True)
                db.execute("DELETE FROM accounts WHERE id=?", (row["id"],))
                return {}, f"{COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict"
            workspace = body.get("workspace")
            if (not isinstance(workspace, dict) or not isinstance(workspace.get("profile"), dict)
                    or not isinstance(workspace.get("records"), list) or not isinstance(workspace.get("authors"), list)
                    or not isinstance(workspace.get("settings"), dict)):
                raise Problem(400, "工作空间格式不正确。")
            profile = workspace["profile"]
            username, salt, digest = (profile.get(k) for k in ("username", "salt", "hash"))
            if (not isinstance(username, str) or not 1 <= len(username.strip()) <= 100
                    or not isinstance(salt, str) or not re.fullmatch("[0-9a-f]{32}", salt)
                    or not isinstance(digest, str) or not re.fullmatch("[0-9a-f]{64}", digest)):
                raise Problem(400, "账号字段格式不正确。")
            prev = json.loads(row["workspace"])["profile"]
            changed_credentials = any(prev[k] != profile[k] for k in ("username", "salt", "hash"))
            if changed_credentials:
                self.verify_current_password(row, body)
            try:
                db.execute("UPDATE accounts SET username=?, revision=revision+1, workspace=? WHERE id=?",
                           (username.strip().casefold(), json.dumps(workspace, ensure_ascii=False), row["id"]))
            except sqlite3.IntegrityError:
                raise Problem(409, "此用户名已被其他本地账号使用。") from None
            if changed_credentials:
                db.execute("DELETE FROM sessions WHERE owner=? AND token<>?", (row["id"], self.token()))
            return {"revision": row["revision"] + 1}, cookie

    @staticmethod
    def verify_current_password(row, body):
        password = body.get("currentPassword")
        previous = json.loads(row["workspace"])["profile"]
        if (not isinstance(password, str) or len(password) > 1024
                or not hmac.compare_digest(password_digest(password, previous["salt"]), previous["hash"])):
            raise Problem(403, "当前密码错误。")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    data_dir = Path(os.environ.get("LOCALAPPDATA", Path.home() / ".local" / "share")) / "DearEditor"
    parser.add_argument("--db", type=Path, default=data_dir / "workspace.sqlite3")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--auto-exit", action="store_true", help="stop after all Dear Editor browser tabs close")
    args = parser.parse_args()
    args.db.parent.mkdir(parents=True, exist_ok=True)
    with LocalServer(args.port, args.db.resolve()) as server:
        print(f"Dear Editor: {server.origin}\nDatabase: {args.db.resolve()}\nCtrl+C to stop.", flush=True)
        if not args.no_browser:
            webbrowser.open(server.origin)
        try:
            if args.auto_exit:
                server.timeout = 0.25
                while not server.tabs.expired():
                    server.handle_request()
                print("Dear Editor: no active browser tabs. Closing.", flush=True)
            else:
                server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()

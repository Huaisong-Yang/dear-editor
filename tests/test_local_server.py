import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_server import BrowserTabs, LocalServer, password_digest


class BrowserTabLifecycle(unittest.TestCase):
    def test_refresh_and_multiple_tabs(self):
        now = 0
        tabs = BrowserTabs(lambda: now)

        def tab(name, sequence, active):
            tabs.update(dict(tab=name, sequence=sequence, active=active))

        now = 25
        self.assertFalse(tabs.expired())
        tab("first", 1, True)
        tab("second", 1, True)
        tab("first", 2, False)
        now += tabs.close_grace
        self.assertFalse(tabs.expired())
        tab("second", 2, False)
        tab("second", 1, True)  # late old heartbeat must not reopen a closed tab
        now += tabs.close_grace - 1
        self.assertFalse(tabs.expired())
        tab("refreshed-page", 1, True)
        now += 2
        self.assertFalse(tabs.expired())
        tab("refreshed-page", 2, False)
        now += tabs.close_grace
        self.assertTrue(tabs.expired())

    def test_startup_and_missing_close_notification(self):
        now = 0
        tabs = BrowserTabs(lambda: now)
        now = tabs.startup_grace
        self.assertTrue(tabs.expired())
        tabs.update(dict(tab="page", sequence=1, active=True))
        now += tabs.lease - 1
        self.assertFalse(tabs.expired())
        now += 1
        self.assertTrue(tabs.expired())


class LocalWorkspace(unittest.TestCase):
    def test_persistence_and_account_isolation(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "work.sqlite3"
            server = LocalServer(0, db)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()

            def call(route, data=None, cookie="", origin=None, beacon=False):
                conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
                headers = {"Cookie": cookie}
                if data is not None:
                    headers.update({"Content-Type": "application/json", "Origin": origin or server.origin})
                    if not beacon:
                        headers["X-Dear-Editor-Local"] = "1"
                try:
                    conn.request("POST" if data is not None else "GET", route,
                                 None if data is None else json.dumps(data), headers)
                    response = conn.getresponse()
                    raw = response.read()
                    return response.status, raw, (response.getheader("Set-Cookie") or "").split(";")[0]
                finally:
                    conn.close()

            try:
                status, html, _ = call("/")
                self.assertEqual(status, 200)
                self.assertIn(b"local-mode.js", html)
                self.assertIn(b"progress.js", html)
                self.assertNotIn(b"demo.js", html)
                self.assertEqual(call("/local_server.py")[0], 404)
                tab = dict(tab="page", sequence=1, active=True)
                self.assertEqual(call("/api/tab", tab, origin="https://example.org")[0], 403)
                self.assertEqual(call("/api/tab", dict(tab, sequence=True))[0], 400)
                self.assertEqual(call("/api/tab", tab)[0], 200)
                close = dict(tab, sequence=2, active=False)
                self.assertEqual(call("/api/tab-close", close, origin="https://example.org", beacon=True)[0], 403)
                self.assertEqual(call("/api/tab-close", tab, beacon=True)[0], 400)
                self.assertEqual(call("/api/tab-close", close, beacon=True)[0], 200)
                self.assertEqual(call("/api/register", {}, origin="https://example.org")[0], 403)
                status, raw, first = call("/api/register", {"username": "One", "password": "secret-one"})
                self.assertEqual(status, 200)
                one = json.loads(raw)
                one["workspace"].update(records=[{"title": "test manuscript"}], settings={})
                self.assertEqual(call("/api/save", one, first)[0], 200)
                self.assertEqual(call("/api/save", one, first)[0], 409)
                self.assertEqual(call("/api/session")[0], 401)  # browser cleared its cookies
                self.assertEqual(call("/api/login", {"username": "One", "password": "wrong"})[0], 401)
                status, raw, second = call("/api/register", {"username": "Two", "password": "secret-two"})
                self.assertEqual(json.loads(raw)["workspace"]["records"], [])
                self.assertEqual(call("/api/save", one, second)[0], 409)
                server.shutdown()
                server.server_close()
                server = LocalServer(0, db)
                threading.Thread(target=server.serve_forever, daemon=True).start()
                status, raw, first = call("/api/login", {"username": "One", "password": "secret-one"})
                self.assertEqual(status, 200)
                one = json.loads(raw)
                self.assertEqual(one["workspace"]["records"][0]["title"], "test manuscript")
                one["workspace"]["profile"]["username"] = "Renamed"
                one["workspace"]["profile"]["hash"] = password_digest("new-secret", one["workspace"]["profile"]["salt"])
                self.assertEqual(call("/api/save", one, first)[0], 403)
                self.assertEqual(call("/api/save", dict(one, currentPassword="secret-one"), first)[0], 200)
                status, raw, first = call("/api/login", {"username": "Renamed", "password": "new-secret"})
                self.assertEqual(status, 200)
                one = json.loads(raw)
                self.assertEqual(call("/api/delete", one, first)[0], 403)
                self.assertEqual(call("/api/delete", dict(one, currentPassword="new-secret"), first)[0], 200)
                self.assertEqual(call("/api/session", cookie=first)[0], 401)
                self.assertEqual(call("/api/login", {"username": "Two", "password": "secret-two"})[0], 200)
            finally:
                server.shutdown()
                server.server_close()


if __name__ == "__main__":
    unittest.main()

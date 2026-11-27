import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from datetime import datetime
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from desktop_widget import (DEFAULT_LABELS, PALETTES, DesktopWidget, color_between, dashboard_rows,
                            dock_side, next_work, phase_at, widget_config, widget_palette)
from local_server import BrowserTabs, LocalServer, WidgetEvents, password_digest


class DesktopSchedule(unittest.TestCase):
    def test_progress_breaks_and_empty_schedules(self):
        settings = dict(schedule=[dict(name="Morning", start="08:00", end="10:00"),
                                  dict(name="Afternoon", start="12:00", end="13:00")])
        config = widget_config(settings)
        self.assertEqual(phase_at(datetime(2026, 11, 27, 9), config),
                         ("working", "Morning", "08:00 – 10:00", 0.5, 3600))
        self.assertEqual(phase_at(datetime(2026, 11, 27, 10), config),
                         ("rest", None, None, None, 7200))
        self.assertEqual(phase_at(datetime(2026, 11, 27, 13), config)[0], "done")
        self.assertEqual(phase_at(datetime(2026, 11, 27, 13), widget_config({"schedule": []}))[0], "free")
        self.assertEqual(phase_at(datetime(2026, 11, 28, 9), config)[0], "off")
        config = widget_config(dict(settings, holidays=["2026-11-27"], workdays=["2026-11-28"]))
        self.assertEqual(phase_at(datetime(2026, 11, 27, 9), config)[0], "off")
        self.assertEqual(phase_at(datetime(2026, 11, 28, 9), config)[0], "working")

    def test_docking_and_shutdown(self):
        self.assertEqual(dock_side(-1900, 280, -1920, 0, 22), "left")
        self.assertEqual(dock_side(-290, 280, -1920, 0, 22), "right")
        self.assertIsNone(dock_side(-1000, 280, -1920, 0, 22))
        widget = DesktopWidget()
        widget.shutdown()
        with self.assertRaises(RuntimeError):
            widget.open("owner", 0, {}, {})

    def test_palette_matches_the_phase_start_and_web_theme(self):
        config = widget_config({"schedule": [
            {"name": "Long morning", "start": "10:00", "end": "14:00"},
            {"name": "Evening", "start": "18:00", "end": "20:00"},
        ]})
        for hour, index in ((8, 0), (13, 0), (16, 1), (19, 2)):
            now = datetime(2026, 11, 27, hour)
            phase = phase_at(now, config)
            for theme in ("light", "dark"):
                self.assertEqual(widget_palette(theme, now, phase), PALETTES[theme][index])
        self.assertEqual(color_between("#000000", "#ffffff", .5), "#808080")

    def test_dashboard_and_return_to_work(self):
        now = datetime(2026, 11, 27, 19)
        config = widget_config({"schedule": [{"name": "Morning", "start": "08:00", "end": "10:00"}],
                                "workdays": ["2026-11-28"], "items": [
                                    {"title": "Milestone", "date": "2026-11-28", "time": "09:00"},
                                    {"title": "Second target", "date": "2026-11-28", "time": "10:00:42"},
                                    {"title": "All day", "date": "2026-11-28"},
                                ],
                                "vacation": "2026-11-28T20:52:04",
                                "todos": [{"title": "Review draft", "deadline": "2026-11-28T10:00", "done": False}]})
        self.assertEqual(next_work(now, config), 13 * 3600)
        rows = dashboard_rows(config, DEFAULT_LABELS, now)
        self.assertEqual([row[1] for row in rows if row[0]], [DEFAULT_LABELS["countdowns"], DEFAULT_LABELS["todos"]])
        values = {title: value for header, title, value in rows if not header}
        self.assertEqual(values, {
            DEFAULT_LABELS["weekend"]: "1d 05:00:00", DEFAULT_LABELS["vacation"]: "1d 01:52:04",
            "All day": "05:00:00", "Milestone": "14:00:00", "Second target": "15:00:42",
            "○  Review draft": "11-28 10:00"
        })
        self.assertFalse(dashboard_rows(widget_config({"countdowns": False, "todo": False}), DEFAULT_LABELS, now))


class BrowserTabLifecycle(unittest.TestCase):
    def test_desktop_change_notifications_are_isolated_by_account(self):
        events = WidgetEvents()
        self.assertEqual(events.wait("owner", None), 0)
        events.publish("owner")
        self.assertEqual(events.wait("owner", 0), 1)
        self.assertEqual(events.wait("other", 0, timeout=0), 0)

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
                self.assertEqual(call("/api/desktop-widget", {"id": one["id"]})[0], 401)
                self.assertEqual(call("/api/desktop-widget", {"id": "other"}, first)[0], 409)
                self.assertEqual(call("/api/desktop-widget", {"id": one["id"], "enabled": 1}, first)[0], 400)
                if sys.platform == "win32":
                    with patch.object(server.desktop, "open") as open_widget:
                        self.assertEqual(call("/api/desktop-widget", {"id": one["id"], "enabled": True,
                                                                     "automatic": True}, first)[0], 200)
                        open_widget.assert_called_once_with(one["id"], 0, None, {}, "light", True)
                self.assertEqual(call("/api/desktop-events", {"id": one["id"]})[0], 401)
                one["workspace"].update(records=[{"title": "test manuscript"}], settings={"widgets": {"desktop": False}})
                self.assertEqual(call("/api/save", one, first)[0], 200)
                if sys.platform == "win32":
                    with patch.object(server.desktop, "open") as open_widget:
                        self.assertFalse(json.loads(call("/api/desktop-widget", {"id": one["id"], "enabled": True,
                                                                                 "automatic": True}, first)[1])["visible"])
                        open_widget.assert_not_called()
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
                server.widget_dismissed(one["id"])
                event = json.loads(call("/api/desktop-events", {"id": one["id"]}, first)[1])
                self.assertFalse(event["enabled"])
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

"""Optional Windows schedule widget, owned by the local server process."""
import json
import math
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
from datetime import datetime, timedelta


DEFAULT_SCHEDULE = (
    ("上午", "08:00", "11:45"), ("下午", "13:45", "17:15"), ("晚上", "18:30", "21:00"),
)
DEFAULT_LABELS = dict(title="作息进度", rest="休息中", off="休息日", done="今日已结束",
                      free="自由安排", remaining="剩余", next="上班倒计时",
                      countdowns="倒计时", todos="待办事项", vacation="假期", empty="暂无安排",
                      weekend="周末 / 下一休息日", today_off="今天休息", unset="待设置")
# Same gradient, border and foreground as .work-phase in app.css.
PALETTES = {
    "light": (
        ("#fff4c9", "#ffe1cd", "#e9c889", "#855529"),
        ("#ffdfbe", "#f4cad7", "#dfa1a0", "#954d59"),
        ("#e0e5ff", "#d5d9ef", "#a3accd", "#4d5b88"),
    ),
    "dark": (
        ("#625137", "#614039", "#8a6b4b", "#ffe0b0"),
        ("#654044", "#513e58", "#89616c", "#f4c2ce"),
        ("#343d64", "#333549", "#66739d", "#d1d9ff"),
    ),
}


def widget_palette(theme, now, phase):
    span = phase[2]
    hour = int(span[:2]) if span else now.hour
    return PALETTES[theme][0 if hour < 12 else 1 if hour < 18 else 2]


def color_between(start, end, fraction):
    return "#" + "".join(f"{round(int(start[i:i+2],16)*(1-fraction)+int(end[i:i+2],16)*fraction):02x}"
                         for i in (1, 3, 5))


def seconds(text):
    hour, minute = map(int, text.split(":"))
    return hour * 3600 + minute * 60


def is_time(value):
    return isinstance(value, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value)


def widget_config(widgets):
    """Only share the schedule with the native window, never the workspace."""
    widgets = widgets if isinstance(widgets, dict) else {}
    schedule = widgets.get("schedule")
    if not isinstance(schedule, list):
        schedule = [dict(name=n, start=s, end=e) for n, s, e in DEFAULT_SCHEDULE]
    phases = []
    for part in schedule[:1440]:
        if not isinstance(part, dict):
            continue
        name, start, end = (part.get(key) for key in ("name", "start", "end"))
        if isinstance(name, str) and name.strip() and is_time(start) and is_time(end) and start < end:
            phases.append((name.strip()[:100], start, end))

    def days(key):
        values = widgets.get(key)
        return sorted({d for d in values if isinstance(d, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", d)}) if isinstance(values, list) else []

    def items(key):
        values = widgets.get(key)
        return [v for v in values if isinstance(v, dict) and isinstance(v.get("title"), str)
                and v["title"].strip()] if isinstance(values, list) else []

    def stamp(value):
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?", value):
            return ""
        try:
            return datetime.fromisoformat(value).isoformat(timespec="seconds")
        except ValueError:
            return ""

    targets = [(v["title"].strip()[:120], stamp(f"{v.get('date')}T{v.get('time') or '00:00'}"))
               for v in items("items")] if widgets.get("countdowns", True) else []
    todos = [(v["title"].strip()[:120], stamp(v.get("deadline")), v.get("done") is True)
             for v in items("todos")] if widgets.get("todo", True) else []
    return dict(schedule=phases, holidays=days("holidays"), workdays=days("workdays"),
                show_countdowns=widgets.get("countdowns", True) is not False,
                show_todos=widgets.get("todo", True) is not False,
                vacation=stamp(widgets.get("vacation")),
                legacy_vacations=sorted(filter(None, (stamp(widgets.get("winter")), stamp(widgets.get("summer")))))
                if "vacation" not in widgets else [],
                targets=[(k, v) for k, v in targets if v], todos=todos)


def off_day(day, config):
    stamp = day.isoformat()
    return stamp not in config["workdays"] and (stamp in config["holidays"] or day.weekday() >= 5)


def phase_at(now, config):
    """Return (state, phase name, range, elapsed fraction, seconds to boundary)."""
    if off_day(now.date(), config):
        return "off", None, None, None, None
    minute = now.hour * 3600 + now.minute * 60 + now.second + now.microsecond / 1e6
    phases = config["schedule"]
    for name, start, end in phases:
        low, high = seconds(start), seconds(end)
        if low <= minute < high:
            return "working", name, f"{start} – {end}", (minute - low) / (high - low), high - minute
    next_start = next((seconds(p[1]) for p in phases if seconds(p[1]) > minute), None)
    if next_start is not None:
        return "rest", None, None, None, next_start - minute
    return ("done" if phases else "free"), None, None, None, None


def next_work(now, config):
    if not config["schedule"]:
        return None
    for step in range(371):
        day = now.date() + timedelta(days=step)
        if off_day(day, config):
            continue
        for _, start, _ in config["schedule"]:
            target = datetime.combine(day, datetime.strptime(start, "%H:%M").time())
            if target > now:
                return (target-now).total_seconds()
    return None


def time_left(value):
    days, rest = divmod(max(0, math.ceil(value)), 86400)
    hours, rest = divmod(rest, 3600)
    minutes, sec = divmod(rest, 60)
    return (f"{days}d " if days else "") + f"{hours:02d}:{minutes:02d}:{sec:02d}"


def next_rest_day(now, config):
    for step in range(371):
        day = now.date() + timedelta(days=step)
        if off_day(day, config):
            return datetime.combine(day, datetime.min.time())
    return None


def dashboard_rows(config, labels, now):
    rows = []
    if config["show_countdowns"]:
        rows.append((True, labels["countdowns"], ""))
        rest = next_rest_day(now, config)
        rest_text = labels["today_off"] if rest and rest.date() == now.date() else (
            time_left((rest-now).total_seconds()) if rest else labels["unset"])
        rows.append((False, labels["weekend"], rest_text))
        legacy = config["legacy_vacations"]
        vacation = config["vacation"] or next((v for v in legacy if datetime.fromisoformat(v)>now), legacy[-1] if legacy else "")
        targets = config["targets"] + ([(labels["vacation"], vacation)] if vacation else [])
        for title, when in sorted(targets, key=lambda x: x[1]):
            rows.append((False, title, time_left((datetime.fromisoformat(when)-now).total_seconds())))
        if not vacation:
            rows.append((False, labels["vacation"], labels["unset"]))
    if config["show_todos"]:
        rows.append((True, labels["todos"], ""))
        for title, when, done in sorted(config["todos"], key=lambda x: (x[2], x[1] or "9999")):
            rows.append((False, f"{'✓' if done else '○'}  {title}", when[5:16].replace("T", " ") if when else ""))
        if not config["todos"]:
            rows.append((False, labels["empty"], ""))
    return rows


def dock_side(x, width, left, right, snap):
    if x <= left + snap:
        return "left"
    if x + width >= right - snap:
        return "right"
    return None


class DesktopWidget:
    def __init__(self, notify=None):
        self._lock = threading.Lock()
        self._process = None
        self._owner = None
        self._revision = -1
        self._config = None
        self._theme = None
        self._closed = False
        self._auto_attempted = set()
        self._notify = notify

    def _live(self):
        return self._process is not None and self._process.poll() is None

    def visible(self, owner):
        with self._lock:
            return owner == self._owner and self._live()

    def _send(self, msg):
        self._process.stdin.write((json.dumps(msg, ensure_ascii=True) + "\n").encode("ascii"))
        self._process.stdin.flush()

    def open(self, owner, revision, widgets, labels, theme="light", automatic=False):
        with self._lock:
            if self._closed:
                raise RuntimeError("Dear Editor 正在退出。")
            if self._live():
                if self._owner != owner:
                    if automatic:
                        return
                    raise RuntimeError("另一个本地账号已打开桌面浮窗。")
                return
            if automatic and owner in self._auto_attempted:
                return
            self._auto_attempted.add(owner)
            self._stop()
            try:
                self._process = subprocess.Popen(
                    [sys.executable, "-B", str(Path(__file__).resolve())],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                self._owner, self._revision = owner, revision
                self._config = widget_config(widgets)
                self._theme = theme
                self._send(dict(config=self._config, labels=labels, theme=theme))
                ready = queue.Queue()
                threading.Thread(target=self._listen, args=(self._process, owner, ready), daemon=True).start()
                if ready.get(timeout=4).strip() != b"ready":
                    raise RuntimeError("无法打开桌面浮窗，请确认 Python 已安装 Tkinter。")
            except (OSError, queue.Empty, RuntimeError) as exc:
                self._stop()
                raise RuntimeError("无法打开桌面浮窗，请确认 Python 已安装 Tkinter。") from exc

    def _listen(self, process, owner, ready):
        try:
            ready.put(process.stdout.readline())
            for event in process.stdout:
                if event.strip() != b"dismiss":
                    continue
                with self._lock:
                    if self._process != process:
                        return
                    self._stop()
                    if self._notify:
                        self._notify(owner)
                    return
        except (OSError, ValueError):
            pass

    def refresh(self, owner, revision, widgets):
        with self._lock:
            if owner != self._owner or revision < self._revision or not self._live():
                return
            config = widget_config(widgets)
            self._revision = revision
            if config == self._config:
                return
            try:
                self._send(dict(config=config))
                self._config = config
            except OSError:
                self._stop()

    def set_theme(self, owner, theme):
        with self._lock:
            if owner != self._owner or not self._live() or self._theme == theme:
                return
            try:
                self._send(dict(theme=theme))
                self._theme = theme
            except OSError:
                self._stop()

    def _stop(self):
        process, self._process = self._process, None
        self._owner, self._revision, self._config, self._theme = None, -1, None, None
        if process is None:
            return
        if process.stdin:
            try:
                process.stdin.close()  # EOF lets the window shut down cleanly.
            except OSError:
                pass
        try:
            process.wait(timeout=0.35)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        if process.stdout:
            process.stdout.close()

    def close(self, owner, signout=False):
        with self._lock:
            if signout:
                self._auto_attempted.discard(owner)
            if self._owner == owner:
                self._stop()

    def shutdown(self):
        with self._lock:
            self._closed = True
            self._stop()


def run_window():
    import ctypes
    from ctypes import wintypes as wt
    import tkinter as tk
    import tkinter.font as tkfont
    import time

    def commands():
        buffer = bytearray()
        fd = sys.stdin.fileno()
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                return
            buffer.extend(chunk)
            while (line_end := buffer.find(b"\n")) >= 0:
                line = bytes(buffer[:line_end])
                del buffer[:line_end+1]
                try:
                    yield json.loads(line)
                except (ValueError, UnicodeError):
                    continue

    incoming = commands()
    first = next(incoming)
    config, labels = first["config"], {**DEFAULT_LABELS, **first.get("labels", {})}
    theme = first.get("theme", "light")
    user = ctypes.WinDLL("user32", use_last_error=True)
    gdi = ctypes.WinDLL("gdi32", use_last_error=True)
    try:
        ctypes.WinDLL("shcore").SetProcessDpiAwareness(2)
    except (OSError, AttributeError):
        user.SetProcessDPIAware()

    class MonitorInfo(ctypes.Structure):
        _fields_ = [("size", wt.DWORD), ("screen", wt.RECT), ("work", wt.RECT), ("flags", wt.DWORD)]

    user.GetAncestor.argtypes, user.GetAncestor.restype = (wt.HWND, wt.UINT), wt.HWND
    user.MonitorFromPoint.argtypes, user.MonitorFromPoint.restype = (wt.POINT, wt.DWORD), wt.HANDLE
    user.GetMonitorInfoW.argtypes = (wt.HANDLE, ctypes.POINTER(MonitorInfo))
    user.SetWindowPos.argtypes = (wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT)
    user.GetCursorPos.argtypes = (ctypes.POINTER(wt.POINT),)
    user.SetWindowRgn.argtypes = (wt.HWND, wt.HANDLE, wt.BOOL)
    user.SetLayeredWindowAttributes.argtypes = (wt.HWND, wt.DWORD, wt.BYTE, wt.DWORD)
    gdi.CreateRoundRectRgn.argtypes, gdi.CreateRoundRectRgn.restype = (ctypes.c_int,)*6, wt.HANDLE
    gdi.DeleteObject.argtypes = (wt.HANDLE,)
    get_style, set_style = user.GetWindowLongW, user.SetWindowLongW
    get_style.argtypes, set_style.argtypes = (wt.HWND, ctypes.c_int), (wt.HWND, ctypes.c_int, wt.LONG)

    def cursor():
        p = wt.POINT()
        user.GetCursorPos(ctypes.byref(p))
        return p.x, p.y

    def work_area(point):
        info = MonitorInfo(ctypes.sizeof(MonitorInfo))
        if not user.GetMonitorInfoW(user.MonitorFromPoint(wt.POINT(*point), 2), ctypes.byref(info)):
            return 0, 0, root.winfo_screenwidth(), root.winfo_screenheight()
        r = info.work
        return r.left, r.top, r.right, r.bottom

    root = tk.Tk()
    root.withdraw()
    root.title("Dear Editor · " + labels["title"])
    root.overrideredirect(True)
    root.geometry("264x86")
    frame = tk.Canvas(root, highlightthickness=0)
    frame.pack(fill="both", expand=True)
    root.update_idletasks()
    hwnd = user.GetAncestor(root.winfo_id(), 2) or root.winfo_id()
    get_style.restype = wt.LONG
    set_style(hwnd, -20, (get_style(hwnd, -20) | 0x08080080) & ~0x00040000)  # NOACTIVATE | LAYERED | TOOLWINDOW
    scale = min(2.5, max(1, root.winfo_fpixels("1i") / 96))
    full, mini, tall, short, wide = [round(v * scale) for v in (264, 94, 86, 94, 370)]
    area = work_area(cursor())
    x, y = area[2] - full - 28, area[1] + 60
    w, h = full, tall
    dock = None
    hovered = False
    drag = None
    frames = None
    details = False
    scroll = 0
    scroll_max = 0
    next_cache = (None, None)
    prefs = wt.BOOL(True)
    user.SystemParametersInfoW(0x1042, 0, ctypes.byref(prefs), 0)  # client-area animation
    animated = bool(prefs.value)
    updates = queue.SimpleQueue()
    font_cache = {}
    now = datetime.now()
    palette = target_palette = widget_palette(theme, now, phase_at(now, config))
    color_animation = hover_glint = hover_deadline = None
    shape = window_alpha = None

    def listen():
        try:
            for msg in incoming:
                updates.put(msg)
        finally:
            updates.put(None)

    def clamp(value, low, high):
        return max(low, min(value, high))

    def place(visible=False):
        nonlocal shape, window_alpha
        user.SetWindowPos(hwnd, wt.HWND(-1), x, y, w, h, 0x10 | (0x40 if visible else 0))
        alpha = round(231+16*clamp((w-mini)/(full-mini), 0, 1))
        if alpha != window_alpha and user.SetLayeredWindowAttributes(hwnd, 0, alpha, 2):
            window_alpha = alpha
        if shape != (w, h):
            radius = round((45-15*clamp((w-mini)/(full-mini), 0, 1))*scale)
            handle = gdi.CreateRoundRectRgn(0, 0, w, h, radius, radius)
            if handle:
                if user.SetWindowRgn(hwnd, handle, True):
                    shape = w, h
                else:
                    gdi.DeleteObject(handle)

    def text(px, py, value, size, color, anchor="w", bold=False, max_width=None):
        key = (size, bold)
        if key not in font_cache:
            font_cache[key] = tkfont.Font(family="Microsoft YaHei UI", size=-round(size*scale),
                                          weight="bold" if bold else "normal")
        font = font_cache[key]
        shown = value
        if max_width is not None and font.measure(shown)>max_width*scale:
            while value and font.measure(value+"…")>max_width*scale:
                value = value[:-1]
            shown = value+"…"
        frame.create_text(round(px * scale), round(py * scale), text=shown, fill=color,
                          anchor=anchor, font=font)

    def bar(left, top, width, fraction, track, fill):
        left, top, width = [round(v * scale) for v in (left, top, width)]
        thickness = max(3, round(5*scale))
        frame.create_line(left, top, left+width, top, fill=track, width=thickness, capstyle="round")
        if fraction:
            frame.create_line(left, top, left+max(1, round(width*fraction)), top, fill=fill,
                              width=thickness, capstyle="round")

    def progress_ring(cx, cy, fraction, ink, surface, strength):
        radius = 33
        box = tuple(v*scale for v in (cx-radius, cy-radius, cx+radius, cy+radius))
        thickness = max(2, round(4.5*scale))
        track = color_between(surface, ink, .19*strength)
        fill = color_between(surface, ink, strength)
        frame.create_oval(*box, outline=track, width=thickness)
        if fraction:
            frame.create_arc(*box, start=90, extent=-min(359.95,fraction*360), style="arc",
                             outline=fill,width=thickness)
            angle = math.radians(fraction*360)
            for a,b in ((cx,cy-radius),(cx+radius*math.sin(angle),cy-radius*math.cos(angle))):
                r = thickness/(2*scale)
                frame.create_oval((a-r)*scale,(b-r)*scale,(a+r)*scale,(b+r)*scale,fill=fill,width=0)

    last_draw = None

    def draw(state, now, sheen):
        nonlocal last_draw, scroll, scroll_max, next_cache
        mode, name, span, fraction, remaining = state
        if remaining is None and mode != "working":
            cache_key = (id(config), now.date(), now.hour, now.minute)
            if next_cache[0] != cache_key:
                wait = next_work(now, config)
                next_cache = cache_key, now+timedelta(seconds=wait) if wait is not None else None
            if next_cache[1] is not None:
                remaining = (next_cache[1]-now).total_seconds()
        n = math.floor(fraction * 100) if fraction is not None else None
        sec = math.ceil(remaining) if remaining is not None else None
        rows = dashboard_rows(config, labels, now) if details and h>tall else []
        slots = max(0, math.floor((h/scale-113)/24))
        scroll_max = max(0, len(rows)-slots)
        scroll = clamp(scroll, 0, scroll_max)
        key = (w, h, palette, mode, name, span, n, sec, None if fraction is None else round(fraction*w),
               sheen, details, scroll, rows)
        if key == last_draw:
            return
        last_draw = key
        frame.delete("all")
        start, end, border, ink = palette
        width, height = w/scale, h/scale
        compact = clamp((full-w)/(full-mini), 0, 1)
        skew, step = min(h, tall)*.55, max(2, round(4*scale))
        for left in range(0, math.ceil(w+skew)+step, step):
            position = min(1, left/(w+skew))
            lens = max(0, 1-abs(position-(.30+.55*sheen))/.44)
            color = color_between(color_between(start, end, position), "#ffffff",
                                  lens*(.10+.08*compact+(.10*math.sin(sheen*math.pi))))
            frame.create_polygon(left-step, 0, left+1, 0, left-skew+1, h, left-skew-step, h, fill=color)
        radius = round((15+7.5*compact)*scale)
        inset = max(1, round(scale))
        gleam = color_between(border, "#ffffff", .63+.18*compact)
        shadow = color_between(border, ink, .22)
        for xx, yy, angle, line in ((inset,inset,90,gleam),(w-2*radius-inset,inset,0,gleam),
                                    (inset,h-2*radius-inset,180,shadow),(w-2*radius-inset,h-2*radius-inset,270,shadow)):
            frame.create_arc(xx, yy, xx+2*radius, yy+2*radius, start=angle, extent=90,
                             style="arc", outline=line, width=inset)
        frame.create_line(radius, inset, w-radius, inset, fill=gleam, width=inset)
        frame.create_line(radius, h-inset, w-radius, h-inset, fill=shadow, width=inset)
        frame.create_line(inset, radius, inset, h-radius, fill=gleam, width=inset)
        frame.create_line(w-inset, radius, w-inset, h-radius, fill=shadow, width=inset)
        open_amount = clamp((w-mini)/(full-mini), 0, 1)
        reveal = clamp((open_amount-.55)/.45, 0, 1)
        soft = color_between(end, ink, .85)
        if reveal:
            foreground = color_between(end, ink, reveal)
            detail = color_between(end, soft, reveal)
            face = name if mode == "working" else labels[mode]
            text(13, 22, face, 23, foreground, bold=True, max_width=max(22,width-48))
            text(width-12, 19, "×", 20, foreground, "e")
            if sec is not None and span:
                text(14, 53, f"{labels['remaining']}  {time_left(sec)}", 15, detail)
            elif sec is not None:
                text(14, 53, labels["next"], 14, detail, max_width=width-145)
                text(width-14, 53, time_left(sec), 17, foreground, "e", True)
        ring = clamp((.45-open_amount)/.45, 0, 1)
        center = width/2+(width/2-49)*open_amount
        mid_y = 47+6*open_amount
        if ring:
            progress_ring(center, mid_y, fraction, ink, end, ring)
        if n is not None or open_amount < .75:
            value = f"{n}%" if n is not None else "—"
            font_px = 25 + round(7*open_amount)
            text(center, mid_y, value, font_px, ink, "center", True)
        reveal_bar = clamp((open_amount-.35)/.65, 0, 1)
        if reveal_bar:
            bar(11, min(height-9,76), width-22, fraction, color_between(end, ink, .22*reveal_bar),
                color_between(end, ink, reveal_bar))
        if slots and details:
            rows = rows or [(False, labels["empty"], "")]
            for i, (header, title, value) in enumerate(rows[scroll:scroll+slots]):
                yy = 99+24*i
                if header:
                    frame.create_rectangle(11*scale,(yy-10)*scale,(width-11)*scale,(yy+10)*scale,
                                           fill=color_between(end, ink, .08), width=0)
                text(16, yy, title, 14, ink, bold=header, max_width=width-(122 if value else 32))
                if value:
                    text(width-16, yy, value, 13, soft, "e")
            if scroll_max:
                text(width-18, height-15, "▲    ▼", 15, ink, "e", True)

    def animate(target):
        nonlocal frames
        target = (min(target[0], area[2]-area[0]), min(target[1], area[3]-area[1]))
        if target == (w, h):
            frames = None
        else:
            frames = time.monotonic(), w, h, *target

    def detail_size():
        count = len(dashboard_rows(config, labels, datetime.now()))
        return wide, round(max(178,113+24*count)*scale)

    def tick():
        nonlocal config, theme, palette, target_palette, color_animation, hover_glint, hover_deadline, w, h, x, y, frames, hovered
        while not updates.empty():
            msg = updates.get()
            if msg is None:
                root.destroy()
                return
            if "config" in msg:
                config = msg["config"]
                if details and not drag:
                    animate(detail_size())
            theme = msg.get("theme", theme)
        if dock and not drag and not details:
            cx, cy = cursor()
            over = x <= cx < x+w and y <= cy < y+h
            if over != hovered:
                hovered = over
                now = time.monotonic()
                hover_deadline = now+(.45 if over else .22)
                if over and animated:
                    hover_glint = now
            if hover_deadline is not None and time.monotonic()>=hover_deadline:
                hover_deadline = None
                animate((full,tall) if hovered else (mini,short))
        uptime = time.monotonic()
        sheen = 0
        if hover_glint is not None:
            elapsed = (uptime-hover_glint)/.65
            if elapsed>=1:
                hover_glint = None
            else:
                sheen = round(elapsed,2)
        if frames:
            begin, sw, sh, tw, th = frames
            elapsed = min(1, (uptime-begin)/.32) if animated else 1
            # Critically damped motion: fast response with a soft stop, no bounce past the edge.
            ease = 1 if elapsed >= 1 else (1-(1+8*elapsed)*math.exp(-8*elapsed))/(1-9*math.exp(-8))
            w, h = round(sw+(tw-sw)*ease), round(sh+(th-sh)*ease)
            inset = round(4*scale)
            if dock:
                x = area[0]+inset if dock == "left" else area[2]-w-inset
            else:
                x = clamp(x, area[0], area[2]-w)
            y = clamp(y, area[1], area[3]-h)
            sheen = round(elapsed, 2) if elapsed<1 else 0
            place()
            if elapsed >= 1:
                frames = None
        now = datetime.now()
        phase = phase_at(now, config)
        desired = widget_palette(theme, now, phase)
        if desired != target_palette:
            target_palette = desired
            color_animation = (uptime, palette) if animated else None
            if not animated:
                palette = desired
        if color_animation:
            begin, before = color_animation
            fade = min(1, (uptime-begin)/.42)
            blend = fade*fade*(3-2*fade)
            palette = tuple(color_between(a,b,blend) for a,b in zip(before, target_palette))
            if fade >= 1:
                color_animation = None
        draw(phase, now, sheen)
        root.after(16 if frames or color_animation or hover_glint is not None else 80, tick)

    def press(event):
        nonlocal drag, frames
        cx, cy = cursor()
        drag = (cx, cy, event.x, event.y, False)
        frames = None

    def move(_event):
        nonlocal drag, x, y, w, h, dock, area
        if not drag:
            return
        cx, cy = cursor()
        ox, oy, dx, dy, moved = drag
        if not moved and abs(cx-ox)+abs(cy-oy) < 5:
            return
        drag = (ox, oy, dx, dy, True)
        dock, area = None, work_area((cx, cy))
        target = detail_size() if details else (full, tall)
        w, h = min(target[0],area[2]-area[0]), min(target[1],area[3]-area[1])
        x, y = clamp(cx-dx, area[0], area[2]-w), clamp(cy-dy, area[1], area[3]-h)
        place()

    def dismiss():
        print("dismiss", flush=True)
        root.destroy()

    def release(_event):
        nonlocal drag, dock, hovered, details, scroll, hover_deadline
        if not drag:
            return
        _, _, dx, dy, moved = drag
        drag = None
        if moved:
            dock = dock_side(x, w, area[0], area[2], round(22*scale))
            if dock:
                hovered = True
                hover_deadline = None
                animate(detail_size() if details else (mini, short))
            return
        px, py = dx/scale, dy/scale
        width, height = w/scale, h/scale
        if w < full*.74 and not details:
            hovered = True
            hover_deadline = None
            animate((full,tall))
        elif py < 34 and px >= width-30:
            dismiss()
        elif details and py > height-29:
            if px > width-100 and scroll_max:
                scroll = clamp(scroll + (1 if px > width-44 else -1), 0, scroll_max)
        elif not details or py < 86:
            details = not details
            scroll = 0
            animate(detail_size() if details else (mini,short) if dock else (full,tall))

    def wheel(event):
        nonlocal scroll
        if details and event.delta:
            scroll = clamp(scroll+(1 if event.delta<0 else -1), 0, scroll_max)

    frame.bind("<ButtonPress-1>", press)
    frame.bind("<B1-Motion>", move)
    frame.bind("<ButtonRelease-1>", release)
    frame.bind("<MouseWheel>", wheel)
    root.protocol("WM_DELETE_WINDOW", dismiss)
    threading.Thread(target=listen, daemon=True).start()
    root.deiconify()
    root.update_idletasks()
    place(True)
    tick()
    root.after_idle(lambda: print("ready", flush=True))
    root.mainloop()


if __name__ == "__main__":
    try:
        run_window()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)

"""Optional Windows smoke test using an isolated Edge profile and SQLite database."""

import base64
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from local_server import Handler, LocalServer


class DevTools:
    def __init__(self, address):
        url = urllib.parse.urlparse(address)
        self.socket = socket.create_connection((url.hostname, url.port), timeout=10)
        self.reader = self.socket.makefile("rb")
        self.sequence = 0
        key = base64.b64encode(os.urandom(16)).decode()
        handshake = (f"GET {url.path} HTTP/1.1\r\nHost: {url.netloc}\r\nUpgrade: websocket\r\n"
                     f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.socket.sendall(handshake.encode("ascii"))
        assert b"101" in self.reader.readline(), "DevTools rejected the WebSocket connection"
        while self.reader.readline() not in (b"", b"\r\n"):
            pass

    def js(self, expression):
        self.sequence += 1
        message = json.dumps(dict(id=self.sequence, method="Runtime.evaluate",
                                  params=dict(expression=expression, returnByValue=True, awaitPromise=True))).encode()
        length, mask = len(message), os.urandom(4)
        if length < 126:
            header = bytes((129, 128+length))
        elif length < 65536:
            header = b"\x81\xfe" + struct.pack("!H", length)
        else:
            header = b"\x81\xff" + struct.pack("!Q", length)
        self.socket.sendall(header+mask+bytes(b ^ mask[i % 4] for i, b in enumerate(message)))
        while True:
            frame = self.reader.read(2)
            assert frame, "DevTools connection closed"
            length = frame[1] & 127
            if length >= 126:
                length = struct.unpack("!H" if length == 126 else "!Q",
                                       self.reader.read(2 if length == 126 else 8))[0]
            payload = self.reader.read(length)
            if frame[0] & 15 != 1:
                continue
            response = json.loads(payload)
            if response.get("id") != self.sequence:
                continue
            assert "error" not in response, response
            data = response["result"]
            assert "exceptionDetails" not in data, data
            return data["result"].get("value")

    def close(self):
        self.reader.close()
        self.socket.close()


def eventually(read):
    last_error = None
    for _ in range(75):
        try:
            value = read()
            if value:
                return value
        except (OSError, AssertionError) as error:
            last_error = error
        time.sleep(.1)
    raise AssertionError("Timed out waiting for Edge") from last_error


def browser_fixture(app, request):
    clients = []

    def connect(target):
        client = DevTools(target["webSocketDebuggerUrl"])
        clients.append(client)
        return client

    try:
        def new_page():
            return connect(request("/json/new?"+urllib.parse.quote(app, safe=""), "PUT"))

        worker = connect(eventually(lambda: next((t for t in request("/json/list")
                         if t["type"] == "service_worker" and t["url"].endswith("/background.js")), None)))
        other, original = new_page(), new_page()
        for page in (other, original):
            eventually(lambda: page.js("typeof window.receiveDearEditorLookup==='function' && !!$('authForm')"))
        setup = r"""(()=>{
          showLogin(true);
          $('loginUser').value='Bridge fixture';$('loginPassword').value='lookup-secret';
          $('confirmPassword').value='lookup-secret';$('authForm').requestSubmit();
          if(!unlocked)throw Error($('authError').textContent);
          writeAll(records,library,{...profile,scopus:'55555',wos:'LEGACY-X-2026',citations:3,publications:1,hIndex:1});
          function add(title,status){
            openEditor();$('title').value=title;$('journal').value='Fixture journal';
            $('status').value=status;$('number').value=status==='ur'?'TST-D-26-00001':'';
            $('paperForm').requestSubmit();
          }
          add('Fixture article','accept');add('Progress article','ur');
          const paper=records[0];writeAll([{...paper,citations:2,citationSource:'Scopus',citationDate:today()},records[1]]);
          page='profile';render();
          const payload=(url,prefix)=>JSON.parse(decodeURIComponent(new URL(url).hash.slice(prefix.length)));
          const citation=payload(citationLaunch(),'#de-citation=');
          const progress=payload(progressQueryUrl(records[1],{manuscriptNumber:records[1].number,firstName:'Test',lastName:'Author',lang:'en'}),'#gaoji=').progress;
          const dimensions=[...document.querySelectorAll('#languageControl .language-globe,#themeControl .theme-globe')].map(e=>[e.offsetWidth,e.offsetHeight]);
          return {citation,progress,dimensions};
        })()"""
        launch = original.js(setup)
        assert len(launch["dimensions"]) == 2 and launch["dimensions"][0] == launch["dimensions"][1], launch
        other.js("document.title='Other fixture tab'")
        original.js("document.title='Original fixture tab'")

        def activate_other():
            return worker.js("""(async()=>{
              const tabs=await chrome.tabs.query({url:'http://127.0.0.1/*'});
              const tab=tabs.find(t=>t.title==='Other fixture tab');
              if(!tab)return false;
              await chrome.tabs.update(tab.id,{active:true});return true;
            })()""")

        def original_active():
            return worker.js("chrome.tabs.query({active:true}).then(tabs=>tabs.some(t=>t.title==='Original fixture tab'))")

        def count_tabs():
            return len([t for t in request("/json/list") if t["type"] == "page" and t["url"] == app])

        def deliver(kind, token, result):
            source = ("https://www.scopus.com/authid/detail.uri?authorId=55555" if kind == "citation"
                      else "https://webapps.elsevier.cn/st-wechat/manuscript-query")
            sender = {"frameId": 0, "url": source, "tab": {"id": 987654, "windowId": 1}}
            message = {"action": "deliver", "kind": kind, "base": app, "token": token, "result": result}
            return worker.js(f"processMessage({json.dumps(message)},{json.dumps(sender)})")

        data = {"authorId": "55555", "metrics": {"publications": 3, "citations": 10, "hIndex": 2},
                "documents": [{"title": "Fixture article", "journal": "Fixture journal", "count": 7}]}
        assert count_tabs() == 2
        assert not deliver("citation", "wrong-token", data)["ok"]
        eventually(activate_other)
        citation = deliver("citation", launch["citation"]["token"], data)
        assert citation["ok"] and original_active(), citation
        assert count_tabs() == 2 and not other.js("$('citationReview').open"), "Wrong citation tab"
        preview = original.js("""({
          open:$('citationReview').open,count:records[0].citations,
          headers:[...$('citationReviewBody').querySelectorAll('thead th')].map(el=>el.textContent),
          paper:$('citationReviewBody').textContent.includes('Fixture article')
        })""")
        assert preview["open"] and preview["paper"] and preview["count"] == 2, preview
        assert "\u5f53\u524d\u8bb0\u5f55" in preview["headers"] and "Scopus \u8bfb\u53d6\u503c" in preview["headers"], preview
        saved = original.js("""$('citationReviewForm').requestSubmit(); ({
          count:records[0].citations,boxes:[...document.querySelectorAll('.research-summary .metric-small strong')].map(e=>e.textContent),
          legacy:profile.wos,lookup:document.querySelector('[data-citation-lookup]').textContent.trim()
        })""")
        assert saved["count"] == 7 and saved["boxes"] == ["3", "10", "2"], saved
        assert saved["legacy"] == "LEGACY-X-2026" and "\u66f4\u65b0\u81ea" in saved["lookup"], saved
        original.js("document.title='Original fixture tab'")
        eventually(activate_other)
        progress = deliver("progress", launch["progress"]["token"], {"number": "TST-D-26-00001", "status": "ur", "agreed": 2})
        assert progress["ok"] and original_active(), progress
        assert count_tabs() == 2 and not other.js("$('progress').open"), "Wrong progress tab"
        assert original.js("$('progress').open && $('progress-agreed').value==='2' && records[1].rounds.at(-1).agreed===null")
        assert original.js("""(async()=>{
          $('progress').close();page='stats';render();
          if([...document.querySelectorAll('#content h2')].some(h=>h.textContent==='\\u5f15\\u7528\\u66f4\\u65b0\\u8bb0\\u5f55'))return false;
          if(!records[0].citationHistory.length)return false;
          page='feedback';render();
          const published=window.dearEditorProjectFeedback, contact=document.querySelector('.contact-list');
          const images=[...document.querySelectorAll('.support-codes img')];
          await Promise.all(images.map(image=>image.decode()));
          return contact.textContent.includes(published.phone)&&contact.textContent.includes(published.wechat)&&
            images.length===2&&images.every(image=>image.naturalWidth>0)&&!settings.feedback.phone;
        })()""")
        print("Edge: both previews returned to the original tab; no extra tab opened.")
    finally:
        for client in clients:
            client.close()


def main():
    edge = Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe"
    if not edge.exists():
        raise SystemExit("Edge is required for this optional browser test.")
    original_result = Handler.result
    with tempfile.TemporaryDirectory(prefix="de-lookup-", ignore_cleanup_errors=True) as tmp, patch.object(
        Handler, "result",
        lambda self, row, db: dict(original_result(self, row, db), desktopAvailable=False, desktopEnabled=False),
    ):
        with LocalServer(0, Path(tmp)/"test.sqlite3") as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            with socket.socket() as free:
                free.bind(("127.0.0.1", 0))
                port = free.getsockname()[1]
            extension = ROOT/"integrations"/"elsevier"
            process = subprocess.Popen([str(edge), "--headless=new", f"--remote-debugging-port={port}",
                                        f"--user-data-dir={Path(tmp)/'profile'}", f"--disable-extensions-except={extension}",
                                        f"--load-extension={extension}", "--no-first-run", "about:blank"],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            def request(path, method="GET"):
                url = f"http://127.0.0.1:{port}"+path
                with urllib.request.urlopen(urllib.request.Request(url, method=method), timeout=2) as response:
                    return json.load(response)
            try:
                browser_fixture(server.origin+"/", request)
            finally:
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=10)
                server.shutdown()


if __name__ == "__main__":
    main()

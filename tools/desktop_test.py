#!/usr/bin/env python3
"""Run the app in headless desktop Chromium (real streams) and walk the remote controls.
   python3 tools/desktop_test.py [--shots DIR]"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.request, http.server, threading, functools
import websocket
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'app', 'com.homebrew.iptv')
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8095), functools.partial(http.server.SimpleHTTPRequestHandler, directory=APP))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
chrome = subprocess.Popen(['chromium', '--headless=new', '--remote-debugging-port=9335', '--user-data-dir=' + tempfile.mkdtemp(),
                           '--autoplay-policy=no-user-gesture-required', '--window-size=1920,1080', 'about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(80):
        try: pages = json.load(urllib.request.urlopen('http://127.0.0.1:9335/json', timeout=2)); break
        except Exception: time.sleep(0.25)
    ws = websocket.create_connection([p for p in pages if p['type'] == 'page'][0]['webSocketDebuggerUrl'], timeout=30, suppress_origin=True)
    n = [0]; events = []
    def call(m, **p):
        n[0] += 1; ws.send(json.dumps({'id': n[0], 'method': m, 'params': p}))
        while True:
            r = json.loads(ws.recv())
            if r.get('id') == n[0]: return r.get('result', {})
            events.append(r)
    def pump(s):
        end = time.time() + s; ws.settimeout(0.2)
        while time.time() < end:
            try: events.append(json.loads(ws.recv()))
            except Exception: pass
        ws.settimeout(30)
    def js(e): return call('Runtime.evaluate', expression=e, returnByValue=True)['result'].get('value')
    def key(kc, wait=0.4):
        for t in ('rawKeyDown', 'keyUp'): call('Input.dispatchKeyEvent', type=t, windowsVirtualKeyCode=kc)
        pump(wait)
    def shot(name):
        if SHOTS: os.makedirs(SHOTS, exist_ok=True); open(os.path.join(SHOTS, name + '.png'), 'wb').write(base64.b64decode(call('Page.captureScreenshot', format='png')['data']))
    call('Runtime.enable'); call('Emulation.setDeviceMetricsOverride', width=1920, height=1080, deviceScaleFactor=1, mobile=False)
    call('Page.navigate', url='http://127.0.0.1:8095/index.html'); pump(1)
    ST = '(function(){var a=__iptv.attempt,v=document.getElementById("video");return {ch:a&&(a.ch.num+" "+a.ch.name), sources:a&&a.ch.sources.length, try:a&&(a.i+"/"+a.list.length), v:"t="+v.currentTime.toFixed(1)+" rs="+v.readyState+(v.paused?" paused":" playing"), status:document.getElementById("status").classList.contains("hidden")?null:document.getElementById("status-text").innerText.split("\\n")[0], state:document.getElementById("b-state").textContent}})()'
    print('channels:', js('__iptv.channels.length'), '| merged:', js('__iptv.channels.filter(function(c){return c.sources.length>1}).map(function(c){return c.name+" x"+c.sources.length}).join(", ")'))
    print('native HLS in this browser:', js('!!document.getElementById("video").canPlayType("application/vnd.apple.mpegurl")'))
    pump(10); print('start:   ', js(ST)); shot('01-playing')
    for i in range(3): key(38, 12); print('Up %d:    ' % (i + 1), js(ST))
    key(13, 1); print('list:', js('document.getElementById("l-group").textContent'), '|', js('[].map.call(document.querySelectorAll(".item"),function(e){return e.textContent.trim().slice(0,22)}).slice(0,4)')); shot('02-list')
    key(39, 0.5); print('Right ->', js('document.getElementById("l-group").textContent')); key(39, 0.5); print('Right ->', js('document.getElementById("l-group").textContent'))
    key(40, 0.3); key(13, 12); print('tune from list:', js(ST))
    key(405, 0.5); print('Yellow fav, banner star shown:', not js('document.getElementById("b-fav").classList.contains("hidden")'))
    for d in (50, 51): key(d, 0.2)
    pump(13); print('typed 23:', js(ST)); shot('03-banner')
    key(406, 1); print('Blue settings open:', not js('document.getElementById("settings").classList.contains("hidden")')); shot('04-settings'); key(461, 0.5)
    exc = [e for e in events if e.get('method') == 'Runtime.exceptionThrown']
    print('JS exceptions:', [e['params']['exceptionDetails'].get('exception', {}).get('description', '')[:150] for e in exc] or 'none')
finally:
    chrome.kill(); srv.shutdown()

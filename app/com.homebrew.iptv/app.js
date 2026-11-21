/* IPTV Player for webOS — created by aning and Cipher Amir with Claude. */
(function () {
  'use strict';

  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, GUIDE: 458,
    CH_UP: 33, CH_DOWN: 34, CH_UP2: 427, CH_DOWN2: 428, PLAY: 415, PAUSE: 19, PLAYPAUSE: 463, INFO: 457 };
  var NO_DATA_MS = 15000;   // a stream with no picture after this long is given up (and unloaded, see unload())

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var toastTm;
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTm); toastTm = setTimeout(function () { t.classList.add('hidden'); }, ms || 2200);
  }

  // ---------- playlist ----------
  // Parses #EXTINF entries (tvg-logo, group-title "A;B", #EXTVLCOPT http-user-agent) and merges duplicates
  // ("INTRAVEL (1080p)" + "InTravel (1080p)") into one channel with several sources, tried in order.
  function attr(line, name) { var m = new RegExp(name + '="([^"]*)"', 'i').exec(line); return m ? m[1] : ''; }
  function parseM3U(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n'), out = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      if (!l) continue;
      if (l.indexOf('#EXTINF') === 0) {
        cur = { name: l.slice(l.lastIndexOf(',') + 1).trim(), logo: attr(l, 'tvg-logo'), group: attr(l, 'group-title'), id: attr(l, 'tvg-id'), ua: '' };
      } else if (l.indexOf('#EXTVLCOPT:http-user-agent=') === 0 && cur) {
        cur.ua = l.split('=').slice(1).join('=');
      } else if (l.charAt(0) !== '#' && cur) {
        cur.url = l; out.push(cur); cur = null;
      }
    }
    return out;
  }
  // Key for "same channel": no (1080p)/[Geo-blocked] tags, region words, trailing TV, case or punctuation,
  // so "MovieSphere UK", "Bloomberg TV +" and "i24NEWS English World" match the channels already in the list.
  function normKey(n) {
    var k = n.toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ' ');
    for (var i = 0; i < 3; i++) k = k.replace(/\s+(uk|us|usa|au|ca|nz|east|west|world|international|hd|sd|fhd|uhd|tv|channel|network)\s*$/, '');
    return k.replace(/[^a-z0-9]+/g, '');
  }
  function baseName(n) { return n.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+(HD|SD|FHD|UHD)$/i, '').trim(); }
  function buildChannels(entries) {
    var byKey = {}, list = [];
    entries.forEach(function (e) {
      var key = normKey(e.name);
      var ch = byKey[key];
      if (!ch) {
        ch = byKey[key] = { name: baseName(e.name) || e.name, logo: e.logo, groups: [], sources: [] };
        list.push(ch);
      }
      if (!ch.logo && e.logo) ch.logo = e.logo;
      (e.group || 'Other').split(';').forEach(function (g) { g = g.trim(); if (g && ch.groups.indexOf(g) < 0) ch.groups.push(g); });
      ch.sources.push({ url: e.url, ua: e.ua, label: e.name });
    });
    list.forEach(function (ch, i) {
      ch.num = i + 1;
      if (!ch.groups.length) ch.groups.push('Other');
      // the TV's player can't send a custom User-Agent, so sources that need one go last
      ch.sources.sort(function (a, b) { return (a.ua ? 1 : 0) - (b.ua ? 1 : 0); });
    });
    return list;
  }

  var channels = [], groups = [], favs = load('favs', []), cur = -1;
  // Channels that didn't play are hidden everywhere (list, ▲▼, numbers) and tried again after a day.
  var HIDE_MS = 24 * 3600 * 1000, deadMap = load('dead', {});
  function shownCh(ch) { return !(deadMap[ch.name] && Date.now() - deadMap[ch.name] < HIDE_MS); }
  function groupList() {
    var gs = ['All channels'];
    var vis = channels.filter(shownCh);
    if (vis.some(isFav)) gs.push('★ Favorites');
    vis.forEach(function (ch) { ch.groups.forEach(function (g) { if (gs.indexOf(g) < 0) gs.push(g); }); });
    return gs;
  }
  function isFav(ch) { return favs.indexOf(ch.name) >= 0; }

  // ---------- player ----------
  var video = $('video'), hls = null, tuneTok = 0, watchTm = null, attempt = null;
  // Free the hardware decoder before anything else: on webOS a stream stuck "loading" keeps it otherwise,
  // and then no other channel can start until the app is closed.
  function unload() {
    clearTimeout(watchTm);
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {}
  }
  var nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
  function attemptsFor(ch) {
    // every source natively (the TV's own player) and, for HLS, through hls.js as a second try
    var a = [];
    ch.sources.forEach(function (s, i) {
      var isHls = /\.m3u8(\?|$)/i.test(s.url);
      if (nativeHls || !isHls) a.push({ src: i, hls: false });
      if (isHls && window.Hls && Hls.isSupported()) a.push({ src: i, hls: true });
    });
    return a;
  }
  function tune(idx, keepBanner) {
    if (!channels.length || !channels.some(shownCh)) return setStatus('No channels are playing right now.\nRed reloads the list.', true);
    var dir = idx < cur ? -1 : 1;
    idx = (idx + channels.length) % channels.length;
    while (!shownCh(channels[idx])) idx = (idx + dir + channels.length) % channels.length;   // hidden (not playing) channels are skipped
    cur = idx;
    var ch = channels[idx];
    save('last', ch.name);
    attempt = { ch: ch, list: attemptsFor(ch), i: 0, dir: dir };
    showBanner();
    startAttempt();
    if (!$('list').classList.contains('hidden')) renderList(false);
  }
  // ---------- quality: start on the best stream up to 1080p ----------
  // The TV's player (and hls.js) start low (240-360p) and climb slowly, some channels never got past 360p.
  // So read the master playlist and pick the variant ourselves: 1080p if offered, else the highest below it.
  var MAX_H = 1080;
  function bestIndex(heights) {
    var best = -1;
    heights.forEach(function (h, i) { if (h && h <= MAX_H && (best < 0 || h > heights[best])) best = i; });
    if (best < 0) heights.forEach(function (h, i) { if (best < 0 || h < heights[best]) best = i; });   // only >1080: smallest of those
    return best;
  }
  function resolveVariant(url) {
    var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 5000);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { return r.text().then(function (t) { return { t: t, base: r.url || url }; }); })
      .then(function (m) {
        clearTimeout(tm);
        var lines = m.t.split(/\r?\n/), vars = [];
        for (var i = 0; i < lines.length; i++) {
          if (lines[i].indexOf('#EXT-X-STREAM-INF') === 0) {
            var h = +((/RESOLUTION=\d+x(\d+)/.exec(lines[i]) || [])[1] || 0), bw = +((/BANDWIDTH=(\d+)/.exec(lines[i]) || [])[1] || 0);
            var j = i + 1; while (j < lines.length && (!lines[j] || lines[j].charAt(0) === '#')) j++;
            if (lines[j]) vars.push({ h: h, bw: bw, url: new URL(lines[j].trim(), m.base).href });
          }
        }
        if (!vars.length) return { url: url };                                     // already a single stream
        // same height: the higher bitrate
        var heights = vars.map(function (v) { return v.h; }), bi = bestIndex(heights);
        vars.forEach(function (v, i) { if (v.h === vars[bi].h && v.bw > vars[bi].bw) bi = i; });
        return { url: vars[bi].url, h: vars[bi].h, separateAudio: /TYPE=AUDIO[^\n]*URI=/.test(m.t) };
      }).catch(function () { clearTimeout(tm); return { url: url }; });          // can't read it: let the player choose
  }

  function startAttempt() {
    var a = attempt, tok = ++tuneTok;
    unload();
    if (!a || a.i >= a.list.length) return giveUp();
    var step = a.list[a.i], s = a.ch.sources[step.src];
    setStatus('Loading ' + a.ch.name + '…' + (a.ch.sources.length > 1 ? '  (source ' + (step.src + 1) + ' of ' + a.ch.sources.length + ')' : ''), false);
    setState('Loading…', '');
    watchTm = setTimeout(function () { if (tok === tuneTok && video.readyState < 2) next(); }, NO_DATA_MS);
    function viaHls(url) {
      hls = new Hls({ enableWorker: true, maxBufferLength: 20, backBufferLength: 10, capLevelToPlayerSize: false, abrEwmaDefaultEstimate: 8e6 });
      hls.on(Hls.Events.ERROR, function (ev, d) { if (d.fatal && tok === tuneTok) next(); });
      hls.on(Hls.Events.MANIFEST_PARSED, function (ev, d) {
        if (tok !== tuneTok) return;
        var bi = bestIndex((d.levels || []).map(function (l) { return l.height || 0; }));
        if (bi >= 0) { hls.startLevel = bi; hls.autoLevelCapping = bi; hls.nextLevel = bi; }   // start at 1080p, never above
        play();
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    }
    if (step.hls) return viaHls(s.url);
    if (!/\.m3u8(\?|$)/i.test(s.url)) { video.src = s.url; return play(); }
    resolveVariant(s.url).then(function (v) {
      if (tok !== tuneTok) return;
      // audio in its own stream: a single video variant would be silent, so hls.js (with the audio) at that quality
      if (v.separateAudio && window.Hls && Hls.isSupported()) return viaHls(s.url);
      video.src = v.url;
      play();
    });
  }
  function play() { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
  function next() { if (!attempt) return; attempt.i++; startAttempt(); }
  function giveUp() {
    unload();
    var ch = attempt && attempt.ch;
    if (!ch) return;
    deadMap[ch.name] = Date.now(); save('dead', deadMap);           // hide it and move on to the next channel
    toast(ch.name + ' isn’t playing, skipped', 2500);
    tune(cur + (attempt.dir || 1));
  }
  video.addEventListener('playing', function () {
    clearTimeout(watchTm);
    if (attempt && deadMap[attempt.ch.name]) { delete deadMap[attempt.ch.name]; save('dead', deadMap); }
    setStatus(null); setState('● Live' + (video.videoHeight ? ' · ' + video.videoHeight + 'p' : ''), 'live');
  });
  video.addEventListener('resize', function () { if (!video.paused && video.videoHeight && /Live/.test($('b-state').textContent)) setState('● Live · ' + video.videoHeight + 'p', 'live'); });
  video.addEventListener('waiting', function () { if (attempt && video.readyState < 3) setStatus('Buffering…', false); });
  video.addEventListener('error', function () { if (video.getAttribute('src') && !hls) next(); });
  addEventListener('pagehide', unload);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) unload();                       // in the background: give the decoder back
    else if (cur >= 0) tune(cur);
  });

  // ---------- clock: always Philippine time (Asia/Manila, UTC+8) ----------
  var manilaFmt = null;
  try { manilaFmt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }); } catch (e) {}
  function manilaTime(d) {
    d = d || new Date();
    if (manilaFmt) return manilaFmt.format(d);
    var m = new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000), h = m.getHours();   // fallback: UTC+8, no DST
    return ((h + 11) % 12 + 1) + ':' + ('0' + m.getMinutes()).slice(-2) + (h < 12 ? ' AM' : ' PM');
  }
  function tickClock() { var c = $('b-clock'); if (c) c.innerHTML = manilaTime() + '<small>Manila</small>'; }
  setInterval(tickClock, 15000); tickClock();

  // ---------- programme guide ----------
  // guide/guide.json is rebuilt every day on GitHub (tools/build_guide.py) from public XMLTV listings, keyed by the
  // same channel-name key the app uses (normKey); times are UTC seconds, shown here in Philippine time.
  var GUIDE_URL = 'https://raw.githubusercontent.com/aningako/iptv-webos/main/guide/guide.json';
  var epg = {};
  function loadGuide() {
    fetchText(GUIDE_URL + '?t=' + Math.floor(Date.now() / 3600e3), 60000).then(function (t) {
      epg = (JSON.parse(t).channels) || {};
      if (!$('banner').classList.contains('hidden')) showEpg();
      if (!$('guide').classList.contains('hidden')) renderGuide();
    }).catch(function () {});
  }
  function nowNext(ch) {
    var p = ch && (epg[normKey(ch.name)] || ch.sources.map(function (s) { return epg[normKey(s.label)]; }).filter(Boolean)[0]);
    if (!p) return null;
    var t = Date.now() / 1000, now = null, next = null;
    for (var i = 0; i < p.length; i++) {
      if (p[i][0] <= t && t < p[i][1]) { now = p[i]; next = p[i + 1] || null; break; }
      if (p[i][0] > t) { next = p[i]; break; }
    }
    return (now || next) ? { now: now, next: next } : null;
  }
  function span(p) { return manilaTime(new Date(p[0] * 1000)) + ' – ' + manilaTime(new Date(p[1] * 1000)); }
  function pct(p) { var t = Date.now() / 1000; return Math.max(0, Math.min(100, (t - p[0]) / (p[1] - p[0]) * 100)); }
  function showEpg() {
    var nn = nowNext(channels[cur]), box = $('b-epg');
    if (!nn) return box.classList.add('hidden');
    $('e-now-tm').textContent = nn.now ? 'NOW ' + span(nn.now) : '';
    $('e-now').textContent = nn.now ? nn.now[2] : '';
    $('e-bar').style.width = (nn.now ? pct(nn.now) : 0) + '%';
    $('e-next-tm').textContent = nn.next ? 'NEXT ' + manilaTime(new Date(nn.next[0] * 1000)) : '';
    $('e-next').textContent = nn.next ? nn.next[2] : '';
    box.classList.remove('hidden');
  }
  var gg = 0, gf = 0, GROWS = 7;
  function openGuide() {
    closeList(); groups = groupList(); if (gg >= groups.length) gg = 0;
    var items = guideItems(), i = items.indexOf(channels[cur]); gf = i >= 0 ? i : 0;
    $('banner').classList.add('hidden'); $('guide').classList.remove('hidden'); renderGuide();
    if (!Object.keys(epg).length) loadGuide();
  }
  function closeGuide() { $('guide').classList.add('hidden'); }
  function guideItems() {
    var g = groups[gg] || 'All channels', ok = channels.filter(shownCh);
    if (g === 'All channels') return ok;
    if (g === '★ Favorites') return ok.filter(isFav);
    return ok.filter(function (ch) { return ch.groups.indexOf(g) >= 0; });
  }
  function renderGuide() {
    var items = guideItems();
    $('g-group').textContent = 'Guide · ' + groups[gg] + ' (' + items.length + ')';
    $('g-clock').innerHTML = manilaTime() + '<small>Manila</small>';
    if (gf >= items.length) gf = Math.max(0, items.length - 1);
    var first = Math.max(0, Math.min(gf - 2, items.length - GROWS)), html = '';
    for (var i = first; i < Math.min(items.length, first + GROWS); i++) {
      var ch = items[i], nn = nowNext(ch);
      html += '<div class="grow' + (i === gf ? ' focus' : '') + (ch === channels[cur] ? ' cur' : '') + '" data-i="' + i + '">' +
        '<div class="ch"><span class="n">' + ch.num + '</span><span class="lg">' + logoHtml(ch) + '</span><span class="nm">' + esc(ch.name) + '</span></div>' +
        (nn && nn.now ? '<div class="pt"><small>' + span(nn.now) + '</small>' + esc(nn.now[2]) + '<div class="pbar"><i style="width:' + pct(nn.now) + '%"></i></div></div>'
          : '<div class="pt none">' + (nn ? 'Off air' : 'No guide information') + '</div>') +
        (nn && nn.next ? '<div class="pn"><small>' + manilaTime(new Date(nn.next[0] * 1000)) + '</small>' + esc(nn.next[2]) + '</div>' : '<div class="pn"></div>') + '</div>';
    }
    $('g-items').innerHTML = html || '<div class="grow"><span class="none">No channels here.</span></div>';
    [].forEach.call($('g-items').querySelectorAll('.grow[data-i]'), function (el) {
      el.onclick = function () { gf = +el.getAttribute('data-i'); guideKey(K.OK); };
      el.onmousemove = function () { var i = +el.getAttribute('data-i'); if (i !== gf) { gf = i; renderGuide(); } };
    });
  }
  function guideKey(k) {
    var items = guideItems(), n = Math.max(1, items.length);
    if (k === K.UP) { gf = (gf - 1 + n) % n; renderGuide(); }
    else if (k === K.DOWN) { gf = (gf + 1) % n; renderGuide(); }
    else if (k === K.CH_UP || k === K.CH_UP2) { gf = Math.max(0, gf - GROWS); renderGuide(); }
    else if (k === K.CH_DOWN || k === K.CH_DOWN2) { gf = Math.min(items.length - 1, gf + GROWS); renderGuide(); }
    else if (k === K.LEFT || k === K.RIGHT) { gg = (gg + (k === K.RIGHT ? 1 : -1) + groups.length) % groups.length; gf = 0; renderGuide(); }
    else if (k === K.OK) { var ch = items[gf]; if (ch) { closeGuide(); tune(channels.indexOf(ch)); } }
    else if (k === K.BACK || k === K.ESC || k === K.RED || k === K.GUIDE) closeGuide();
    else return false;
    return true;
  }
  setInterval(function () { if (!$('guide').classList.contains('hidden')) renderGuide(); if (!$('banner').classList.contains('hidden')) showEpg(); }, 30000);
  setInterval(loadGuide, 3 * 3600e3);

  // ---------- on-screen info ----------
  function setStatus(text, error) {
    var st = $('status');
    if (!text) return st.classList.add('hidden');
    $('status-text').innerText = text;
    st.classList.toggle('error', !!error); st.classList.remove('hidden');
  }
  function setState(text, cls) { var s = $('b-state'); s.textContent = text; s.className = cls || ''; }
  var bannerTm;
  function showBanner() {
    var ch = channels[cur]; if (!ch) return;
    $('b-num').textContent = ch.num; $('b-name').textContent = ch.name;
    $('b-group').textContent = ch.groups.join(' · ');
    $('b-fav').classList.toggle('hidden', !isFav(ch));
    var box = document.querySelector('#banner .logo'); box.innerHTML = logoHtml(ch);
    tickClock(); showEpg();
    $('banner').classList.remove('hidden');
    clearTimeout(bannerTm); bannerTm = setTimeout(function () { $('banner').classList.add('hidden'); }, 6000);
  }

  // ---------- channel list ----------
  var lg = 0, lf = 0;   // list group, focused row
  function shown() {
    var g = groups[lg] || 'All channels', ok = channels.filter(shownCh);
    if (g === 'All channels') return ok;
    if (g === '★ Favorites') return ok.filter(isFav);
    return ok.filter(function (ch) { return ch.groups.indexOf(g) >= 0; });
  }
  function openList() {
    groups = groupList(); if (lg >= groups.length) lg = 0;
    var items = shown(), i = items.indexOf(channels[cur]);
    lf = i >= 0 ? i : 0;
    $('list').classList.remove('hidden'); $('banner').classList.add('hidden');
    renderList(true);
  }
  function closeList() { $('list').classList.add('hidden'); }
  // Logos: no Referer (imgur refuses hotlinked images that carry one), initials when a logo can't load.
  function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0); }).join('').toUpperCase(); }
  function logoHtml(ch) {
    return ch.logo ? '<img referrerpolicy="no-referrer" src="' + esc(ch.logo) + '" data-ini="' + esc(initials(ch.name)) + '">' : '<b>' + esc(initials(ch.name)) + '</b>';
  }
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.getAttribute('data-ini') != null) { var b = document.createElement('b'); b.textContent = t.getAttribute('data-ini'); t.replaceWith(b); }
  }, true);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  var ROW = 100, VISIBLE = 8;
  function renderList() {
    var items = shown();
    $('l-group').textContent = groups[lg] + ' (' + items.length + ')';
    if (lf >= items.length) lf = Math.max(0, items.length - 1);
    var first = Math.max(0, Math.min(lf - 3, items.length - VISIBLE));
    var html = '';
    for (var i = first; i < Math.min(items.length, first + VISIBLE); i++) {
      var ch = items[i];
      html += '<div class="item' + (i === lf ? ' focus' : '') + (ch === channels[cur] ? ' cur' : '') + '" data-i="' + i + '">' +
        '<span class="n">' + ch.num + '</span><span class="lg">' + logoHtml(ch) + '</span>' +
        '<span class="t">' + esc(ch.name) + '</span>' + (isFav(ch) ? '<span class="s">★</span>' : '') + '</div>';
    }
    if (!items.length) html = '<div class="item"><span class="t">No channels here yet. Yellow adds a favorite.</span></div>';
    $('l-items').innerHTML = html;
    [].forEach.call($('l-items').querySelectorAll('.item[data-i]'), function (el) {
      el.onclick = function () { lf = +el.getAttribute('data-i'); listKey(K.OK); };
      el.onmousemove = function () { var i = +el.getAttribute('data-i'); if (i !== lf) { lf = i; renderList(); } };
    });
  }
  function listKey(k) {
    var items = shown();
    if (k === K.UP) { lf = (lf - 1 + items.length) % Math.max(1, items.length); renderList(); }
    else if (k === K.DOWN) { lf = (lf + 1) % Math.max(1, items.length); renderList(); }
    else if (k === K.CH_UP || k === K.CH_UP2) { lf = Math.max(0, lf - VISIBLE); renderList(); }
    else if (k === K.CH_DOWN || k === K.CH_DOWN2) { lf = Math.min(items.length - 1, lf + VISIBLE); renderList(); }
    else if (k === K.LEFT || k === K.RIGHT) { lg = (lg + (k === K.RIGHT ? 1 : -1) + groups.length) % groups.length; lf = 0; renderList(); }
    else if (k === K.OK) { var ch = items[lf]; if (ch) { closeList(); tune(channels.indexOf(ch)); } }
    else if (k === K.YELLOW) { var c2 = items[lf]; if (c2) toggleFav(c2); groups = groupList(); renderList(); }
    else if (k === K.BACK || k === K.ESC || k === K.GREEN) closeList();
    else return false;
    return true;
  }
  function toggleFav(ch) {
    var i = favs.indexOf(ch.name);
    if (i >= 0) favs.splice(i, 1); else favs.push(ch.name);
    save('favs', favs);
    toast(i >= 0 ? 'Removed from favorites' : '★ Added to favorites');
    if (ch === channels[cur]) $('b-fav').classList.toggle('hidden', !isFav(ch));
  }

  // ---------- number keys ----------
  var numBuf = '', numTm;
  function numKey(d) {
    numBuf = (numBuf + d).slice(-3);
    var n = $('numentry'); n.textContent = numBuf; n.classList.remove('hidden');
    clearTimeout(numTm);
    numTm = setTimeout(function () {
      n.classList.add('hidden');
      var num = parseInt(numBuf, 10); numBuf = '';
      var ch = channels.filter(function (c) { return c.num === num && shownCh(c); })[0];
      if (ch) tune(channels.indexOf(ch)); else toast('No channel ' + num);
    }, 1400);
  }

  // ---------- settings ----------
  var sFocus = null;
  function openSettings() {
    closeList();
    $('s-url').value = load('playlistUrl', '') || '';
    scanLabel(); if (!scanning) scanStatus(found.length ? found.length + ' scanned channel' + (found.length === 1 ? '' : 's') + ' in your list.' : '');
    $('settings').classList.remove('hidden');
    focusS($('s-save'));
  }
  function closeSettings() { $('settings').classList.add('hidden'); if (document.activeElement) document.activeElement.blur(); }
  function focusS(el) { if (sFocus) sFocus.classList.remove('focus'); sFocus = el; el.classList.add('focus'); el.focus(); }
  // Remote navigation for a dialog: controls are grouped into rows by data-row; hidden ones are skipped.
  function dialogKey(box, k, close) {
    var byRow = {};
    [].forEach.call(box.querySelectorAll('.f'), function (el) {
      if (el.offsetParent === null) return;
      var r = +el.getAttribute('data-row'); (byRow[r] = byRow[r] || []).push(el);
    });
    var rows = Object.keys(byRow).sort(function (a, b) { return a - b; }).map(function (r) { return byRow[r]; });
    var r = 0, c = 0;
    rows.forEach(function (row, ri) { var ci = row.indexOf(sFocus); if (ci >= 0) { r = ri; c = ci; } });
    var inText = sFocus.tagName === 'INPUT';
    if (k === K.BACK || k === K.ESC) { close(); return true; }
    if (k === K.UP) { if (r > 0) focusS(rows[r - 1][Math.min(c, rows[r - 1].length - 1)]); return true; }
    if (k === K.DOWN) { if (r < rows.length - 1) focusS(rows[r + 1][Math.min(c, rows[r + 1].length - 1)]); return true; }
    if (!inText && (k === K.LEFT || k === K.RIGHT)) { var row = rows[r]; focusS(row[Math.max(0, Math.min(row.length - 1, c + (k === K.RIGHT ? 1 : -1)))]); return true; }
    if (k === K.OK) {
      if (inText) { if (rows[r + 1]) focusS(rows[r + 1][0]); return true; }
      sFocus.click(); return true;
    }
    return false;
  }
  $('s-save').onclick = function () {
    var u = $('s-url').value.trim();
    save('playlistUrl', u);
    closeSettings(); loadPlaylist(true);
  };
  $('s-builtin').onclick = function () { save('playlistUrl', ''); closeSettings(); loadPlaylist(true); };
  $('s-close').onclick = closeSettings;

  // ---------- scan for new English channels (Settings) ----------
  // Looks through iptv-org's public list of English-language channels and keeps only streams that
  //  - come from established free-TV platforms (no bare IP addresses, no restream sites, no faked location/identity),
  //  - answer from this TV right now, and offer 1080p.
  // Found channels are saved on the TV and added to the list (group from the playlist, e.g. Movies, News).
  var SCAN_LISTS = ['https://iptv-org.github.io/iptv/languages/eng.m3u'];
  // iptv-org's feed database: the broadcast language of every channel feed (tvg-id "Channel.us@Feed")
  var SCAN_FEEDS = 'https://iptv-org.github.io/api/feeds.json';
  var NOT_ENGLISH_NAME = /espa[nñ]ol|latino|latin america|brasil|brazil|portugu|fran[cç]ais|deutsch|arab|hindi|tamil|telugu|bangla|urdu|turk|korea|japan|chinese|mandarin|cantonese|italia|polska|poland|russia|cine |canal |tele |tv5|amor\b|\bfm\b/i;
  var SCAN_TRUST = /^https:\/\/([a-z0-9-]+\.)*(amagi\.tv|wurl\.tv|wurl\.com|cloudfront\.net|akamaized\.net|edgesuite\.net|roku\.com|bloomberg\.com|getaj\.net|cbsnstream\.cbsnews\.com|samsungtvplus\.com|xumo\.com|tubi\.video|plex\.tv)\//i;
  var SCAN_BLOCK = /jmp2\.uk|aynaott|antik\.sk|freem3u|smartplaytv|ioapk|\.shop\/|\.xyz\/|\.top\/|github/i;
  // already removed because they don't play here (checked on the TV)
  var SCAN_BAD = ['Animax Asia India', 'CLTV 36', 'DUST', 'CBS News Los Angeles', 'CBS News New York'];
  // paid networks: only ever restreamed without permission, whatever server they come from
  var SCAN_PAID = /^(cnn international|cnn$|cnn hd|fox news channel|fox news$|bbc news|bbc world|hbo|cinemax|star movies|axn|animax|bein sports \d|sky sports|sky news$|showtime|starz|disney channel|cartoon network|nickelodeon|discovery channel|national geographic)/i;
  var badKeys = {}; SCAN_BAD.forEach(function (n) { badKeys[normKey(n)] = 1; });
  var found = load('found', []).filter(function (f) { return f.v === 2 && !SCAN_PAID.test(f.name) && !badKeys[normKey(f.name)]; }), scanning = null;
  save('found', found);
  function scanLabel() {
    $('s-scan').textContent = scanning ? 'Stop scanning' : 'Scan for new English channels';
    $('s-unscan').classList.toggle('hidden', !found.length || !!scanning);
    $('s-unscan').textContent = 'Remove scanned channels (' + found.length + ')';
  }
  function scanStatus(t) { $('scan-status').textContent = t || ''; }
  // English only: every language listed for the channel's feed must be English (feeds without a language are skipped)
  function englishFeeds(feeds) {
    var map = {};
    (feeds || []).forEach(function (f) { if (f && f.channel) map[f.channel + '@' + f.id] = f.languages || []; if (f && f.channel && f.is_main) map[f.channel] = f.languages || []; });
    return function (tvgId) {
      if (!tvgId) return false;
      var langs = map[tvgId] || map[tvgId.split('@')[0]];
      return !!(langs && langs.length && langs.every(function (l) { return l === 'eng'; }));
    };
  }
  function has1080(text) { return (text.match(/RESOLUTION=\d+x(\d+)/g) || []).some(function (r) { return +r.split('x')[1] >= 1080; }); }
  function fetchText(url, ms) {
    var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (t) { clearTimeout(tm); return t; }, function (e) { clearTimeout(tm); throw e; });
  }
  function startScan() {
    if (scanning) { scanning.stop = true; return; }
    var job = scanning = { stop: false }, have = {};
    channels.forEach(function (ch) { have[normKey(ch.name)] = 1; });
    found.forEach(function (f) { have[normKey(f.name)] = 1; });
    SCAN_BAD.forEach(function (n) { have[normKey(n)] = 1; });
    scanLabel(); scanStatus('Downloading the channel list…');
    var isEnglish = null;
    fetchText(SCAN_FEEDS, 60000).then(function (t) { isEnglish = englishFeeds(JSON.parse(t)); }, function () {}).then(function () {
      if (!isEnglish) throw new Error('feeds');
      scanStatus('Downloading the channel list…');
      return Promise.all(SCAN_LISTS.map(function (u) { return fetchText(u, 30000).then(parseM3U, function () { return []; }); }));
    }).then(function (lists) {
      var seen = {}, cands = [], notEn = 0;
      [].concat.apply([], lists).forEach(function (e) {
        if (!isEnglish(e.id) || NOT_ENGLISH_NAME.test(e.name)) { notEn++; return; }   // not an English channel
        var key = normKey(e.name);
        if (have[key] || seen[key] || e.ua || !SCAN_TRUST.test(e.url) || SCAN_BLOCK.test(e.url) || SCAN_PAID.test(e.name)) return;
        if (/geo-blocked|not 24\/7/i.test(e.name) || !/^[\x20-\x7e]+$/.test(e.name)) return;   // blocked/part-time or not Latin-script
        seen[key] = 1; cands.push(e);
      });
      var i = 0, done = 0, added = 0, total = cands.length;
      if (!total) { scanning = null; scanLabel(); return scanStatus('No new channels to check right now.'); }
      function worker() {
        if (job.stop || i >= total) return Promise.resolve();
        var e = cands[i++];
        return fetchText(e.url, 6000).then(function (t) {
          if (t.indexOf('#EXTM3U') >= 0 && has1080(t)) {
            found.push({ name: baseName(e.name), logo: e.logo, group: (e.group || 'Other').split(';')[0], url: e.url, id: e.id, v: 2 });
            save('found', found); added++;
          }
        }).catch(function () {}).then(function () {
          done++; scanStatus('Checking ' + done + ' of ' + total + ' · found ' + added + ' new 1080p channel' + (added === 1 ? '' : 's'));
          return worker();
        });
      }
      return Promise.all([worker(), worker(), worker(), worker()]).then(function () {
        scanning = null; scanLabel();
        scanStatus((job.stop ? 'Stopped. ' : 'Done. ') + 'Added ' + added + ' channel' + (added === 1 ? '' : 's') + (added ? ' (at the end of the list).' : '.'));
        if (added) reloadKeep();
      });
    }).catch(function () { scanning = null; scanLabel(); scanStatus('Couldn’t download the channel lists. Check the internet connection.'); });
  }
  $('s-scan').onclick = startScan;
  $('s-reload').onclick = function () { closeSettings(); loadPlaylist(true); loadGuide(); };
  $('s-unscan').onclick = function () { found = []; save('found', found); scanLabel(); scanStatus('Scanned channels removed.'); reloadKeep(); };
  function reloadKeep() { var keep = channels[cur] && channels[cur].name; loadPlaylist(false, keep); }

  // ---------- keys ----------
  var backAt = 0;
  function exitApp() {
    unload();
    try { window.close(); } catch (e) {}
    setTimeout(function () {
      try { if (window.webOSSystem && webOSSystem.platformBack) return webOSSystem.platformBack(); } catch (e) {}
      try { if (window.PalmSystem && PalmSystem.platformBack) PalmSystem.platformBack(); } catch (e) {}
    }, 300);
  }
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, used = true;
    if (!$('settings').classList.contains('hidden')) { used = dialogKey($('settings'), k, closeSettings); }
    else if (!$('guide').classList.contains('hidden')) { used = guideKey(k); }
    else if (!$('list').classList.contains('hidden')) { used = listKey(k); }
    else if (k >= 48 && k <= 57) numKey(String(k - 48));
    else if (k === K.UP || k === K.CH_UP || k === K.CH_UP2) tune(cur + 1);
    else if (k === K.DOWN || k === K.CH_DOWN || k === K.CH_DOWN2) tune(cur - 1);
    else if (k === K.OK) openList();
    else if (k === K.LEFT || k === K.GREEN) openList();
    else if (k === K.RIGHT || k === K.INFO) showBanner();
    else if (k === K.YELLOW) { if (channels[cur]) toggleFav(channels[cur]); }
    else if (k === K.BLUE) openSettings();
    else if (k === K.RED || k === K.GUIDE) openGuide();
    else if (k === K.BACK || k === K.ESC) {
      if (!$('banner').classList.contains('hidden')) { $('banner').classList.add('hidden'); }
      if (Date.now() - backAt < 2000) return exitApp();
      backAt = Date.now(); toast('Press Back again to exit', 2000);
    } else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('webOSRelaunch', function () { try { PalmSystem.activate(); } catch (e) {} });

  // ---------- start ----------
  function useEntries(entries, from) {
    channels = buildChannels(entries.concat(found.map(function (f) { return { name: f.name, logo: f.logo, group: f.group, url: f.url, ua: '' }; })));
    if (!channels.length) { setStatus('The playlist has no channels.\nBlue opens Settings.', true); return; }
    var last = load('last', null), i = 0;
    i = Math.max(0, channels.findIndex(shownCh));
    channels.forEach(function (ch, j) { if (ch.name === last && shownCh(ch)) i = j; });
    toast(channels.length + ' channels' + (from ? ' from ' + from : ''), 2500);
    tune(i);
  }
  function loadPlaylist(announce, keep) {
    if (keep) save('last', keep);
    var url = load('playlistUrl', '');
    if (!url) return useEntries(parseM3U(window.BUILTIN_M3U), announce ? 'the built-in list' : '');
    setStatus('Loading playlist…', false);
    fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(function (t) {
      var entries = parseM3U(t);
      if (!entries.length) throw new Error('no channels in it');
      useEntries(entries, 'your playlist');
    }).catch(function (e) {
      toast('Couldn’t load the playlist (' + e.message + '). Using the built-in channels.', 4000);
      useEntries(parseM3U(window.BUILTIN_M3U), '');
    });
  }
  try { $('ver').textContent = JSON.parse(window.PalmSystem && PalmSystem.appInfo || '{}').version || '1.0.0'; } catch (e) { $('ver').textContent = '1.0.0'; }
  window.__iptv = { get channels() { return channels; }, get cur() { return cur; }, get attempt() { return attempt; } };   // (tests)
  loadPlaylist(false);
  loadGuide();
})();

#!/usr/bin/env python3
"""Build guide/guide.json: the next hours of programmes for the app's channels, small enough for the TV.

Run daily by .github/workflows/guide.yml. The TV downloads the result from GitHub; times are UTC epoch seconds,
the app shows them in Philippine time.

Sources (public XMLTV): epgshare01 (all sources), i.mjh.nz Samsung TV Plus and Plex.
Channels are matched by name, the same way the app merges channels (normKey).
"""
import gzip, io, json, os, re, sys, time, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'guide', 'guide.json')
SOURCES = [
    'https://i.mjh.nz/SamsungTVPlus/all.xml.gz',
    'https://i.mjh.nz/Plex/all.xml.gz',
    'https://epgshare01.online/epgshare01/epg_ripper_ALL_SOURCES1.xml.gz',
]
CHANNEL_LISTS = [os.path.join(ROOT, 'app', 'com.homebrew.iptv', 'channels.m3u'),
                 'https://iptv-org.github.io/iptv/languages/eng.m3u']   # built-in + what the scan can add
BEFORE, AFTER, PER_CHANNEL = 3600, 20 * 3600, 160   # window decides; the cap only guards against junk
UA = {'User-Agent': 'Mozilla/5.0 (IPTV Player guide builder)'}


def norm_key(n):
    k = re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', ' ', n.lower())
    for _ in range(3):
        k = re.sub(r'\s+(uk|us|usa|au|ca|nz|east|west|world|international|hd|sd|fhd|uhd|tv|channel|network)\s*$', '', k)
    return re.sub(r'[^a-z0-9]+', '', k)


def wanted():
    # The app looks up the guide by norm_key(channel name), so programmes are stored under that app key.
    # But the same name (e.g. "AMC Thrillers") exists on several providers with different schedules, so we
    # also keep each channel's tvg-id (iptv-org id, e.g. AMCThrillers.us) and match the EPG by that exact id
    # first - it points at the feed the stream actually plays - falling back to the name only when no id matches.
    id_to_key = {}   # exact XMLTV channel id  -> app key (norm_key of the name)
    keys = set()     # app keys, for the name fallback
    for src in CHANNEL_LISTS:
        try:
            text = open(src, encoding='utf-8').read() if os.path.exists(src) else \
                urllib.request.urlopen(urllib.request.Request(src, headers=UA), timeout=60).read().decode('utf-8', 'replace')
        except Exception as e:
            print('channel list failed:', src, e); continue
        for line in text.splitlines():
            if not line.startswith('#EXTINF'):
                continue
            key = norm_key(line.rsplit(',', 1)[-1].strip())
            if not key:
                continue
            keys.add(key)
            m = re.search(r'tvg-id="([^"]*)"', line)
            tvg = (m.group(1).split('@')[0].strip() if m else '')   # "AMCThrillers.us@SD" -> "AMCThrillers.us"
            if tvg:
                id_to_key.setdefault(tvg, key)
    keys.discard('')
    return id_to_key, keys


def xmltv_time(s):
    # 20261121143000 +0800
    m = re.match(r'(\d{14})\s*([+-]\d{2}:?\d{2})?', s or '')
    if not m:
        return None
    d = m.group(1)
    try:
        secs = _timegm((int(d[0:4]), int(d[4:6]), int(d[6:8]), int(d[8:10]), int(d[10:12]), int(d[12:14]), 0, 0, 0))
    except Exception:
        return None                                   # malformed time: skip that programme
    off = (m.group(2) or '+0000').replace(':', '')
    sign = 1 if off[0] == '+' else -1
    return secs - sign * (int(off[1:3]) * 3600 + int(off[3:5]) * 60)


def _timegm(t):
    import calendar
    return calendar.timegm(t)


def read_source(url, id_to_key, keys, guide, guide_q, now):
    print('reading', url)
    raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600)
    stream = gzip.GzipFile(fileobj=raw) if url.endswith('.gz') else raw
    PRIO = ['ph', 'us', 'uk', 'sg', 'au', 'ca', 'nz', 'ie', 'my', 'in']   # prefer listings from these countries
    def prio(cid):
        cc = (cid or '').rsplit('.', 1)[-1].lower()
        return PRIO.index(cc) if cc in PRIO else len(PRIO)
    id2key, cand, progs, root = {}, {}, {}, None   # cand[app_key] = list of (channel id, quality) in this source
    try:
      for ev, el in ET.iterparse(stream, events=('start', 'end')):
        if ev == 'start':
            if root is None: root = el
            continue
        if el.tag == 'channel':
            cid = el.get('id')
            ak = q = None
            if cid in id_to_key:                              # exact tvg-id match: the right feed
                ak, q = id_to_key[cid], 'id'
            else:
                for dn in el.findall('display-name'):         # fall back to matching the name
                    k = norm_key(dn.text or '')
                    if k in keys: ak, q = k, 'name'; break
            if ak:
                id2key[cid] = ak; cand.setdefault(ak, []).append((cid, q))
            el.clear()
        elif el.tag == 'programme':
            cid = el.get('channel')
            if cid in id2key:
                start, stop = xmltv_time(el.get('start')), xmltv_time(el.get('stop'))
                if start and stop and stop > now - BEFORE and start < now + AFTER:
                    title = (el.findtext('title') or '').strip()
                    if title:
                        progs.setdefault(cid, []).append([start, stop, title[:80]])
            el.clear()
            root.clear()                                      # keep memory flat on a 1.9 GB stream
    except (ET.ParseError, EOFError, OSError) as e:           # cut-off or broken file: keep what was read
        print('  stopped early (%s); keeping what was read' % e)
    chans = added = 0
    for k, lst in cand.items():
        # best candidate for this channel: an id match beats a name match, then the preferred country
        lst.sort(key=lambda t: (0 if t[1] == 'id' else 1, prio(t[0])))
        for cid, q in lst:
            if len(progs.get(cid, [])) < 2:
                continue
            # keep the best we've seen across sources: first by-id wins; a by-id upgrades an earlier by-name
            if k in guide_q and not (q == 'id' and guide_q[k] == 'name'):
                break
            out, last = [], 0
            for p in sorted(progs[cid]):                      # drop overlapping/duplicate entries
                if p[0] >= last - 60:
                    out.append(p); last = p[1]
            guide[k] = out[:PER_CHANNEL]; guide_q[k] = q
            chans += 1; added += len(out)
            break
    print('  channels matched: %d, programmes kept: %d' % (chans, added))


def main():
    now = int(time.time())
    id_to_key, keys = wanted()
    print('channel names to match:', len(keys), '| tvg-ids:', len(id_to_key))
    guide, guide_q = {}, {}
    for url in SOURCES:
        try:
            read_source(url, id_to_key, keys, guide, guide_q, now)
        except Exception as e:
            print('  source failed:', e)
    fresh = len(guide)
    if not fresh:
        sys.exit('no listings from any source; keeping the previous guide')
    # channels this run couldn't refresh keep their still-valid listings from the previous guide
    try:
        old = json.load(open(OUT)).get('channels', {})
        kept = 0
        for k, progs in old.items():
            if k not in guide:
                left = [p for p in progs if p[1] > now]
                if left: guide[k] = left; kept += 1
        print('carried over from the previous guide: %d channels' % kept)
    except Exception:
        pass
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'generated': now, 'channels': guide}, f, separators=(',', ':'), ensure_ascii=False)
    print('wrote %s: %d channels, %.1f KB' % (OUT, len(guide), os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    if len(sys.argv) > 1:          # local test: use downloaded files instead of URLs
        SOURCES = sys.argv[1:]
    main()

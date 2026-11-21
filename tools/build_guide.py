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
BEFORE, AFTER, PER_CHANNEL = 3600, 20 * 3600, 40
UA = {'User-Agent': 'Mozilla/5.0 (IPTV Player guide builder)'}


def norm_key(n):
    k = re.sub(r'\s*[\(\[][^\)\]]*[\)\]]', ' ', n.lower())
    for _ in range(3):
        k = re.sub(r'\s+(uk|us|usa|au|ca|nz|east|west|world|international|hd|sd|fhd|uhd|tv|channel|network)\s*$', '', k)
    return re.sub(r'[^a-z0-9]+', '', k)


def wanted_keys():
    keys = set()
    for src in CHANNEL_LISTS:
        try:
            text = open(src, encoding='utf-8').read() if os.path.exists(src) else \
                urllib.request.urlopen(urllib.request.Request(src, headers=UA), timeout=60).read().decode('utf-8', 'replace')
        except Exception as e:
            print('channel list failed:', src, e); continue
        for line in text.splitlines():
            if line.startswith('#EXTINF'):
                keys.add(norm_key(line.rsplit(',', 1)[-1].strip()))
    keys.discard('')
    return keys


def xmltv_time(s):
    # 20261121143000 +0800
    m = re.match(r'(\d{14})\s*([+-]\d{4})?', s or '')
    if not m:
        return None
    d = m.group(1)
    try:
        secs = _timegm((int(d[0:4]), int(d[4:6]), int(d[6:8]), int(d[8:10]), int(d[10:12]), int(d[12:14]), 0, 0, 0))
    except Exception:
        return None                                   # malformed time: skip that programme
    off = m.group(2) or '+0000'
    sign = 1 if off[0] == '+' else -1
    return secs - sign * (int(off[1:3]) * 3600 + int(off[3:5]) * 60)


def _timegm(t):
    import calendar
    return calendar.timegm(t)


def read_source(url, keys, guide, now):
    print('reading', url)
    raw = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600)
    stream = gzip.GzipFile(fileobj=raw) if url.endswith('.gz') else raw
    id2key, added, chans, taken = {}, 0, 0, set()
    for ev, el in ET.iterparse(stream, events=('end',)):
        if el.tag == 'channel':
            for dn in el.findall('display-name'):
                k = norm_key(dn.text or '')
                if k in keys and k not in guide and k not in taken:   # first source (and first feed) with that name wins
                    id2key[el.get('id')] = k; taken.add(k); chans += 1; break
            el.clear()
        elif el.tag == 'programme':
            k = id2key.get(el.get('channel'))
            if k:
                start, stop = xmltv_time(el.get('start')), xmltv_time(el.get('stop'))
                if start and stop and stop > now - BEFORE and start < now + AFTER:
                    title = (el.findtext('title') or '').strip()
                    if title:
                        guide.setdefault('_new_' + k, []).append([start, stop, title[:80]])
                        added += 1
            el.clear()
    for k in list(guide):
        if k.startswith('_new_'):
            progs, last = [], 0
            for p in sorted(guide.pop(k)):                # drop overlapping/duplicate entries
                if p[0] >= last - 60:
                    progs.append(p); last = p[1]
            guide[k[5:]] = progs[:PER_CHANNEL]
    print('  channels matched: %d, programmes kept: %d' % (chans, added))


def main():
    now = int(time.time())
    keys = wanted_keys()
    print('channel names to match:', len(keys))
    guide = {}
    for url in SOURCES:
        try:
            read_source(url, keys, guide, now)
        except Exception as e:
            print('  source failed:', e)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'generated': now, 'channels': guide}, f, separators=(',', ':'), ensure_ascii=False)
    print('wrote %s: %d channels, %.1f KB' % (OUT, len(guide), os.path.getsize(OUT) / 1024))


if __name__ == '__main__':
    if len(sys.argv) > 1:          # local test: use downloaded files instead of URLs
        SOURCES = sys.argv[1:]
    main()

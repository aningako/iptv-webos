#!/usr/bin/env python3
"""Generate the Homebrew Channel repository files in repo/ for the current version.

  python3 scripts/build_ipk.py   # builds releases/com.homebrew.iptv_<version>_all.ipk
  python3 scripts/make_repo.py   # writes repo/apps.json and repo/manifest.json for that IPK

The IPK is downloaded from the GitHub Release v<version>, so publish that release (with the IPK attached)
together with the commit that updates repo/. Users add this repository in Homebrew Channel:
  Settings -> Add repository -> https://raw.githubusercontent.com/aningako/iptv-webos/main/repo/apps.json

Created by aning and Cipher Amir with Claude. MIT license.
"""
import hashlib, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GH = 'aningako/iptv-webos'
RAW = 'https://raw.githubusercontent.com/%s/main' % GH

info = json.load(open(os.path.join(ROOT, 'app', 'com.homebrew.iptv', 'appinfo.json')))
app_id, version = info['id'], info['version']
ipk_name = '%s_%s_all.ipk' % (app_id, version)
data = open(os.path.join(ROOT, 'releases', ipk_name), 'rb').read()

description = ('IPTV player for LG webOS TVs: free Philippine, English movie and news channels in 1080p, channel list with '
               'categories and favorites, scan for new English channels, Philippine flag theme. Created by aning and Cipher Amir with Claude.')
manifest = {
    'id': app_id,
    'version': version,
    'type': 'web',
    'title': 'IPTV Player',
    'appDescription': description,
    'iconUri': RAW + '/app/com.homebrew.iptv/largeIcon.png',
    'sourceUrl': 'https://github.com/' + GH,
    'rootRequired': False,
    'ipkUrl': 'https://github.com/%s/releases/download/v%s/%s' % (GH, version, ipk_name),
    'ipkHash': {'sha256': hashlib.sha256(data).hexdigest()},
    'ipkSize': len(data),
}
index = {
    'paging': {'page': 1, 'count': 1, 'maxPage': 1, 'itemsTotal': 1},
    'packages': [{
        'id': app_id,
        'title': manifest['title'],
        'iconUri': manifest['iconUri'],
        'manifestUrl': RAW + '/repo/manifest.json',
        'manifest': manifest,
        'requirements': {'webosRelease': '>=5.0'},
        'shortDescription': description,
    }],
}
os.makedirs(os.path.join(ROOT, 'repo'), exist_ok=True)
for name, obj in (('manifest.json', manifest), ('apps.json', index)):
    with open(os.path.join(ROOT, 'repo', name), 'w') as f:
        json.dump(obj, f, indent=2); f.write('\n')
print('repo/ updated for %s %s (sha256 %s)' % (app_id, version, manifest['ipkHash']['sha256']))

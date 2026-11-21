<p align="center"><img src="docs/icon-512.png" width="128" alt="IPTV Player icon"></p>

# IPTV Player for webOS

An IPTV player for LG webOS TVs: full-screen live channels in 1080p, made for the Magic Remote, in the colours of the Philippine flag.

**Created by aning and Cipher Amir with Claude.**

## Channels

Built in (all free and legal, official streams only):
- **Philippines & regional**: Abante TV, Bilyonaryo News, CCTN 47, FilAmTV, Hope Channel, INC TV, INC Radio, InTravel,
  Living Asia, Mindanow, Premier Sports, TAP Sports, SMNI, Vegas Life TV, Retroclub…
- **English movies**: AMC Thrillers, Hallmark Movies & More, MovieSphere, MyTime Movie Network, Gravitas Movies,
  ARTFLIX Movie Classics, Maverick Black Cinema, The Movie Club, OuterSphere, Wu Tang Collection…
- **News**: Bloomberg TV / TV+ / Originals, CNN Originals, LiveNOW from FOX, Fox News Radio, NBC News NOW, ABC News Live,
  Al Jazeera English, CNA, DW, Reuters, CGTN, Scripps News, Newsmax, i24NEWS, WION, Arirang.

**Scan for new English channels** (Settings, Blue): checks iptv-org's public list of English channels from this TV and
adds the ones that broadcast in English (iptv-org's feed languages), play, and offer 1080p, from established free-TV platforms only. A full scan takes about 6 minutes
and usually finds a few hundred channels (movies, news, documentaries, sports, kids, music, cooking…).

Not included, on purpose: paid channels that only circulate as unauthorized restreams (CNN, Fox News Channel, BBC News,
HBO, AXN, beIN Sports 1-…), streams that fake a US location to get round regional licensing (Pluto TV through jmp2.uk),
and channels that don't play from the Philippines. Duplicates (e.g. four InTravel feeds) become **one channel with
backup sources**: if one fails, the next is tried.

## Programme guide

The banner shows **Now / Next** for the channel you're watching, and Red (or the remote's Guide button) opens the
guide for all channels, in Philippine time. Listings come from public XMLTV sources (Samsung TV Plus and Plex via
i.mjh.nz, epgshare01), squeezed into a small `guide/guide.json` by a GitHub Action twice a day
(`.github/workflows/guide.yml`, `tools/build_guide.py`). Most movie and news channels have listings; the local
Philippine channels don't publish any.

## Picture quality

The app reads each channel's quality list and starts straight on **1080p** (or the best the channel offers, some only
go to 720p); the banner shows the resolution. Nothing plays below **720p**: such streams are skipped (a backup source is
tried) and channels that only exist below 720p aren't included. A channel that doesn't play is **hidden** (list, ▲▼, numbers) and tried
again after a day, so the list only shows channels that work.

## Remote

| Button | |
|---|---|
| ▲ / ▼, CH+ / CH− | Next / previous channel |
| 0–9 | Type a channel number |
| OK, ◀, Green | Channel list (◀ ▶ switch category, OK watch) |
| ▶, Info | Channel info |
| Yellow | Add / remove favorite (★ Favorites category) |
| Blue | Settings (playlist URL, scan for new channels, reload) |
| Red, Guide | Programme guide (Now / Next for every channel, Philippine time) |
| Back twice | Exit |

The last channel you watched starts when you open the app.

## How playback works

- HLS plays in the TV's own player at the chosen quality; hls.js (locked to that quality) is the second try and is used
  when a channel's audio is in a separate stream.
- A stream with no picture after 15 seconds is unloaded (so it can't keep the TV's video decoders busy) and the next
  source is tried.
- The clock in the banner always shows Philippine time (Asia/Manila).

## Build

```sh
python3 scripts/import_playlist.py iptv-PH.m3u more-channels.m3u playlists/english-movies.m3u playlists/english-news.m3u
                                                           # built-in channels + bundled logos
python3 scripts/make_icons.py                              # only if you change the icon
python3 scripts/build_ipk.py                               # -> releases/com.homebrew.iptv_<version>_all.ipk
python3 tools/desktop_test.py --shots /tmp/iptv            # headless desktop test with the real streams
```

**Homebrew Channel**: Settings → Add repository → `https://raw.githubusercontent.com/aningako/iptv-webos/main/repo/apps.json`,
then install **IPTV Player**. Or install the `.ipk` from [Releases](https://github.com/aningako/iptv-webos/releases) with
webOS Dev Manager / `ares-install`.

Tested on an LG 50UR7550 (webOS 10.3.1, rooted); not yet tried on a non-rooted TV, though nothing in it uses root.

## Credits & licenses

Created by aning and Cipher Amir with Claude. App code: MIT. [hls.js](https://github.com/video-dev/hls.js) (Apache-2.0,
`app/com.homebrew.iptv/lib/hls.LICENSE`). Channel streams and logos belong to their broadcasters.

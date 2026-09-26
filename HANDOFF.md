# Project Handoff Document: Stash Path File Manager Plugin

**Current Version:** `v2.9.5`  
**Active Repository:** `https://github.com/daailouivan/stash-plugins.git` (`main` branch)  
**Distribution Package:** `stash_file_manager.zip` (SHA256: `d3ac8398882f2cbab2525c3f910da1d5ea1e4a68cfc36012d9d647d045dbd310`)  
**Plugin Manifest:** `stash_file_manager/stash_file_manager.yml` (version `2.9.5`)  
**Index Manifest:** `index.yml` (version `2.9.5`)  
**Total Release Tags:** `35` (`v1.0.0` through `v2.9.5`)  

---

## 1. Project Overview & Architecture

The **Stash Path File Manager (`stash_file_manager`)** is a community plugin for [Stash](https://github.com/stashapp/stash). It provides an in-app file explorer to browse, preview, batch-manage, and organize media files by hierarchical filesystem paths rather than database IDs.

### Key Architectural Components
1. **Frontend (`stash_file_manager/file_manager.js` & `file_manager.css`)**:
   - Integrates via Stash's native `window.PluginApi.patch` into the primary top navigation bar.
   - Folder grid/list/table views with custom card sizing sliders and sort controls.
   - **Binge Discover-Style Reel Player**: Full-viewport vertical video player modal supporting mouse-wheel / swipe gestures, custom timeline scrubber, and picture-in-picture (PiP).
   - Multi-slide sliding window (`OVERSCAN = 2`) maintaining preloaded video elements and unblurred posters for adjacent scenes (`-2`, `-1`, `+1`, `+2`) to eliminate buffering delays.
   - **Non-Repeating Shuffle Queue**: Fisher-Yates permutation anchor queue with right-rail circle toggle button (`S` hotkey) and auto-advancing `onEnded`.
   - **Folder Profile & Video Wall Page**: In-player directory profile view with social-media-style avatar, folder path, live metrics (video counts, size, duration, resolutions), and a responsive video wall grid.
   - **Instagram / TikTok Seamless Video Wall**: Flush 3-column video wall with zero border gaps, views/duration overlays, and Force Mobile View phone frame simulation.
   - **Elevated Button Surfaces & Persistent Indicators**: High-contrast button backgrounds (`#222938`) and indicators matching top total file counts pill style (`#242933` with `#4c566a` border and `#eceff4` white text).
   - **Instagram-Style Explore Mosaic Page**: 3-column dense mosaic grid with alternating 2×2 featured video hero tiles (`★ FEATURED`) and 1×1 standard tiles, pulling randomized global library scenes.
   - **Horizontal Swipe Left/Right Gesture Navigation**: Fluid mobile gestures (`onTouchStart`/`onTouchEnd`) and desktop arrow keys (`←`/`→`) to seamlessly glide between Reels Video Wall and Explore Mosaic feeds.
2. **Backend Tasks (`stash_file_manager/sfm_tasks.py`)**:
   - Executed via Stash's native Python plugin runner.
   - Provides filesystem tree building, directory hierarchy caching, and regex-based filename metadata extraction.
3. **Plugin Manifest (`stash_file_manager/stash_file_manager.yml`)**:
   - Conforms strictly to Stash's plugin schema specification (`version: 2.9.1`).
4. **Repository Index (`index.yml`)**:
   - Allows users to add the repository directly as a plugin source in **Stash → Settings → Plugins → Available Plugins → Add Source**.

---

## 2. Release Tag Inventory (31 Tags)

| Tag | Commit | Release Summary |
|---|---|---|
| `v1.0.0` | `3af72c9` | Initial release: Hierarchical tree, trie caching, regex parser |
| `v1.0.1` | `ee99f62` | Modernized nav button and UI refinements |
| `v1.0.2` | `df1202c` | Navbar sibling positioning and matching dimensions |
| `v1.1.0` | `c0d7254` | Multi-select, floating bulk action bar, detail table, folder scan |
| `v1.1.1` | `1fb83c6` | Native `PluginApi.patch` integration |
| `v2.0.0` | `ff5b450` | 3 folder views, Binge reel player, draggable floating PiP |
| `v2.0.1` | `8c52900` | Stream authentication and history back navigation |
| `v2.0.2` | `c97c72c` | Format seconds error boundary, collapsible headers |
| `v2.0.3` | `d258f33` | Package plugin as zip archive with sha256 checksum |
| `v2.0.4` | `d020407` | Menu container children insertion |
| `v2.1.0` | `10f3001` | Player UI redesign, swipe threshold animation, seek |
| `v2.1.1` | `129871a` | Decoupled HLS segmented protocol from WebM progressive container |
| `v2.2.0` | `3aba8f0` | Unified section headers, relocated select-all, card sliders |
| `v2.3.0` | `34b09b6` | Native settings schema, `sfm_tasks.py` backend runner |
| `v2.4.0` | `81c7f00` | Right circular action rail, TikTok auto-hide overlay |
| `v2.5.0` | `3a75f34` | MPEG-4 Part 2 smart transcode fallback, zero-lingering PiP |
| `v2.5.1` | `d21f161` | Plugin manifest schema validation |
| `v2.5.2` | `3a0c8df` | Action button transform clipping fix |
| `v2.5.3` | `168249b` | 5 core settings, monochrome SVGs, elevated overlay |
| `v2.5.4` | `1798ddd` | PiP divider restore, fullscreen above scrubber, codec chip icon |
| `v2.5.5` | `e3f741d` | TDZ ReferenceError fix for `streamMode` |
| `v2.6.0` | `d4fcd18` | 5-slide window buffer, eliminate thumbnail flash, recursive include subfolders |
| `v2.7.0` | `9e9de98` | Binge physics, folder list width slider, 10 scenes/row |
| `v2.7.1` | `7c0e3ef` | Folder-first recursive scene sorting |
| `v2.7.2` | `cb76ba1` | Streamlined SVG sliders, dynamic `[N] Selected` button |
| `v2.7.3` | `e8d8a6a` | Standardized view labels, 2-line navbar layout, keyboard shortcuts |
| `v2.8.0` | `07bc0f8` | Aligned headers, Group by Folder naming, Names view mode |
| `v2.8.1` | `b82d6d0` | Selection-driven guided regex builder with multi-field tagging |
| `v2.8.2` | `51342a6` | Floating toolbar button standardization, index.yml sync |
| `v2.9.0` | `d6bb569` | Folder Profile Video Wall, Shuffle Queue, social avatar & path overlay |
| `v2.9.1` | `e41f9df` | Instagram/TikTok seamless video wall, Force Mobile View toggle, button contrast overhaul |
| `v2.9.2` | `7656fd6` | Instagram-style Explore mosaic page, swipe left/right mobile gestures, dual-tab header, responsive audit |

---

## 3. Instructions for Force Pushing to GitHub

To force push the repository branch and all 31 release tags to GitHub (`https://github.com/daailouivan/stash-plugins.git`):

```bash
# 1. Pull / update to the latest bundle commit
git pull <path-to-bundle> main

# 2. Force push the main branch to origin
git push -u origin main --force

# 3. Force push all 31 release tags to origin
git push origin --tags --force
```

# Project Handoff Document: Stash Path File Manager Plugin

**Current Version:** `v2.9.21`  
**Active Repository:** `https://github.com/daailouivan/stash-plugins.git` (`main` branch)  
**Distribution Package:** `stash_file_manager.zip` (SHA256: `ef1fac78cbcb3e42b853ea31866cf89dfaa2aec4d0689ed2d1f1f56a71d70c78`)  
**Plugin Manifest:** `stash_file_manager/stash_file_manager.yml` (version `2.9.21`)  
**Index Manifest:** `index.yml` (version `2.9.21`)  
**Total Release Tags:** `46` (`v1.0.0` through `v2.9.21`)  

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
| `v1.0.0` | `2a860ad` | Initial release: Hierarchical tree, trie caching, regex parser |
| `v1.0.1` | `2a860ad` | Modernized nav button and UI refinements |
| `v1.0.2` | `2a860ad` | Navbar sibling positioning and matching dimensions |
| `v1.1.0` | `2a860ad` | Multi-select, floating bulk action bar, detail table, folder scan |
| `v1.1.1` | `2a860ad` | Native `PluginApi.patch` integration |
| `v2.0.0` | `2a860ad` | 3 folder views, Binge reel player, draggable floating PiP |
| `v2.0.1` | `2a860ad` | Stream authentication and history back navigation |
| `v2.0.2` | `2a860ad` | Format seconds error boundary, collapsible headers |
| `v2.0.3` | `2a860ad` | Package plugin as zip archive with sha256 checksum |
| `v2.0.4` | `2a860ad` | Menu container children insertion |
| `v2.1.0` | `2a860ad` | Player UI redesign, swipe threshold animation, seek |
| `v2.1.1` | `2a860ad` | Decoupled HLS segmented protocol from WebM progressive container |
| `v2.2.0` | `2a860ad` | Unified section headers, relocated select-all, card sliders |
| `v2.3.0` | `2a860ad` | Native settings schema, `sfm_tasks.py` backend runner |
| `v2.4.0` | `2a860ad` | Right circular action rail, TikTok auto-hide overlay |
| `v2.5.0` | `2a860ad` | MPEG-4 Part 2 smart transcode fallback, zero-lingering PiP |
| `v2.5.1` | `2a860ad` | Plugin manifest schema validation |
| `v2.5.2` | `2a860ad` | Action button transform clipping fix |
| `v2.5.3` | `2a860ad` | 5 core settings, monochrome SVGs, elevated overlay |
| `v2.5.4` | `2a860ad` | PiP divider restore, fullscreen above scrubber, codec chip icon |
| `v2.5.5` | `2a860ad` | TDZ ReferenceError fix for `streamMode` |
| `v2.6.0` | `2a860ad` | 5-slide window buffer, eliminate thumbnail flash, recursive include subfolders |
| `v2.7.0` | `2a860ad` | Binge physics, folder list width slider, 10 scenes/row |
| `v2.7.1` | `2a860ad` | Folder-first recursive scene sorting |
| `v2.7.2` | `2a860ad` | Streamlined SVG sliders, dynamic `[N] Selected` button |
| `v2.7.3` | `2a860ad` | Standardized view labels, 2-line navbar layout, keyboard shortcuts |
| `v2.8.0` | `2a860ad` | Aligned headers, Group by Folder naming, Names view mode |
| `v2.8.1` | `2a860ad` | Selection-driven guided regex builder with multi-field tagging |
| `v2.8.2` | `2a860ad` | Floating toolbar button standardization, index.yml sync |
| `v2.9.0` | `2a860ad` | Folder Profile Video Wall, Shuffle Queue, social avatar & path overlay |
| `v2.9.1` | `2a860ad` | Instagram/TikTok seamless video wall, Force Mobile View toggle, button contrast overhaul |
| `v2.9.2` | `2a860ad` | Instagram-style Explore mosaic page, swipe left/right mobile gestures, dual-tab header, responsive audit |

---

## 3. Instructions for Force Pushing to GitHub

To force push the repository branch and all 35 release tags to GitHub (`https://github.com/daailouivan/stash-plugins.git`):

```bash
# 1. Pull / update to the latest bundle commit
git pull <path-to-bundle> main

# 2. Force push the main branch to origin
git push -u origin main --force

# 3. Force push all 35 release tags to origin
git push origin --tags --force
```
| `v2.9.21` | `2a860ad` | Progressive feed windowing (social media optimization), in-player video wall launch & scroll fix |
| `v2.9.21` | `2a860ad` | Hotfix: resolved undeclared profileWallSort & clearCachedScenes with verified automated testing |

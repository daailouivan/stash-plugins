# Project Handoff Document: Stash Path File Manager Plugin

**Current Version:** `v2.9.0`  
**Active Repository:** `https://github.com/daailouivan/stash-plugins.git` (`main` branch)  
**Distribution Package:** `stash_file_manager.zip` (SHA256: `84372072ef83a54e558d2b3b5a2d107d73466b481ccd7abe7c3ac7aa8e20d16e`)  
**Plugin Manifest:** `stash_file_manager/stash_file_manager.yml` (version `2.9.0`)  
**Index Manifest:** `index.yml` (version `2.9.0`)  

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
2. **Backend Tasks (`stash_file_manager/sfm_tasks.py`)**:
   - Executed via Stash's native Python plugin runner.
   - Provides filesystem tree building, directory hierarchy caching, and regex-based filename metadata extraction.
3. **Plugin Manifest (`stash_file_manager/stash_file_manager.yml`)**:
   - Conforms strictly to Stash's plugin schema specification (`version: 2.9.0`).
4. **Repository Index (`index.yml`)**:
   - Allows users to add the repository directly as a plugin source in **Stash → Settings → Plugins → Available Plugins → Add Source**.

---

## 2. Recent Development History (v2.7.0 – v2.9.0)

| Version | Description |
|---|---|
| **v2.9.0** | **Folder Profile Video Wall & Shuffle Queue:** Added non-repeating Fisher-Yates shuffle toggle circle button with HUD toast and auto-advance. Implemented in-player Directory Profile page with social-media-style avatar, path chip, live stats (video count, size, duration, 4K/1080p breakdown), and responsive video wall grid to preview and launch any scene without exiting the player. |
| **v2.8.2** | **Floating Toolbar & Icon Standardization:** Harmonized floating batch edit and regex parse buttons to match control line styling (`btn-outline-secondary py-1 px-2`). Standardized Stash Grid button to match its icon-only counterpart (`IconGrid size={14}`). Synchronized automated packaging script for `index.yml`. |
| **v2.8.1** | **UI Spacing, Badge Alignment & Field Splitting:** Separated directory metrics into discrete elements with explicit margins (`99 direct · 99 in tree`). Added 1rem margin on search bar. Pluralized `Include Sub-Folders`. Standardized section title box (104px label) so count badges align vertically across headers. Resized pills (142px / 126px / 96px). Added 1-click interactive field splitting (`✂️ Split`) in Regex Parser. |
| **v2.8.0** | **Auto-Root, Names View & Regex Parser Overhaul:** Added Smart Common Root detection and single-child directory auto-collapsing. Added compact `Names` (filenames-only) table view mode. Overhauled regex builder with visual chunks, double-underscore release auto-detection, and path clues. |
| **v2.7.2** | **SVG Sliders & Unified Select-All:** Replaced emoji sliders with vector SVGs; merged select-all and count badge into a dynamic `[N] Selected` button; aligned subfolder toggles and indicators. |
| **v2.7.0** | **Binge Scrolling Physics & Recursion:** Upgraded reel track to 5-slide sliding window with touch/wheel momentum. Added `Include Sub-Folders` recursive scene aggregation and `Group by Folder` sorting. |

---

## 3. Workflow for New Commits (User Preference)

The user maintains a local git clone of `https://github.com/daailouivan/stash-plugins.git`.
When preparing updates:
1. Ensure all changes build cleanly on top of the user's remote `main` branch.
2. Build `stash_file_manager.zip` and update `index.yml` using `python3 /tmp/package_bundle.py` (which calculates SHA256 and updates timestamps automatically).
3. Pack all commits into a ready-to-pull Git bundle using `git bundle create <bundle> --all`.
4. The user pulls and pushes in single clean steps (`git pull <bundle> main && git push origin main`).

# Project Handoff Document: Stash Path File Manager Plugin

**Current Version:** `v2.5.5`  
**Active Commit:** `e3f741d` (`main` branch)  
**Latest Distribution Package:** `stash_file_manager.zip` (SHA256: `0fba6e01626f09f7686fa2e338a9135c6265c913dad3413107c40167bf4d5390`)  
**Git Verification:** Clean (`git fsck --full` reports 0 errors across all 26 refs and 21 release tags)

---

## 1. Project Overview & Architecture

The **Stash Path File Manager (`stash_file_manager`)** is a community plugin for [Stash](https://github.com/stashapp/stash). It provides an in-app file explorer to browse, preview, batch-manage, and organize media files by hierarchical filesystem paths rather than database IDs.

### Key Architectural Components
1. **Frontend (`stash_file_manager/file_manager.js` & `file_manager.css`)**:
   - Integrates via Stash's native `window.PluginApi.patch` into the primary top navigation bar.
   - Folder grid/list/table views with custom card sizing sliders and sort controls.
   - **Binge Discover-Style Reel Player**: Full-viewport vertical video player modal supporting mouse-wheel / swipe gestures, custom timeline scrubber, and picture-in-picture (PiP).
   - Multi-slide sliding window (`OVERSCAN = 1`) maintaining preloaded video elements and unblurred posters for adjacent scenes (`currentIndex - 1` and `currentIndex + 1`) to eliminate buffering delays.
2. **Backend Tasks (`stash_file_manager/sfm_tasks.py`)**:
   - Executed via Stash's native Python plugin runner.
   - Provides filesystem tree building, directory hierarchy caching, and regex-based filename metadata extraction.
3. **Plugin Manifest (`stash_file_manager/stash_file_manager.yml`)**:
   - Conforms strictly to Stash's plugin schema specification.
   - Exposes 5 consolidated core settings with single-line descriptions to avoid UI bloat in Stash's native settings panel.
4. **Repository Index (`index.yml`)**:
   - Allows users to add the repository directly as a plugin source in **Stash → Settings → Plugins → Available Plugins → Add Source**.

---

## 2. Recent Development History (v2.5.0 – v2.5.5)

| Version | Commit | Description |
|---|---|---|
| **v2.5.5** | `e3f741d` | **Fixed TDZ ReferenceError:** Moved preloaded stream resolution hooks after `streamMode` state hook initialization, eliminating the `Cannot access 'streamMode' before initialization` crash on video open. |
| **v2.5.4** | `1798ddd` | **Restored PiP Divider & Player Icon Overhauls:** Restored Divider 2 above the PiP button; pinned PiP and Fullscreen to the bottom of the column directly above the scrubbing line; converted all remaining player emojis (Play/Pause, Volume, Clock, Disk, Calendar, HUD Seek) to vector SVGs; replaced transcode lightning icon with hardware codec processor chip SVG; implemented adjacent video preloading. |
| **v2.5.3** | `168249b` | **Settings Consolidation & MPEG-4 Fallback:** Consolidated Stash settings down to 5 core items; introduced multi-vector MPEG-4 Part 2 / ASP detection (`mpeg4`, `mp4v`, `divx`, `xvid`) with automatic fallback to HLS; moved file type badge down to Line 2 of metadata overlay. |
| **v2.5.2** | `3a0c8df` | **Fixed Button Column Clipping:** Removed conflicting `transform: translateY(-50%)` causing action buttons to clip off-screen. |
| **v2.5.1** | `d21f161` | **Fixed Manifest Schema Validation:** Removed extraneous `id` field from `stash_file_manager.yml` to satisfy Stash package manager schema validation. |
| **v2.5.0** | `3a75f34` | **Circular Action Bar & PiP Decoupling:** Introduced 36px aligned right action column, persistent PiP dock return pill, and swipe gesture thresholding. |

---

## 3. Key Technical Decisions & Bug Fixes

### A. JavaScript Temporal Dead Zone (TDZ) Fix (v2.5.5)
* **Issue:** Opening any video displayed `Video Player Error: Cannot access 'streamMode' before initialization`.
* **Cause:** In `BingeReelPlayerModal`, `useMemo` hooks calculating adjacent stream URLs (`prevStreamUrl`, `nextStreamUrl`, `futureStreamUrl`) referenced `streamMode` before `const [streamMode, setStreamMode] = useState(...)` was declared.
* **Resolution:** Moved `resolveSceneStreamUrl` and the adjacent stream hooks immediately below the `streamUrl` computation block in Section 3, ensuring `streamMode` is fully initialized before evaluation.

### B. MPEG-4 Codec Video Playback Fallback
* **Issue:** `.mp4` containers containing MPEG-4 Part 2 / ASP video (`divx`, `xvid`, `mp4v`) played audio in modern browsers, but the video track failed silently without throwing an HTML5 media error.
* **Resolution:** Implemented multi-stage detection checking `video_codec`, `format`, file paths, and GraphQL probe metadata. When MPEG-4 ASP is identified, playback automatically routes through HLS (`/scene/{id}/stream.m3u8`). An active video track watchdog also verifies `videoWidth > 0` after 1 second of playback.

### C. Binge-Style Discover Reel Preloading
* **Architecture:**
  - `Slide -1` (Previous): Full-bleed unblurred screenshot poster + `<video preload="auto" muted playsInline />`.
  - `Slide 0` (Active): Live unblurred screenshot poster + active `<video>` with gesture overlay.
  - `Slide +1` (Next): Full-bleed unblurred screenshot poster + `<video preload="auto" muted playsInline />`.
  - Upcoming Scene (`currentIndex + 2`): Background preloader `<video preload="metadata" muted style={{display: 'none'}} />`.
* **Result:** Byte ranges and initial frames for upcoming scenes are pre-buffered into the browser's media cache, enabling instant playback without black frames or loading stalls upon wheel/touch transitions.

### D. Right Action Rail Layout & Alignment
* Standardized button size to `36px` circular pills with `8px` uniform spacing.
* Framed the navigation group (Previous, Counter, Next) with two horizontal dividers:
  - **Divider 1:** Positioned above Previous with doubled clearance (`margin: 16px 0`).
  - **Divider 2:** Positioned below Next and directly above PiP with doubled clearance (`margin: 16px 0`).
* Pushed viewport controls (`.sfm-reel-bottom-actions`) to the bottom using `margin-top: auto`, anchoring the Fullscreen button at `bottom: 64px` directly above the timeline scrubbing line (`60px`).

---

## 4. Active Artifacts & Workspace Files

All active Git history, release tags, and packaged release artifacts have been verified and archived to Google Drive:

* **Pristine Git Repository Archive (Full `.git` tree, all 26 refs & 21 tags):**  
  [stash_plugins_pristine_git_repo_v2.5.5.zip](https://drive.google.com/file/d/1ohV7ZNwr-xuOtw2QDMOgRbbfYrM9-y5R/view?usp=drivesdk)
* **Verified Git Bundle Archive:**  
  [stash_plugins_v2.5.5.bundle](https://drive.google.com/file/d/1Fh9rbCE8s0AIvdADbZjr8oGtyi38laP4/view?usp=drivesdk)

### Repository Directory Structure
```
repo_active/
├── .gitignore
├── HANDOFF.md                             # Project handoff documentation
├── index.yml                              # Stash plugin source index (v2.5.5)
├── README.md                              # Main repository documentation & changelog
├── stash_file_manager.zip                 # Built release zip package for Stash
├── assets/                                # Vector showcase graphics
│   ├── hero_banner.svg
│   ├── showcase_folder_views.svg
│   └── showcase_reel_and_pip.svg
└── stash_file_manager/                    # Plugin source directory
    ├── stash_file_manager.yml             # Stash plugin manifest
    ├── file_manager.js                    # Core frontend script
    ├── file_manager.css                   # Custom styles & player layout
    ├── sfm_tasks.py                       # Python backend tasks & scanner
    ├── README.md                          # In-plugin documentation
    └── assets/                            # Plugin asset mirrors
```

---

## 5. Instructions for Pushing to GitHub

To push the clean history and all release tags (`v1.0.0` through `v2.5.5`) to GitHub (`https://github.com/daailouivan/stash-plugins.git`):

```bash
# 1. Extract the pristine repository archive
unzip stash_plugins_pristine_git_repo_v2.5.5.zip -d stash-plugins
cd stash-plugins

# 2. Verify repository integrity (will return 0 errors)
git fsck --full

# 3. Force push main branch and release tags
git push -u origin main --force
git push origin --tags --force
```

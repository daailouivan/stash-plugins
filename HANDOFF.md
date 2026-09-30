# Project Handoff Document: Stash Path File Manager Plugin
# Preparation & Blueprint for v3.0.0

**Current Release:** `v2.9.25`  
**Target Milestone:** `v3.0.0` (Phase 4: Native Stash Platform Deep Embedding)  
**Active Repository:** `https://github.com/daailouivan/stash-plugins.git` (`main` branch)  
**Distribution Package:** `stash_file_manager.zip` (SHA256: `4cc91dfbdc02ac60f405477bb11cc5d6b83463046cb6b8fef4ba937eef450541`)  
**Plugin Manifest:** `stash_file_manager/stash_file_manager.yml` (version `2.9.25`)  
**Repository Index:** `index.yml` (version `2.9.25`)  
**Total Release Tags:** `45` (`v1.0.0` through `v2.9.25`)  

---

## 1. Quick-Start for the New Chat / Agent

To immediately pick up this repository and continue work on **v3.0.0**:

```bash
# 1. Unpack or clone repository
git clone https://github.com/daailouivan/stash-plugins.git /tmp/repo/stash-plugins
cd /tmp/repo/stash-plugins

# 2. Or if using the offline git handoff bundle:
git clone /working_dir/stash_plugins_v2.9.25_handoff.bundle /tmp/repo/stash-plugins
cd /tmp/repo/stash-plugins

# 3. Verify working tree and tags
git status
git tag -l "v*" --sort=v:refname | tail -n 10

# 4. Run full test suite
node test_components.js
node /tmp/test_v2.9.16_explore_directory.js
node /tmp/test_v2.9.17_pageback_history.js
node /tmp/test_v2.9.18_explore_scenes_and_goback.js
node /tmp/test_v2.9.19_profile_nav_and_goback.js
node /tmp/test_v2.9.21_subfolders_collapse_and_playback.js
node /tmp/test_v2.9.23_no_stacked_players.js
```

---

## 2. Artifacts & Download Links

| Artifact | File Name | Size | Google Drive Link |
|---|---|---|---|
| **Git Handoff Bundle** | `stash_plugins_v2.9.25_handoff.bundle` | 3.4 MB | [Download Bundle](https://drive.google.com/file/d/1WCZlXlBavpV4nEOP_cQ9tH3kztviDEPO/view?usp=drivesdk) |
| **Plugin Release Zip** | `stash_file_manager_v2.9.25.zip` | 112 KB | [Download Plugin Zip](https://drive.google.com/file/d/1s3pVEDergDfStZ9MJEJg1R-japBcAUMF/view?usp=drivesdk) |
| **Repository Backup Zip** | `stash_plugins_repo_v2.9.25_handoff.zip` | 4.8 MB | In VM working directory |

---

## 3. Project Architecture & File Inventory

The **Stash Path File Manager (`stash_file_manager`)** provides an intuitive filesystem explorer and modern social-media-style video browsing experience for [Stash](https://github.com/stashapp/stash), bridging filesystem hierarchies with metadata-rich media playback.

```
stash-plugins/
├── index.yml                                # Stash plugin repository package index
├── stash_file_manager.zip                   # Release distribution archive
├── HANDOFF.md                               # Project continuity & v3.0 blueprint
├── README.md                                # Root documentation & roadmap
└── stash_file_manager/
    ├── stash_file_manager.yml               # Stash plugin manifest
    ├── file_manager.js                      # Core frontend application (~8,200 lines)
    ├── file_manager.css                     # Component & layout stylesheet (~4,050 lines)
    ├── sfm_tasks.py                         # Python backend tasks (rebuild tree, scan, regex)
    └── README.md                            # Detailed plugin documentation
```

### Key Frontend Components (`file_manager.js`)
1. **`PathTrie` & Path Resolution:**
   - Multi-root filesystem prefix auto-detection (`resolveLibraryRoot`).
   - High-performance prefix tree (`PathTrie`) indexing tens of thousands of scenes into hierarchical nodes in memory and IndexedDB.
   - `resolveSceneFolder(scene, trie)` dynamically maps any scene to its actual folder path.
2. **`FileManagerView` (Root Workspace):**
   - Renders inside `#sfm-workspace-root`, mounted via Stash top navigation button (`PluginApi.patch`).
   - Three folder view modes: Cards (`cards`), List (`list`), and Compact Table (`table`).
   - Three scene view modes: Cards Grid (`grid`), Table View (`list`), and Fast Filename Inspector (`names`).
   - Sizing sliders for folder cards (120px–360px) and scene cards (140px–500px).
   - Single top-level state manager orchestrating modals, navigation history, and sub-views.
3. **`BingeReelPlayerModal` (TikTok / Binge-Style Vertical Reel Player):**
   - Full-viewport vertical video player supporting mouse wheel and touch swipe transitions.
   - Sliding window buffer (`OVERSCAN = 2`) maintaining 5 preloaded video elements (`-2`, `-1`, `current`, `+1`, `+2`) to eliminate buffering delays.
   - Fisher-Yates non-repeating shuffle permutation queue.
   - Draggable detached Picture-in-Picture (PiP) and browser native PiP.
   - Precision scrubbing bar with interactive hover preview.
   - Full keyboard controls (`Space`/`K` play/pause, `↑`/`↓` prev/next, `←`/`→` seek ±10s, `F` fullscreen, `M` mute, `S` shuffle).
   - Mobile controller & Gamepad API support (`navigator.getGamepads()`, Bluetooth TikTok scrolling rings, HID remotes).
4. **`FolderProfileView` (Instagram-Style Directory Profile & Video Wall):**
   - Social-media creator profile layout with folder avatar, gradient ring, bio, and 3 metric columns (video counts, size, duration).
   - Collapsible Subfolders Drawer (`▶ Subfolders in [Path] (count)`), collapsed by default with interactive navigation pills and search filter.
   - Edge-to-edge, flush 3-column portrait video wall (`sfm-profile-wall-grid`) with zero border gaps, views/duration overlays, and resolution badges.
   - Explore Mosaic Page (`sfm-explore-grid`) with alternating 2×2 featured video hero tiles (`★ FEATURED`) and 1×1 tiles.
   - Horizontal swipe gesture navigation (`onTouchStart`/`onTouchEnd`) and desktop arrow keys (`←`/`→`) to glide between Reels and Explore feeds.
   - Force Mobile View toggle (`IconSmartphone`) simulating a 440px phone frame on desktop.
5. **URL Hash Router & History Engine:**
   - Deep URL hash structure: `#file-manager?path=...&view=profile|discover&scene=...`.
   - Strictly manages browser history stack: leaf modals use `pushState`, video transitions within player use `replaceState`, and profile navigation replaces video to prevent stacked ghost players.

---

## 4. Summary of Recent Critical Fixes (v2.9.19 – v2.9.25)

| Version | Problem Description | Root Cause | Technical Solution |
|---|---|---|---|
| **v2.9.25** | Fullscreen disabled clicks on profile & explore view; controller Left/Right did nothing on mobile | HTML5 Fullscreen was isolated to the video element; controller key codes differed from standard `ArrowLeft`/`ArrowRight` | Toggled fullscreen on workspace root; added `document.exitFullscreen()` on teardown; added `pointer-events: none` on hover overlays; expanded HID key recognition (`Left`, `MediaTrackPrevious`, etc.) and integrated native Gamepad API polling |
| **v2.9.24** | All scene thumbnails turned black on profile & explore walls | `s.paths?.preview` (an MP4 video file) was mistakenly added to `sPoster`, causing `<img>` decode failures and triggering a destructive `onError` hiding loop | Restored canonical `s.paths?.screenshot \|\| /scene/${s.id}/screenshot`; removed video poster fallback; reinstated standard `loading="lazy"`; removed fallback CSS |
| **v2.9.23** | Closing video player revealed another video player underneath; back button cycled through old videos | Navigation from video to profile pushed history entries and `handlePlayScene` used `replaceState`, trapping older scenes in the stack | Delegated avatar bar profile opening to `FileManagerView.onOpenProfile` to cleanly unmount player; replaced video with profile in history; added `isClosingPlayerRef` guard |
| **v2.9.21** | Excessive breadcrumb dropdown clutter; video player obscured by profile page | Redundant breadcrumbs dropdown; z-index collision between player backdrop and profile page | Refactored subfolders into a single-line collapsible drawer (collapsed by default); elevated player backdrop z-index to `10100` over profile page at `10080` |
| **v2.9.19** | Empty parent/root folders turned video wall black; hitting back from player replayed old video | Direct scenes were empty in parent directories; profile view URLs had `sceneId` attached | Auto-fallback to all descendant scenes when direct scenes are empty; stripped `sceneId` from profile URLs |

---

## 5. Complete Release Tag Inventory (45 Tags)

| Tag | Commit | Release Summary |
|---|---|---|
| `v1.0.0` | `3af72c9` | Initial commit: Add Stash Path File Manager plugin with caching and regex parser |
| `v1.0.1` | `ee99f62` | Modernize navigation bar button and refine file manager workspace UI |
| `v1.0.2` | `df1202c` | Insert button as true navbar sibling and enforce matching icon dimensions |
| `v1.1.0` | `c0d7254` | Multi-select, floating bulk action bar, detailed table view, and folder scan |
| `v1.1.1` | `1fb83c6` | Adopt Binge's native PluginApi.patch method for responsive navbar integration |
| `v2.0.0` | `ff5b450` | Compact customizable folder views, video transcode fix, binge reel player, draggable floating pip, folder history |
| `v2.0.1` | `8c52900` | Authenticated stream URLs, history back navigation with toolbar controls |
| `v2.0.2` | `c97c72c` | Format seconds error boundary, collapsible Subfolders and Files headers |
| `v2.0.3` | `d258f33` | Package plugin as zip archive with sha256 checksum for Stash package installer |
| `v2.0.4` | `d020407` | Insert button directly into menu container children to prevent line wrap |
| `v2.1.0` | `10f3001` | Redesign player UI, fix transcode duration with WebM/HLS, threshold swipe animation, double-click seek |
| `v2.1.1` | `129871a` | Re-architect transcode delivery separating HLS segmented protocol from WebM progressive container |
| `v2.2.0` | `3aba8f0` | Unify section headers, relocate select-all, card size sliders, changelog & roadmap |
| `v2.3.0` | `34b09b6` | Fix manifest schema errors, native Stash plugin settings, plugin tasks, in-app settings modal |
| `v2.4.0` | `81c7f00` | Right circular action rail, TikTok auto-hide overlay, custom controls, HLS fallback, seamless reel scroll |
| `v2.5.0` | `3a75f34` | Smart MPEG-4 codec fallback, 36px button column, 50% TikTok scroll threshold, zero-lingering PiP |
| `v2.5.1` | `d21f161` | Fix Stash plugin manifest schema error by removing extraneous id field |
| `v2.5.2` | `3a0c8df` | Fix right action buttons clipping caused by lingering transform: translateY(-50%) |
| `v2.5.3` | `168249b` | Consolidate plugin settings, robust MPEG-4 fallback, clean monochrome vector icons, elevated overlay |
| `v2.5.4` | `1798ddd` | Restore PiP divider, position Fullscreen above scrubber, codec chip icon, full monochrome SVGs |
| `v2.5.5` | `e3f741d` | Fix ReferenceError: Cannot access 'streamMode' before initialization |
| `v2.6.0` | `d4fcd18` | Multi-video reel swiping, eliminate thumbnail flash, recursive include sub-folders toggle |
| `v2.7.0` | `9e9de98` | Binge reel scrolling physics, folder list width slider, 10 scenes/row range, navigation restructuring |
| `v2.7.1` | `7c0e3ef` | Folder-first recursive scene sorting with folder carry-down order and toggle |
| `v2.7.2` | `cb76ba1` | Streamline sliders, merge select-all count, align subfolder toggles, relocate sorting to path line |
| `v2.7.3` | `e8d8a6a` | Reorganize navigation bar into 2-line layout with icon controls and stretching search |
| `v2.8.0` | `07bc0f8` | Aligned headers, persistent indicators, Group by Folder naming, Names view mode |
| `v2.8.1` | `b82d6d0` | Selection-driven guided regex builder with multi-field tagging |
| `v2.8.2` | `51342a6` | Sync to v2.8.2 base and documentation alignment |
| `v2.9.0` | `d6bb569` | Folder Profile Video Wall, Shuffle Queue, social avatar & path overlay |
| `v2.9.1` | `e41f9df` | Colorize counter numbers, 2-color status states, bold toggles, hide-empty padding fix, unified floating bar |
| `v2.9.2` | `917ec94` | Instagram-style Explore mosaic page, swipe gestures, dual tabs, responsive audit |
| `v2.9.8` | `92818eb` | Sub-route hash routing for back button, overlay scroll isolation, mobile un-crowding |
| `v2.9.9` | `b4718ae` | Progressive feed windowing (virtualization), in-player video wall launch, natural profile scroll |
| `v2.9.10` | `adb2642` | Resolve profileWallSort ReferenceError and restore clearCachedScenes handler |
| `v2.9.16` | `8da27d3` | Resolve video's true directory when launched from explore under root |
| `v2.9.17` | `7dfdfe6` | Support natural pageback from player and profile to previous page |
| `v2.9.18` | `5d3feed` | Resolve explore scene folder queue and ensure single back to profile |
| `v2.9.19` | `8f24d5b` | Fix goback replay, non-black video wall auto-fallback, path title alignment |
| `v2.9.20` | `9541629` | Display subfolders in navigation path and dedicated explorer row |
| `v2.9.21` | `a3fae8f` | Resolve modal z-index priority and add collapsible subfolders |
| `v2.9.22` | `8b6e34f` | Resolve black thumbnails with eager decoding and multi-tier fallbacks |
| `v2.9.23` | `afb00ee` | Prevent modal stacking and ghost video playback across browsing layers |
| `v2.9.24` | `69d66e1` | Restore standard scene screenshot endpoints and eliminate broken video poster fallback |
| `v2.9.25` | `0ba7c31` | Add mobile controller & gamepad support, fix fullscreen click lockout |

---

## 6. Architecture Blueprint for v3.0.0 (Phase 4)

The primary objective of **v3.0.0** is **Deep Platform Embedding**: integrating File Manager capabilities directly into native Stash views and components so users do not have to leave their normal browsing flow to benefit from filesystem hierarchies.

### Feature 1: Native Scene Card Embedding (`PluginApi.patch`)
- **Target:** Stash native scene cards across `/scenes`, `/performers/{id}`, `/studios/{id}`, and `/tags/{id}`.
- **Implementation:**
  - Patch `SceneCard` or `SceneCard.Details` via `window.PluginApi.patch`.
  - Append a subtle directory path chip (e.g. `📁 /Anime/Naruto/Season 1`) below the title/studio.
  - Add a 1-click action icon (`IconFolder`) on card hover to instantly launch the File Manager directly navigated to that scene's directory, or open its video profile.

### Feature 2: Native Scene Detail Page Integration (`/scenes/{id}`)
- **Target:** The main scene playback page in Stash.
- **Implementation:**
  - Hook into `SceneDetails` or `ScenePlayer` component via `PluginApi.patch`.
  - Add a dedicated **"Directory Hierarchy"** row in the scene metadata sidebar displaying clickable breadcrumb chips (`Root / Anime / Naruto / Season 1`).
  - Clicking any breadcrumb jumps directly to that folder in File Manager.
  - Add a **"Reel Mode"** button alongside the standard video player to launch `BingeReelPlayerModal` starting from the current scene.

### Feature 3: Native Viewport Layout Container Mounting
- **Target:** Native routing under `/scenes?view=folder` or `/plugin/file-manager`.
- **Implementation:**
  - Enable mounting File Manager inside Stash's main application layout (`.main-container`) instead of an absolute fullscreen fixed overlay (`#sfm-workspace-root`).
  - Retain Stash's native top navigation bar, global search, background task progress spinners, and notification toasts at all times.
  - Offer a seamless toggle between "Embedded Layout" and "Fullscreen Immersive Workspace".

### Feature 4: Theme & CSS Custom Property Parity
- **Target:** Seamless visual harmony with community themes (Refract, Nord, Dark, Midnight, Dracula).
- **Implementation:**
  - Refactor hardcoded colors in `file_manager.css` (`#05070a`, `#0d1117`, `#182030`, `#88c0d0`, `#2e3440`) to fall back to Stash CSS variables:
    - Background: `var(--body-bg, #05070a)`
    - Cards: `var(--card-bg, #0d1117)`
    - Accent: `var(--primary, #88c0d0)`
    - Text: `var(--text-color, #eceff4)`
    - Borders: `var(--border-color, rgba(255, 255, 255, 0.1))`

---

## 7. Packaging & Release Procedure

Whenever cutting a new release:

```bash
# 1. Bump version in stash_file_manager.yml and index.yml
# e.g., version: 3.0.0

# 2. Package plugin zip
python3 -c "
import os, zipfile
zip_path = 'stash_file_manager.zip'
if os.path.exists(zip_path): os.remove(zip_path)
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('stash_file_manager'):
        for f in files:
            full = os.path.join(root, f)
            zf.write(full, arcname=full)
"

# 3. Compute sha256 checksum and update index.yml
sha256sum stash_file_manager.zip

# 4. Commit, tag, and create bundle
git add .
git commit -m "feat(v3): implement native stash card embedding and detail page integration"
git tag -a v3.0.0 -m "Release v3.0.0: Native Stash Platform Deep Embedding"
git bundle create stash_plugins_v3.0.0_handoff.bundle --all
```

---

*Handoff prepared on September 30, 2026. Ready for v3.0.0 development.*

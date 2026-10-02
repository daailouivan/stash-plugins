# Project Handoff Document: Stash Path File Manager Plugin
# Release v3.0.2 & Blueprint for Phase 4 Expansion

**Current Release:** `v3.0.2`  
**Target Milestone:** `v3.1.0` (Phase 4 Continuation: Performer & Studio Directory Aggregation & Advanced Platform Hooks)  
**Active Repository:** `https://github.com/daailouivan/stash-plugins.git` (`main` branch)  
**Distribution Package:** `stash_file_manager.zip` (SHA256: `708b38f02ec03c1567c11d15d5124f85b0b9e19ea09fe210832546522859938a`)  
**Plugin Manifest:** `stash_file_manager/stash_file_manager.yml` (version `3.0.2`)  
**Repository Index:** `index.yml` (version `3.0.2`)  
**Total Release Tags:** `47` (`v1.0.0` through `v3.0.2`)  

---

## 1. Quick-Start for the New Chat / Agent

To immediately pick up this repository and continue work on **v3.1.0**:

```bash
# 1. Unpack or clone repository
git clone https://github.com/daailouivan/stash-plugins.git /tmp/repo/stash-plugins
cd /tmp/repo/stash-plugins

# 2. Or if using the offline git handoff bundle:
git clone /working_dir/stash_plugins_v3.0.2_handoff.bundle /tmp/repo/stash-plugins
cd /tmp/repo/stash-plugins

# 3. Verify working tree and tags
git status
git tag -l "v*" --sort=v:refname | tail -n 10

# 4. Run full test suite (all suites passing 100%)
node test_components.js
node test_v3.0.0_native_card_and_scene_detail.js
node test_v3.0.0_native_embedded_cards.js
node test_v3.0.2_title_line_alignment.js
```

---

## 2. Artifacts & Download Links

| Artifact | File Name | Size | Checksum (SHA256) |
|---|---|---|---|
| **Plugin Release Zip** | `stash_file_manager.zip` | 117 KB | [Download Zip](https://drive.google.com/file/d/1Vz_6McIhiZfK3uIrgAQNhLcsHYab7zim/view?usp=drivesdk) |
| **Git Handoff Bundle** | `stash_plugins_v3.0.0_handoff.bundle` | 3.6 MB | [Download Bundle](https://drive.google.com/file/d/1MdxmmJS6J7aDOOT7MTt9exzxHjNuPfgS/view?usp=drivesdk) |
| **Repository Backup Zip** | `stash_plugins_repo_v3.0.0_handoff.zip` | ~4.9 MB | In VM working directory |

---

## 3. Project Architecture & File Inventory

The **Stash Path File Manager (`stash_file_manager`)** provides an intuitive filesystem explorer, modern social-media-style video browsing, and native platform embedding for [Stash](https://github.com/stashapp/stash), bridging filesystem hierarchies with metadata-rich media playback.

```
stash-plugins/
├── index.yml                                # Stash plugin repository package index
├── stash_file_manager.zip                   # Release distribution archive
├── HANDOFF.md                               # Project continuity & v3.1 blueprint
├── README.md                                # Root documentation & roadmap
├── test_components.js                       # Core automated component test suite
├── test_v3.0.0_native_card_and_scene_detail.js # Phase 4 native integration test suite
└── stash_file_manager/
    ├── stash_file_manager.yml               # Stash plugin manifest
    ├── file_manager.js                      # Core frontend application (~8,500 lines)
    ├── file_manager.css                     # Component & layout stylesheet (~4,200 lines)
    ├── sfm_tasks.py                         # Python backend tasks (rebuild tree, scan, regex)
    └── README.md                            # Detailed plugin documentation
```

### Key Frontend Components (`file_manager.js`)
1. **`PathTrie` & Path Resolution:**
   - Multi-root filesystem prefix auto-detection (`resolveLibraryRoot`).
   - High-performance prefix tree (`PathTrie`) indexing tens of thousands of scenes into hierarchical nodes in memory and IndexedDB.
   - `resolveSceneFolder(scene, trie)` dynamically maps any scene (by object or ID) to its actual folder path.
2. **`NativeSceneCardOverlay` (Phase 4 - Feature 1):**
   - Embedded directly on Stash native scene cards across `/scenes`, `/performers`, `/studios`, and `/tags`.
   - Subtle path chip (`📁 /Anime/Naruto/Season 1`) below title/studio with click-to-browse.
   - 1-click action buttons: Browse Folder, Video Wall Profile, and Binge Reel Player.
   - Floating 1-click action button on card thumbnail hover.
   - Dual integration via Stash `PluginApi.patch` (`SceneCard` / `SceneCard.Details`) and debounced DOM observer fallback.
3. **`NativeSceneDetailDirectoryHierarchy` & `NativeSceneDetailReelButton` (Phase 4 - Feature 2):**
   - Embedded in native Stash scene playback pages (`/scenes/{id}`).
   - Dedicated "Directory Hierarchy" metadata sidebar row with clickable breadcrumb pills (`Root › Anime › Naruto › Season 1`) and quick "Profile Wall" launcher.
   - Native "Reel Mode" button beside standard player controls launching `BingeReelPlayerModal` starting from the active scene with sibling video queue.
   - Dual integration via `PluginApi.patch` (`SceneDetails`, `SceneDetails.Sidebar`, `ScenePlayer`) and DOM observer fallback.
4. **`FileManagerView` (Root Workspace):**
   - Renders inside `#sfm-workspace-root`, mounted via Stash top navigation button (`PluginApi.patch`).
   - Three folder view modes: Cards (`cards`), List (`list`), and Compact Table (`table`).
   - Three scene view modes: Cards Grid (`grid`), Table View (`list`), and Fast Filename Inspector (`names`).
   - Sizing sliders for folder cards (120px–360px) and scene cards (140px–500px).
   - Single top-level state manager orchestrating modals, navigation history, and sub-views.
5. **`BingeReelPlayerModal` (TikTok / Binge-Style Vertical Reel Player):**
   - Full-viewport vertical video player supporting mouse wheel and touch swipe transitions.
   - Sliding window buffer (`OVERSCAN = 2`) maintaining 5 preloaded video elements (`-2`, `-1`, `current`, `+1`, `+2`) to eliminate buffering delays.
   - Fisher-Yates non-repeating shuffle permutation queue.
   - Draggable detached Picture-in-Picture (PiP) and browser native PiP.
   - Mobile controller & Gamepad API support (`navigator.getGamepads()`, Bluetooth TikTok scrolling rings, HID remotes).
6. **`FolderProfileView` (Instagram-Style Directory Profile & Video Wall):**
   - Social-media creator profile layout with folder avatar, gradient ring, bio, and 3 metric columns (video counts, size, duration).
   - Collapsible Subfolders Drawer (`▶ Subfolders in [Path] (count)`), collapsed by default with interactive navigation pills and search filter.
   - Edge-to-edge, flush 3-column portrait video wall (`sfm-profile-wall-grid`) with zero border gaps, views/duration overlays, and resolution badges.
   - Explore Mosaic Page (`sfm-explore-grid`) with alternating 2×2 featured video hero tiles (`★ FEATURED`) and 1×1 tiles.
   - Horizontal swipe gesture navigation (`onTouchStart`/`onTouchEnd`) and desktop arrow keys (`←`/`→`) to glide between Reels and Explore feeds.

---

## 4. Summary of Recent Critical Additions (v3.0.0 & v3.0.2)

| Feature / Fix | Technical Solution & Architecture |
|---|---|
| **Title Line Geometry Alignment** | Implemented fixed-width geometry for Section Title Box (`195px`), Section Title Label (`115px`), and Count Badge (`48px`) centered text with high-visibility `#88c0d0` accent, preventing layout shift across varying directory path depths and file counts. |
| **Synchronized State Toggles** | Paired Line 1 toggles (`.sfm-pill-subfolders` `175px`, `.sfm-pill-foldersort` `160px`, `.sfm-pill-hideempty` `110px`) with Line 2 status indicators with uniform `0.5rem` margin-left. Converted Scenes-line indicators to interactive buttons wired to state handlers with active cyan glow (`.sfm-state-active`) and muted slate (`.sfm-state-inactive`). |
| **Menu Bar Clearance & View Polish** | Shifted Binge Reel Player backdrop down (`top: 60px !important`, dialog `max-height: calc(100vh - 75px)`, actions column `top: 24px !important`) to permanently clear Stash's native top navigation bar. Applied slim folder list view spacing (`5px` grid gap, `0.35rem 0.65rem` row padding). Modernized UI with SVG vector icons replacing legacy emojis. |
| **Native Container Mounting (Phase 4)** | Mounted File Manager workspace directly inside Stash's native `.main-container` below top navbar with configurable `workspace_layout_mode` (`native` vs `overlay`). Reproduced native `.card.scene-card` component layout. |
| **Native Scene Card Integration** | Implemented `NativeSceneCardOverlay` hooked into `PluginApi.patch.instead` & `patch.after` on `SceneCard` and `SceneCard.Details`; injected directory path chip, quick action buttons (Folder, Profile Wall, Reel), and floating hover button with zero DOM layout shift. Supported debounced DOM observer fallback for infinite scroll. |
| **Scene Detail Page Traversal** | Implemented `NativeSceneDetailDirectoryHierarchy` and `NativeSceneDetailReelButton` hooked into `PluginApi.patch` on `SceneDetails`, `SceneDetails.Sidebar`, and `ScenePlayer`; added clickable breadcrumb chips jumping to any folder depth and a 1-click Binge Reel launcher. |
| **Catalog Singleton & Caching** | Extracted `ensureCatalog()` singleton with promise deduping and IndexedDB restoration (<50ms) to allow instant directory resolution across native Stash pages prior to workspace mount. |

---

## 5. Automated Test Suite (All Suites Passing 100%)

1. `test_components.js`: Core components render test (FolderProfileView, BingeReelPlayerModal, FileManagerView, SceneTableView, SceneNamesTableView, SceneCard, FilenameParserModal, BatchMetadataModal, SettingsAndTasksModal, clearCachedScenes).
2. `test_v3.0.0_native_card_and_scene_detail.js`: Phase 4 native card embedding, directory path chips, hover action icons, scene details directory hierarchy breadcrumbs, Reel Mode launcher, and DOM fallbacks.
3. `test_v3.0.0_native_embedded_cards.js`: Native `.main-container` mounting, native card reproduction, and CSS embedded layout verification.
4. `test_v3.0.2_title_line_alignment.js`: Fixed geometry for title boxes/labels/count badges, "Sub-folders" hyphenated naming, interactive two-way status toggles, active/inactive color states, and menu bar clearances.

---

## 6. Architecture Blueprint for v3.1.0

The next milestone (**v3.1.0**) expands on Phase 4 with:
- **Performer & Studio Directory Aggregation:** Adding directory path badges to Performer and Studio cards based on dominant directory affinity.
- **Advanced Platform Filter Hooks:** Direct filtering integration with Stash's native GraphQL filter bar when navigating from File Manager views.

---

*Handoff updated on October 2, 2026. v3.0.2 successfully completed and verified.*

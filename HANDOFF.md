# Project Handoff Document: Stash Path File Manager Plugin
# Release v3.0.2 & Blueprint for Phase 4 Expansion

**Current Release:** `v3.0.2`  
**Target Milestone:** `v3.1.0` (Phase 4 Continuation: Native Viewport Container Mounting & Advanced Platform Hooks)  
**Active Repository:** [daailouivan/stash-plugins](https://github.com/daailouivan/stash-plugins.git) (`main` branch)  
**Plugin Folder:** `stash_file_manager`  
**Plugin Manifest:** `stash_file_manager/stash_file_manager.yml` (version `3.0.2`)  
**Repository Index:** `index.yml` (version `3.0.2`)  

---

## 1. Quick-Start for the New Chat / Agent

To immediately pick up this repository and continue work on **v3.1.0**:

```bash
# 1. Clone repository
git clone https://github.com/daailouivan/stash-plugins.git /tmp/repo/stash-plugins
cd /tmp/repo/stash-plugins

# 2. Verify working tree and tags
git status
git tag -l "v*" --sort=v:refname | tail -n 10

# 3. Run full test suite (all test suites passing)
node test_components.js
node test_v3.0.0_native_card_and_scene_detail.js
node test_v3.0.0_native_embedded_cards.js
node test_v3.0.1_title_line_alignment.js
```

---

## 2. Project Architecture & File Inventory

The **Stash Path File Manager (`stash_file_manager`)** provides an intuitive filesystem explorer, modern social-media-style video browsing, and native platform embedding for [Stash](https://github.com/stashapp/stash), bridging filesystem hierarchies with metadata-rich media playback.

```
stash-plugins/
├── index.yml                                # Stash plugin repository package index (v3.0.2)
├── stash_file_manager.zip                   # Release distribution archive
├── HANDOFF.md                               # Project continuity & v3.1 blueprint
├── README.md                                # Root documentation & roadmap
├── test_components.js                       # Core automated component test suite
├── test_v3.0.0_native_card_and_scene_detail.js # Phase 4 native integration test suite
├── test_v3.0.0_native_embedded_cards.js     # Native container mounting test suite
├── test_v3.0.1_title_line_alignment.js      # Title line alignment & toggle pair tests
└── stash_file_manager/
    ├── stash_file_manager.yml               # Stash plugin manifest (v3.0.2)
    ├── file_manager.js                      # Core frontend application
    ├── file_manager.css                     # Component & layout stylesheet
    ├── sfm_tasks.py                         # Python backend tasks (rebuild tree, scan, regex)
    └── README.md                            # Detailed plugin documentation
```

### Key Frontend Components (`file_manager.js` & `file_manager.css`)
1. **`PathTrie` & Path Resolution:**
   - Multi-root filesystem prefix auto-detection (`resolveLibraryRoot`).
   - High-performance prefix tree (`PathTrie`) indexing scenes into hierarchical nodes in memory and IndexedDB.
   - `resolveSceneFolder(scene, trie)` dynamically maps any scene to its actual folder path.
2. **`NativeSceneCardOverlay` (Phase 4 - Feature 1):**
   - Embedded directly on Stash native scene cards across `/scenes`, `/performers`, `/studios`, and `/tags`.
   - Subtle path chip (`📁 /Path/To/Folder`) below title/studio with click-to-browse.
   - 1-click action buttons: Browse Folder, Video Wall Profile, and Binge Reel Player.
   - Floating 1-click action button on card thumbnail hover.
3. **`NativeSceneDetailDirectoryHierarchy` & `NativeSceneDetailReelButton` (Phase 4 - Feature 2):**
   - Embedded in native Stash scene playback pages (`/scenes/{id}`).
   - Dedicated "Directory Hierarchy" metadata sidebar row with clickable breadcrumb pills.
   - Native "Reel Mode" button beside standard player controls launching `BingeReelPlayerModal`.
4. **`FileManagerView` (Root Workspace):**
   - Renders inside `#sfm-workspace-root`, mounted via Stash top navigation button.
   - Folder view modes: Cards (`cards`), List (`list`), and Compact Table (`table`).
   - Scene view modes: Cards Grid (`grid`), Table View (`list`), and Fast Filename Inspector (`names`).
   - Fixed geometry headers (`.sfm-section-title-box`, `.sfm-pill-subfolders`, `.sfm-pill-foldersort`).
5. **`BingeReelPlayerModal` (TikTok / Binge-Style Vertical Reel Player):**
   - Full-viewport vertical video player with preloaded buffer (`OVERSCAN = 2`).
   - Menu bar clearance (`top: 60px !important`).
   - Fisher-Yates non-repeating shuffle permutation queue.
   - Draggable detached Picture-in-Picture (PiP) and browser native PiP.
6. **`FolderProfileView` (Instagram-Style Directory Profile & Video Wall):**
   - Social-media creator profile layout with folder avatar, gradient ring, bio, and 3 metric columns.
   - Collapsible Subfolders Drawer (`▶ Subfolders in [Path] (count)`).
   - Flush 3-column portrait video wall with zero border gaps.

---

## 3. Summary of Recent Critical Additions (v3.0.2)

| Feature / Fix | Technical Solution & Architecture |
|---|---|
| **Title Line & Toggle Alignment** | Standardized `.sfm-section-title-box` to 195px, label to 115px, count badge to 48px, pair 1 (`.sfm-pill-subfolders`) to 175px, pair 2 (`.sfm-pill-foldersort`) to 160px, and toggle 3 (`.sfm-pill-hideempty`) to 110px with uniform 0.5rem margins. |
| **Interactive Status Buttons** | Converted Line 2 status indicators into interactive buttons hooked to `handleToggleIncludeSubfolders` and `handleToggleSortByFolderFirst`. |
| **Clean SVG Vector Icons** | Replaced emojis with inline SVG components (`IconSettings`, `IconAlert`, `IconScissors`, `IconGlobe`, `IconSparkles`, `IconCheck`, `IconRefresh`). |
| **Menu Bar Clearance** | Configured `.sfm-reel-modal-backdrop` to `top: 60px !important` and `.sfm-reel-actions-column` to `top: 24px !important` to clear the Stash top navigation bar. |
| **Slim Folder List Spacing** | Configured `.sfm-folder-list-grid` with `5px` gap and `0.35rem 0.65rem` row padding for compact, balanced directory browsing. |
| **Stash Community Index Compliance** | Formatted `index.yml` following the official Stash community plugin schema with exact versioning and SHA256 fields. |

---

## 4. Automated Test Suites (All Passing)

1. `test_components.js`: Core components render test.
2. `test_v3.0.0_native_card_and_scene_detail.js`: Native card overlays, directory chips, and scene detail hierarchy.
3. `test_v3.0.0_native_embedded_cards.js`: Native container mounting.
4. `test_v3.0.1_title_line_alignment.js`: Title line alignment, status indicator synchronization, and menu bar clearance.

---

## 5. Host Deployment Script

On the host machine (`/home/hed/Projects/stash-plugins`), running `bash /home/hed/Projects/apply_and_push_v3.0.2.sh` automates:
1. Applying `js.patch` to `file_manager.js`.
2. Packaging `stash_file_manager.zip` and updating the SHA256 in `index.yml`.
3. Updating the live Stash Docker plugin directory (`/hed-nas/docker/stashapp/stash-config/plugins/stash_file_manager/`).
4. Running verification test suites.
5. Committing, tagging `v3.0.2`, and pushing to GitHub.

---

## 6. Architecture Blueprint for v3.1.0

* **Feature 3: Native Viewport Layout Container Mounting:** Mount the File Manager directly inside Stash's native `.main-container` layout alongside top navigation headers rather than solely as a full-screen overlay, providing a user toggle between Embedded and Fullscreen mode.
* **Performer & Studio Directory Aggregation:** Automatically compute dominant directory affinities for Performers and Studios, injecting path badges on Performer/Studio detail pages.

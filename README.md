# Stash Plugins Repository

![Stash Path File Manager Hero](./assets/hero_banner.svg)

A collection of community plugins for [Stash](https://github.com/stashapp/stash).

---

## 📦 Stash Plugin Repository Source (One-Click Install)

You can add this repository directly to Stash to browse, install, and update plugins with a single click:

1. Open Stash and go to **Settings → Plugins**.
2. Under the **Available Plugins** section, click **Add Source**.
3. Fill out the fields:
   - **Name:** `Stash Community Plugins`
   - **Source URL:** `https://raw.githubusercontent.com/daailouivan/stash-plugins/main/index.yml`
4. Click **Confirm / Add**.
5. Select any plugin from **Available Plugins** and click **Install**!

---

## 🛠 Available Plugins

### [Path File Manager](./stash_file_manager) (v2.0)

A high-performance directory navigation file manager for Stash:
* **📁 Collapsible Sections & 3 Folder Views:** Click `Subfolders` or `Files / Scenes` titles to collapse/expand lists; switch between Compact Cards Grid, Space-Efficient List Strip (30+ folders per screen), and Detail Table View with direct Stash Grid and Scan actions.
* **🔍 Dynamic Card Size Sliders:** Smooth real-time thumbnail zoom sliders for both Folder cards and Scene cards with persistent `localStorage` memory.
* **🎬 Protocol-Aware Video Player:** Direct stream passthrough, HLS segmented adaptive streaming, and WebM progressive container transcodes with full timeline duration and seek support.
* **📱 Binge-Style Directory Reel with Pull Threshold:** Drag/pull threshold animation preventing accidental trackpad video skips; double-click left/right for ±10s seek without browser fullscreen hijack.
* **⧉ Draggable Floating PIP Player:** Mini-player window draggable anywhere across the screen while keeping the file manager fully interactive.
* **🧭 Navigation History & In-App Back/Up:** Dedicated **◀ Back** and **▲ Up** buttons plus seamless browser Back/Forward synchronization with zero history corruption or stuck pages.
* **🔍 Regex Filename Parser:** Folder-scoped pattern tester with live matching preview tables.
* **⚡ In-Memory Trie Cache:** Instant directory loading using `sessionStorage` and IndexedDB caching.

---


---

## 📋 Changelog & Development History

### [v2.3.0] — 2026-09-23 09:12:00
* **Fixed Plugin Manifest YAML Schema:** Resolved Stash plugin loader unmarshal errors (`field date not found in type plugin.Config` and `cannot unmarshal !!str into []string`) by removing the extraneous `date` key from `stash_file_manager.yml` (reserved exclusively for `index.yml`) and declaring `ui.javascript` and `ui.css` as YAML string arrays.
* **Native Stash Plugin Settings (`Settings → Plugins → Path File Manager`):** Added a full settings schema exposed directly in Stash's native UI:
  * `default_transcode_method`: Configurable default playback stream mode (`direct` raw stream, `webm` progressive transcode, or `hls` adaptive stream).
  * `root_library_path`: Custom library root folder path override.
  * `folder_view_mode` & `scene_view_mode`: Default layout modes (`cards`, `list`, `details` / `cards`, `table`).
  * `folder_card_size` & `scene_card_size`: Default zoom slider values.
  * `default_sort_field` & `default_sort_direction`: Default scene sorting criteria and order.
  * `remember_last_path`: Toggle to resume at the last visited folder across sessions.
  * `auto_rebuild_tree_on_start`: Toggle to automatically rebuild the directory tree on plugin load.
* **Native Stash Plugin Tasks (`Settings → Tasks → Plugin Tasks`):** Introduced `sfm_tasks.py` backend runner implementing standard Stash task operations:
  * `Rescan Library and Rebuild Tree`: Crawls library directories, counts scenes, and rebuilds local directory cache.
  * `Reset Plugin Settings to Defaults`: Restores factory default settings via Stash's `configurePlugin` GraphQL mutation and clears caches for troubleshooting.
  * `Initialize Plugin Configuration`: Verifies library paths and seeds configuration into Stash.
* **In-App Settings & Tasks Dialog:** Added a `⚙️ Settings` button to the File Manager toolbar that opens a settings modal allowing users to inspect active settings, save changes directly to Stash's `config.yml`, trigger tree rebuilds, and access Stash Settings pages.

### [v2.2.0] — 2026-09-23 08:17:48
* **Unified Section Headers:** Relocated the Scene view toggle (`⊞ Cards` / `☰ Table`) from the top toolbar to the `Files / Scenes` section header line, creating visual and behavioral uniformity with the `Subfolders` section controls.
* **Relocated Select All Control:** Moved the `Select All` / `Deselect All` button directly alongside the scene count and selection badge.
* **Dynamic Card Size Sliders:** Added smooth thumbnail size zoom sliders for both **Folder Cards** (120px–300px) and **Scene Cards** (160px–420px), utilizing responsive CSS Grid containers (`grid-template-columns: repeat(auto-fill, minmax(...))`) with `localStorage` persistence.
* **Cleaned Top Toolbar:** Streamlined the top bar to focus purely on search query filtering and folder/scene sorting.

### [v2.1.1] — 2026-09-23 07:52:04
* **Transcode Delivery Architecture Re-evaluation:** Decoupled segmented streaming protocols (**HLS**) from progressive container transcodes (**WebM** / **MP4**).
* **Native & MSE HLS Engine:** Added client-side detection for native WebKit HLS and Media Source Extensions (MSE via `hls.js`), with automated graceful fallback to progressive WebM containers when MSE is unavailable.
* **API Key Preservation:** Explicitly carried query parameters (`?apikey=...`) across all transcode and direct stream requests for authenticated Stash instances.

### [v2.1.0] — 2026-09-23 07:31:13
* **Redesigned Clean Player UI:** Eliminated redundant duplicate buttons (multiple PiP triggers, repeated VLC links, duplicate link buttons) into a single, cohesive header toolbar.
* **Double-Click Seek Fix:** Resolved native browser fullscreen interception on double-click by attaching gesture handlers with `e.preventDefault()`, restoring reliable left/right 10s seek.
* **Binge-Style Scroll Pull Threshold:** Replaced instantaneous wheel triggers with an accumulated drag/pull delta (140px threshold) with spring-back easing and directional destination pill previews.
* **Semantic Version Tagging:** Added version identifiers to all release commits and index manifests.

### [v2.0.4] — 2026-09-23 03:25:46
* **Navbar Line-Wrap Fix:** Fixed button injection in `PluginApi.patch.instead("MainNavBar.MenuItems")` by inserting directly into `.row` children rather than creating a block-level sibling outside the flex row.

### [v2.0.3] — 2026-09-23 01:45:00
* **Stash Package Installer Integration:** Switched distribution packaging to zip archives with SHA256 checksums in `index.yml`.

### [v2.0.2] — 2026-09-22 22:30:00
* **Collapsible Sections:** Added interactive chevron toggle controls to expand and collapse `Subfolders` and `Files / Scenes`.
* **Stability:** Wrapped components in React Error Boundaries to prevent rendering crashes.

### [v2.0.1] — 2026-09-22 18:15:00
* **In-App History Navigation:** Added dedicated **◀ Back** and **▲ Up** toolbar buttons with browser history synchronization.
* **Stream Authentication:** Resolved playback failures on secure Stash instances by resolving authenticated stream paths.

### [v2.0.0] — 2026-09-22 12:00:00
* **Customizable Folder Views:** Introduced 3 folder views: Compact Cards, Horizontal List Strip, and Detail Table with direct Stash Grid and Scan triggers.
* **Binge-Style Directory Reel:** Vertical reel navigation through folder contents using mouse wheel, touch swipe, and keyboard shortcuts.
* **Draggable Floating PIP:** Mini-player window draggable anywhere across the screen while keeping folder browsing interactive.

### [v1.1.1] — 2026-09-21 16:40:00
* **PluginApi.patch Integration:** Adopted Stash's native UI plugin patching mechanism for responsive navbar integration.

### [v1.1.0] — 2026-09-21 11:20:00
* **Multi-Selection & Batch Actions:** Added scene multi-selection with floating bulk action bar and detailed table view.

### [v1.0.2] — 2026-09-21 08:30:00
* **Navbar Peer Injection:** Ensured the navigation bar item is inserted as a true peer in the navbar container.

### [v1.0.1] — 2026-09-20 20:15:00
* **UI Polish:** Refined navigation bar button styling and workspace theme aesthetics.

### [v1.0.0] — 2026-09-20 14:00:00
* **Initial Release:** Hierarchical directory navigation using client-side in-memory trie caching, session storage persistence, and regex filename parsing.

---

## 🗺️ Roadmap & Future Architecture

### 📍 Phase 1: Core Navigation & Player Foundation (Complete)
- [x] Hierarchical path trie indexing and client-side session caching.
- [x] Multi-selection with floating batch action bar and detail table view.
- [x] Compact customizable folder views (Cards, List, Detail Table).
- [x] Binge-style directory reel player with pull threshold & floating draggable PiP.
- [x] Protocol-aware transcode delivery hierarchy (Direct Play, HLS Segmented, WebM Container).
- [x] Dynamic thumbnail card size zoom sliders with local storage persistence.

### 📍 Phase 2: Native View Integration (Current Architectural Focus)
- [ ] **Transition from Overlay Layer to Native Routed View:** Re-architecting the workspace from a `position: fixed` overlay layer into an integrated page view mounted inside Stash's native main container (`/scenes?view=folder` or `/plugin/file-manager`).
- [ ] **Native Navigation Bar & Settings Retention:** Retaining Stash's top navigation bar, global search, background task queue spinners, and user settings dropdown at all times during folder browsing.
- [ ] **Theme Parity:** Seamless automatic glass and accent adaptation with community themes (e.g., Refract, Dark, Nord).

### 📍 Phase 3: Advanced Folder Metadata & Media Management (Planned)
- [ ] **Folder Poster Art & Custom Covers:** Ability to select any scene poster or image as a persistent folder thumbnail cover.
- [ ] **In-Folder Filter Parity:** Filtering items inside a specific folder by Performer, Tag, Studio, or Rating without leaving the directory hierarchy.
- [ ] **Directory Playlist Queue:** One-click queueing of entire directory trees into Stash's native playback queue or MultiView.

## 💻 Manual Git Installation

If you prefer installing via Git CLI:

**Linux / macOS / Docker:**
```bash
cd ~/.stash/plugins
git clone https://github.com/daailouivan/stash-plugins.git stash_file_manager
```

**Windows (PowerShell):**
```powershell
cd $env:USERPROFILE\.stash\plugins
git clone https://github.com/daailouivan/stash-plugins.git stash_file_manager
```

After cloning, open Stash, navigate to **Settings → Plugins**, and click **Reload Plugins**.

# Project: Stash File Manager v4.0.0

## Architecture

Stash File Manager (`stash_file_manager`) is upgraded from `v3.2.1` to `v4.0.0` by splitting the 11,308-line monolithic `file_manager.js` into **5 dependency-ordered modules** loaded by `stash_file_manager/stash_file_manager.yml` (`ui.javascript`), paired with a modernized `file_manager.css`, native Stash `/plugin/file-manager` routing, a Unified Metadata Studio, a consolidated customizable Table view with bidirectional sort & video wall synchronization, and an upgraded GraphQL catalog (`scenes_index_v8`).

### Critical Module Format Constraint (Stash `ui.javascript` & Node `vm`)
Upstream Stash (`ui/v2.5/src/hooks/useScript.tsx` & `plugins.tsx`, confirmed against NAS plugin `sceneTagger`) injects `ui.javascript` entries as classic `<script src="..." defer>` tags (`async = false`) **without** `type="module"`. Likewise, the project's test suite executes plugin scripts via Node `vm.runInContext(...)`.
- Therefore, the 5 split modules (`sfm_core.js`, `sfm_metadata_modal.js`, `sfm_player.js`, `sfm_views.js`, `sfm_native.js`) **MUST** be clean, self-contained IIFE modules (`(function () { "use strict"; ... })();`) with **zero** top-level `import` / `export` syntax.
- Load order in `stash_file_manager.yml`:
  1. `sfm_core.js`
  2. `sfm_metadata_modal.js`
  3. `sfm_player.js`
  4. `sfm_views.js`
  5. `sfm_native.js`
- Inter-module communication flows exclusively through the shared namespace `window.__SFM__` (alongside existing public globals `window.__SFM_GLOBAL_CACHE__` and `window.PluginApi.Filemanager`).

### Data & Routing Flow
- **Routing (R1)**: `PluginApi.register.route("/plugin/file-manager", FileManagerView)` renders File Manager natively inside Stash's router outlet without `#sfm-workspace-root` or `data-sfm-active` sibling hiding. `FilesNavButton` uses `PluginApi.libraries.ReactRouterDOM.NavLink` (`to="/plugin/file-manager"`, `activeClassName="active"`) with a History API fallback. Folder paths, view modes, and target scenes flow via URL search params (`/plugin/file-manager?path=...&view=...&scene=...`) synchronized with `popstate` and browser history.
- **Catalog (R4)**: `ensureCatalog()` (`scenes_index_v8`) fetches full `Scene` and `VideoFile` attributes via GraphQL, preserves all fields in `compact` IDB persistence and `window.__SFM_GLOBAL_CACHE__.scenes`, builds `PathTrie`, and supports `patchCatalogSceneInPlace()` for instant updates after inline edits or `organized` toggles.
- **UI Layers**: `sfm_metadata_modal.js` provides the 4-tab Unified Metadata Studio; `sfm_player.js` provides `FolderProfileView` (Video Wall) and `BingeReelPlayerModal`; `sfm_views.js` provides `FileManagerView`, `SceneCard`, consolidated customizable `SceneTableView`, and `SettingsAndTasksModal`; `sfm_native.js` registers routes, navbar integration, and native Stash card/detail overlays/fallbacks.

---

## Code Layout

| File Path | Owner Milestone | Purpose |
|---|---|---|
| `stash_file_manager/sfm_core.js` | M1 | Bootstrap, IDB (`scenes_index_v8`), GraphQL helpers, `PathTrie`, `ensureCatalog`, `patchCatalogSceneInPlace`, SVG icons, URL query helpers, deterministic shuffle/sort/filter helpers |
| `stash_file_manager/sfm_metadata_modal.js` | M2 | Unified Metadata Studio (`FilenameParserModal` with 4 tabs: `scrape`, `pattern`, `bulk_edit`, `rename`; `Organized` checkbox; `Code` column; sortable headers; attribute filters; inline row editor; `BatchMetadataModal` compat alias) |
| `stash_file_manager/sfm_player.js` | M3 | `FolderProfileView` (with `random` sort, Reshuffle, `sceneSort` sync) and `BingeReelPlayerModal` |
| `stash_file_manager/sfm_views.js` | M4 | `SceneCard`, consolidated `SceneTableView` (`SceneNamesTableView` compat alias, default 10 columns, `⚙ Columns` drawer + `localStorage`, header sort sync), `SettingsAndTasksModal`, `FileManagerView` (query-param routing, attribute filter bar, `random` sort + Reshuffle) |
| `stash_file_manager/sfm_native.js` | M5 | Native `/plugin/file-manager` route registration, `NavLink` navbar button, native card/detail overlays & DOM fallbacks, `window.__SFM_OPEN_PARSER__`, test export hooks |
| `stash_file_manager/file_manager.css` | M5 | Cleaned stylesheet without `#sfm-workspace-root` sibling-hiding hacks; CSS custom properties, sticky table headers, sort indicators, column drawer, inline editor, filter bar, responsive layout |
| `stash_file_manager/stash_file_manager.yml` | M6 | Manifest bumped to `version: "4.0.0"`, `ui.javascript` updated to the 5 `sfm_*.js` modules |
| `stash_file_manager/file_manager.js` | M6 | Legacy monolith — deleted in M6 after M1–M5 complete and tests migrate |
| `stash_file_manager/sfm_tasks.py` | Unchanged (unless bug exposed) | Python task runner (`rebuild`, `reset`, `init`, `rename`) |
| `test_*.js` (root test scripts) | M6 / E2E | Updated to load the 5 modules in `stash_file_manager.yml` order and reflect R1–R5 |
| `tests/e2e/` (or E2E runner) | E2E Testing Track | Opaque-box requirement-driven E2E test suite (Tiers 1–4) + `TEST_INFRA.md` / `TEST_READY.md` |
| `stash_file_manager.zip` & `index.yml` | M6 / M7 | Release zip (top-level `stash_file_manager/`) and repo index (`version: "4.0.0"`, `sha256`) |

---

## Feature Inventory

Every feature from `ORIGINAL_REQUEST.md` (R1–R5) and the Survey phase is assigned to a Milestone below.

| # | Feature | Description | Milestone | Source |
|---|---|---|---|---|
| F1 | Native `/plugin/file-manager` route | Register `/plugin/file-manager` via `PluginApi.register.route`, remove `#sfm-workspace-root` & `data-sfm-active` sibling hiding | M4, M5 | R1, Survey 1 |
| F2 | Navbar `NavLink` integration | Update `FilesNavButton` to use `ReactRouterDOM.NavLink` (`to="/plugin/file-manager"`, `activeClassName="active"`) with History fallback | M5 | R1, Survey 1 |
| F3 | URL query-param folder navigation | Read/write `/plugin/file-manager?path=...&view=...&scene=...` with browser `popstate` back/forward history | M1, M4 | R1, Survey 1 |
| F4 | Native card/detail route navigation | Update `NativeSceneCardOverlay`, `NativeSceneDetailDirectoryHierarchy`, `NativeSceneDetailReelButton`, and DOM fallback guards (`pathname.startsWith("/plugin/file-manager")`) | M5 | R1, Survey 1 |
| F5 | Scraper `Organized` column | Interactive checkbox (`scene.organized`) in Metadata Studio table saving via `sceneUpdate` + `patchCatalogSceneInPlace` | M2 | R2, Survey 2 |
| F6 | Scraper `Code` column | Display studio scene code (`scene.code` / scraped `code`) in Metadata Studio table | M2 | R2, Survey 2 |
| F7 | Scraper click-to-sort headers | All Metadata Studio table headers click-to-sort asc/desc with `▲`/`▼` indicators | M2 | R2, Survey 2 |
| F8 | Scraper attribute filter bar | Filter by `Organized` (All/Organized/Unorganized), `Missing Fields` (Title, Studio, Performers, Date, Code, Tags, Cover), quick text search, plus match filter | M2 | R2, Survey 2 |
| F9 | Merged Bulk Edit tab | Merge `BatchMetadataModal` into Unified Metadata Studio as `bulk_edit` tab alongside `scrape`, `pattern`, `rename` (keeping `BatchMetadataModal` compat alias) | M2 | R2, Survey 2 |
| F10 | Inline row `Edit` editor | Row `Edit` button in Metadata Studio `Actions` opening inline editor (Title, Studio, Date, Code, Organized, Performers, Tags, Rating) saving via `sceneUpdate` | M2 | R2, Survey 2 |
| F11 | Consolidated Table view mode | Merge `SceneTableView` & `SceneNamesTableView` into single Table view (`"table"`) alongside Grid Cards (`"grid"`), normalizing `"list"`/`"names"` & fixing `SettingsAndTasksModal` | M4 | R3, Survey 1 & 2 |
| F12 | Default Table columns parity | Default Table columns: `Checkbox \| Cover \| Filename \| Title \| Date \| Studio \| Code \| Performers \| Organized \| Actions` (with interactive `Organized` toggle & inline edit) | M4 | R3 |
| F13 | Synchronized Table header <-> `sceneSort` | Bidirectional sync between Table header clicks (`▲`/`▼`) and `sceneSort` dropdown | M4 | R3, Survey 2 |
| F14 | True Randomize (`random`) + Reshuffle | Add `random` sort to `sceneSort` with **Reshuffle** button and stable seed/order | M1, M4 | R3, Survey 2 |
| F15 | Video Wall `random` & sort sync | Add `random` sort + Reshuffle to `FolderProfileView` (`profileSort`) synced with `sceneSort` / shuffle seed | M3, M4 | R3, Survey 1 & 2 |
| F16 | Main browsing attribute filter bar | Filter main folder view by `Organized` (All/Organized/Unorganized), missing metadata, resolution tier, minimum rating | M1, M4 | R3, Survey 2 |
| F17 | `⚙ Columns` configuration drawer | Popover/drawer to toggle visible columns, reorder columns, and reset to defaults, persisted in `localStorage` | M4 | R4, Survey 2 |
| F18 | Extended optional Table columns | Support `Tags`, `Rating`, `O-Counter`, `Play Count`, `Duration`, `Resolution`, `Video Codec/Format`, `Bitrate/FPS`, `File Size`, `Created/Updated/Last Played`, `Director`, `URLs/StashIDs`, `Folder Path` | M4 | R4, Survey 2 |
| F19 | GraphQL catalog `scenes_index_v8` | Expand `GetScenePaths`, `FindSceneFull`, `GetScenesByIds` with all R4 fields, fix `compact` to retain all fields, bump cache key to `scenes_index_v8` | M1, M5 | R4, Survey 1 & 2 |
| F20 | 5-module codebase split | Split `file_manager.js` into `sfm_core.js`, `sfm_metadata_modal.js`, `sfm_player.js`, `sfm_views.js`, `sfm_native.js` | M1–M5 | R5, Survey 1 & 3 |
| F21 | CSS cleanup & polish | Remove sibling-hiding hacks, adopt CSS custom properties, sticky table headers, contrast & responsive layout | M5 | R5, Survey 1 |
| F22 | Manifest, test migration & syntax checks | Update `stash_file_manager.yml` to `4.0.0`, remove `file_manager.js`, pass `node --check` and all `test_*.js` | M6 | R5, Survey 3 |
| F23 | Release packaging & NAS deploy | Build `stash_file_manager.zip` (top-level `stash_file_manager/`), update `index.yml` SHA-256, sync to NAS preserving `.sfm_rename_result.json` | M6, M7 | R5, Survey 3 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M1 | Core & Catalog v8 (`sfm_core.js`) | F3 (URL helpers), F14 (shuffle helpers), F16 (filter helpers), F19 (`scenes_index_v8` & `patchCatalogSceneInPlace`), F20 (`sfm_core.js`) | none | DONE (`stash_file_manager/sfm_core.js`) |
| M2 | Unified Metadata Studio (`sfm_metadata_modal.js`) | F5, F6, F7, F8, F9, F10, F20 (`sfm_metadata_modal.js`) | M1 | DONE (`stash_file_manager/sfm_metadata_modal.js`) |
| M3 | Player & Video Wall (`sfm_player.js`) | F15 (`FolderProfileView` random & sync), F20 (`sfm_player.js`) | M1 | DONE (`stash_file_manager/sfm_player.js`) |
| M4 | Consolidated Views & Table (`sfm_views.js`) | F1 (`FileManagerView` route container), F3, F11, F12, F13, F14, F15 (wiring), F16, F17, F18, F20 (`sfm_views.js`) | M1 (uses M2/M3 contracts) | IN_PROGRESS (`16534ba7`) |
| M5 | Native Integration & CSS (`sfm_native.js`, `file_manager.css`) | F1, F2, F4, F19 (`FindSceneFull`/`GetScenesByIds`), F20 (`sfm_native.js`), F21 (`file_manager.css`) | M1 (uses M2/M4 contracts) | IN_PROGRESS (`a3638a34`) |
| M6 | Manifest, Tests, Packaging & NAS Deploy | F22, F23 (`stash_file_manager.yml` v4.0.0, delete `file_manager.js`, migrate `test_*.js`, build zip, update `index.yml`, NAS sync) | M1, M2, M3, M4, M5 | PLANNED |
| M7 | Final Milestone (E2E Tiers 1–4 + Tier 5 Hardening) | Pass 100% of E2E suite (`TEST_READY.md`) Tiers 1–4 sequentially, then Tier 5 white-box adversarial coverage hardening, then final zip/`index.yml`/NAS verification | M6, E2E Track (`TEST_READY.md`) | PLANNED |
| E2E | E2E Testing Track (Parallel) | Opaque-box Node E2E test harness & Tiers 1–4 test cases derived from `ORIGINAL_REQUEST.md` & `Feature Inventory`; publishes `TEST_INFRA.md` & `TEST_READY.md` | none (runs parallel) | DONE (`TEST_READY.md`, 272 tests) |

---

## Interface Contracts

### `sfm_core.js` → `window.__SFM__`
`sfm_core.js` initializes `window.__SFM__ = window.__SFM__ || {}` and `window.__SFM_GLOBAL_CACHE__ = window.__SFM_GLOBAL_CACHE__ || { trie: null, scenes: null, timestamp: 0 }` and attaches:
- React & PluginApi refs: `PluginApi`, `React`, `ReactDOM`, `register`, `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`
- Constants & Cache: `IDB_NAME`, `IDB_VERSION`, `IDB_STORE`, `CACHE_KEY` (`"scenes_index_v8"`), `CACHE_TTL_MS`, `openIDB()`, `idbGet(key)`, `idbSet(key, val)`, `idbClear()`, `clearCachedScenes()`, `patchCatalogSceneInPlace(updatedScene)`
- GraphQL & Settings: `gqlFetch(query, variables)`, `fetchStashPluginSettings()`, `saveStashPluginSettings(values)`
- Utilities & Error Boundary: `formatBytes(bytes)`, `formatDuration(secs)`, `formatSeconds(secs)`, `SafeErrorBoundary`, `icons` (all 26+ SVG icon components, also exposed by name on `window.__SFM__.icons`)
- Catalog & Trie: `resolveLibraryRoot(stashes, configuredRoot)`, `PathTrie`, `ensureCatalog(forceBypassCache, onProgress)`, `getAllDescendantScenes(node)`, `deriveFolderFromPath(filePath)`, `resolveSceneFolder(scene)`
- Routing URL helpers (R1):
  - `normalizePath(p)`
  - `buildRouteUrlForPath(path, view, sceneId)` -> returns `/plugin/file-manager` or `/plugin/file-manager?path=...` (with `view`/`scene` params if non-null)
  - `parseQueryState(searchStr)` -> returns `{ path, view, sceneId }` from URL search params (with safe fallback if legacy `#file-manager?path=...` hash is encountered)
  - `navigateToPluginRoute(url)` -> uses Stash `ReactRouterDOM` history if available, else `window.history.pushState({}, "", url)` + `window.dispatchEvent(new PopStateEvent("popstate"))`
- Shared Sort, Shuffle & Filter helpers (R3, R4):
  - `createShuffledQueue(items, currentItem, seed)`
  - `sortScenesWithOrder(scenes, sortKey, shuffleSeed)` — deterministic Fisher-Yates / seeded PRNG shuffle when `sortKey === "random"`, plus `title_asc`, `title_desc`, `date_desc`, `date_asc`, `rating_desc`, `rating_asc`, `duration_desc`, `duration_asc`, `size_desc`, `size_asc`, `studio_asc`, `studio_desc`, `code_asc`, `code_desc`, `organized_desc`, `organized_asc`, `play_count_desc`, `o_counter_desc`, `created_at_desc`, `updated_at_desc`, `last_played_at_desc`, `resolution_desc`, `filename_asc`, `filename_desc`
  - `matchesSceneFilters(scene, filters)` — filters by `{ searchQuery, organizedFilter ("all"|"organized"|"unorganized"), missingFields (string[]), resolutionFilter, minRating }`

### `sfm_metadata_modal.js` ↔ `sfm_views.js` / `sfm_native.js`
- Registers on `window.__SFM__`: `FilenameParserModal`, `BatchMetadataModal` (compatibility wrapper defaulting `initialTab="bulk_edit"`), `MetadataStudioModal` (alias of `FilenameParserModal`).
- `FilenameParserModal` props: `{ currentFolder, currentPath = "", directScenes = [], selectedSceneIds = [], initialTab = "scrape", onClose, onApplied, onScenePatched }`
  - Tabs: `"scrape"` (`Scrape & Search`), `"pattern"` (`Filename Patterns`), `"bulk_edit"` (`Bulk Edit`), `"rename"` (`Bulk Rename Files`).
  - `onScenePatched(updatedScene)` notifies parent immediately after `organized` toggle or inline `Edit` save so table/cards update without losing modal state.

### `sfm_player.js` ↔ `sfm_views.js`
- Registers on `window.__SFM__`: `FolderProfileView`, `BingeReelPlayerModal`.
- `FolderProfileView` props:
  `{ currentFolderPath, currentFolderName, scenes, trie, onSelectScene, onClose, onNavigateToFolder, syncedSort, syncedShuffleSeed, onSortChange, onReshuffle }`
  - `profileSort` (`localStorage` key `"sfm_profile_scene_sort"`) supports `"random"` alongside standard sorts. When `syncedSort` is provided, initializes/syncs sort mode with `FileManagerView`; changing `profileSort` invokes `onSortChange(nextSort)` if provided, and clicking Reshuffle invokes `onReshuffle()` (or bumps local seed if standalone).
- `BingeReelPlayerModal` props:
  `{ scene, scenes, onSelectScene, onClose, onOpenProfile, folderName, currentPath, onNavigateToFolder }`

### `sfm_views.js` ↔ `sfm_native.js`
- Registers on `window.__SFM__`: `SceneCard`, `SceneTableView`, `SceneNamesTableView` (compatibility alias for `SceneTableView`), `SettingsAndTasksModal`, `FileManagerView`.
- `FileManagerView` props: `{ initialPath, location, history }` (optional — when mounted via `PluginApi.register.route("/plugin/file-manager", FileManagerView)`, reads `window.location.search` via `parseQueryState` and updates URL via `navigateToPluginRoute` on folder/view/scene changes and listens to `popstate`). Renders as a native Stash page container (`.sfm-native-page`, NO fullscreen modal backdrop or close-overlay button).
- `SceneTableView` props: `{ scenes, selectedIds, onToggleSelect, onToggleSelectAll, onPlay, onSceneClick, showFolderBadge, sortKey, sortDir, onHeaderSort, columnsConfig, onOpenColumnsConfig, onToggleOrganized, onInlineEditScene }`.
  - Persists column layout in `localStorage` key `"sfm_table_columns_v1"`.
  - Default visible columns: `Checkbox | Cover | Filename | Title | Date | Studio | Code | Performers | Organized | Actions`.

### `sfm_native.js` Exports & Test Compatibility
- Registers `/plugin/file-manager` via `PluginApi.register.route("/plugin/file-manager", FileManagerView)`.
- Registers `FilesNavButton` using `PluginApi.libraries?.ReactRouterDOM?.NavLink` (`to="/plugin/file-manager"`, `activeClassName="active"`) with safe fallback.
- Exports all major components/helpers onto `window.__SFM_GLOBAL_CACHE__` and `window.PluginApi.Filemanager`, plus `window.__SFM_TEST_EXPORTS__` hook support for Node `vm` tests, and logs `console.log("[PathFileManager] Initialized successfully with all enhanced features.");` at completion of `sfm_native.js`.

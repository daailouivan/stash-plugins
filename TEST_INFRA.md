# Test Infrastructure: Stash File Manager v4.0.0 E2E Suite

## Overview
- **Project**: Stash File Manager (`stash_file_manager`) v4.0.0
- **Runtime**: Pure Node.js `v26.13.1` stdlib (`fs`, `path`, `vm`, `crypto`, `assert`, `child_process`) + Python `3.14.8` for `sfm_tasks.py` integration checks. **Zero external npm dependencies**.
- **Methodology**: Opaque-box, requirement-driven 4-tier E2E testing loaded dynamically from `stash_file_manager/stash_file_manager.yml` (`ui.javascript` entries executed sequentially in an isolated Node `vm` context).

## Project Pattern Architecture

### 1. Dynamic Plugin Loader (`tests/e2e/harness.js`)
- Parses `stash_file_manager/stash_file_manager.yml` to discover `version`, `ui.javascript`, `ui.css`, `tasks`, and `settings`.
- Executes every declared `ui.javascript` file in order in a fresh `vm.createContext` sandbox (no test-only source injection or edits to `stash_file_manager/*`).
- Provides `reload()` to tear down the active VM context and spin up a fresh VM context sharing the same `localStorage` and `indexedDB` backing store (`idbBacking`), simulating browser page reloads.

### 2. Stateful React 16/18 Runtime & Tree Driver
- Lazy `React.createElement` VNode construction with a fiber-keyed reconciler supporting `useState`, `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useContext`, `createContext`, `Fragment`, `memo`, `forwardRef`, `React.Component` (`SafeErrorBoundary`), `ReactDOM.render`, `ReactDOM.unmountComponentAtNode`, and `ReactDOM.createPortal`.
- Deterministic async settling via `tree.flush()`, `tree.click(node)`, `tree.change(node, valueOrChecked)`, `tree.submit(node)`, and `tree.keyDown(node, key)`.
- Tree query API (`findBySelector` with descendant matching, `findByText`, `findAll`, `findOne`, `nodeText`, `text`).

### 3. Simulated Stash Browser Environment
- **`PluginApi`**:
  - `register.route(path, Component)` -> captured in `env.registeredRoutes` and mounted via `env.mountRoute(path)`.
  - `libraries.ReactRouterDOM` (`NavLink`, `Link`, `useHistory`, `useLocation`) with `omitReactRouterDOM: true` mode for History fallback testing.
  - `patch.instead`, `patch.after`, `patch.before` -> invoked via `env.invokePatched(target, props, baseResult)`.
  - `Event.addEventListener("stash:location")` -> triggered on route navigation and `popstate`.
- **URL & History**: Synchronized `window.location` (`pathname`, `search`, `hash`, `href`) and `window.history` (`pushState`, `replaceState`, `back`, `forward`) maintaining a real stack and dispatching `PopStateEvent("popstate")` and `"hashchange"`.
- **DOM**: `.main-container` with native sibling `.native-scenes-page`, `.navbar-nav`, `querySelector`/`querySelectorAll`, `classList`, `dataset`, `attributes`.
- **Storage**: `localStorage`, `sessionStorage`, and async in-memory `indexedDB` (`createMemoryIndexedDB`) persisting across `env.reload()`.

### 4. GraphQL Mock Server (`createGraphQLMock`)
- Intercepts `/graphql` `fetch` calls and records `env.graphql.gqlCalls`.
- Supports `configuration`, `configurePlugin`, `findScenes` (full & `scene_ids`), `findScene` (with `sceneStreams`), `findStudios`/`studioCreate`, `findPerformers`/`performerCreate`, `findTags`/`tagCreate`, `sceneUpdate`, `bulkSceneUpdate`, `listScrapers`, `scrapeSingleScene` & `scrapeSceneURL` (with concurrency tracking), `runPluginTask`, `runPluginOperation`, and `findJob`.
- Supports `faultRules` for network/GraphQL error injection in Tier 2 & Tier 4 resilience tests.

### 5. Packaging & Backend Helpers
- Manifest/index YAML parsers (`parsePluginManifest`, `parseIndexYml`), `computeFileSha256`, `listZipEntries` (`unzip -Z1`), CSS inspection, and `sfm_tasks.py` subprocess execution against isolated `/tmp` directories.

## File Inventory
| File | Purpose |
|---|---|
| `tests/e2e/harness.js` | Dynamic manifest loader, React runtime, DOM/Router/IDB/History mocks, GraphQL server |
| `tests/e2e/fixtures.js` | Multi-folder scene catalog (`101`–`107`), studios, performers, tags, scrapers, DB factory |
| `tests/e2e/helpers.js` | Shared opaque-box UI interaction & table/filter/modal helpers |
| `tests/e2e/tier1_part1.js` | Tier 1 happy-path tests for F1–F12 (60 tests) |
| `tests/e2e/tier1_part2.js` | Tier 1 happy-path tests for F13–F23 (55 tests) |
| `tests/e2e/tier2_part1.js` | Tier 2 boundary/corner/negative tests for F1–F12 (60 tests) |
| `tests/e2e/tier2_part2.js` | Tier 2 boundary/corner/negative tests for F13–F23 (55 tests) |
| `tests/e2e/tier3_combinations.js` | Tier 3 pairwise cross-feature interaction tests (28 tests) |
| `tests/e2e/tier4_scenarios.js` | Tier 4 end-to-end real-world user workflows (14 tests) |
| `tests/e2e/run_e2e.js` | CLI suite runner (`--tier=`, `--feature=`, `--grep=`, `--verbose`, `--json`) |

## Running Tests
```bash
# Run full 272-test E2E suite
node tests/e2e/run_e2e.js

# Run individual tiers sequentially
node tests/e2e/run_e2e.js --tier=1
node tests/e2e/run_e2e.js --tier=2
node tests/e2e/run_e2e.js --tier=3
node tests/e2e/run_e2e.js --tier=4

# Filter by feature or test ID regex
node tests/e2e/run_e2e.js --feature=F14 --verbose
node tests/e2e/run_e2e.js --grep="T4-"
```

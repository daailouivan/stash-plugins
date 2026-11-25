# TEST_READY — Stash File Manager v4.0.0 E2E Suite

## Status
**READY** — Opaque-box 4-tier E2E test suite implemented and syntax-verified (`node --check` passes on all files in `tests/e2e/`).

## Execution Command
```bash
node tests/e2e/run_e2e.js
```
- **Expected Exit Code (once v4.0.0 implementation M1–M6 is complete)**: `0` (all 272 tests passing).
- **Tier-by-tier execution (recommended for M7 sequential verification)**:
  - `node tests/e2e/run_e2e.js --tier=1`
  - `node tests/e2e/run_e2e.js --tier=2`
  - `node tests/e2e/run_e2e.js --tier=3`
  - `node tests/e2e/run_e2e.js --tier=4`

## Coverage Summary
| Tier | Description | Count | Target Minimum |
|---|---|---|---|
| Tier 1 | Feature Coverage (F1–F23, 5 tests/feature) | 115 | >= 115 |
| Tier 2 | Boundary, Corner & Negative Cases (F1–F23, 5 tests/feature) | 115 | >= 115 |
| Tier 3 | Pairwise Cross-Feature Combinations | 28 | >= 25 |
| Tier 4 | Real-World End-to-End Workflows | 14 | >= 12 |
| **Total** | **All Tiers** | **272** | **>= 267** |

## Feature Checklist (F1–F23)
| Feature | Description | Tier 1 | Tier 2 | Tier 3/4 |
|---|---|---|---|---|
| F1 | Native `/plugin/file-manager` route | 5 | 5 | T3-01, T3-02, T4-01, T4-06 |
| F2 | Navbar `NavLink` integration | 5 | 5 | T3-01, T3-03, T4-01 |
| F3 | URL query-param folder navigation | 5 | 5 | T3-02, T3-04, T3-05, T4-01 |
| F4 | Native card/detail route navigation | 5 | 5 | T3-03, T3-06, T3-27, T4-06, T4-07 |
| F5 | Scraper `Organized` column | 5 | 5 | T3-07, T3-08, T4-02, T4-07, T4-12 |
| F6 | Scraper `Code` column | 5 | 5 | T3-09, T4-02, T4-07 |
| F7 | Scraper click-to-sort headers | 5 | 5 | T3-09, T3-10, T4-02 |
| F8 | Scraper attribute filter bar | 5 | 5 | T3-07, T3-10, T3-11, T3-25, T4-02, T4-09 |
| F9 | Merged Bulk Edit tab | 5 | 5 | T3-11, T3-12, T3-26, T4-03 |
| F10 | Inline row `Edit` editor | 5 | 5 | T3-13, T3-14, T3-15, T3-25, T4-02, T4-07, T4-12 |
| F11 | Consolidated Table view mode | 5 | 5 | T3-04, T3-16, T4-04, T4-08 |
| F12 | Default Table columns parity | 5 | 5 | T3-08, T3-13, T3-17, T4-04, T4-12 |
| F13 | Synchronized Table header <-> `sceneSort` | 5 | 5 | T3-14, T3-18, T3-19, T4-04 |
| F14 | True Randomize (`random`) + Reshuffle | 5 | 5 | T3-18, T3-20, T4-05 |
| F15 | Video Wall `random` & sort sync | 5 | 5 | T3-06, T3-20, T3-21, T4-05, T4-13 |
| F16 | Main browsing attribute filter bar | 5 | 5 | T3-05, T3-15, T3-21, T3-22, T4-05, T4-11 |
| F17 | `⚙ Columns` configuration drawer | 5 | 5 | T3-16, T3-17, T3-22, T3-23, T4-04 |
| F18 | Extended optional Table columns | 5 | 5 | T3-19, T3-23, T3-24, T4-04, T4-11 |
| F19 | GraphQL catalog `scenes_index_v8` | 5 | 5 | T3-12, T3-24, T3-27, T4-04, T4-08, T4-12 |
| F20 | 5-module codebase split | 5 | 5 | T3-28, T4-14 |
| F21 | CSS cleanup & polish | 5 | 5 | T4-13, T4-14 |
| F22 | Manifest, test migration & syntax checks | 5 | 5 | T3-28, T4-14 |
| F23 | Release packaging & NAS deploy | 5 | 5 | T3-26, T4-03, T4-14 |

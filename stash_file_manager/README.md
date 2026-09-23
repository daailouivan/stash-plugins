# Stash Path File Manager

A high-performance, path-based file manager navigation plugin for [Stash](https://github.com/stashapp/stash).

## Key Features

1. **⚡ Large Library Progressive Indexing & Caching:**
   - Caches your parsed library hierarchy in browser `sessionStorage` for near-instant opening on subsequent visits.
   - Re-index and cache-bust with one click using the **"🔄 Rescan"** button.

2. **🔍 Folder-Scoped Filename Regex Parser:**
   - Test and execute regular expression pattern matching scoped strictly to scenes inside the active folder.
   - Built-in presets for common scene filename schemes (`YYYY-MM-DD Title`, `Studio - Title`, `Studio - Performer - Title`).
   - Live interactive match preview table displaying extracted titles, dates, studios, and performers before applying changes.

3. **🔎 In-Workspace Real-Time Search & Sorting:**
   - Instant search input filtering folders, scene titles, studios, performers, and filenames as you type.
   - Folder sorting: Name (A-Z / Z-A) and Scene Count (High-Low / Low-High).
   - Scene sorting: Title (A-Z / Z-A), Date (Newest / Oldest), Rating (Highest / Lowest), Duration, and File Size.

4. **▶ Quick Preview & Inline Video Playback:**
   - Hover animated preview scrubbing directly on scene cards.
   - Built-in full-screen video player modal to stream scenes inline without opening new tabs or leaving the workspace.

5. **✏️ Expanded Batch Operations:**
   - Auto-detect matching Studios and Performers from folder names.
   - Batch assign Studios, add Performers, add Tags (with auto-creation), and set star ratings (0–5 stars) across all descendant scenes.
   - Toggle to show or hide empty subdirectories.

---

## Installation

1. Copy the `stash_file_manager` folder into your Stash `plugins` directory:
   - **Windows:** `%USERPROFILE%\.stash\plugins\stash_file_manager\`
   - **Linux / Docker:** `~/.stash/plugins/stash_file_manager/` or `/root/.stash/plugins/stash_file_manager/`
2. In Stash, go to **Settings → Plugins** and click **Reload Plugins**.
3. Hard refresh the page (`Ctrl+F5` / `Cmd+Shift+R`).

## How to Access

- Click the **"📁 File Manager"** button in Stash's main navigation bar.
- Or browse directly to `http://localhost:9999/#file-manager`.

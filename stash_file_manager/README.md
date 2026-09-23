# Stash Path File Manager

A high-performance, path-based file manager navigation plugin for [Stash](https://github.com/stashapp/stash).

## Key Features

### 1. 📁 Compact & Customizable Folder Navigation
- **Ultra-Compact Display:** Space-efficient layout eliminating bulky empty space so you can see your entire media structure at a glance.
- **Customizable Folder Views:**
  - **田 Cards Grid:** Compact cards with icons, folder names, scene counts, and formatted disk sizes.
  - **☰ Compact List:** Space-efficient horizontal folder chips/rows ideal for directories with dozens of subfolders.
  - **☷ Detail Table:** Full file manager tabular view with Folder Name, Type, Scene Count, Total Size, and Quick Actions (Open in Stash Grid `↗ Grid` and filesystem `🔍 Scan`).
- **Persistent View Preference:** Switches easily via the Subfolders header buttons and remembers your preference in `localStorage`.

### 2. 🎬 Multi-Format Video Player (Bug Fix for MKV / AVI / WMV)
- **Universal Container Support:** Direct stream playback for native browser formats (`.mp4`, `.webm`) and automatic on-the-fly live transcoding (`.mp4` transcode via Stash ffmpeg) for non-MP4 formats like `.mkv`, `.avi`, `.wmv`, `.flv`, `.mov`, and `.ts`.
- **Automatic Error Recovery:** If direct streaming fails in your browser, the player automatically detects the failure and seamlessly falls back to Stash's live transcoder without interrupting your flow.
- **Stream Mode Switcher:** Dedicated control button to toggle between `⚡ Direct Stream` and `🔄 Transcode (MP4)` on demand.

### 3. 📱 Binge-Style Video Reel Navigation
- **Scroll Reel in Directory:** Browse through videos in the active directory just like Binge or vertical reels.
- **Multiple Navigation Inputs:**
  - **Mouse Wheel:** Scroll down to advance to the next video; scroll up to return to the previous video (with intelligent debounce).
  - **Keyboard Shortcuts:** `↓` / `PageDown` / `J` for Next, `↑` / `PageUp` / `K` for Previous, `Space` for Play/Pause, `←` / `→` for ±10s seek, `M` for Mute.
  - **Touch Swipe:** Swipe up/down on touch screens.
  - **On-Screen Chevrons:** Floating navigation overlay on the video with `▲ Prev` and `▼ Next` buttons, plus current directory position (`Scene 3 of 12`).

### 4. ⧉ Draggable Floating Picture-in-Picture (PIP) Window
- **Floating Mini-Player:** Pop the video out into a floating PIP window with a single click (`⧉ Float PIP`).
- **Drag Anywhere:** Grab the header bar drag handle (`⠿`) to move the video window anywhere on your screen.
- **Browse While Watching:** The background file manager remains 100% interactive—navigate folders, filter scenes, and batch edit while playback continues uninterrupted.
- **Full In-PIP Controls:** Next/previous scene navigation, stream mode toggle, maximize/restore back to full modal, and close.

### 5. 🧭 Browser History & Folder Location Memory (QoL Improvements)
- **Deep-Linked URL Hash Support:** Current directory location is synchronized to `#file-manager?path=...`.
- **Browser Back / Forward Support:** Hitting previous page / browser back steps back to the parent or previous folder rather than turning off the file manager.
- **Persistent Location Memory:** Remembers your last visited folder in `localStorage`. Clicking the "Files" navbar button or returning from Stash reloads your exact directory level without requiring re-navigation.
- **Native Grid Integration:** The `↗ Grid` button opens the Stash native scene card grid in a new tab, preserving your file browser location and history.

### 6. ⚡ High-Performance Indexing & Library Tools
- **Progressive Trie Indexing & Caching:** Caches your parsed library hierarchy in browser `sessionStorage` and IndexedDB for instant reopening.
- **Folder-Scoped Filename Regex Parser:** Test and execute regular expression pattern matching scoped strictly to scenes inside the active folder with live preview.
- **Batch Metadata Operations:** Auto-detect matching Studios and Performers from folder names and apply batch updates.

---

## Installation

1. Copy the `stash_file_manager` folder into your Stash `plugins` directory:
   - **Windows:** `%USERPROFILE%\.stash\plugins\stash_file_manager\`
   - **Linux / Docker:** `~/.stash/plugins/stash_file_manager/` or `/root/.stash/plugins/stash_file_manager/`
2. In Stash, go to **Settings → Plugins** and click **Reload Plugins**.
3. Hard refresh the page (`Ctrl+F5` / `Cmd+Shift+R`).

## How to Access

- Click the **"Files"** button in Stash's main navigation bar.
- Or browse directly to `http://localhost:9999/#file-manager`.

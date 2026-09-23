# Stash Path File Manager

![Stash Path File Manager Hero](./assets/hero_banner.svg)

A high-performance, path-based directory navigation plugin for [Stash](https://github.com/stashapp/stash), featuring customizable folder views, Binge-style directory reel playback, a floating draggable Picture-in-Picture (PIP) player, and live regex filename metadata parsing.

---

## 📸 Feature Showcase

### 1. 📁 3 Customizable Folder Navigation Views
![Customizable Folder Views](./assets/showcase_folder_views.svg)

Eliminate wasted vertical space with compact folder layouts tailored to any library structure:
* **田 Cards Grid:** Sleek, compact tiles showing the folder icon, folder name, scene count badge, and formatted file size. Reduced padding and a minimum height of 82px display significantly more items per row.
* **☰ Compact List:** Ultra space-efficient horizontal folder chips showing the icon, bold name, and item count. Ideal for browsing 30+ directories on a single screen without endless scrolling.
* **☷ Detail Table:** Classic file manager data table with sortable columns for **Name**, **Type**, **Scenes**, **Size**, and quick actions (**↗ Grid** to open in Stash's native scene grid, and **🔍 Scan** to trigger a filesystem metadata scan).
* **View Persistence:** Your selected view preference is saved automatically in `localStorage` across sessions.

---

### 2. 🎬 Multi-Format Video Player & Binge-Style Reel Navigation
![Binge Reel & Draggable PIP Player](./assets/showcase_reel_and_pip.svg)

* **Multi-Format Bug Fix (Universal Streaming):** Solves native browser playback failure for non-MP4 formats. Native files (`.mp4`, `.webm`) stream directly, while non-MP4 formats (`.mkv`, `.avi`, `.wmv`, `.flv`, `.mov`, `.ts`) automatically route through Stash's live ffmpeg transcoder (`/scene/{id}/stream.mp4`).
* **Automatic Error Recovery:** If direct streaming fails in your browser, the player automatically falls back to live transcoding without interrupting your session.
* **Stream Switcher:** Toggle between `⚡ Direct Stream` and `🔄 Transcode (MP4)` on demand.
* **📱 Binge-Style Directory Reel:**
  * **Mouse Wheel Navigation:** Scroll down to advance to the next video; scroll up to return to the previous video (with debounce protection).
  * **Keyboard Shortcuts:** `↓` / `PageDown` / `J` (Next), `↑` / `PageUp` / `K` (Previous), `Space` (Play/Pause), `←` / `→` (±10s seek), `M` (Mute), `Escape` (Close).
  * **Touch Swipe:** Swipe up and down on mobile or tablet touch screens.
  * **On-Screen Chevrons:** Floating navigation pill with `▲ Prev` and `▼ Next` buttons, folder position counter (`Scene 3 of 12`), and tooltip titles.

---

### 3. ⧉ Draggable Floating Picture-in-Picture (PIP) Window
* **Float Anywhere:** Click the `⧉ Float PIP` button to pop the video out into a floating mini-player.
* **Draggable Header:** Grab the drag handle (`⠿`) to move the window anywhere across the screen.
* **Full Background Interactivity:** Continue navigating directories, searching files, and batch editing while the video plays uninterrupted.
* **In-PIP Controls:** Quick buttons for previous/next scene (`▲` / `▼`), stream switcher, restore to modal (`🗖`), and close (`×`). Video playback timestamp is preserved across modal and PIP transitions.

---

### 4. 🧭 Browser History & Folder Location Retention (QoL Improvements)
* **URL Hash Synchronization:** The active directory path is synchronized to the browser address bar (`#file-manager?path=...`).
* **Browser Back / Forward Support:** Hitting your browser's Back button ("previous page") steps back to the parent folder instead of abruptly closing the file manager. The workspace only closes when navigating back past the root directory.
* **Persistent Folder Memory:** Remembers your last visited directory in `localStorage`. Clicking the "Files" navbar button or returning from Stash reloads your exact folder level without requiring re-navigation.
* **Native Grid Launcher:** The `↗ Grid` button opens the Stash native scene card grid in a new tab, keeping your file browser location open and intact.

---

### 5. ⚡ In-Memory Trie Cache & Regex Tools
* **Progressive Indexing & Caching:** Caches the parsed directory hierarchy in `sessionStorage` and IndexedDB for instant reloads.
* **Folder-Scoped Filename Regex Parser:** Test regular expression pattern schemes scoped strictly to the current folder with live interactive match preview tables.
* **Batch Operations:** Auto-detect matching Studios and Performers from folder names and apply batch updates.

---

## 📦 Installation

### Method 1: Via Stash Plugin Source (Recommended Community Method)

Install directly through Stash's built-in plugin manager to receive one-click updates:

1. In Stash, go to **Settings → Plugins**.
2. Scroll to the **Available Plugins** section and click **Add Source**.
3. Fill out the popup:
   - **Name:** `Stash Plugins`
   - **Source URL:** `https://raw.githubusercontent.com/<username>/<repo>/main/index.yml`
4. Click **Confirm / Add**.
5. Under **Available Plugins**, locate **"Path File Manager"** and click **Install**.
6. Go to the **Plugins** section and click **Reload Plugins**.

---

### Method 2: Via Git Clone (Terminal / CLI)

Clone the repository directly into your Stash `plugins` directory:

**Linux / macOS / Docker:**
```bash
cd ~/.stash/plugins
git clone https://github.com/<username>/<repo>.git stash_file_manager
```

**Windows (PowerShell):**
```powershell
cd $env:USERPROFILE\.stash\plugins
git clone https://github.com/<username>/<repo>.git stash_file_manager
```

After cloning, go to **Settings → Plugins** in Stash and click **Reload Plugins**.

---

### Method 3: Manual Download

1. Download the latest `stash_file_manager.zip` from the Releases page.
2. Extract the `stash_file_manager` folder into your Stash plugins folder:
   - **Windows:** `%USERPROFILE%\.stash\plugins\stash_file_manager\`
   - **Linux / Docker:** `~/.stash/plugins/stash_file_manager/`
3. In Stash, go to **Settings → Plugins** and click **Reload Plugins**.

---

## 🚀 How to Access

* Click the native **"Files"** button in Stash's main navigation bar.
* Or browse directly to `http://localhost:9999/#file-manager`.

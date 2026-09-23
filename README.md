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
* **📁 3 Customizable Folder Views:** Compact Cards Grid, Space-Efficient List Strip (30+ folders per screen), and Detail Table View with direct Stash Grid and Scan actions.
* **🎬 Multi-Format Video Player (Bug Fix):** Seamless playback for `.mkv`, `.avi`, `.wmv`, and `.mp4` via automatic Stash live transcoding and error recovery.
* **📱 Binge-Style Directory Reel:** Scroll up/down with mouse wheel, keyboard arrows, or swipe to browse through videos in the folder.
* **⧉ Draggable Floating PIP Player:** Mini-player window draggable anywhere across the screen while keeping the file manager fully interactive.
* **🧭 Navigation History & Folder Memory:** Browser Back button steps back through folders instead of turning off the file manager; last visited folder is preserved across sessions.
* **🔍 Regex Filename Parser:** Folder-scoped pattern tester with live matching preview tables.
* **⚡ In-Memory Trie Cache:** Instant directory loading using `sessionStorage` and IndexedDB caching.

---

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

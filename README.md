# Stash Plugins

A collection of custom plugins for [Stash](https://github.com/stashapp/stash).

## Available Plugins

### [Path File Manager](./stash_file_manager)
A hierarchical, file-manager style navigation interface for Stash:
- **Directory Tree Navigation:** In-memory Path Trie parsing all scene file paths into browsable folders and subfolders.
- **Top Bar Integration:** Native FontAwesome folder icon embedded seamlessly in Stash's top navigation bar.
- **Large Library Optimization:** Automatic `sessionStorage` caching for instant loading on repeat visits.
- **Filename Regex Parser:** Interactive live preview and batch extraction of titles, dates, studios, and performers from file names.
- **Instant Search & Sorting:** Real-time search and multi-criteria sorting for both folders and scenes.
- **Inline Video Player & Hover Previews:** Hover scrub previews and full modal streaming without leaving the workspace.
- **Comprehensive Batch Editor:** Batch assignment of Studios, Performers, Tags, and star ratings across entire folder trees.

---

## Installation

To install any plugin, copy its folder into your Stash `plugins` directory:

- **Windows:** `%USERPROFILE%\.stash\plugins\`
- **Linux / Docker:** `~/.stash/plugins/` or `/root/.stash/plugins/`

In Stash, go to **Settings → Plugins** and click **Reload Plugins**.

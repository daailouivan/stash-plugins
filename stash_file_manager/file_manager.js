(function () {
  "use strict";

  try {
    if (!window.PluginApi) {
      console.warn("[PathFileManager] window.PluginApi is not ready.");
      return;
    }

    const { React, ReactDOM, register } = window.PluginApi;
    if (!React || !ReactDOM) {
      console.warn("[PathFileManager] React or ReactDOM not found on PluginApi.");
      return;
    }

    const { useState, useEffect, useMemo, useCallback, useRef } = React;

    // Global In-Memory Singleton Cache (instant 0ms retrieval within session)
    window.__SFM_GLOBAL_CACHE__ = window.__SFM_GLOBAL_CACHE__ || {
      trie: null,
      scenes: null,
      timestamp: 0,
    };

    // IndexedDB Persistent Storage for Large Libraries (replaces 5MB sessionStorage limit)
    const IDB_NAME = "stash_file_manager_db";
    const IDB_VERSION = 1;
    const IDB_STORE = "library";
    const CACHE_KEY = "scenes_index_v7";
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    function openIDB() {
      return new Promise((resolve) => {
        if (!window.indexedDB) return resolve(null);
        try {
          const req = window.indexedDB.open(IDB_NAME, IDB_VERSION);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
              db.createObjectStore(IDB_STORE);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }

    async function idbGet(key) {
      const db = await openIDB();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readonly");
          const store = tx.objectStore(IDB_STORE);
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }

    async function idbSet(key, val) {
      const db = await openIDB();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          const store = tx.objectStore(IDB_STORE);
          const req = store.put(val, key);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    }

    async function idbClear() {
      const db = await openIDB();
      if (!db) return false;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          const store = tx.objectStore(IDB_STORE);
          const req = store.clear();
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    }

    // GraphQL Query Helper
    async function gqlFetch(query, variables = {}) {
      const res = await window.fetch("/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ query, variables }),
      });
      const json = await res.json();
      if (json.errors && json.errors.length > 0) {
        throw new Error(json.errors[0].message);
      }
      return json.data;
    }

    // Stash Plugin Settings Helpers (Query & Mutation)
    async function fetchStashPluginSettings() {
      try {
        const data = await gqlFetch(`query GetSFMSettings {
          configuration {
            general {
              stashes {
                path
              }
            }
            plugins
          }
        }`);
        const sfm = data?.configuration?.plugins?.stash_file_manager || {};
        const stashes = (data?.configuration?.general?.stashes || []).map((s) => s.path).filter(Boolean);
        return { ...sfm, __stashes__: stashes };
      } catch (e) {
        try {
          const fallbackData = await gqlFetch(`query GetSFMSettingsFallback {
            configuration {
              plugins
            }
          }`);
          return fallbackData?.configuration?.plugins?.stash_file_manager || {};
        } catch (err) {
          return {};
        }
      }
    }

    async function saveStashPluginSettings(values) {
      try {
        const payload = {
          default_transcode_method: String(values.default_transcode_method || "direct"),
          fallback_transcode_method: String(values.fallback_transcode_method || "hls"),
          root_library_path: String(values.root_library_path || ""),
          folder_view_mode: String(values.folder_view_mode || "cards"),
          scene_view_mode: String(values.scene_view_mode || "cards"),
          default_sort_field: String(values.default_sort_field || "name"),
          default_sort_direction: String(values.default_sort_direction || "asc"),
          folder_card_size: Number(values.folder_card_size) || 160,
          scene_card_size: Number(values.scene_card_size) || 240,
          remember_last_path: values.remember_last_path !== false,
          auto_rebuild_tree_on_start: Boolean(values.auto_rebuild_tree_on_start),
        };
        const data = await gqlFetch(
          `mutation ConfigureSFM($plugin_id: ID!, $input: Map!) {
            configurePlugin(plugin_id: $plugin_id, input: $input)
          }`,
          { plugin_id: "stash_file_manager", input: payload }
        );
        return data?.configurePlugin;
      } catch (e) {
        console.error("[SFM] Failed to configure plugin settings:", e);
        return null;
      }
    }

    // Helper: format bytes
    function formatBytes(bytes) {
      if (!bytes || bytes <= 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB", "TB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
    }

    // Helper: format duration seconds
    function formatDuration(sec) {
      if (!sec || sec <= 0) return "";
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      if (h > 0) {
        return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
      }
      return `${m}:${s.toString().padStart(2, "0")}`;
    }
    const formatSeconds = formatDuration;

    // React Error Boundary to prevent any child modal or component error from closing the workspace
    class SafeErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      componentDidCatch(error, info) {
        console.error("[SFM SafeErrorBoundary caught]", error, info);
      }
      render() {
        if (this.state.hasError) {
          return React.createElement(
            "div",
            {
              className: "sfm-modal-backdrop",
              onClick: () => {
                this.setState({ hasError: false, error: null });
                if (this.props.onReset) this.props.onReset();
              },
            },
            React.createElement(
              "div",
              {
                className: "sfm-player-dialog p-4 bg-dark text-light border border-danger",
                onClick: (e) => e.stopPropagation(),
                style: { maxWidth: "520px", margin: "10% auto", borderRadius: "8px" },
              },
              React.createElement("h5", { className: "text-danger" }, "⚠️ Video Player Error"),
              React.createElement("p", { className: "text-muted small" }, String(this.state.error?.message || this.state.error)),
              React.createElement(
                "button",
                {
                  className: "btn btn-secondary btn-sm mt-3",
                  onClick: () => {
                    this.setState({ hasError: false, error: null });
                    if (this.props.onReset) this.props.onReset();
                  },
                },
                "Close Player"
              )
            )
          );
        }
        return this.props.children;
      }
    }

    // Modern SVG Vector Icons for UI consistency (no cartoon emojis)
    function IconHome({ size = 14, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("path", { d: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }),
        React.createElement("polyline", { points: "9 22 9 12 15 12 15 22" })
      );
    }

    function IconArrowLeft({ size = 13, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2.2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-1px", ...style },
        },
        React.createElement("line", { x1: "19", y1: "12", x2: "5", y2: "12" }),
        React.createElement("polyline", { points: "12 19 5 12 12 5" })
      );
    }

    function IconArrowUp({ size = 13, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2.2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-1px", ...style },
        },
        React.createElement("line", { x1: "12", y1: "19", x2: "12", y2: "5" }),
        React.createElement("polyline", { points: "5 12 12 5 19 12" })
      );
    }

    function IconFolder({ size = 20, color = "currentColor", className = "" }) {
      return React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          fill: color,
          className: `sfm-svg-icon ${className}`.trim(),
          style: { display: "inline-block", verticalAlign: "middle" },
          "aria-hidden": "true",
        },
        React.createElement("path", {
          d: "M10 4H4c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z",
        })
      );
    }

    function IconFolderCard({ size = 46, color = "#81a1c1" }) {
      return React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          className: "sfm-folder-card-svg",
          "aria-hidden": "true",
        },
        React.createElement("path", {
          d: "M10 4H4c-1.1 0-2 .9-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z",
          fill: color,
          opacity: "0.85",
        }),
        React.createElement("path", {
          d: "M20 9H4a1 1 0 0 0-1 1v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10a1 1 0 0 0-1-1z",
          fill: "#88c0d0",
          opacity: "0.95",
        })
      );
    }

    function IconZoom({ size = 12, color = "#81a1c1" }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2.2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "middle", flexShrink: 0 },
        },
        React.createElement("circle", { cx: "11", cy: "11", r: "8" }),
        React.createElement("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }),
        React.createElement("line", { x1: "11", y1: "8", x2: "11", y2: "14" }),
        React.createElement("line", { x1: "8", y1: "11", x2: "14", y2: "11" })
      );
    }

    function IconSmartphone({ size = 14, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          stroke: color,
          strokeWidth: "2",
          fill: "none",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "middle", ...style },
        },
        React.createElement("rect", { x: "5", y: "2", width: "14", height: "20", rx: "2", ry: "2" }),
        React.createElement("line", { x1: "12", y1: "18", x2: "12.01", y2: "18" })
      );
    }

    function IconShuffle({ size = 16, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          viewBox: "0 0 24 24",
          width: size,
          height: size,
          stroke: color,
          strokeWidth: "2.2",
          fill: "none",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "middle", ...style },
        },
        React.createElement("polyline", { points: "16 3 21 3 21 8" }),
        React.createElement("line", { x1: "4", y1: "20", x2: "21", y2: "3" }),
        React.createElement("polyline", { points: "21 16 21 21 16 21" }),
        React.createElement("line", { x1: "15", y1: "15", x2: "21", y2: "21" }),
        React.createElement("line", { x1: "4", y1: "4", x2: "9", y2: "9" })
      );
    }

    function IconWidth({ size = 12, color = "#81a1c1" }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2.2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "middle", flexShrink: 0 },
        },
        React.createElement("polyline", { points: "7 8 3 12 7 16" }),
        React.createElement("polyline", { points: "17 8 21 12 17 16" }),
        React.createElement("line", { x1: "3", y1: "12", x2: "21", y2: "12" })
      );
    }

    function IconScan({ size = 13, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("circle", { cx: "12", cy: "12", r: "2", fill: "currentColor" }),
        React.createElement("path", { d: "M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49m11.31-2.83a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" })
      );
    }

    function IconGrid({ size = 13, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1.5" }),
        React.createElement("rect", { x: "14", y: "3", width: "7", height: "7", rx: "1.5" }),
        React.createElement("rect", { x: "14", y: "14", width: "7", height: "7", rx: "1.5" }),
        React.createElement("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1.5" })
      );
    }

    function IconGear({ size = 14, color = "currentColor" }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-1px", marginRight: "4px" },
        },
        React.createElement("circle", { cx: "12", cy: "12", r: "3" }),
        React.createElement("path", {
          d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
        })
      );
    }

    function IconSearch({ size = 12, color = "currentColor" }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-1px", marginRight: "4px" },
        },
        React.createElement("circle", { cx: "11", cy: "11", r: "8" }),
        React.createElement("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })
      );
    }

    function IconEdit({ size = 12, color = "currentColor" }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          style: { display: "inline-block", verticalAlign: "-1px", marginRight: "4px" },
        },
        React.createElement("path", { d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" }),
        React.createElement("path", { d: "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" })
      );
    }

    function IconX({ size = 12, color = "currentColor", className = "" }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2.5",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-1px" },
        },
        React.createElement("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
        React.createElement("line", { x1: "6", y1: "6", x2: "18", y2: "18" })
      );
    }

    // Helper: Resolve common base library prefix across scenes and settings (Smart Common Root)
    function resolveLibraryRoot(scenes, configuredRoot = "", stashPaths = []) {
      // 1. Manual root override from plugin settings
      if (configuredRoot && typeof configuredRoot === "string" && configuredRoot.trim()) {
        const clean = configuredRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
        const parts = clean.split("/").filter(Boolean);
        const prefix = clean.startsWith("/") ? `/${parts.join("/")}` : parts.join("/");
        return {
          basePrefix: parts,
          diskRoot: prefix || clean,
        };
      }

      // 2. Single Stash library path from Stash configuration
      if (stashPaths && Array.isArray(stashPaths) && stashPaths.length === 1 && stashPaths[0]) {
        const clean = stashPaths[0].trim().replace(/\\/g, "/").replace(/\/+$/, "");
        const parts = clean.split("/").filter(Boolean);
        const prefix = clean.startsWith("/") ? `/${parts.join("/")}` : parts.join("/");
        return {
          basePrefix: parts,
          diskRoot: prefix || clean,
        };
      }

      // 3. Auto-detect common directory prefix from indexed scene file paths
      if (!scenes || scenes.length === 0) {
        return { basePrefix: [], diskRoot: "" };
      }

      let commonParts = null;
      const sampleLimit = Math.min(scenes.length, 500);

      for (let i = 0; i < sampleLimit; i++) {
        const filePath = scenes[i]?.files?.[0]?.path;
        if (!filePath) continue;

        const clean = filePath.replace(/\\/g, "/");
        const parts = clean.split("/").filter(Boolean);
        if (parts.length <= 1) continue;
        parts.pop(); // Remove filename

        if (commonParts === null) {
          commonParts = [...parts];
        } else {
          let j = 0;
          while (j < commonParts.length && j < parts.length && commonParts[j] === parts[j]) {
            j++;
          }
          commonParts = commonParts.slice(0, j);
          if (commonParts.length === 0) break;
        }
      }

      if (commonParts && commonParts.length > 0) {
        const samplePath = scenes[0]?.files?.[0]?.path || "";
        const diskRoot = (samplePath.startsWith("/") ? "/" : "") + commonParts.join("/");
        return {
          basePrefix: commonParts,
          diskRoot: diskRoot,
        };
      }

      return { basePrefix: [], diskRoot: "" };
    }

    // In-memory Path Trie Data Structure with Root Rebase & Single-Child Auto-Collapsing (Feature 5)
    class PathTrie {
      constructor(basePrefix = [], diskRoot = "") {
        this.basePrefix = basePrefix || [];
        this.diskRoot = diskRoot || "";
        this.root = {
          name: "Stash",
          fullPath: "",
          diskPath: this.diskRoot,
          folders: {},
          directScenes: [],
          allSceneIds: new Set(),
          totalSize: 0,
        };
      }

      insert(scene) {
        const filePath = scene.files?.[0]?.path;
        if (!filePath) return;

        const cleanPath = filePath.replace(/\\/g, "/");
        const parts = cleanPath.split("/").filter(Boolean);
        parts.pop(); // drop filename

        const size = scene.files?.[0]?.size || 0;

        let curr = this.root;
        curr.allSceneIds.add(scene.id);
        curr.totalSize += size;

        // Check if path matches basePrefix
        let relativeParts = parts;
        let prefixMatches = false;
        if (this.basePrefix && this.basePrefix.length > 0) {
          if (parts.length >= this.basePrefix.length) {
            prefixMatches = true;
            for (let i = 0; i < this.basePrefix.length; i++) {
              if (parts[i] !== this.basePrefix[i]) {
                prefixMatches = false;
                break;
              }
            }
            if (prefixMatches) {
              relativeParts = parts.slice(this.basePrefix.length);
            }
          }
        }

        let accumulated = "";
        for (let i = 0; i < relativeParts.length; i++) {
          const segment = relativeParts[i];
          accumulated = accumulated ? `${accumulated}/${segment}` : segment;
          if (!curr.folders[segment]) {
            const diskSegment = prefixMatches
              ? (this.diskRoot.replace(/\/+$/, "") + "/" + accumulated)
              : ("/" + parts.slice(0, (parts.length - relativeParts.length) + i + 1).join("/"));

            curr.folders[segment] = {
              name: segment,
              fullPath: accumulated,
              diskPath: diskSegment,
              folders: {},
              directScenes: [],
              allSceneIds: new Set(),
              totalSize: 0,
            };
          }
          curr = curr.folders[segment];
          curr.allSceneIds.add(scene.id);
          curr.totalSize += size;
        }
        curr.directScenes.push(scene);
        scene._folderPath = curr.fullPath;
      }

      rebaseSingleChildRoot() {
        while (
          this.root.directScenes.length === 0 &&
          Object.keys(this.root.folders).length === 1
        ) {
          const childKey = Object.keys(this.root.folders)[0];
          const childNode = this.root.folders[childKey];
          const childPrefix = childNode.fullPath;

          function stripPrefix(node) {
            if (!node) return;
            if (node.fullPath === childPrefix) {
              node.fullPath = "";
            } else if (node.fullPath.startsWith(childPrefix + "/")) {
              node.fullPath = node.fullPath.slice(childPrefix.length + 1);
            }
            if (node.directScenes) {
              for (const s of node.directScenes) {
                if (s._folderPath === childPrefix) {
                  s._folderPath = "";
                } else if (s._folderPath && s._folderPath.startsWith(childPrefix + "/")) {
                  s._folderPath = s._folderPath.slice(childPrefix.length + 1);
                }
              }
            }
            if (node.folders) {
              for (const k of Object.keys(node.folders)) {
                stripPrefix(node.folders[k]);
              }
            }
          }

          stripPrefix(childNode);

          this.root = {
            name: "Stash",
            fullPath: "",
            diskPath: childNode.diskPath || this.root.diskPath,
            folders: childNode.folders,
            directScenes: childNode.directScenes,
            allSceneIds: childNode.allSceneIds,
            totalSize: childNode.totalSize,
          };
        }
      }

      getNode(pathString) {
        if (!pathString) return this.root;
        const parts = pathString.split("/").filter(Boolean);
        let curr = this.root;
        for (const segment of parts) {
          if (!curr.folders[segment]) return null;
          curr = curr.folders[segment];
        }
        return curr;
      }
    }

    // Helper: Collect all descendant scenes across all subfolder levels (all levels down)
    function getAllDescendantScenes(node) {
      if (!node) return [];
      const sceneMap = new Map();
      function traverse(n) {
        if (!n) return;
        if (n.directScenes && Array.isArray(n.directScenes)) {
          for (const s of n.directScenes) {
            if (s && s.id && !sceneMap.has(s.id)) {
              sceneMap.set(s.id, s);
            }
          }
        }
        if (n.folders) {
          for (const key of Object.keys(n.folders)) {
            traverse(n.folders[key]);
          }
        }
      }
      traverse(node);
      return Array.from(sceneMap.values());
    }

    // ==========================================
    // Modal & Floating PIP: Binge Reel Video Player
    // (Features: Binge Fast-Forward/Rewind Controls, 1-Click PiP, Smooth Direct/Transcode Streaming, VLC Integration)
    // ==========================================
    // ==========================================
    // Modal & Floating PIP: Binge Reel Video Player (Clean Redesigned Interface)
    // Features:
    // - WebM & HLS Transcode Priority (fixes lost duration & timeline seeking)
    // - Clean unified header with single PiP, VLC, and Link actions (no redundancy)
    // - Double-click left/right seek ±10s with native fullscreen prevention
    // - Binge discovery reel scrolling with pull-distance threshold & spring-back animation
    // - 1-Click Native PiP + Draggable In-App Floating Mini Player
    // ==========================================
// ==========================================
    // Modal: Full-Bleed Binge Reel Player (Seamless Video Reel, Circular Buttons & Auto-Hide Overlay)
    // Features:
    // - Full-bleed immersive canvas (top and bottom bars removed)
    // - TikTok / Instagram-style bottom-left metadata overlay (auto-hides with controls)
    // - Unified custom dark scrubber & player controls (no browser UI shifts across Direct/HLS/WebM)
    // - Right-side circular action column: Stash > VLC > Copy Link > Transcode > [space] > Prev/Counter/Next > [space] > PiP > Fullscreen
    // - Persistent, non-breaking Picture-in-Picture (video element remains mounted)
    // - Dynamic transcode fallback: default 'direct', fallback 'hls' for non-native files, resets on scroll
    // - Seamless vertical reel track with connected adjacent top/bottom video slides
    // ==========================================
// ==========================================
    // Modal: Full-Bleed Binge Reel Player (v2.5.0)
    // Features:
    // - Persistent non-breaking PiP with zero lingering player dialog (seamlessly restores on PiP enlarge)
    // - Automatic MPEG-4 vs H.264 detection: MPEG-4 .mp4 automatically defaults to HLS transcode
    // - Compact 36px circular button stack aligned starting with the close button at top right
    // - Increased divider spacer gaps around previous/next buttons
    // - TikTok-style scroll threshold: requires > 50% pull to advance, snaps back to center otherwise
    // - Elevated metadata description overlay (sits comfortably above the scrubbing bar)
    // - Synchronized in-app settings with native Stash config.yml plugin settings
    // ==========================================
// ==========================================
    // Modal: Full-Bleed Binge Reel Player (v2.5.3)
    // Features:
    // - Binge Discover-grade ultra-smooth scrolling (instant momentum, poster fallback, zero black frames)
    // - Proactive MPEG-4 Part 2 / ASP detection (.mp4 extension with mpeg4/divx/xvid automatically uses HLS)
    // - Video track decode watchdog (auto-promotes to HLS if video frames fail to render)
    // - Modern monochrome vector SVG icons (clean theme consistency, no colorful emojis)
    // - Elevated metadata overlay: Title on top, File Type / Codec / Duration / Size / Date on Line 2
    // - Refined right button stack: No divider under Close, PiP and Fullscreen spaced down
    // - Consolidated native Stash plugin configuration
    // ==========================================
    // Helper: Fisher-Yates non-repeating shuffle queue for video player
    function createShuffledQueue(allScenes, currentScene) {
      if (!allScenes || allScenes.length <= 1) return allScenes ? [...allScenes] : [];
      const currentId = currentScene?.id;
      const others = allScenes.filter((s) => s.id !== currentId);
      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = others[i];
        others[i] = others[j];
        others[j] = temp;
      }
      return currentScene ? [currentScene, ...others] : others;
    }

    // ==========================================
    // Folder Profile & Video Wall Component (Social Media Profile Simulation)
    // ==========================================
    function FolderProfileView({
      folderName,
      targetFolderPath,
      displayFolderPath,
      scenes = [],
      currentScene,
      posterUrl,
      isForceMobile,
      onToggleForceMobile,
      onSelectScene,
      onCloseProfile,
      onNavigateToDirectory,
      onPlayAll,
      onShuffleAll,
    }) {
      const stats = useMemo(() => {
        let totalSize = 0;
        let totalDuration = 0;
        const resCounts = {};

        for (const s of scenes) {
          const f = s.files?.[0];
          if (f) {
            if (f.size) totalSize += f.size;
            if (f.duration) totalDuration += f.duration;
            const h = f.height;
            if (h >= 2160) resCounts["4K"] = (resCounts["4K"] || 0) + 1;
            else if (h >= 1440) resCounts["1440p"] = (resCounts["1440p"] || 0) + 1;
            else if (h >= 1080) resCounts["1080p"] = (resCounts["1080p"] || 0) + 1;
            else if (h >= 720) resCounts["720p"] = (resCounts["720p"] || 0) + 1;
            else if (h) resCounts["SD"] = (resCounts["SD"] || 0) + 1;
          }
        }

        const totalHours = Math.floor(totalDuration / 3600);
        const remainingMins = Math.floor((totalDuration % 3600) / 60);
        const durationStr = totalHours > 0 ? `${totalHours}h ${remainingMins}m` : `${remainingMins}m`;

        return {
          count: scenes.length,
          formattedSize: formatBytes(totalSize),
          formattedDuration: durationStr,
          resCounts,
        };
      }, [scenes]);

      const displayName = folderName || (targetFolderPath ? targetFolderPath.split("/").pop() : "Root");

      return React.createElement(
        "div",
        {
          className: `sfm-folder-profile-page ${isForceMobile ? "sfm-profile-force-mobile" : ""}`,
          onClick: (e) => e.stopPropagation(),
          onWheel: (e) => e.stopPropagation(),
          onTouchStart: (e) => e.stopPropagation(),
          onTouchMove: (e) => e.stopPropagation(),
          onTouchEnd: (e) => e.stopPropagation(),
        },
        // 1. Sticky Navigation Top Bar
        React.createElement(
          "div",
          { className: "sfm-profile-nav-bar d-flex align-items-center justify-content-between" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "btn btn-sm btn-outline-info py-1 px-3 d-inline-flex align-items-center sfm-profile-back-btn",
              onClick: onCloseProfile,
              title: "Back to Video Player (Esc)",
            },
            React.createElement(IconArrowLeft, { size: 14, className: "mr-1" }),
            React.createElement("span", { className: "font-weight-bold" }, "Back to Video")
          ),
          React.createElement(
            "div",
            { className: "sfm-profile-nav-title d-flex align-items-center text-truncate mx-2" },
            React.createElement(IconFolder, { size: 16, color: "#88c0d0", className: "mr-2 flex-shrink-0" }),
            React.createElement("span", { className: "font-weight-bold text-light text-truncate" }, displayFolderPath)
          ),
          React.createElement(
            "div",
            { className: "d-flex align-items-center gap-2 flex-shrink-0" },
            // Force Mobile View Toggle Button
            React.createElement(
              "button",
              {
                type: "button",
                className: `btn btn-sm ${isForceMobile ? "btn-info font-weight-bold" : "btn-outline-secondary"} py-1 px-2 d-inline-flex align-items-center sfm-profile-mode-btn`,
                onClick: onToggleForceMobile,
                title: isForceMobile ? "Switch to Desktop Grid View" : "Force Mobile Phone View (Instagram/TikTok 3-Column Wall)",
              },
              React.createElement(IconSmartphone, { size: 14, className: "mr-1" }),
              isForceMobile ? "Desktop Mode" : "Mobile View"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-sm btn-outline-secondary py-1 px-2 d-inline-flex align-items-center",
                onClick: onNavigateToDirectory,
                title: `Open "${targetFolderPath || "Root"}" in File Manager`,
              },
              React.createElement(IconFolder, { size: 13, className: "mr-1" }),
              "File Manager"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-sm btn-outline-secondary py-1 px-2",
                onClick: onCloseProfile,
                title: "Close Profile",
              },
              React.createElement(IconX, { size: 14 })
            )
          )
        ),

        // Main Profile Content Container (Mobile-framed when force mobile, web-centered on desktop)
        React.createElement(
          "div",
          { className: `sfm-profile-main-container ${isForceMobile ? "sfm-profile-mobile-container" : ""}` },
          // 2. Profile Header Section (Social Media Creator Profile Simulation)
          React.createElement(
            "div",
            { className: "sfm-profile-header-container" },
            // Mobile Header Layout: Top row [Avatar] + [3 Stats Columns]
            React.createElement(
              "div",
              { className: "sfm-profile-header-top d-flex align-items-center mb-3" },
              // Large Avatar with IG-style gradient ring
              React.createElement(
                "div",
                { className: "sfm-profile-avatar-wrap position-relative flex-shrink-0" },
                React.createElement("img", {
                  src: posterUrl,
                  className: "sfm-profile-avatar-large-img",
                  alt: displayName,
                }),
                React.createElement(
                  "div",
                  { className: "sfm-profile-avatar-large-badge" },
                  React.createElement(IconFolder, { size: 12, color: "#ffffff" })
                )
              ),
              // Stats Row (IG Profile format: 3 vertical stacks)
              React.createElement(
                "div",
                { className: "sfm-profile-stats-grid d-flex justify-content-around flex-grow-1 ml-3" },
                React.createElement(
                  "div",
                  { className: "sfm-profile-stat-col text-center" },
                  React.createElement("div", { className: "sfm-profile-stat-num" }, stats.count),
                  React.createElement("div", { className: "sfm-profile-stat-lbl" }, "Videos")
                ),
                React.createElement(
                  "div",
                  { className: "sfm-profile-stat-col text-center" },
                  React.createElement("div", { className: "sfm-profile-stat-num" }, stats.formattedSize),
                  React.createElement("div", { className: "sfm-profile-stat-lbl" }, "Size")
                ),
                React.createElement(
                  "div",
                  { className: "sfm-profile-stat-col text-center" },
                  React.createElement("div", { className: "sfm-profile-stat-num" }, stats.formattedDuration),
                  React.createElement("div", { className: "sfm-profile-stat-lbl" }, "Duration")
                )
              )
            ),
            // Folder Bio: Title, Path Chip, Resolution Tags
            React.createElement(
              "div",
              { className: "sfm-profile-bio-box mb-3" },
              React.createElement("h2", { className: "sfm-profile-title mb-1 font-weight-bold text-light" }, displayName),
              React.createElement(
                "div",
                { className: "d-flex align-items-center flex-wrap gap-1 mb-2" },
                React.createElement("span", { className: "badge badge-dark sfm-profile-path-badge" }, displayFolderPath),
                Object.entries(stats.resCounts).map(([res, count]) =>
                  React.createElement(
                    "span",
                    { key: res, className: "badge badge-info font-weight-normal py-1 px-2 sfm-res-chip" },
                    `${res}: ${count}`
                  )
                )
              )
            ),
            // Action Buttons Row (IG/TikTok Style Full-Width)
            React.createElement(
              "div",
              { className: "sfm-profile-action-row d-flex align-items-center gap-2" },
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "btn btn-sm btn-primary flex-grow-1 py-1 font-weight-bold d-inline-flex align-items-center justify-content-center",
                  onClick: onPlayAll,
                  title: "Play all videos sequentially",
                },
                React.createElement("span", { className: "mr-1" }, "▶"),
                "Play All"
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "btn btn-sm btn-outline-info flex-grow-1 py-1 d-inline-flex align-items-center justify-content-center",
                  onClick: onShuffleAll,
                  title: "Shuffle play all videos",
                },
                React.createElement(IconShuffle, { size: 14, className: "mr-1" }),
                "Shuffle"
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "btn btn-sm btn-outline-secondary py-1 px-3 d-inline-flex align-items-center justify-content-center",
                  onClick: () => {
                    const filter = { type: "path", value: targetFolderPath, modifier: "MATCHES_REGEX" };
                    window.open(`/scenes?c=${encodeURIComponent(JSON.stringify(filter))}`, "_blank");
                  },
                  title: "Open in Stash scene grid (new tab)",
                },
                React.createElement(IconGrid, { size: 13, className: "mr-1" }),
                "Stash"
              )
            )
          ),

          // 3. Tab Bar Header: Reels / Video Wall (Clean line like IG profile)
          React.createElement(
            "div",
            { className: "sfm-profile-wall-tab-bar d-flex align-items-center justify-content-center" },
            React.createElement(
              "div",
              { className: "sfm-profile-tab-active d-flex align-items-center" },
              React.createElement("span", { className: "mr-2 font-weight-bold" }, "▦"),
              React.createElement("span", { className: "font-weight-bold text-uppercase letter-spacing-1 small" }, "REELS & VIDEOS"),
              React.createElement("span", { className: "badge badge-dark ml-2" }, scenes.length)
            )
          ),

          // 4. Real Video Wall Grid (Zero border gaps between videos!)
          React.createElement(
            "div",
            { className: "sfm-profile-wall-grid" },
            scenes.map((s) => {
              const isCurrent = s.id === currentScene?.id;
              const sPoster = s.paths?.screenshot || `/scene/${s.id}/screenshot`;
              const sTitle = s.title || s.files?.[0]?.basename || `Scene #${s.id}`;
              const sDuration = formatDuration(s.files?.[0]?.duration);
              const sHeight = s.files?.[0]?.height;
              const sRes = sHeight >= 2160 ? "4K" : sHeight >= 1080 ? "1080p" : sHeight >= 720 ? "720p" : "";

              return React.createElement(
                "div",
                {
                  key: s.id,
                  className: `sfm-wall-tile ${isCurrent ? "sfm-wall-tile-active" : ""}`,
                  onClick: () => onSelectScene(s),
                  title: `Play: ${sTitle}`,
                },
                // Poster Image
                React.createElement("img", {
                  src: sPoster,
                  className: "sfm-wall-tile-img",
                  alt: sTitle,
                  loading: "lazy",
                }),
                // Top-Left Playing Badge
                isCurrent &&
                  React.createElement(
                    "div",
                    { className: "sfm-wall-tile-playing" },
                    "▶ PLAYING"
                  ),
                // Top-Right Resolution Badge
                sRes &&
                  React.createElement(
                    "div",
                    { className: "sfm-wall-tile-res" },
                    sRes
                  ),
                // Bottom-Left Views / Duration (Instagram Reel style)
                React.createElement(
                  "div",
                  { className: "sfm-wall-tile-views" },
                  React.createElement("span", { className: "mr-1", style: { fontSize: "0.65rem" } }, "▶"),
                  React.createElement("span", null, sDuration)
                ),
                // Desktop Hover Overlay (Dark gradient, title, play icon)
                React.createElement(
                  "div",
                  { className: "sfm-wall-tile-hover-overlay" },
                  React.createElement(
                    "div",
                    { className: "sfm-wall-tile-hover-center" },
                    "▶"
                  ),
                  React.createElement(
                    "div",
                    { className: "sfm-wall-tile-hover-title" },
                    sTitle
                  )
                )
              );
            })
          )
        )
      );
    }

    function BingeReelPlayerModal({ scene, scenes = [], onSelectScene, onClose, folderName, currentPath, onNavigateToFolder }) {
      const videoRef = useRef(null);
      const videoContainerRef = useRef(null);
      const hlsInstanceRef = useRef(null);
      const hideTimeoutRef = useRef(null);
      const [isVideoReady, setIsVideoReady] = useState(false);
      const [showFolderProfile, setShowFolderProfile] = useState(false);

      // Force Mobile View State (IG/TikTok Phone Frame simulation)
      const [isForceMobile, setIsForceMobile] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_force_mobile_view") === "true";
        } catch (e) {
          return false;
        }
      });

      const handleToggleForceMobile = useCallback(() => {
        setIsForceMobile((prev) => {
          const next = !prev;
          try {
            window.localStorage.setItem("sfm_force_mobile_view", String(next));
          } catch (e) {}
          return next;
        });
      }, []);

      // 1. Shuffle Queue State & Non-Repeating Active Queue
      const [isShuffle, setIsShuffle] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_player_shuffle") === "true";
        } catch (e) {
          return false;
        }
      });

      const [shuffledQueue, setShuffledQueue] = useState(() => {
        try {
          const pref = window.localStorage.getItem("sfm_player_shuffle") === "true";
          if (pref && scenes && scenes.length > 0) {
            return createShuffledQueue(scenes, scene);
          }
        } catch (e) {}
        return [];
      });

      useEffect(() => {
        if (isShuffle && scenes && scenes.length > 0) {
          setShuffledQueue((prev) => {
            const sceneIds = new Set(scenes.map((s) => s.id));
            const prevIds = new Set(prev.map((s) => s.id));
            if (sceneIds.size !== prevIds.size || [...sceneIds].some((id) => !prevIds.has(id))) {
              return createShuffledQueue(scenes, scene);
            }
            return prev;
          });
        }
      }, [scenes, isShuffle, scene?.id]);

      const activeScenes = useMemo(() => {
        if (isShuffle && shuffledQueue.length === scenes.length && shuffledQueue.length > 0) {
          return shuffledQueue;
        }
        return scenes;
      }, [isShuffle, shuffledQueue, scenes]);

      // 2. Scene Navigation & Previews (Sliding Window ±2 for Multi-Video Swiping across Active Queue)
      const currentIndex = useMemo(() => {
        return activeScenes.findIndex((s) => s.id === scene?.id);
      }, [activeScenes, scene?.id]);

      const totalScenes = activeScenes.length;
      const hasPrev = currentIndex > 0;
      const hasPrev2 = currentIndex > 1;
      const hasNext = currentIndex !== -1 && currentIndex < totalScenes - 1;
      const hasNext2 = currentIndex !== -1 && currentIndex < totalScenes - 2;

      const prev2Scene = hasPrev2 ? activeScenes[currentIndex - 2] : null;
      const prevScene = hasPrev ? activeScenes[currentIndex - 1] : null;
      const nextScene = hasNext ? activeScenes[currentIndex + 1] : null;
      const next2Scene = hasNext2 ? activeScenes[currentIndex + 2] : null;

      // 2. Format & Codec Resolution (Proactive MPEG-4 vs H.264 Detection)
      const filePath = scene?.files?.[0]?.path || scene?.files?.[0]?.basename || "";
      const fileExt = (filePath.split(".").pop() || "").toLowerCase();
      const rawCodec = (scene?.files?.[0]?.video_codec || "").toLowerCase();
      const rawFormat = (scene?.files?.[0]?.format || "").toLowerCase();
      const lowerPath = filePath.toLowerCase();
      const lowerTitle = (scene?.title || "").toLowerCase();

      // Robust check for MPEG-4 Part 2 / ASP codecs in .mp4 (which browsers cannot decode natively)
      const isMpeg4 =
        rawCodec.includes("mpeg4") ||
        rawCodec.includes("mp4v") ||
        rawCodec.includes("divx") ||
        rawCodec.includes("xvid") ||
        rawCodec.includes("dx50") ||
        rawCodec.includes("fmp4") ||
        rawFormat.includes("mpeg-4") ||
        rawFormat.includes("mpeg4") ||
        lowerPath.includes("mpeg4") ||
        lowerPath.includes("mpeg-4") ||
        lowerPath.includes("xvid") ||
        lowerPath.includes("divx") ||
        lowerTitle.includes("mpeg4") ||
        lowerTitle.includes("mpeg-4");

      const isUnsupportedCodec =
        isMpeg4 ||
        rawCodec.includes("mpeg2") ||
        rawCodec.includes("wmv") ||
        rawCodec.includes("flv") ||
        rawCodec.includes("vc1") ||
        rawCodec.includes("msmpeg");

      // Only native H.264, AV1, VP9 or WebM are direct-streamable in browsers
      const isNativeDirect = ["mp4", "m4v", "webm"].includes(fileExt) && !isUnsupportedCodec;

      const targetFolderPath = scene?._folderPath !== undefined ? scene._folderPath : (currentPath || "");
      const displayFolderPath = targetFolderPath ? `/${targetFolderPath}` : "/Stash";

      const extLabel = fileExt ? `.${fileExt.toUpperCase()}` : "VIDEO";
      const codecBadge = rawCodec ? rawCodec.toUpperCase() : isMpeg4 ? "MPEG-4" : "";
      const title = scene?.title || scene?.files?.[0]?.basename || `Scene #${scene?.id}`;
      const fileSize = formatBytes(scene?.files?.[0]?.size);
      const durationFormatted = formatDuration(scene?.files?.[0]?.duration);
      const dateStr = scene?.date || "";
      const studioName = scene?.studio?.name || "";
      const posterUrl = scene?.paths?.screenshot || `/scene/${scene?.id}/screenshot`;

      // 3. Transcode Mode & Fallback Strategy
      const defaultMethod = window.__SFM_DEFAULT_TRANSCODE_METHOD__ || "direct";
      const fallbackMethod = window.__SFM_FALLBACK_TRANSCODE_METHOD__ || "hls";

      const targetMode = isNativeDirect ? defaultMethod : fallbackMethod;
      const [streamMode, setStreamMode] = useState(() => targetMode);
      const [customStreamUrl, setCustomStreamUrl] = useState("");
      const [availableStreams, setAvailableStreams] = useState([]);
      const [playerNotice, setPlayerNotice] = useState("");
      const [playerError, setPlayerError] = useState("");
      const [copiedNotice, setCopiedNotice] = useState("");
      const [showTranscodeMenu, setShowTranscodeMenu] = useState(false);

      const [directUrl, setDirectUrl] = useState(() => scene?.paths?.stream || `/scene/${scene?.id}/stream`);
      const [transcodeWebmUrl, setTranscodeWebmUrl] = useState(() => `/scene/${scene?.id}/stream.webm`);
      const [transcodeHlsUrl, setTranscodeHlsUrl] = useState(() => `/scene/${scene?.id}/stream.m3u8`);
      const [transcodeMp4Url, setTranscodeMp4Url] = useState(() => `/scene/${scene?.id}/stream.mp4`);

      const [showSlowLoadPoster, setShowSlowLoadPoster] = useState(false);

      // Dynamically reset stream mode per-scene during scrolling
      useEffect(() => {
        setIsVideoReady(false);
        setShowSlowLoadPoster(false);
        setCustomStreamUrl("");
        setPlayerError("");
        setPlayerNotice("");
        setShowTranscodeMenu(false);
        setStreamMode(targetMode);

        // Prevent thumbnail flash on fast-loading/prebuffered scenes.
        // Only display poster if media decode takes longer than 350ms (e.g. transcode startup).
        const slowTimer = setTimeout(() => {
          setShowSlowLoadPoster(true);
        }, 350);

        return () => clearTimeout(slowTimer);
      }, [scene?.id, targetMode]);

      // Query available streams & fresh file codec via GraphQL
      useEffect(() => {
        if (!scene?.id) return;
        let active = true;

        const initialDirect = scene?.paths?.stream || `/scene/${scene.id}/stream`;
        setDirectUrl(initialDirect);
        setTranscodeWebmUrl(`/scene/${scene.id}/stream.webm`);
        setTranscodeHlsUrl(`/scene/${scene.id}/stream.m3u8`);
        setTranscodeMp4Url(`/scene/${scene.id}/stream.mp4`);

        gqlFetch(
          `query ScenePlaybackDetails($id: ID!) {
            findScene(id: $id) {
              id
              title
              files {
                id
                path
                basename
                size
                duration
                video_codec
                format
              }
              paths {
                stream
                screenshot
                preview
              }
              sceneStreams {
                url
                mime_type
                label
              }
            }
          }`,
          { id: scene.id }
        )
          .then((res) => {
            if (!active) return;
            const data = res?.findScene;
            if (!data) return;

            const officialDirect = data.paths?.stream || initialDirect;
            const streams = data.sceneStreams || [];

            setDirectUrl(officialDirect);
            setAvailableStreams(streams);

            const webm = streams.find((s) => s.url !== officialDirect && (s.mime_type?.includes("webm") || s.url?.includes(".webm") || s.label?.toLowerCase().includes("webm")));
            const hls = streams.find((s) => s.url !== officialDirect && (s.mime_type?.includes("mpegurl") || s.url?.includes(".m3u8") || s.label?.toLowerCase().includes("hls")));
            const mp4 = streams.find((s) => s.url !== officialDirect && (s.mime_type?.includes("mp4") || s.url?.includes("stream.mp4") || s.label?.toLowerCase().includes("mp4")));

            if (webm) setTranscodeWebmUrl(webm.url);
            if (hls) setTranscodeHlsUrl(hls.url);
            if (mp4) setTranscodeMp4Url(mp4.url);

            // Fresh Codec Validation: If probe confirms MPEG-4, enforce HLS immediately
            const freshFile = data.files?.[0];
            if (freshFile) {
              const freshCodec = (freshFile.video_codec || "").toLowerCase();
              const freshFormat = (freshFile.format || "").toLowerCase();
              const freshPath = (freshFile.path || freshFile.basename || "").toLowerCase();
              if (
                freshCodec.includes("mpeg4") ||
                freshCodec.includes("mp4v") ||
                freshCodec.includes("divx") ||
                freshCodec.includes("xvid") ||
                freshFormat.includes("mpeg-4") ||
                freshFormat.includes("mpeg4") ||
                freshPath.includes("mpeg4") ||
                freshPath.includes("mpeg-4")
              ) {
                console.log("[SFM Player] Detected MPEG-4 file from GraphQL details. Switched to HLS transcode.");
                setStreamMode(fallbackMethod);
              }
            }
          })
          .catch((err) => {
            console.warn("[SFM Player] GraphQL stream query error:", err);
          });

        return () => {
          active = false;
        };
      }, [scene?.id, fallbackMethod]);

      // Effective stream URL
      const streamUrl = useMemo(() => {
        if (!scene?.id) return "";
        if (customStreamUrl) return customStreamUrl;
        if (streamMode === "direct") return directUrl;
        if (streamMode === "hls") return transcodeHlsUrl;
        if (streamMode === "webm") return transcodeWebmUrl;
        if (streamMode === "mp4") return transcodeMp4Url;
        return directUrl;
      }, [scene?.id, customStreamUrl, streamMode, directUrl, transcodeHlsUrl, transcodeWebmUrl, transcodeMp4Url]);

      // Helper to pre-resolve stream URLs for adjacent and upcoming scenes
      const resolveSceneStreamUrl = useCallback((sc, mode) => {
        if (!sc?.id) return "";
        const fPath = sc.files?.[0]?.path || sc.files?.[0]?.basename || "";
        const fCodec = (sc.files?.[0]?.video_codec || "").toLowerCase();
        const fFormat = (sc.files?.[0]?.format || "").toLowerCase();
        const fLower = (fPath + " " + (sc.title || "")).toLowerCase();
        const scMpeg4 =
          fCodec.includes("mpeg4") ||
          fCodec.includes("mp4v") ||
          fCodec.includes("divx") ||
          fCodec.includes("xvid") ||
          fFormat.includes("mpeg-4") ||
          fLower.includes("mpeg4") ||
          fLower.includes("xvid") ||
          fLower.includes("divx");

        if (mode === "hls" || scMpeg4) return `/scene/${sc.id}/stream.m3u8`;
        if (mode === "webm") return `/scene/${sc.id}/stream.webm`;
        if (mode === "mp4") return `/scene/${sc.id}/stream.mp4`;
        return sc.paths?.stream || `/scene/${sc.id}/stream`;
      }, []);

      const prev2StreamUrl = useMemo(() => resolveSceneStreamUrl(prev2Scene, streamMode), [prev2Scene, streamMode, resolveSceneStreamUrl]);
      const prevStreamUrl = useMemo(() => resolveSceneStreamUrl(prevScene, streamMode), [prevScene, streamMode, resolveSceneStreamUrl]);
      const nextStreamUrl = useMemo(() => resolveSceneStreamUrl(nextScene, streamMode), [nextScene, streamMode, resolveSceneStreamUrl]);
      const next2StreamUrl = useMemo(() => resolveSceneStreamUrl(next2Scene, streamMode), [next2Scene, streamMode, resolveSceneStreamUrl]);

      // 4. Playback State & Custom Scrubber Control
      const [isPlaying, setIsPlaying] = useState(false);
      const [currentTime, setCurrentTime] = useState(0);
      const [duration, setDuration] = useState(() => scene?.files?.[0]?.duration || 0);
      const [bufferedProgress, setBufferedProgress] = useState(0);
      const [volume, setVolume] = useState(1);
      const [isMuted, setIsMuted] = useState(false);
      const [hudNotice, setHudNotice] = useState("");

      // Auto-Hide Controls & Overlay Timer
      const [isControlsVisible, setIsControlsVisible] = useState(true);

      const resetControlsTimer = useCallback(() => {
        setIsControlsVisible(true);
        if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = setTimeout(() => {
          if (isPlaying && !showTranscodeMenu) {
            setIsControlsVisible(false);
          }
        }, 2500);
      }, [isPlaying, showTranscodeMenu]);

      useEffect(() => {
        resetControlsTimer();
        return () => {
          if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
        };
      }, [resetControlsTimer]);

      // Setup Video Stream Player
      useEffect(() => {
        const v = videoRef.current;
        if (!v || !streamUrl) return;

        if (hlsInstanceRef.current) {
          hlsInstanceRef.current.destroy();
          hlsInstanceRef.current = null;
        }

        const isHlsUrl = streamUrl.includes(".m3u8") || streamMode === "hls";

        if (isHlsUrl) {
          if (v.canPlayType("application/vnd.apple.mpegurl")) {
            v.src = streamUrl;
            v.load();
            v.play().then(() => setIsPlaying(true)).catch(() => {});
          } else if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
            hlsInstanceRef.current = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(v);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
              v.play().then(() => setIsPlaying(true)).catch(() => {});
            });
            hls.on(window.Hls.Events.ERROR, (event, data) => {
              if (data.fatal) {
                console.warn("[SFM Player] HLS fatal error, falling back to WebM:", data);
                setStreamMode("webm");
                setPlayerNotice("HLS stream failed in this browser. Switched to WebM Progressive Container.");
              }
            });
          } else {
            setStreamMode("webm");
            setPlayerNotice("HLS requires MSE in this browser. Switched to WebM Progressive Container.");
          }
        } else {
          v.src = streamUrl;
          v.load();
          v.play().then(() => setIsPlaying(true)).catch((err) => {
            if (err.name === "NotAllowedError") {
              v.muted = true;
              setIsMuted(true);
              v.play().then(() => setIsPlaying(true)).catch(() => {});
            }
          });
        }

        return () => {
          if (hlsInstanceRef.current) {
            hlsInstanceRef.current.destroy();
            hlsInstanceRef.current = null;
          }
        };
      }, [streamUrl, streamMode]);

      // Proactive Video Track Watchdog:
      // If direct stream starts playing but has 0 decoded video dimensions (audio only decode of MPEG-4), auto-switch to HLS!
      useEffect(() => {
        const v = videoRef.current;
        if (!v || streamMode !== "direct") return;

        const watchdog = setTimeout(() => {
          if (v && !v.paused && v.currentTime > 0.4 && (v.videoWidth === 0 || v.videoHeight === 0)) {
            console.warn("[SFM Player] Video stream playing without visual track (MPEG-4 decode unsupported). Switching to HLS.");
            setStreamMode(fallbackMethod);
            setPlayerNotice("MPEG-4 video track not supported natively by browser. Switched to HLS transcode.");
          }
        }, 1100);

        return () => clearTimeout(watchdog);
      }, [streamMode, streamUrl, fallbackMethod]);

      // Playback error handler
      const handleVideoError = (e) => {
        console.warn("[SFM Player] Playback error on stream:", streamUrl, e);
        if (streamMode === "direct" && !customStreamUrl) {
          const next = fallbackMethod === "direct" ? "hls" : fallbackMethod;
          setStreamMode(next);
          setPlayerNotice(`Direct stream unsupported for this file. Switched to ${next.toUpperCase()} Transcode.`);
        } else if (streamMode === "hls" && !customStreamUrl) {
          setStreamMode("webm");
          setPlayerNotice("HLS stream failed. Switched to WebM Progressive Container.");
        } else if (streamMode === "webm" && !customStreamUrl) {
          setStreamMode("mp4");
          setPlayerNotice("Switched to MP4 Transcode.");
        } else {
          setPlayerError("Video playback failed on all streams. Click 'VLC' on the right to open externally.");
        }
      };

      // Video event handlers
      const handleTimeUpdate = () => {
        const v = videoRef.current;
        if (!v) return;
        setCurrentTime(v.currentTime);
        if (v.duration && !isNaN(v.duration) && v.duration > 0) {
          setDuration(v.duration);
        }
        if (v.buffered.length > 0 && v.duration) {
          setBufferedProgress((v.buffered.end(v.buffered.length - 1) / v.duration) * 100);
        }
      };

      const handleLoadedMetadata = () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.duration && !isNaN(v.duration) && v.duration > 0) {
          setDuration(v.duration);
        }
      };

      const handleTogglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
          v.play().then(() => setIsPlaying(true)).catch(() => {});
        } else {
          v.pause();
          setIsPlaying(false);
        }
      }, []);

      const handleScrubberClick = (e) => {
        const v = videoRef.current;
        if (!v || !duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        v.currentTime = pos * duration;
        setCurrentTime(v.currentTime);
      };

      const handleVolumeChange = (e) => {
        const val = Number(e.target.value);
        setVolume(val);
        const v = videoRef.current;
        if (v) {
          v.volume = val;
          v.muted = val === 0;
          setIsMuted(val === 0);
        }
      };

      const handleToggleMute = () => {
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setIsMuted(v.muted);
      };

      // Gestures: Double-click left/right side seek ±10s, single click toggle play
      const clickTimer = useRef(null);
      const handleGestureClick = (e) => {
        if (isSwipingGesture.current) {
          isSwipingGesture.current = false;
          return;
        }
        if (clickTimer.current) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
          return;
        }
        clickTimer.current = setTimeout(() => {
          handleTogglePlay();
          clickTimer.current = null;
        }, 220);
      };

      const handleDoubleTapSeek = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (clickTimer.current) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
        }
        const v = videoRef.current;
        if (!v) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const width = rect.width;
        if (clickX < width * 0.45) {
          v.currentTime = Math.max(0, v.currentTime - 10);
          setHudNotice("-10s");
        } else if (clickX > width * 0.55) {
          v.currentTime = Math.min(duration || 999999, v.currentTime + 10);
          setHudNotice("+10s");
        } else {
          handleTogglePlay();
          return;
        }
        setTimeout(() => setHudNotice(""), 800);
      };

      // 5. Persistent PiP with Zero Lingering Player (Restores smoothly on Enlarge)
      const [isPipMode, setIsPipMode] = useState(false);

      useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const handleEnterPip = () => {
          setIsPipMode(true);
        };
        const handleLeavePip = () => {
          setIsPipMode(false);
        };
        v.addEventListener("enterpictureinpicture", handleEnterPip);
        v.addEventListener("leavepictureinpicture", handleLeavePip);
        return () => {
          v.removeEventListener("enterpictureinpicture", handleEnterPip);
          v.removeEventListener("leavepictureinpicture", handleLeavePip);
        };
      }, []);

      const handleTogglePip = async () => {
        const v = videoRef.current;
        if (!v) return;
        if (document.pictureInPictureElement) {
          try {
            await document.exitPictureInPicture();
          } catch (e) {}
          setIsPipMode(false);
          return;
        }
        if (document.pictureInPictureEnabled && typeof v.requestPictureInPicture === "function") {
          try {
            await v.requestPictureInPicture();
            setIsPipMode(true);
          } catch (err) {
            console.warn("[SFM Player] Native PiP request error:", err);
          }
        }
      };

      // Toggle Shuffle Queue (Randomize without repeats)
      const handleToggleShuffle = useCallback(() => {
        setIsShuffle((prev) => {
          const next = !prev;
          try {
            window.localStorage.setItem("sfm_player_shuffle", next ? "true" : "false");
          } catch (e) {}
          if (next) {
            const q = createShuffledQueue(scenes, scene);
            setShuffledQueue(q);
            setHudNotice("🔀 Shuffle: ON");
          } else {
            setShuffledQueue([]);
            setHudNotice("➡️ Sequential");
          }
          setTimeout(() => setHudNotice(""), 1000);
          return next;
        });
      }, [scenes, scene]);

      // Fullscreen Toggle
      const handleToggleFullscreen = () => {
        const el = videoContainerRef.current;
        if (!el) return;
        if (!document.fullscreenElement) {
          el.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      };

      // Copy Stream Link
      const handleCopyStreamLink = () => {
        const fullUrl = streamUrl.startsWith("http") ? streamUrl : `${window.location.origin}${streamUrl}`;
        navigator.clipboard.writeText(fullUrl).then(() => {
          setCopiedNotice("Stream URL copied to clipboard!");
          setTimeout(() => setCopiedNotice(""), 2500);
        });
      };

      const vlcUrl = `vlc://${window.location.origin}${directUrl}`;

      // 6. Binge-Style Vertical Reel Scrolling & Physics
      const [pullOffset, setPullOffset] = useState(0);
      const [isTransitioning, setIsTransitioning] = useState(false);
      const isTransitioningRef = useRef(false);
      const lastWheelTime = useRef(0);
      const touchStartRef = useRef(null);
      const touchSamplesRef = useRef([]);
      const isSwipingGesture = useRef(false);

      // Smooth programmatic / physics transition to relative offset step (-2, -1, 0, 1, 2)
      const executeTransition = useCallback((steps, targetScene) => {
        const containerHeight = videoContainerRef.current?.clientHeight || window.innerHeight || 800;
        isTransitioningRef.current = true;
        setIsTransitioning(true);
        setPullOffset(-steps * containerHeight);

        const duration = steps === 0 ? 180 : 260;
        setTimeout(() => {
          if (steps !== 0 && targetScene) {
            onSelectScene(targetScene);
          }
          setPullOffset(0);
          isTransitioningRef.current = false;
          setIsTransitioning(false);
        }, duration);
      }, [onSelectScene]);

      const goToPrev = useCallback(() => {
        if (hasPrev && !isTransitioningRef.current) executeTransition(-1, prevScene);
      }, [hasPrev, prevScene, executeTransition]);

      const goToNext = useCallback(() => {
        if (hasNext && !isTransitioningRef.current) executeTransition(1, nextScene);
      }, [hasNext, nextScene, executeTransition]);

      const goToPrev2 = useCallback(() => {
        if (hasPrev2 && !isTransitioningRef.current) executeTransition(-2, prev2Scene);
      }, [hasPrev2, prev2Scene, executeTransition]);

      const goToNext2 = useCallback(() => {
        if (hasNext2 && !isTransitioningRef.current) executeTransition(2, next2Scene);
      }, [hasNext2, next2Scene, executeTransition]);

      // Wheel / Trackpad Gesture Handler matching Binge logic and parameters
      const handleWheel = (e) => {
        e.preventDefault();
        const delta = e.deltaY;
        if (Math.abs(delta) < 28) return; // filter micro jitter

        const now = Date.now();
        if (now - lastWheelTime.current < 320) return; // cooldown during slide transition

        // Instant Binge response: fast/strong wipe jumps 2 scenes, standard advances 1
        if (delta > 0) {
          if ((delta > 200 || e.deltaMode === 1) && hasNext2) {
            lastWheelTime.current = now;
            goToNext2();
          } else if (hasNext) {
            lastWheelTime.current = now;
            goToNext();
          }
        } else if (delta < 0) {
          if ((delta < -200 || e.deltaMode === 1) && hasPrev2) {
            lastWheelTime.current = now;
            goToPrev2();
          } else if (hasPrev) {
            lastWheelTime.current = now;
            goToPrev();
          }
        }
      };

      // Touch Swipe Gesture Handlers (supporting multi-video flick momentum)
      const handleTouchStart = (e) => {
        resetControlsTimer();
        if (isTransitioningRef.current || !e.touches || e.touches.length === 0) return;
        const touch = e.touches[0];
        isSwipingGesture.current = false;
        touchStartRef.current = {
          y: touch.clientY,
          time: Date.now(),
          initialOffset: pullOffset,
        };
        touchSamplesRef.current = [{ y: touch.clientY, t: Date.now() }];
      };

      const handleTouchMove = (e) => {
        if (!touchStartRef.current || isTransitioningRef.current || !e.touches || e.touches.length === 0) return;
        const touch = e.touches[0];
        const deltaY = touch.clientY - touchStartRef.current.y;
        if (Math.abs(deltaY) > 8) isSwipingGesture.current = true;

        const containerHeight = videoContainerRef.current?.clientHeight || window.innerHeight || 800;
        const maxForward = (hasNext2 ? 2 : hasNext ? 1 : 0) * containerHeight;
        const maxBackward = (hasPrev2 ? 2 : hasPrev ? 1 : 0) * containerHeight;

        let newOffset = touchStartRef.current.initialOffset + deltaY;
        if (newOffset < -maxForward) {
          newOffset = -maxForward - (Math.abs(newOffset) - maxForward) * 0.15;
        } else if (newOffset > maxBackward) {
          newOffset = maxBackward + (newOffset - maxBackward) * 0.15;
        }
        setPullOffset(newOffset);

        const now = Date.now();
        touchSamplesRef.current.push({ y: touch.clientY, t: now });
        if (touchSamplesRef.current.length > 6) touchSamplesRef.current.shift();
      };

      const handleTouchEnd = () => {
        if (!touchStartRef.current || isTransitioningRef.current) {
          touchStartRef.current = null;
          return;
        }

        const containerHeight = videoContainerRef.current?.clientHeight || window.innerHeight || 800;
        const samples = touchSamplesRef.current;
        let vy = 0;
        if (samples.length >= 2) {
          const first = samples[0];
          const last = samples[samples.length - 1];
          const dt = Math.max(1, last.t - first.t);
          vy = (last.y - first.y) / dt; // px/ms
        }

        const deltaY = pullOffset;
        if (deltaY < -containerHeight * 1.05 || (deltaY < -containerHeight * 0.35 && vy < -0.65)) {
          if (hasNext2) {
            executeTransition(2, next2Scene);
          } else if (hasNext) {
            executeTransition(1, nextScene);
          } else {
            executeTransition(0, null);
          }
        } else if (deltaY < -containerHeight * 0.2 || vy < -0.25) {
          if (hasNext) {
            executeTransition(1, nextScene);
          } else {
            executeTransition(0, null);
          }
        } else if (deltaY > containerHeight * 1.05 || (deltaY > containerHeight * 0.35 && vy > 0.65)) {
          if (hasPrev2) {
            executeTransition(-2, prev2Scene);
          } else if (hasPrev) {
            executeTransition(-1, prevScene);
          } else {
            executeTransition(0, null);
          }
        } else if (deltaY > containerHeight * 0.2 || vy > 0.25) {
          if (hasPrev) {
            executeTransition(-1, prevScene);
          } else {
            executeTransition(0, null);
          }
        } else {
          executeTransition(0, null);
        }

        touchStartRef.current = null;
        touchSamplesRef.current = [];
      };

      // Keyboard Controls
      useEffect(() => {
        const handleKeyDown = (e) => {
          if (["input", "textarea", "select"].includes(e.target.tagName?.toLowerCase())) return;
          if (e.key === "Escape") {
            if (showFolderProfile) {
              setShowFolderProfile(false);
              return;
            }
            if (isPipMode && document.pictureInPictureElement) {
              document.exitPictureInPicture().catch(() => {});
            }
            onClose();
          } else if (e.key === "ArrowDown" || e.key === "PageDown") {
            e.preventDefault();
            goToNext();
          } else if (e.key === "ArrowUp" || e.key === "PageUp") {
            e.preventDefault();
            goToPrev();
          } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            if (videoRef.current) {
              videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
              setHudNotice("-10s");
              setTimeout(() => setHudNotice(""), 800);
            }
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            if (videoRef.current) {
              videoRef.current.currentTime = Math.min(duration || 999999, videoRef.current.currentTime + 10);
              setHudNotice("+10s");
              setTimeout(() => setHudNotice(""), 800);
            }
          } else if (e.key === " " || e.key === "k") {
            e.preventDefault();
            handleTogglePlay();
          } else if (e.key === "f" || e.key === "F") {
            e.preventDefault();
            handleToggleFullscreen();
          } else if (e.key === "p" || e.key === "P") {
            e.preventDefault();
            handleTogglePip();
          } else if (e.key === "s" || e.key === "S") {
            e.preventDefault();
            handleToggleShuffle();
          }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
      }, [onClose, goToNext, goToPrev, handleTogglePlay, handleToggleShuffle, duration, isPipMode, showFolderProfile]);

      // Formatted duration helper
      const formatTime = (secs) => {
        if (!secs || isNaN(secs) || secs < 0) return "0:00";
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s < 10 ? "0" : ""}${s}`;
      };

      // Render Active Player Modal or PiP Background Mode
      return React.createElement(
        React.Fragment,
        null,
        // Folder Profile Video Wall Overlay
        showFolderProfile &&
          React.createElement(FolderProfileView, {
            folderName: folderName,
            targetFolderPath: targetFolderPath,
            displayFolderPath: displayFolderPath,
            scenes: scenes,
            currentScene: scene,
            posterUrl: posterUrl,
            isForceMobile: isForceMobile,
            onToggleForceMobile: handleToggleForceMobile,
            onSelectScene: (s) => {
              onSelectScene(s);
              setShowFolderProfile(false);
            },
            onCloseProfile: () => setShowFolderProfile(false),
            onNavigateToDirectory: () => {
              if (onNavigateToFolder) {
                onNavigateToFolder(targetFolderPath);
              }
              onClose();
            },
            onPlayAll: () => {
              if (scenes.length > 0) {
                onSelectScene(scenes[0]);
                setShowFolderProfile(false);
              }
            },
            onShuffleAll: () => {
              if (scenes.length > 0) {
                const q = createShuffledQueue(scenes, scenes[0]);
                setShuffledQueue(q);
                setIsShuffle(true);
                onSelectScene(q[0]);
                setShowFolderProfile(false);
              }
            },
          }),

        // When in PiP mode, show small non-intrusive floating dock pill
        isPipMode &&
          React.createElement(
            "div",
            {
              className: "sfm-pip-return-pill shadow-lg",
              onClick: async (e) => {
                e.stopPropagation();
                if (document.pictureInPictureElement) {
                  try {
                    await document.exitPictureInPicture();
                  } catch (err) {}
                }
                setIsPipMode(false);
              },
              title: "Click to return video to player",
            },
            React.createElement(
              "svg",
              { viewBox: "0 0 24 24", width: 14, height: 14, stroke: "currentColor", strokeWidth: "2", fill: "none", className: "mr-2" },
              React.createElement("rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }),
              React.createElement("rect", { x: "13", y: "11", width: "7", height: "6", rx: "1", fill: "currentColor" })
            ),
            React.createElement("span", { className: "sfm-pip-pill-title" }, `Playing: ${title}`),
            React.createElement("span", { className: "sfm-pip-pill-action ml-2" }, "(Click to Enlarge)"),
            React.createElement(
              "button",
              {
                className: "sfm-pip-pill-close ml-2",
                onClick: (e) => {
                  e.stopPropagation();
                  if (document.pictureInPictureElement) {
                    document.exitPictureInPicture().catch(() => {});
                  }
                  onClose();
                },
                title: "Stop playback and close",
              },
              "✕"
            )
          ),

        // Main Player Modal Backdrop (becomes transparent & detached when in PiP)
        React.createElement(
          "div",
          {
            className: `sfm-reel-modal-backdrop ${isPipMode ? "sfm-pip-detached" : ""}`,
            onClick: onClose,
            onMouseMove: resetControlsTimer,
            onTouchStart: resetControlsTimer,
          },
          React.createElement(
            "div",
            {
              className: `sfm-reel-modal-dialog ${isPipMode ? "sfm-pip-dialog-detached" : ""} ${isForceMobile ? "sfm-reel-mobile-frame" : ""}`,
              onClick: (e) => e.stopPropagation(),
              onWheel: handleWheel,
              onTouchStart: handleTouchStart,
              onTouchMove: handleTouchMove,
              onTouchEnd: handleTouchEnd,
            },
            // Main Video Container with Seamless Reel Track
            React.createElement(
              "div",
              {
                ref: videoContainerRef,
                className: "sfm-reel-video-container",
                onMouseMove: resetControlsTimer,
              },
              // Seamless Vertical Track holding Adjacent Slides (Sliding Window ±2)
              React.createElement(
                "div",
                {
                  className: "sfm-reel-track",
                  style: {
                    transform: `translateY(${pullOffset}px)`,
                    transition: isTransitioning
                      ? "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
                      : "none",
                  },
                },
                // Slide -2: Scene currentIndex - 2 (Above -200%)
                hasPrev2 &&
                  React.createElement(
                    "div",
                    { className: "sfm-reel-slide sfm-reel-slide-prev2" },
                    React.createElement("img", {
                      src: prev2Scene?.paths?.screenshot || `/scene/${prev2Scene?.id}/screenshot`,
                      className: "sfm-reel-slide-poster",
                      alt: "",
                      loading: "eager",
                    }),
                    prev2StreamUrl &&
                      React.createElement("video", {
                        key: `prev2-vid-${prev2Scene.id}`,
                        src: prev2StreamUrl,
                        className: "sfm-reel-adjacent-video",
                        preload: "auto",
                        muted: true,
                        playsInline: true,
                        controls: false,
                      })
                  ),

                // Slide -1: Scene currentIndex - 1 (Above -100%)
                hasPrev &&
                  React.createElement(
                    "div",
                    { className: "sfm-reel-slide sfm-reel-slide-prev" },
                    React.createElement("img", {
                      src: prevScene?.paths?.screenshot || `/scene/${prevScene?.id}/screenshot`,
                      className: "sfm-reel-slide-poster",
                      alt: "",
                      loading: "eager",
                    }),
                    prevStreamUrl &&
                      React.createElement("video", {
                        key: `prev-vid-${prevScene.id}`,
                        src: prevStreamUrl,
                        className: "sfm-reel-adjacent-video",
                        preload: "auto",
                        muted: true,
                        playsInline: true,
                        controls: false,
                      })
                  ),

                // Slide 0: Current Active Video (playing)
                React.createElement(
                  "div",
                  { className: "sfm-reel-slide sfm-reel-slide-active" },
                  showSlowLoadPoster &&
                    React.createElement("img", {
                      src: posterUrl,
                      className: `sfm-reel-live-poster ${isVideoReady ? "sfm-poster-faded" : ""}`,
                      alt: "",
                    }),
                  React.createElement("div", {
                    className: "sfm-video-gesture-overlay",
                    onClick: handleGestureClick,
                    onDoubleClick: handleDoubleTapSeek,
                    title: "Double-click sides to seek ±10s · Single click to toggle Play/Pause",
                  }),
                  React.createElement("video", {
                    ref: videoRef,
                    controls: false,
                    playsInline: true,
                    preload: "auto",
                    className: "sfm-reel-video-element",
                    onError: handleVideoError,
                    onTimeUpdate: handleTimeUpdate,
                    onLoadedMetadata: handleLoadedMetadata,
                    onLoadedData: () => setIsVideoReady(true),
                    onPlaying: () => {
                      setIsPlaying(true);
                      setIsVideoReady(true);
                    },
                    onPause: () => setIsPlaying(false),
                    onEnded: () => {
                      if (hasNext && !isTransitioningRef.current) {
                        goToNext();
                      }
                    },
                  })
                ),

                // Slide +1: Scene currentIndex + 1 (Below +100%)
                hasNext &&
                  React.createElement(
                    "div",
                    { className: "sfm-reel-slide sfm-reel-slide-next" },
                    React.createElement("img", {
                      src: nextScene?.paths?.screenshot || `/scene/${nextScene?.id}/screenshot`,
                      className: "sfm-reel-slide-poster",
                      alt: "",
                      loading: "eager",
                    }),
                    nextStreamUrl &&
                      React.createElement("video", {
                        key: `next-vid-${nextScene.id}`,
                        src: nextStreamUrl,
                        className: "sfm-reel-adjacent-video",
                        preload: "auto",
                        muted: true,
                        playsInline: true,
                        controls: false,
                      })
                  ),

                // Slide +2: Scene currentIndex + 2 (Below +200%)
                hasNext2 &&
                  React.createElement(
                    "div",
                    { className: "sfm-reel-slide sfm-reel-slide-next2" },
                    React.createElement("img", {
                      src: next2Scene?.paths?.screenshot || `/scene/${next2Scene?.id}/screenshot`,
                      className: "sfm-reel-slide-poster",
                      alt: "",
                      loading: "eager",
                    }),
                    next2StreamUrl &&
                      React.createElement("video", {
                        key: `next2-vid-${next2Scene.id}`,
                        src: next2StreamUrl,
                        className: "sfm-reel-adjacent-video",
                        preload: "auto",
                        muted: true,
                        playsInline: true,
                        controls: false,
                      })
                  )
              ),

              // On-screen animated HUD feedback badge (e.g. ±10s seek) with sleek vector chevrons
              hudNotice &&
                React.createElement(
                  "div",
                  { className: "sfm-player-hud" },
                  React.createElement(
                    "div",
                    { className: "sfm-hud-pill d-flex align-items-center gap-1" },
                    hudNotice.startsWith("-")
                      ? React.createElement(
                          "svg",
                          { viewBox: "0 0 24 24", width: 14, height: 14, stroke: "currentColor", strokeWidth: "2.5", fill: "none" },
                          React.createElement("polyline", { points: "11 19 2 12 11 5" }),
                          React.createElement("polyline", { points: "22 19 13 12 22 5" })
                        )
                      : React.createElement(
                          "svg",
                          { viewBox: "0 0 24 24", width: 14, height: 14, stroke: "currentColor", strokeWidth: "2.5", fill: "none" },
                          React.createElement("polyline", { points: "13 19 22 12 13 5" }),
                          React.createElement("polyline", { points: "2 19 11 12 2 5" })
                        ),
                    React.createElement("span", null, hudNotice)
                  )
                ),

              // Status Notices with Clean Inline Vector SVGs
              (copiedNotice || playerNotice || playerError) &&
                React.createElement(
                  "div",
                  { className: "sfm-reel-top-notices" },
                  copiedNotice &&
                    React.createElement(
                      "div",
                      { className: "alert alert-success py-1 px-3 mb-1 small d-flex align-items-center gap-2" },
                      React.createElement(
                        "svg",
                        { viewBox: "0 0 24 24", width: 14, height: 14, stroke: "currentColor", strokeWidth: "2.5", fill: "none" },
                        React.createElement("polyline", { points: "20 6 9 17 4 12" })
                      ),
                      copiedNotice
                    ),
                  playerNotice &&
                    React.createElement(
                      "div",
                      { className: "alert alert-warning py-1 px-3 mb-1 small d-flex align-items-center gap-2" },
                      React.createElement(
                        "svg",
                        { viewBox: "0 0 24 24", width: 14, height: 14, stroke: "currentColor", strokeWidth: "2", fill: "none" },
                        React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
                        React.createElement("line", { x1: "12", y1: "16", x2: "12", y2: "12" }),
                        React.createElement("line", { x1: "12", y1: "8", x2: "12.01", y2: "8" })
                      ),
                      playerNotice
                    ),
                  playerError &&
                    React.createElement(
                      "div",
                      { className: "alert alert-danger py-1 px-3 mb-1 small d-flex align-items-center gap-2" },
                      React.createElement(
                        "svg",
                        { viewBox: "0 0 24 24", width: 14, height: 14, stroke: "currentColor", strokeWidth: "2", fill: "none" },
                        React.createElement("path", { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }),
                        React.createElement("line", { x1: "12", y1: "9", x2: "12", y2: "13" }),
                        React.createElement("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" })
                      ),
                      playerError
                    )
                ),

              // ==========================================
              // Right-Side Clean Vector Action Bar
              // Monochrome sleek SVG vector icons (Theme consistent, no colorful emojis)
              // No divider under Close button; Fullscreen & PiP moved down
              // ==========================================
              React.createElement(
                "div",
                {
                  className: `sfm-reel-actions-column ${isControlsVisible ? "sfm-visible" : "sfm-hidden"}`,
                  onClick: (e) => e.stopPropagation(),
                },
                // 1. Close Player Button (Aligned at top of circular column)
                React.createElement(
                  "button",
                  {
                    className: "sfm-reel-circle-btn sfm-reel-close-circle-btn",
                    onClick: onClose,
                    title: "Close Player (Esc)",
                  },
                  React.createElement(
                    "svg",
                    { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2.5", fill: "none" },
                    React.createElement("line", { x1: "18", y1: "6", x2: "6", y2: "18" }),
                    React.createElement("line", { x1: "6", y1: "6", x2: "18", y2: "18" })
                  )
                ),

                // 2. Stash Scene Details (Directly under close button without divider)
                React.createElement(
                  "a",
                  {
                    href: `/scenes/${scene.id}`,
                    target: "_blank",
                    rel: "noreferrer",
                    className: "sfm-reel-circle-btn",
                    title: "Open Scene Details in Stash",
                  },
                  React.createElement(
                    "svg",
                    { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2.2", fill: "none" },
                    React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }),
                    React.createElement("polyline", { points: "15 3 21 3 21 9" }),
                    React.createElement("line", { x1: "10", y1: "14", x2: "21", y2: "3" })
                  )
                ),
                // 3. Open Stream in VLC
                React.createElement(
                  "a",
                  {
                    href: vlcUrl,
                    className: "sfm-reel-circle-btn sfm-btn-vlc",
                    title: "Open Stream in VLC Media Player",
                  },
                  React.createElement(
                    "svg",
                    { viewBox: "0 0 24 24", width: 16, height: 16, fill: "currentColor" },
                    React.createElement("path", { d: "M11 2.5a1.2 1.2 0 0 1 2 0l1.5 4.5h-5zM8.8 8.5h6.4l1.1 3.5H7.7zM6.8 13.5h10.4l1.3 4H5.5zM3.5 19.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" })
                  )
                ),
                // 4. Copy Link
                React.createElement(
                  "button",
                  {
                    className: "sfm-reel-circle-btn",
                    onClick: handleCopyStreamLink,
                    title: "Copy Stream URL to Clipboard",
                  },
                  React.createElement(
                    "svg",
                    { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2", fill: "none" },
                    React.createElement("path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }),
                    React.createElement("path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" })
                  )
                ),
                // 5. Transcode Dropdown Selector (Codec Processor Chip Vector Icon)
                React.createElement(
                  "div",
                  { className: "sfm-reel-transcode-wrap" },
                  React.createElement(
                    "button",
                    {
                      className: `sfm-reel-circle-btn ${streamMode !== "direct" ? "sfm-transcode-active" : ""}`,
                      onClick: () => setShowTranscodeMenu((prev) => !prev),
                      title: `Stream Codec Engine (${streamMode.toUpperCase()}) — Click to change profile`,
                    },
                    React.createElement(
                      "svg",
                      { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2", fill: "none" },
                      React.createElement("rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }),
                      React.createElement("polygon", { points: "10 8 16 12 10 16 10 8", fill: "currentColor", stroke: "none" }),
                      React.createElement("line", { x1: "8", y1: "1", x2: "8", y2: "4" }),
                      React.createElement("line", { x1: "12", y1: "1", x2: "12", y2: "4" }),
                      React.createElement("line", { x1: "16", y1: "1", x2: "16", y2: "4" }),
                      React.createElement("line", { x1: "8", y1: "20", x2: "8", y2: "23" }),
                      React.createElement("line", { x1: "12", y1: "20", x2: "12", y2: "23" }),
                      React.createElement("line", { x1: "16", y1: "20", x2: "16", y2: "23" }),
                      React.createElement("line", { x1: "1", y1: "8", x2: "4", y2: "8" }),
                      React.createElement("line", { x1: "1", y1: "12", x2: "4", y2: "12" }),
                      React.createElement("line", { x1: "1", y1: "16", x2: "4", y2: "16" }),
                      React.createElement("line", { x1: "20", y1: "8", x2: "23", y2: "8" }),
                      React.createElement("line", { x1: "20", y1: "12", x2: "23", y2: "12" }),
                      React.createElement("line", { x1: "20", y1: "16", x2: "23", y2: "16" })
                    )
                  ),
                  showTranscodeMenu &&
                    React.createElement(
                      "div",
                      { className: "sfm-reel-transcode-menu" },
                      React.createElement(
                        "button",
                        {
                          className: `sfm-menu-item ${streamMode === "direct" && !customStreamUrl ? "active" : ""}`,
                          onClick: () => {
                            setCustomStreamUrl("");
                            setStreamMode("direct");
                            setShowTranscodeMenu(false);
                          },
                        },
                        "Direct Stream (Raw File)"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `sfm-menu-item ${streamMode === "hls" && !customStreamUrl ? "active" : ""}`,
                          onClick: () => {
                            setCustomStreamUrl("");
                            setStreamMode("hls");
                            setShowTranscodeMenu(false);
                          },
                        },
                        "HLS Stream (Adaptive)"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `sfm-menu-item ${streamMode === "webm" && !customStreamUrl ? "active" : ""}`,
                          onClick: () => {
                            setCustomStreamUrl("");
                            setStreamMode("webm");
                            setShowTranscodeMenu(false);
                          },
                        },
                        "WebM Transcode"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `sfm-menu-item ${streamMode === "mp4" && !customStreamUrl ? "active" : ""}`,
                          onClick: () => {
                            setCustomStreamUrl("");
                            setStreamMode("mp4");
                            setShowTranscodeMenu(false);
                          },
                        },
                        "MP4 Transcode"
                      ),
                      availableStreams.filter((s) => !s.url.includes("stream.webm") && !s.url.includes("stream.m3u8") && !s.url.includes("stream.mp4")).map((s, idx) =>
                        React.createElement(
                          "button",
                          {
                            key: `custom-${idx}`,
                            className: `sfm-menu-item ${customStreamUrl === s.url ? "active" : ""}`,
                            onClick: () => {
                              setCustomStreamUrl(s.url);
                              setShowTranscodeMenu(false);
                            },
                          },
                          s.label || (s.mime_type ? s.mime_type.split("/")[1].toUpperCase() : `Custom #${idx + 1}`)
                        )
                      )
                    )
                ),

                // Divider 1: Above Prev/Next Video Button (Doubled Spacing)
                React.createElement("div", { className: "sfm-reel-action-divider" }),

                // 6. Previous Video Button
                React.createElement(
                  "button",
                  {
                    className: "sfm-reel-circle-btn",
                    onClick: goToPrev,
                    disabled: !hasPrev,
                    title: hasPrev ? `Previous: ${prevScene?.title || `Scene #${prevScene?.id}`}` : "First scene in folder",
                  },
                  React.createElement(
                    "svg",
                    { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2.5", fill: "none" },
                    React.createElement("polyline", { points: "18 15 12 9 6 15" })
                  )
                ),
                // 7. Reel Counter Pill
                React.createElement(
                  "div",
                  {
                    className: `sfm-reel-counter-badge ${isShuffle ? "sfm-counter-shuffled" : ""}`,
                    title: isShuffle
                      ? `Shuffled Queue (${currentIndex + 1}/${totalScenes}) — Folder: ${folderName || "Current"}`
                      : `Folder: ${folderName || "Current"}`,
                  },
                  isShuffle ? `🔀 ${currentIndex + 1}/${totalScenes}` : `${currentIndex + 1}/${totalScenes}`
                ),
                // 8. Next Video Button
                React.createElement(
                  "button",
                  {
                    className: "sfm-reel-circle-btn",
                    onClick: goToNext,
                    disabled: !hasNext,
                    title: hasNext
                      ? `Next: ${nextScene?.title || `Scene #${nextScene?.id}`}`
                      : (isShuffle ? "End of shuffled queue" : "Last scene in folder"),
                  },
                  React.createElement(
                    "svg",
                    { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2.5", fill: "none" },
                    React.createElement("polyline", { points: "6 9 12 15 18 9" })
                  )
                ),
                // 9. Shuffle Queue Toggle Button (Randomize without repeats)
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `sfm-reel-circle-btn sfm-btn-shuffle ${isShuffle ? "sfm-shuffle-active" : ""}`,
                    onClick: handleToggleShuffle,
                    disabled: totalScenes <= 1,
                    title: isShuffle
                      ? `Shuffle: ON (randomized without repeats) — Click to disable (S)`
                      : `Shuffle: OFF (sequential folder order) — Click to randomize without repeats (S)`,
                  },
                  React.createElement(IconShuffle, { size: 16 })
                ),
                // Toggle Mobile Phone / Desktop View
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `sfm-reel-circle-btn ${isForceMobile ? "sfm-btn-mobile-active" : ""}`,
                    onClick: handleToggleForceMobile,
                    title: isForceMobile ? "Switch to Fullscreen Desktop Player" : "Switch to Mobile Phone Reel View (TikTok/IG)",
                  },
                  React.createElement(IconSmartphone, { size: 15 })
                ),

                // Bottom actions group: Pushed down so Fullscreen is directly above the scrubbing line
                React.createElement(
                  "div",
                  { className: "sfm-reel-bottom-actions" },
                  // Divider 2: Restored Above PiP Button (Doubled Spacing)
                  React.createElement("div", { className: "sfm-reel-action-divider" }),
                  // 9. Picture-in-Picture Button
                  React.createElement(
                    "button",
                    {
                      className: `sfm-reel-circle-btn ${isPipMode ? "sfm-btn-pip-active" : ""}`,
                      onClick: handleTogglePip,
                      title: "Switch to Picture-in-Picture (P)",
                    },
                    React.createElement(
                      "svg",
                      { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2", fill: "none" },
                      React.createElement("rect", { x: "2", y: "4", width: "20", height: "16", rx: "2" }),
                      React.createElement("rect", { x: "13", y: "11", width: "7", height: "6", rx: "1", fill: "currentColor" })
                    )
                  ),
                  // 10. Fullscreen Button
                  React.createElement(
                    "button",
                    {
                      className: "sfm-reel-circle-btn",
                      onClick: handleToggleFullscreen,
                      title: "Toggle Fullscreen (F)",
                    },
                    React.createElement(
                      "svg",
                      { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2.2", fill: "none" },
                      React.createElement("path", { d: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" })
                    )
                  )
                )
              ),

              // ==========================================
              // Elevated Metadata Overlay:
              // Line 1: Scene Title + Studio Name (with Video Play Vector Icon)
              // Line 2: File Type Badge + Codec + Duration + File Size + Date (Clean Vector SVGs)
              // ==========================================
              React.createElement(
                "div",
                { className: `sfm-reel-description-overlay ${isControlsVisible ? "sfm-visible" : "sfm-hidden"}` },
                // Social Media Avatar & Folder Path (Opens Folder Profile Video Wall)
                React.createElement(
                  "div",
                  {
                    className: "sfm-reel-avatar-bar d-inline-flex align-items-center mb-2",
                    role: "button",
                    tabIndex: 0,
                    onClick: (e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (videoRef.current && !videoRef.current.paused) {
                        videoRef.current.pause();
                      }
                      setShowFolderProfile(true);
                    },
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        e.preventDefault();
                        if (videoRef.current && !videoRef.current.paused) {
                          videoRef.current.pause();
                        }
                        setShowFolderProfile(true);
                      }
                    },
                    title: `View Directory Profile & Video Wall for "${targetFolderPath || "Root"}"`,
                  },
                  React.createElement(
                    "div",
                    { className: "sfm-reel-avatar-box mr-2" },
                    React.createElement("img", {
                      src: posterUrl,
                      className: "sfm-reel-avatar-img",
                      alt: targetFolderPath || "Folder",
                    }),
                    React.createElement(
                      "span",
                      { className: "sfm-reel-avatar-badge" },
                      React.createElement(IconFolder, { size: 9, color: "#141822" })
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "sfm-reel-path-details" },
                    React.createElement(
                      "span",
                      { className: "sfm-reel-path-label" },
                      displayFolderPath
                    )
                  )
                ),
                // Line 1: Pure Title & Studio
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center flex-wrap gap-2 mb-1" },
                  React.createElement(
                    "span",
                    { className: "sfm-reel-title-text d-inline-flex align-items-center" },
                    React.createElement(
                      "svg",
                      { viewBox: "0 0 24 24", width: 14, height: 14, fill: "currentColor", style: { verticalAlign: "-2px", marginRight: "6px" } },
                      React.createElement("polygon", { points: "6 4 19 12 6 20 6 4" })
                    ),
                    title
                  ),
                  studioName && React.createElement("span", { className: "sfm-badge sfm-badge-studio" }, studioName)
                ),
                // Line 2: Format Badge, Codec, Duration, File Size, Date
                React.createElement(
                  "div",
                  { className: "sfm-reel-meta-line d-flex align-items-center flex-wrap" },
                  React.createElement("span", { className: "sfm-badge sfm-badge-primary mr-1" }, extLabel),
                  codecBadge && React.createElement("span", { className: "sfm-badge sfm-badge-codec mr-1" }, codecBadge),
                  durationFormatted &&
                    React.createElement(
                      "span",
                      { className: "mr-2 d-inline-flex align-items-center" },
                      React.createElement(
                        "svg",
                        { viewBox: "0 0 24 24", width: 13, height: 13, stroke: "currentColor", strokeWidth: "2", fill: "none", style: { verticalAlign: "-2px", marginRight: "4px" } },
                        React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
                        React.createElement("polyline", { points: "12 6 12 12 16 14" })
                      ),
                      durationFormatted
                    ),
                  fileSize && fileSize !== "0 B" &&
                    React.createElement(
                      "span",
                      { className: "mr-2 d-inline-flex align-items-center" },
                      React.createElement(
                        "svg",
                        { viewBox: "0 0 24 24", width: 13, height: 13, stroke: "currentColor", strokeWidth: "2", fill: "none", style: { verticalAlign: "-2px", marginRight: "4px" } },
                        React.createElement("line", { x1: "22", y1: "12", x2: "2", y2: "12" }),
                        React.createElement("path", { d: "M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }),
                        React.createElement("line", { x1: "6", y1: "16", x2: "6.01", y2: "16" }),
                        React.createElement("line", { x1: "10", y1: "16", x2: "10.01", y2: "16" })
                      ),
                      fileSize
                    ),
                  dateStr &&
                    React.createElement(
                      "span",
                      { className: "mr-2 d-inline-flex align-items-center" },
                      React.createElement(
                        "svg",
                        { viewBox: "0 0 24 24", width: 13, height: 13, stroke: "currentColor", strokeWidth: "2", fill: "none", style: { verticalAlign: "-2px", marginRight: "4px" } },
                        React.createElement("rect", { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }),
                        React.createElement("line", { x1: "16", y1: "2", x2: "16", y2: "6" }),
                        React.createElement("line", { x1: "8", y1: "2", x2: "8", y2: "6" }),
                        React.createElement("line", { x1: "3", y1: "10", x2: "21", y2: "10" })
                      ),
                      dateStr
                    )
                )
              ),

              // ==========================================
              // Bottom Scrubber Timeline Bar & Controls
              // ==========================================
              React.createElement(
                "div",
                {
                  className: `sfm-reel-bottom-controls ${isControlsVisible ? "sfm-visible" : "sfm-hidden"}`,
                  onClick: (e) => e.stopPropagation(),
                },
                // Scrubber Timeline Bar
                React.createElement(
                  "div",
                  {
                    className: "sfm-reel-scrubber-track",
                    onClick: handleScrubberClick,
                    title: "Seek timeline",
                  },
                  React.createElement("div", {
                    className: "sfm-reel-scrubber-buffered",
                    style: { width: `${bufferedProgress}%` },
                  }),
                  React.createElement("div", {
                    className: "sfm-reel-scrubber-played",
                    style: { width: `${duration ? (currentTime / duration) * 100 : 0}%` },
                  }),
                  React.createElement("div", {
                    className: "sfm-reel-scrubber-thumb",
                    style: { left: `${duration ? (currentTime / duration) * 100 : 0}%` },
                  })
                ),
                // Controls Row
                React.createElement(
                  "div",
                  { className: "d-flex justify-content-between align-items-center mt-2" },
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center gap-3" },
                    React.createElement(
                      "button",
                      {
                        className: "sfm-reel-play-btn",
                        onClick: handleTogglePlay,
                        title: isPlaying ? "Pause (Space)" : "Play (Space)",
                      },
                      isPlaying
                        ? React.createElement(
                            "svg",
                            { viewBox: "0 0 24 24", width: 14, height: 14, fill: "currentColor" },
                            React.createElement("rect", { x: "5", y: "4", width: "4", height: "16", rx: "1" }),
                            React.createElement("rect", { x: "15", y: "4", width: "4", height: "16", rx: "1" })
                          )
                        : React.createElement(
                            "svg",
                            { viewBox: "0 0 24 24", width: 14, height: 14, fill: "currentColor" },
                            React.createElement("polygon", { points: "6 4 19 12 6 20 6 4" })
                          )
                    ),
                    React.createElement(
                      "span",
                      { className: "sfm-reel-time-text" },
                      `${formatTime(currentTime)} / ${formatTime(duration)}`
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center gap-2" },
                    React.createElement(
                      "button",
                      {
                        className: "sfm-reel-vol-btn d-flex align-items-center",
                        onClick: handleToggleMute,
                        title: isMuted ? "Unmute" : "Mute",
                      },
                      isMuted || volume === 0
                        ? React.createElement(
                            "svg",
                            { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: "2" },
                            React.createElement("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5", fill: "currentColor" }),
                            React.createElement("line", { x1: "23", y1: "9", x2: "17", y2: "15" }),
                            React.createElement("line", { x1: "17", y1: "9", x2: "23", y2: "15" })
                          )
                        : React.createElement(
                            "svg",
                            { viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: "2" },
                            React.createElement("polygon", { points: "11 5 6 9 2 9 2 15 6 15 11 19 11 5", fill: "currentColor" }),
                            React.createElement("path", { d: "M15.54 8.46a5 5 0 0 1 0 7.07" }),
                            React.createElement("path", { d: "M19.07 4.93a10 10 0 0 1 0 14.14" })
                          )
                    ),
                    React.createElement("input", {
                      type: "range",
                      className: "sfm-reel-vol-slider",
                      min: 0,
                      max: 1,
                      step: 0.05,
                      value: isMuted ? 0 : volume,
                      onChange: handleVolumeChange,
                      title: `Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`,
                    })
                  )
                )
              )
            )
          )
        )
      );
    }

    // ==========================================
    // Modal: Folder-Scoped Filename Regex Parser (Feature 1)
    // ==========================================
    // ==========================================
    // Modal: Folder-Scoped Filename Regex Parser with Guided Builder
    // ==========================================
    // ==========================================
    // Modal: Upgraded Folder-Scoped Filename Regex Parser (Interactive Blocks + Auto-Detect)
    // ==========================================
    // ==========================================
    // Modal: Upgraded Folder-Scoped Filename Regex Parser (Interactive Blocks + Auto-Detect)
    // ==========================================
    // ==========================================
    // Modal: Path-Clues & Stash-box Grounded Smart Metadata Resolver
    // ==========================================
    // ==========================================
    // Modal: Fully Customizable Smart Filename & Path Resolver
    // ==========================================
    function FilenameParserModal({ currentFolder, currentPath = "", directScenes, onClose, onApplied }) {
      const PRESETS = [
        { label: "✨ Auto-Detected / Interactive Pattern", pattern: "", caseInsensitive: true },
        { label: "Code__PERFORMER_Title__hash (e.g. MM2821__BIANNA_ARSON_Shoot...)", pattern: "^(?<code>[A-Za-z0-9]+)__(?<performers>[A-Z]+(?:_[A-Z]+)*)_+(?<title>.+?)__(?:[a-zA-Z0-9]+)(?:\\.[^.]+)?$", caseInsensitive: false },
        { label: "StudioCode__PERFORMER_Title (e.g. MM1566__KENDRA_COLE_Shoot...)", pattern: "^(?<code>[A-Za-z0-9]+)__(?<performers>[A-Z]+(?:_[A-Z]+)*)_+(?<title>.+?)(?:__[a-zA-Z0-9]{4,10})?(?:\\.[^.]+)?$", caseInsensitive: false },
        { label: "Studio - Date - Title: ^(?<studio>[^-_]+)[-_\\s]+(?<date>\\d{4}[-._]\\d{2}[-._]\\d{2})[-_\\s]+(?<title>.+)$", pattern: "^(?<studio>[^-_]+)[-_\\s]+(?<date>\\d{4}[-._]\\d{2}[-._]\\d{2})[-_\\s]+(?<title>.+)$", caseInsensitive: true },
        { label: "Studio - Code - Title: ^(?<studio>[^-_]+)[-_\\s]+(?<code>[A-Za-z0-9_.-]+)[-_\\s]+(?<title>.+)$", pattern: "^(?<studio>[^-_]+)[-_\\s]+(?<code>[A-Za-z0-9_.-]+)[-_\\s]+(?<title>.+)$", caseInsensitive: true },
        { label: "Studio - Code - Performer - Title: ^(?<studio>[^-_]+)[-_\\s]+(?<code>[A-Za-z0-9_.-]+)[-_\\s]+(?<performers>[^-_]+)[-_\\s]+(?<title>.+)$", pattern: "^(?<studio>[^-_]+)[-_\\s]+(?<code>[A-Za-z0-9_.-]+)[-_\\s]+(?<performers>[^-_]+)[-_\\s]+(?<title>.+)$", caseInsensitive: true },
        { label: "Date.Studio.Performer.Title: ^(?<date>\\d{4}[-._]\\d{2}[-._]\\d{2})[-_\\s.]+(?<studio>[^-_.]+)[-_\\s.]+(?<performers>[^-_.]+)[-_\\s.]+(?<title>.+)$", pattern: "^(?<date>\\d{4}[-._]\\d{2}[-._]\\d{2})[-_\\s.]+(?<studio>[^-_.]+)[-_\\s.]+(?<performers>[^-_.]+)[-_\\s.]+(?<title>.+)$", caseInsensitive: true },
        { label: "Performer - Title (Date): ^(?<performers>[^-_]+)[-_\\s]+(?<title>[^()]+?)(?:\\s*\\((?<date>\\d{4}[-._]?\\d{2}[-._]?\\d{2}|\\d{4})\\))?$", pattern: "^(?<performers>[^-_]+)[-_\\s]+(?<title>[^()]+?)(?:\\s*\\((?<date>\\d{4}[-._]?\\d{2}[-._]?\\d{2}|\\d{4})\\))?$", caseInsensitive: true },
        { label: "Code - Title: ^(?<code>[A-Za-z0-9_.-]+)[-_\\s]+(?<title>.+)$", pattern: "^(?<code>[A-Za-z0-9_.-]+)[-_\\s]+(?<title>.+)$", caseInsensitive: true },
      ];

      const FIELDS = [
        { id: "title", label: "Title", color: "#88c0d0" },
        { id: "date", label: "Date", color: "#a3be8c" },
        { id: "code", label: "StudioCode", color: "#ebcb8b" },
        { id: "duration", label: "Duration", color: "#b48ead" },
        { id: "studio", label: "Studio", color: "#81a1c1" },
        { id: "performers", label: "Performers", color: "#d08770" },
        { id: "ignore", label: "Ignore", color: "#4c566a" },
      ];

      // Inspect first sample to determine if current folder is a double-underscore release
      const initialSampleBasename = directScenes[0]?.files?.[0]?.basename || "";
      const initialSampleNoExt = initialSampleBasename.replace(/\.[^/.]+$/, "");
      const isInitialDunder = /^([A-Za-z0-9]{2,8})__([A-Z]+(?:_[A-Z]+)*)_+(.+?)(?:__[a-zA-Z0-9]{4,10})?$/.test(initialSampleNoExt);
      const dunderPattern = "^(?<code>[A-Za-z0-9]+)__(?<performers>[A-Z]+(?:_[A-Z]+)*)_+(?<title>.+?)__(?:[a-zA-Z0-9]+)(?:\\.[^.]+)?$";

      const [builderMode, setBuilderMode] = useState("guided"); // "guided" | "raw"
      const [sampleIndex, setSampleIndex] = useState(0);
      const [pattern, setPattern] = useState(() => (isInitialDunder ? dunderPattern : PRESETS[1].pattern));
      const [caseInsensitive, setCaseInsensitive] = useState(() => !isInitialDunder);
      const [flexibleDelimiters, setFlexibleDelimiters] = useState(true);
      const [cleanSpaces, setCleanSpaces] = useState(true);
      const [titleCase, setTitleCase] = useState(true);
      const [normalizeDate, setNormalizeDate] = useState(true);
      const [previewFilter, setPreviewFilter] = useState("all"); // "all" | "matched" | "unmatched"
      const [chunks, setChunks] = useState([]);
      const [activeSplitChunkId, setActiveSplitChunkId] = useState(null); // Chunk ID currently being split
      const [selectedSceneIds, setSelectedSceneIds] = useState(() => new Set());
      const [isExecuting, setIsExecuting] = useState(false);
      const [progressText, setProgressText] = useState("");

      // --- PATH CLUES & STASH-BOX STATE ---
      const [pathClues, setPathClues] = useState([]);
      const [availableStashBoxes, setAvailableStashBoxes] = useState([]);
      const [selectedStashBox, setSelectedStashBox] = useState("");
      const [isCloudQuerying, setIsCloudQuerying] = useState(false);
      const [cloudMatches, setCloudMatches] = useState({});

      const sampleScene = directScenes[sampleIndex] || directScenes[0];
      const sampleRawBasename = sampleScene?.files?.[0]?.basename || "";
      const sampleWithoutExt = sampleRawBasename.replace(/\\.[^/.]+$/, "");

      // Helper: escape regex literal
      const escapeRegex = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

      // Initialize Path Clues from directory hierarchy
      useEffect(() => {
        const fullSamplePath = sampleScene?.files?.[0]?.path || currentPath || "";
        const normalized = fullSamplePath.replace(/\\/g, "/");
        const dirParts = normalized.split("/").filter(Boolean);
        if (dirParts.length > 0 && dirParts[dirParts.length - 1].includes(".")) {
          dirParts.pop();
        }

        const relevantParts = dirParts.slice(-3);
        const initialClues = relevantParts.map((part, idx) => {
          const isParent = (idx === relevantParts.length - 1);
          const isGrandparent = (idx === relevantParts.length - 2);
          let role = "ignore";
          if (isParent) role = "studio";
          else if (isGrandparent && /^vr|4k|1080p|uhd$/i.test(part)) role = "tag";
          return { name: part, role, verifiedStudioId: null };
        });

        setPathClues(initialClues);

        if (initialClues.length > 0) {
          const parentClue = initialClues[initialClues.length - 1];
          gqlFetch(
            `query CheckStudioClue($name: String!) {
              findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
                studios { id name }
              }
            }`,
            { name: parentClue.name }
          )
            .then((res) => {
              const matchedStudio = res?.findStudios?.studios?.[0];
              if (matchedStudio) {
                setPathClues((prev) =>
                  prev.map((c) => (c.name === parentClue.name ? { ...c, role: "studio", verifiedStudioId: matchedStudio.id } : c))
                );
              }
            })
            .catch(() => {});
        }

        gqlFetch(`query GetStashBoxesConfig {
          configuration {
            general {
              stashBoxes {
                name
                endpoint
                api_key
              }
            }
          }
        }`)
          .then((res) => {
            const boxes = res?.configuration?.general?.stashBoxes || [];
            setAvailableStashBoxes(boxes);
            if (boxes.length > 0) {
              setSelectedStashBox(boxes[0].endpoint);
            }
          })
          .catch(() => {});
      }, [sampleIndex, currentPath]);

      const handleSetPathClueRole = (segmentName, newRole) => {
        setPathClues((prev) => prev.map((c) => (c.name === segmentName ? { ...c, role: newRole } : c)));
      };

      const activeStudioClue = useMemo(() => {
        const clue = pathClues.find((c) => c.role === "studio");
        return clue ? clue.name : "";
      }, [pathClues]);

      const activePerformerClue = useMemo(() => {
        const clue = pathClues.find((c) => c.role === "performer");
        return clue ? clue.name : "";
      }, [pathClues]);

      // Compile regex directly from visual chunks by inspecting actual separators in sampleWithoutExt
      const compileRegexFromChunks = (currentChunks, sampleText) => {
        if (!currentChunks || currentChunks.length === 0) return;

        let cursor = 0;
        let regex = "^";
        let hasUppercaseOnlyGroup = false;

        currentChunks.forEach((chunk, idx) => {
          const isLast = (idx === currentChunks.length - 1);
          const chunkText = chunk.text;
          const pos = sampleText.indexOf(chunkText, cursor);

          // If there is literal separator text between the previous chunk and this chunk
          if (pos > cursor) {
            const sepText = sampleText.substring(cursor, pos);
            if (sepText === "__") {
              regex += "__";
            } else if (/^_+$/.test(sepText)) {
              regex += "_+";
            } else if (sepText.includes(" - ")) {
              regex += "\\s*-\\s*";
            } else if (/^\\s+$/.test(sepText)) {
              regex += "\\s+";
            } else {
              regex += escapeRegex(sepText);
            }
          }

          // Build field pattern
          if (chunk.fieldId === "ignore") {
            regex += isLast ? "(?:.+)" : "(?:[a-zA-Z0-9]+)";
          } else if (chunk.fieldId === "code") {
            if (/^\\d+$/.test(chunkText)) {
              regex += "(?<code>\\d+)";
            } else {
              // Code must NOT include underscores
              regex += "(?<code>[A-Za-z0-9]+)";
            }
          } else if (chunk.fieldId === "studio") {
            if (/^[A-Za-z]+$/.test(chunkText)) {
              regex += "(?<studio>[A-Za-z]+)";
            } else {
              regex += "(?<studio>[A-Za-z0-9]+)";
            }
          } else if (chunk.fieldId === "performers") {
            if (/^[A-Z_]+$/.test(chunkText)) {
              hasUppercaseOnlyGroup = true;
              regex += "(?<performers>[A-Z]+(?:_[A-Z]+)*)";
            } else {
              regex += "(?<performers>[A-Za-z]+(?:[\\s_][A-Za-z]+)*)";
            }
          } else if (chunk.fieldId === "title") {
            regex += isLast ? "(?<title>.+)" : "(?<title>.+?)";
          } else if (chunk.fieldId === "date") {
            regex += "(?<date>\\d{4}[-._]\\d{2}[-._]\\d{2}|\\d{6,8})";
          } else if (chunk.fieldId === "duration") {
            regex += "(?<duration>\\d+(?:m|min|s|sec)?|\\d+:\\d+(?::\\d+)?)";
          }

          cursor = pos >= 0 ? (pos + chunkText.length) : cursor;
        });

        // Trailing separator / hash
        if (cursor < sampleText.length) {
          const trailing = sampleText.substring(cursor);
          if (trailing === "__") regex += "__";
          else if (/^_+$/.test(trailing)) regex += "_+";
          else regex += escapeRegex(trailing);
        }

        regex += "(?:\\.[^.]+)?$";
        setPattern(regex);

        // If the performer group relies on uppercase, automatically enforce case-sensitivity
        if (hasUppercaseOnlyGroup) {
          setCaseInsensitive(false);
        }
      };

      // Auto-detect chunks from filename
      const autoDetectFromFilename = (filename, forcedDelimiter = null) => {
        if (!filename) return;

        // Pattern: MM2821__BIANNA_ARSON_Shoot_closeup_XXX__1q2wxz
        const dunderFull = filename.match(/^([A-Za-z0-9]{2,8})__([A-Z]+(?:_[A-Z]+)*)_+(.+?)__(?:[a-zA-Z0-9]+)$/);
        if (dunderFull && !forcedDelimiter) {
          const detectedChunks = [
            { id: 1, text: dunderFull[1], fieldId: "code" },
            { id: 2, text: dunderFull[2], fieldId: "performers" },
            { id: 3, text: dunderFull[3], fieldId: "title" },
            { id: 4, text: filename.substring(filename.lastIndexOf("__") + 2), fieldId: "ignore" },
          ];
          setChunks(detectedChunks);
          compileRegexFromChunks(detectedChunks, filename);
          return;
        }

        let delimiter = forcedDelimiter;
        if (!delimiter) {
          if (filename.includes("__")) delimiter = "__";
          else if (filename.includes(" - ")) delimiter = " - ";
          else if (filename.includes("_")) delimiter = "_";
          else if (filename.includes(".")) delimiter = ".";
          else delimiter = " ";
        }

        const rawParts = filename.split(delimiter).map((p) => p.trim()).filter(Boolean);
        const detectedChunks = [];

        rawParts.forEach((part, idx) => {
          let fieldId = "title";
          if (/^(1080p|2160p|4k|720p|480p|hevc|x264|x265|h264|h265|web-dl|aac|uhd|hd|sd|vr|60fps|3dh|sbs)$/i.test(part)) {
            fieldId = "ignore";
          } else if (idx === rawParts.length - 1 && /^[a-zA-Z0-9]{5,8}$/.test(part)) {
            fieldId = "ignore";
          } else if (/^\\d{4}[-._]\\d{2}[-._]\\d{2}$/.test(part) || /^\\d{6,8}$/.test(part)) {
            fieldId = "date";
          } else if (/^[A-Za-z0-9]{2,6}[-_]?[0-9]{2,5}$/i.test(part) || /^[A-Z]{2,}\\d{2,}$/i.test(part)) {
            fieldId = "code";
          } else if (/^\\d+[mhms]$/i.test(part) || /^\\d+:\\d+(?::\\d+)?$/.test(part)) {
            fieldId = "duration";
          } else if (idx === 0 && rawParts.length > 1) {
            fieldId = "studio";
          } else if (idx === rawParts.length - 1) {
            fieldId = "title";
          } else if (idx === 1 && rawParts.length > 2) {
            fieldId = "performers";
          }

          detectedChunks.push({
            id: Date.now() + idx,
            text: part,
            fieldId,
          });
        });

        setChunks(detectedChunks);
        compileRegexFromChunks(detectedChunks, filename);
      };

      // Run initial auto-detection on mount or sample switch
      useEffect(() => {
        if (sampleWithoutExt) {
          autoDetectFromFilename(sampleWithoutExt);
        }
      }, [sampleIndex]);

      // Change field role of a chunk
      const handleSetChunkField = (chunkId, newFieldId) => {
        const updated = chunks.map((c) => (c.id === chunkId ? { ...c, fieldId: newFieldId } : c));
        setChunks(updated);
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

      // Edit text of a chunk directly
      const handleEditChunkText = (chunkId, newText) => {
        const updated = chunks.map((c) => (c.id === chunkId ? { ...c, text: newText } : c));
        setChunks(updated);
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

      // Delete a chunk
      const handleDeleteChunk = (chunkId) => {
        const updated = chunks.filter((c) => c.id !== chunkId);
        setChunks(updated);
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

      // Split a chunk into two chunks at a specific position or split string
      const handleSplitChunk = (chunkId, part1, part2, field1, field2) => {
        const idx = chunks.findIndex((c) => c.id === chunkId);
        if (idx === -1) return;

        const newChunk1 = { id: Date.now(), text: part1, fieldId: field1 || chunks[idx].fieldId };
        const newChunk2 = { id: Date.now() + 1, text: part2, fieldId: field2 || "title" };

        const updated = [...chunks.slice(0, idx), newChunk1, newChunk2, ...chunks.slice(idx + 1)];
        setChunks(updated);
        setActiveSplitChunkId(null);
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

      // Merge chunk with next chunk
      const handleMergeWithNext = (idx) => {
        if (idx >= chunks.length - 1) return;
        const current = chunks[idx];
        const next = chunks[idx + 1];
        const merged = {
          ...current,
          text: `${current.text} ${next.text}`,
        };
        const updated = [...chunks.slice(0, idx), merged, ...chunks.slice(idx + 2)];
        setChunks(updated);
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

      // Helper to clean extracted text
      const cleanExtracted = (fieldId, rawVal) => {
        if (!rawVal) return "";
        let val = rawVal.trim();
        if (fieldId === "title") {
          val = val.replace(/__+/g, " - ").replace(/[_.]+/g, " ").replace(/\\s+/g, " ").trim();
          if (titleCase) {
            val = val.replace(/\\w\\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
            val = val.replace(/\\bXxx\\b/g, "XXX");
            val = val.replace(/\\b4k\\b/g, "4K");
          }
        } else if (fieldId === "studio" || fieldId === "performers") {
          val = val.replace(/__+/g, ", ").replace(/[_.]+/g, " ").replace(/\\s+/g, " ").trim();
          if (titleCase) {
            val = val.replace(/\\w\\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
          }
        } else if (fieldId === "date") {
          if (normalizeDate) {
            val = val.replace(/[._]/g, "-");
            if (/^\\d{8}$/.test(val)) {
              val = `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(6, 8)}`;
            }
          }
        }
        return val;
      };

      // Compute parsed matches in real-time
      const parsedResults = useMemo(() => {
        let re = null;
        try {
          re = new RegExp(pattern, caseInsensitive ? "i" : "");
        } catch (e) {
          return { error: e.message, items: [] };
        }

        const items = directScenes.map((scene) => {
          const rawBasename = scene.files?.[0]?.basename || "";
          const nameWithoutExt = rawBasename.replace(/\\.[^/.]+$/, "");
          const match = re.exec(nameWithoutExt) || re.exec(rawBasename);

          if (!match || !match.groups) {
            return { scene, rawBasename, matched: false, groups: {} };
          }
          return { scene, rawBasename, matched: true, groups: match.groups };
        });

        return { error: null, items };
      }, [pattern, caseInsensitive, directScenes]);

      // Query Stash-box for all matched scenes
      const handleQueryStashBox = async () => {
        if (!selectedStashBox) return;
        setIsCloudQuerying(true);
        setProgressText("Querying Stash-box for scene metadata...");

        const newCloudMatches = { ...cloudMatches };
        const matchedItems = parsedResults.items.filter((i) => i.matched);

        for (let i = 0; i < matchedItems.length; i++) {
          const item = matchedItems[i];
          const queryCode = item.groups.code || item.groups.title || "";
          if (!queryCode) continue;

          setProgressText(`Querying Stash-box (${i + 1}/${matchedItems.length}): ${queryCode}...`);

          try {
            const sRes = await gqlFetch(
              `query ScrapeSceneFromBox($source: ScraperSourceInput!, $input: ScrapeSingleSceneInput!) {
                scrapeSingleScene(source: $source, input: $input) {
                  title
                  details
                  url
                  date
                  code
                  studio { name }
                  performers { name }
                  tags { name }
                }
              }`,
              {
                source: { stash_box_endpoint: selectedStashBox },
                input: { query: queryCode.trim() },
              }
            );

            const scraped = sRes?.scrapeSingleScene?.[0];
            if (scraped) {
              newCloudMatches[item.scene.id] = scraped;
            }
          } catch (err) {
            console.warn(`Stash-box scrape error for ${queryCode}:`, err);
          }
        }

        setCloudMatches(newCloudMatches);
        setIsCloudQuerying(false);
        setProgressText(`Completed Stash-box resolution. Found ${Object.keys(newCloudMatches).length} verified matches.`);
      };

      useEffect(() => {
        const matchedIds = new Set(parsedResults.items.filter((i) => i.matched).map((i) => i.scene.id));
        setSelectedSceneIds(matchedIds);
      }, [parsedResults]);

      const matchedCount = parsedResults.items.filter((i) => i.matched).length;
      const unmatchedCount = parsedResults.items.length - matchedCount;

      const filteredItems = useMemo(() => {
        if (previewFilter === "matched") return parsedResults.items.filter((i) => i.matched);
        if (previewFilter === "unmatched") return parsedResults.items.filter((i) => !i.matched);
        return parsedResults.items;
      }, [parsedResults, previewFilter]);

      const handleToggleSelectScene = (sceneId) => {
        const next = new Set(selectedSceneIds);
        if (next.has(sceneId)) next.delete(sceneId);
        else next.add(sceneId);
        setSelectedSceneIds(next);
      };

      const handleSelectAllMatched = () => {
        if (selectedSceneIds.size === matchedCount) {
          setSelectedSceneIds(new Set());
        } else {
          setSelectedSceneIds(new Set(parsedResults.items.filter((i) => i.matched).map((i) => i.scene.id)));
        }
      };

      const handleExecute = async () => {
        const scenesToUpdate = parsedResults.items.filter((i) => i.matched && selectedSceneIds.has(i.scene.id));
        if (scenesToUpdate.length === 0) return;
        setIsExecuting(true);
        setProgressText(`Starting updates for ${scenesToUpdate.length} scenes...`);

        try {
          let success = 0;

          for (let i = 0; i < scenesToUpdate.length; i++) {
            const item = scenesToUpdate[i];
            const cloud = cloudMatches[item.scene.id];
            setProgressText(`Updating scene ${i + 1}/${scenesToUpdate.length}: ${item.rawBasename}...`);

            const updateInput = { id: item.scene.id };
            const { title, date, code, studio, performers } = item.groups;

            const finalTitle = cloud?.title || cleanExtracted("title", title);
            const finalDate = cloud?.date || cleanExtracted("date", date);
            const finalCode = cloud?.code || (code || "").trim();
            const finalStudio = cloud?.studio?.name || cleanExtracted("studio", studio) || activeStudioClue;
            const finalPerformers = cloud?.performers ? cloud.performers.map((p) => p.name).join(", ") : (cleanExtracted("performers", performers) || activePerformerClue);

            if (finalTitle) updateInput.title = finalTitle;
            if (finalDate && /^\\d{4}-\\d{2}-\\d{2}$/.test(finalDate)) {
              updateInput.date = finalDate;
            }
            if (finalCode) {
              updateInput.code = finalCode;
            }
            if (cloud?.details) {
              updateInput.details = cloud.details;
            }

            if (finalStudio) {
              const sRes = await gqlFetch(
                `query FindStudio($name: String!) {
                  findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
                    studios { id name }
                  }
                }`,
                { name: finalStudio }
              );
              const found = sRes?.findStudios?.studios?.[0];
              if (found) updateInput.studio_id = found.id;
            }

            if (finalPerformers) {
              const pNames = finalPerformers.split(/,|&|\\band\\b/i).map((s) => s.trim()).filter(Boolean);
              const pIds = [];
              for (const pName of pNames) {
                const pRes = await gqlFetch(
                  `query FindPerformer($name: String!) {
                    findPerformers(performer_filter: { name: { value: $name, modifier: EQUALS } }) {
                      performers { id name }
                    }
                  }`,
                  { name: pName }
                );
                const found = pRes?.findPerformers?.performers?.[0];
                if (found) pIds.push(found.id);
              }
              if (pIds.length > 0) updateInput.performer_ids = pIds;
            }

            await gqlFetch(
              `mutation UpdateScene($input: SceneUpdateInput!) {
                sceneUpdate(input: $input) { id }
              }`,
              { input: updateInput }
            );
            success++;
          }

          setProgressText(`Successfully updated ${success} scenes with verified metadata!`);
          setTimeout(() => {
            clearCachedScenes();
            onApplied();
            onClose();
          }, 1200);
        } catch (err) {
          console.error(err);
          setProgressText(`Error: ${err.message}`);
          setIsExecuting(false);
        }
      };

      return React.createElement(
        "div",
        { className: "sfm-modal-backdrop", onClick: onClose },
        React.createElement(
          "div",
          { className: "sfm-modal-dialog sfm-modal-dialog-large sfm-parser-modal", onClick: (e) => e.stopPropagation() },
          React.createElement(
            "div",
            { className: "sfm-modal-header d-flex justify-content-between align-items-center" },
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-3" },
              React.createElement("h5", { className: "mb-0" }, "🔍 Customizable Filename & Path Resolver"),
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm sfm-builder-mode-tabs ml-3" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `btn btn-sm ${builderMode === "guided" ? "btn-info font-weight-bold" : "btn-outline-secondary"} py-0 px-3`,
                    onClick: () => setBuilderMode("guided"),
                  },
                  "✨ Interactive Blocks"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `btn btn-sm ${builderMode === "raw" ? "btn-info font-weight-bold" : "btn-outline-secondary"} py-0 px-3`,
                    onClick: () => setBuilderMode("raw"),
                  },
                  "⚙️ Raw Regex"
                )
              )
            ),
            React.createElement("button", { className: "close text-light", onClick: onClose }, "×")
          ),
          React.createElement(
            "div",
            { className: "sfm-modal-body" },
            // Section 1: Directory Path Clues
            React.createElement(
              "div",
              { className: "sfm-path-clues-card p-2 px-3 mb-3 rounded bg-dark border border-secondary" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center gap-2" },
                  React.createElement("span", { className: "badge badge-info" }, "📁 Path Clues"),
                  React.createElement("span", { className: "small text-muted" }, "Folder hierarchy context inferred from filesystem:")
                ),
                availableStashBoxes.length > 0 &&
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center gap-2" },
                    React.createElement("span", { className: "small text-light" }, "🌐 Stash-box:"),
                    React.createElement(
                      "select",
                      {
                        className: "form-control form-control-sm bg-dark text-info border-secondary py-0",
                        style: { width: "auto", height: "24px", fontSize: "0.78rem" },
                        value: selectedStashBox,
                        onChange: (e) => setSelectedStashBox(e.target.value),
                      },
                      availableStashBoxes.map((box) =>
                        React.createElement("option", { key: box.endpoint, value: box.endpoint }, `${box.name} (${box.endpoint})`)
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "btn btn-xs btn-primary font-weight-bold py-0 px-2",
                        disabled: isCloudQuerying || matchedCount === 0,
                        onClick: handleQueryStashBox,
                        title: "Query Stash-box using Code and Path clues to fetch canonical metadata",
                      },
                      isCloudQuerying ? "Querying..." : "🌐 Query Stash-box"
                    )
                  )
              ),
              React.createElement(
                "div",
                { className: "d-flex align-items-center flex-wrap gap-2" },
                pathClues.map((clue, idx) =>
                  React.createElement(
                    "div",
                    {
                      key: clue.name,
                      className: "sfm-path-clue-pill d-inline-flex align-items-center p-1 px-2 rounded bg-black border border-secondary",
                    },
                    React.createElement("span", { className: "text-muted small mr-1" }, idx === pathClues.length - 1 ? "Parent:" : "Folder:"),
                    React.createElement("span", { className: "font-weight-bold text-light mr-2", style: { fontFamily: "monospace" } }, clue.name),
                    React.createElement(
                      "select",
                      {
                        className: "form-control form-control-sm border-0 py-0 px-1 font-weight-bold",
                        style: {
                          width: "auto",
                          height: "22px",
                          fontSize: "0.75rem",
                          backgroundColor: clue.role === "studio" ? "#81a1c1" : clue.role === "performer" ? "#d08770" : clue.role === "tag" ? "#ebcb8b" : "#4c566a",
                          color: "#1e222a",
                          borderRadius: "3px",
                        },
                        value: clue.role,
                        onChange: (e) => handleSetPathClueRole(clue.name, e.target.value),
                      },
                      React.createElement("option", { value: "studio" }, "Studio Clue"),
                      React.createElement("option", { value: "performer" }, "Performer Clue"),
                      React.createElement("option", { value: "tag" }, "Tag Clue"),
                      React.createElement("option", { value: "ignore" }, "Ignore")
                    ),
                    clue.verifiedStudioId &&
                      React.createElement("span", { className: "badge badge-success ml-2 py-0 px-1", title: "Matched verified Studio in local Stash database" }, "✓ DB Studio")
                  )
                )
              )
            ),
            // Section 2: Interactive Field Customization Blocks
            builderMode === "guided"
              ? React.createElement(
                  "div",
                  { className: "sfm-guided-card p-3 mb-3 rounded bg-dark border border-secondary" },
                  // Sample File Toolbar
                  React.createElement(
                    "div",
                    { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center gap-2" },
                      React.createElement("span", { className: "badge badge-secondary" }, "Sample File"),
                      React.createElement("span", { className: "font-weight-bold text-light", style: { fontFamily: "monospace" } }, sampleWithoutExt)
                    ),
                    directScenes.length > 1 &&
                      React.createElement(
                        "div",
                        { className: "d-flex align-items-center gap-2" },
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-outline-secondary py-0 px-2",
                            disabled: sampleIndex <= 0,
                            onClick: () => setSampleIndex(Math.max(0, sampleIndex - 1)),
                          },
                          "◀ Prev"
                        ),
                        React.createElement("span", { className: "text-muted small" }, `${sampleIndex + 1} of ${directScenes.length}`),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-outline-secondary py-0 px-2",
                            disabled: sampleIndex >= directScenes.length - 1,
                            onClick: () => setSampleIndex(Math.min(directScenes.length - 1, sampleIndex + 1)),
                          },
                          "Next ▶"
                        )
                      )
                  ),
                  // Word Chunks & Customization Action Bar
                  React.createElement(
                    "div",
                    { className: "mb-3" },
                    React.createElement(
                      "div",
                      { className: "d-flex justify-content-between align-items-center mb-1" },
                      React.createElement("label", { className: "small font-weight-bold text-muted mb-0" }, "CUSTOMIZE & ADJUST FIELDS:"),
                      React.createElement(
                        "div",
                        { className: "d-flex align-items-center gap-1" },
                        React.createElement("span", { className: "small text-muted mr-1" }, "Auto:"),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-info font-weight-bold py-0 px-2 mr-1",
                            onClick: () => autoDetectFromFilename(sampleWithoutExt),
                            title: "Auto-detect fields using smart heuristics",
                          },
                          "✨ Auto-Detect"
                        ),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-outline-secondary py-0 px-1",
                            onClick: () => autoDetectFromFilename(sampleWithoutExt, "__"),
                          },
                          '"__"'
                        ),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-outline-secondary py-0 px-1",
                            onClick: () => autoDetectFromFilename(sampleWithoutExt, " - "),
                          },
                          '" - "'
                        ),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-outline-secondary py-0 px-1",
                            onClick: () => autoDetectFromFilename(sampleWithoutExt, "_"),
                          },
                          '"_"'
                        )
                      )
                    ),
                    // Word block items with Split, Edit, Merge, and Role Dropdown
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center flex-wrap gap-2 p-2 rounded bg-black border border-secondary" },
                      chunks.map((chunk, idx) => {
                        const fObj = FIELDS.find((f) => f.id === chunk.fieldId) || FIELDS[0];
                        const isSplitting = activeSplitChunkId === chunk.id;

                        // Calculate split suggestions (letters/digits, underscores, dashes)
                        const splitSuggestions = [];
                        const text = chunk.text;
                        const ldMatch = text.match(/^([A-Za-z]+)(\\d+)$/);
                        if (ldMatch) {
                          splitSuggestions.push({ p1: ldMatch[1], p2: ldMatch[2], f1: "studio", f2: "code", label: `"${ldMatch[1]}" (Studio) + "${ldMatch[2]}" (Code)` });
                        }
                        if (text.includes("_")) {
                          const parts = text.split("_");
                          if (parts.length > 1) {
                            splitSuggestions.push({ p1: parts[0], p2: parts.slice(1).join("_"), f1: chunk.fieldId, f2: "title", label: `"${parts[0]}" + "${parts.slice(1).join("_")}"` });
                            splitSuggestions.push({ p1: parts.slice(0, -1).join("_"), p2: parts[parts.length - 1], f1: chunk.fieldId, f2: "ignore", label: `"${parts.slice(0, -1).join("_")}" + "${parts[parts.length - 1]}"` });
                          }
                        }

                        return React.createElement(
                          "div",
                          {
                            key: chunk.id,
                            className: "sfm-chunk-box d-inline-flex flex-column rounded p-1 mr-1 mb-1 position-relative",
                            style: { border: `1px solid ${fObj.color}`, backgroundColor: "#1a1f2c" },
                          },
                          React.createElement(
                            "div",
                            { className: "d-flex align-items-center" },
                            React.createElement(
                              "span",
                              {
                                className: "font-weight-bold px-2 py-0",
                                style: { fontFamily: "monospace", fontSize: "0.88rem", color: "#eceff4" },
                                title: "Click ✂️ to split this field or change its assignment",
                              },
                              chunk.text
                            ),
                            React.createElement(
                              "select",
                              {
                                className: "form-control form-control-sm border-0 py-0 px-1 font-weight-bold mr-1",
                                style: {
                                  width: "auto",
                                  height: "22px",
                                  fontSize: "0.76rem",
                                  backgroundColor: fObj.color,
                                  color: "#1e222a",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                },
                                value: chunk.fieldId,
                                onChange: (e) => handleSetChunkField(chunk.id, e.target.value),
                              },
                              FIELDS.map((f) => React.createElement("option", { key: f.id, value: f.id }, f.label))
                            ),
                            // ✂️ Split Button
                            React.createElement(
                              "button",
                              {
                                type: "button",
                                className: `btn btn-xs ${isSplitting ? "btn-warning" : "btn-outline-secondary"} py-0 px-1 mr-1`,
                                onClick: () => setActiveSplitChunkId(isSplitting ? null : chunk.id),
                                title: "Break / Split this field into two separate fields",
                              },
                              "✂️"
                            ),
                            // ▶ Merge with next button
                            idx < chunks.length - 1 &&
                              React.createElement(
                                "button",
                                {
                                  type: "button",
                                  className: "btn btn-xs btn-link text-muted p-0 mr-1",
                                  onClick: () => handleMergeWithNext(idx),
                                  title: "Merge with next field",
                                },
                                "▶"
                              ),
                            // ✕ Delete chunk button
                            React.createElement(
                              "button",
                              {
                                type: "button",
                                className: "btn btn-xs text-muted p-0 px-1",
                                onClick: () => handleDeleteChunk(chunk.id),
                                title: "Remove field",
                              },
                              "×"
                            )
                          ),
                          // Interactive Split Popover Bar
                          isSplitting &&
                            React.createElement(
                              "div",
                              {
                                className: "p-2 mt-1 rounded bg-black border border-warning shadow",
                                style: { minWidth: "220px", zIndex: 10 },
                              },
                              React.createElement("div", { className: "small font-weight-bold text-warning mb-1" }, `✂️ Break apart "${chunk.text}":`),
                              splitSuggestions.map((sug, sIdx) =>
                                React.createElement(
                                  "button",
                                  {
                                    key: sIdx,
                                    type: "button",
                                    className: "btn btn-xs btn-outline-info text-left d-block w-100 mb-1 py-1 px-2 font-weight-bold",
                                    style: { fontSize: "0.75rem" },
                                    onClick: () => handleSplitChunk(chunk.id, sug.p1, sug.p2, sug.f1, sug.f2),
                                  },
                                  `Break into: ${sug.label}`
                                )
                              ),
                              // Halfway custom split fallback
                              splitSuggestions.length === 0 &&
                                React.createElement(
                                  "div",
                                  { className: "d-flex align-items-center gap-1" },
                                  React.createElement(
                                    "button",
                                    {
                                      type: "button",
                                      className: "btn btn-xs btn-info py-0 px-2",
                                      onClick: () => {
                                        const half = Math.floor(chunk.text.length / 2);
                                        handleSplitChunk(chunk.id, chunk.text.substring(0, half), chunk.text.substring(half), chunk.fieldId, "title");
                                      },
                                    },
                                    "Split in half"
                                  )
                                )
                            )
                        );
                      })
                    )
                  ),
                  // Cleaner & Delimiter Settings
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center flex-wrap gap-3 small text-muted pt-2 border-top border-secondary" },
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center gap-1 cursor-pointer" },
                      React.createElement("input", {
                        type: "checkbox",
                        id: "sfm-clean-spaces",
                        checked: cleanSpaces,
                        onChange: (e) => setCleanSpaces(e.target.checked),
                      }),
                      React.createElement("label", { htmlFor: "sfm-clean-spaces", className: "mb-0 ml-1 text-light cursor-pointer" }, "Replace _ and . with spaces")
                    ),
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center gap-1 cursor-pointer" },
                      React.createElement("input", {
                        type: "checkbox",
                        id: "sfm-clean-titlecase",
                        checked: titleCase,
                        onChange: (e) => setTitleCase(e.target.checked),
                      }),
                      React.createElement("label", { htmlFor: "sfm-clean-titlecase", className: "mb-0 ml-1 text-light cursor-pointer" }, "Title Case")
                    ),
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center gap-1 cursor-pointer" },
                      React.createElement("input", {
                        type: "checkbox",
                        id: "sfm-clean-normdate",
                        checked: normalizeDate,
                        onChange: (e) => setNormalizeDate(e.target.checked),
                      }),
                      React.createElement("label", { htmlFor: "sfm-clean-normdate", className: "mb-0 ml-1 text-light cursor-pointer" }, "Normalize Date (YYYY-MM-DD)")
                    )
                  )
                )
              : React.createElement(
                  "div",
                  { className: "sfm-raw-builder-section mb-3" },
                  React.createElement(
                    "div",
                    { className: "form-group mb-2" },
                    React.createElement("label", { className: "small font-weight-bold" }, "Preset Patterns"),
                    React.createElement(
                      "select",
                      {
                        className: "form-control form-control-sm bg-dark text-light border-secondary",
                        onChange: (e) => {
                          const chosen = PRESETS.find((p) => p.pattern === e.target.value);
                          setPattern(e.target.value);
                          if (chosen && chosen.caseInsensitive !== undefined) {
                            setCaseInsensitive(chosen.caseInsensitive);
                          }
                        },
                      },
                      PRESETS.map((p) => React.createElement("option", { key: p.label, value: p.pattern }, p.label))
                    )
                  )
                ),
            // Pattern Display & Options
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-1" },
                React.createElement("label", { className: "small font-weight-bold mb-0" }, "Active Regular Expression"),
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center gap-2 small text-muted" },
                  React.createElement("input", {
                    type: "checkbox",
                    id: "sfm-case-sens",
                    checked: caseInsensitive,
                    onChange: (e) => setCaseInsensitive(e.target.checked),
                  }),
                  React.createElement("label", { htmlFor: "sfm-case-sens", className: "mb-0 cursor-pointer" }, "Case insensitive (?i)")
                )
              ),
              React.createElement("input", {
                type: "text",
                className: "form-control font-weight-bold bg-dark text-info border-secondary sfm-regex-input",
                value: pattern,
                readOnly: builderMode === "guided",
                onChange: (e) => setPattern(e.target.value),
                style: { fontFamily: "monospace", fontSize: "0.9rem" },
              })
            ),
            parsedResults.error &&
              React.createElement("div", { className: "alert alert-danger py-2 px-3 small" }, `Regex Error: ${parsedResults.error}`),
            // Preview Filter Tabs & Count Header
            React.createElement(
              "div",
              { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `btn btn-sm ${previewFilter === "all" ? "btn-secondary font-weight-bold" : "btn-outline-secondary"} py-0 px-2`,
                    onClick: () => setPreviewFilter("all"),
                  },
                  `All (${parsedResults.items.length})`
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `btn btn-sm ${previewFilter === "matched" ? "btn-success font-weight-bold" : "btn-outline-secondary"} py-0 px-2`,
                    onClick: () => setPreviewFilter("matched"),
                  },
                  `Matched (${matchedCount})`
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `btn btn-sm ${previewFilter === "unmatched" ? "btn-warning font-weight-bold" : "btn-outline-secondary"} py-0 px-2`,
                    onClick: () => setPreviewFilter("unmatched"),
                  },
                  `Unmatched (${unmatchedCount})`
                )
              ),
              React.createElement(
                "div",
                { className: "d-flex align-items-center gap-2" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-xs btn-outline-info py-0 px-2",
                    onClick: handleSelectAllMatched,
                  },
                  selectedSceneIds.size === matchedCount && matchedCount > 0 ? "Deselect All Matched" : "Select All Matched"
                ),
                React.createElement("span", { className: "badge badge-info" }, `${selectedSceneIds.size} of ${matchedCount} matched selected for update`)
              )
            ),
            // Live Preview Table
            React.createElement(
              "div",
              { className: "sfm-parser-table-wrap mb-3" },
              React.createElement(
                "table",
                { className: "sfm-parser-table table table-dark table-sm table-striped" },
                React.createElement(
                  "thead",
                  null,
                  React.createElement(
                    "tr",
                    null,
                    React.createElement(
                      "th",
                      { style: { width: "36px", textAlign: "center" } },
                      React.createElement("input", {
                        type: "checkbox",
                        checked: matchedCount > 0 && selectedSceneIds.size === matchedCount,
                        onChange: handleSelectAllMatched,
                      })
                    ),
                    React.createElement("th", null, "Filename"),
                    React.createElement("th", null, "Title"),
                    React.createElement("th", null, "Date"),
                    React.createElement("th", null, "StudioCode"),
                    React.createElement("th", null, "Studio"),
                    React.createElement("th", null, "Performers"),
                    React.createElement("th", { style: { width: "95px", textAlign: "center" } }, "Source"),
                    React.createElement("th", { style: { width: "80px", textAlign: "center" } }, "Status")
                  )
                ),
                React.createElement(
                  "tbody",
                  null,
                  filteredItems.map((item) => {
                    const isSelected = selectedSceneIds.has(item.scene.id);
                    const cloud = cloudMatches[item.scene.id];

                    const displayTitle = cloud?.title || cleanExtracted("title", item.groups.title);
                    const displayDate = cloud?.date || cleanExtracted("date", item.groups.date);
                    const displayCode = cloud?.code || item.groups.code || "—";
                    const displayStudio = cloud?.studio?.name || cleanExtracted("studio", item.groups.studio) || activeStudioClue || "—";
                    const displayPerformers = cloud?.performers ? cloud.performers.map((p) => p.name).join(", ") : (cleanExtracted("performers", item.groups.performers) || activePerformerClue || "—");

                    const isFromPathStudio = !cloud && !item.groups.studio && activeStudioClue;

                    return React.createElement(
                      "tr",
                      {
                        key: item.scene.id,
                        style: { cursor: item.matched ? "pointer" : "default", opacity: item.matched ? 1 : 0.65 },
                        onClick: () => item.matched && handleToggleSelectScene(item.scene.id),
                      },
                      React.createElement(
                        "td",
                        { style: { textAlign: "center" } },
                        item.matched &&
                          React.createElement("input", {
                            type: "checkbox",
                            checked: isSelected,
                            onChange: () => handleToggleSelectScene(item.scene.id),
                            onClick: (e) => e.stopPropagation(),
                          })
                      ),
                      React.createElement("td", { className: "text-truncate", style: { maxWidth: "180px" }, title: item.rawBasename }, item.rawBasename),
                      React.createElement("td", { className: "text-info font-weight-bold" }, displayTitle || "—"),
                      React.createElement("td", null, displayDate || "—"),
                      React.createElement("td", null, displayCode),
                      React.createElement(
                        "td",
                        null,
                        displayStudio !== "—"
                          ? React.createElement(
                              "span",
                              null,
                              displayStudio,
                              isFromPathStudio && React.createElement("span", { className: "badge badge-dark text-info ml-1 py-0", title: "Resolved from Directory Path Clue" }, "📁 Path")
                            )
                          : "—"
                      ),
                      React.createElement("td", null, displayPerformers),
                      React.createElement(
                        "td",
                        { style: { textAlign: "center" } },
                        cloud
                          ? React.createElement("span", { className: "badge badge-primary py-0 px-1" }, "🌐 Stash-box")
                          : item.matched
                          ? React.createElement("span", { className: "badge badge-dark text-muted py-0 px-1" }, "📁 Path+Token")
                          : "—"
                      ),
                      React.createElement(
                        "td",
                        { style: { textAlign: "center" } },
                        item.matched
                          ? React.createElement("span", { className: "badge badge-success" }, "Matched")
                          : React.createElement("span", { className: "badge badge-secondary" }, "No Match")
                      )
                    );
                  })
                )
              )
            ),
            progressText && React.createElement("div", { className: "alert alert-info py-2 px-3 small" }, progressText)
          ),
          React.createElement(
            "div",
            { className: "sfm-modal-footer" },
            React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: onClose }, "Cancel"),
            React.createElement(
              "button",
              {
                className: "btn btn-primary btn-sm font-weight-bold",
                disabled: isExecuting || selectedSceneIds.size === 0,
                onClick: handleExecute,
              },
              isExecuting ? "Executing Updates..." : `Apply to ${selectedSceneIds.size} Selected Scenes`
            )
          )
        )
      );
    }

    function BatchMetadataModal({ currentFolder, sceneCount, sceneIds, onClose, onApplied }) {
      const [studioName, setStudioName] = useState("");
      const [addPerformer, setAddPerformer] = useState("");
      const [addTag, setAddTag] = useState("");
      const [rating, setRating] = useState("");
      const [isSubmitting, setIsSubmitting] = useState(false);
      const [message, setMessage] = useState("");

      const handleApply = async () => {
        setIsSubmitting(true);
        setMessage("Processing batch assignments...");

        try {
          const input = { ids: sceneIds };

          if (studioName.trim()) {
            const sRes = await gqlFetch(
              `query FindStudio($name: String!) {
                findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
                  studios { id name }
                }
              }`,
              { name: studioName.trim() }
            );
            const studio = sRes?.findStudios?.studios?.[0];
            if (studio) {
              input.studio_id = studio.id;
            } else {
              setMessage(`Studio "${studioName}" not found in database.`);
              setIsSubmitting(false);
              return;
            }
          }

          if (addPerformer.trim()) {
            const pRes = await gqlFetch(
              `query FindPerformer($name: String!) {
                findPerformers(performer_filter: { name: { value: $name, modifier: EQUALS } }) {
                  performers { id name }
                }
              }`,
              { name: addPerformer.trim() }
            );
            const performer = pRes?.findPerformers?.performers?.[0];
            if (performer) {
              input.performer_ids = { ids: [performer.id], mode: "ADD" };
            } else {
              setMessage(`Performer "${addPerformer}" not found in database.`);
              setIsSubmitting(false);
              return;
            }
          }

          if (addTag.trim()) {
            const tRes = await gqlFetch(
              `query FindTag($name: String!) {
                findTags(tag_filter: { name: { value: $name, modifier: EQUALS } }) {
                  tags { id name }
                }
              }`,
              { name: addTag.trim() }
            );
            let tag = tRes?.findTags?.tags?.[0];
            if (!tag) {
              // Create tag if not exists
              const createRes = await gqlFetch(
                `mutation CreateTag($name: String!) {
                  tagCreate(input: { name: $name }) { id name }
                }`,
                { name: addTag.trim() }
              );
              tag = createRes?.tagCreate;
            }
            if (tag) {
              input.tag_ids = { ids: [tag.id], mode: "ADD" };
            }
          }

          if (rating !== "") {
            const num = parseInt(rating, 10);
            if (!isNaN(num) && num >= 0 && num <= 100) {
              input.rating100 = num;
            }
          }

          if (!input.studio_id && !input.performer_ids && !input.tag_ids && input.rating100 === undefined) {
            setMessage("Please fill out at least one field to batch update.");
            setIsSubmitting(false);
            return;
          }

          await gqlFetch(
            `mutation BatchAssign($input: BulkSceneUpdateInput!) {
              bulkSceneUpdate(input: $input) { id }
            }`,
            { input }
          );

          setMessage(`Successfully updated ${sceneIds.length} scenes.`);
          setTimeout(() => {
            clearCachedScenes();
            onApplied();
            onClose();
          }, 1200);
        } catch (err) {
          console.error(err);
          setMessage(`Error: ${err.message}`);
          setIsSubmitting(false);
        }
      };

      return React.createElement(
        "div",
        { className: "sfm-modal-backdrop", onClick: onClose },
        React.createElement(
          "div",
          { className: "sfm-modal-dialog", onClick: (e) => e.stopPropagation() },
          React.createElement(
            "div",
            { className: "sfm-modal-header" },
            React.createElement("h5", { className: "mb-0" }, `✏️ Batch Edit: "${currentFolder}"`),
            React.createElement("button", { className: "close text-light", onClick: onClose }, "×")
          ),
          React.createElement(
            "div",
            { className: "sfm-modal-body" },
            React.createElement("p", { className: "text-muted small mb-3" }, `Apply shared metadata to all ${sceneCount} scenes inside this folder.`),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Assign Studio"),
              React.createElement("input", {
                type: "text",
                className: "form-control bg-dark text-light border-secondary",
                placeholder: "e.g. Wicked Pictures",
                value: studioName,
                onChange: (e) => setStudioName(e.target.value),
              })
            ),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Add Performer"),
              React.createElement("input", {
                type: "text",
                className: "form-control bg-dark text-light border-secondary",
                placeholder: "e.g. Angela White",
                value: addPerformer,
                onChange: (e) => setAddPerformer(e.target.value),
              })
            ),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Add Tag (Created automatically if new)"),
              React.createElement("input", {
                type: "text",
                className: "form-control bg-dark text-light border-secondary",
                placeholder: "e.g. 4K, VR, Favorites",
                value: addTag,
                onChange: (e) => setAddTag(e.target.value),
              })
            ),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Set Rating (Stars)"),
              React.createElement(
                "select",
                {
                  className: "form-control bg-dark text-light border-secondary",
                  value: rating,
                  onChange: (e) => setRating(e.target.value),
                },
                React.createElement("option", { value: "" }, "Keep existing ratings"),
                React.createElement("option", { value: "100" }, "★★★★★ (5 Stars - 100%)"),
                React.createElement("option", { value: "80" }, "★★★★☆ (4 Stars - 80%)"),
                React.createElement("option", { value: "60" }, "★★★☆☆ (3 Stars - 60%)"),
                React.createElement("option", { value: "40" }, "★★☆☆☆ (2 Stars - 40%)"),
                React.createElement("option", { value: "20" }, "★☆☆☆☆ (1 Star - 20%)"),
                React.createElement("option", { value: "0" }, "Clear Rating (0%)")
              )
            ),
            message && React.createElement("div", { className: "alert alert-info py-2 px-3 small mt-2" }, message)
          ),
          React.createElement(
            "div",
            { className: "sfm-modal-footer" },
            React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: onClose }, "Cancel"),
            React.createElement(
              "button",
              { className: "btn btn-primary btn-sm", disabled: isSubmitting, onClick: handleApply },
              isSubmitting ? "Updating..." : `Apply to ${sceneCount} Scenes`
            )
          )
        )
      );
    }

    // ==========================================
    // Scene Card Component with Hover Preview (Feature 3)
    // ==========================================
    function SceneCard({ scene, onPlay, isSelected, onToggleSelect, showFolderBadge, currentPath }) {
      const [isHovered, setIsHovered] = useState(false);
      const thumbUrl = scene.paths?.screenshot || `/scene/${scene.id}/screenshot`;
      const previewVideoUrl = scene.paths?.preview || `/scene/${scene.id}/preview`;
      const studioName = scene.studio?.name;
      const performers = scene.performers?.map((p) => p.name).join(", ");
      const duration = formatDuration(scene.files?.[0]?.duration);

      return React.createElement(
        "div",
        { className: `sfm-scene-card ${isSelected ? "sfm-card-selected" : ""}` },
        // Selection Checkbox Overlay
        React.createElement(
          "div",
          {
            className: `sfm-card-select-wrap ${isSelected ? "sfm-selected" : ""}`,
            onClick: (e) => {
              e.stopPropagation();
              onToggleSelect(scene.id);
            },
            title: isSelected ? "Deselect Scene" : "Select Scene",
          },
          React.createElement("input", {
            type: "checkbox",
            checked: !!isSelected,
            onChange: () => {},
            className: "sfm-card-checkbox",
          })
        ),
        React.createElement(
          "div",
          {
            className: "sfm-scene-thumb-container",
            onMouseEnter: () => setIsHovered(true),
            onMouseLeave: () => setIsHovered(false),
            onClick: () => onPlay(scene),
          },
          React.createElement("img", {
            src: thumbUrl,
            alt: scene.title || "Scene",
            className: "sfm-scene-thumb",
            loading: "lazy",
          }),
          isHovered &&
            React.createElement("video", {
              src: previewVideoUrl,
              autoPlay: true,
              loop: true,
              muted: true,
              playsInline: true,
              className: "sfm-scene-preview-video",
            }),
          React.createElement(
            "div",
            { className: "sfm-play-overlay" },
            React.createElement("span", { style: { fontSize: "1.2rem", marginLeft: "2px" } }, "▶")
          ),
          duration && React.createElement("div", { className: "sfm-duration-badge" }, duration)
        ),
        React.createElement(
          "div",
          { className: "sfm-scene-info" },
          React.createElement(
            "a",
            {
              href: `/scenes/${scene.id}`,
              target: "_blank",
              rel: "noreferrer",
              className: "sfm-scene-title",
              title: scene.title || scene.files?.[0]?.basename,
            },
            scene.title || scene.files?.[0]?.basename || `Scene #${scene.id}`
          ),
          studioName &&
            React.createElement(
              "div",
              { className: "badge badge-primary text-truncate mb-1", style: { maxWidth: "100%" } },
              studioName
            ),
          performers && React.createElement("div", { className: "text-truncate small text-info mb-1" }, performers),
          showFolderBadge && scene._folderPath && (() => {
            const relFolder = currentPath && scene._folderPath.startsWith(currentPath + "/")
              ? scene._folderPath.slice(currentPath.length + 1)
              : (currentPath === scene._folderPath ? "" : scene._folderPath);
            return relFolder ? React.createElement("div", { className: "text-truncate small text-muted mb-1", title: `Folder: ${scene._folderPath}` }, `📁 ${relFolder}`) : null;
          })(),
          React.createElement(
            "div",
            { className: "sfm-scene-meta" },
            React.createElement("span", null, scene.date || "No date"),
            scene.rating100 &&
              React.createElement("span", { className: "text-warning" }, `★ ${(scene.rating100 / 20).toFixed(1)}`)
          )
        )
      );
    }

    // ==========================================
    // Detailed Table/List View Component (Milestone 2)
    // ==========================================
    function SceneTableView({ scenes, onPlay, selectedIds, onToggleSelect, onSelectAll, showFolderBadge, currentPath }) {
      const allSelected = scenes.length > 0 && scenes.every((s) => selectedIds.has(s.id));

      return React.createElement(
        "div",
        { className: "sfm-table-wrap" },
        React.createElement(
          "table",
          { className: "sfm-data-table" },
          React.createElement(
            "thead",
            null,
            React.createElement(
              "tr",
              null,
              React.createElement(
                "th",
                { style: { width: "40px", textAlign: "center" } },
                React.createElement("input", {
                  type: "checkbox",
                  checked: allSelected,
                  onChange: onSelectAll,
                  title: "Select All / None",
                })
              ),
              React.createElement("th", { style: { width: "80px" } }, "Preview"),
              React.createElement("th", null, "Title & Filename"),
              React.createElement("th", { style: { width: "130px" } }, "Studio"),
              React.createElement("th", { style: { width: "150px" } }, "Performers"),
              React.createElement("th", { style: { width: "85px" } }, "Duration"),
              React.createElement("th", { style: { width: "90px" } }, "Size"),
              React.createElement("th", { style: { width: "100px" } }, "Date"),
              React.createElement("th", { style: { width: "85px" } }, "Rating"),
              React.createElement("th", { style: { width: "90px", textAlign: "center" } }, "Actions")
            )
          ),
          React.createElement(
            "tbody",
            null,
            scenes.map((scene) => {
              const isSelected = selectedIds.has(scene.id);
              const thumbUrl = scene.paths?.screenshot || `/scene/${scene.id}/screenshot`;
              const duration = formatDuration(scene.files?.[0]?.duration);
              const size = formatBytes(scene.files?.[0]?.size);
              const studioName = scene.studio?.name;
              const performers = scene.performers?.map((p) => p.name).join(", ");
              const filename = scene.files?.[0]?.basename || "";

              return React.createElement(
                "tr",
                { key: scene.id, className: isSelected ? "sfm-row-selected" : "" },
                React.createElement(
                  "td",
                  { style: { textAlign: "center" } },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: isSelected,
                    onChange: () => onToggleSelect(scene.id),
                  })
                ),
                React.createElement(
                  "td",
                  null,
                  React.createElement(
                    "div",
                    {
                      className: "sfm-table-thumb-wrap",
                      onClick: () => onPlay(scene),
                      title: "Click to play inline",
                    },
                    React.createElement("img", {
                      src: thumbUrl,
                      alt: scene.title || "",
                      className: "sfm-table-thumb",
                      loading: "lazy",
                    }),
                    React.createElement("span", { className: "sfm-table-play-icon" }, "▶")
                  )
                ),
                React.createElement(
                  "td",
                  null,
                  React.createElement(
                    "a",
                    {
                      href: `/scenes/${scene.id}`,
                      target: "_blank",
                      rel: "noreferrer",
                      className: "sfm-table-title",
                    },
                    scene.title || filename || `Scene #${scene.id}`
                  ),
                  filename &&
                    scene.title &&
                    React.createElement("div", { className: "sfm-table-subtext" }, filename),
                  showFolderBadge && scene._folderPath && (() => {
                    const relFolder = currentPath && scene._folderPath.startsWith(currentPath + "/")
                      ? scene._folderPath.slice(currentPath.length + 1)
                      : (currentPath === scene._folderPath ? "" : scene._folderPath);
                    return relFolder ? React.createElement("div", { className: "sfm-table-subtext text-muted" }, `📁 ${relFolder}`) : null;
                  })()
                ),
                React.createElement(
                  "td",
                  null,
                  studioName
                    ? React.createElement("span", { className: "badge badge-primary text-truncate d-inline-block", style: { maxWidth: "120px" } }, studioName)
                    : React.createElement("span", { className: "text-muted small" }, "—")
                ),
                React.createElement(
                  "td",
                  null,
                  performers
                    ? React.createElement("span", { className: "text-info small text-truncate d-inline-block", style: { maxWidth: "140px" } }, performers)
                    : React.createElement("span", { className: "text-muted small" }, "—")
                ),
                React.createElement("td", { className: "small text-muted" }, duration || "—"),
                React.createElement("td", { className: "small text-muted" }, size),
                React.createElement("td", { className: "small text-muted" }, scene.date || "—"),
                React.createElement(
                  "td",
                  null,
                  scene.rating100
                    ? React.createElement("span", { className: "text-warning small" }, `★ ${(scene.rating100 / 20).toFixed(1)}`)
                    : React.createElement("span", { className: "text-muted small" }, "—")
                ),
                React.createElement(
                  "td",
                  { style: { textAlign: "center" } },
                  React.createElement(
                    "div",
                    { className: "btn-group btn-group-sm" },
                    React.createElement(
                      "button",
                      {
                        className: "btn btn-outline-info py-0 px-2",
                        onClick: () => onPlay(scene),
                        title: "Play video",
                      },
                      "▶"
                    ),
                    React.createElement(
                      "a",
                      {
                        href: `/scenes/${scene.id}`,
                        target: "_blank",
                        rel: "noreferrer",
                        className: "btn btn-outline-secondary py-0 px-2",
                        title: "Open scene details",
                      },
                      "↗"
                    )
                  )
                )
              );
            })
          )
        )
      );
    }

    // ==========================================
    // History & URL Path Synchronization
    // ==========================================
    function normalizePath(p) {
      if (!p) return "";
      try {
        return decodeURIComponent(p).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      } catch (e) {
        return p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      }
    }

    function buildHashForPath(path) {
      if (!path) return "#file-manager";
      return `#file-manager?path=${encodeURIComponent(path)}`;
    }

    function getPathFromHash() {
      const hash = window.location.hash || "";
      if (!hash.startsWith("#file-manager")) return null;
      const qIdx = hash.indexOf("?");
      if (qIdx !== -1) {
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        return normalizePath(params.get("path") || "");
      }
      if (hash.startsWith("#file-manager/")) {
        return normalizePath(decodeURIComponent(hash.slice("#file-manager/".length)) || "");
      }
      return "";
    }

    // ==========================================
    // Filenames Only Table View Component (for Easy Bulk Editing)
    // ==========================================
    function SceneNamesTableView({ scenes, onPlay, selectedIds, onToggleSelect, onSelectAll, showFolderBadge, currentPath }) {
      const allSelected = scenes.length > 0 && scenes.every((s) => selectedIds.has(s.id));

      return React.createElement(
        "div",
        { className: "sfm-table-wrap sfm-names-table-wrap" },
        React.createElement(
          "table",
          { className: "sfm-data-table sfm-names-table" },
          React.createElement(
            "thead",
            null,
            React.createElement(
              "tr",
              null,
              React.createElement(
                "th",
                { style: { width: "36px", textAlign: "center" } },
                React.createElement("input", {
                  type: "checkbox",
                  checked: allSelected,
                  onChange: onSelectAll,
                  title: "Select All / None",
                })
              ),
              React.createElement("th", null, "File Name (Basename)"),
              React.createElement("th", { style: { minWidth: "180px" } }, "Title"),
              showFolderBadge && React.createElement("th", { style: { width: "160px" } }, "Folder"),
              React.createElement("th", { style: { width: "90px" } }, "Duration"),
              React.createElement("th", { style: { width: "90px" } }, "Size"),
              React.createElement("th", { style: { width: "70px", textAlign: "center" } }, "Play")
            )
          ),
          React.createElement(
            "tbody",
            null,
            scenes.map((scene) => {
              const isSelected = selectedIds.has(scene.id);
              const filename = scene.files?.[0]?.basename || "Unknown file";
              const duration = formatDuration(scene.files?.[0]?.duration);
              const size = formatBytes(scene.files?.[0]?.size);

              return React.createElement(
                "tr",
                {
                  key: scene.id,
                  className: `sfm-names-row ${isSelected ? "sfm-row-selected" : ""}`,
                  onClick: (e) => {
                    if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON" && !e.target.closest("button")) {
                      onToggleSelect(scene.id);
                    }
                  },
                  style: { cursor: "pointer" },
                  title: "Click row to toggle selection",
                },
                React.createElement(
                  "td",
                  { style: { textAlign: "center" } },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: isSelected,
                    onChange: () => onToggleSelect(scene.id),
                    onClick: (e) => e.stopPropagation(),
                  })
                ),
                React.createElement(
                  "td",
                  null,
                  React.createElement(
                    "span",
                    { className: "sfm-filename-text font-weight-bold text-light", style: { fontFamily: "monospace", fontSize: "0.88rem" } },
                    filename
                  )
                ),
                React.createElement(
                  "td",
                  { className: "text-truncate", style: { maxWidth: "240px" } },
                  scene.title || React.createElement("span", { className: "text-muted font-italic" }, "No title")
                ),
                showFolderBadge && React.createElement(
                  "td",
                  null,
                  scene._folderPath
                    ? React.createElement("span", { className: "badge badge-dark text-muted", title: scene._folderPath }, scene._folderPath)
                    : "-"
                ),
                React.createElement("td", { className: "text-muted small" }, duration),
                React.createElement("td", { className: "text-muted small" }, size),
                React.createElement(
                  "td",
                  { style: { textAlign: "center" } },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-xs btn-outline-info py-0 px-2",
                      onClick: (e) => {
                        e.stopPropagation();
                        onPlay(scene);
                      },
                      title: "Play video",
                    },
                    "▶"
                  )
                )
              );
            })
          )
        )
      );
    }

    // ==========================================
    // Modal: Plugin Settings & Troubleshooting Tasks
    // ==========================================
    function SettingsAndTasksModal({ isOpen, onClose, settings, onSaveSettings, onTriggerRebuild, onResetDefaults }) {
      const [formData, setFormData] = useState({
        default_transcode_method: settings?.default_transcode_method || "direct",
        fallback_transcode_method: settings?.fallback_transcode_method || "hls",
        root_library_path: settings?.root_library_path || "",
        folder_view_mode: settings?.folder_view_mode || "cards",
        scene_view_mode: settings?.scene_view_mode || "cards",
        default_sort_field: settings?.default_sort_field || "name",
        default_sort_direction: settings?.default_sort_direction || "asc",
        folder_card_size: settings?.folder_card_size || 160,
        scene_card_size: settings?.scene_card_size || 240,
        remember_last_path: settings?.remember_last_path !== false,
        auto_rebuild_tree_on_start: !!settings?.auto_rebuild_tree_on_start,
      });
      const [isSaving, setIsSaving] = useState(false);
      const [saveNotice, setSaveNotice] = useState("");

      useEffect(() => {
        if (isOpen && settings) {
          setFormData({
            default_transcode_method: settings?.default_transcode_method || "direct",
            fallback_transcode_method: settings?.fallback_transcode_method || "hls",
            root_library_path: settings?.root_library_path || "",
            folder_view_mode: settings?.folder_view_mode || "cards",
            scene_view_mode: settings?.scene_view_mode || "cards",
            default_sort_field: settings?.default_sort_field || "name",
            default_sort_direction: settings?.default_sort_direction || "asc",
            folder_card_size: settings?.folder_card_size || 160,
            scene_card_size: settings?.scene_card_size || 240,
            remember_last_path: settings?.remember_last_path !== false,
            auto_rebuild_tree_on_start: !!settings?.auto_rebuild_tree_on_start,
          });
        }
      }, [isOpen, settings]);

      const handleChange = (key, value) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
      };

      const handleSave = async () => {
        setIsSaving(true);
        setSaveNotice("Saving to Stash configuration...");
        try {
          await onSaveSettings(formData);
          setSaveNotice("✓ Saved to Stash config.yml!");
          setTimeout(() => {
            setSaveNotice("");
            onClose();
          }, 1000);
        } catch (e) {
          setSaveNotice(`Error: ${e.message}`);
        } finally {
          setIsSaving(false);
        }
      };

      if (!isOpen) return null;

      return React.createElement(
        "div",
        { className: "sfm-modal-backdrop", onClick: onClose },
        React.createElement(
          "div",
          {
            className: "sfm-modal-dialog",
            style: { maxWidth: "680px", width: "95%" },
            onClick: (e) => e.stopPropagation(),
          },
          React.createElement(
            "div",
            { className: "sfm-modal-header" },
            React.createElement("h5", { className: "mb-0" }, "⚙️ Stash File Manager — Settings & Tasks"),
            React.createElement("button", { className: "close text-light", onClick: onClose }, "×")
          ),
          React.createElement(
            "div",
            { className: "sfm-modal-body", style: { maxHeight: "75vh", overflowY: "auto" } },
            saveNotice &&
              React.createElement(
                "div",
                { className: `alert ${saveNotice.startsWith("✓") ? "alert-success" : "alert-info"} py-2` },
                saveNotice
              ),

            // Section 1: Video Playback & Transcoding
            React.createElement("h6", { className: "text-primary border-bottom border-secondary pb-1 mb-3" }, "🎥 Video Playback & Transcoding"),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Default Playback Stream Mode"),
              React.createElement(
                "select",
                {
                  className: "form-control bg-dark text-light border-secondary",
                  value: formData.default_transcode_method,
                  onChange: (e) => handleChange("default_transcode_method", e.target.value),
                },
                React.createElement("option", { value: "direct" }, "Direct Stream (Raw file - fastest, native containers)"),
                React.createElement("option", { value: "webm" }, "WebM Transcode (Progressive transcode, broad compatibility)"),
                React.createElement("option", { value: "hls" }, "HLS Stream (.m3u8 adaptive segmented stream)")
              ),
              React.createElement(
                "small",
                { className: "form-text text-muted" },
                "Configures the default playback stream method for the Binge Reel Player and floating PIP player."
              )
            ),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Fallback Transcode Mode (Non-Native Formats)"),
              React.createElement(
                "select",
                {
                  className: "form-control bg-dark text-light border-secondary",
                  value: formData.fallback_transcode_method,
                  onChange: (e) => handleChange("fallback_transcode_method", e.target.value),
                },
                React.createElement("option", { value: "hls" }, "HLS Stream (.m3u8 adaptive stream - recommended)"),
                React.createElement("option", { value: "webm" }, "WebM Transcode (Progressive container)")
              ),
              React.createElement(
                "small",
                { className: "form-text text-muted" },
                "Used automatically when playing non-native video formats (.avi, .flv, .wmv, .mpg)."
              )
            ),

            // Section 2: Navigation & Root Library Path
            React.createElement("h6", { className: "text-primary border-bottom border-secondary pb-1 mb-3 mt-4" }, "📁 Navigation & Library Root"),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Root Library Path Override"),
              React.createElement("input", {
                type: "text",
                className: "form-control bg-dark text-light border-secondary",
                placeholder: "Leave empty to auto-detect Stash library paths",
                value: formData.root_library_path,
                onChange: (e) => handleChange("root_library_path", e.target.value),
              }),
              React.createElement(
                "small",
                { className: "form-text text-muted" },
                "Set an explicit root path (e.g. /data/videos or D:\\Media) to anchor File Manager navigation."
              )
            ),
            React.createElement(
              "div",
              { className: "form-group form-check mb-3" },
              React.createElement("input", {
                type: "checkbox",
                className: "form-check-input",
                id: "sfm_chk_remember_path",
                checked: formData.remember_last_path,
                onChange: (e) => handleChange("remember_last_path", e.target.checked),
              }),
              React.createElement(
                "label",
                { className: "form-check-label small font-weight-bold", htmlFor: "sfm_chk_remember_path" },
                "Remember Last Visited Folder Across Sessions"
              )
            ),

            // Section 3: View Modes & Card Sizes
            React.createElement("h6", { className: "text-primary border-bottom border-secondary pb-1 mb-3 mt-4" }, "🎨 View Modes & Layout Preferences"),
            React.createElement(
              "div",
              { className: "row" },
              React.createElement(
                "div",
                { className: "col-sm-6 form-group mb-3" },
                React.createElement("label", { className: "small font-weight-bold" }, "Default Folder View Mode"),
                React.createElement(
                  "select",
                  {
                    className: "form-control bg-dark text-light border-secondary",
                    value: formData.folder_view_mode,
                    onChange: (e) => handleChange("folder_view_mode", e.target.value),
                  },
                  React.createElement("option", { value: "cards" }, "Cards (Thumbnails)"),
                  React.createElement("option", { value: "list" }, "List (Compact)"),
                  React.createElement("option", { value: "details" }, "Details (Table with Stats)")
                )
              ),
              React.createElement(
                "div",
                { className: "col-sm-6 form-group mb-3" },
                React.createElement("label", { className: "small font-weight-bold" }, "Default Scene View Mode"),
                React.createElement(
                  "select",
                  {
                    className: "form-control bg-dark text-light border-secondary",
                    value: formData.scene_view_mode,
                    onChange: (e) => handleChange("scene_view_mode", e.target.value),
                  },
                  React.createElement("option", { value: "cards" }, "Cards (16:9 Grid)"),
                  React.createElement("option", { value: "table" }, "Table (Metadata Columns)"),
                  React.createElement("option", { value: "names" }, "Names (Filenames Only)")
                )
              )
            ),
            React.createElement(
              "div",
              { className: "row" },
              React.createElement(
                "div",
                { className: "col-sm-6 form-group mb-3" },
                React.createElement("label", { className: "small font-weight-bold" }, `Folder Card Size: ${formData.folder_card_size}px`),
                React.createElement("input", {
                  type: "range",
                  className: "form-control-range",
                  min: 120,
                  max: 300,
                  step: 10,
                  value: formData.folder_card_size,
                  onChange: (e) => handleChange("folder_card_size", Number(e.target.value)),
                })
              ),
              React.createElement(
                "div",
                { className: "col-sm-6 form-group mb-3" },
                React.createElement("label", { className: "small font-weight-bold" }, `Scene Card Size: ${formData.scene_card_size}px`),
                React.createElement("input", {
                  type: "range",
                  className: "form-control-range",
                  min: 160,
                  max: 420,
                  step: 10,
                  value: formData.scene_card_size,
                  onChange: (e) => handleChange("scene_card_size", Number(e.target.value)),
                })
              )
            ),

            // Section 4: Native Stash Tasks & Troubleshooting
            React.createElement("h6", { className: "text-primary border-bottom border-secondary pb-1 mb-3 mt-4" }, "⚡ Stash Plugin Tasks & Troubleshooting"),
            React.createElement(
              "p",
              { className: "small text-muted mb-3" },
              "These operations are registered as native tasks under ",
              React.createElement("code", { className: "text-warning" }, "Settings → Tasks → Plugin Tasks"),
              "."
            ),
            React.createElement(
              "div",
              { className: "d-flex flex-wrap gap-2 mb-3" },
              React.createElement(
                "button",
                {
                  className: "btn btn-outline-info btn-sm mr-2 mb-2",
                  onClick: onTriggerRebuild,
                  title: "Clear all local cache and query Stash for fresh folder hierarchies",
                },
                "🔄 Rescan & Rebuild Tree"
              ),
              React.createElement(
                "button",
                {
                  className: "btn btn-outline-danger btn-sm mr-2 mb-2",
                  onClick: onResetDefaults,
                  title: "Reset all plugin settings back to initial factory defaults",
                },
                "⚠️ Reset All Settings to Default"
              ),
              React.createElement(
                "a",
                {
                  href: "/settings?tab=plugins",
                  target: "_blank",
                  rel: "noopener noreferrer",
                  className: "btn btn-outline-secondary btn-sm mr-2 mb-2",
                },
                "↗ Open Stash Plugins Page"
              ),
              React.createElement(
                "a",
                {
                  href: "/settings?tab=tasks",
                  target: "_blank",
                  rel: "noopener noreferrer",
                  className: "btn btn-outline-secondary btn-sm mb-2",
                },
                "↗ Open Stash Tasks Page"
              )
            )
          ),
          React.createElement(
            "div",
            { className: "sfm-modal-footer d-flex justify-content-between align-items-center" },
            React.createElement(
              "span",
              { className: "small text-muted" },
              "Settings are saved to Stash config and synchronized across browsers."
            ),
            React.createElement(
              "div",
              null,
              React.createElement("button", { className: "btn btn-secondary btn-sm mr-2", onClick: onClose }, "Cancel"),
              React.createElement(
                "button",
                { className: "btn btn-primary btn-sm", onClick: handleSave, disabled: isSaving },
                isSaving ? "Saving..." : "💾 Save to Stash Config"
              )
            )
          )
        )
      );
    }

    // ==========================================
    // Main App Component (Features 5, 1, 2, 3, 4)
    // ==========================================
    function FileManagerView({ onClose, initialPath }) {
      const [trie, setTrie] = useState(null);
      
      const historyStack = useRef([]);

      // History & Folder Memory Synchronization
      const [currentPath, setCurrentPath] = useState(() => {
        if (typeof initialPath === "string") return normalizePath(initialPath);
        const fromHash = getPathFromHash();
        if (fromHash !== null) return fromHash;
        return normalizePath(localStorage.getItem("sfm_last_folder_path") || "");
      });

      const navigateToFolder = useCallback((nextPath) => {
        const normalizedNext = normalizePath(nextPath);
        if (normalizedNext !== currentPath) {
          historyStack.current.push(currentPath);
        }
        setCurrentPath(normalizedNext);
        localStorage.setItem("sfm_last_folder_path", normalizedNext);
        const targetHash = buildHashForPath(normalizedNext);
        const currentHashDecoded = normalizePath(getPathFromHash());
        if (currentHashDecoded !== normalizedNext) {
          window.history.pushState({ sfmPath: normalizedNext }, "", targetHash);
        }
      }, [currentPath]);

      // Handle in-app Go Back (steps backward through folder history)
      const handleGoBackInHistory = useCallback(() => {
        if (historyStack.current.length > 0) {
          const prev = historyStack.current.pop();
          const normalizedPrev = normalizePath(prev);
          setCurrentPath(normalizedPrev);
          localStorage.setItem("sfm_last_folder_path", normalizedPrev);
          const targetHash = buildHashForPath(normalizedPrev);
          if (normalizePath(getPathFromHash()) !== normalizedPrev) {
            window.history.pushState({ sfmPath: normalizedPrev }, "", targetHash);
          }
        } else if (currentPath) {
          const segs = currentPath.split("/").filter(Boolean);
          const parent = segs.slice(0, -1).join("/");
          navigateToFolder(parent);
        }
      }, [currentPath, navigateToFolder]);

      const handleGoUpOneLevel = useCallback(() => {
        if (!currentPath) return;
        const segs = currentPath.split("/").filter(Boolean);
        const parent = segs.slice(0, -1).join("/");
        navigateToFolder(parent);
      }, [currentPath, navigateToFolder]);

      // Listen to popstate (browser back/forward) and hash changes to navigate folders without closing
      useEffect(() => {
        const handleLocationChange = () => {
          const p = getPathFromHash();
          if (p !== null) {
            const normalized = normalizePath(p);
            if (normalized !== currentPath) {
              setCurrentPath(normalized);
              localStorage.setItem("sfm_last_folder_path", normalized);
            }
          }
        };
        window.addEventListener("popstate", handleLocationChange);
        window.addEventListener("hashchange", handleLocationChange);
        return () => {
          window.removeEventListener("popstate", handleLocationChange);
          window.removeEventListener("hashchange", handleLocationChange);
        };
      }, [currentPath]);

      // Custom event listener for inter-component folder navigation
      useEffect(() => {
        const handleCustomPath = (e) => {
          if (e.detail && typeof e.detail.path === "string") {
            const p = normalizePath(e.detail.path);
            if (e.detail.isBrowserNav) {
              if (p !== currentPath) {
                setCurrentPath(p);
                localStorage.setItem("sfm_last_folder_path", p);
              }
            } else {
              navigateToFolder(p);
            }
          }
        };
        window.addEventListener("sfm:set-path", handleCustomPath);
        return () => window.removeEventListener("sfm:set-path", handleCustomPath);
      }, [navigateToFolder, currentPath]);

      const [loading, setLoading] = useState(true);
      const [statusText, setStatusText] = useState("Checking cache...");
      const [refreshKey, setRefreshKey] = useState(0);
      const [notification, setNotification] = useState("");
      
      // Feature 2: Search & Sort
      const [searchQuery, setSearchQuery] = useState("");
      const searchInputRef = useRef(null);
      const [folderSort, setFolderSort] = useState("name_asc");
      const [sceneSort, setSceneSort] = useState("title_asc");

      // Feature 4: Hide Empty Folders
      const [hideEmpty, setHideEmpty] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_hide_empty") === "true";
        } catch (e) {
          return false;
        }
      });

      // Collapsible Subfolders & Files Sections
      const [isSubfoldersCollapsed, setIsSubfoldersCollapsed] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_subfolders_collapsed") === "true";
        } catch (e) {
          return false;
        }
      });

      const [isFilesCollapsed, setIsFilesCollapsed] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_files_collapsed") === "true";
        } catch (e) {
          return false;
        }
      });

      // Include Sub-folders Toggle State (persisted in localStorage)
      const [includeSubfolders, setIncludeSubfolders] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_include_subfolders") === "true";
        } catch (e) {
          return false;
        }
      });

      const handleToggleIncludeSubfolders = useCallback((val) => {
        setIncludeSubfolders(val);
        try {
          window.localStorage.setItem("sfm_include_subfolders", String(val));
        } catch (e) {}
      }, []);

      // Sort by Folder First State (persisted in localStorage, defaults to true)
      const [sortByFolderFirst, setSortByFolderFirst] = useState(() => {
        try {
          const val = window.localStorage.getItem("sfm_sort_by_folder_first");
          return val === null ? true : val === "true";
        } catch (e) {
          return true;
        }
      });

      const handleToggleSortByFolderFirst = useCallback((val) => {
        setSortByFolderFirst(val);
        try {
          window.localStorage.setItem("sfm_sort_by_folder_first", String(val));
        } catch (e) {}
      }, []);

      const handleToggleSubfoldersCollapsed = useCallback(() => {
        setIsSubfoldersCollapsed((prev) => {
          const next = !prev;
          try {
            window.localStorage.setItem("sfm_subfolders_collapsed", String(next));
          } catch (e) {}
          return next;
        });
      }, []);

      const handleToggleFilesCollapsed = useCallback(() => {
        setIsFilesCollapsed((prev) => {
          const next = !prev;
          try {
            window.localStorage.setItem("sfm_files_collapsed", String(next));
          } catch (e) {}
          return next;
        });
      }, []);

      // Scene View Mode: Card vs List Views
      const [viewMode, setViewMode] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_view_mode") || "grid";
        } catch (e) {
          return "grid";
        }
      });

      // Thumbnail Card Size States (Persisted in localStorage)
      const [folderCardSize, setFolderCardSize] = useState(() => {
        try {
          return Number(window.localStorage.getItem("sfm_folder_card_size")) || 160;
        } catch (e) {
          return 160;
        }
      });
      const handleSetFolderCardSize = (size) => {
        setFolderCardSize(size);
        try {
          window.localStorage.setItem("sfm_folder_card_size", String(size));
        } catch (e) {}
      };

      const [folderListWidth, setFolderListWidth] = useState(() => {
        try {
          return Number(window.localStorage.getItem("sfm_folder_list_width")) || 220;
        } catch (e) {
          return 220;
        }
      });
      const handleSetFolderListWidth = (width) => {
        setFolderListWidth(width);
        try {
          window.localStorage.setItem("sfm_folder_list_width", String(width));
        } catch (e) {}
      };

      const [sceneCardSize, setSceneCardSize] = useState(() => {
        try {
          return Number(window.localStorage.getItem("sfm_scene_card_size")) || 240;
        } catch (e) {
          return 240;
        }
      });
      const handleSetSceneCardSize = (size) => {
        setSceneCardSize(size);
        try {
          window.localStorage.setItem("sfm_scene_card_size", String(size));
        } catch (e) {}
      };

      // Folder View Mode: Compact Cards vs List vs Detail Table
      const [folderViewMode, setFolderViewMode] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_folder_view_mode") || "cards";
        } catch (e) {
          return "cards";
        }
      });
      const handleSetFolderViewMode = (mode) => {
        setFolderViewMode(mode);
        try {
          window.localStorage.setItem("sfm_folder_view_mode", mode);
        } catch (e) {}
      };

      // Milestone 1: Scene Multi-Selection
      const [selectedSceneIds, setSelectedSceneIds] = useState(new Set());

      // Modals
      const [showBatchModal, setShowBatchModal] = useState(false);
      const [showParserModal, setShowParserModal] = useState(false);
      const [showSettingsModal, setShowSettingsModal] = useState(false);
      const [playingScene, setPlayingScene] = useState(null);
      const [pluginSettings, setPluginSettings] = useState(null);

      // Load native Stash plugin configuration on mount
      useEffect(() => {
        let isMounted = true;
        fetchStashPluginSettings().then((cfg) => {
          if (!isMounted || !cfg) return;
          setPluginSettings(cfg);
          if (cfg.default_transcode_method) {
            window.__SFM_DEFAULT_TRANSCODE_METHOD__ = cfg.default_transcode_method;
            if (!window.localStorage.getItem("sfm_stream_mode")) {
              try { window.localStorage.setItem("sfm_stream_mode", cfg.default_transcode_method); } catch(e) {}
            }
          }
          if (cfg.fallback_transcode_method) {
            window.__SFM_FALLBACK_TRANSCODE_METHOD__ = cfg.fallback_transcode_method;
          }
          if (cfg.root_library_path && !currentPath) {
            if (cfg.remember_last_path === false || !window.localStorage.getItem("sfm_last_folder_path")) {
              setCurrentPath(normalizePath(cfg.root_library_path));
            }
          }
          if (cfg.folder_view_mode && !window.localStorage.getItem("sfm_folder_view_mode")) {
            setFolderViewMode(cfg.folder_view_mode);
          }
          if (cfg.scene_view_mode && !window.localStorage.getItem("sfm_view_mode")) {
            if (cfg.scene_view_mode === "cards") setViewMode("grid");
            else if (cfg.scene_view_mode === "names") setViewMode("names");
            else setViewMode("list");
          }
          if (cfg.folder_card_size && !window.localStorage.getItem("sfm_folder_card_size")) {
            setFolderCardSize(Number(cfg.folder_card_size));
          }
          if (cfg.scene_card_size && !window.localStorage.getItem("sfm_scene_card_size")) {
            setSceneCardSize(Number(cfg.scene_card_size));
          }
          if (cfg.auto_rebuild_tree_on_start) {
            fetchCatalog(true);
          }
        });
        return () => { isMounted = false; };
      }, []);

      const handleToggleViewMode = (mode) => {
        setViewMode(mode);
        try {
          window.localStorage.setItem("sfm_view_mode", mode);
        } catch (e) {}
      };

      const handleToggleSelect = (id) => {
        setSelectedSceneIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      };

      const handleClearSelection = () => {
        setSelectedSceneIds(new Set());
      };

      // Save hide empty preference
      const handleToggleHideEmpty = (val) => {
        setHideEmpty(val);
        try {
          window.localStorage.setItem("sfm_hide_empty", val ? "true" : "false");
        } catch (e) {}
      };

      // Feature 5: High-Performance Progressive Indexing & Multi-Tier Caching
      const fetchCatalog = useCallback(async (forceBypassCache = false) => {
        setLoading(true);

        // Tier 1: Instant In-Memory Cache (0ms - zero hang)
        if (!forceBypassCache && window.__SFM_GLOBAL_CACHE__.trie) {
          setTrie(window.__SFM_GLOBAL_CACHE__.trie);
          setLoading(false);
          return;
        }

        // Tier 2: Persistent IndexedDB Cache (~50ms across tab visits / reloads)
        if (!forceBypassCache) {
          setStatusText("Checking local index database...");
          const cached = await idbGet(CACHE_KEY);
          if (cached && cached.scenes && cached.scenes.length > 0) {
            if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
              const total = cached.scenes.length;
              setStatusText(`Restoring ${total.toLocaleString()} scenes from local index...`);
              const pluginCfg = pluginSettings || (await fetchStashPluginSettings());
              const { basePrefix, diskRoot } = resolveLibraryRoot(
                cached.scenes,
                pluginCfg.root_library_path,
                pluginCfg.__stashes__
              );
              const newTrie = new PathTrie(basePrefix, diskRoot);
              const chunkSize = 1500;
              for (let i = 0; i < total; i += chunkSize) {
                const chunk = cached.scenes.slice(i, i + chunkSize);
                chunk.forEach((s) => newTrie.insert(s));
                if (total > 3000) {
                  // Yield to browser event loop
                  await new Promise((r) => setTimeout(r, 0));
                }
              }
              newTrie.rebaseSingleChildRoot();
              window.__SFM_GLOBAL_CACHE__.trie = newTrie;
              window.__SFM_GLOBAL_CACHE__.scenes = cached.scenes;
              window.__SFM_GLOBAL_CACHE__.timestamp = cached.timestamp;
              setTrie(newTrie);
              setLoading(false);
              return;
            }
          }
        }

        // Tier 3: Fetch from Stash GraphQL
        setStatusText("Querying scenes from Stash database...");
        try {
          const query = `
            query GetScenePaths {
              findScenes(filter: { per_page: -1 }) {
                count
                scenes {
                  id
                  title
                  date
                  rating100
                  studio { id name }
                  performers { id name }
                  tags { id name }
                  paths { screenshot preview stream }
                  files { id path basename size duration video_codec format }
                }
              }
            }
          `;
          const data = await gqlFetch(query);
          const scenes = data?.findScenes?.scenes || [];
          const total = scenes.length;

          // Build trie progressively with non-blocking UI chunks
          const pluginCfg = pluginSettings || (await fetchStashPluginSettings());
          const { basePrefix, diskRoot } = resolveLibraryRoot(
            scenes,
            pluginCfg.root_library_path,
            pluginCfg.__stashes__
          );
          const newTrie = new PathTrie(basePrefix, diskRoot);
          const chunkSize = 1000;

          for (let i = 0; i < total; i += chunkSize) {
            const chunk = scenes.slice(i, i + chunkSize);
            chunk.forEach((s) => newTrie.insert(s));
            const processed = Math.min(i + chunkSize, total);
            setStatusText(`Indexing file hierarchy: ${processed.toLocaleString()} / ${total.toLocaleString()} scenes...`);
            // Yield to browser event loop to prevent UI freezing
            await new Promise((r) => setTimeout(r, 0));
          }
          newTrie.rebaseSingleChildRoot();

          // Compact scene representations to store efficiently
          const compact = scenes.map((s) => ({
            id: s.id,
            title: s.title,
            date: s.date,
            rating100: s.rating100,
            studio: s.studio ? { id: s.studio.id, name: s.studio.name } : null,
            performers: s.performers ? s.performers.map((p) => ({ id: p.id, name: p.name })) : [],
            tags: s.tags ? s.tags.map((t) => ({ id: t.id, name: t.name })) : [],
            paths: {
              screenshot: s.paths?.screenshot,
              preview: s.paths?.preview,
            },
            files: s.files
              ? s.files.map((f) => ({
                  path: f.path,
                  basename: f.basename,
                  size: f.size,
                  duration: f.duration,
                }))
              : [],
          }));

          // Store in memory and in IndexedDB
          window.__SFM_GLOBAL_CACHE__.trie = newTrie;
          window.__SFM_GLOBAL_CACHE__.scenes = compact;
          window.__SFM_GLOBAL_CACHE__.timestamp = Date.now();

          await idbSet(CACHE_KEY, {
            timestamp: Date.now(),
            scenes: compact,
          });

          setTrie(newTrie);
        } catch (err) {
          console.error(err);
          setNotification(`Failed to load library: ${err.message}`);
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        fetchCatalog(refreshKey > 0);
      }, [fetchCatalog, refreshKey]);

      const handleRescan = async () => {
        window.__SFM_GLOBAL_CACHE__.trie = null;
        window.__SFM_GLOBAL_CACHE__.scenes = null;
        await idbClear();
        setRefreshKey((k) => k + 1);
      };

      const currentNode = useMemo(() => {
        if (!trie) return null;
        let node = trie.getNode(currentPath);
        if (!node && currentPath) {
          // If currentPath had an old un-rebased prefix (e.g. "data/folder"), strip first segment and try
          const sub = currentPath.split("/").slice(1).join("/");
          if (sub && trie.getNode(sub)) {
            setCurrentPath(sub);
            return trie.getNode(sub);
          }
          setCurrentPath("");
          return trie.root;
        }
        return node || trie.root;
      }, [trie, currentPath]);

      // Feature 2 & 4: Subfolders filtering and sorting
      const filteredAndSortedSubfolders = useMemo(() => {
        if (!currentNode) return [];
        let list = Object.keys(currentNode.folders);

        if (hideEmpty) {
          list = list.filter((f) => currentNode.folders[f].allSceneIds.size > 0);
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          list = list.filter((f) => f.toLowerCase().includes(q));
        }

        list.sort((a, b) => {
          if (folderSort === "name_desc") return b.localeCompare(a);
          if (folderSort === "count_desc") {
            return currentNode.folders[b].allSceneIds.size - currentNode.folders[a].allSceneIds.size;
          }
          if (folderSort === "count_asc") {
            return currentNode.folders[a].allSceneIds.size - currentNode.folders[b].allSceneIds.size;
          }
          return a.localeCompare(b);
        });

        return list;
      }, [currentNode, hideEmpty, searchQuery, folderSort]);

      // Feature 2: Scenes filtering and sorting (with recursive subfolders support & folder-first sorting)
      const filteredAndSortedScenes = useMemo(() => {
        if (!currentNode) return [];

        const sceneComparator = (a, b) => {
          if (sceneSort === "title_desc") {
            return (b.title || b.files?.[0]?.basename || "").localeCompare(a.title || a.files?.[0]?.basename || "");
          }
          if (sceneSort === "date_desc") {
            return (b.date || "").localeCompare(a.date || "");
          }
          if (sceneSort === "date_asc") {
            return (a.date || "").localeCompare(b.date || "");
          }
          if (sceneSort === "rating_desc") {
            return (b.rating100 || 0) - (a.rating100 || 0);
          }
          if (sceneSort === "duration_desc") {
            return (b.files?.[0]?.duration || 0) - (a.files?.[0]?.duration || 0);
          }
          if (sceneSort === "size_desc") {
            return (b.files?.[0]?.size || 0) - (a.files?.[0]?.size || 0);
          }
          return (a.title || a.files?.[0]?.basename || "").localeCompare(b.title || b.files?.[0]?.basename || "");
        };

        const sortFolderKeys = (keys, parentNode) => {
          return [...keys].sort((a, b) => {
            if (folderSort === "name_desc") return b.localeCompare(a);
            if (folderSort === "count_desc") {
              return (parentNode.folders[b]?.allSceneIds?.size || 0) - (parentNode.folders[a]?.allSceneIds?.size || 0);
            }
            if (folderSort === "count_asc") {
              return (parentNode.folders[a]?.allSceneIds?.size || 0) - (parentNode.folders[b]?.allSceneIds?.size || 0);
            }
            return a.localeCompare(b);
          });
        };

        let list = [];
        if (includeSubfolders) {
          if (sortByFolderFirst) {
            // Hierarchical folder sort: traverse subfolders in folderSort order, then direct scenes of this node
            const seenIds = new Set();
            const collectHierarchy = (node) => {
              const collected = [];
              if (!node) return collected;

              // 1. Visit subfolders in folderSort order
              if (node.folders) {
                const sortedKeys = sortFolderKeys(Object.keys(node.folders), node);
                for (const k of sortedKeys) {
                  const child = node.folders[k];
                  collected.push(...collectHierarchy(child));
                }
              }

              // 2. Direct scenes in this node, sorted by sceneSort
              if (node.directScenes && node.directScenes.length > 0) {
                const directCopy = [...node.directScenes];
                directCopy.sort(sceneComparator);
                for (const s of directCopy) {
                  if (s && s.id && !seenIds.has(s.id)) {
                    seenIds.add(s.id);
                    collected.push(s);
                  }
                }
              }

              return collected;
            };

            list = collectHierarchy(currentNode);
          } else {
            list = getAllDescendantScenes(currentNode);
            list.sort(sceneComparator);
          }
        } else {
          list = [...currentNode.directScenes];
          list.sort(sceneComparator);
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          list = list.filter((s) => {
            const title = (s.title || "").toLowerCase();
            const file = (s.files?.[0]?.basename || "").toLowerCase();
            const studio = (s.studio?.name || "").toLowerCase();
            const performers = (s.performers || []).map((p) => p.name.toLowerCase()).join(" ");
            return title.includes(q) || file.includes(q) || studio.includes(q) || performers.includes(q);
          });
        }

        return list;
      }, [currentNode, includeSubfolders, searchQuery, sceneSort, folderSort, sortByFolderFirst]);

      const allDescendantIds = currentNode ? Array.from(currentNode.allSceneIds) : [];
      const currentFolderName = currentPath.split("/").filter(Boolean).pop() || "Stash";

      const handleAutoDetect = async () => {
        if (!currentPath) return;
        setNotification(`Checking for matching Studio or Performer for "${currentFolderName}"...`);

        try {
          const [sRes, pRes] = await Promise.all([
            gqlFetch(
              `query FindStudio($name: String!) {
                findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
                  studios { id name }
                }
              }`,
              { name: currentFolderName }
            ),
            gqlFetch(
              `query FindPerformer($name: String!) {
                findPerformers(performer_filter: { name: { value: $name, modifier: EQUALS } }) {
                  performers { id name }
                }
              }`,
              { name: currentFolderName }
            ),
          ]);

          const studio = sRes?.findStudios?.studios?.[0];
          const performer = pRes?.findPerformers?.performers?.[0];

          if (!studio && !performer) {
            setNotification(`No exact database match found for "${currentFolderName}". Use 'Batch Edit' to specify manually.`);
            return;
          }

          const matches = [];
          const input = { ids: allDescendantIds };
          if (studio) {
            input.studio_id = studio.id;
            matches.push(`Studio: ${studio.name}`);
          }
          if (performer) {
            input.performer_ids = { ids: [performer.id], mode: "ADD" };
            matches.push(`Performer: ${performer.name}`);
          }

          if (window.confirm(`Auto-detected ${matches.join(" and ")}. Apply to all ${allDescendantIds.length} scenes in this folder?`)) {
            await gqlFetch(
              `mutation ApplyAutoMatch($input: BulkSceneUpdateInput!) {
                bulkSceneUpdate(input: $input) { id }
              }`,
              { input }
            );
            setNotification(`Successfully assigned ${matches.join(" & ")} to ${allDescendantIds.length} scenes.`);
            handleRescan();
          }
        } catch (err) {
          setNotification(`Error: ${err.message}`);
        }
      };

      const openInNativeGrid = () => {
        if (!currentPath) {
          window.open("/scenes", "_blank");
          return;
        }
        const node = trie?.getNode(currentPath);
        const targetPath = node?.diskPath || currentPath;
        const filterCriterion = {
          type: "path",
          value: targetPath,
          modifier: "MATCHES_REGEX",
        };
        localStorage.setItem("sfm_last_folder_path", currentPath);
        const currentHash = buildHashForPath(currentPath);
        if (window.location.hash !== currentHash) {
          window.history.replaceState({ sfmPath: currentPath }, "", currentHash);
        }
        // Open native scene card grid in a new tab so the current folder location remains open and intact!
        window.open(`/scenes?c=${encodeURIComponent(JSON.stringify(filterCriterion))}`, "_blank");
      };

      // Milestone 3: Folder-Scoped Metadata Scan
      const handleScanFolder = async () => {
        const node = trie?.getNode(currentPath);
        const targetPath = node?.diskPath || currentPath || trie?.root?.diskPath || "";
        const label = targetPath ? `"${targetPath}"` : "all Stash libraries";
        setNotification(`Starting Stash filesystem scan for: ${label}...`);
        try {
          const mutation = `
            mutation ScanPath($paths: [String!]) {
              metadataScan(input: { paths: $paths })
            }
          `;
          await gqlFetch(mutation, { paths: targetPath ? [targetPath] : [] });
          setNotification(`Stash scan task triggered for ${label}. Check Settings -> Tasks.`);
        } catch (e) {
          setNotification(`Scan failed: ${e.message}`);
        }
      };

      const handleSelectAllFolderScenes = useCallback(() => {
        if (selectedSceneIds.size > 0) {
          setSelectedSceneIds(new Set());
        } else {
          const visibleIds = filteredAndSortedScenes.map((s) => s.id);
          setSelectedSceneIds(new Set(visibleIds));
        }
      }, [selectedSceneIds, filteredAndSortedScenes]);

      // Directory Keyboard Shortcuts (Milestone 1)
      useEffect(() => {
        const handleDirectoryKeyDown = (e) => {
          if (loading || playingScene || showSettingsModal || showBatchModal || showParserModal) {
            return;
          }

          const activeEl = document.activeElement;
          const isInputActive = activeEl && (["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName) || activeEl.isContentEditable);

          if (e.key === "Escape") {
            if (isInputActive) {
              if (searchQuery) {
                setSearchQuery("");
              }
              activeEl.blur();
              return;
            }
            if (selectedSceneIds.size > 0) {
              e.preventDefault();
              setSelectedSceneIds(new Set());
              return;
            }
            if (onClose) {
              e.preventDefault();
              onClose();
              return;
            }
          }

          if (isInputActive) return;

          if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            searchInputRef.current?.focus();
            return;
          }

          if (e.key === "Backspace" || (e.altKey && e.key === "ArrowLeft")) {
            if (currentPath) {
              e.preventDefault();
              handleGoUpOneLevel();
              return;
            }
          }

          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
            e.preventDefault();
            handleSelectAllFolderScenes();
            return;
          }
        };

        window.addEventListener("keydown", handleDirectoryKeyDown);
        return () => window.removeEventListener("keydown", handleDirectoryKeyDown);
      }, [
        loading,
        playingScene,
        showSettingsModal,
        showBatchModal,
        showParserModal,
        currentPath,
        searchQuery,
        selectedSceneIds,
        handleGoUpOneLevel,
        handleSelectAllFolderScenes,
        onClose,
      ]);

      if (loading) {
        return React.createElement(
          "div",
          { className: "sfm-workspace-overlay" },
          React.createElement(
            "div",
            { className: "sfm-workspace-header" },
            React.createElement("div", { className: "sfm-workspace-title" }, React.createElement(IconFolder, { size: 20, color: "#88c0d0" }), React.createElement("span", { className: "ml-2" }, "Stash File Manager")),
            onClose && React.createElement("button", { className: "sfm-workspace-close", onClick: onClose }, "✕ Close")
          ),
          React.createElement(
            "div",
            { className: "sfm-workspace-content text-center py-5" },
            React.createElement("div", { className: "spinner-border text-info mb-3", style: { width: "3rem", height: "3rem" } }),
            React.createElement("h4", null, "Indexing File System Hierarchy..."),
            React.createElement("p", { className: "text-muted" }, statusText)
          )
        );
      }





      const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

      return React.createElement(
        "div",
        { className: "sfm-workspace-overlay" },
        // Header (Clean branding & window control)
        React.createElement(
          "div",
          { className: "sfm-workspace-header" },
          // Left: Workspace Branding
          React.createElement(
            "div",
            { className: "sfm-workspace-title" },
            React.createElement(IconFolder, { size: 22, color: "#88c0d0" }),
            React.createElement("span", { className: "ml-2" }, "Stash File Manager"),
            trie && React.createElement("span", { className: "badge badge-dark ml-2 text-muted small" }, `${trie.root.allSceneIds.size} total scenes`)
          ),
          // Right: Close Button
          onClose && React.createElement("button", { className: "sfm-workspace-close", onClick: onClose }, "✕ Close")
        ),
        // Scrollable Body
        React.createElement(
          "div",
          { className: "sfm-workspace-content" },
          // Folder Navigation Control Line (Multi-Line: Path Navigation & Quick Controls)
          React.createElement(
            "div",
            { className: "sfm-nav-control-line mb-3" },
            // Line 1: [◀] [▲] | 🏠 Stash › ... › Folder | [counts and size with colored digits] | [Scan] [Grid] | ... [Settings]
            React.createElement(
              "div",
              { className: "sfm-nav-line sfm-nav-line-path d-flex align-items-center justify-content-between flex-wrap gap-2" },
              React.createElement(
                "div",
                { className: "sfm-breadcrumbs-wrap d-flex align-items-center flex-wrap" },
                // Back & Up (Icons only, hover tooltip, grouped 2 as 1)
                React.createElement(
                  "div",
                  { className: "btn-group btn-group-sm mr-2 sfm-nav-history-group" },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-0 px-2",
                      onClick: handleGoBackInHistory,
                      disabled: historyStack.current.length === 0 && !currentPath,
                      title: "Go back to previous folder (Alt+Left)",
                    },
                    React.createElement(IconArrowLeft, { size: 14 })
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-0 px-2",
                      onClick: handleGoUpOneLevel,
                      disabled: !currentPath,
                      title: "Go up to parent directory (Backspace)",
                    },
                    React.createElement(IconArrowUp, { size: 14 })
                  )
                ),
                // Path Root: Stash (with Home Icon)
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `sfm-crumb-btn ${!currentPath ? "sfm-crumb-active" : ""}`,
                    onClick: () => navigateToFolder(""),
                    title: "Return to Stash Root",
                  },
                  React.createElement(IconHome, { size: 14, color: "#88c0d0" }),
                  React.createElement("span", { className: "ml-1 font-weight-bold" }, "Stash")
                ),
                // Segments
                segments.map((seg, idx) => {
                  const p = segments.slice(0, idx + 1).join("/");
                  const isLast = idx === segments.length - 1;
                  return React.createElement(
                    React.Fragment,
                    { key: p },
                    React.createElement("span", { className: "sfm-crumb-separator" }, "›"),
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: `sfm-crumb-btn ${isLast ? "sfm-crumb-active" : ""}`,
                        onClick: () => navigateToFolder(p),
                        title: seg,
                      },
                      seg
                    )
                  );
                }),
                // Counts and size with colored digits
                React.createElement(
                  "span",
                  { className: "sfm-stat-pill ml-2 badge badge-dark font-weight-normal" },
                  React.createElement("strong", { style: { color: "#88c0d0" } }, currentNode ? currentNode.directScenes.length : 0),
                  React.createElement("span", { className: "sfm-stat-label" }, "direct"),
                  React.createElement("span", { className: "sfm-stat-dot" }, "·"),
                  React.createElement("strong", { style: { color: "#81a1c1" } }, allDescendantIds.length),
                  React.createElement("span", { className: "sfm-stat-label" }, "in tree"),
                  React.createElement("span", { className: "sfm-stat-paren" }, "("),
                  React.createElement("strong", { style: { color: "#a3be8c" } }, formatBytes(currentNode?.totalSize)),
                  React.createElement("span", { className: "sfm-stat-paren" }, ")")
                ),
                // Scan and Grid (Icons only, hover tooltip, grouped 2 as 1)
                React.createElement(
                  "div",
                  { className: "btn-group btn-group-sm ml-2 sfm-nav-actions-group" },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-0 px-2",
                      onClick: handleScanFolder,
                      title: currentPath ? `Trigger Stash filesystem scan on "${currentPath}"` : "Trigger Stash filesystem scan on all libraries",
                    },
                    React.createElement(IconScan, { size: 14 })
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-0 px-2",
                      onClick: openInNativeGrid,
                      title: currentPath ? "Open folder in Stash native scenes grid (new tab)" : "Open Stash native scenes grid (new tab)",
                    },
                    React.createElement(IconGrid, { size: 14 })
                  )
                )
              ),
              // Settings (aligned and anchored to the right of Line 1)
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "sfm-workspace-settings-btn ml-auto",
                  onClick: () => setShowSettingsModal(true),
                  title: "Stash Settings & Plugin Tasks",
                },
                React.createElement(IconGear, { size: 14, color: "currentColor" }),
                "Settings"
              )
            ),
            // Line 2: [folder sort / scene sort] [the search box (stretch till fit)] [batch edit / parse (anchor right)]
            React.createElement(
              "div",
              { className: "sfm-nav-line sfm-nav-line-controls d-flex align-items-center gap-2 mt-2" },
              // Left: [folder sort / scene sort]
              React.createElement(
                "div",
                { className: "sfm-sort-group d-flex align-items-center gap-2 flex-shrink-0" },
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center sfm-sort-item" },
                  React.createElement("span", { className: "sfm-sort-label mr-1 text-muted small" }, "Folders:"),
                  React.createElement(
                    "select",
                    {
                      className: "sfm-sort-select",
                      value: folderSort,
                      onChange: (e) => setFolderSort(e.target.value),
                      title: "Sort Subfolders",
                    },
                    React.createElement("option", { value: "name_asc" }, "Name (A-Z)"),
                    React.createElement("option", { value: "name_desc" }, "Name (Z-A)"),
                    React.createElement("option", { value: "count_desc" }, "Count (High-Low)"),
                    React.createElement("option", { value: "count_asc" }, "Count (Low-High)")
                  )
                ),
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center sfm-sort-item" },
                  React.createElement("span", { className: "sfm-sort-label mr-1 text-muted small" }, "Scenes:"),
                  React.createElement(
                    "select",
                    {
                      className: "sfm-sort-select",
                      value: sceneSort,
                      onChange: (e) => setSceneSort(e.target.value),
                      title: "Sort Scenes",
                    },
                    React.createElement("option", { value: "title_asc" }, "Title (A-Z)"),
                    React.createElement("option", { value: "title_desc" }, "Title (Z-A)"),
                    React.createElement("option", { value: "date_desc" }, "Date (Newest)"),
                    React.createElement("option", { value: "date_asc" }, "Date (Oldest)"),
                    React.createElement("option", { value: "rating_desc" }, "Rating (Highest)"),
                    React.createElement("option", { value: "duration_desc" }, "Duration (Longest)"),
                    React.createElement("option", { value: "size_desc" }, "Size (Largest)")
                  )
                )
              ),
              // Center: [the search box (stretch till fit)]
              React.createElement(
                "div",
                { className: "sfm-search-wrap sfm-search-stretch flex-grow-1 mx-3" },
                React.createElement(
                  "span",
                  { className: "sfm-search-icon" },
                  React.createElement(IconSearch, { size: 14, color: "#81a1c1" })
                ),
                React.createElement("input", {
                  ref: searchInputRef,
                  type: "text",
                  className: "sfm-search-input w-100",
                  placeholder: "Search folder or scenes by title, studio, performer... (Press / to focus)",
                  value: searchQuery,
                  onChange: (e) => setSearchQuery(e.target.value),
                }),
                searchQuery &&
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "sfm-search-clear",
                      onClick: () => {
                        setSearchQuery("");
                        searchInputRef.current?.focus();
                      },
                      title: "Clear search (Esc)",
                    },
                    React.createElement(IconX, { size: 10, color: "currentColor" })
                  )
              ),
              // Right: [batch edit / parse (align and anchor to right)]
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm sfm-tools-group flex-shrink-0 ml-auto" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-outline-secondary py-1 px-2",
                    onClick: () => setShowBatchModal(true),
                    title: "Batch Edit Scenes",
                  },
                  React.createElement(IconEdit, { size: 13, className: "mr-1" }),
                  "Batch Edit"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-outline-secondary py-1 px-2",
                    onClick: () => setShowParserModal(true),
                    title: "Parse Filenames with Regex",
                  },
                  React.createElement(IconSearch, { size: 13, className: "mr-1" }),
                  "Parse"
                )
              )
            )
          ),
          // Subfolders Section (Customizable Views: Cards, List, Detail Table)
          (filteredAndSortedSubfolders.length > 0 || (includeSubfolders && Object.keys(currentNode?.folders || {}).length > 0)) &&
            React.createElement(
              "div",
              { className: "mb-4" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center flex-wrap" },
                  React.createElement(
                    "div",
                    {
                      className: "sfm-section-title-box sfm-section-header mb-0 sfm-collapsible-title",
                      onClick: handleToggleSubfoldersCollapsed,
                      title: isSubfoldersCollapsed ? "Click to expand Subfolders" : "Click to collapse Subfolders",
                      style: { cursor: "pointer", userSelect: "none" },
                    },
                    React.createElement(
                      "span",
                      { className: "sfm-collapse-chevron mr-2 text-info font-weight-bold" },
                      isSubfoldersCollapsed ? "▶" : "▼"
                    ),
                    React.createElement("span", { className: "sfm-section-title-label" }, "Subfolders"),
                    React.createElement("span", { className: "badge badge-dark sfm-section-count-badge font-weight-normal" }, filteredAndSortedSubfolders.length),
                    isSubfoldersCollapsed &&
                      React.createElement("span", { className: "text-muted small ml-2 font-italic" }, "(collapsed)")
                  ),
                  // Toggle 1: Include Sub-Folder
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge ${includeSubfolders ? "badge-info" : "badge-secondary"} sfm-badge-btn ml-2 font-weight-normal sfm-pill-subfolders`,
                      onClick: (e) => {
                        e.stopPropagation();
                        handleToggleIncludeSubfolders(!includeSubfolders);
                      },
                      title: includeSubfolders
                        ? "Click to exclude sub-folders (show direct folder files only)"
                        : "Click to recursively include scenes from all sub-folders",
                    },
                    "Include Sub-Folders"
                  ),
                  // Toggle 2: Group by Folder
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge ${sortByFolderFirst ? "badge-info" : "badge-secondary"} sfm-badge-btn ml-2 font-weight-normal sfm-pill-foldersort`,
                      onClick: (e) => {
                        e.stopPropagation();
                        handleToggleSortByFolderFirst(!sortByFolderFirst);
                      },
                      title: sortByFolderFirst
                        ? "Click to disable folder grouping and sort all scenes altogether"
                        : "Click to group and sort scenes by folder order first",
                    },
                    "Group by Folder"
                  ),
                  // Toggle 3: Hide Empty
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge ${hideEmpty ? "badge-info" : "badge-secondary"} sfm-badge-btn ml-2 font-weight-normal sfm-pill-hideempty`,
                      onClick: (e) => {
                        e.stopPropagation();
                        handleToggleHideEmpty(!hideEmpty);
                      },
                      title: "Hide empty subfolders",
                    },
                    "Hide Empty"
                  )
                ),
                !isSubfoldersCollapsed &&
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center justify-content-end flex-wrap gap-2 ml-auto" },
                    folderViewMode === "cards" &&
                      React.createElement(
                        "div",
                        {
                          className: "d-flex align-items-center sfm-size-slider-wrap mr-2",
                          title: `Adjust folder card thumbnail size: ${folderCardSize}px`,
                        },
                        React.createElement(IconZoom, { size: 12, color: "#81a1c1" }),
                        React.createElement("input", {
                          type: "range",
                          className: "sfm-size-slider",
                          min: 120,
                          max: 300,
                          step: 10,
                          value: folderCardSize,
                          onChange: (e) => handleSetFolderCardSize(Number(e.target.value)),
                        })
                      ),
                    folderViewMode === "list" &&
                      React.createElement(
                        "div",
                        {
                          className: "d-flex align-items-center sfm-size-slider-wrap mr-2",
                          title: `Adjust folder list box length: ${folderListWidth}px`,
                        },
                        React.createElement(IconWidth, { size: 12, color: "#81a1c1" }),
                        React.createElement("input", {
                          type: "range",
                          className: "sfm-size-slider",
                          min: 140,
                          max: 420,
                          step: 10,
                          value: folderListWidth,
                          onChange: (e) => handleSetFolderListWidth(Number(e.target.value)),
                        })
                      ),
                    React.createElement(
                      "div",
                      { className: "btn-group btn-group-sm sfm-view-toggle-group" },
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${folderViewMode === "cards" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => { setIsSubfoldersCollapsed(false); handleSetFolderViewMode("cards"); },
                          title: "Compact Cards View",
                        },
                        "Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${folderViewMode === "list" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => { setIsSubfoldersCollapsed(false); handleSetFolderViewMode("list"); },
                          title: "Compact List View",
                        },
                        "List"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${folderViewMode === "detail" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => { setIsSubfoldersCollapsed(false); handleSetFolderViewMode("detail"); },
                          title: "Detail Table View",
                        },
                        "Details"
                      )
                    )
                  )
              ),
              // Render Folder View based on mode (if not collapsed)
              !isSubfoldersCollapsed &&
                (folderViewMode === "cards"
                  ? React.createElement(
                  "div",
                  {
                    className: "sfm-folder-cards-grid",
                    style: { "--sfm-folder-card-size": `${folderCardSize}px` },
                  },
                  filteredAndSortedSubfolders.map((folderName) => {
                    const childNode = currentNode.folders[folderName];
                    const count = childNode ? childNode.allSceneIds.size : 0;
                    const size = childNode ? formatBytes(childNode.totalSize) : "0 B";
                    const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName;
                    return React.createElement(
                      "div",
                      {
                        key: folderName,
                        className: "sfm-folder-card sfm-folder-card-compact",
                        onClick: () => navigateToFolder(nextPath),
                        title: `${folderName} (${count} scenes, ${size})`,
                      },
                      React.createElement("div", { className: "sfm-folder-icon-wrap" }, React.createElement(IconFolderCard, { size: Math.max(20, Math.min(36, Math.round(folderCardSize * 0.18))), color: "#81a1c1" })),
                      React.createElement("div", { className: "sfm-folder-name" }, folderName),
                      React.createElement(
                        "div",
                        { className: "sfm-folder-badges" },
                        React.createElement("span", { className: "sfm-badge" }, `${count} scenes`),
                        count > 0 && React.createElement("span", { className: "sfm-badge text-muted" }, size)
                      )
                    );
                  })
                )
              : folderViewMode === "list"
                ? React.createElement(
                  "div",
                  {
                    className: "sfm-folder-list-grid",
                    style: { "--sfm-folder-list-width": `${folderListWidth}px` },
                  },
                  filteredAndSortedSubfolders.map((folderName) => {
                    const childNode = currentNode.folders[folderName];
                    const count = childNode ? childNode.allSceneIds.size : 0;
                    const size = childNode ? formatBytes(childNode.totalSize) : "0 B";
                    const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName;
                    return React.createElement(
                      "div",
                      {
                        key: folderName,
                        className: "sfm-folder-list-item",
                        onClick: () => navigateToFolder(nextPath),
                        title: `${folderName} (${count} scenes, ${size})`,
                      },
                      React.createElement("div", { className: "sfm-folder-list-icon" }, React.createElement(IconFolderCard, { size: 18, color: "#81a1c1" })),
                      React.createElement("div", { className: "sfm-folder-list-name text-truncate font-weight-bold" }, folderName),
                      React.createElement("span", { className: "sfm-folder-list-badge" }, count)
                    );
                  })
                )
                : React.createElement(
                  "div",
                  { className: "table-responsive mb-3" },
                  React.createElement(
                    "table",
                    { className: "table table-dark table-sm sfm-folder-table" },
                    React.createElement(
                      "thead",
                      null,
                      React.createElement(
                        "tr",
                        null,
                        React.createElement("th", { style: { minWidth: "200px" } }, "Folder Name"),
                        React.createElement("th", { style: { width: "110px" } }, "Type"),
                        React.createElement("th", { style: { width: "120px" } }, "Scenes"),
                        React.createElement("th", { style: { width: "110px" } }, "Size"),
                        React.createElement("th", { style: { width: "140px", textAlign: "right" } }, "Actions")
                      )
                    ),
                    React.createElement(
                      "tbody",
                      null,
                      filteredAndSortedSubfolders.map((folderName) => {
                        const childNode = currentNode.folders[folderName];
                        const count = childNode ? childNode.allSceneIds.size : 0;
                        const size = childNode ? formatBytes(childNode.totalSize) : "0 B";
                        const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName;
                        return React.createElement(
                          "tr",
                          {
                            key: folderName,
                            className: "sfm-folder-table-row",
                            onClick: () => navigateToFolder(nextPath),
                            title: `Navigate into ${folderName}`,
                          },
                          React.createElement(
                            "td",
                            null,
                            React.createElement(
                              "div",
                              { className: "d-flex align-items-center" },
                              React.createElement("span", { className: "mr-2" }, React.createElement(IconFolderCard, { size: 18, color: "#81a1c1" })),
                              React.createElement("span", { className: "sfm-folder-table-name font-weight-bold" }, folderName)
                            )
                          ),
                          React.createElement("td", { className: "text-muted small" }, "Directory"),
                          React.createElement("td", null, React.createElement("span", { className: "badge badge-dark" }, `${count} scenes`)),
                          React.createElement("td", { className: "text-muted small" }, size),
                          React.createElement(
                            "td",
                            { style: { textAlign: "right" } },
                            React.createElement(
                              "button",
                              {
                                className: "btn btn-sm btn-outline-info py-0 px-2 mr-1",
                                onClick: (e) => {
                                  e.stopPropagation();
                                  const filter = { type: "path", value: nextPath, modifier: "MATCHES_REGEX" };
                                  window.open(`/scenes?c=${encodeURIComponent(JSON.stringify(filter))}`, "_blank");
                                },
                                title: "Open folder in Stash native scene grid (new tab)",
                              },
                              "↗ Grid"
                            ),
                            React.createElement(
                              "button",
                              {
                                className: "btn btn-sm btn-outline-secondary py-0 px-2",
                                onClick: async (e) => {
                                  e.stopPropagation();
                                  try {
                                    await gqlFetch(`mutation ScanPath($paths: [String!]) { metadataScan(input: { paths: $paths }) }`, { paths: [nextPath] });
                                    setNotification(`Scan triggered for "${nextPath}". Check Settings -> Tasks.`);
                                  } catch (err) {
                                    setNotification(`Scan error: ${err.message}`);
                                  }
                                },
                                title: "Trigger Stash filesystem scan for this folder",
                              },
                              "🔍 Scan"
                            )
                          )
                        );
                      })
                    )
                  )
                ))
            ),
          // Direct Scenes Section (Milestone 1 & 2)
          filteredAndSortedScenes.length > 0 &&
            React.createElement(
              "div",
              { className: "mb-4" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2 position-relative" },
                // Left group: Title + count + indicator 1 + indicator 2
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center flex-wrap" },
                  React.createElement(
                    "div",
                    {
                      className: "sfm-section-title-box sfm-section-header mb-0 sfm-collapsible-title",
                      onClick: handleToggleFilesCollapsed,
                      title: isFilesCollapsed ? "Click to expand Files" : "Click to collapse Files",
                      style: { cursor: "pointer", userSelect: "none" },
                    },
                    React.createElement(
                      "span",
                      { className: "sfm-collapse-chevron mr-2 text-info font-weight-bold" },
                      isFilesCollapsed ? "▶" : "▼"
                    ),
                    React.createElement("span", { className: "sfm-section-title-label" }, "Files / Scenes"),
                    React.createElement("span", { className: "badge badge-dark sfm-section-count-badge font-weight-normal" }, filteredAndSortedScenes.length),
                    isFilesCollapsed &&
                      React.createElement("span", { className: "text-muted small ml-2 font-italic" }, "(collapsed)")
                  ),
                  // Indicator 1 (always on, matching top file count style, no dot, high visibility)
                  React.createElement(
                    "span",
                    {
                      className: "sfm-stat-pill badge badge-dark sfm-badge-indicator ml-2 font-weight-normal sfm-pill-subfolders",
                      title: includeSubfolders ? "Sub-folders are included in scenes view" : "Sub-folders are excluded from scenes view",
                    },
                    includeSubfolders ? "Sub-Folders Included" : "Sub-Folders Excluded"
                  ),
                  // Indicator 2 (always on, matching top file count style, no dot, high visibility)
                  React.createElement(
                    "span",
                    {
                      className: "sfm-stat-pill badge badge-dark sfm-badge-indicator ml-2 font-weight-normal sfm-pill-foldersort",
                      title: sortByFolderFirst ? "Scenes ordered by folder sort first, then sorted within each folder" : "Scenes sorted altogether across all folders flatly",
                    },
                    sortByFolderFirst ? "Grouped by Folder" : "Sorted Altogether"
                  )
                ),
                // Center: [select all (centered)]
                !isFilesCollapsed &&
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center justify-content-center flex-grow-1 mx-2" },
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: `btn btn-sm ${selectedSceneIds.size > 0 ? "btn-primary font-weight-bold" : "btn-outline-secondary"} py-0 px-3 sfm-pill-selectall`,
                        onClick: handleSelectAllFolderScenes,
                        title: selectedSceneIds.size > 0 ? `Click to deselect all (${selectedSceneIds.size} selected)` : "Select all visible scenes in folder",
                      },
                      selectedSceneIds.size > 0 ? `${selectedSceneIds.size} Selected` : "Select All"
                    )
                  ),
                // Right: slider + [Cards, Table, Names]
                !isFilesCollapsed &&
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center justify-content-end flex-wrap gap-2 ml-auto" },
                    viewMode === "grid" &&
                      React.createElement(
                        "div",
                        {
                          className: "d-flex align-items-center sfm-size-slider-wrap mr-2",
                          title: `Adjust scene thumbnail card size: ${sceneCardSize}px (up to 10 per row)`,
                        },
                        React.createElement(IconZoom, { size: 12, color: "#81a1c1" }),
                        React.createElement("input", {
                          type: "range",
                          className: "sfm-size-slider",
                          min: 110,
                          max: 460,
                          step: 10,
                          value: sceneCardSize,
                          onChange: (e) => handleSetSceneCardSize(Number(e.target.value)),
                        })
                      ),
                    React.createElement(
                      "div",
                      { className: "btn-group btn-group-sm sfm-view-toggle-group" },
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${viewMode === "grid" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => handleToggleViewMode("grid"),
                          title: "16:9 Thumbnail Cards View",
                        },
                        "Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${viewMode === "list" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => handleToggleViewMode("list"),
                          title: "Detailed Metadata Table View",
                        },
                        "Table"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${viewMode === "names" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => handleToggleViewMode("names"),
                          title: "Filenames Only (for Easy Bulk Selection & Regex)",
                        },
                        "Names"
                      )
                    )
                  )
              ),
              !isFilesCollapsed &&
                (viewMode === "list"
                  ? React.createElement(SceneTableView, {
                    scenes: filteredAndSortedScenes,
                    onPlay: (s) => setPlayingScene(s),
                    selectedIds: selectedSceneIds,
                    onToggleSelect: handleToggleSelect,
                    onSelectAll: handleSelectAllFolderScenes,
                    showFolderBadge: includeSubfolders,
                    currentPath,
                  })
                : viewMode === "names"
                  ? React.createElement(SceneNamesTableView, {
                    scenes: filteredAndSortedScenes,
                    onPlay: (s) => setPlayingScene(s),
                    selectedIds: selectedSceneIds,
                    onToggleSelect: handleToggleSelect,
                    onSelectAll: handleSelectAllFolderScenes,
                    showFolderBadge: includeSubfolders,
                    currentPath,
                  })
                : React.createElement(
                    "div",
                    {
                      className: "sfm-scene-cards-grid",
                      style: { "--sfm-scene-card-size": `${sceneCardSize}px` },
                    },
                    filteredAndSortedScenes.map((scene) =>
                      React.createElement(SceneCard, {
                        key: scene.id,
                        scene,
                        onPlay: () => setPlayingScene(scene),
                        isSelected: selectedSceneIds.has(scene.id),
                        onToggleSelect: handleToggleSelect,
                        showFolderBadge: includeSubfolders,
                        currentPath,
                      })
                    )
                  )
            )
            ),
          filteredAndSortedSubfolders.length === 0 &&
            filteredAndSortedScenes.length === 0 &&
            React.createElement(
              "div",
              { className: "text-center py-5 text-muted" },
              React.createElement("h5", null, searchQuery ? "No matching folders or scenes found." : "This folder contains no scanned media files."),
              searchQuery
                ? React.createElement("button", { className: "btn btn-outline-secondary mt-2", onClick: () => setSearchQuery("") }, "Clear Search")
                : React.createElement("button", { className: "btn btn-outline-secondary mt-2", onClick: () => navigateToFolder("") }, "Return to Stash")
            ),
          // Floating Bulk Action Bar (Milestone 1)
          selectedSceneIds.size > 0 &&
            React.createElement(
              "div",
              { className: "sfm-floating-bulk-bar" },
              React.createElement(
                "div",
                { className: "sfm-bulk-inner" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-primary font-weight-bold py-1 px-2 sfm-bulk-count-btn",
                    onClick: handleSelectAllFolderScenes,
                    title: `Click to deselect all (${selectedSceneIds.size} selected)`,
                  },
                  `${selectedSceneIds.size} Selected`
                ),
                React.createElement(
                  "div",
                  { className: "btn-group btn-group-sm" },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-1 px-2",
                      onClick: () => setShowBatchModal(true),
                      title: "Batch edit selected scenes",
                    },
                    React.createElement(IconEdit, { size: 13, className: "mr-1" }),
                    "Batch Edit"
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-1 px-2",
                      onClick: () => setShowParserModal(true),
                      title: "Regex parse selected scenes",
                    },
                    React.createElement(IconSearch, { size: 13, className: "mr-1" }),
                    "Parse"
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-1 px-2 d-inline-flex align-items-center justify-content-center",
                      onClick: () => {
                        const ids = Array.from(selectedSceneIds);
                        const filterCriterion = {
                          type: "ids",
                          value: ids,
                          modifier: "INCLUDES",
                        };
                        window.open(`/scenes?c=${encodeURIComponent(JSON.stringify(filterCriterion))}`, "_blank");
                      },
                      title: "Open selected scenes in Stash native grid (new tab)",
                    },
                    React.createElement(IconGrid, { size: 14 })
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-1 px-2",
                      onClick: handleClearSelection,
                      title: "Clear selection (Esc)",
                    },
                    React.createElement(IconX, { size: 12, className: "mr-1" }),
                    "Clear"
                  )
                )
              )
            ),
          // Modals
          showBatchModal &&
            React.createElement(BatchMetadataModal, {
              currentFolder: selectedSceneIds.size > 0 ? `${selectedSceneIds.size} selected scenes` : currentFolderName,
              sceneCount: selectedSceneIds.size > 0 ? selectedSceneIds.size : allDescendantIds.length,
              sceneIds: selectedSceneIds.size > 0 ? Array.from(selectedSceneIds) : allDescendantIds,
              onClose: () => setShowBatchModal(false),
              onApplied: () => {
                handleClearSelection();
                handleRescan();
              },
            }),
          showParserModal &&
            React.createElement(FilenameParserModal, {
              currentFolder: selectedSceneIds.size > 0 ? `${selectedSceneIds.size} selected scenes` : currentFolderName,
              currentPath: currentPath || "",
              directScenes: selectedSceneIds.size > 0
                ? (includeSubfolders
                    ? getAllDescendantScenes(currentNode).filter((s) => selectedSceneIds.has(s.id))
                    : (currentNode ? currentNode.directScenes.filter((s) => selectedSceneIds.has(s.id)) : []))
                : (includeSubfolders
                    ? getAllDescendantScenes(currentNode)
                    : (currentNode ? currentNode.directScenes : [])),
              onClose: () => setShowParserModal(false),
              onApplied: () => {
                handleClearSelection();
                handleRescan();
              },
            }),
          showSettingsModal &&
            React.createElement(SettingsAndTasksModal, {
              isOpen: showSettingsModal,
              onClose: () => setShowSettingsModal(false),
              settings: pluginSettings,
              onSaveSettings: async (newVals) => {
                await saveStashPluginSettings(newVals);
                setPluginSettings((prev) => ({ ...(prev || {}), ...newVals }));
                if (newVals.default_transcode_method) {
                  window.__SFM_DEFAULT_TRANSCODE_METHOD__ = newVals.default_transcode_method;
                  try { window.localStorage.setItem("sfm_stream_mode", newVals.default_transcode_method); } catch(e) {}
                }
                if (newVals.fallback_transcode_method) {
                  window.__SFM_FALLBACK_TRANSCODE_METHOD__ = newVals.fallback_transcode_method;
                }
                if (newVals.folder_view_mode) {
                  setFolderViewMode(newVals.folder_view_mode);
                  try { window.localStorage.setItem("sfm_folder_view_mode", newVals.folder_view_mode); } catch(e) {}
                }
                if (newVals.scene_view_mode) {
                  const m = newVals.scene_view_mode === "cards" ? "grid" : "table";
                  setViewMode(m);
                  try { window.localStorage.setItem("sfm_view_mode", m); } catch(e) {}
                }
                if (newVals.folder_card_size) {
                  setFolderCardSize(Number(newVals.folder_card_size));
                  try { window.localStorage.setItem("sfm_folder_card_size", String(newVals.folder_card_size)); } catch(e) {}
                }
                if (newVals.scene_card_size) {
                  setSceneCardSize(Number(newVals.scene_card_size));
                  try { window.localStorage.setItem("sfm_scene_card_size", String(newVals.scene_card_size)); } catch(e) {}
                }
                setNotification("✓ Settings saved to Stash config.yml");
                setTimeout(() => setNotification(""), 3500);
              },
              onTriggerRebuild: () => {
                setShowSettingsModal(false);
                handleRescan();
              },
              onResetDefaults: async () => {
                const defaults = {
                  default_transcode_method: "direct",
                  fallback_transcode_method: "hls",
                  root_library_path: "",
                  folder_view_mode: "cards",
                  scene_view_mode: "cards",
                  default_sort_field: "name",
                  default_sort_direction: "asc",
                  folder_card_size: 160,
                  scene_card_size: 240,
                  remember_last_path: true,
                  auto_rebuild_tree_on_start: false,
                };
                await saveStashPluginSettings(defaults);
                setPluginSettings(defaults);
                window.__SFM_DEFAULT_TRANSCODE_METHOD__ = "direct";
                try {
                  window.localStorage.removeItem("sfm_stream_mode");
                  window.localStorage.removeItem("sfm_folder_card_size");
                  window.localStorage.removeItem("sfm_scene_card_size");
                  window.localStorage.removeItem("sfm_folder_view_mode");
                  window.localStorage.removeItem("sfm_view_mode");
                } catch(e) {}
                setFolderCardSize(160);
                setSceneCardSize(240);
                setFolderViewMode("cards");
                setViewMode("grid");
                setShowSettingsModal(false);
                setNotification("✓ Settings reset to defaults");
                setTimeout(() => setNotification(""), 3500);
                handleRescan();
              }
            }),
          playingScene &&
            React.createElement(
              SafeErrorBoundary,
              { onReset: () => setPlayingScene(null) },
              React.createElement(BingeReelPlayerModal, {
                scene: playingScene,
                scenes: filteredAndSortedScenes,
                onSelectScene: (s) => setPlayingScene(s),
                onClose: () => setPlayingScene(null),
                folderName: currentFolderName,
                currentPath: currentPath,
                onNavigateToFolder: (path) => navigateToFolder(path),
              })
            )
        )
      );
    }

    // Modal Manager / View Opener with Folder Path Synchronization
    function closeWorkspace() {
      const root = document.getElementById("sfm-workspace-root");
      if (root) {
        root.style.display = "none";
      }
      if (window.location.hash.startsWith("#file-manager")) {
        window.history.pushState(null, "", window.location.pathname + window.location.search);
      }
    }

    function openFileManager(targetPath, isBrowserNav = false) {
      const path = typeof targetPath === "string" ? normalizePath(targetPath) : (getPathFromHash() !== null ? getPathFromHash() : normalizePath(localStorage.getItem("sfm_last_folder_path") || ""));
      let root = document.getElementById("sfm-workspace-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "sfm-workspace-root";
        document.body.appendChild(root);
        ReactDOM.render(React.createElement(FileManagerView, { onClose: closeWorkspace, initialPath: path }), root);
      } else {
        root.style.display = "block";
        window.dispatchEvent(new CustomEvent("sfm:set-path", { detail: { path, isBrowserNav } }));
      }

      if (!isBrowserNav) {
        const expectedHash = buildHashForPath(path);
        if (normalizePath(getPathFromHash()) !== normalizePath(path)) {
          window.history.pushState({ sfmPath: path }, "", expectedHash);
        }
      }
    }

    // Listen to hash and popstate changes
    window.addEventListener("hashchange", () => {
      const path = getPathFromHash();
      const root = document.getElementById("sfm-workspace-root");
      if (path !== null) {
        if (root) {
          root.style.display = "block";
          window.dispatchEvent(new CustomEvent("sfm:set-path", { detail: { path, isBrowserNav: true } }));
        } else {
          openFileManager(path, true);
        }
      } else {
        if (root) {
          root.style.display = "none";
        }
      }
    });

    window.addEventListener("popstate", () => {
      const path = getPathFromHash();
      const root = document.getElementById("sfm-workspace-root");
      if (path !== null) {
        if (root) {
          root.style.display = "block";
          window.dispatchEvent(new CustomEvent("sfm:set-path", { detail: { path, isBrowserNav: true } }));
        } else {
          openFileManager(path, true);
        }
      } else {
        if (root) {
          root.style.display = "none";
        }
      }
    });

    if (window.location.hash.startsWith("#file-manager")) {
      setTimeout(() => openFileManager(undefined, true), 200);
    }

    if (register && register.route) {
      register.route("/plugin/file-manager", FileManagerView);
    }

    // ==========================================================================
    // Navigation Bar Integration (Binge's Native PluginApi.patch Method)
    // Reference: https://github.com/ordureconnoisseur/binge
    // ==========================================================================
    const FOLDER_NAV_SVG_PATH = "M464 128H272l-64-64H48C21.49 64 0 85.49 0 112v288c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V176c0-26.51-21.49-48-48-48z";

    function FilesNavButton() {
      const [isActive, setIsActive] = useState(window.location.hash.startsWith("#file-manager"));

      useEffect(() => {
        const handleHash = () => {
          setIsActive(window.location.hash.startsWith("#file-manager"));
        };
        window.addEventListener("hashchange", handleHash);
        return () => window.removeEventListener("hashchange", handleHash);
      }, []);

      return React.createElement(
        "div",
        {
          className: "col-4 col-sm-3 col-md-2 col-lg-auto nav-link",
          id: "sfm-nav-container",
        },
        React.createElement(
          "a",
          {
            href: "#file-manager",
            id: "sfm-nav-button",
            title: "File Manager (Browse by Directory)",
            "aria-label": "File Manager",
            className: `minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center btn btn-primary ${isActive ? "active" : ""}`.trim(),
            onClick: function (evt) {
              evt.preventDefault();
              openFileManager();
            },
          },
          React.createElement(
            "svg",
            {
              "aria-hidden": "true",
              focusable: "false",
              className: "svg-inline--fa fa-icon nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0 mr-xl-1",
              role: "img",
              xmlns: "http://www.w3.org/2000/svg",
              viewBox: "0 0 512 512",
            },
            React.createElement("path", {
              fill: "currentColor",
              d: FOLDER_NAV_SVG_PATH,
            })
          ),
          React.createElement("span", null, "Files")
        )
      );
    }

    // Helper: recursively append a React element into the correct children container
    function appendNavChild(node, item) {
      if (!node) return item;
      if (Array.isArray(node)) {
        return node.concat(item);
      }
      if (React.isValidElement(node)) {
        const children = node.props && node.props.children;
        if (children !== undefined && children !== null) {
          if (Array.isArray(children)) {
            return React.cloneElement(node, null, ...children, item);
          }
          if (React.isValidElement(children)) {
            if (children.props && children.props.children !== undefined) {
              return React.cloneElement(node, null, appendNavChild(children, item));
            }
            return React.cloneElement(node, null, children, item);
          }
        }
        return React.cloneElement(node, null, item);
      }
      return React.createElement(React.Fragment, null, node, item);
    }

    // Method 1: Official PluginApi.patch.instead & patch.after
    if (window.PluginApi.patch) {
      try {
        if (window.PluginApi.patch.instead) {
          window.PluginApi.patch.instead("MainNavBar.MenuItems", function (props) {
            const next = arguments[arguments.length - 1];
            const res = typeof next === "function" ? next(props) : null;
            return appendNavChild(res, React.createElement(FilesNavButton, { key: "sfm-files-nav-item" }));
          });
        } else if (window.PluginApi.patch.after) {
          window.PluginApi.patch.after("MainNavBar.MenuItems", function (props, res) {
            return appendNavChild(res, React.createElement(FilesNavButton, { key: "sfm-files-nav-item" }));
          });
        }

        if (window.PluginApi.patch.before) {
          window.PluginApi.patch.before("CheckboxGroup", function (props) {
            try {
              if (!props || props.groupId !== "menu-items") return [props];
              if (!Array.isArray(props.items)) return [props];
              if (props.items.some(item => item.id === "files-manager")) return [props];
              return [Object.assign({}, props, {
                items: props.items.concat([{ id: "files-manager", headingID: "Files" }])
              })];
            } catch (err) {
              return [props];
            }
          });
        }
      } catch (err) {
        console.warn("[PathFileManager] MainNavBar.MenuItems patch failed:", err);
      }
    }

    // Method 2: Fallback DOM Injection (Ensures placement inside the .row container)
    function injectMainBarButtonFallback() {
      if (document.getElementById("sfm-nav-container") || document.getElementById("sfm-nav-button")) return;

      const anchor =
        document.querySelector('.navbar-nav a[href*="/scenes"]') ||
        document.querySelector('.navbar-nav a[href*="/images"]') ||
        document.querySelector('.navbar-nav a');

      if (!anchor) return;

      const colItem = anchor.closest("[class*='col-']") || anchor.closest(".nav-item") || anchor;
      const rowContainer = colItem.closest(".row") || colItem.parentElement;
      if (!rowContainer) return;

      const colClass = (colItem.getAttribute && colItem.getAttribute("class")) || "col-4 col-sm-3 col-md-2 col-lg-auto nav-link";

      const container = document.createElement("div");
      container.className = colClass;
      container.id = "sfm-nav-container";

      const a = document.createElement("a");
      a.href = "#file-manager";
      a.id = "sfm-nav-button";
      a.title = "File Manager (Browse by Directory)";
      a.setAttribute("aria-label", "File Manager");
      a.className = "minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center btn btn-primary";
      a.addEventListener("click", function (evt) {
        evt.preventDefault();
        openFileManager();
      });

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("role", "img");
      svg.setAttribute("viewBox", "0 0 512 512");
      svg.setAttribute("class", "svg-inline--fa fa-icon nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0 mr-xl-1");

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "currentColor");
      path.setAttribute("d", FOLDER_NAV_SVG_PATH);
      svg.appendChild(path);

      const span = document.createElement("span");
      span.textContent = "Files";

      a.appendChild(svg);
      a.appendChild(span);
      container.appendChild(a);

      rowContainer.appendChild(container);
    }

    setInterval(injectMainBarButtonFallback, 1000);
    setTimeout(injectMainBarButtonFallback, 250);

    if (window.PluginApi.Event) {
      window.PluginApi.Event.addEventListener("stash:location", () => {
        setTimeout(injectMainBarButtonFallback, 150);
      });
    }

    console.log("[PathFileManager] Initialized successfully with all enhanced features.");
  } catch (err) {
    console.error("[PathFileManager] Startup error:", err);
  }
})();

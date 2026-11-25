(function () {
  "use strict";

  try {
    if (!window.PluginApi) {
      console.warn("[PathFileManager] window.PluginApi is not ready.");
      return;
    }

    const { React, ReactDOM, register, patch, Event: ApiEvent, libraries } = window.PluginApi;
    if (!React || !ReactDOM) {
      console.warn("[PathFileManager] React or ReactDOM not found on PluginApi.");
      return;
    }

    const { useState, useEffect, useMemo, useCallback, useRef } = React;
    const safeLibraries = libraries || {};

    // Global In-Memory Singleton Cache (instant 0ms retrieval within session)
    window.__SFM_GLOBAL_CACHE__ = window.__SFM_GLOBAL_CACHE__ || {
      trie: null,
      scenes: null,
      timestamp: 0,
    };

    // Shared Module Namespace across split sfm_*.js IIFE scripts
    window.__SFM__ = window.__SFM__ || {};

    // IndexedDB Persistent Storage for Large Libraries (replaces 5MB sessionStorage limit)
    const IDB_NAME = "stash_file_manager_db";
    const IDB_VERSION = 1;
    const IDB_STORE = "library";
    const CACHE_KEY = "scenes_index_v8";
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

    async function clearCachedScenes() {
      try {
        if (window.__SFM_GLOBAL_CACHE__) {
          window.__SFM_GLOBAL_CACHE__.trie = null;
          window.__SFM_GLOBAL_CACHE__.scenes = null;
          window.__SFM_GLOBAL_CACHE__.timestamp = 0;
        }
        await idbClear();
      } catch (e) {
        console.warn("[PathFileManager] clearCachedScenes error:", e);
      }
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
        const v = values || {};
        const payload = {
          default_transcode_method: String(v.default_transcode_method || "direct"),
          fallback_transcode_method: String(v.fallback_transcode_method || "hls"),
          root_library_path: String(v.root_library_path || ""),
          folder_view_mode: String(v.folder_view_mode || "cards"),
          scene_view_mode: String(v.scene_view_mode || "cards"),
          default_sort_field: String(v.default_sort_field || "name"),
          default_sort_direction: String(v.default_sort_direction || "asc"),
          folder_card_size: Number(v.folder_card_size) || 160,
          scene_card_size: Number(v.scene_card_size) || 240,
          remember_last_path: v.remember_last_path !== false,
          auto_rebuild_tree_on_start: Boolean(v.auto_rebuild_tree_on_start),
          enable_native_scene_card_integration: v.enable_native_scene_card_integration !== false,
          enable_native_scene_detail_integration: v.enable_native_scene_detail_integration !== false,
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
              React.createElement(
                "h5",
                { className: "text-danger" },
                React.createElement(IconAlert, { size: 16, className: "mr-2 text-danger" }),
                "Video Player Error"
              ),
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

    function IconArrowDown({ size = 13, color = "currentColor", style = {} }) {
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
        React.createElement("line", { x1: "12", y1: "5", x2: "12", y2: "19" }),
        React.createElement("polyline", { points: "19 12 12 19 5 12" })
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

    function IconTag({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: `sfm-svg-icon ${className}`.trim(),
          style: { display: "inline-block", verticalAlign: "middle", ...style },
          "aria-hidden": "true",
        },
        React.createElement("path", { d: "M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" }),
        React.createElement("line", { x1: "7", y1: "7", x2: "7.01", y2: "7" })
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

    function IconCompass({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className,
          style: { display: "inline-block", verticalAlign: "middle", ...style },
        },
        React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
        React.createElement("polygon", { points: "16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" })
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

    function IconPlay({ size = 12, color = "currentColor", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: color,
          stroke: "none",
          className: "sfm-icon-play",
          style: { display: "inline-block", verticalAlign: "-1px", ...style },
        },
        React.createElement("polygon", { points: "5 3 19 12 5 21 5 3" })
      );
    }

    function IconSettings({ size = 15, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("circle", { cx: "12", cy: "12", r: "3" }),
        React.createElement("path", {
          d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
        })
      );
    }

    function IconScissors({ size = 13, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("circle", { cx: "6", cy: "6", r: "3" }),
        React.createElement("circle", { cx: "6", cy: "18", r: "3" }),
        React.createElement("line", { x1: "20", y1: "4", x2: "8.12", y2: "15.88" }),
        React.createElement("line", { x1: "14.47", y1: "14.48", x2: "20", y2: "20" }),
        React.createElement("line", { x1: "8.12", y1: "8.12", x2: "12", y2: "12" })
      );
    }

    function IconGlobe({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("circle", { cx: "12", cy: "12", r: "10" }),
        React.createElement("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
        React.createElement("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" })
      );
    }

    function IconAlert({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("path", { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }),
        React.createElement("line", { x1: "12", y1: "9", x2: "12", y2: "13" }),
        React.createElement("line", { x1: "12", y1: "17", x2: "12.01", y2: "17" })
      );
    }

    function IconCheck({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("polyline", { points: "20 6 9 17 4 12" })
      );
    }

    function IconRefresh({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("polyline", { points: "23 4 23 10 17 10" }),
        React.createElement("polyline", { points: "1 20 1 14 7 14" }),
        React.createElement("path", { d: "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" })
      );
    }

    function IconSparkles({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("path", { d: "M12 3l1.912 5.885L19.798 10.8 13.912 12.715 12 18.6l-1.912-5.885L4.202 10.8l5.886-1.915z" }),
        React.createElement("path", { d: "M5 3l.7 2.15L7.85 5.85 5.7 6.55 5 8.7 4.3 6.55 2.15 5.85 4.3 5.15z" })
      );
    }

    function IconFilm({ size = 14, color = "currentColor", style = {} }) {
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
          className: "sfm-icon-film",
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("rect", { x: "2", y: "2", width: "20", height: "20", rx: "2.18", ry: "2.18" }),
        React.createElement("line", { x1: "7", y1: "2", x2: "7", y2: "22" }),
        React.createElement("line", { x1: "17", y1: "2", x2: "17", y2: "22" }),
        React.createElement("line", { x1: "2", y1: "12", x2: "22", y2: "12" }),
        React.createElement("line", { x1: "2", y1: "7", x2: "7", y2: "7" }),
        React.createElement("line", { x1: "2", y1: "17", x2: "7", y2: "17" }),
        React.createElement("line", { x1: "17", y1: "17", x2: "22", y2: "17" }),
        React.createElement("line", { x1: "17", y1: "7", x2: "22", y2: "7" })
      );
    }

    // Additional v4.0.0 Icons
    function IconSliders({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("line", { x1: "4", y1: "21", x2: "4", y2: "14" }),
        React.createElement("line", { x1: "4", y1: "10", x2: "4", y2: "3" }),
        React.createElement("line", { x1: "12", y1: "21", x2: "12", y2: "12" }),
        React.createElement("line", { x1: "12", y1: "8", x2: "12", y2: "3" }),
        React.createElement("line", { x1: "20", y1: "21", x2: "20", y2: "16" }),
        React.createElement("line", { x1: "20", y1: "12", x2: "20", y2: "3" }),
        React.createElement("line", { x1: "1", y1: "14", x2: "7", y2: "14" }),
        React.createElement("line", { x1: "9", y1: "8", x2: "15", y2: "8" }),
        React.createElement("line", { x1: "17", y1: "16", x2: "23", y2: "16" })
      );
    }

    function IconColumns({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" }),
        React.createElement("line", { x1: "9", y1: "3", x2: "9", y2: "21" }),
        React.createElement("line", { x1: "15", y1: "3", x2: "15", y2: "21" })
      );
    }

    function IconFilter({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("polygon", { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" })
      );
    }

    function IconSortAsc({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("path", { d: "M11 5h10" }),
        React.createElement("path", { d: "M11 9h7" }),
        React.createElement("path", { d: "M11 13h4" }),
        React.createElement("path", { d: "M3 17l3 3 3-3" }),
        React.createElement("path", { d: "M6 18V4" })
      );
    }

    function IconSortDesc({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("path", { d: "M11 5h4" }),
        React.createElement("path", { d: "M11 9h7" }),
        React.createElement("path", { d: "M11 13h10" }),
        React.createElement("path", { d: "M3 7l3-3 3 3" }),
        React.createElement("path", { d: "M6 6v14" })
      );
    }

    function IconChevronUp({ size = 12, color = "currentColor", className = "", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2.4",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-1px", ...style },
        },
        React.createElement("polyline", { points: "18 15 12 9 6 15" })
      );
    }

    function IconChevronDown({ size = 12, color = "currentColor", className = "", style = {} }) {
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: color,
          strokeWidth: "2.4",
          strokeLinecap: "round",
          strokeLinejoin: "round",
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-1px", ...style },
        },
        React.createElement("polyline", { points: "6 9 12 15 18 9" })
      );
    }

    function IconPlus({ size = 13, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("line", { x1: "12", y1: "5", x2: "12", y2: "19" }),
        React.createElement("line", { x1: "5", y1: "12", x2: "19", y2: "12" })
      );
    }

    function IconCheckSquare({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("polyline", { points: "9 11 12 14 22 4" }),
        React.createElement("path", { d: "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" })
      );
    }

    function IconSquare({ size = 14, color = "currentColor", className = "", style = {} }) {
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
          className: className || undefined,
          style: { display: "inline-block", verticalAlign: "-2px", ...style },
        },
        React.createElement("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", ry: "2" })
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

    // In-memory Path Trie Data Structure with Root Rebase & Single-Child Auto-Collapsing
    class PathTrie {
      constructor(basePrefix = [], diskRoot = "") {
        this.basePrefix = basePrefix || [];
        this.diskRoot = diskRoot || "";
        this.sceneIdToFolder = new Map();
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

      getSceneFolder(sceneOrId) {
        if (!sceneOrId) return "";
        const id = typeof sceneOrId === "object" ? sceneOrId.id : sceneOrId;
        if (id && this.sceneIdToFolder && this.sceneIdToFolder.has(String(id))) {
          return this.sceneIdToFolder.get(String(id));
        }
        if (typeof sceneOrId === "object" && typeof sceneOrId._folderPath === "string" && sceneOrId._folderPath) {
          return sceneOrId._folderPath;
        }
        const filePath = typeof sceneOrId === "object" ? sceneOrId.files?.[0]?.path : null;
        if (filePath && this.basePrefix) {
          const cleanPath = filePath.replace(/\\/g, "/");
          const parts = cleanPath.split("/").filter(Boolean);
          parts.pop();
          if (parts.length >= this.basePrefix.length) {
            let match = true;
            for (let i = 0; i < this.basePrefix.length; i++) {
              if (parts[i] !== this.basePrefix[i]) {
                match = false;
                break;
              }
            }
            if (match) {
              return parts.slice(this.basePrefix.length).join("/");
            }
          }
        }
        return "";
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
              ? this.diskRoot.replace(/\/+$/, "") + "/" + accumulated
              : "/" + parts.slice(0, parts.length - relativeParts.length + i + 1).join("/");

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
        if (scene.id) {
          this.sceneIdToFolder.set(String(scene.id), curr.fullPath);
        }
      }

      rebaseSingleChildRoot() {
        const self = this;
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
                if (s.id && self && self.sceneIdToFolder) {
                  self.sceneIdToFolder.set(String(s.id), s._folderPath);
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

    function compactSceneRecord(s) {
      if (!s) return s;
      return {
        id: s.id,
        title: s.title || "",
        date: s.date || "",
        rating100: s.rating100 !== undefined && s.rating100 !== null ? s.rating100 : null,
        organized: Boolean(s.organized),
        code: s.code || "",
        details: s.details || "",
        urls: Array.isArray(s.urls) ? [...s.urls] : [],
        play_count: Number(s.play_count) || 0,
        o_counter: Number(s.o_counter) || 0,
        director: s.director || "",
        created_at: s.created_at || "",
        updated_at: s.updated_at || "",
        last_played_at: s.last_played_at || "",
        stash_ids: Array.isArray(s.stash_ids)
          ? s.stash_ids.map((sid) => ({ endpoint: sid.endpoint, stash_id: sid.stash_id }))
          : [],
        _folderPath: s._folderPath || "",
        studio: s.studio ? { id: s.studio.id, name: s.studio.name } : null,
        performers: Array.isArray(s.performers)
          ? s.performers.map((p) => ({ id: p.id, name: p.name }))
          : [],
        tags: Array.isArray(s.tags)
          ? s.tags.map((t) => ({ id: t.id, name: t.name }))
          : [],
        paths: {
          screenshot: s.paths?.screenshot || "",
          preview: s.paths?.preview || "",
          stream: s.paths?.stream || "",
        },
        files: Array.isArray(s.files)
          ? s.files.map((f) => ({
              id: f.id,
              path: f.path,
              basename: f.basename,
              size: f.size,
              duration: f.duration,
              width: f.width,
              height: f.height,
              frame_rate: f.frame_rate,
              bit_rate: f.bit_rate,
              video_codec: f.video_codec,
              format: f.format,
            }))
          : [],
      };
    }

    // ==========================================
    // High-Performance Progressive Indexing & Multi-Tier Caching Singleton (v8)
    // ==========================================
    let catalogLoadingPromise = null;
    async function ensureCatalog(forceBypassCache = false, onProgress = null) {
      if (!forceBypassCache && window.__SFM_GLOBAL_CACHE__.trie) {
        return window.__SFM_GLOBAL_CACHE__.trie;
      }
      if (catalogLoadingPromise && !forceBypassCache) {
        return catalogLoadingPromise;
      }

      catalogLoadingPromise = (async () => {
        try {
          // Tier 2: Persistent IndexedDB Cache (~50ms across tab visits / reloads)
          const cached = await idbGet(CACHE_KEY);
          if (!forceBypassCache && cached && Array.isArray(cached.scenes) && cached.scenes.length > 0) {
            if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
              const total = cached.scenes.length;
              if (typeof onProgress === "function") {
                onProgress(`Restoring ${total.toLocaleString()} scenes from local index...`);
              }
              const pluginCfg = await fetchStashPluginSettings();
              const { basePrefix, diskRoot } = resolveLibraryRoot(
                cached.scenes,
                pluginCfg.root_library_path,
                pluginCfg.__stashes__
              );
              const newTrie = new PathTrie(basePrefix, diskRoot);
              for (let i = 0; i < total; i++) {
                newTrie.insert(cached.scenes[i]);
              }
              newTrie.rebaseSingleChildRoot();

              window.__SFM_GLOBAL_CACHE__.trie = newTrie;
              window.__SFM_GLOBAL_CACHE__.scenes = cached.scenes;
              window.__SFM_GLOBAL_CACHE__.timestamp = cached.timestamp;
              return newTrie;
            }
          }

          if (typeof window === "undefined" || typeof window.fetch !== "function") {
            return null;
          }

          // Tier 3: Fresh GraphQL Library Ingestion
          if (typeof onProgress === "function") {
            onProgress("Querying library scenes via GraphQL...");
          }

          const query = `
            query GetScenePaths {
              findScenes(filter: { per_page: -1 }) {
                count
                scenes {
                  id
                  title
                  date
                  rating100
                  organized
                  code
                  details
                  urls
                  play_count
                  o_counter
                  director
                  created_at
                  updated_at
                  last_played_at
                  stash_ids { endpoint stash_id }
                  studio { id name }
                  performers { id name }
                  tags { id name }
                  paths { screenshot preview stream }
                  files { id path basename size duration width height frame_rate bit_rate video_codec format }
                }
              }
            }
          `;
          const data = await gqlFetch(query);
          const scenes = data?.findScenes?.scenes || [];
          const total = scenes.length;

          const pluginCfg = await fetchStashPluginSettings();
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
            if (typeof onProgress === "function") {
              onProgress(`Indexing file hierarchy: ${processed.toLocaleString()} / ${total.toLocaleString()} scenes...`);
            }
            await new Promise((r) => setTimeout(r, 0));
          }
          newTrie.rebaseSingleChildRoot();

          const compact = scenes.map(compactSceneRecord);

          // Align trie scene object references with compact records so in-place patches update consistently
          const compactById = new Map();
          for (let i = 0; i < compact.length; i++) {
            if (compact[i] && compact[i].id !== undefined && compact[i].id !== null) {
              compactById.set(String(compact[i].id), compact[i]);
            }
          }
          (function syncTrieRefs(node) {
            if (!node) return;
            if (Array.isArray(node.directScenes)) {
              for (let i = 0; i < node.directScenes.length; i++) {
                const raw = node.directScenes[i];
                const match = raw && raw.id !== undefined ? compactById.get(String(raw.id)) : null;
                if (match) {
                  match._folderPath = raw._folderPath || match._folderPath || "";
                  node.directScenes[i] = match;
                }
              }
            }
            if (node.folders) {
              for (const k of Object.keys(node.folders)) {
                syncTrieRefs(node.folders[k]);
              }
            }
          })(newTrie.root);

          window.__SFM_GLOBAL_CACHE__.trie = newTrie;
          window.__SFM_GLOBAL_CACHE__.scenes = compact;
          window.__SFM_GLOBAL_CACHE__.timestamp = Date.now();

          await idbSet(CACHE_KEY, {
            timestamp: window.__SFM_GLOBAL_CACHE__.timestamp,
            scenes: compact,
          });

          return newTrie;
        } catch (err) {
          console.warn("[PathFileManager] ensureCatalog error:", err);
          return null;
        } finally {
          catalogLoadingPromise = null;
        }
      })();

      return catalogLoadingPromise;
    }

    // In-place scene patcher: updates global scenes array + PathTrie node entries + persists to IDB asynchronously
    function patchCatalogSceneInPlace(updatedScene) {
      if (!updatedScene || updatedScene.id === undefined || updatedScene.id === null) return null;
      const targetId = String(updatedScene.id);
      const cache = window.__SFM_GLOBAL_CACHE__;
      if (!cache) return null;

      let mergedScene = null;

      if (Array.isArray(cache.scenes)) {
        const idx = cache.scenes.findIndex((s) => s && String(s.id) === targetId);
        if (idx !== -1) {
          const existing = cache.scenes[idx];
          mergedScene = {
            ...existing,
            ...updatedScene,
            _folderPath: updatedScene._folderPath !== undefined ? updatedScene._folderPath : existing._folderPath,
            paths: updatedScene.paths ? { ...(existing.paths || {}), ...updatedScene.paths } : existing.paths,
            files: Array.isArray(updatedScene.files) ? updatedScene.files : existing.files,
          };
          cache.scenes[idx] = mergedScene;
        }
      }

      if (cache.trie && cache.trie.root) {
        const updateNodeScenes = (node) => {
          if (!node) return false;
          if (Array.isArray(node.directScenes)) {
            for (let i = 0; i < node.directScenes.length; i++) {
              const s = node.directScenes[i];
              if (s && String(s.id) === targetId) {
                if (!mergedScene) {
                  mergedScene = {
                    ...s,
                    ...updatedScene,
                    _folderPath: updatedScene._folderPath !== undefined ? updatedScene._folderPath : s._folderPath,
                    paths: updatedScene.paths ? { ...(s.paths || {}), ...updatedScene.paths } : s.paths,
                    files: Array.isArray(updatedScene.files) ? updatedScene.files : s.files,
                  };
                }
                node.directScenes[i] = mergedScene;
                return true;
              }
            }
          }
          if (node.folders) {
            for (const key of Object.keys(node.folders)) {
              if (updateNodeScenes(node.folders[key])) return true;
            }
          }
          return false;
        };

        // Fast path via trie folder map, with full traversal fallback
        let patchedInTrie = false;
        if (typeof cache.trie.getSceneFolder === "function" && typeof cache.trie.getNode === "function") {
          const folderPath = cache.trie.getSceneFolder(targetId);
          const targetNode = cache.trie.getNode(folderPath);
          if (targetNode && Array.isArray(targetNode.directScenes)) {
            for (let i = 0; i < targetNode.directScenes.length; i++) {
              const s = targetNode.directScenes[i];
              if (s && String(s.id) === targetId) {
                if (!mergedScene) {
                  mergedScene = {
                    ...s,
                    ...updatedScene,
                    _folderPath: updatedScene._folderPath !== undefined ? updatedScene._folderPath : s._folderPath,
                    paths: updatedScene.paths ? { ...(s.paths || {}), ...updatedScene.paths } : s.paths,
                    files: Array.isArray(updatedScene.files) ? updatedScene.files : s.files,
                  };
                }
                targetNode.directScenes[i] = mergedScene;
                patchedInTrie = true;
                break;
              }
            }
          }
        }
        if (!patchedInTrie) {
          updateNodeScenes(cache.trie.root);
        }
      }

      if (!mergedScene) {
        mergedScene = { ...updatedScene };
      }

      const savePromise = Array.isArray(cache.scenes)
        ? Promise.resolve(
            idbSet(CACHE_KEY, {
              timestamp: cache.timestamp || Date.now(),
              scenes: cache.scenes,
            })
          ).catch(() => {})
        : Promise.resolve();

      const ret = savePromise.then(() => mergedScene);
      Object.assign(ret, mergedScene);
      return ret;
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

    // Helper: derive clean directory path from file path
    function deriveFolderFromPath(filePath) {
      if (!filePath) return "";
      const clean = filePath.replace(/\\/g, "/");
      const parts = clean.split("/").filter(Boolean);
      parts.pop(); // remove file basename

      const trie = window.__SFM_GLOBAL_CACHE__?.trie;
      if (trie?.basePrefix && trie.basePrefix.length > 0) {
        if (parts.length >= trie.basePrefix.length) {
          let match = true;
          for (let i = 0; i < trie.basePrefix.length; i++) {
            if (parts[i] !== trie.basePrefix[i]) {
              match = false;
              break;
            }
          }
          if (match) {
            return parts.slice(trie.basePrefix.length).join("/");
          }
        }
      }
      return parts.join("/");
    }

    function resolveSceneFolder(sceneOrId, trieInstance = null) {
      if (!sceneOrId) return "";
      const trie = trieInstance || window.__SFM_GLOBAL_CACHE__?.trie;
      if (trie && typeof trie.getSceneFolder === "function") {
        const found = trie.getSceneFolder(sceneOrId);
        if (found !== undefined && found !== null && found !== "") {
          return found;
        }
      }
      if (typeof sceneOrId === "object") {
        if (typeof sceneOrId._folderPath === "string" && sceneOrId._folderPath !== "") {
          return sceneOrId._folderPath;
        }
        const filePath = sceneOrId.files?.[0]?.path;
        if (filePath) {
          const derived = deriveFolderFromPath(filePath);
          if (derived) {
            if (Object.isExtensible(sceneOrId)) {
              sceneOrId._folderPath = derived;
            }
            return derived;
          }
        }
      } else if (typeof sceneOrId === "string" || typeof sceneOrId === "number") {
        const cached = window.__SFM_GLOBAL_CACHE__?.scenes?.find((s) => String(s.id) === String(sceneOrId));
        if (cached) return resolveSceneFolder(cached, trieInstance);
      }
      return "";
    }

    // ==========================================
    // R1: URL Query & Route Navigation Helpers
    // ==========================================
    function normalizePath(p) {
      if (!p) return "";
      try {
        return decodeURIComponent(p).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      } catch (e) {
        return String(p).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      }
    }

    function buildRouteUrlForPath(path, view = null, sceneId = null) {
      const params = new URLSearchParams();
      const normPath = normalizePath(path || "");
      if (normPath) params.set("path", normPath);
      if (view) params.set("view", String(view));
      if (sceneId !== null && sceneId !== undefined && sceneId !== "") {
        params.set("scene", String(sceneId));
      }
      const qs = params.toString();
      return qs ? `/plugin/file-manager?${qs}` : "/plugin/file-manager";
    }

    function buildHashForPath(path, view = null, sceneId = null) {
      const params = new URLSearchParams();
      const normPath = normalizePath(path || "");
      if (normPath) params.set("path", normPath);
      if (view) params.set("view", String(view));
      if (sceneId !== null && sceneId !== undefined && sceneId !== "") {
        params.set("scene", String(sceneId));
      }
      const qs = params.toString();
      return qs ? `#file-manager?${qs}` : "#file-manager";
    }

    function parseLegacyHashState() {
      const hash = window.location?.hash || "";
      if (!hash.startsWith("#file-manager")) return null;
      const qIdx = hash.indexOf("?");
      if (qIdx !== -1) {
        const params = new URLSearchParams(hash.slice(qIdx + 1));
        return {
          path: normalizePath(params.get("path") || ""),
          view: params.get("view") || null,
          sceneId: params.get("scene") || null,
        };
      }
      if (hash.startsWith("#file-manager/")) {
        return {
          path: normalizePath(hash.slice("#file-manager/".length) || ""),
          view: null,
          sceneId: null,
        };
      }
      return { path: "", view: null, sceneId: null };
    }

    function parseQueryState(searchStr) {
      const raw = typeof searchStr === "string" ? searchStr : (window.location?.search || "");
      let queryPart = raw;
      const qIdx = raw.indexOf("?");
      if (qIdx !== -1) {
        queryPart = raw.slice(qIdx + 1);
      } else if (queryPart.startsWith("?")) {
        queryPart = queryPart.slice(1);
      }

      const params = new URLSearchParams(queryPart);
      let path = normalizePath(params.get("path") || "");
      let view = params.get("view") || null;
      let sceneId = params.get("scene") || null;

      // Graceful fallback to legacy #file-manager?path=... hash params when query has no path
      if (!path && window.location?.hash && window.location.hash.startsWith("#file-manager")) {
        const legacy = parseLegacyHashState();
        if (legacy) {
          if (legacy.path) path = legacy.path;
          if (!view && legacy.view) view = legacy.view;
          if (!sceneId && legacy.sceneId) sceneId = legacy.sceneId;
        }
      }

      return { path, view, sceneId };
    }

    function parseHashState() {
      const legacy = parseLegacyHashState();
      if (legacy) return legacy;
      if (window.location?.pathname && window.location.pathname.startsWith("/plugin/file-manager")) {
        return parseQueryState(window.location.search || "");
      }
      return null;
    }

    function getPathFromHash() {
      const state = parseHashState();
      return state ? state.path : null;
    }

    function getNextSfmDepth() {
      const cur =
        window.history && window.history.state && typeof window.history.state.sfmDepth === "number"
          ? window.history.state.sfmDepth
          : 1;
      return cur + 1;
    }

    function navigateToPluginRoute(url, replace = false) {
      const targetUrl = url && typeof url === "string" ? url : "/plugin/file-manager";
      const nextState = { sfmDepth: getNextSfmDepth() };
      if (window.history) {
        if (replace && typeof window.history.replaceState === "function") {
          window.history.replaceState(nextState, "", targetUrl);
        } else if (typeof window.history.pushState === "function") {
          window.history.pushState(nextState, "", targetUrl);
        }
      }
      if (typeof window.dispatchEvent === "function") {
        let evt = null;
        if (typeof PopStateEvent === "function") {
          evt = new PopStateEvent("popstate", { state: nextState });
        } else if (typeof window.PopStateEvent === "function") {
          evt = new window.PopStateEvent("popstate", { state: nextState });
        } else if (typeof Event === "function") {
          evt = new Event("popstate");
        } else if (typeof window.CustomEvent === "function") {
          evt = new window.CustomEvent("popstate", { detail: nextState });
        } else {
          evt = { type: "popstate", state: nextState };
        }
        window.dispatchEvent(evt);
      }
      return targetUrl;
    }

    // ==========================================
    // R3/R4: Shared Deterministic Shuffle, Sort & Attribute Filter Helpers
    // ==========================================
    function hashSeedToUint32(seed) {
      const str = String(seed === undefined || seed === null ? "1" : seed);
      let h = 2166136261 >>> 0;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      h ^= h >>> 16;
      h = Math.imul(h, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      return h >>> 0;
    }

    function mulberry32(seedInt) {
      let t = seedInt >>> 0;
      return function () {
        t = (t + 0x6d2b79f5) | 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
      };
    }

    function createShuffledQueue(items, currentItem = null, seed = null) {
      if (!Array.isArray(items) || items.length === 0) {
        return Array.isArray(items) ? items : [];
      }
      if (items.length === 1) {
        return [...items];
      }
      const currentId = currentItem && currentItem.id !== undefined ? String(currentItem.id) : null;
      const others = currentItem
        ? items.filter((s) => (currentId !== null && s?.id !== undefined ? String(s.id) !== currentId : s !== currentItem))
        : [...items];

      const rng =
        seed !== undefined && seed !== null
          ? mulberry32(hashSeedToUint32(`${seed}:${currentId || ""}`))
          : Math.random;

      for (let i = others.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const temp = others[i];
        others[i] = others[j];
        others[j] = temp;
      }
      return currentItem ? [currentItem, ...others] : others;
    }

    function getSceneSortKeyStr(s) {
      return String(s?.id ?? s?.files?.[0]?.path ?? s?.files?.[0]?.basename ?? s?.title ?? "");
    }

    const SCENE_SORT_OPTIONS = [
      { value: "title", label: "Title", defaultDir: "asc" },
      { value: "filename", label: "Filename", defaultDir: "asc" },
      { value: "date", label: "Date", defaultDir: "desc" },
      { value: "studio", label: "Studio", defaultDir: "asc" },
      { value: "code", label: "Code", defaultDir: "asc" },
      { value: "performers", label: "Performers", defaultDir: "asc" },
      { value: "organized", label: "Organized", defaultDir: "desc" },
      { value: "rating", label: "Rating", defaultDir: "desc" },
      { value: "duration", label: "Duration", defaultDir: "desc" },
      { value: "size", label: "Size", defaultDir: "desc" },
      { value: "resolution", label: "Resolution", defaultDir: "desc" },
      { value: "play_count", label: "Play Count", defaultDir: "desc" },
      { value: "o_counter", label: "O-Counter", defaultDir: "desc" },
      { value: "created_at", label: "Created", defaultDir: "desc" },
      { value: "updated_at", label: "Updated", defaultDir: "desc" },
      { value: "last_played_at", label: "Last Played", defaultDir: "desc" },
      { value: "director", label: "Director", defaultDir: "asc" },
      { value: "tags", label: "Tags", defaultDir: "asc" },
      { value: "bitrate", label: "Bitrate", defaultDir: "desc" },
      { value: "random", label: "Random", defaultDir: null },
    ];

    const DEFAULT_SORT_DIR_MAP = {
      title: "asc",
      filename: "asc",
      date: "desc",
      studio: "asc",
      code: "asc",
      performers: "asc",
      organized: "desc",
      rating: "desc",
      duration: "desc",
      size: "desc",
      resolution: "desc",
      play_count: "desc",
      o_counter: "desc",
      created_at: "desc",
      updated_at: "desc",
      last_played_at: "desc",
      director: "asc",
      tags: "asc",
      bitrate: "desc",
    };

    function sortScenesWithOrder(scenes, sortKey = "title_asc", shuffleSeed = 1) {
      if (!Array.isArray(scenes) || scenes.length === 0) return Array.isArray(scenes) ? scenes : [];
      const list = [...scenes];

      let effectiveSortKey = sortKey || "title_asc";
      if (effectiveSortKey !== "random" && !effectiveSortKey.endsWith("_asc") && !effectiveSortKey.endsWith("_desc")) {
        const defaultDir = DEFAULT_SORT_DIR_MAP[effectiveSortKey] || "asc";
        effectiveSortKey = `${effectiveSortKey}_${defaultDir}`;
      }

      if (effectiveSortKey === "random") {
        // Canonicalize by scene identity first so re-renders produce identical order regardless of input order
        list.sort((a, b) => getSceneSortKeyStr(a).localeCompare(getSceneSortKeyStr(b)));
        const idSignature = list.map((s) => getSceneSortKeyStr(s)).join("|");
        const rng = mulberry32(hashSeedToUint32(`${shuffleSeed ?? 1}::${list.length}::${idSignature}`));
        rng();
        rng();
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          const tmp = list[i];
          list[i] = list[j];
          list[j] = tmp;
        }
        return list;
      }

      const strTitle = (s) => String(s?.title || s?.files?.[0]?.basename || "");
      const strFilename = (s) => String(s?.files?.[0]?.basename || s?.files?.[0]?.path || s?.title || "");
      const strDate = (s) => String(s?.date || "");
      const strStudio = (s) => String(s?.studio?.name || "");
      const strCode = (s) => String(s?.code || "");
      const strDirector = (s) => String(s?.director || "");
      const strPerformers = (s) =>
        Array.isArray(s?.performers)
          ? s.performers.map((p) => p?.name || "").filter(Boolean).join(", ")
          : "";
      const strTags = (s) =>
        Array.isArray(s?.tags)
          ? s.tags.map((t) => t?.name || "").filter(Boolean).join(", ")
          : "";
      const numResolution = (s) =>
        (Number(s?.files?.[0]?.height) || 0) * 100000 + (Number(s?.files?.[0]?.width) || 0);

      list.sort((a, b) => {
        switch (effectiveSortKey) {
          case "title_desc":
            return strTitle(b).localeCompare(strTitle(a));
          case "title_asc":
            return strTitle(a).localeCompare(strTitle(b));
          case "filename_asc":
            return strFilename(a).localeCompare(strFilename(b));
          case "filename_desc":
            return strFilename(b).localeCompare(strFilename(a));
          case "date_desc":
            return strDate(b).localeCompare(strDate(a));
          case "date_asc":
            return strDate(a).localeCompare(strDate(b));
          case "rating_desc":
            return (Number(b?.rating100) || 0) - (Number(a?.rating100) || 0);
          case "rating_asc":
            return (Number(a?.rating100) || 0) - (Number(b?.rating100) || 0);
          case "duration_desc":
            return (Number(b?.files?.[0]?.duration) || 0) - (Number(a?.files?.[0]?.duration) || 0);
          case "duration_asc":
            return (Number(a?.files?.[0]?.duration) || 0) - (Number(b?.files?.[0]?.duration) || 0);
          case "size_desc":
            return (Number(b?.files?.[0]?.size) || 0) - (Number(a?.files?.[0]?.size) || 0);
          case "size_asc":
            return (Number(a?.files?.[0]?.size) || 0) - (Number(b?.files?.[0]?.size) || 0);
          case "studio_asc":
            return strStudio(a).localeCompare(strStudio(b));
          case "studio_desc":
            return strStudio(b).localeCompare(strStudio(a));
          case "code_asc":
            return strCode(a).localeCompare(strCode(b));
          case "code_desc":
            return strCode(b).localeCompare(strCode(a));
          case "organized_desc":
            return (b?.organized ? 1 : 0) - (a?.organized ? 1 : 0);
          case "organized_asc":
            return (a?.organized ? 1 : 0) - (b?.organized ? 1 : 0);
          case "play_count_desc":
            return (Number(b?.play_count) || 0) - (Number(a?.play_count) || 0);
          case "play_count_asc":
            return (Number(a?.play_count) || 0) - (Number(b?.play_count) || 0);
          case "o_counter_desc":
            return (Number(b?.o_counter) || 0) - (Number(a?.o_counter) || 0);
          case "o_counter_asc":
            return (Number(a?.o_counter) || 0) - (Number(b?.o_counter) || 0);
          case "created_at_desc":
            return String(b?.created_at || "").localeCompare(String(a?.created_at || ""));
          case "created_at_asc":
            return String(a?.created_at || "").localeCompare(String(b?.created_at || ""));
          case "updated_at_desc":
            return String(b?.updated_at || "").localeCompare(String(a?.updated_at || ""));
          case "updated_at_asc":
            return String(a?.updated_at || "").localeCompare(String(b?.updated_at || ""));
          case "last_played_at_desc":
            return String(b?.last_played_at || "").localeCompare(String(a?.last_played_at || ""));
          case "last_played_at_asc":
            return String(a?.last_played_at || "").localeCompare(String(b?.last_played_at || ""));
          case "resolution_desc":
            return numResolution(b) - numResolution(a);
          case "resolution_asc":
            return numResolution(a) - numResolution(b);
          case "performers_asc":
            return strPerformers(a).localeCompare(strPerformers(b));
          case "performers_desc":
            return strPerformers(b).localeCompare(strPerformers(a));
          case "director_asc":
            return strDirector(a).localeCompare(strDirector(b));
          case "director_desc":
            return strDirector(b).localeCompare(strDirector(a));
          case "tags_asc":
            return strTags(a).localeCompare(strTags(b));
          case "tags_desc":
            return strTags(b).localeCompare(strTags(a));
          case "bitrate_desc":
            return (Number(b?.files?.[0]?.bit_rate) || 0) - (Number(a?.files?.[0]?.bit_rate) || 0);
          case "bitrate_asc":
            return (Number(a?.files?.[0]?.bit_rate) || 0) - (Number(b?.files?.[0]?.bit_rate) || 0);
          case "fps_desc":
            return (Number(b?.files?.[0]?.frame_rate) || 0) - (Number(a?.files?.[0]?.frame_rate) || 0);
          case "fps_asc":
            return (Number(a?.files?.[0]?.frame_rate) || 0) - (Number(b?.files?.[0]?.frame_rate) || 0);
          default:
            return strTitle(a).localeCompare(strTitle(b));
        }
      });

      return list;
    }

    function isSceneFieldMissing(scene, field) {
      if (!scene) return true;
      switch (field) {
        case "title":
          return !scene.title || !String(scene.title).trim();
        case "studio":
          return !scene.studio || (!scene.studio.id && !scene.studio.name);
        case "performers":
          return !Array.isArray(scene.performers) || scene.performers.length === 0;
        case "date":
          return !scene.date || !String(scene.date).trim();
        case "code":
          return !scene.code || !String(scene.code).trim();
        case "tags":
          return !Array.isArray(scene.tags) || scene.tags.length === 0;
        case "cover":
          return !scene.paths || !scene.paths.screenshot || !String(scene.paths.screenshot).trim();
        default:
          return false;
      }
    }

    function matchesSceneFilters(scene, filters = {}) {
      if (!scene) return false;
      if (!filters || typeof filters !== "object") return true;

      // 1. Quick text search across attributes
      const q = typeof filters.searchQuery === "string" ? filters.searchQuery.trim().toLowerCase() : "";
      if (q) {
        const title = String(scene.title || "").toLowerCase();
        const basename = String(scene.files?.[0]?.basename || "").toLowerCase();
        const code = String(scene.code || "").toLowerCase();
        const studio = String(scene.studio?.name || "").toLowerCase();
        const performers = Array.isArray(scene.performers)
          ? scene.performers.map((p) => String(p?.name || "").toLowerCase()).join(" ")
          : "";
        const tags = Array.isArray(scene.tags)
          ? scene.tags.map((t) => String(t?.name || "").toLowerCase()).join(" ")
          : "";
        const director = String(scene.director || "").toLowerCase();
        const folderPath = String(scene._folderPath || resolveSceneFolder(scene) || "").toLowerCase();

        if (
          !title.includes(q) &&
          !basename.includes(q) &&
          !code.includes(q) &&
          !studio.includes(q) &&
          !performers.includes(q) &&
          !tags.includes(q) &&
          !director.includes(q) &&
          !folderPath.includes(q)
        ) {
          return false;
        }
      }

      // 2. Organized status filter
      const orgFilter = filters.organizedFilter || "all";
      if (orgFilter === "organized" && !scene.organized) return false;
      if (orgFilter === "unorganized" && Boolean(scene.organized)) return false;

      // 3. Missing fields filter
      const missingFields = Array.isArray(filters.missingFields) ? filters.missingFields : [];
      if (missingFields.length > 0) {
        const matchFn =
          filters.missingMode === "any"
            ? missingFields.some((f) => isSceneFieldMissing(scene, f))
            : missingFields.every((f) => isSceneFieldMissing(scene, f));
        if (!matchFn) return false;
      }

      // 4. Resolution tier filter
      const resFilter = String(filters.resolutionFilter || "all").toLowerCase();
      if (resFilter !== "all") {
        const height = Number(scene.files?.[0]?.height) || 0;
        if (resFilter === "4k" && height < 2160) return false;
        if (resFilter === "1440p" && (height < 1440 || height >= 2160)) return false;
        if (resFilter === "1080p" && (height < 1080 || height >= 1440)) return false;
        if (resFilter === "720p" && (height < 720 || height >= 1080)) return false;
        if (resFilter === "sd" && (height <= 0 || height >= 720)) return false;
      }

      // 5. Minimum rating filter (0..100)
      const minRating = Number(filters.minRating) || 0;
      if (minRating > 0) {
        const rating = Number(scene.rating100) || 0;
        if (rating < minRating) return false;
      }

      return true;
    }

    // Export shared symbols onto window.__SFM__
    Object.assign(window.__SFM__, {
      PluginApi: window.PluginApi,
      React,
      ReactDOM,
      register,
      patch,
      Event: ApiEvent,
      libraries: safeLibraries,
      useState,
      useEffect,
      useMemo,
      useCallback,
      useRef,

      IDB_NAME,
      IDB_VERSION,
      IDB_STORE,
      CACHE_KEY,
      CACHE_TTL_MS,
      openIDB,
      idbGet,
      idbSet,
      idbClear,
      clearCachedScenes,
      patchCatalogSceneInPlace,

      gqlFetch,
      fetchStashPluginSettings,
      saveStashPluginSettings,

      formatBytes,
      formatDuration,
      formatSeconds,
      SafeErrorBoundary,

      icons: {
        IconHome,
        IconArrowLeft,
        IconArrowUp,
        IconArrowDown,
        IconFolder,
        IconTag,
        IconFolderCard,
        IconZoom,
        IconSmartphone,
        IconShuffle,
        IconCompass,
        IconWidth,
        IconScan,
        IconGrid,
        IconGear,
        IconSearch,
        IconEdit,
        IconX,
        IconPlay,
        IconSettings,
        IconScissors,
        IconGlobe,
        IconAlert,
        IconCheck,
        IconRefresh,
        IconSparkles,
        IconFilm,
        IconSliders,
        IconColumns,
        IconFilter,
        IconSortAsc,
        IconSortDesc,
        IconChevronUp,
        IconChevronDown,
        IconPlus,
        IconCheckSquare,
        IconSquare,
      },

      resolveLibraryRoot,
      PathTrie,
      ensureCatalog,
      getAllDescendantScenes,
      deriveFolderFromPath,
      resolveSceneFolder,

      normalizePath,
      buildRouteUrlForPath,
      parseQueryState,
      navigateToPluginRoute,
      buildHashForPath,
      parseHashState,
      getPathFromHash,
      getNextSfmDepth,

      createShuffledQueue,
      sortScenesWithOrder,
      matchesSceneFilters,
      SCENE_SORT_OPTIONS,
      DEFAULT_SORT_DIR_MAP,
    });
  } catch (err) {
    console.error("[PathFileManager] Critical error in sfm_core.js:", err);
  }
})();

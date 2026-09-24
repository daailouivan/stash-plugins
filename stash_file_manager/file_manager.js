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
    const CACHE_KEY = "scenes_index_v3";
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
            plugins
          }
        }`);
        return data?.configuration?.plugins?.stash_file_manager || {};
      } catch (e) {
        return {};
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

    function IconScan({ size = 13, color = "currentColor" }) {
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
          style: { display: "inline-block", verticalAlign: "-2px", marginRight: "5px" },
        },
        React.createElement("circle", { cx: "12", cy: "12", r: "2", fill: "currentColor" }),
        React.createElement("path", { d: "M16.24 7.76a6 6 0 0 1 0 8.49m-8.48 0a6 6 0 0 1 0-8.49m11.31-2.83a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" })
      );
    }

    function IconGrid({ size = 13, color = "currentColor" }) {
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
          style: { display: "inline-block", verticalAlign: "-2px", marginRight: "5px" },
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

    // In-memory Path Trie Data Structure (Feature 5)
    class PathTrie {
      constructor() {
        this.root = {
          name: "Stash",
          fullPath: "",
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

        let accumulated = "";
        for (const segment of parts) {
          accumulated = accumulated ? `${accumulated}/${segment}` : segment;
          if (!curr.folders[segment]) {
            curr.folders[segment] = {
              name: segment,
              fullPath: accumulated,
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
    function BingeReelPlayerModal({ scene, scenes = [], onSelectScene, onClose, folderName, currentPath }) {
      const videoRef = useRef(null);
      const videoContainerRef = useRef(null);
      const hlsInstanceRef = useRef(null);
      const hideTimeoutRef = useRef(null);
      const [isVideoReady, setIsVideoReady] = useState(false);

      // 1. Scene Navigation & Previews (Sliding Window ±2 for Multi-Video Swiping)
      const currentIndex = useMemo(() => {
        return scenes.findIndex((s) => s.id === scene?.id);
      }, [scenes, scene?.id]);

      const totalScenes = scenes.length;
      const hasPrev = currentIndex > 0;
      const hasPrev2 = currentIndex > 1;
      const hasNext = currentIndex !== -1 && currentIndex < totalScenes - 1;
      const hasNext2 = currentIndex !== -1 && currentIndex < totalScenes - 2;

      const prev2Scene = hasPrev2 ? scenes[currentIndex - 2] : null;
      const prevScene = hasPrev ? scenes[currentIndex - 1] : null;
      const nextScene = hasNext ? scenes[currentIndex + 1] : null;
      const next2Scene = hasNext2 ? scenes[currentIndex + 2] : null;

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
          }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
      }, [onClose, goToNext, goToPrev, handleTogglePlay, duration, isPipMode]);

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
              className: `sfm-reel-modal-dialog ${isPipMode ? "sfm-pip-dialog-detached" : ""}`,
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
                  { className: "sfm-reel-counter-badge", title: `Folder: ${folderName || "Current"}` },
                  `${currentIndex + 1}/${totalScenes}`
                ),
                // 8. Next Video Button
                React.createElement(
                  "button",
                  {
                    className: "sfm-reel-circle-btn",
                    onClick: goToNext,
                    disabled: !hasNext,
                    title: hasNext ? `Next: ${nextScene?.title || `Scene #${nextScene?.id}`}` : "Last scene in folder",
                  },
                  React.createElement(
                    "svg",
                    { viewBox: "0 0 24 24", width: 16, height: 16, stroke: "currentColor", strokeWidth: "2.5", fill: "none" },
                    React.createElement("polyline", { points: "6 9 12 15 18 9" })
                  )
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
    function FilenameParserModal({ currentFolder, directScenes, onClose, onApplied }) {
      const PRESETS = [
        { label: "Date & Title: ^(?<date>\\d{4}-\\d{2}-\\d{2})\\s+(?<title>.+)$", pattern: "^(?<date>\\d{4}-\\d{2}-\\d{2})\\s+(?<title>.+)$" },
        { label: "Studio - Title: ^(?<studio>[^-]+)\\s*-\\s*(?<title>.+)$", pattern: "^(?<studio>[^-]+)\\s*-\\s*(?<title>.+)$" },
        { label: "Studio - Date - Title: ^(?<studio>[^-]+)\\s*-\\s*(?<date>\\d{4}-\\d{2}-\\d{2})\\s*-\\s*(?<title>.+)$", pattern: "^(?<studio>[^-]+)\\s*-\\s*(?<date>\\d{4}-\\d{2}-\\d{2})\\s*-\\s*(?<title>.+)$" },
        { label: "Studio - Performer - Title: ^(?<studio>[^-]+)\\s*-\\s*(?<performers>[^-]+)\\s*-\\s*(?<title>.+)$", pattern: "^(?<studio>[^-]+)\\s*-\\s*(?<performers>[^-]+)\\s*-\\s*(?<title>.+)$" },
      ];

      const [pattern, setPattern] = useState(PRESETS[0].pattern);
      const [caseInsensitive, setCaseInsensitive] = useState(true);
      const [isExecuting, setIsExecuting] = useState(false);
      const [progressText, setProgressText] = useState("");

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
          // Strip extension
          const nameWithoutExt = rawBasename.replace(/\\.[^/.]+$/, "");
          const match = re.exec(nameWithoutExt);

          if (!match || !match.groups) {
            return { scene, rawBasename, matched: false, groups: {} };
          }
          return { scene, rawBasename, matched: true, groups: match.groups };
        });

        return { error: null, items };
      }, [pattern, caseInsensitive, directScenes]);

      const matchedCount = parsedResults.items.filter((i) => i.matched).length;

      const handleExecute = async () => {
        if (matchedCount === 0) return;
        setIsExecuting(true);
        setProgressText(`Starting updates for ${matchedCount} scenes...`);

        try {
          const matchedItems = parsedResults.items.filter((i) => i.matched);
          let success = 0;

          for (let i = 0; i < matchedItems.length; i++) {
            const item = matchedItems[i];
            setProgressText(`Updating scene ${i + 1}/${matchedItems.length}: ${item.rawBasename}...`);

            const updateInput = { id: item.scene.id };
            const { title, date, studio, performers } = item.groups;

            if (title) updateInput.title = title.trim();
            if (date && /^\\d{4}-\\d{2}-\\d{2}$/.test(date.trim())) updateInput.date = date.trim();

            if (studio && studio.trim()) {
              const sRes = await gqlFetch(
                `query FindStudio($name: String!) {
                  findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
                    studios { id name }
                  }
                }`,
                { name: studio.trim() }
              );
              const found = sRes?.findStudios?.studios?.[0];
              if (found) updateInput.studio_id = found.id;
            }

            if (performers && performers.trim()) {
              const pNames = performers.split(/,|&|\\band\\b/i).map((s) => s.trim()).filter(Boolean);
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

          setProgressText(`Successfully updated ${success} scenes from filenames!`);
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
          { className: "sfm-modal-dialog sfm-modal-dialog-large", onClick: (e) => e.stopPropagation() },
          React.createElement(
            "div",
            { className: "sfm-modal-header" },
            React.createElement("h5", { className: "mb-0" }, `🔍 Filename Parser: "${currentFolder}"`),
            React.createElement("button", { className: "close text-light", onClick: onClose }, "×")
          ),
          React.createElement(
            "div",
            { className: "sfm-modal-body" },
            React.createElement("p", { className: "text-muted small mb-3" },
              "Extract Title, Date, Studio, or Performers from filenames in this folder using named capture groups (?<title>...), (?<date>...), (?<studio>...), (?<performers>...)."
            ),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Preset Patterns"),
              React.createElement(
                "select",
                {
                  className: "form-control form-control-sm bg-dark text-light border-secondary",
                  onChange: (e) => setPattern(e.target.value),
                },
                PRESETS.map((p) => React.createElement("option", { key: p.pattern, value: p.pattern }, p.label))
              )
            ),
            React.createElement(
              "div",
              { className: "form-group mb-3" },
              React.createElement("label", { className: "small font-weight-bold" }, "Regular Expression"),
              React.createElement("input", {
                type: "text",
                className: "form-control bg-dark text-light border-secondary",
                value: pattern,
                onChange: (e) => setPattern(e.target.value),
              }),
              React.createElement(
                "div",
                { className: "mt-1 d-flex align-items-center gap-2 small text-muted" },
                React.createElement("input", {
                  type: "checkbox",
                  id: "sfm-case-sens",
                  checked: caseInsensitive,
                  onChange: (e) => setCaseInsensitive(e.target.checked),
                }),
                React.createElement("label", { htmlFor: "sfm-case-sens", className: "mb-0 cursor-pointer" }, "Case insensitive (?i)")
              )
            ),
            parsedResults.error &&
              React.createElement("div", { className: "alert alert-danger py-2 px-3 small" }, `Regex Error: ${parsedResults.error}`),
            React.createElement(
              "div",
              { className: "d-flex justify-content-between align-items-center mb-2" },
              React.createElement("h6", { className: "small font-weight-bold text-muted mb-0" }, "LIVE MATCH PREVIEW"),
              React.createElement("span", { className: "badge badge-info" }, `${matchedCount} of ${directScenes.length} files matched`)
            ),
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
                    React.createElement("th", null, "Filename"),
                    React.createElement("th", null, "Extracted Title"),
                    React.createElement("th", null, "Date"),
                    React.createElement("th", null, "Studio"),
                    React.createElement("th", null, "Performers"),
                    React.createElement("th", null, "Status")
                  )
                ),
                React.createElement(
                  "tbody",
                  null,
                  parsedResults.items.map((item) =>
                    React.createElement(
                      "tr",
                      { key: item.scene.id },
                      React.createElement("td", { className: "text-truncate", style: { maxWidth: "220px" }, title: item.rawBasename }, item.rawBasename),
                      React.createElement("td", { className: "text-info font-weight-bold" }, item.groups.title || "—"),
                      React.createElement("td", null, item.groups.date || "—"),
                      React.createElement("td", null, item.groups.studio || "—"),
                      React.createElement("td", null, item.groups.performers || "—"),
                      React.createElement(
                        "td",
                        null,
                        item.matched
                          ? React.createElement("span", { className: "badge badge-success" }, "Matched")
                          : React.createElement("span", { className: "badge badge-secondary" }, "No Match")
                      )
                    )
                  )
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
                className: "btn btn-primary btn-sm",
                disabled: isExecuting || matchedCount === 0,
                onClick: handleExecute,
              },
              isExecuting ? "Executing Updates..." : `Apply to ${matchedCount} Matched Scenes`
            )
          )
        )
      );
    }

    // ==========================================
    // Modal: Expanded Batch Metadata (Feature 4)
    // ==========================================
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
                  React.createElement("option", { value: "table" }, "Table (Metadata Columns)")
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
            setViewMode(cfg.scene_view_mode === "cards" ? "grid" : "table");
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
              const newTrie = new PathTrie();
              const chunkSize = 1500;
              for (let i = 0; i < total; i += chunkSize) {
                const chunk = cached.scenes.slice(i, i + chunkSize);
                chunk.forEach((s) => newTrie.insert(s));
                if (total > 3000) {
                  // Yield to browser event loop
                  await new Promise((r) => setTimeout(r, 0));
                }
              }
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
          const newTrie = new PathTrie();
          const chunkSize = 1000;

          for (let i = 0; i < total; i += chunkSize) {
            const chunk = scenes.slice(i, i + chunkSize);
            chunk.forEach((s) => newTrie.insert(s));
            const processed = Math.min(i + chunkSize, total);
            setStatusText(`Indexing file hierarchy: ${processed.toLocaleString()} / ${total.toLocaleString()} scenes...`);
            // Yield to browser event loop to prevent UI freezing
            await new Promise((r) => setTimeout(r, 0));
          }

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
        return trie.getNode(currentPath) || trie.root;
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
        const filterCriterion = {
          type: "path",
          value: currentPath,
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
        const targetPath = currentPath || "";
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
          if (playingScene || showSettingsModal || showBatchModal || showParserModal) {
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



      const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

      return React.createElement(
        "div",
        { className: "sfm-workspace-overlay" },
        // Header
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
          // Center: Live Search Box
          React.createElement(
            "div",
            { className: "sfm-header-search-wrap" },
            React.createElement(
              "div",
              { className: "sfm-search-wrap" },
              React.createElement(
                "span",
                { className: "sfm-search-icon" },
                React.createElement(IconSearch, { size: 14, color: "#81a1c1" })
              ),
              React.createElement("input", {
                ref: searchInputRef,
                type: "text",
                className: "sfm-search-input",
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
            )
          ),
          // Right: Settings & Close
          React.createElement(
            "div",
            { className: "d-flex align-items-center gap-2" },
            React.createElement(
              "button",
              {
                className: "sfm-workspace-settings-btn",
                onClick: () => setShowSettingsModal(true),
                title: "Stash Settings & Plugin Tasks",
              },
              React.createElement(IconGear, { size: 14, color: "currentColor" }),
              "Settings"
            ),
            onClose && React.createElement("button", { className: "sfm-workspace-close", onClick: onClose }, "✕ Close")
          )
        ),
        // Scrollable Body
        React.createElement(
          "div",
          { className: "sfm-workspace-content" },
          // Folder Navigation Control Line (Back, Up, Root, Path Breadcrumbs & Tree Stats placed just above Subfolders)
          React.createElement(
            "div",
            { className: "sfm-nav-control-line d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2" },
            React.createElement(
              "div",
              { className: "sfm-breadcrumbs-wrap d-flex align-items-center flex-wrap" },
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm mr-2 sfm-nav-history-group" },
                React.createElement(
                  "button",
                  {
                    className: "btn btn-sm btn-outline-secondary py-0 px-2",
                    onClick: handleGoBackInHistory,
                    disabled: historyStack.current.length === 0 && !currentPath,
                    title: "Go back to previous folder",
                  },
                  "◀ Back"
                ),
                React.createElement(
                  "button",
                  {
                    className: "btn btn-sm btn-outline-secondary py-0 px-2",
                    onClick: handleGoUpOneLevel,
                    disabled: !currentPath,
                    title: "Go up to parent directory",
                  },
                  "▲ Up"
                )
              ),
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm mr-2 sfm-nav-actions-group" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-outline-secondary py-0 px-2",
                    onClick: handleScanFolder,
                    title: currentPath ? "Trigger Stash filesystem scan on this folder path" : "Trigger Stash filesystem scan on all libraries",
                  },
                  React.createElement(IconScan, { size: 13, color: "currentColor" }),
                  "Scan Folder"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-outline-secondary py-0 px-2",
                    onClick: openInNativeGrid,
                    title: currentPath ? "Open this folder in Stash native scenes grid (new tab)" : "Open Stash native scenes grid (new tab)",
                  },
                  React.createElement(IconGrid, { size: 13, color: "currentColor" }),
                  "Stash Grid"
                )
              ),
              React.createElement(
                "button",
                { className: `sfm-crumb-btn ${!currentPath ? "sfm-crumb-active" : ""}`, onClick: () => navigateToFolder(""), title: "Return to Stash Root" },
                React.createElement(IconFolder, { size: 16, color: "#88c0d0" }),
                React.createElement("span", { className: "ml-1 font-weight-bold" }, "Stash")
              ),
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
                      className: `sfm-crumb-btn ${isLast ? "sfm-crumb-active" : ""}`,
                      onClick: () => navigateToFolder(p),
                      title: seg,
                    },
                    seg
                  )
                );
              }),
              React.createElement(
                "span",
                { className: "sfm-stat-pill ml-2 badge badge-dark font-weight-normal" },
                `${currentNode ? currentNode.directScenes.length : 0} direct · ${allDescendantIds.length} in tree (${formatBytes(currentNode?.totalSize)})`
              ),
              (currentPath || selectedSceneIds.size > 0 || (currentNode && currentNode.directScenes && currentNode.directScenes.length > 0)) &&
                React.createElement(
                  "div",
                  { className: "btn-group btn-group-sm ml-2" },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-0 px-2",
                      onClick: () => setShowParserModal(true),
                      title: "Parse Filenames with Regex",
                    },
                    React.createElement(IconSearch, { size: 13, color: "currentColor" }),
                    "Parse"
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-0 px-2",
                      onClick: () => setShowBatchModal(true),
                      title: "Batch Edit Scenes",
                    },
                    React.createElement(IconEdit, { size: 13, color: "currentColor" }),
                    "Batch Edit"
                  )
                )
            ),
            React.createElement(
              "div",
              { className: "sfm-sort-group d-flex align-items-center" },
              React.createElement("span", { className: "sfm-sort-label mr-1" }, "Scenes:"),
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
              ),
              React.createElement("span", { className: "sfm-sort-label ml-2 mr-1" }, "Folders:"),
              React.createElement(
                "select",
                {
                  className: "sfm-sort-select",
                  value: folderSort,
                  onChange: (e) => setFolderSort(e.target.value),
                  title: "Sort Folders",
                },
                React.createElement("option", { value: "name_asc" }, "Name (A-Z)"),
                React.createElement("option", { value: "name_desc" }, "Name (Z-A)"),
                React.createElement("option", { value: "count_desc" }, "Count (High-Low)"),
                React.createElement("option", { value: "count_asc" }, "Count (Low-High)")
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
                      className: "sfm-section-header mb-0 sfm-collapsible-title",
                      onClick: handleToggleSubfoldersCollapsed,
                      title: isSubfoldersCollapsed ? "Click to expand Subfolders" : "Click to collapse Subfolders",
                      style: { cursor: "pointer", userSelect: "none" },
                    },
                    React.createElement(
                      "span",
                      { className: "sfm-collapse-chevron mr-2 text-info font-weight-bold" },
                      isSubfoldersCollapsed ? "▶" : "▼"
                    ),
                    React.createElement("span", null, "Subfolders"),
                    React.createElement("span", { className: "badge badge-dark ml-2 font-weight-normal" }, filteredAndSortedSubfolders.length),
                    isSubfoldersCollapsed &&
                      React.createElement("span", { className: "text-muted small ml-2 font-italic" }, "(collapsed)")
                  ),
                  // Button styled identically to [Select All] in scenes view
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge ${includeSubfolders ? "badge-info" : "badge-secondary"} sfm-badge-btn ml-2 font-weight-normal`,
                      onClick: (e) => {
                        e.stopPropagation();
                        handleToggleIncludeSubfolders(!includeSubfolders);
                      },
                      title: "Include all scenes inside all sub-folders in the current directory (all levels down)",
                    },
                    "Include Sub-folders"
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge ${sortByFolderFirst ? "badge-info" : "badge-secondary"} sfm-badge-btn ml-2 font-weight-normal`,
                      onClick: (e) => {
                        e.stopPropagation();
                        handleToggleSortByFolderFirst(!sortByFolderFirst);
                      },
                      title: "When Include Sub-folders is enabled, group and sort scenes by folder order first, then apply scene sorting within each folder",
                    },
                    "Folder Sort First"
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge ${hideEmpty ? "badge-info" : "badge-secondary"} sfm-badge-btn ml-2 font-weight-normal`,
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
                    { className: "d-flex align-items-center flex-wrap gap-2" },
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
                          className: `btn btn-sm ${folderViewMode === "cards" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => { setIsSubfoldersCollapsed(false); handleSetFolderViewMode("cards"); },
                          title: "Compact Cards View",
                        },
                        "Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `btn btn-sm ${folderViewMode === "list" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => { setIsSubfoldersCollapsed(false); handleSetFolderViewMode("list"); },
                          title: "Compact List View",
                        },
                        "List"
                      ),
                      React.createElement(
                        "button",
                        {
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
                { className: "d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2" },
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center flex-wrap gap-2" },
                  React.createElement(
                    "div",
                    {
                      className: "sfm-section-header mb-0 sfm-collapsible-title",
                      onClick: handleToggleFilesCollapsed,
                      title: isFilesCollapsed ? "Click to expand Files" : "Click to collapse Files",
                      style: { cursor: "pointer", userSelect: "none" },
                    },
                    React.createElement(
                      "span",
                      { className: "sfm-collapse-chevron mr-2 text-info font-weight-bold" },
                      isFilesCollapsed ? "▶" : "▼"
                    ),
                    React.createElement("span", null, "Files / Scenes"),
                    React.createElement("span", { className: "badge badge-dark ml-2 font-weight-normal" }, filteredAndSortedScenes.length),
                    isFilesCollapsed &&
                      React.createElement("span", { className: "text-muted small ml-2 font-italic" }, "(collapsed)")
                  ),
                  !isFilesCollapsed &&
                    includeSubfolders &&
                    React.createElement(
                      "span",
                      { className: "badge badge-info ml-2 font-weight-normal" },
                      "All Sub-folders Included"
                    ),
                  !isFilesCollapsed &&
                    includeSubfolders &&
                    sortByFolderFirst &&
                    React.createElement(
                      "span",
                      {
                        className: "badge badge-secondary ml-1 font-weight-normal",
                        title: "Scenes ordered by folder sort first, then sorted within each folder",
                      },
                      "Folder Sort First"
                    ),
                  !isFilesCollapsed &&
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: `btn btn-sm ${selectedSceneIds.size > 0 ? "btn-primary font-weight-bold" : "btn-outline-secondary"} py-0 px-2 ml-2`,
                        onClick: handleSelectAllFolderScenes,
                        title: selectedSceneIds.size > 0 ? `Click to deselect all (${selectedSceneIds.size} selected)` : "Select all visible scenes in folder",
                      },
                      selectedSceneIds.size > 0 ? `${selectedSceneIds.size} Selected` : "Select All"
                    )
                ),
                !isFilesCollapsed &&
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center flex-wrap gap-2" },
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
                          className: `btn btn-sm ${viewMode === "grid" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => handleToggleViewMode("grid"),
                          title: "Grid Card View",
                        },
                        "Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `btn btn-sm ${viewMode === "list" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => handleToggleViewMode("list"),
                          title: "Detailed Table View",
                        },
                        "Table"
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
                        onPlay: (s) => setPlayingScene(s),
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
                      className: "btn btn-sm btn-primary",
                      onClick: () => setShowBatchModal(true),
                      title: "Batch edit selected scenes",
                    },
                    React.createElement(IconEdit, { size: 13, className: "mr-1" }),
                    "Batch Edit"
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "btn btn-sm btn-outline-warning",
                      onClick: () => setShowParserModal(true),
                      title: "Regex parse selected scenes",
                    },
                    React.createElement(IconSearch, { size: 13, className: "mr-1" }),
                    "Parse"
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "btn btn-sm btn-outline-info",
                      onClick: () => {
                        const ids = Array.from(selectedSceneIds);
                        const filterCriterion = {
                          type: "ids",
                          value: ids,
                          modifier: "INCLUDES",
                        };
                        window.open(`/scenes?c=${encodeURIComponent(JSON.stringify(filterCriterion))}`, "_blank");
                      },
                      title: "Open selected in Stash native grid",
                    },
                    React.createElement(IconGrid, { size: 13, className: "mr-1" }),
                    "Stash Grid"
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "btn btn-sm btn-outline-light",
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

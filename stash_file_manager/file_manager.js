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

    // In-memory Path Trie Data Structure (Feature 5)
    class PathTrie {
      constructor() {
        this.root = {
          name: "Root",
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
    function BingeReelPlayerModal({ scene, scenes = [], onSelectScene, onClose, folderName, currentPath }) {
      const videoRef = useRef(null);
      const videoContainerRef = useRef(null);
      const savedPlaybackTime = useRef(0);

      // 1. Scene Navigation & Carousel Context
      const currentIndex = useMemo(() => {
        if (!scenes || !scenes.length || !scene) return 0;
        const idx = scenes.findIndex((s) => s.id === scene.id);
        return idx >= 0 ? idx : 0;
      }, [scenes, scene]);

      const totalScenes = scenes?.length || 1;
      const hasPrev = currentIndex > 0;
      const hasNext = currentIndex < totalScenes - 1;
      const prevScene = hasPrev ? scenes[currentIndex - 1] : null;
      const nextScene = hasNext ? scenes[currentIndex + 1] : null;

      const goToPrev = useCallback(() => {
        if (hasPrev && onSelectScene && prevScene) {
          onSelectScene(prevScene);
        }
      }, [hasPrev, onSelectScene, prevScene]);

      const goToNext = useCallback(() => {
        if (hasNext && onSelectScene && nextScene) {
          onSelectScene(nextScene);
        }
      }, [hasNext, onSelectScene, nextScene]);

      // 2. Playback State, Speed & HUD Feedback
      const [isPlaying, setIsPlaying] = useState(true);
      const [playbackRate, setPlaybackRate] = useState(1);
      const [hudNotice, setHudNotice] = useState(null);
      const hudTimer = useRef(null);

      const showHud = (msg) => {
        clearTimeout(hudTimer.current);
        setHudNotice(msg);
        hudTimer.current = setTimeout(() => setHudNotice(null), 850);
      };

      const handleSeek = useCallback((seconds) => {
        const v = videoRef.current;
        if (!v) return;
        const targetTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + seconds));
        v.currentTime = targetTime;
        showHud(seconds > 0 ? `+${seconds}s ⏩` : `⏪ ${Math.abs(seconds)}s`);
      }, []);

      const handleTogglePlay = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
          v.play().then(() => setIsPlaying(true)).catch(() => {});
          showHud("▶ Play");
        } else {
          v.pause();
          setIsPlaying(false);
          showHud("⏸ Pause");
        }
      }, []);

      const handleCycleSpeed = useCallback(() => {
        const v = videoRef.current;
        if (!v) return;
        const speeds = [1, 1.25, 1.5, 2, 0.75];
        const currentIdx = speeds.indexOf(playbackRate);
        const nextSpeed = speeds[(currentIdx + 1) % speeds.length];
        v.playbackRate = nextSpeed;
        setPlaybackRate(nextSpeed);
        showHud(`⚡ ${nextSpeed}x Speed`);
      }, [playbackRate]);

      const handleToggleFullscreen = () => {
        const elem = videoContainerRef.current || videoRef.current;
        if (!elem) return;
        if (!document.fullscreenElement) {
          if (elem.requestFullscreen) elem.requestFullscreen();
          else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        } else {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
      };

      // 3. Double-Click Seek vs Fullscreen Prevention
      const clickTimer = useRef(null);
      const handleDoubleTapSeek = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const w = rect.width;
        if (clickX < w * 0.4) {
          handleSeek(-10);
        } else if (clickX > w * 0.6) {
          handleSeek(10);
        } else {
          handleTogglePlay();
        }
      };

      const handleGestureClick = (e) => {
        if (e.target.closest("button") || e.target.closest("a") || e.target.closest("select")) return;
        if (clickTimer.current) {
          clearTimeout(clickTimer.current);
          clickTimer.current = null;
          handleDoubleTapSeek(e);
        } else {
          const clientX = e.clientX;
          const currentTarget = e.currentTarget;
          clickTimer.current = setTimeout(() => {
            clickTimer.current = null;
            handleTogglePlay();
          }, 260);
        }
      };

      // 4. Multi-Format Detection & Transcoding Resolution (WebM / HLS Priority)
      const filePath = scene?.files?.[0]?.path || scene?.files?.[0]?.basename || "";
      const fileExt = (filePath.split(".").pop() || "").toLowerCase();
      const isNativeDirect = ["mp4", "m4v", "webm"].includes(fileExt);
      const extLabel = fileExt ? `.${fileExt.toUpperCase()}` : "VIDEO";

      const [streamMode, setStreamMode] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_stream_mode") || (isNativeDirect ? "direct" : "webm");
        } catch (e) {
          return isNativeDirect ? "direct" : "webm";
        }
      });
      const [customStreamUrl, setCustomStreamUrl] = useState("");
      const [playerNotice, setPlayerNotice] = useState("");
      const [playerError, setPlayerError] = useState("");
      const [availableStreams, setAvailableStreams] = useState([]);
      const [directUrl, setDirectUrl] = useState(() => scene?.paths?.stream || `/scene/${scene?.id}/stream`);
      const [transcodeWebmUrl, setTranscodeWebmUrl] = useState(() => `/scene/${scene?.id}/stream.webm`);
      const [transcodeHlsUrl, setTranscodeHlsUrl] = useState(() => `/scene/${scene?.id}/stream.m3u8`);
      const [transcodeMp4Url, setTranscodeMp4Url] = useState(() => `/scene/${scene?.id}/stream.mp4`);
      const [copiedNotice, setCopiedNotice] = useState("");

      // Query available Stash streams via GraphQL
      useEffect(() => {
        if (!scene?.id) return;
        let active = true;
        savedPlaybackTime.current = 0;
        setPlayerError("");
        setPlayerNotice("");
        setCustomStreamUrl("");

        const initialDirect = scene?.paths?.stream || `/scene/${scene.id}/stream`;
        const qIdx = initialDirect.indexOf("?");
        const queryParams = qIdx !== -1 ? initialDirect.slice(qIdx) : "";

        const defaultWebm = `/scene/${scene.id}/stream.webm${queryParams}`;
        const defaultHls = `/scene/${scene.id}/stream.m3u8${queryParams}`;
        const defaultMp4 = `/scene/${scene.id}/stream.mp4${queryParams}`;

        setDirectUrl(initialDirect);
        setTranscodeWebmUrl(defaultWebm);
        setTranscodeHlsUrl(defaultHls);
        setTranscodeMp4Url(defaultMp4);

        // Notify user if non-native file defaults to WebM transcode
        if (!isNativeDirect && streamMode === "direct") {
          setStreamMode("webm");
          setPlayerNotice(`Non-native format (.${fileExt.toUpperCase()}) detected: WebM Transcode enabled for timeline seeking.`);
        }

        gqlFetch(
          `query ScenePlaybackDetails($id: ID!) {
            findScene(id: $id) {
              id
              title
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

            // Prioritize WebM & HLS over MP4 to avoid loss of duration/seeking ability
            const webm = streams.find((s) => s.url !== officialDirect && (s.mime_type?.includes("webm") || s.url?.includes(".webm") || s.label?.toLowerCase().includes("webm")));
            const hls = streams.find((s) => s.url !== officialDirect && (s.mime_type?.includes("mpegurl") || s.url?.includes(".m3u8") || s.label?.toLowerCase().includes("hls")));
            const mp4 = streams.find((s) => s.url !== officialDirect && (s.mime_type?.includes("mp4") || s.url?.includes("stream.mp4") || s.label?.toLowerCase().includes("mp4")));

            if (webm) setTranscodeWebmUrl(webm.url);
            if (hls) setTranscodeHlsUrl(hls.url);
            if (mp4) setTranscodeMp4Url(mp4.url);
          })
          .catch((err) => {
            console.warn("[SFM Video Player] GraphQL stream query error:", err);
          });

        return () => {
          active = false;
        };
      }, [scene?.id, isNativeDirect, fileExt]);

      // Effective stream URL
      const streamUrl = useMemo(() => {
        if (!scene?.id) return "";
        if (customStreamUrl) return customStreamUrl;
        if (streamMode === "direct") return directUrl;
        if (streamMode === "webm") return transcodeWebmUrl;
        if (streamMode === "hls") return transcodeHlsUrl;
        if (streamMode === "mp4") return transcodeMp4Url;
        return transcodeWebmUrl;
      }, [scene?.id, streamMode, customStreamUrl, directUrl, transcodeWebmUrl, transcodeHlsUrl, transcodeMp4Url]);

      // Stream Loading Engine: Handles Segmented HLS Protocol vs Progressive Container Transcodes
      const hlsInstanceRef = useRef(null);

      useEffect(() => {
        const v = videoRef.current;
        if (!v || !streamUrl) return;

        // Cleanup any active HLS instance
        if (hlsInstanceRef.current) {
          hlsInstanceRef.current.destroy();
          hlsInstanceRef.current = null;
        }

        const isHlsUrl = streamUrl.includes(".m3u8") || streamMode === "hls";

        if (isHlsUrl) {
          // Native HLS support (Safari, iOS, WebKit)
          if (v.canPlayType("application/vnd.apple.mpegurl")) {
            v.src = streamUrl;
            v.load();
            const p = v.play();
            if (p) p.then(() => setIsPlaying(true)).catch(() => {});
          } else if (window.Hls && window.Hls.isSupported()) {
            // MSE Hls.js
            const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
            hlsInstanceRef.current = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(v);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
              v.play().then(() => setIsPlaying(true)).catch(() => {});
            });
            hls.on(window.Hls.Events.ERROR, (event, data) => {
              if (data.fatal) {
                console.warn("[SFM Video Player] HLS fatal error, falling back to WebM progressive container:", data);
                setStreamMode("webm");
                setPlayerNotice("HLS stream failed in this browser. Switched to WebM Progressive Container.");
              }
            });
          } else {
            console.warn("[SFM Video Player] HLS protocol requires native WebKit or Hls.js. Falling back to WebM container transcode.");
            setStreamMode("webm");
            setPlayerNotice("HLS protocol requires MSE library in this browser. Switched to WebM Progressive Container.");
          }
        } else {
          // Progressive container streams (Direct, WebM, MP4)
          v.src = streamUrl;
          v.load();
          const p = v.play();
          if (p) {
            p.then(() => setIsPlaying(true)).catch((err) => {
              if (err.name === "NotAllowedError") {
                v.muted = true;
                v.play().then(() => setIsPlaying(true)).catch(() => {});
              }
            });
          }
        }

        return () => {
          if (hlsInstanceRef.current) {
            hlsInstanceRef.current.destroy();
            hlsInstanceRef.current = null;
          }
        };
      }, [streamUrl, streamMode]);

      // Intelligent Fallback on playback error
      const handleVideoError = (e) => {
        console.warn("[SFM Video Player] Playback error on stream:", streamUrl, e);
        if (streamMode === "direct" && !customStreamUrl) {
          console.log("[SFM Video Player] Direct stream failed. Falling back to WebM Transcode...");
          setStreamMode("webm");
          setPlayerNotice("Direct stream format not supported by browser. Switched to WebM Transcode (full timeline seeking supported).");
        } else if (streamMode === "webm" && !customStreamUrl) {
          console.log("[SFM Video Player] WebM stream failed. Trying HLS stream...");
          setStreamMode("hls");
          setPlayerNotice("WebM stream failed. Switched to HLS Adaptive Stream.");
        } else if (streamMode === "hls" && !customStreamUrl) {
          setStreamMode("mp4");
          setPlayerNotice("Switched to MP4 Transcode.");
        } else {
          setPlayerError("Video playback failed. Browser cannot decode this stream. Use 'Open in VLC' for instant external playback.");
        }
      };

      // 5. Picture-in-Picture Modes (Native OS PiP & In-App Floating Mini Player)
      const [isNativePip, setIsNativePip] = useState(false);
      const [isFloatingPip, setIsFloatingPip] = useState(false);

      useEffect(() => {
        const v = videoRef.current;
        if (!v) return;
        const handleEnterPip = () => setIsNativePip(true);
        const handleLeavePip = () => setIsNativePip(false);
        v.addEventListener("enterpictureinpicture", handleEnterPip);
        v.addEventListener("leavepictureinpicture", handleLeavePip);
        return () => {
          v.removeEventListener("enterpictureinpicture", handleEnterPip);
          v.removeEventListener("leavepictureinpicture", handleLeavePip);
        };
      }, []);

      const handleTogglePip = async () => {
        const v = videoRef.current;
        if (document.pictureInPictureElement) {
          try {
            await document.exitPictureInPicture();
          } catch (e) {}
          setIsNativePip(false);
          return;
        }
        if (v && document.pictureInPictureEnabled && typeof v.requestPictureInPicture === "function") {
          try {
            await v.requestPictureInPicture();
            setIsNativePip(true);
            return;
          } catch (err) {
            console.warn("[SFM Video Player] Native PiP failed, opening floating window:", err);
          }
        }
        setIsFloatingPip(true);
      };

      const handleRestoreFromPip = async () => {
        if (document.pictureInPictureElement) {
          try {
            await document.exitPictureInPicture();
          } catch (e) {}
        }
        setIsNativePip(false);
        setIsFloatingPip(false);
      };

      // In-App Floating Mini Player Dragging
      const [pipPos, setPipPos] = useState(() => {
        const w = typeof window !== "undefined" ? window.innerWidth : 1200;
        const h = typeof window !== "undefined" ? window.innerHeight : 800;
        return {
          x: Math.max(20, w - 460),
          y: Math.max(20, h - 340),
        };
      });
      const [isDragging, setIsDragging] = useState(false);
      const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

      const handleHeaderMouseDown = (e) => {
        if (!isFloatingPip) return;
        if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input") || e.target.closest("select")) return;
        setIsDragging(true);
        dragStart.current = {
          mouseX: e.clientX,
          mouseY: e.clientY,
          posX: pipPos.x,
          posY: pipPos.y,
        };
      };

      useEffect(() => {
        if (!isDragging) return;
        const handleMouseMove = (e) => {
          const dx = e.clientX - dragStart.current.mouseX;
          const dy = e.clientY - dragStart.current.mouseY;
          const clampedX = Math.max(10, Math.min(window.innerWidth - 380, dragStart.current.posX + dx));
          const clampedY = Math.max(10, Math.min(window.innerHeight - 220, dragStart.current.posY + dy));
          setPipPos({ x: clampedX, y: clampedY });
        };
        const handleMouseUp = () => setIsDragging(false);
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
        };
      }, [isDragging]);

      // 6. Binge-Style Wheel Scrolling with Pull Distance Threshold & Spring-back Animation
      const [pullOffset, setPullOffset] = useState(0);
      const [isTransitioning, setIsTransitioning] = useState(false);
      const accumulatedDelta = useRef(0);
      const snapbackTimer = useRef(null);
      const SCROLL_THRESHOLD = 140; // Requires deliberate pull distance to register change

      const handleWheel = useCallback(
        (e) => {
          if (isTransitioning) return;
          if (e.target.closest("select") || e.target.closest(".sfm-scrollable")) return;
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

          accumulatedDelta.current += e.deltaY * 0.7;

          // Physics-style pull resistance
          const rawOffset = -accumulatedDelta.current * 0.35;
          const clampedOffset = Math.max(-130, Math.min(130, rawOffset));
          setPullOffset(clampedOffset);

          clearTimeout(snapbackTimer.current);

          // Threshold check
          if (accumulatedDelta.current > SCROLL_THRESHOLD && hasNext) {
            accumulatedDelta.current = 0;
            setIsTransitioning(true);
            setPullOffset(-160); // Slide current up
            setTimeout(() => {
              goToNext();
              setPullOffset(0);
              setIsTransitioning(false);
            }, 230);
          } else if (accumulatedDelta.current < -SCROLL_THRESHOLD && hasPrev) {
            accumulatedDelta.current = 0;
            setIsTransitioning(true);
            setPullOffset(160); // Slide current down
            setTimeout(() => {
              goToPrev();
              setPullOffset(0);
              setIsTransitioning(false);
            }, 230);
          } else {
            // Snap back cleanly when user stops scrolling before threshold
            snapbackTimer.current = setTimeout(() => {
              accumulatedDelta.current = 0;
              setPullOffset(0);
            }, 240);
          }
        },
        [hasNext, hasPrev, goToNext, goToPrev, isTransitioning]
      );

      // Keyboard Controls
      useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;
          if (e.key === "Escape") {
            if (isNativePip) {
              handleRestoreFromPip();
            } else if (isFloatingPip) {
              setIsFloatingPip(false);
            } else {
              onClose();
            }
          } else if (e.key === "ArrowDown" || e.key === "PageDown") {
            e.preventDefault();
            goToNext();
          } else if (e.key === "ArrowUp" || e.key === "PageUp") {
            e.preventDefault();
            goToPrev();
          } else if (e.key === " " || e.key.toLowerCase() === "k") {
            e.preventDefault();
            handleTogglePlay();
          } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "j") {
            e.preventDefault();
            handleSeek(-10);
          } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "l") {
            e.preventDefault();
            handleSeek(10);
          } else if (e.key.toLowerCase() === "m") {
            const v = videoRef.current;
            if (v) {
              v.muted = !v.muted;
              showHud(v.muted ? "🔇 Muted" : "🔊 Unmuted");
            }
          } else if (e.key.toLowerCase() === "f") {
            e.preventDefault();
            handleToggleFullscreen();
          }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
      }, [onClose, goToNext, goToPrev, isNativePip, isFloatingPip, handleSeek, handleTogglePlay]);

      // Copy direct stream link
      const handleCopyStreamLink = () => {
        const fullUrl = `${window.location.origin}${streamUrl}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(fullUrl).then(() => {
            setCopiedNotice("Stream URL copied to clipboard!");
            setTimeout(() => setCopiedNotice(""), 3500);
          }).catch(() => {
            prompt("Stream URL:", fullUrl);
          });
        } else {
          prompt("Stream URL:", fullUrl);
        }
      };

      // Playback Time Tracking
      const handleTimeUpdate = (e) => {
        if (e.target && e.target.currentTime) {
          savedPlaybackTime.current = e.target.currentTime;
        }
      };
      const handleLoadedMetadata = (e) => {
        if (savedPlaybackTime.current > 0 && e.target) {
          try {
            e.target.currentTime = savedPlaybackTime.current;
          } catch (err) {}
        }
      };

      if (!scene) return null;
      const title = scene.title || scene.files?.[0]?.basename || `Scene #${scene.id}`;
      const vlcUrl = `vlc://${window.location.origin}${directUrl}`;

      // -------------------------------------------------------------
      // Mode 1: Native OS Picture-in-Picture Active Pill
      // -------------------------------------------------------------
      if (isNativePip) {
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            "div",
            {
              style: {
                position: "fixed",
                bottom: 0,
                right: 0,
                width: "1px",
                height: "1px",
                opacity: 0,
                pointerEvents: "none",
                overflow: "hidden",
                zIndex: 9999,
              },
            },
            React.createElement("video", {
              ref: videoRef,
              src: streamUrl,
              controls: true,
              autoPlay: true,
              onError: handleVideoError,
              onTimeUpdate: handleTimeUpdate,
              onLoadedMetadata: handleLoadedMetadata,
            })
          ),
          React.createElement(
            "div",
            {
              className: "sfm-pip-dock-pill shadow-lg",
              onClick: (e) => e.stopPropagation(),
            },
            React.createElement("span", { className: "sfm-pip-pulse mr-2 font-weight-bold" }, "●"),
            React.createElement("span", { className: "font-weight-bold text-truncate mr-2", style: { maxWidth: "220px" } }, `⧉ ${title}`),
            React.createElement(
              "button",
              {
                className: "btn btn-sm btn-info py-0 px-2 mr-2 font-weight-bold",
                onClick: handleRestoreFromPip,
                title: "Enlarge to Full Video Player",
              },
              "🗖 Enlarge"
            ),
            React.createElement(
              "button",
              {
                className: "btn btn-sm btn-outline-danger py-0 px-2",
                onClick: onClose,
                title: "Close Video Playback",
              },
              "×"
            )
          )
        );
      }

      // -------------------------------------------------------------
      // Mode 2: In-App Draggable Floating Mini Player
      // -------------------------------------------------------------
      if (isFloatingPip) {
        return React.createElement(
          "div",
          {
            className: "sfm-pip-dialog",
            style: {
              position: "fixed",
              left: `${pipPos.x}px`,
              top: `${pipPos.y}px`,
              width: "430px",
              zIndex: 10050,
            },
            onWheel: handleWheel,
          },
          React.createElement(
            "div",
            {
              className: "sfm-pip-header",
              onMouseDown: handleHeaderMouseDown,
              style: { cursor: isDragging ? "grabbing" : "grab" },
            },
            React.createElement(
              "div",
              { className: "d-flex align-items-center text-truncate mr-2", style: { flex: 1 } },
              React.createElement("span", { className: "mr-1 text-muted", style: { cursor: "grab" } }, "⠿"),
              React.createElement("span", { className: "font-weight-bold text-truncate small" }, title)
            ),
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-1" },
              React.createElement("span", { className: "badge badge-dark mr-1 small" }, `${currentIndex + 1}/${totalScenes}`),
              React.createElement(
                "button",
                {
                  className: "btn btn-sm btn-outline-secondary py-0 px-1 mr-1",
                  onClick: goToPrev,
                  disabled: !hasPrev,
                  title: `Previous: ${prevScene?.title || ""}`,
                },
                "▲"
              ),
              React.createElement(
                "button",
                {
                  className: "btn btn-sm btn-outline-secondary py-0 px-1 mr-1",
                  onClick: goToNext,
                  disabled: !hasNext,
                  title: `Next: ${nextScene?.title || ""}`,
                },
                "▼"
              ),
              React.createElement(
                "button",
                {
                  className: "btn btn-sm btn-info py-0 px-2 mr-1 font-weight-bold",
                  onClick: () => setIsFloatingPip(false),
                  title: "Enlarge to Full Modal Player",
                },
                "🗖 Enlarge"
              ),
              React.createElement(
                "button",
                {
                  className: "btn btn-sm btn-outline-danger py-0 px-1",
                  onClick: onClose,
                  title: "Close Player",
                },
                "×"
              )
            )
          ),
          React.createElement(
            "div",
            { className: "sfm-pip-video-wrap position-relative" },
            React.createElement("video", {
              ref: videoRef,
              src: streamUrl,
              controls: true,
              autoPlay: true,
              className: "sfm-video-element",
              onError: handleVideoError,
              onTimeUpdate: handleTimeUpdate,
              onLoadedMetadata: handleLoadedMetadata,
            })
          ),
          React.createElement(
            "div",
            { className: "sfm-pip-footer d-flex justify-content-between align-items-center p-2 bg-dark small text-muted" },
            React.createElement(
              "div",
              { className: "text-truncate mr-2" },
              React.createElement("span", { className: "badge badge-secondary mr-1" }, extLabel),
              scene.studio?.name && React.createElement("span", { className: "badge badge-primary mr-1" }, scene.studio.name)
            ),
            React.createElement(
              "button",
              {
                className: "btn btn-sm btn-link text-info p-0 small",
                onClick: () => setIsFloatingPip(false),
              },
              "Restore 🗖"
            )
          )
        );
      }

      // -------------------------------------------------------------
      // Mode 3: Clean Redesigned Centered Modal Player
      // -------------------------------------------------------------
      return React.createElement(
        "div",
        { className: "sfm-modal-backdrop", onClick: onClose },
        React.createElement(
          "div",
          {
            className: "sfm-player-dialog",
            onClick: (e) => e.stopPropagation(),
            onWheel: handleWheel,
          },
          // Clean Unified Header
          React.createElement(
            "div",
            { className: "sfm-modal-header d-flex justify-content-between align-items-center flex-wrap gap-2" },
            React.createElement(
              "div",
              { className: "d-flex align-items-center text-truncate mr-3", style: { flex: 1, minWidth: "220px" } },
              React.createElement("h5", { className: "mb-0 text-truncate font-weight-bold text-light mr-2" }, `▶ ${title}`),
              React.createElement("span", { className: "badge badge-secondary mr-2" }, extLabel),
              scene.studio?.name && React.createElement("span", { className: "badge badge-primary text-truncate" }, scene.studio.name)
            ),
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-2 flex-wrap" },
              // Unified Stream Engine Dropdown
              React.createElement(
                "select",
                {
                  className: "sfm-stream-select mr-1",
                  value: customStreamUrl || streamMode,
                  onChange: (e) => {
                    const val = e.target.value;
                    setPlayerError("");
                    setPlayerNotice("");
                    if (["direct", "webm", "hls", "mp4"].includes(val)) {
                      setCustomStreamUrl("");
                      setStreamMode(val);
                      try {
                        window.localStorage.setItem("sfm_stream_mode", val);
                      } catch (err) {}
                    } else {
                      setCustomStreamUrl(val);
                    }
                  },
                  title: "Stream Engine: Choose Direct Stream or Transcode Profile",
                },
                React.createElement("option", { value: "direct" }, "⚡ Direct Play (Original File)"),
                React.createElement("option", { value: "hls" }, "📺 HLS (Segmented Protocol)"),
                React.createElement("option", { value: "webm" }, "🔄 WebM (Progressive Container)"),
                React.createElement("option", { value: "mp4" }, "🎬 MP4 (Progressive Container)"),
                availableStreams.filter((s) => !s.url.includes("stream.webm") && !s.url.includes("stream.m3u8") && !s.url.includes("stream.mp4")).map((s, idx) =>
                  React.createElement(
                    "option",
                    { key: `custom-${idx}`, value: s.url },
                    s.label || (s.mime_type ? s.mime_type.split("/")[1].toUpperCase() : `Custom Stream #${idx + 1}`)
                  )
                )
              ),
              // Single 1-Click PiP Button
              React.createElement(
                "button",
                {
                  className: "btn btn-sm btn-info font-weight-bold mr-1",
                  onClick: handleTogglePip,
                  title: "Picture-in-Picture: float video over desktop or browser and browse other folders",
                },
                "⧉ PiP"
              ),
              // Fullscreen Button
              React.createElement(
                "button",
                {
                  className: "btn btn-sm btn-outline-light mr-1",
                  onClick: handleToggleFullscreen,
                  title: "Toggle Fullscreen (F)",
                },
                "⛶ Fullscreen"
              ),
              // Single VLC Button
              React.createElement(
                "a",
                {
                  href: vlcUrl,
                  className: "btn btn-sm btn-outline-warning mr-1",
                  title: "Open direct video stream in VLC Media Player",
                },
                "🚀 VLC"
              ),
              // Single Copy Link Button
              React.createElement(
                "button",
                {
                  className: "btn btn-sm btn-outline-secondary mr-1",
                  onClick: handleCopyStreamLink,
                  title: "Copy stream URL to clipboard (paste into VLC, MPV, or PotPlayer)",
                },
                "📋 Copy Link"
              ),
              // Single Stash Details Link
              React.createElement(
                "a",
                {
                  href: `/scenes/${scene.id}`,
                  target: "_blank",
                  rel: "noreferrer",
                  className: "btn btn-sm btn-outline-info mr-2",
                  title: "Open scene details in Stash",
                },
                "↗ Stash"
              ),
              // Close Button
              React.createElement(
                "button",
                { className: "close text-light", onClick: onClose, title: "Close Player (Esc)" },
                "×"
              )
            )
          ),
          // Alert Notices (Clean, Non-Redundant)
          copiedNotice &&
            React.createElement(
              "div",
              { className: "alert alert-success py-1 px-3 mb-0 small rounded-0 d-flex justify-content-between align-items-center" },
              React.createElement("span", null, `✓ ${copiedNotice}`),
              React.createElement("button", { className: "close py-0", onClick: () => setCopiedNotice("") }, "×")
            ),
          playerNotice &&
            React.createElement(
              "div",
              { className: "alert alert-warning py-1 px-3 mb-0 small rounded-0 d-flex justify-content-between align-items-center" },
              React.createElement("span", null, `ℹ ${playerNotice}`),
              React.createElement("button", { className: "close py-0", onClick: () => setPlayerNotice("") }, "×")
            ),
          playerError &&
            React.createElement(
              "div",
              { className: "alert alert-danger py-1 px-3 mb-0 small rounded-0 d-flex justify-content-between align-items-center" },
              React.createElement("span", null, `⚠ ${playerError}`),
              React.createElement("button", { className: "close py-0", onClick: () => setPlayerError("") }, "×")
            ),
          // Main Video Container with Physics Pull Animation
          React.createElement(
            "div",
            {
              ref: videoContainerRef,
              className: "sfm-video-container position-relative overflow-hidden",
              style: {
                transform: `translateY(${pullOffset}px)`,
                transition: pullOffset === 0 ? "transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)" : "none",
              },
            },
            // Pull Up / Down Preview Indicators (Discovery Reel Animation)
            pullOffset > 20 && hasPrev &&
              React.createElement(
                "div",
                { className: "sfm-reel-pull-indicator top" },
                `▲ Release to switch to: ${prevScene?.title || `Previous Scene`}`,
                React.createElement("div", {
                  className: "sfm-reel-pull-progress",
                  style: { width: `${Math.min(100, (pullOffset / SCROLL_THRESHOLD) * 100)}%` },
                })
              ),
            pullOffset < -20 && hasNext &&
              React.createElement(
                "div",
                { className: "sfm-reel-pull-indicator bottom" },
                `▼ Release to switch to: ${nextScene?.title || `Next Scene`}`,
                React.createElement("div", {
                  className: "sfm-reel-pull-progress",
                  style: { width: `${Math.min(100, (-pullOffset / SCROLL_THRESHOLD) * 100)}%` },
                })
              ),
            // Gesture Overlay for Double-Click Seek (prevents browser fullscreen hijack)
            React.createElement("div", {
              className: "sfm-video-gesture-overlay",
              onClick: handleGestureClick,
              onDoubleClick: handleDoubleTapSeek,
              title: "Double click left/right sides to seek ±10s · Single click to toggle Play/Pause",
            }),
            React.createElement("video", {
              ref: videoRef,
              src: streamUrl,
              controls: true,
              autoPlay: true,
              className: "sfm-video-element",
              onError: handleVideoError,
              onDoubleClick: handleDoubleTapSeek,
              onTimeUpdate: handleTimeUpdate,
              onLoadedMetadata: handleLoadedMetadata,
            }),
            // On-screen animated HUD feedback badge
            hudNotice &&
              React.createElement(
                "div",
                { className: "sfm-player-hud" },
                React.createElement("div", { className: "sfm-hud-pill" }, hudNotice)
              ),
            // Binge-Style On-Screen Reel Overlay (Chevrons & Counter)
            React.createElement(
              "div",
              { className: "sfm-reel-overlay", onClick: (e) => e.stopPropagation() },
              React.createElement(
                "button",
                {
                  className: "sfm-reel-btn",
                  onClick: goToPrev,
                  disabled: !hasPrev,
                  title: hasPrev ? `Previous: ${prevScene?.title || `Scene #${prevScene?.id}`}` : "First scene in directory",
                },
                "▲"
              ),
              React.createElement(
                "div",
                { className: "sfm-reel-counter", title: `Folder: ${folderName || "Current"}` },
                `${currentIndex + 1}/${totalScenes}`
              ),
              React.createElement(
                "button",
                {
                  className: "sfm-reel-btn",
                  onClick: goToNext,
                  disabled: !hasNext,
                  title: hasNext ? `Next: ${nextScene?.title || `Scene #${nextScene?.id}`}` : "Last scene in directory",
                },
                "▼"
              )
            )
          ),
          // Clean Footer (Metadata & Shortcuts only, no redundant buttons)
          React.createElement(
            "div",
            { className: "p-3 bg-dark d-flex justify-content-between align-items-center flex-wrap gap-2 text-muted small" },
            React.createElement(
              "div",
              { className: "d-flex align-items-center flex-wrap gap-3" },
              scene.files?.[0]?.duration && React.createElement("span", null, `⏱ ${formatDuration(scene.files[0].duration)}`),
              scene.files?.[0]?.size && React.createElement("span", null, `💾 ${formatBytes(scene.files[0].size)}`),
              scene.date && React.createElement("span", null, `📅 ${scene.date}`),
              scene.files?.[0]?.video_codec && React.createElement("span", { className: "badge badge-dark" }, scene.files[0].video_codec.toUpperCase())
            ),
            React.createElement(
              "div",
              { className: "text-muted small" },
              React.createElement("span", { className: "sfm-reel-shortcut-hint" }, "💡 Double-click sides: ±10s seek · Wheel pull: next/prev · F: Fullscreen · Space: Play")
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
    function SceneCard({ scene, onPlay, isSelected, onToggleSelect }) {
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
    function SceneTableView({ scenes, onPlay, selectedIds, onToggleSelect, onSelectAll }) {
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
                    React.createElement("div", { className: "sfm-table-subtext" }, filename)
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
      const [playingScene, setPlayingScene] = useState(null);

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
                  files { path basename size duration }
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

      // Feature 2: Direct scenes filtering and sorting
      const filteredAndSortedScenes = useMemo(() => {
        if (!currentNode) return [];
        let list = [...currentNode.directScenes];

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

        list.sort((a, b) => {
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
        });

        return list;
      }, [currentNode, searchQuery, sceneSort]);

      const allDescendantIds = currentNode ? Array.from(currentNode.allSceneIds) : [];
      const currentFolderName = currentPath.split("/").filter(Boolean).pop() || "Root";

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
        if (!currentPath) return;
        setNotification(`Starting Stash filesystem scan for: ${currentPath}...`);
        try {
          const mutation = `
            mutation ScanPath($paths: [String!]) {
              metadataScan(input: { paths: $paths })
            }
          `;
          await gqlFetch(mutation, { paths: [currentPath] });
          setNotification(`Stash scan task triggered for "${currentPath}". Check Settings -> Tasks.`);
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

      const handleSelectAllFolderScenes = () => {
        const visibleIds = filteredAndSortedScenes.map((s) => s.id);
        const allInFolderSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSceneIds.has(id));
        setSelectedSceneIds((prev) => {
          const next = new Set(prev);
          if (allInFolderSelected) {
            visibleIds.forEach((id) => next.delete(id));
          } else {
            visibleIds.forEach((id) => next.add(id));
          }
          return next;
        });
      };

      const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

      return React.createElement(
        "div",
        { className: "sfm-workspace-overlay" },
        // Header
        React.createElement(
          "div",
          { className: "sfm-workspace-header" },
          React.createElement(
            "div",
            { className: "sfm-workspace-title" },
            React.createElement(IconFolder, { size: 22, color: "#88c0d0" }),
            React.createElement("span", { className: "ml-2" }, "Stash File Manager"),
            trie && React.createElement("span", { className: "badge badge-dark ml-2 text-muted small" }, `${trie.root.allSceneIds.size} total scenes`)
          ),
          onClose && React.createElement("button", { className: "sfm-workspace-close", onClick: onClose }, "✕ Close")
        ),
        // Scrollable Body
        React.createElement(
          "div",
          { className: "sfm-workspace-content" },
          // Unified Modern Command Bar (replaces redundant stacked toolbars)
          React.createElement(
            "div",
            { className: "sfm-unified-bar" },
            // Upper row: Path navigation, folder stats & primary actions
            React.createElement(
              "div",
              { className: "sfm-bar-top-row" },
              React.createElement(
                "div",
                { className: "sfm-breadcrumbs-wrap" },
                React.createElement(
                  "div",
                  { className: "btn-group btn-group-sm mr-2 sfm-nav-history-group" },
                  React.createElement(
                    "button",
                    {
                      className: "btn btn-sm btn-outline-secondary py-0 px-2",
                      onClick: handleGoBackInHistory,
                      disabled: historyStack.current.length === 0 && !currentPath,
                      title: "Go back to previous folder (or parent)",
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
                  "button",
                  { className: `sfm-crumb-btn ${!currentPath ? "sfm-crumb-active" : ""}`, onClick: () => navigateToFolder(""), title: "Return to Root" },
                  React.createElement(IconFolder, { size: 16, color: "#88c0d0" }),
                  React.createElement("span", { className: "ml-1" }, "Root")
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
                      },
                      seg
                    )
                  );
                }),
                React.createElement(
                  "span",
                  { className: "sfm-stat-pill ml-2" },
                  `${currentNode ? currentNode.directScenes.length : 0} direct · ${allDescendantIds.length} in tree (${formatBytes(currentNode?.totalSize)})`
                )
              ),
              React.createElement(
                "div",
                { className: "sfm-actions-group" },
                React.createElement(
                  "label",
                  { className: "sfm-checkbox-label" },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: hideEmpty,
                    onChange: (e) => handleToggleHideEmpty(e.target.checked),
                  }),
                  "Hide empty"
                ),
                currentPath &&
                  React.createElement(
                    "div",
                    { className: "btn-group mr-2" },
                    React.createElement(
                      "button",
                      { className: "btn btn-sm btn-outline-warning", onClick: () => setShowParserModal(true), title: "Parse Filenames with Regex" },
                      "🔍 Parse"
                    ),
                    React.createElement(
                      "button",
                      { className: "btn btn-sm btn-info", onClick: handleAutoDetect, title: "Auto-detect Studio & Performers from folder name" },
                      "⚡ Auto-Detect"
                    ),
                    React.createElement(
                      "button",
                      { className: "btn btn-sm btn-primary", onClick: () => setShowBatchModal(true), title: "Batch Edit Scenes" },
                      "✏️ Batch Edit"
                    )
                  ),
                currentPath &&
                  React.createElement(
                    "button",
                    { className: "btn btn-sm btn-outline-success", onClick: handleScanFolder, title: "Trigger Stash filesystem scan on this folder path" },
                    "📡 Scan Folder"
                  ),
                React.createElement(
                  "button",
                  { className: "btn btn-sm btn-outline-secondary", onClick: handleRescan, title: "Clear cache and rebuild tree" },
                  "🔄 Rescan"
                ),
                currentPath &&
                  React.createElement(
                    "button",
                    { className: "btn btn-sm btn-outline-info", onClick: openInNativeGrid, title: "Open in Stash Native Grid" },
                    "↗️ Grid"
                  )
              )
            ),
            // Lower row: Live search and sorting
            React.createElement(
              "div",
              { className: "sfm-bar-filter-row" },
              React.createElement(
                "div",
                { className: "sfm-search-wrap" },
                React.createElement("span", { className: "sfm-search-icon" }, "🔍"),
                React.createElement("input", {
                  type: "text",
                  className: "sfm-search-input",
                  placeholder: "Search folder or scenes by title, studio, performer...",
                  value: searchQuery,
                  onChange: (e) => setSearchQuery(e.target.value),
                }),
                searchQuery &&
                  React.createElement(
                    "button",
                    { className: "sfm-search-clear", onClick: () => setSearchQuery("") },
                    "×"
                  )
              ),
              React.createElement(
                "div",
                { className: "sfm-sort-group" },
                React.createElement("span", { className: "sfm-sort-label" }, "Scenes:"),
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
                React.createElement("span", { className: "sfm-sort-label ml-2" }, "Folders:"),
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
                ),

              )
            )
          ),
          notification &&
            React.createElement(
              "div",
              { className: "alert alert-info alert-dismissible fade show" },
              notification,
              React.createElement("button", { className: "close", onClick: () => setNotification("") }, "×")
            ),
          // Subfolders Section (Customizable Views: Cards, List, Detail Table)
          filteredAndSortedSubfolders.length > 0 &&
            React.createElement(
              "div",
              { className: "mb-4" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-2" },
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
                        React.createElement("span", { className: "sfm-slider-icon mr-1 text-muted small" }, "🔍"),
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
                        "田 Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `btn btn-sm ${folderViewMode === "list" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => { setIsSubfoldersCollapsed(false); handleSetFolderViewMode("list"); },
                          title: "Compact List View",
                        },
                        "☰ List"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `btn btn-sm ${folderViewMode === "detail" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => { setIsSubfoldersCollapsed(false); handleSetFolderViewMode("detail"); },
                          title: "Detail Table View",
                        },
                        "☷ Details"
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
                  { className: "row" },
                  filteredAndSortedSubfolders.map((folderName) => {
                    const childNode = currentNode.folders[folderName];
                    const count = childNode ? childNode.allSceneIds.size : 0;
                    const size = childNode ? formatBytes(childNode.totalSize) : "0 B";
                    const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName;
                    return React.createElement(
                      "div",
                      { key: folderName, className: "col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 mb-2" },
                      React.createElement(
                        "div",
                        {
                          className: "sfm-folder-list-item",
                          onClick: () => navigateToFolder(nextPath),
                          title: `${folderName} (${count} scenes, ${size})`,
                        },
                        React.createElement("div", { className: "sfm-folder-list-icon" }, React.createElement(IconFolderCard, { size: 18, color: "#81a1c1" })),
                        React.createElement("div", { className: "sfm-folder-list-name text-truncate font-weight-bold" }, folderName),
                        React.createElement("span", { className: "sfm-folder-list-badge" }, count)
                      )
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
                    React.createElement("span", null, `Files / Scenes (${filteredAndSortedScenes.length})`),
                    selectedSceneIds.size > 0 &&
                      React.createElement("span", { className: "badge badge-info ml-2" }, `${selectedSceneIds.size} selected`),
                    isFilesCollapsed &&
                      React.createElement("span", { className: "text-muted small ml-2 font-italic" }, "(collapsed)")
                  ),
                  !isFilesCollapsed &&
                    React.createElement(
                      "button",
                      {
                        className: "btn btn-sm btn-outline-secondary py-0 px-2 ml-2",
                        onClick: handleSelectAllFolderScenes,
                        title: "Select or deselect all visible scenes in folder",
                      },
                      filteredAndSortedScenes.every((s) => selectedSceneIds.has(s.id)) ? "Deselect All" : "Select All"
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
                          title: `Adjust scene thumbnail card size: ${sceneCardSize}px`,
                        },
                        React.createElement("span", { className: "sfm-slider-icon mr-1 text-muted small" }, "🔍"),
                        React.createElement("input", {
                          type: "range",
                          className: "sfm-size-slider",
                          min: 160,
                          max: 420,
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
                        "⊞ Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          className: `btn btn-sm ${viewMode === "list" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => handleToggleViewMode("list"),
                          title: "Detailed Table View",
                        },
                        "☰ Table"
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
                : React.createElement("button", { className: "btn btn-outline-secondary mt-2", onClick: () => navigateToFolder("") }, "Return to Root")
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
                  "span",
                  { className: "badge badge-info py-1 px-2 font-weight-bold" },
                  `${selectedSceneIds.size} selected`
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
                    "✏️ Bulk Edit"
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "btn btn-sm btn-outline-warning",
                      onClick: () => setShowParserModal(true),
                      title: "Regex parse selected scenes",
                    },
                    "🔍 Parse"
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
                    "↗️ Grid"
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "btn btn-sm btn-outline-light",
                      onClick: handleClearSelection,
                      title: "Clear selection",
                    },
                    "✕ Clear"
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
                ? (currentNode ? currentNode.directScenes.filter((s) => selectedSceneIds.has(s.id)) : [])
                : (currentNode ? currentNode.directScenes : []),
              onClose: () => setShowParserModal(false),
              onApplied: () => {
                handleClearSelection();
                handleRescan();
              },
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

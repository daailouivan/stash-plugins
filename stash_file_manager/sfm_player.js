(function () {
  "use strict";

  try {
    const SFM = window.__SFM__;
    if (!SFM || !SFM.React) {
      console.warn("[PathFileManager] window.__SFM__ is not ready for sfm_player.js.");
      return;
    }

    const {
      React,
      useState,
      useEffect,
      useMemo,
      useCallback,
      useRef,
      gqlFetch,
      formatBytes,
      formatDuration,
      formatSeconds,
      getAllDescendantScenes,
      resolveSceneFolder,
      normalizePath,
      buildRouteUrlForPath,
      parseQueryState,
      buildHashForPath,
      parseHashState,
      getNextSfmDepth,
      createShuffledQueue,
      sortScenesWithOrder,
      icons = {},
    } = SFM;

    const {
      IconFolder,
      IconArrowLeft,
      IconSmartphone,
      IconX,
      IconShuffle,
      IconGrid,
      IconCompass,
    } = icons;

    function isPluginRoute() {
      return Boolean(window.location?.pathname && window.location.pathname.startsWith("/plugin/file-manager"));
    }

    function buildPlayerUrl(path, view = null, sceneId = null) {
      if (isPluginRoute() && typeof buildRouteUrlForPath === "function") {
        return buildRouteUrlForPath(path, view, sceneId);
      }
      return buildHashForPath(path, view, sceneId);
    }

    function getCurrentLocationKey() {
      if (isPluginRoute()) {
        return `${window.location?.pathname || ""}${window.location?.search || ""}`;
      }
      return window.location?.hash || "";
    }

    function hasViewQueryParam() {
      if (isPluginRoute()) {
        return (window.location?.search || "").includes("view=");
      }
      return (window.location?.hash || "").includes("view=");
    }

    function FolderProfileView({
      folderName,
      currentFolderName,
      targetFolderPath,
      currentFolderPath: propFolderPath,
      displayFolderPath,
      scenes = [],
      trie: propTrie,
      currentScene,
      posterUrl,
      isForceMobile,
      isInsidePlayer = false,
      onToggleForceMobile,
      onSelectScene,
      onCloseProfile,
      onClose,
      onNavigateToDirectory,
      onPlayAll,
      onShuffleAll,
      onNavigateToFolder,
      onFolderChange,
      initialPage = 0,
      onPageChange,
      syncedSort,
      syncedShuffleSeed,
      onSortChange,
      onReshuffle,
    }) {
      const resolvedFolderName = currentFolderName || folderName || "";
      const incomingFolderPath =
        targetFolderPath !== undefined
          ? targetFolderPath
          : propFolderPath !== undefined
            ? propFolderPath
            : "";
      const handleCloseProfile = onCloseProfile || onClose;
      const resolvedTrie = propTrie || window.__SFM_GLOBAL_CACHE__?.trie || null;

      const [forceMobileInternal, setForceMobileInternal] = useState(() => {
        if (typeof isForceMobile === "boolean") return isForceMobile;
        try {
          return window.localStorage.getItem("sfm_force_mobile_view") === "true";
        } catch (e) {
          return false;
        }
      });

      const effectiveForceMobile =
        typeof isForceMobile === "boolean" && onToggleForceMobile ? isForceMobile : forceMobileInternal;

      const handleToggleMobile = useCallback(() => {
        if (onToggleForceMobile) {
          onToggleForceMobile();
        } else {
          setForceMobileInternal((prev) => {
            const next = !prev;
            try {
              window.localStorage.setItem("sfm_force_mobile_view", String(next));
            } catch (e) {}
            return next;
          });
        }
      }, [onToggleForceMobile]);

      const [activeTab, setActiveTab] = useState(() => (initialPage === 1 ? "explore" : "reels"));

      useEffect(() => {
        const target = initialPage === 1 ? "explore" : "reels";
        if (activeTab !== target) {
          setActiveTab(target);
        }
      }, [initialPage]);

      // Internal navigable path state: defaults to incomingFolderPath, updates when breadcrumbs clicked
      const [currentFolderPath, setCurrentFolderPath] = useState(incomingFolderPath || "");
      const [isSubfoldersExpanded, setIsSubfoldersExpanded] = useState(false);
      const [subfolderFilter, setSubfolderFilter] = useState("");

      useEffect(() => {
        setCurrentFolderPath(incomingFolderPath || "");
        setIsSubfoldersExpanded(false);
        setSubfolderFilter("");
      }, [incomingFolderPath]);

      // Resolve current folder node and list of child subfolders from PathTrie
      const currentNode = useMemo(() => {
        if (!resolvedTrie || typeof resolvedTrie.getNode !== "function") return null;
        return resolvedTrie.getNode(currentFolderPath);
      }, [resolvedTrie, currentFolderPath]);

      const childFolders = useMemo(() => {
        if (!currentNode || !currentNode.folders) return [];
        return Object.keys(currentNode.folders)
          .sort()
          .map((subName) => {
            const subNode = currentNode.folders[subName];
            const subPath = currentFolderPath ? `${currentFolderPath}/${subName}` : subName;
            const directCount = subNode && Array.isArray(subNode.directScenes) ? subNode.directScenes.length : 0;
            const totalCount = subNode && subNode.allSceneIds ? subNode.allSceneIds.size : directCount;
            return {
              name: subName,
              path: subPath,
              count: totalCount || directCount,
            };
          });
      }, [currentNode, currentFolderPath]);

      const displayedSubfolders = useMemo(() => {
        if (!subfolderFilter.trim()) return childFolders;
        const q = subfolderFilter.toLowerCase().trim();
        return childFolders.filter((cf) => cf.name.toLowerCase().includes(q));
      }, [childFolders, subfolderFilter]);

      const handleTabChange = useCallback(
        (tab) => {
          setActiveTab(tab);
          const viewName = tab === "explore" ? "discover" : "profile";
          // Profile view URL/hash must NOT contain sceneId so hitting back never replays the video
          const targetUrl = buildPlayerUrl(currentFolderPath, viewName, null);
          if (getCurrentLocationKey() !== targetUrl && window.history) {
            if (isInsidePlayer && typeof window.history.replaceState === "function") {
              const curDepth =
                window.history.state && typeof window.history.state.sfmDepth === "number"
                  ? window.history.state.sfmDepth
                  : 1;
              window.history.replaceState(
                { sfmPath: currentFolderPath, sfmView: viewName, inPlayerProfile: true, sfmDepth: curDepth },
                "",
                targetUrl
              );
            } else if (typeof window.history.pushState === "function") {
              const nextDepth = getNextSfmDepth();
              window.history.pushState(
                { sfmPath: currentFolderPath, sfmView: viewName, inPlayerProfile: false, sfmDepth: nextDepth },
                "",
                targetUrl
              );
            }
          }
          if (onPageChange) {
            onPageChange(tab === "explore" ? 1 : 0);
          }
        },
        [currentFolderPath, isInsidePlayer, onPageChange]
      );

      // Jump profile folder and remain in the video profile card
      const handleNavigateFolder = useCallback(
        (nextPath) => {
          const norm = normalizePath(nextPath);
          setCurrentFolderPath(norm);
          if (onFolderChange) {
            onFolderChange(norm);
          }
          const viewName = activeTab === "explore" ? "discover" : "profile";
          // Profile view URL/hash must NOT contain sceneId so hitting back never replays the video
          const targetUrl = buildPlayerUrl(norm, viewName, null);
          if (getCurrentLocationKey() !== targetUrl && window.history) {
            if (isInsidePlayer && typeof window.history.replaceState === "function") {
              const curDepth =
                window.history.state && typeof window.history.state.sfmDepth === "number"
                  ? window.history.state.sfmDepth
                  : 1;
              window.history.replaceState(
                { sfmPath: norm, sfmView: viewName, inPlayerProfile: true, sfmDepth: curDepth },
                "",
                targetUrl
              );
            } else if (typeof window.history.pushState === "function") {
              const nextDepth = getNextSfmDepth();
              window.history.pushState(
                { sfmPath: norm, sfmView: viewName, inPlayerProfile: false, sfmDepth: nextDepth },
                "",
                targetUrl
              );
            }
          }
        },
        [activeTab, isInsidePlayer, onFolderChange]
      );

      // Sync internal profile folder & tab with browser back/forward (pageback)
      useEffect(() => {
        const handleProfilePopstate = () => {
          const state = isPluginRoute() && typeof parseQueryState === "function"
            ? parseQueryState(window.location?.search || "")
            : parseHashState();
          if (state) {
            if (state.path !== undefined) {
              setCurrentFolderPath(state.path);
            }
            if (state.view === "discover") {
              setActiveTab("explore");
            } else if (state.view === "profile") {
              setActiveTab("reels");
            }
          }
        };
        window.addEventListener("popstate", handleProfilePopstate);
        return () => window.removeEventListener("popstate", handleProfilePopstate);
      }, []);

      // Include Sub-Folders toggle state for Folder Profile & Discover pages
      const [includeSubfolders, setIncludeSubfolders] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_profile_include_subfolders") === "true";
        } catch (e) {
          return false;
        }
      });

      const handleToggleSubfolders = useCallback(() => {
        setIncludeSubfolders((prev) => {
          const next = !prev;
          try {
            window.localStorage.setItem("sfm_profile_include_subfolders", String(next));
          } catch (e) {}
          return next;
        });
      }, []);

      // R3 Video Wall Sort & Randomize Synchronization
      const [profileSort, setProfileSort] = useState(() => {
        if (typeof syncedSort === "string" && syncedSort.trim()) {
          return syncedSort;
        }
        try {
          return window.localStorage.getItem("sfm_profile_scene_sort") || "date_desc";
        } catch (e) {
          return "date_desc";
        }
      });

      useEffect(() => {
        if (typeof syncedSort === "string" && syncedSort.trim()) {
          setProfileSort(syncedSort);
          try {
            window.localStorage.setItem("sfm_profile_scene_sort", syncedSort);
          } catch (e) {}
        }
      }, [syncedSort]);

      const [localShuffleSeed, setLocalShuffleSeed] = useState(1);
      const [localReshuffleOffset, setLocalReshuffleOffset] = useState(0);

      useEffect(() => {
        setLocalReshuffleOffset(0);
      }, [syncedShuffleSeed]);

      const effectiveSeed =
        syncedShuffleSeed !== undefined && syncedShuffleSeed !== null
          ? typeof syncedShuffleSeed === "number"
            ? syncedShuffleSeed + localReshuffleOffset
            : localReshuffleOffset > 0
              ? `${syncedShuffleSeed}:${localReshuffleOffset}`
              : syncedShuffleSeed
          : localShuffleSeed;

      const handleProfileSortChange = useCallback(
        (newSort) => {
          setProfileSort(newSort);
          try {
            window.localStorage.setItem("sfm_profile_scene_sort", newSort);
          } catch (e) {}
          if (typeof onSortChange === "function") {
            onSortChange(newSort);
          }
        },
        [onSortChange]
      );

      const handleReshuffle = useCallback(() => {
        if (typeof onReshuffle === "function") {
          onReshuffle();
        }
        if (syncedShuffleSeed !== undefined && syncedShuffleSeed !== null) {
          setLocalReshuffleOffset((prev) => prev + 1);
        } else {
          setLocalShuffleSeed((prev) => prev + 1);
        }
      }, [onReshuffle, syncedShuffleSeed]);

      // Resolve effective scenes for this folder profile (direct vs recursive subfolders)
      // When direct scenes are empty (e.g. parent directories or root), auto-fallback to descendant scenes so the wall never turns black!
      const effectiveScenes = useMemo(() => {
        if (currentFolderPath === (incomingFolderPath || "") && Array.isArray(scenes) && !includeSubfolders) {
          return scenes;
        }
        if (resolvedTrie && typeof resolvedTrie.getNode === "function") {
          const node = resolvedTrie.getNode(currentFolderPath);
          if (node) {
            if (includeSubfolders) {
              const allDesc = getAllDescendantScenes(node);
              if (allDesc.length > 0) return allDesc;
            } else if (Array.isArray(node.directScenes) && node.directScenes.length > 0) {
              return node.directScenes;
            } else {
              // Auto-fallback: if direct scenes are empty in this folder, include subfolder scenes so video wall never stays black
              const descendants = getAllDescendantScenes(node);
              if (descendants.length > 0) {
                return descendants;
              }
            }
            if (currentFolderPath === (incomingFolderPath || "") && Array.isArray(scenes) && scenes.length > 0) {
              return scenes;
            }
            return [];
          }
        }
        return Array.isArray(scenes) ? scenes : [];
      }, [resolvedTrie, currentFolderPath, incomingFolderPath, includeSubfolders, scenes]);

      // Sorted profile scenes for Reels & Videos view (synchronized with FileManagerView via sortScenesWithOrder)
      const sortedProfileScenes = useMemo(() => {
        if (!Array.isArray(effectiveScenes)) return [];
        return sortScenesWithOrder(effectiveScenes, profileSort, effectiveSeed);
      }, [effectiveScenes, profileSort, effectiveSeed]);

      // Retrieve ALL scenes under root across the entire library for Explore
      const allRootScenes = useMemo(() => {
        if (Array.isArray(window.__SFM_GLOBAL_CACHE__?.scenes) && window.__SFM_GLOBAL_CACHE__.scenes.length > 0) {
          return window.__SFM_GLOBAL_CACHE__.scenes;
        }
        if (resolvedTrie?.root) {
          const descendants = getAllDescendantScenes(resolvedTrie.root);
          if (descendants.length > 0) return descendants;
        }
        return scenes || [];
      }, [resolvedTrie, scenes]);

      const [exploreScenes, setExploreScenes] = useState([]);
      const [visibleWallCount, setVisibleWallCount] = useState(36);
      const [visibleExploreCount, setVisibleExploreCount] = useState(36);
      const [isExploreLoading, setIsExploreLoading] = useState(false);

      const wallSentinelRef = useRef(null);
      const exploreSentinelRef = useRef(null);
      const profileContainerRef = useRef(null);

      // Reset visible counts when current folder, subfolders, sort, or reshuffle seed changes
      useEffect(() => {
        setVisibleWallCount(36);
      }, [currentFolderPath, includeSubfolders, effectiveScenes, profileSort, effectiveSeed]);

      useEffect(() => {
        setVisibleExploreCount(36);
      }, [exploreScenes]);

      // Discover Scene loader: displays ALL scenes under root in a randomized mosaic
      const loadExploreScenes = useCallback(() => {
        setIsExploreLoading(true);
        const pool = allRootScenes;
        if (!Array.isArray(pool) || pool.length === 0) {
          setExploreScenes([]);
          setVisibleExploreCount(36);
          setIsExploreLoading(false);
          return;
        }
        const shuffled = [...pool];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        setExploreScenes(shuffled);
        setVisibleExploreCount(36);
        setIsExploreLoading(false);
      }, [allRootScenes]);

      useEffect(() => {
        if (allRootScenes.length > 0 && exploreScenes.length === 0) {
          loadExploreScenes();
        }
      }, [allRootScenes, loadExploreScenes, exploreScenes.length]);

      // Batch loaders for infinite scrolling
      const handleLoadMoreWall = useCallback(() => {
        setVisibleWallCount((prev) => Math.min(prev + 36, sortedProfileScenes.length));
      }, [sortedProfileScenes.length]);

      const handleLoadMoreExplore = useCallback(() => {
        setVisibleExploreCount((prev) => Math.min(prev + 36, exploreScenes.length));
      }, [exploreScenes.length]);

      // IntersectionObserver for Reels tab bottom sentinel button
      useEffect(() => {
        if (activeTab !== "reels" || typeof IntersectionObserver === "undefined") return;
        const sentinel = wallSentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
          (entries) => {
            const first = entries[0];
            if (first && first.isIntersecting && visibleWallCount < sortedProfileScenes.length) {
              handleLoadMoreWall();
            }
          },
          { root: null, rootMargin: "400px 0px", threshold: 0.01 }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
      }, [activeTab, visibleWallCount, sortedProfileScenes.length, handleLoadMoreWall]);

      // IntersectionObserver for Explore tab bottom sentinel button
      useEffect(() => {
        if (activeTab !== "explore" || typeof IntersectionObserver === "undefined") return;
        const sentinel = exploreSentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
          (entries) => {
            const first = entries[0];
            if (first && first.isIntersecting && visibleExploreCount < exploreScenes.length) {
              handleLoadMoreExplore();
            }
          },
          { root: null, rootMargin: "400px 0px", threshold: 0.01 }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
      }, [activeTab, visibleExploreCount, exploreScenes.length, handleLoadMoreExplore]);

      // Scroll listener fallback on profileContainerRef
      useEffect(() => {
        const el = profileContainerRef.current;
        if (!el) return;

        const handleScroll = () => {
          const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (scrollBottom < 400) {
            if (activeTab === "reels" && visibleWallCount < sortedProfileScenes.length) {
              handleLoadMoreWall();
            } else if (activeTab === "explore" && visibleExploreCount < exploreScenes.length) {
              handleLoadMoreExplore();
            }
          }
        };

        el.addEventListener("scroll", handleScroll, { passive: true });
        return () => el.removeEventListener("scroll", handleScroll);
      }, [
        activeTab,
        visibleWallCount,
        sortedProfileScenes.length,
        visibleExploreCount,
        exploreScenes.length,
        handleLoadMoreWall,
        handleLoadMoreExplore,
      ]);

      // Touch gesture coordinates for horizontal swipe left/right
      const touchStartXRef = useRef(0);
      const touchStartYRef = useRef(0);
      const touchStartTimeRef = useRef(0);

      const handleTouchStart = (e) => {
        e.stopPropagation();
        if (!e.touches || e.touches.length === 0) return;
        touchStartXRef.current = e.touches[0].clientX;
        touchStartYRef.current = e.touches[0].clientY;
        touchStartTimeRef.current = Date.now();
      };

      const handleTouchEnd = (e) => {
        e.stopPropagation();
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const touch = e.changedTouches[0];
        const deltaX = touch.clientX - touchStartXRef.current;
        const deltaY = touch.clientY - touchStartYRef.current;
        const deltaTime = Date.now() - touchStartTimeRef.current;

        if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25 && deltaTime < 600) {
          if (deltaX < 0 && activeTab === "reels") {
            handleTabChange("explore");
          } else if (deltaX > 0 && activeTab === "explore") {
            handleTabChange("reels");
          }
        }
      };

      // Desktop & Controller navigation: Esc to close profile, Left/Right arrows to switch tabs
      useEffect(() => {
        const handleKeyDown = (e) => {
          if (["input", "textarea", "select"].includes(e.target.tagName?.toLowerCase())) return;
          if (e.key === "Escape") {
            if (handleCloseProfile) {
              e.preventDefault();
              handleCloseProfile();
            }
          } else if (
            e.key === "ArrowLeft" ||
            e.key === "Left" ||
            e.code === "ArrowLeft" ||
            e.keyCode === 37 ||
            e.key === "PageLeft" ||
            e.key === "MediaTrackPrevious"
          ) {
            e.preventDefault();
            handleTabChange("reels");
          } else if (
            e.key === "ArrowRight" ||
            e.key === "Right" ||
            e.code === "ArrowRight" ||
            e.keyCode === 39 ||
            e.key === "PageRight" ||
            e.key === "MediaTrackNext"
          ) {
            e.preventDefault();
            handleTabChange("explore");
          }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
      }, [handleCloseProfile, handleTabChange]);

      // Selection handler for explore scene: plays scene in player
      const handleSelectExploreScene = (s) => {
        if (!s || !onSelectScene) return;
        onSelectScene(s, exploreScenes);
      };

      const stats = useMemo(() => {
        let totalSize = 0;
        let totalDuration = 0;
        const resCounts = {};

        for (const s of effectiveScenes) {
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
          count: effectiveScenes.length,
          formattedSize: formatBytes(totalSize),
          formattedDuration: durationStr,
          resCounts,
        };
      }, [effectiveScenes]);

      const displayName = useMemo(() => {
        if (!currentFolderPath) return resolvedFolderName || "Root";
        const segs = currentFolderPath.split("/").filter(Boolean);
        return segs.length > 0 ? segs[segs.length - 1] : resolvedFolderName || "Root";
      }, [currentFolderPath, resolvedFolderName]);

      const resolvedPosterUrl = useMemo(() => {
        if (posterUrl) return posterUrl;
        if (currentScene?.paths?.screenshot) return currentScene.paths.screenshot;
        if (currentScene?.id) return `/scene/${currentScene.id}/screenshot`;
        const first = sortedProfileScenes?.[0] || effectiveScenes?.[0] || scenes?.[0];
        if (first?.paths?.screenshot) return first.paths.screenshot;
        if (first?.id) return `/scene/${first.id}/screenshot`;
        return "";
      }, [posterUrl, currentScene, sortedProfileScenes, effectiveScenes, scenes]);

      // Navigable Breadcrumbs renderer with inline subfolders indicator
      const renderBreadcrumbs = (path, onNav, isNavTitle = false) => {
        const segs = path ? path.split("/").filter(Boolean) : [];
        return React.createElement(
          "nav",
          {
            className: `sfm-profile-breadcrumbs ${isNavTitle ? "sfm-profile-nav-breadcrumbs" : "sfm-profile-bio-breadcrumbs"} d-inline-flex align-items-center flex-wrap`,
            "aria-label": "Folder path",
          },
          React.createElement(
            "button",
            {
              type: "button",
              className: `btn btn-link sfm-profile-crumb-btn ${segs.length === 0 ? "active" : ""}`,
              onClick: (e) => {
                e.stopPropagation();
                onNav("");
              },
              title: "Root directory (/)",
            },
            React.createElement(IconFolder, { size: 12, className: "mr-1 text-info flex-shrink-0" }),
            React.createElement("span", null, "/")
          ),
          segs.map((seg, i) => {
            const segPath = segs.slice(0, i + 1).join("/");
            const isLast = i === segs.length - 1;
            return React.createElement(
              React.Fragment,
              { key: segPath },
              React.createElement("span", { className: "sfm-profile-crumb-sep" }, "/"),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: `btn btn-link sfm-profile-crumb-btn ${isLast ? "active" : ""}`,
                  onClick: (e) => {
                    e.stopPropagation();
                    onNav(segPath);
                  },
                  title: `Navigate to /${segPath}`,
                },
                seg
              )
            );
          })
        );
      };

      return React.createElement(
        "div",
        {
          ref: profileContainerRef,
          className: `sfm-folder-profile-page sfm-profile-overlay ${isInsidePlayer ? "sfm-folder-profile-in-player" : ""} ${effectiveForceMobile ? "sfm-profile-force-mobile" : ""}`,
          onClick: (e) => e.stopPropagation(),
          onTouchStart: handleTouchStart,
          onTouchEnd: handleTouchEnd,
        },
        // 1. Sticky Navigation Top Bar (Un-crowded layout with spacious actions)
        React.createElement(
          "div",
          { className: "sfm-profile-nav-bar d-flex align-items-center justify-content-between" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "btn btn-sm btn-outline-info py-1 px-3 d-inline-flex align-items-center sfm-profile-back-btn mr-3",
              onClick: handleCloseProfile,
              title: isInsidePlayer ? "Back to Video Player (Esc)" : "Back to File Manager (Esc)",
            },
            React.createElement(IconArrowLeft, { size: 14, className: "mr-1" }),
            React.createElement(
              "span",
              { className: "font-weight-bold sfm-btn-label-desktop" },
              isInsidePlayer ? "Back to Video" : "Back to Files"
            ),
            React.createElement("span", { className: "font-weight-bold sfm-btn-label-mobile" }, "Back")
          ),
          React.createElement(
            "div",
            { className: "sfm-profile-nav-title d-flex align-items-center text-truncate mx-2 flex-grow-1" },
            renderBreadcrumbs(currentFolderPath, handleNavigateFolder, true)
          ),
          React.createElement(
            "div",
            { className: "d-flex align-items-center sfm-profile-nav-actions flex-shrink-0" },
            // Include Sub-Folders Toggle Button
            React.createElement(
              "button",
              {
                type: "button",
                className: `btn btn-sm ${includeSubfolders ? "btn-info font-weight-bold" : "btn-outline-secondary"} py-1 px-3 d-inline-flex align-items-center sfm-profile-subfolders-btn`,
                onClick: handleToggleSubfolders,
                title: includeSubfolders
                  ? "Include Sub-Folders: ON — Showing all scenes in folder hierarchy"
                  : "Include Sub-Folders: OFF — Showing direct scenes in folder only",
              },
              React.createElement("span", { className: "mr-1 font-weight-bold" }, includeSubfolders ? "✓" : "○"),
              React.createElement("span", { className: "sfm-btn-label-desktop" }, "Sub-Folders"),
              React.createElement("span", { className: "sfm-btn-label-mobile" }, "Subs")
            ),
            // Force Mobile View Toggle Button
            React.createElement(
              "button",
              {
                type: "button",
                className: `btn btn-sm ${effectiveForceMobile ? "btn-info font-weight-bold" : "btn-outline-secondary"} py-1 px-3 d-inline-flex align-items-center sfm-profile-mode-btn`,
                onClick: handleToggleMobile,
                title: effectiveForceMobile
                  ? "Switch to Fullscreen Desktop View"
                  : "Switch to Mobile Phone View (Instagram/TikTok 3-Column Wall)",
              },
              React.createElement(IconSmartphone, { size: 14, className: "mr-1" }),
              React.createElement(
                "span",
                { className: "sfm-btn-label-desktop" },
                effectiveForceMobile ? "Desktop Mode" : "Mobile View"
              ),
              React.createElement(
                "span",
                { className: "sfm-btn-label-mobile" },
                effectiveForceMobile ? "Desktop" : "Mobile"
              )
            ),
            // File Manager button (explicitly navigates File Manager to currentFolderPath)
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-sm btn-outline-secondary py-1 px-3 d-inline-flex align-items-center sfm-profile-fm-btn",
                onClick: () => {
                  if (onNavigateToDirectory) {
                    onNavigateToDirectory(currentFolderPath);
                  } else if (onNavigateToFolder) {
                    onNavigateToFolder(currentFolderPath);
                  }
                },
                title: `Open "${currentFolderPath || "Root"}" in File Manager`,
              },
              React.createElement(IconFolder, { size: 13, className: "mr-1" }),
              React.createElement("span", { className: "sfm-btn-label-desktop" }, "File Manager"),
              React.createElement("span", { className: "sfm-btn-label-mobile" }, "Files")
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-sm btn-outline-secondary py-1 px-2 d-inline-flex align-items-center justify-content-center sfm-profile-close-btn",
                onClick: handleCloseProfile,
                title: "Close Profile",
              },
              React.createElement(IconX, { size: 14 })
            )
          )
        ),

        // Main Profile Content Container (Mobile-framed when force mobile, web-centered on desktop)
        React.createElement(
          "div",
          { className: `sfm-profile-main-container ${effectiveForceMobile ? "sfm-profile-mobile-container" : ""}` },
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
                  src: resolvedPosterUrl,
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
            // Folder Bio: Dedicated clean lines for Title, Breadcrumb Path, and Badges (Un-crowded)
            React.createElement(
              "div",
              { className: "sfm-profile-bio-box mb-3" },
              React.createElement("h2", { className: "sfm-profile-title mb-2 font-weight-bold text-light" }, displayName),
              // Dedicated Breadcrumbs Path Line
              React.createElement(
                "div",
                { className: "sfm-profile-bio-path-wrap mb-2" },
                renderBreadcrumbs(currentFolderPath, handleNavigateFolder, false)
              ),
              // Collapsible Subfolders Section (Collapsed by default, eliminates clutter and redundancy)
              childFolders.length > 0 &&
                React.createElement(
                  "div",
                  { className: "sfm-profile-subfolders-section mb-3" },
                  React.createElement(
                    "div",
                    {
                      className: "sfm-profile-subfolders-toggle d-flex align-items-center justify-content-between p-2",
                      role: "button",
                      tabIndex: 0,
                      onClick: (e) => {
                        e.stopPropagation();
                        setIsSubfoldersExpanded((prev) => !prev);
                      },
                      title: isSubfoldersExpanded ? "Click to collapse subfolders" : "Click to expand subfolders",
                    },
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center" },
                      React.createElement(
                        "span",
                        { className: "sfm-collapse-icon mr-2 text-info font-weight-bold" },
                        isSubfoldersExpanded ? "▼" : "▶"
                      ),
                      React.createElement(IconFolder, { size: 14, className: "mr-2 text-info flex-shrink-0" }),
                      React.createElement(
                        "span",
                        { className: "font-weight-bold text-light small mr-2" },
                        `Subfolders in ${displayName}`
                      ),
                      React.createElement(
                        "span",
                        { className: "badge badge-dark text-muted font-weight-normal py-0 px-2" },
                        `${childFolders.length}`
                      )
                    ),
                    React.createElement(
                      "span",
                      { className: "small text-muted" },
                      isSubfoldersExpanded ? "Hide ▲" : "Show ▼"
                    )
                  ),
                  isSubfoldersExpanded &&
                    React.createElement(
                      "div",
                      { className: "sfm-profile-subfolders-body p-2" },
                      childFolders.length > 8 &&
                        React.createElement(
                          "div",
                          { className: "sfm-subfolder-filter-wrap mb-2" },
                          React.createElement("input", {
                            type: "text",
                            className: "form-control form-control-sm sfm-subfolder-filter-input",
                            placeholder: `Filter ${childFolders.length} subfolders...`,
                            value: subfolderFilter,
                            onChange: (e) => setSubfolderFilter(e.target.value),
                            onClick: (e) => e.stopPropagation(),
                          })
                        ),
                      React.createElement(
                        "div",
                        { className: "sfm-profile-subfolders-pills d-flex align-items-center flex-wrap gap-2" },
                        displayedSubfolders.map((cf) =>
                          React.createElement(
                            "button",
                            {
                              key: cf.path,
                              type: "button",
                              className: "btn btn-sm sfm-subfolder-pill-btn d-inline-flex align-items-center",
                              onClick: (e) => {
                                e.stopPropagation();
                                handleNavigateFolder(cf.path);
                              },
                              title: `Open "${cf.name}" (${cf.count} scenes)`,
                            },
                            React.createElement(IconFolder, { size: 12, className: "mr-1 text-info" }),
                            React.createElement("span", { className: "font-weight-bold mr-1" }, cf.name),
                            React.createElement(
                              "span",
                              { className: "badge badge-dark text-muted font-weight-normal py-0 px-1 ml-1" },
                              `${cf.count}`
                            )
                          )
                        ),
                        displayedSubfolders.length === 0 &&
                          React.createElement(
                            "span",
                            { className: "small text-muted py-1" },
                            `No subfolders match "${subfolderFilter}"`
                          )
                      )
                    )
                ),
              // Dedicated Chips & Subfolders Line
              React.createElement(
                "div",
                { className: "sfm-profile-bio-chips-wrap d-flex align-items-center flex-wrap gap-2 mb-3" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `badge sfm-badge-btn ${includeSubfolders ? "sfm-state-active" : "sfm-state-inactive"} cursor-pointer`,
                    onClick: handleToggleSubfolders,
                    title: includeSubfolders
                      ? "Include Sub-Folders: ON — Click to show direct scenes only"
                      : "Include Sub-Folders: OFF — Click to include all sub-folders",
                  },
                  React.createElement("span", { className: "mr-1 font-weight-bold" }, includeSubfolders ? "✓" : "○"),
                  "Sub-Folders"
                ),
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
                  onClick: () => {
                    if (typeof onPlayAll === "function") {
                      onPlayAll(sortedProfileScenes);
                    } else if (typeof onSelectScene === "function" && sortedProfileScenes.length > 0) {
                      onSelectScene(sortedProfileScenes[0], sortedProfileScenes);
                    }
                  },
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
                  onClick: () => {
                    if (typeof onShuffleAll === "function") {
                      onShuffleAll(sortedProfileScenes);
                    } else if (typeof onSelectScene === "function" && effectiveScenes.length > 0) {
                      const q = createShuffledQueue(effectiveScenes, effectiveScenes[0], effectiveSeed);
                      if (q.length > 0) onSelectScene(q[0], q);
                    }
                  },
                  title: "Shuffle all videos in directory",
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
                    const filter = { type: "path", value: currentFolderPath, modifier: "MATCHES_REGEX" };
                    window.open(`/scenes?c=${encodeURIComponent(JSON.stringify(filter))}`, "_blank");
                  },
                  title: "Open in Stash scene grid (new tab)",
                },
                React.createElement(IconGrid, { size: 13, className: "mr-1" }),
                "Stash"
              )
            )
          ),

          // 3. Tab Bar Header: Dual-Tab (Reels & Videos vs Explore)
          React.createElement(
            "div",
            { className: "sfm-profile-wall-tab-bar" },
            // Tab 1: Reels & Videos
            React.createElement(
              "button",
              {
                type: "button",
                className: `sfm-profile-tab-btn ${activeTab === "reels" ? "sfm-profile-tab-active" : "sfm-profile-tab-inactive"} d-flex align-items-center justify-content-center`,
                onClick: () => handleTabChange("reels"),
                title: "Directory Video Wall (Swipe right)",
              },
              React.createElement("span", { className: "mr-1 mr-sm-2 font-weight-bold" }, "▦"),
              React.createElement(
                "span",
                { className: "font-weight-bold text-uppercase letter-spacing-1 small sfm-tab-text" },
                "REELS & VIDEOS"
              ),
              React.createElement(
                "span",
                { className: "badge badge-dark ml-2 sfm-tab-count-badge" },
                sortedProfileScenes.length
              )
            ),
            // Divider
            React.createElement("div", { className: "sfm-profile-tab-divider" }),
            // Tab 2: Explore
            React.createElement(
              "button",
              {
                type: "button",
                className: `sfm-profile-tab-btn ${activeTab === "explore" ? "sfm-profile-tab-active" : "sfm-profile-tab-inactive"} d-flex align-items-center justify-content-center`,
                onClick: () => handleTabChange("explore"),
                title: "Explore Library Mosaic (All scenes under root randomly)",
              },
              React.createElement(IconCompass, { size: 14, className: "mr-1 mr-sm-2" }),
              React.createElement(
                "span",
                { className: "font-weight-bold text-uppercase letter-spacing-1 small sfm-tab-text" },
                "EXPLORE"
              ),
              React.createElement(
                "span",
                { className: "badge badge-info ml-2 sfm-tab-explore-badge" },
                allRootScenes.length
              )
            )
          ),

          // 4. Content Area: Either Reels Video Wall (with Synchronized Sort & Randomize) OR Explore Mosaic Grid
          activeTab === "reels"
            ? React.createElement(
                React.Fragment,
                null,
                // Reels Toolbar: Folder Name & Scene Count on Left, Synchronized Sort Selector + Reshuffle on Right
                React.createElement(
                  "div",
                  { className: "sfm-reels-toolbar d-flex align-items-center justify-content-between px-3 py-2" },
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center text-truncate mr-2" },
                    React.createElement(IconFolder, { size: 14, color: "#88c0d0", className: "mr-2 flex-shrink-0" }),
                    React.createElement(
                      "span",
                      { className: "small font-weight-bold text-light text-truncate" },
                      displayName
                    ),
                    React.createElement(
                      "span",
                      { className: "badge badge-dark ml-2 text-muted flex-shrink-0" },
                      `${sortedProfileScenes.length} videos`
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center sfm-profile-sort-wrap flex-shrink-0" },
                    React.createElement("span", { className: "sfm-sort-label mr-2 text-muted small" }, "Sort:"),
                    React.createElement(
                      "select",
                      {
                        className: "sfm-sort-select sfm-profile-sort-select",
                        value: profileSort,
                        onChange: (e) => handleProfileSortChange(e.target.value),
                        title: "Sort Profile Videos",
                      },
                      ((window.__SFM__?.SCENE_SORT_OPTIONS || []).length > 0
                        ? window.__SFM__.SCENE_SORT_OPTIONS
                        : [
                            { value: "date_desc", label: "Date (Newest)" },
                            { value: "date_asc", label: "Date (Oldest)" },
                            { value: "title_asc", label: "Title (A-Z)" },
                            { value: "title_desc", label: "Title (Z-A)" },
                            { value: "filename_asc", label: "Filename (A-Z)" },
                            { value: "filename_desc", label: "Filename (Z-A)" },
                            { value: "studio_asc", label: "Studio (A-Z)" },
                            { value: "studio_desc", label: "Studio (Z-A)" },
                            { value: "code_asc", label: "Code (A-Z)" },
                            { value: "code_desc", label: "Code (Z-A)" },
                            { value: "performers_asc", label: "Performers (A-Z)" },
                            { value: "performers_desc", label: "Performers (Z-A)" },
                            { value: "organized_desc", label: "Organized (Yes First)" },
                            { value: "organized_asc", label: "Organized (No First)" },
                            { value: "rating_desc", label: "Rating (Highest)" },
                            { value: "rating_asc", label: "Rating (Lowest)" },
                            { value: "duration_desc", label: "Duration (Longest)" },
                            { value: "duration_asc", label: "Duration (Shortest)" },
                            { value: "size_desc", label: "Size (Largest)" },
                            { value: "size_asc", label: "Size (Smallest)" },
                            { value: "resolution_desc", label: "Resolution (Highest)" },
                            { value: "resolution_asc", label: "Resolution (Lowest)" },
                            { value: "play_count_desc", label: "Play Count (Most)" },
                            { value: "play_count_asc", label: "Play Count (Least)" },
                            { value: "o_counter_desc", label: "O-Counter (Most)" },
                            { value: "o_counter_asc", label: "O-Counter (Least)" },
                            { value: "created_at_desc", label: "Created (Newest)" },
                            { value: "created_at_asc", label: "Created (Oldest)" },
                            { value: "updated_at_desc", label: "Updated (Newest)" },
                            { value: "updated_at_asc", label: "Updated (Oldest)" },
                            { value: "last_played_at_desc", label: "Last Played (Recent)" },
                            { value: "last_played_at_asc", label: "Last Played (Oldest)" },
                            { value: "director_asc", label: "Director (A-Z)" },
                            { value: "director_desc", label: "Director (Z-A)" },
                            { value: "tags_asc", label: "Tags (A-Z)" },
                            { value: "tags_desc", label: "Tags (Z-A)" },
                            { value: "bitrate_desc", label: "Bitrate (Highest)" },
                            { value: "bitrate_asc", label: "Bitrate (Lowest)" },
                            { value: "random", label: "Random (Shuffle)" },
                          ]
                      ).map((opt) =>
                        React.createElement("option", { key: opt.value, value: opt.value }, opt.label)
                      )
                    ),
                    profileSort === "random" &&
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-sm btn-outline-info ml-2 py-0 px-2 d-inline-flex align-items-center sfm-profile-reshuffle-btn",
                          onClick: handleReshuffle,
                          title: "Reshuffle Video Wall order",
                        },
                        React.createElement(IconShuffle, { size: 12, className: "mr-1" }),
                        "Reshuffle"
                      )
                  )
                ),
                React.createElement(
                  "div",
                  { className: "sfm-profile-wall-grid sfm-tab-content-reels" },
                  sortedProfileScenes.slice(0, visibleWallCount).map((s) => {
                    const isCurrent = s.id === currentScene?.id;
                    const sPoster = s.paths?.screenshot || `/scene/${s.id}/screenshot`;
                    const sTitle = s.title || s.files?.[0]?.basename || `Scene #${s.id}`;
                    const sDuration = formatDuration(s.files?.[0]?.duration);
                    const sHeight = s.files?.[0]?.height;
                    const sRes =
                      sHeight >= 2160
                        ? "4K"
                        : sHeight >= 1440
                          ? "1440p"
                          : sHeight >= 1080
                            ? "1080p"
                            : sHeight >= 720
                              ? "720p"
                              : "";

                    return React.createElement(
                      "div",
                      {
                        key: s.id,
                        className: `sfm-wall-tile ${isCurrent ? "sfm-wall-tile-active" : ""}`,
                        onClick: () => {
                          if (onSelectScene) {
                            onSelectScene(s, sortedProfileScenes);
                          }
                        },
                        title: `Play: ${sTitle}`,
                      },
                      React.createElement("img", {
                        src: sPoster,
                        className: "sfm-wall-tile-img",
                        alt: sTitle,
                        loading: "lazy",
                      }),
                      isCurrent &&
                        React.createElement("div", { className: "sfm-wall-tile-playing" }, "▶ PLAYING"),
                      sRes && React.createElement("div", { className: "sfm-wall-tile-res" }, sRes),
                      React.createElement(
                        "div",
                        { className: "sfm-wall-tile-views" },
                        React.createElement("span", { className: "mr-1", style: { fontSize: "0.65rem" } }, "▶"),
                        React.createElement("span", null, sDuration)
                      ),
                      React.createElement(
                        "div",
                        { className: "sfm-wall-tile-hover-overlay" },
                        React.createElement("div", { className: "sfm-wall-tile-hover-center" }, "▶"),
                        React.createElement("div", { className: "sfm-wall-tile-hover-title" }, sTitle)
                      )
                    );
                  })
                ),
                React.createElement(
                  "div",
                  {
                    ref: wallSentinelRef,
                    className: "sfm-infinite-scroll-bottom text-center my-4 py-3",
                  },
                  visibleWallCount < sortedProfileScenes.length
                    ? React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-sm btn-outline-info px-4 py-2 font-weight-bold sfm-infinite-load-btn",
                          onClick: handleLoadMoreWall,
                          title: "Load more scenes (or scroll down)",
                        },
                        React.createElement("span", { className: "mr-2" }, "↓"),
                        `Load More Scenes (Showing ${Math.min(visibleWallCount, sortedProfileScenes.length)} of ${sortedProfileScenes.length})`
                      )
                    : sortedProfileScenes.length > 0 &&
                        React.createElement(
                          "div",
                          { className: "text-muted small font-weight-bold" },
                          `✓ All ${sortedProfileScenes.length} scenes loaded`
                        )
                )
              )
            : React.createElement(
                React.Fragment,
                null,
                React.createElement(
                  "div",
                  { className: "sfm-explore-container sfm-tab-content-explore d-flex flex-column flex-grow-1" },
                  React.createElement(
                    "div",
                    { className: "sfm-explore-toolbar d-flex align-items-center justify-content-between px-3 py-2" },
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center text-truncate mr-2" },
                      React.createElement(IconCompass, { size: 14, color: "#88c0d0", className: "mr-2 flex-shrink-0" }),
                      React.createElement(
                        "span",
                        { className: "small font-weight-bold text-light text-truncate" },
                        "Explore Library Mosaic (Random)"
                      ),
                      React.createElement(
                        "span",
                        { className: "badge badge-dark ml-2 text-muted flex-shrink-0" },
                        `${exploreScenes.length} scenes`
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className:
                          "btn btn-sm btn-outline-info py-0 px-2 d-inline-flex align-items-center sfm-explore-refresh-btn font-weight-bold flex-shrink-0",
                        onClick: loadExploreScenes,
                        disabled: isExploreLoading,
                        title: "Shuffle and re-arrange all library scenes randomly",
                      },
                      React.createElement(IconShuffle, { size: 12, className: "mr-1" }),
                      isExploreLoading ? "Shuffling..." : "Shuffle Feed"
                    )
                  ),
                  isExploreLoading && exploreScenes.length === 0
                    ? React.createElement(
                        "div",
                        { className: "text-center py-5 text-muted" },
                        React.createElement("div", { className: "spinner-border spinner-border-sm text-info mr-2" }),
                        "Loading Explore Feed..."
                      )
                    : React.createElement(
                        "div",
                        { className: "sfm-explore-grid" },
                        exploreScenes.slice(0, visibleExploreCount).map((s, idx) => {
                          const isFeatured = idx % 12 === 0 || idx % 12 === 7;
                          const isCurrent = s.id === currentScene?.id;
                          const sPoster = s.paths?.screenshot || `/scene/${s.id}/screenshot`;
                          const sTitle = s.title || s.files?.[0]?.basename || `Scene #${s.id}`;
                          const sDuration = formatDuration(s.files?.[0]?.duration);
                          const sHeight = s.files?.[0]?.height;
                          const sRes =
                            sHeight >= 2160
                              ? "4K"
                              : sHeight >= 1440
                                ? "1440p"
                                : sHeight >= 1080
                                  ? "1080p"
                                  : sHeight >= 720
                                    ? "720p"
                                    : "";
                          const studioName = s.studio?.name;

                          return React.createElement(
                            "div",
                            {
                              key: `explore-${s.id}-${idx}`,
                              className: `sfm-explore-tile ${isFeatured ? "sfm-explore-tile-featured" : ""} ${isCurrent ? "sfm-explore-tile-active" : ""}`,
                              onClick: () => handleSelectExploreScene(s),
                              title: `Play: ${sTitle}`,
                            },
                            React.createElement("img", {
                              src: sPoster,
                              className: "sfm-explore-tile-img",
                              alt: sTitle,
                              loading: "lazy",
                            }),
                            isFeatured &&
                              React.createElement(
                                "div",
                                { className: "sfm-explore-tile-featured-badge" },
                                "★ FEATURED"
                              ),
                            isCurrent &&
                              React.createElement("div", { className: "sfm-wall-tile-playing" }, "▶ PLAYING"),
                            sRes && React.createElement("div", { className: "sfm-explore-tile-res" }, sRes),
                            React.createElement(
                              "div",
                              { className: "sfm-explore-tile-views" },
                              React.createElement("span", { className: "mr-1", style: { fontSize: "0.65rem" } }, "▶"),
                              React.createElement("span", null, sDuration)
                            ),
                            React.createElement(
                              "div",
                              { className: "sfm-explore-tile-hover-overlay" },
                              React.createElement("div", { className: "sfm-explore-tile-hover-center" }, "▶"),
                              React.createElement(
                                "div",
                                { className: "sfm-explore-tile-hover-bottom" },
                                studioName &&
                                  React.createElement(
                                    "div",
                                    { className: "sfm-explore-tile-hover-studio" },
                                    studioName
                                  ),
                                React.createElement("div", { className: "sfm-explore-tile-hover-title" }, sTitle)
                              )
                            )
                          );
                        })
                      )
                ),
                React.createElement(
                  "div",
                  {
                    ref: exploreSentinelRef,
                    className: "sfm-infinite-scroll-bottom text-center my-4 py-3",
                  },
                  visibleExploreCount < exploreScenes.length
                    ? React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-sm btn-outline-info px-4 py-2 font-weight-bold sfm-infinite-load-btn",
                          onClick: handleLoadMoreExplore,
                          title: "Load more scenes (or scroll down)",
                        },
                        React.createElement("span", { className: "mr-2" }, "↓"),
                        `Load More Scenes (Showing ${Math.min(visibleExploreCount, exploreScenes.length)} of ${exploreScenes.length})`
                      )
                    : exploreScenes.length > 0 &&
                        React.createElement(
                          "div",
                          { className: "text-muted small font-weight-bold" },
                          `✓ All ${exploreScenes.length} scenes loaded`
                        )
                )
              )
        )
      );
    }

    function BingeReelPlayerModal({
      scene,
      scenes = [],
      onSelectScene,
      onClose,
      onOpenProfile,
      folderName,
      currentPath,
      onNavigateToFolder,
    }) {
      const videoRef = useRef(null);

      // Ensure browser fullscreen is cleanly exited when player modal unmounts
      useEffect(() => {
        return () => {
          if (typeof document !== "undefined" && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
        };
      }, []);
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

      // Resolve the actual parent folder where this playing scene is located
      const activeSceneFolder = useMemo(() => {
        const resolved = resolveSceneFolder(scene);
        if (resolved !== undefined && resolved !== null && resolved !== "") return resolved;
        if (scene?._folderPath !== undefined && scene._folderPath !== null && scene._folderPath !== "") {
          return scene._folderPath;
        }
        return currentPath || "";
      }, [scene, currentPath]);

      const targetFolderPath = activeSceneFolder;
      const subfolderName = targetFolderPath
        ? targetFolderPath.split("/").filter(Boolean).pop()
        : folderName || "Root";
      const displayFolderPath = targetFolderPath ? `/${targetFolderPath}` : "/";

      // Dynamically resolve all companion scenes belonging to this playing scene and its directory
      const activeFolderScenes = useMemo(() => {
        const trie = window.__SFM_GLOBAL_CACHE__?.trie;
        if (trie && targetFolderPath) {
          const node = trie.getNode(targetFolderPath);
          if (node && Array.isArray(node.directScenes) && node.directScenes.length > 0) {
            return node.directScenes;
          }
        }
        if (Array.isArray(scenes) && scenes.length > 0 && scenes.some((s) => String(s.id) === String(scene?.id))) {
          return scenes;
        }
        return Array.isArray(scenes) && scenes.length > 0 ? scenes : scene ? [scene] : [];
      }, [targetFolderPath, scenes, scene]);

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
          if (pref && activeFolderScenes && activeFolderScenes.length > 0) {
            return createShuffledQueue(activeFolderScenes, scene);
          }
        } catch (e) {}
        return [];
      });

      useEffect(() => {
        if (isShuffle && activeFolderScenes && activeFolderScenes.length > 0) {
          setShuffledQueue((prev) => {
            const sceneIds = new Set(activeFolderScenes.map((s) => s.id));
            const prevIds = new Set(prev.map((s) => s.id));
            if (sceneIds.size !== prevIds.size || [...sceneIds].some((id) => !prevIds.has(id))) {
              return createShuffledQueue(activeFolderScenes, scene);
            }
            return prev;
          });
        }
      }, [activeFolderScenes, isShuffle, scene?.id]);

      const activeScenes = useMemo(() => {
        if (isShuffle && shuffledQueue.length === activeFolderScenes.length && shuffledQueue.length > 0) {
          return shuffledQueue;
        }
        return activeFolderScenes;
      }, [isShuffle, shuffledQueue, activeFolderScenes]);

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

      const folderProfileScenes = activeFolderScenes;

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

            const webm = streams.find(
              (s) =>
                s.url !== officialDirect &&
                (s.mime_type?.includes("webm") || s.url?.includes(".webm") || s.label?.toLowerCase().includes("webm"))
            );
            const hls = streams.find(
              (s) =>
                s.url !== officialDirect &&
                (s.mime_type?.includes("mpegurl") || s.url?.includes(".m3u8") || s.label?.toLowerCase().includes("hls"))
            );
            const mp4 = streams.find(
              (s) =>
                s.url !== officialDirect &&
                (s.mime_type?.includes("mp4") || s.url?.includes("stream.mp4") || s.label?.toLowerCase().includes("mp4"))
            );

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

      const prev2StreamUrl = useMemo(
        () => resolveSceneStreamUrl(prev2Scene, streamMode),
        [prev2Scene, streamMode, resolveSceneStreamUrl]
      );
      const prevStreamUrl = useMemo(
        () => resolveSceneStreamUrl(prevScene, streamMode),
        [prevScene, streamMode, resolveSceneStreamUrl]
      );
      const nextStreamUrl = useMemo(
        () => resolveSceneStreamUrl(nextScene, streamMode),
        [nextScene, streamMode, resolveSceneStreamUrl]
      );
      const next2StreamUrl = useMemo(
        () => resolveSceneStreamUrl(next2Scene, streamMode),
        [next2Scene, streamMode, resolveSceneStreamUrl]
      );

      // 4. Playback State & Custom Scrubber Control
      const [isPlaying, setIsPlaying] = useState(false);
      const [currentTime, setCurrentTime] = useState(0);
      const [duration, setDuration] = useState(() => scene?.files?.[0]?.duration || 0);
      const [bufferedProgress, setBufferedProgress] = useState(0);
      const [volume, setVolume] = useState(1);
      const [isMuted, setIsMuted] = useState(false);
      const [hudNotice, setHudNotice] = useState("");
      const hudTimerRef = useRef(null);
      const showHud = useCallback((text) => {
        if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
        setHudNotice(text);
        hudTimerRef.current = setTimeout(() => setHudNotice(""), 800);
      }, []);

      const handleSeekBy = useCallback(
        (seconds) => {
          const v = videoRef.current;
          if (!v) return;
          const currentT = v.currentTime || 0;
          const totalDur = v.duration && !isNaN(v.duration) && v.duration > 0 ? v.duration : duration || 999999;
          const nextT = Math.max(0, Math.min(totalDur, currentT + seconds));
          v.currentTime = nextT;
          setCurrentTime(nextT);
          showHud(seconds < 0 ? `${seconds}s` : `+${seconds}s`);
        },
        [duration, showHud]
      );

      // Synchronize in-player profile overlay with browser pageback (popstate)
      useEffect(() => {
        const handlePlayerPopstate = () => {
          const state =
            isPluginRoute() && typeof parseQueryState === "function"
              ? parseQueryState(window.location?.search || "")
              : parseHashState();
          if (!state || state.view !== "profile") {
            setShowFolderProfile(false);
          } else if (state.view === "profile") {
            setShowFolderProfile(true);
          }
        };
        window.addEventListener("popstate", handlePlayerPopstate);
        return () => window.removeEventListener("popstate", handlePlayerPopstate);
      }, []);

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
            v.play()
              .then(() => setIsPlaying(true))
              .catch(() => {});
          } else if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
            hlsInstanceRef.current = hls;
            hls.loadSource(streamUrl);
            hls.attachMedia(v);
            hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
              v.play()
                .then(() => setIsPlaying(true))
                .catch(() => {});
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
          v.play()
            .then(() => setIsPlaying(true))
            .catch((err) => {
              if (err && err.name === "NotAllowedError") {
                v.muted = true;
                setIsMuted(true);
                v.play()
                  .then(() => setIsPlaying(true))
                  .catch(() => {});
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
            console.warn(
              "[SFM Player] Video stream playing without visual track (MPEG-4 decode unsupported). Switching to HLS."
            );
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
        if (v.buffered && v.buffered.length > 0 && v.duration) {
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
          v.play()
            .then(() => setIsPlaying(true))
            .catch(() => {});
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
      const handleGestureClick = () => {
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
        if (!v || typeof document === "undefined") return;
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
            const pool = activeFolderScenes && activeFolderScenes.length > 0 ? activeFolderScenes : scenes;
            const q = createShuffledQueue(pool, scene);
            setShuffledQueue(q);
            setHudNotice("Shuffle: ON");
          } else {
            setShuffledQueue([]);
            setHudNotice("Sequential");
          }
          setTimeout(() => setHudNotice(""), 1000);
          return next;
        });
      }, [activeFolderScenes, scenes, scene]);

      // Fullscreen Toggle (targets workspace root / documentElement so controls, modals, and profile views remain interactive)
      const handleToggleFullscreen = () => {
        if (typeof document === "undefined") return;
        if (!document.fullscreenElement) {
          const el = document.getElementById("sfm-workspace-root") || document.documentElement;
          if (el && el.requestFullscreen) {
            el.requestFullscreen().catch(() => {});
          }
        } else {
          document.exitFullscreen().catch(() => {});
        }
      };

      // Copy Stream Link
      const handleCopyStreamLink = () => {
        const origin = window.location?.origin || "";
        const fullUrl = streamUrl.startsWith("http") ? streamUrl : `${origin}${streamUrl}`;
        if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(fullUrl).then(() => {
            setCopiedNotice("Stream URL copied to clipboard!");
            setTimeout(() => setCopiedNotice(""), 2500);
          });
        }
      };

      const vlcUrl = `vlc://${window.location?.origin || ""}${directUrl}`;

      // 6. Binge-Style Vertical Reel Scrolling & Physics
      const [pullOffset, setPullOffset] = useState(0);
      const [isTransitioning, setIsTransitioning] = useState(false);
      const isTransitioningRef = useRef(false);
      const lastWheelTime = useRef(0);
      const touchStartRef = useRef(null);
      const touchSamplesRef = useRef([]);
      const isSwipingGesture = useRef(false);

      // Smooth programmatic / physics transition to relative offset step (-2, -1, 0, 1, 2)
      const executeTransition = useCallback(
        (steps, targetScene) => {
          const containerHeight = videoContainerRef.current?.clientHeight || window.innerHeight || 800;
          isTransitioningRef.current = true;
          setIsTransitioning(true);
          setPullOffset(-steps * containerHeight);

          const transitionMs = steps === 0 ? 180 : 260;
          setTimeout(() => {
            if (steps !== 0 && targetScene && onSelectScene) {
              onSelectScene(targetScene);
            }
            setPullOffset(0);
            isTransitioningRef.current = false;
            setIsTransitioning(false);
          }, transitionMs);
        },
        [onSelectScene]
      );

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

      // Keyboard Controls (Left/Right Arrow key Rewind & Fast Forward, Instant Escape Exit)
      useEffect(() => {
        const handleKeyDown = (e) => {
          if (["input", "textarea", "select"].includes(e.target.tagName?.toLowerCase())) return;

          // Rewind 10s: Left Arrow, J, or external mobile controller / HID media keys
          if (
            e.key === "ArrowLeft" ||
            e.key === "Left" ||
            e.key === "j" ||
            e.key === "J" ||
            e.code === "ArrowLeft" ||
            e.keyCode === 37 ||
            e.which === 37 ||
            e.key === "MediaTrackPrevious" ||
            e.key === "MediaRewind" ||
            e.key === "PageLeft"
          ) {
            e.preventDefault();
            e.stopPropagation();
            handleSeekBy(-10);
            return;
          }
          // Fast Forward 10s: Right Arrow, L, or external mobile controller / HID media keys
          if (
            e.key === "ArrowRight" ||
            e.key === "Right" ||
            e.key === "l" ||
            e.key === "L" ||
            e.code === "ArrowRight" ||
            e.keyCode === 39 ||
            e.which === 39 ||
            e.key === "MediaTrackNext" ||
            e.key === "MediaFastForward" ||
            e.key === "PageRight"
          ) {
            e.preventDefault();
            e.stopPropagation();
            handleSeekBy(10);
            return;
          }

          if (showFolderProfile) {
            if (e.key === "Escape") {
              e.preventDefault();
              setShowFolderProfile(false);
              const curDepth =
                window.history?.state && typeof window.history.state.sfmDepth === "number"
                  ? window.history.state.sfmDepth
                  : 0;
              if (curDepth > 1 && hasViewQueryParam() && window.history?.back) {
                window.history.back();
              } else {
                const targetUrl = buildPlayerUrl(targetFolderPath, null, scene?.id);
                if (getCurrentLocationKey() !== targetUrl && window.history?.replaceState) {
                  window.history.replaceState(
                    { sfmPath: targetFolderPath, sfmScene: scene?.id, sfmDepth: Math.max(1, curDepth) },
                    "",
                    targetUrl
                  );
                }
              }
            }
            return; // In profile/discover overlay, yield remaining keys to profile view
          }

          if (e.key === "Escape") {
            if (isPipMode && typeof document !== "undefined" && document.pictureInPictureElement) {
              document.exitPictureInPicture().catch(() => {});
            }
            if (onClose) onClose();
            return;
          } else if (
            e.key === "ArrowDown" ||
            e.key === "Down" ||
            e.key === "PageDown" ||
            e.code === "ArrowDown" ||
            e.keyCode === 40 ||
            e.which === 40
          ) {
            e.preventDefault();
            goToNext();
          } else if (
            e.key === "ArrowUp" ||
            e.key === "Up" ||
            e.key === "PageUp" ||
            e.code === "ArrowUp" ||
            e.keyCode === 38 ||
            e.which === 38
          ) {
            e.preventDefault();
            goToPrev();
          } else if (
            e.key === " " ||
            e.key === "k" ||
            e.key === "K" ||
            e.key === "MediaPlayPause" ||
            e.keyCode === 32 ||
            e.keyCode === 179
          ) {
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

        window.addEventListener("keydown", handleKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
      }, [
        onClose,
        goToNext,
        goToPrev,
        handleTogglePlay,
        handleToggleShuffle,
        handleSeekBy,
        isPipMode,
        showFolderProfile,
        targetFolderPath,
        scene?.id,
      ]);

      // External Controller / Bluetooth Gamepad API polling loop
      useEffect(() => {
        let animId = null;
        let lastActionTime = 0;
        const DEADZONE = 0.45;
        const COOLDOWN_MS = 250;

        const pollGamepad = () => {
          if (typeof navigator !== "undefined" && typeof navigator.getGamepads === "function") {
            const gamepads = navigator.getGamepads();
            for (let i = 0; i < gamepads.length; i++) {
              const gp = gamepads[i];
              if (!gp || !gp.connected) continue;

              const now = Date.now();
              if (now - lastActionTime < COOLDOWN_MS) continue;

              const b = gp.buttons;
              const a = gp.axes;

              // D-Pad Up (12) or Left Stick Up (axes[1] < -0.45)
              if ((b[12] && b[12].pressed) || (a[1] !== undefined && a[1] < -DEADZONE)) {
                lastActionTime = now;
                goToPrev();
                break;
              }
              // D-Pad Down (13) or Left Stick Down (axes[1] > 0.45)
              if ((b[13] && b[13].pressed) || (a[1] !== undefined && a[1] > DEADZONE)) {
                lastActionTime = now;
                goToNext();
                break;
              }
              // D-Pad Left (14) or Left Stick Left (axes[0] < -0.45) or LB / L1 (4)
              if ((b[14] && b[14].pressed) || (a[0] !== undefined && a[0] < -DEADZONE) || (b[4] && b[4].pressed)) {
                lastActionTime = now;
                handleSeekBy(-10);
                break;
              }
              // D-Pad Right (15) or Left Stick Right (axes[0] > 0.45) or RB / R1 (5)
              if ((b[15] && b[15].pressed) || (a[0] !== undefined && a[0] > DEADZONE) || (b[5] && b[5].pressed)) {
                lastActionTime = now;
                handleSeekBy(10);
                break;
              }
              // Button 0 (A / Cross) -> Play/Pause
              if (b[0] && b[0].pressed) {
                lastActionTime = now;
                handleTogglePlay();
                break;
              }
              // Button 1 (B / Circle) -> Close
              if (b[1] && b[1].pressed) {
                lastActionTime = now;
                if (onClose) onClose();
                break;
              }
            }
          }
          if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
            animId = window.requestAnimationFrame(pollGamepad);
          }
        };

        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          animId = window.requestAnimationFrame(pollGamepad);
        }
        return () => {
          if (animId && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
            window.cancelAnimationFrame(animId);
          }
        };
      }, [goToNext, goToPrev, handleSeekBy, handleTogglePlay, onClose]);

      // Formatted duration helper (delegates to formatSeconds when available)
      const formatTime = (secs) => {
        if (!secs || isNaN(secs) || secs < 0) return "0:00";
        if (typeof formatSeconds === "function") {
          return formatSeconds(secs) || "0:00";
        }
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s < 10 ? "0" : ""}${s}`;
      };

      const openInProfileView = () => {
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
        if (onOpenProfile) {
          onOpenProfile(targetFolderPath, scene);
          return;
        }
        setShowFolderProfile(true);
        const targetUrl = buildPlayerUrl(targetFolderPath, "profile", null);
        if (getCurrentLocationKey() !== targetUrl && window.history?.replaceState) {
          const curDepth =
            window.history.state && typeof window.history.state.sfmDepth === "number"
              ? window.history.state.sfmDepth
              : 1;
          window.history.replaceState(
            { sfmPath: targetFolderPath, sfmView: "profile", inPlayerProfile: true, sfmDepth: curDepth },
            "",
            targetUrl
          );
        }
      };

      // Render Active Player Modal or PiP Background Mode
      return React.createElement(
        React.Fragment,
        null,
        // Folder Profile Video Wall Overlay
        showFolderProfile &&
          React.createElement(FolderProfileView, {
            folderName: subfolderName,
            targetFolderPath: targetFolderPath,
            displayFolderPath: displayFolderPath,
            scenes: folderProfileScenes,
            currentScene: scene,
            posterUrl: posterUrl,
            isForceMobile: isForceMobile,
            isInsidePlayer: true,
            onToggleForceMobile: handleToggleForceMobile,
            onSelectScene: (s, q) => {
              if (onSelectScene) {
                onSelectScene(s, q);
              }
              setShowFolderProfile(false);
            },
            onCloseProfile: () => {
              setShowFolderProfile(false);
              const curDepth =
                window.history?.state && typeof window.history.state.sfmDepth === "number"
                  ? window.history.state.sfmDepth
                  : 0;
              if (curDepth > 1 && hasViewQueryParam() && window.history?.back) {
                window.history.back();
              } else {
                const targetUrl = buildPlayerUrl(targetFolderPath, null, scene?.id);
                if (getCurrentLocationKey() !== targetUrl && window.history?.replaceState) {
                  window.history.replaceState(
                    { sfmPath: targetFolderPath, sfmScene: scene?.id, sfmDepth: Math.max(1, curDepth) },
                    "",
                    targetUrl
                  );
                }
              }
            },
            onNavigateToDirectory: (fPath) => {
              const dest = fPath !== undefined ? fPath : targetFolderPath;
              if (onNavigateToFolder) {
                onNavigateToFolder(dest);
              }
              if (onClose) onClose();
            },
            onPlayAll: (q) => {
              const list = Array.isArray(q) && q.length > 0 ? q : folderProfileScenes;
              if (list.length > 0) {
                if (onSelectScene) onSelectScene(list[0], list);
                setShowFolderProfile(false);
              }
            },
            onShuffleAll: (q) => {
              const list = Array.isArray(q) && q.length > 0 ? q : folderProfileScenes;
              if (list.length > 0) {
                const shuffled = createShuffledQueue(list, list[0]);
                setShuffledQueue(shuffled);
                setIsShuffle(true);
                if (onSelectScene) onSelectScene(shuffled[0], shuffled);
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
                if (typeof document !== "undefined" && document.pictureInPictureElement) {
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
                  if (typeof document !== "undefined" && document.pictureInPictureElement) {
                    document.exitPictureInPicture().catch(() => {});
                  }
                  if (onClose) onClose();
                },
                title: "Stop playback and close",
              },
              "✕"
            )
          ),

        // Main Player Modal Backdrop (Hidden when showFolderProfile is true so profile overlay is completely visible and interactable!)
        React.createElement(
          "div",
          {
            className: `sfm-reel-modal-backdrop ${isPipMode ? "sfm-pip-detached" : ""}`,
            style: showFolderProfile ? { display: "none" } : undefined,
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
                    transition: isTransitioning ? "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
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
                    href: `/scenes/${scene?.id}`,
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
                    React.createElement("path", {
                      d: "M11 2.5a1.2 1.2 0 0 1 2 0l1.5 4.5h-5zM8.8 8.5h6.4l1.1 3.5H7.7zM6.8 13.5h10.4l1.3 4H5.5zM3.5 19.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z",
                    })
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
                      availableStreams
                        .filter(
                          (s) =>
                            !s.url.includes("stream.webm") &&
                            !s.url.includes("stream.m3u8") &&
                            !s.url.includes("stream.mp4")
                        )
                        .map((s, idx) =>
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

                // Divider 1: Above Prev/Next Video Button
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
                  isShuffle ? `[Shuffle] ${currentIndex + 1}/${totalScenes}` : `${currentIndex + 1}/${totalScenes}`
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
                      : isShuffle
                        ? "End of shuffled queue"
                        : "Last scene in folder",
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
                      ? "Shuffle: ON (randomized without repeats) — Click to disable (S)"
                      : "Shuffle: OFF (sequential folder order) — Click to randomize without repeats (S)",
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
                    title: isForceMobile
                      ? "Switch to Fullscreen Desktop Player"
                      : "Switch to Mobile Phone Reel View (TikTok/IG)",
                  },
                  React.createElement(IconSmartphone, { size: 15 })
                ),

                // Bottom actions group: Pushed down so Fullscreen is directly above the scrubbing line
                React.createElement(
                  "div",
                  { className: "sfm-reel-bottom-actions" },
                  React.createElement("div", { className: "sfm-reel-action-divider" }),
                  // Picture-in-Picture Button
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
                  // Fullscreen Button
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
                      React.createElement("path", {
                        d: "M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3",
                      })
                    )
                  )
                )
              ),

              // ==========================================
              // Elevated Metadata Overlay
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
                      openInProfileView();
                    },
                    onKeyDown: (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        e.preventDefault();
                        openInProfileView();
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
                    React.createElement("span", { className: "sfm-reel-path-label" }, displayFolderPath)
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
                  fileSize &&
                    fileSize !== "0 B" &&
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

    Object.assign(window.__SFM__, {
      FolderProfileView,
      BingeReelPlayerModal,
    });
  } catch (err) {
    console.error("[PathFileManager] Critical error in sfm_player.js:", err);
  }
})();

(function () {
  "use strict";

  try {
    const SFM = typeof window !== "undefined" ? window.__SFM__ : null;
    if (!SFM || !window.PluginApi) {
      console.warn("[PathFileManager] window.__SFM__ or window.PluginApi is not ready for sfm_native.js.");
      return;
    }

    const {
      PluginApi,
      React,
      ReactDOM,
      register,
      patch,
      Event: ApiEvent,
      libraries,
      useState,
      useEffect,
      useCallback,
      gqlFetch,
      ensureCatalog,
      clearCachedScenes,
      patchCatalogSceneInPlace,
      resolveSceneFolder,
      deriveFolderFromPath,
      normalizePath,
      buildRouteUrlForPath,
      parseQueryState,
      navigateToPluginRoute,
      SafeErrorBoundary,
      icons,
    } = SFM;

    if (!React || !ReactDOM) {
      console.warn("[PathFileManager] React or ReactDOM not found on window.__SFM__.");
      return;
    }

    const { IconFolder, IconGrid, IconPlay, IconFilm, IconGlobe } = icons || {};

    // Runtime-resolved component bindings (supporting ordered IIFE load or lazy test stubs)
    const FolderProfileView = SFM.FolderProfileView;
    const BingeReelPlayerModal = SFM.BingeReelPlayerModal;
    const FileManagerView = SFM.FileManagerView;
    const SceneTableView = SFM.SceneTableView;
    const SceneNamesTableView = SFM.SceneNamesTableView || SFM.SceneTableView;
    const SceneCard = SFM.SceneCard;
    const FilenameParserModal = SFM.FilenameParserModal || SFM.MetadataStudioModal;
    const BatchMetadataModal = SFM.BatchMetadataModal || SFM.FilenameParserModal;
    const SettingsAndTasksModal = SFM.SettingsAndTasksModal;

    // ==========================================================================
    // R1: First-Class Native Route Integration (/plugin/file-manager)
    // ==========================================================================
    function isFileManagerRouteActive() {
      if (typeof window === "undefined") return false;
      const pathname = window.location?.pathname || "";
      const hash = window.location?.hash || "";
      return pathname.startsWith("/plugin/file-manager") || hash.startsWith("#file-manager");
    }

    function navigateToFileManager(targetPath, targetView = null, targetSceneId = null) {
      const url = buildRouteUrlForPath(targetPath || "", targetView, targetSceneId);
      return navigateToPluginRoute(url);
    }

    function FileManagerRouteWrapper(routeProps) {
      const FMView = SFM.FileManagerView || window.__SFM__?.FileManagerView || FileManagerView;
      if (!FMView) {
        return React.createElement(
          "div",
          { className: "sfm-native-page alert alert-warning m-3" },
          "File Manager view is not available."
        );
      }

      const mergedProps = Object.assign({}, routeProps || {});
      const inner = React.createElement(FMView, mergedProps);

      if (SafeErrorBoundary) {
        return React.createElement(
          SafeErrorBoundary,
          { onReset: () => navigateToPluginRoute("/plugin/file-manager", true) },
          inner
        );
      }
      return inner;
    }

    const activeRegister = register || window.PluginApi?.register;
    if (activeRegister && typeof activeRegister.route === "function") {
      activeRegister.route("/plugin/file-manager", FileManagerRouteWrapper);
    }

    // ==========================================================================
    // Phase 4 + R1: Native Stash Platform Deep Embedding Components
    // ==========================================================================

    // Feature 1: Native Scene Card Overlay (Path Chip & 1-Click Hover Actions)
    function NativeSceneCardOverlay({ scene, folderPath }) {
      const [resolvedPath, setResolvedPath] = useState(() => {
        return folderPath || resolveSceneFolder(scene) || "";
      });

      useEffect(() => {
        let isMounted = true;
        const sceneId = scene?.id || scene?._id;
        if (!resolvedPath && sceneId) {
          const p = resolveSceneFolder(scene);
          if (p) {
            setResolvedPath(p);
          } else {
            // Fast single-scene on-demand GraphQL query (<10ms)
            if (typeof window !== "undefined" && typeof window.fetch === "function") {
              gqlFetch(`query FastSceneFolder($id: ID!) { findScene(id: $id) { id files { path } } }`, { id: sceneId })
                .then((data) => {
                  const filePath = data?.findScene?.files?.[0]?.path;
                  if (filePath && isMounted) {
                    const derived = deriveFolderFromPath(filePath);
                    if (derived) {
                      setResolvedPath(derived);
                      if (typeof scene === "object") {
                        scene._folderPath = derived;
                        if (!scene.files) scene.files = data.findScene.files;
                      }
                    }
                  }
                })
                .catch(() => {});
            }

            // Also load global catalog in background
            ensureCatalog()
              .then((trie) => {
                if (isMounted && trie) {
                  const fp = resolveSceneFolder(scene, trie);
                  if (fp) setResolvedPath(fp);
                }
              })
              .catch(() => {});
          }
        }
        return () => {
          isMounted = false;
        };
      }, [scene, resolvedPath]);

      const p = resolvedPath || "";
      const displayPath = p ? (p.startsWith("/") ? p : `/${p}`) : "Folder";

      const handleOpenFolder = useCallback(
        (e) => {
          if (e) {
            if (typeof e.preventDefault === "function") e.preventDefault();
            if (typeof e.stopPropagation === "function") e.stopPropagation();
          }
          navigateToFileManager(p);
        },
        [p]
      );

      const handleOpenProfile = useCallback(
        (e) => {
          if (e) {
            if (typeof e.preventDefault === "function") e.preventDefault();
            if (typeof e.stopPropagation === "function") e.stopPropagation();
          }
          navigateToFileManager(p, "profile");
        },
        [p]
      );

      const handlePlayReel = useCallback(
        (e) => {
          if (e) {
            if (typeof e.preventDefault === "function") e.preventDefault();
            if (typeof e.stopPropagation === "function") e.stopPropagation();
          }
          navigateToFileManager(p, null, scene?.id);
        },
        [p, scene?.id]
      );

      return React.createElement(
        "div",
        {
          className: "sfm-native-card-chip-container",
          "data-sfm-card-chip": "true",
          onClick: (e) => e && typeof e.stopPropagation === "function" && e.stopPropagation(),
        },
        React.createElement(
          "span",
          {
            className: "sfm-native-card-path-chip",
            title: `Directory: ${displayPath}\nClick to browse directory in File Manager`,
            onClick: handleOpenFolder,
          },
          IconFolder ? React.createElement(IconFolder, { size: 12 }) : null,
          React.createElement("span", { className: "sfm-chip-text" }, displayPath)
        ),
        React.createElement(
          "div",
          { className: "sfm-native-card-quick-actions" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "sfm-card-action-icon",
              title: `Browse "${displayPath}" in File Manager`,
              onClick: handleOpenFolder,
            },
            IconFolder ? React.createElement(IconFolder, { size: 11 }) : "F"
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "sfm-card-action-icon",
              title: `Open Video Wall Profile for "${displayPath}"`,
              onClick: handleOpenProfile,
            },
            IconGrid ? React.createElement(IconGrid, { size: 11 }) : "W"
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: "sfm-card-action-icon",
              title: "Watch in Binge Reel Mode",
              onClick: handlePlayReel,
            },
            IconPlay ? React.createElement(IconPlay, { size: 11 }) : "▶"
          )
        ),
        React.createElement(
          "div",
          { className: "sfm-native-card-hover-actions" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "sfm-native-card-hover-btn",
              title: `Open folder "${displayPath}" in File Manager`,
              onClick: handleOpenFolder,
            },
            IconFolder ? React.createElement(IconFolder, { size: 12 }) : null,
            React.createElement("span", null, "Folder")
          )
        )
      );
    }

    // Feature 2: Native Scene Detail Directory Hierarchy Breadcrumb Component
    function NativeSceneDetailDirectoryHierarchy({ scene, folderPath }) {
      const [resolvedPath, setResolvedPath] = useState(() => {
        return folderPath || resolveSceneFolder(scene) || "";
      });

      useEffect(() => {
        let isMounted = true;
        if (!resolvedPath && scene) {
          const p = resolveSceneFolder(scene);
          if (p) {
            setResolvedPath(p);
          } else {
            ensureCatalog()
              .then((trie) => {
                if (isMounted && trie) {
                  const fp = resolveSceneFolder(scene, trie);
                  if (fp) setResolvedPath(fp);
                }
              })
              .catch(() => {});
          }
        }
        return () => {
          isMounted = false;
        };
      }, [scene, resolvedPath]);

      const p = resolvedPath || "";
      const segments = p.split("/").filter(Boolean);

      const crumbs = [
        { name: "Root", path: "" },
        ...segments.map((seg, idx) => ({
          name: seg,
          path: segments.slice(0, idx + 1).join("/"),
        })),
      ];

      return React.createElement(
        "div",
        {
          className: "sfm-scene-detail-directory-row",
          id: "sfm-scene-hierarchy-row",
          "data-sfm-hierarchy": "true",
        },
        React.createElement(
          "div",
          { className: "sfm-scene-detail-dir-header" },
          React.createElement(
            "span",
            { className: "sfm-scene-detail-dir-label" },
            IconFolder ? React.createElement(IconFolder, { size: 13 }) : null,
            React.createElement("span", null, "Directory Hierarchy")
          ),
          React.createElement(
            "div",
            { className: "sfm-scene-detail-dir-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-secondary btn-sm",
                style: { padding: "2px 8px", fontSize: "0.75rem", display: "inline-flex", alignItems: "center", gap: "4px" },
                title: `Open Video Wall Profile for "${p || "Root"}"`,
                onClick: (e) => {
                  if (e) {
                    if (typeof e.preventDefault === "function") e.preventDefault();
                    if (typeof e.stopPropagation === "function") e.stopPropagation();
                  }
                  navigateToFileManager(p, "profile");
                },
              },
              IconGrid ? React.createElement(IconGrid, { size: 12 }) : null,
              React.createElement("span", null, "Profile Wall")
            )
          )
        ),
        React.createElement(
          "div",
          { className: "sfm-scene-detail-breadcrumbs" },
          crumbs.map((crumb, idx) =>
            React.createElement(
              React.Fragment,
              { key: crumb.path || "root" },
              idx > 0 && React.createElement("span", { className: "sfm-breadcrumb-sep" }, "›"),
              React.createElement(
                "span",
                {
                  className: "sfm-breadcrumb-item",
                  title: `Browse "${crumb.name}" in File Manager`,
                  onClick: (e) => {
                    if (e) {
                      if (typeof e.preventDefault === "function") e.preventDefault();
                      if (typeof e.stopPropagation === "function") e.stopPropagation();
                    }
                    navigateToFileManager(crumb.path);
                  },
                },
                idx === 0 && IconFolder ? React.createElement(IconFolder, { size: 11 }) : null,
                React.createElement("span", null, crumb.name)
              )
            )
          )
        )
      );
    }

    // Feature 2: Native Scene Detail Reel Mode Button
    function NativeSceneDetailReelButton({ scene, folderPath }) {
      const handleLaunchReel = useCallback(
        (e) => {
          if (e) {
            if (typeof e.preventDefault === "function") e.preventDefault();
            if (typeof e.stopPropagation === "function") e.stopPropagation();
          }
          const path = folderPath || resolveSceneFolder(scene);
          navigateToFileManager(path, null, scene?.id);
        },
        [scene, folderPath]
      );

      return React.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-primary sfm-scene-reel-mode-btn",
          id: "sfm-scene-reel-btn",
          "data-sfm-reel-btn": "true",
          title: "Watch this directory in full-viewport Binge Reel Player",
          onClick: handleLaunchReel,
        },
        IconFilm ? React.createElement(IconFilm, { size: 14 }) : null,
        React.createElement("span", null, "Reel Mode")
      );
    }

    // Feature 3: Native Scene Detail Scrape & Parse Button (R4 GraphQL aligned)
    function NativeSceneDetailScrapeButton({ scene }) {
      const [loading, setLoading] = useState(false);

      const handleLaunchScrape = useCallback(
        async (e) => {
          if (e) {
            if (typeof e.preventDefault === "function") e.preventDefault();
            if (typeof e.stopPropagation === "function") e.stopPropagation();
          }
          setLoading(true);
          try {
            let targetScene = scene;
            if (targetScene?.id) {
              const res = await gqlFetch(
                `query FindSceneFull($id: ID!) {
                  findScene(id: $id) {
                    id
                    title
                    code
                    organized
                    details
                    url
                    date
                    rating100
                    play_count
                    o_counter
                    director
                    created_at
                    updated_at
                    last_played_at
                    studio { id name }
                    performers { id name }
                    tags { id name }
                    stash_ids { endpoint stash_id }
                    urls
                    files { id path basename size duration width height frame_rate bit_rate video_codec format }
                    paths { screenshot preview stream }
                  }
                }`,
                { id: targetScene.id }
              );
              if (res?.findScene) targetScene = res.findScene;
            }
            if (window.__SFM_OPEN_PARSER__) {
              window.__SFM_OPEN_PARSER__(
                [targetScene],
                targetScene.title || targetScene.files?.[0]?.basename || `Scene #${targetScene.id}`
              );
            }
          } catch (err) {
            console.warn("Failed to fetch scene for parser modal:", err);
            if (window.__SFM_OPEN_PARSER__ && scene) {
              window.__SFM_OPEN_PARSER__([scene], scene.title || `Scene #${scene.id}`);
            }
          } finally {
            setLoading(false);
          }
        },
        [scene]
      );

      return React.createElement(
        "button",
        {
          type: "button",
          className: "btn btn-secondary sfm-scene-scrape-btn",
          id: "sfm-scene-scrape-btn",
          "data-sfm-scrape-btn": "true",
          title: "Parse & Scrape this scene with smart metadata matcher",
          disabled: loading,
          onClick: handleLaunchScrape,
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontSize: "0.85rem",
            fontWeight: "600",
            padding: "4px 10px",
            marginLeft: "6px",
          },
        },
        IconGlobe ? React.createElement(IconGlobe, { size: 14, color: "#88c0d0" }) : null,
        React.createElement("span", null, loading ? "Loading..." : "Parse & Scrape")
      );
    }

    // Helper: Detect whether a node already contains our SFM addons
    function hasSfmAddon(node, key) {
      if (!node) return false;
      if (Array.isArray(node)) {
        return node.some((c) => hasSfmAddon(c, key));
      }
      if (React.isValidElement(node)) {
        if (node.key === key) return true;
        if (
          node.props &&
          (node.props["data-sfm-card-chip"] ||
            node.props["data-sfm-hierarchy"] ||
            node.props["data-sfm-reel-btn"] ||
            node.props["data-sfm-scrape-btn"])
        ) {
          return true;
        }
        if (node.props && node.props.details && hasSfmAddon(node.props.details, key)) {
          return true;
        }
        return hasSfmAddon(node.props && node.props.children, key);
      }
      return false;
    }

    function patchNativeSceneCard(props, res) {
      try {
        if (!props || !res || !React.isValidElement(res)) return res;
        if (
          typeof window !== "undefined" &&
          (isFileManagerRouteActive() ||
            window.location?.pathname?.includes("/tagger") ||
            window.location?.hash?.includes("tagger"))
        ) {
          return res;
        }
        const scene = props.scene || (props.id ? props : props.item || null);
        if (!scene || !scene.id) return res;
        // If res is GridCard and already has details with SceneCardDetails, avoid duplicate overlay on outer card
        if (res.props && res.props.details && React.isValidElement(res.props.details)) {
          return res;
        }
        if (hasSfmAddon(res, "sfm-native-card-addon")) return res;
        const folderPath = resolveSceneFolder(scene);
        const addon = React.createElement(NativeSceneCardOverlay, {
          key: "sfm-native-card-addon",
          scene: scene,
          folderPath: folderPath,
        });
        return appendNavChild(res, addon);
      } catch (err) {
        console.warn("[PathFileManager] patchNativeSceneCard error:", err);
        return res;
      }
    }

    function patchNativeSceneDetails(props, res) {
      try {
        if (!props || !res || !React.isValidElement(res)) return res;
        const scene = props.scene || (props.id ? props : props.item || null);
        if (!scene || !scene.id) return res;
        if (hasSfmAddon(res, "sfm-scene-hierarchy-addon")) return res;
        const folderPath = resolveSceneFolder(scene);
        const hierarchyRow = React.createElement(NativeSceneDetailDirectoryHierarchy, {
          key: "sfm-scene-hierarchy-addon",
          scene: scene,
          folderPath: folderPath,
        });
        return appendNavChild(res, hierarchyRow);
      } catch (err) {
        console.warn("[PathFileManager] patchNativeSceneDetails error:", err);
        return res;
      }
    }

    function patchNativeScenePlayer(props, res) {
      try {
        if (!props || !res || !React.isValidElement(res)) return res;
        const scene = props.scene || (props.id ? props : props.item || null);
        if (!scene || !scene.id) return res;
        if (hasSfmAddon(res, "sfm-scene-reel-btn-addon")) return res;
        const folderPath = resolveSceneFolder(scene);
        const reelBtn = React.createElement(NativeSceneDetailReelButton, {
          key: "sfm-scene-reel-btn-addon",
          scene: scene,
          folderPath: folderPath,
        });
        const scrapeBtn = React.createElement(NativeSceneDetailScrapeButton, {
          key: "sfm-scene-scrape-btn-addon",
          scene: scene,
          folderPath: folderPath,
        });
        const updated = appendNavChild(res, reelBtn);
        return appendNavChild(updated, scrapeBtn);
      } catch (err) {
        console.warn("[PathFileManager] patchNativeScenePlayer error:", err);
        return res;
      }
    }

    // ==========================================================================
    // Navigation Bar Integration (R1: ReactRouterDOM NavLink + Safe Fallback)
    // ==========================================================================
    const FOLDER_NAV_SVG_PATH =
      "M464 128H272l-64-64H48C21.49 64 0 85.49 0 112v288c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V176c0-26.51-21.49-48-48-48z";

    function FilesNavButton() {
      const [isActive, setIsActive] = useState(() => isFileManagerRouteActive());

      useEffect(() => {
        const syncActive = () => {
          setIsActive(isFileManagerRouteActive());
        };
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
          window.addEventListener("popstate", syncActive);
          window.addEventListener("hashchange", syncActive);
        }
        const ev = ApiEvent || window.PluginApi?.Event;
        if (ev && typeof ev.addEventListener === "function") {
          ev.addEventListener("stash:location", syncActive);
        }
        return () => {
          if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
            window.removeEventListener("popstate", syncActive);
            window.removeEventListener("hashchange", syncActive);
          }
          if (ev && typeof ev.removeEventListener === "function") {
            ev.removeEventListener("stash:location", syncActive);
          }
        };
      }, []);

      const navIcon = React.createElement(
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
      );

      const NavLinkComp =
        window.PluginApi?.libraries?.ReactRouterDOM?.NavLink ||
        libraries?.ReactRouterDOM?.NavLink ||
        null;

      const baseLinkClass =
        "nav-link minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center btn btn-primary";

      const linkElement = NavLinkComp
        ? React.createElement(
            NavLinkComp,
            {
              to: "/plugin/file-manager",
              activeClassName: "active",
              id: "sfm-nav-button",
              title: "File Manager (Browse by Directory)",
              "aria-label": "File Manager",
              className: baseLinkClass,
            },
            navIcon,
            React.createElement("span", null, "Files")
          )
        : React.createElement(
            "a",
            {
              href: "/plugin/file-manager",
              id: "sfm-nav-button",
              title: "File Manager (Browse by Directory)",
              "aria-label": "File Manager",
              className: `${baseLinkClass} ${isActive ? "active" : ""}`.trim(),
              onClick: function (evt) {
                if (evt && typeof evt.preventDefault === "function") evt.preventDefault();
                navigateToPluginRoute("/plugin/file-manager");
              },
            },
            navIcon,
            React.createElement("span", null, "Files")
          );

      return React.createElement(
        "div",
        {
          className: "col-4 col-sm-3 col-md-2 col-lg-auto nav-link",
          id: "sfm-nav-container",
        },
        linkElement
      );
    }

    // Helper: recursively append a React element into the correct children container
    function appendNavChild(node, item) {
      if (!node) return item;
      if (!item) return node;
      if (Array.isArray(node)) {
        return node.concat(item);
      }
      if (!React.isValidElement(node)) {
        if (typeof node === "string" || typeof node === "number") {
          return React.createElement(React.Fragment, null, node, item);
        }
        // Safeguard: Never render non-renderable objects (like plain {}) as React children!
        return item;
      }

      const children = node.props && node.props.children;
      if (children === undefined || children === null) {
        return React.cloneElement(node, null, item);
      }
      if (Array.isArray(children)) {
        return React.cloneElement(node, null, ...children, item);
      }
      return React.cloneElement(node, null, children, item);
    }

    // Adaptor helpers for Stash PluginApi.patch hooks
    function makeAfterPatch(handler) {
      return function () {
        const props = arguments[0];
        const res = arguments.length > 1 ? arguments[arguments.length - 1] : null;
        return handler(props, res);
      };
    }

    function makeInsteadPatch(handler) {
      return function () {
        const next = arguments[arguments.length - 1];
        const originalArgs = Array.prototype.slice.call(arguments, 0, -1);
        const props = arguments[0];
        const res = typeof next === "function" ? next.apply(this, originalArgs) : null;
        return handler(props, res);
      };
    }

    // Method 1: Official PluginApi.patch.instead & patch.after
    const activePatch = patch || window.PluginApi?.patch;
    if (activePatch) {
      try {
        function patchNav(props, res) {
          if (hasSfmAddon(res, "sfm-files-nav-item")) return res;
          return appendNavChild(res, React.createElement(FilesNavButton, { key: "sfm-files-nav-item" }));
        }

        if (activePatch.instead) {
          activePatch.instead("MainNavBar.MenuItems", makeInsteadPatch(patchNav));
          activePatch.instead("SceneCard.Details", makeInsteadPatch(patchNativeSceneCard));
          activePatch.instead("SceneCard", makeInsteadPatch(patchNativeSceneCard));
          activePatch.instead("ScenePage", makeInsteadPatch(patchNativeSceneDetails));
          activePatch.instead("SceneDetails", makeInsteadPatch(patchNativeSceneDetails));
          activePatch.instead("SceneDetails.Sidebar", makeInsteadPatch(patchNativeSceneDetails));
          activePatch.instead("SceneFileInfoPanel", makeInsteadPatch(patchNativeSceneDetails));
          activePatch.instead("ScenePlayer", makeInsteadPatch(patchNativeScenePlayer));
        } else if (activePatch.after) {
          activePatch.after("MainNavBar.MenuItems", makeAfterPatch(patchNav));
          activePatch.after("SceneCard.Details", makeAfterPatch(patchNativeSceneCard));
          activePatch.after("SceneCard", makeAfterPatch(patchNativeSceneCard));
          activePatch.after("ScenePage", makeAfterPatch(patchNativeSceneDetails));
          activePatch.after("SceneDetails", makeAfterPatch(patchNativeSceneDetails));
          activePatch.after("SceneDetails.Sidebar", makeAfterPatch(patchNativeSceneDetails));
          activePatch.after("SceneFileInfoPanel", makeAfterPatch(patchNativeSceneDetails));
          activePatch.after("ScenePlayer", makeAfterPatch(patchNativeScenePlayer));
        }

        if (activePatch.before) {
          activePatch.before("CheckboxGroup", function (props) {
            try {
              if (!props || props.groupId !== "menu-items") return [props];
              if (!Array.isArray(props.items)) return [props];
              if (props.items.some((item) => item.id === "files-manager")) return [props];
              return [
                Object.assign({}, props, {
                  items: props.items.concat([{ id: "files-manager", headingID: "Files" }]),
                }),
              ];
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
    function syncMainBarButtonActiveState() {
      if (typeof document === "undefined" || !document.getElementById) return;
      const btn = document.getElementById("sfm-nav-button");
      if (!btn || btn.getAttribute("data-sfm-dom-fallback") !== "true") return;
      const active = isFileManagerRouteActive();
      if (btn.classList) {
        if (active) btn.classList.add("active");
        else btn.classList.remove("active");
      } else {
        const base = (btn.className || "").replace(/\bactive\b/g, "").replace(/\s+/g, " ").trim();
        btn.className = active ? `${base} active`.trim() : base;
      }
    }

    function injectMainBarButtonFallback() {
      if (typeof document === "undefined" || !document.getElementById || !document.querySelector) return;
      if (document.getElementById("sfm-nav-container") || document.getElementById("sfm-nav-button")) {
        syncMainBarButtonActiveState();
        return;
      }

      const anchor =
        document.querySelector('.navbar-nav a[href*="/scenes"]') ||
        document.querySelector('.navbar-nav a[href*="/images"]') ||
        document.querySelector(".navbar-nav a");

      if (!anchor) return;

      const colItem = (anchor.closest && (anchor.closest("[class*='col-']") || anchor.closest(".nav-item"))) || anchor;
      const rowContainer = (colItem.closest && colItem.closest(".row")) || colItem.parentElement;
      if (!rowContainer) return;

      const colClass =
        (colItem.getAttribute && colItem.getAttribute("class")) ||
        "col-4 col-sm-3 col-md-2 col-lg-auto nav-link";

      const container = document.createElement("div");
      container.className = colClass;
      container.id = "sfm-nav-container";

      const a = document.createElement("a");
      a.href = "/plugin/file-manager";
      a.id = "sfm-nav-button";
      a.setAttribute("data-sfm-dom-fallback", "true");
      a.title = "File Manager (Browse by Directory)";
      a.setAttribute("aria-label", "File Manager");
      const active = isFileManagerRouteActive();
      a.className = `nav-link minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column justify-content-between align-items-center btn btn-primary${active ? " active" : ""}`;
      a.addEventListener("click", function (evt) {
        if (evt && typeof evt.preventDefault === "function") evt.preventDefault();
        navigateToPluginRoute("/plugin/file-manager");
        syncMainBarButtonActiveState();
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

    // ==========================================================================
    // Phase 4: Fallback DOM Injection Observers for Native Cards & Scene Details
    // ==========================================================================
    function injectSceneCardsDOMFallback() {
      if (typeof document === "undefined" || !document.querySelectorAll || !document.querySelector) return;
      if (
        typeof window !== "undefined" &&
        (isFileManagerRouteActive() ||
          window.location?.pathname?.includes("/tagger") ||
          window.location?.hash?.includes("tagger"))
      ) {
        return;
      }
      const cardEls = document.querySelectorAll(
        ".scene-card, .card.scene-card, .scene-cards-grid .card, .scene-card-grid .card, [class*='SceneCard']"
      );
      if (!cardEls || cardEls.length === 0) return;

      cardEls.forEach((cardEl) => {
        if (cardEl.getAttribute("data-sfm-decorated") === "true") return;
        if (cardEl.querySelector("[data-sfm-card-chip]")) {
          cardEl.setAttribute("data-sfm-decorated", "true");
          return;
        }

        const linkEl = cardEl.querySelector('a[href*="/scenes/"]');
        if (!linkEl) return;
        const href = linkEl.getAttribute("href") || "";
        const m = href.match(/\/scenes\/([a-zA-Z0-9_-]+)/);
        if (!m) return;
        const sceneId = m[1];

        const cachedScene = window.__SFM_GLOBAL_CACHE__?.scenes?.find((s) => String(s.id) === String(sceneId)) || {
          id: sceneId,
        };
        const folderPath = resolveSceneFolder(cachedScene);

        const targetContainer = cardEl.querySelector(".card-section, .scene-card__details, .card-body") || cardEl;
        const mountDiv = document.createElement("div");
        mountDiv.className = "sfm-native-card-injected-container";
        targetContainer.appendChild(mountDiv);
        cardEl.setAttribute("data-sfm-decorated", "true");

        ReactDOM.render(React.createElement(NativeSceneCardOverlay, { scene: cachedScene, folderPath }), mountDiv);
      });
    }

    function injectSceneDetailDOMFallback() {
      if (typeof document === "undefined" || !document.querySelector || !document.getElementById) return;
      if (isFileManagerRouteActive()) return;
      const m = typeof window !== "undefined" && window.location?.pathname?.match(/\/scenes\/([a-zA-Z0-9_-]+)/);
      if (!m) return;
      const sceneId = m[1];

      // 1. Directory Hierarchy Breadcrumbs Row
      if (!document.getElementById("sfm-scene-hierarchy-row")) {
        const sidebar = document.querySelector(
          ".scene-info, .scene-details, .details-list, .scene-sidebar, .col-lg-4 .card-body, .scene-file-info"
        );
        if (sidebar && !sidebar.querySelector("[data-sfm-hierarchy]")) {
          const cachedScene = window.__SFM_GLOBAL_CACHE__?.scenes?.find((s) => String(s.id) === String(sceneId)) || {
            id: sceneId,
          };
          const folderPath = resolveSceneFolder(cachedScene);
          const mountDiv = document.createElement("div");
          mountDiv.id = "sfm-scene-hierarchy-container";
          sidebar.appendChild(mountDiv);

          ReactDOM.render(
            React.createElement(NativeSceneDetailDirectoryHierarchy, { scene: cachedScene, folderPath }),
            mountDiv
          );
        }
      }

      // 2. Reel Mode Button
      if (!document.getElementById("sfm-scene-reel-btn")) {
        const toolbar = document.querySelector(
          ".scene-toolbar, .scene-header .btn-toolbar, .scene-header .btn-group, .video-player-container, .scene-player, .scene-header"
        );
        if (toolbar && !toolbar.querySelector("[data-sfm-reel-btn]")) {
          const cachedScene = window.__SFM_GLOBAL_CACHE__?.scenes?.find((s) => String(s.id) === String(sceneId)) || {
            id: sceneId,
          };
          const folderPath = resolveSceneFolder(cachedScene);
          const mountDiv = document.createElement("div");
          mountDiv.id = "sfm-scene-reel-btn-container";
          mountDiv.style.display = "inline-block";
          mountDiv.style.marginLeft = "8px";
          toolbar.appendChild(mountDiv);

          ReactDOM.render(React.createElement(NativeSceneDetailReelButton, { scene: cachedScene, folderPath }), mountDiv);
        }
      }

      // 3. Parse & Scrape Scene Button
      if (!document.getElementById("sfm-scene-scrape-btn")) {
        const toolbar = document.querySelector(
          ".scene-toolbar, .scene-header .btn-toolbar, .scene-header .btn-group, .video-player-container, .scene-player, .scene-header"
        );
        if (toolbar && !toolbar.querySelector("[data-sfm-scrape-btn]")) {
          const cachedScene = window.__SFM_GLOBAL_CACHE__?.scenes?.find((s) => String(s.id) === String(sceneId)) || {
            id: sceneId,
          };
          const folderPath = resolveSceneFolder(cachedScene);
          const mountDiv = document.createElement("div");
          mountDiv.id = "sfm-scene-scrape-btn-container";
          mountDiv.style.display = "inline-block";
          mountDiv.style.marginLeft = "6px";
          toolbar.appendChild(mountDiv);

          ReactDOM.render(
            React.createElement(NativeSceneDetailScrapeButton, { scene: cachedScene, folderPath }),
            mountDiv
          );
        }
      }
    }

    function injectSceneListDOMFallback() {
      if (typeof document === "undefined" || !document.querySelector) return;
      if (
        typeof window !== "undefined" &&
        (isFileManagerRouteActive() || window.location?.pathname?.match(/\/scenes\/[a-zA-Z0-9_-]+/))
      ) {
        return;
      }
      if (!window.location?.pathname?.startsWith("/scenes")) return;
      if (document.getElementById("sfm-scene-list-scrape-btn")) return;

      const toolbar =
        document.querySelector(".filtered-list-toolbar.btn-toolbar") ||
        document.querySelector(".filtered-list-toolbar") ||
        document.querySelector(".btn-toolbar");
      if (!toolbar) return;

      const btn = document.createElement("button");
      btn.id = "sfm-scene-list-scrape-btn";
      btn.type = "button";
      btn.className = "btn btn-secondary sfm-scene-scrape-btn";
      btn.style.cssText =
        "margin-left:8px;font-size:12px;padding:4px 10px;white-space:nowrap;font-weight:600;display:inline-flex;align-items:center;gap:4px;";
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#88c0d0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg> <span>Parse & Scrape</span>`;
      btn.title = "Parse & Scrape visible scenes on current page";

      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.textContent = "Loading scenes...";
        try {
          const cardLinks = Array.from(
            document.querySelectorAll(
              '.scene-card a[href*="/scenes/"], .card a[href*="/scenes/"], [class*="SceneCard"] a[href*="/scenes/"]'
            )
          );
          const sceneIds = Array.from(
            new Set(
              cardLinks
                .map((el) => {
                  const href = el.getAttribute("href") || "";
                  const m = href.match(/\/scenes\/([a-zA-Z0-9_-]+)/);
                  return m ? parseInt(m[1], 10) : null;
                })
                .filter((n) => n && !isNaN(n))
            )
          );

          if (sceneIds.length > 0) {
            const res = await gqlFetch(
              `query GetScenesByIds($ids: [Int!]) {
                findScenes(scene_ids: $ids, filter: { per_page: -1 }) {
                  scenes {
                    id
                    title
                    code
                    organized
                    details
                    url
                    date
                    rating100
                    play_count
                    o_counter
                    director
                    created_at
                    updated_at
                    last_played_at
                    studio { id name }
                    performers { id name }
                    tags { id name }
                    stash_ids { endpoint stash_id }
                    urls
                    files { id path basename size duration width height frame_rate bit_rate video_codec format }
                    paths { screenshot preview stream }
                  }
                }
              }`,
              { ids: sceneIds }
            );
            const scenes = res?.findScenes?.scenes || [];
            if (scenes.length > 0 && window.__SFM_OPEN_PARSER__) {
              window.__SFM_OPEN_PARSER__(scenes, `Scene List (${scenes.length} scenes)`);
            } else {
              if (typeof window !== "undefined" && typeof window.alert === "function") {
                window.alert("No scenes found to scrape on this page.");
              } else if (typeof alert === "function") {
                alert("No scenes found to scrape on this page.");
              } else {
                console.warn("[PathFileManager] No scenes found to scrape on this page.");
              }
            }
          } else {
            if (typeof window !== "undefined" && typeof window.alert === "function") {
              window.alert("No visible scene cards detected on current page.");
            } else if (typeof alert === "function") {
              alert("No visible scene cards detected on current page.");
            } else {
              console.warn("[PathFileManager] No visible scene cards detected on current page.");
            }
          }
        } catch (err) {
          console.warn("Failed to load scenes for list scrape:", err);
          const msg = "Error loading scenes: " + (err.message || String(err));
          if (typeof window !== "undefined" && typeof window.alert === "function") {
            window.alert(msg);
          } else if (typeof alert === "function") {
            alert(msg);
          }
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      });

      toolbar.appendChild(btn);
    }

    // Global Modal Launcher for Outside of File Manager
    window.__SFM_OPEN_PARSER__ = function (directScenes, currentFolder = "Scene View") {
      const ModalComp =
        SFM.FilenameParserModal || SFM.MetadataStudioModal || window.__SFM__?.FilenameParserModal || FilenameParserModal;
      if (!ModalComp) {
        console.warn("[PathFileManager] FilenameParserModal is not loaded yet.");
        return;
      }

      let rootEl = document.getElementById("sfm-global-modal-root");
      if (!rootEl) {
        rootEl = document.createElement("div");
        rootEl.id = "sfm-global-modal-root";
        document.body.appendChild(rootEl);
      }

      const handleClose = () => {
        if (ReactDOM && typeof ReactDOM.unmountComponentAtNode === "function") {
          ReactDOM.unmountComponentAtNode(rootEl);
        }
      };

      const handleApplied = () => {
        // Refresh single scene view if currently on /scenes/<id>
        const m = typeof window !== "undefined" && window.location?.pathname?.match(/\/scenes\/([a-zA-Z0-9_-]+)/);
        if (m) {
          setTimeout(() => {
            window.location.reload();
          }, 400);
        }
      };

      const handleScenePatched = (updatedScene) => {
        if (updatedScene && typeof patchCatalogSceneInPlace === "function") {
          patchCatalogSceneInPlace(updatedScene);
        }
      };

      ReactDOM.render(
        React.createElement(ModalComp, {
          currentFolder,
          currentPath: directScenes?.[0]?.files?.[0]?.path || "",
          directScenes,
          onClose: handleClose,
          onApplied: handleApplied,
          onScenePatched: handleScenePatched,
        }),
        rootEl
      );
    };

    let sfmMutationTimer = null;
    function scheduleNativeDomScan() {
      if (typeof document === "undefined" || !document.querySelector) return;
      if (sfmMutationTimer) return;
      sfmMutationTimer = setTimeout(() => {
        sfmMutationTimer = null;
        injectSceneCardsDOMFallback();
        injectSceneDetailDOMFallback();
        injectSceneListDOMFallback();
      }, 150);
    }

    // Bounded fallback injection timer (stops once injected or after 10 attempts to eliminate memory leaks)
    let fallbackAttempts = 0;
    const fallbackTimer = setInterval(() => {
      fallbackAttempts++;
      injectMainBarButtonFallback();
      if (document.getElementById("sfm-nav-button") || fallbackAttempts >= 10) {
        clearInterval(fallbackTimer);
      }
    }, 1000);
    setTimeout(injectMainBarButtonFallback, 250);

    const activeEvent = ApiEvent || window.PluginApi?.Event;
    if (activeEvent && typeof activeEvent.addEventListener === "function") {
      activeEvent.addEventListener("stash:location", () => {
        setTimeout(() => {
          injectMainBarButtonFallback();
          syncMainBarButtonActiveState();
        }, 150);
        scheduleNativeDomScan();
      });
    }

    if (typeof window.addEventListener === "function") {
      window.addEventListener("popstate", () => {
        syncMainBarButtonActiveState();
        scheduleNativeDomScan();
      });
      window.addEventListener("hashchange", scheduleNativeDomScan);
    }

    if (typeof MutationObserver !== "undefined" && document.body) {
      try {
        const nativeObserver = new MutationObserver(() => {
          scheduleNativeDomScan();
        });
        nativeObserver.observe(document.body, { childList: true, subtree: true });
      } catch (e) {}
    }
    setTimeout(scheduleNativeDomScan, 300);

    // Eager background library index restoration
    setTimeout(() => {
      if (typeof ensureCatalog === "function") {
        ensureCatalog().catch(() => {});
      }
    }, 100);

    // Expose public & native platform embedding APIs across shared caches
    const nativeExports = {
      FileManagerRouteWrapper,
      FilesNavButton,
      NativeSceneCardOverlay,
      NativeSceneDetailDirectoryHierarchy,
      NativeSceneDetailReelButton,
      NativeSceneDetailScrapeButton,
      patchNativeSceneCard,
      patchNativeSceneDetails,
      patchNativeScenePlayer,
      resolveSceneFolder,
      ensureCatalog,
      clearCachedScenes,
      patchCatalogSceneInPlace,
      normalizePath,
      buildRouteUrlForPath,
      parseQueryState,
      navigateToPluginRoute,
      navigateToFileManager,
      openFileManager: navigateToFileManager,
      openParser: window.__SFM_OPEN_PARSER__,
      injectMainBarButtonFallback,
      injectSceneCardsDOMFallback,
      injectSceneDetailDOMFallback,
      injectSceneListDOMFallback,
      SafeErrorBoundary,
    };

    const viewExports = {
      FolderProfileView: SFM.FolderProfileView || FolderProfileView,
      BingeReelPlayerModal: SFM.BingeReelPlayerModal || BingeReelPlayerModal,
      FileManagerView: SFM.FileManagerView || FileManagerView,
      SceneTableView: SFM.SceneTableView || SceneTableView,
      SceneNamesTableView: SFM.SceneNamesTableView || SceneNamesTableView,
      SceneCard: SFM.SceneCard || SceneCard,
      FilenameParserModal: SFM.FilenameParserModal || FilenameParserModal,
      MetadataStudioModal: SFM.MetadataStudioModal || FilenameParserModal,
      BatchMetadataModal: SFM.BatchMetadataModal || BatchMetadataModal,
      SettingsAndTasksModal: SFM.SettingsAndTasksModal || SettingsAndTasksModal,
    };

    Object.assign(window.__SFM__, nativeExports);
    window.__SFM_GLOBAL_CACHE__ = window.__SFM_GLOBAL_CACHE__ || { trie: null, scenes: null, timestamp: 0 };
    Object.assign(window.__SFM_GLOBAL_CACHE__, nativeExports, viewExports);

    if (window.PluginApi) {
      window.PluginApi.Filemanager = window.__SFM_GLOBAL_CACHE__;
    }

    window.__SFM_TEST_EXPORTS__ = window.__SFM_TEST_EXPORTS__ || {};
    Object.assign(window.__SFM_TEST_EXPORTS__, nativeExports, viewExports);

    console.log("[PathFileManager] Initialized successfully with all enhanced features.");
  } catch (err) {
    console.error("[PathFileManager] Startup error:", err);
  }
})();

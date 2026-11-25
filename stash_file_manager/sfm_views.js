(function () {
  "use strict";

  try {
    const SFM = window.__SFM__;
    if (!SFM || !SFM.React || !SFM.ReactDOM) {
      console.warn("[PathFileManager] window.__SFM__ core dependencies not ready in sfm_views.js.");
      return;
    }

    const {
      React,
      useState,
      useEffect,
      useMemo,
      useCallback,
      useRef,
      idbClear,
      patchCatalogSceneInPlace,
      gqlFetch,
      fetchStashPluginSettings,
      saveStashPluginSettings,
      formatBytes,
      formatDuration,
      SafeErrorBoundary,
      icons,
      ensureCatalog,
      getAllDescendantScenes,
      resolveSceneFolder,
      normalizePath,
      buildRouteUrlForPath,
      parseQueryState,
      navigateToPluginRoute,
      createShuffledQueue,
      sortScenesWithOrder,
      matchesSceneFilters,
      DEFAULT_SORT_DIR_MAP: CORE_DEFAULT_SORT_DIR_MAP,
    } = SFM;

    const {
      IconHome,
      IconArrowLeft,
      IconArrowUp,
      IconArrowDown,
      IconFolder,
      IconFolderCard,
      IconZoom,
      IconWidth,
      IconScan,
      IconGrid,
      IconGear,
      IconSearch,
      IconEdit,
      IconX,
      IconPlay,
      IconSettings,
      IconGlobe,
      IconAlert,
      IconCheck,
      IconRefresh,
      IconFilm,
      IconShuffle,
      IconColumns,
      IconFilter,
      IconChevronUp,
      IconChevronDown,
    } = icons;

    // ==========================================
    // R3/R4 Constants & Normalization Helpers
    // ==========================================
    const TABLE_COLUMNS_STORAGE_KEY = "sfm_table_columns_v1";

    const TABLE_COLUMN_DEFINITIONS = [
      { id: "checkbox", label: "Checkbox", defaultVisible: true, sortBase: null, defaultDir: "asc", width: "40px", align: "center" },
      { id: "cover", label: "Cover", defaultVisible: true, sortBase: null, defaultDir: "asc", width: "80px", align: "left" },
      { id: "filename", label: "Filename", defaultVisible: true, sortBase: "filename", defaultDir: "asc", minWidth: "170px", align: "left" },
      { id: "title", label: "Title", defaultVisible: true, sortBase: "title", defaultDir: "asc", minWidth: "180px", align: "left" },
      { id: "date", label: "Date", defaultVisible: true, sortBase: "date", defaultDir: "desc", width: "105px", align: "left" },
      { id: "studio", label: "Studio", defaultVisible: true, sortBase: "studio", defaultDir: "asc", width: "130px", align: "left" },
      { id: "code", label: "Code", defaultVisible: true, sortBase: "code", defaultDir: "asc", width: "110px", align: "left" },
      { id: "performers", label: "Performers", defaultVisible: true, sortBase: "performers", defaultDir: "asc", width: "160px", align: "left" },
      { id: "organized", label: "Organized", defaultVisible: true, sortBase: "organized", defaultDir: "desc", width: "90px", align: "center" },
      { id: "actions", label: "Actions", defaultVisible: true, sortBase: null, defaultDir: "asc", width: "130px", align: "center" },

      // Optional Extended R4 Columns (from scenes_index_v8)
      { id: "tags", label: "Tags", defaultVisible: false, sortBase: "tags", defaultDir: "asc", minWidth: "140px", align: "left" },
      { id: "rating100", label: "Rating", defaultVisible: false, sortBase: "rating", defaultDir: "desc", width: "85px", align: "left" },
      { id: "o_counter", label: "O-Counter", defaultVisible: false, sortBase: "o_counter", defaultDir: "desc", width: "90px", align: "center" },
      { id: "play_count", label: "Play Count", defaultVisible: false, sortBase: "play_count", defaultDir: "desc", width: "95px", align: "center" },
      { id: "duration", label: "Duration", defaultVisible: false, sortBase: "duration", defaultDir: "desc", width: "85px", align: "left" },
      { id: "resolution", label: "Resolution", defaultVisible: false, sortBase: "resolution", defaultDir: "desc", width: "115px", align: "left" },
      { id: "video_codec", label: "Video Codec/Format", defaultVisible: false, sortBase: null, defaultDir: "asc", width: "130px", align: "left" },
      { id: "bitrate_fps", label: "Bitrate/FPS", defaultVisible: false, sortBase: "bitrate", defaultDir: "desc", width: "130px", align: "left" },
      { id: "size", label: "File Size", defaultVisible: false, sortBase: "size", defaultDir: "desc", width: "95px", align: "left" },
      { id: "created_at", label: "Created", defaultVisible: false, sortBase: "created_at", defaultDir: "desc", width: "105px", align: "left" },
      { id: "updated_at", label: "Updated", defaultVisible: false, sortBase: "updated_at", defaultDir: "desc", width: "105px", align: "left" },
      { id: "last_played_at", label: "Last Played", defaultVisible: false, sortBase: "last_played_at", defaultDir: "desc", width: "105px", align: "left" },
      { id: "director", label: "Director", defaultVisible: false, sortBase: "director", defaultDir: "asc", width: "120px", align: "left" },
      { id: "urls_stash_ids", label: "URLs/StashIDs", defaultVisible: false, sortBase: null, defaultDir: "asc", width: "140px", align: "left" },
      { id: "folder_path", label: "Folder Path", defaultVisible: false, sortBase: null, defaultDir: "asc", minWidth: "150px", align: "left" },
    ];

    const COLUMN_DEF_MAP = Object.fromEntries(TABLE_COLUMN_DEFINITIONS.map((c) => [c.id, c]));

    function getDefaultTableColumns() {
      return TABLE_COLUMN_DEFINITIONS.map((c) => ({ id: c.id, visible: c.defaultVisible }));
    }

    function normalizeTableColumns(rawList) {
      if (!Array.isArray(rawList) || rawList.length === 0) {
        return getDefaultTableColumns();
      }
      const seen = new Set();
      const result = [];
      for (const item of rawList) {
        const id = item && typeof item.id === "string" ? item.id : null;
        if (id && COLUMN_DEF_MAP[id] && !seen.has(id)) {
          seen.add(id);
          result.push({ id, visible: Boolean(item.visible) });
        }
      }
      for (const def of TABLE_COLUMN_DEFINITIONS) {
        if (!seen.has(def.id)) {
          seen.add(def.id);
          result.push({ id: def.id, visible: def.defaultVisible });
        }
      }
      return result;
    }

    function loadTableColumnsConfig() {
      try {
        const raw = window.localStorage.getItem(TABLE_COLUMNS_STORAGE_KEY);
        if (!raw) return getDefaultTableColumns();
        const parsed = JSON.parse(raw);
        return normalizeTableColumns(parsed);
      } catch (e) {
        return getDefaultTableColumns();
      }
    }

    function saveTableColumnsConfig(cols) {
      try {
        window.localStorage.setItem(TABLE_COLUMNS_STORAGE_KEY, JSON.stringify(normalizeTableColumns(cols)));
      } catch (e) {}
    }

    function normalizeViewMode(mode) {
      const m = String(mode || "").trim().toLowerCase();
      if (m === "list" || m === "names" || m === "table") return "table";
      return "grid";
    }

    const DEFAULT_SORT_DIR_MAP = CORE_DEFAULT_SORT_DIR_MAP || {
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

    function parseSortKeyParts(sortKey, sortDirProp) {
      if (!sortKey || sortKey === "random") {
        return { sortBase: sortKey || null, sortDir: null };
      }
      if (sortDirProp && (sortDirProp === "asc" || sortDirProp === "desc")) {
        return { sortBase: String(sortKey).replace(/_(asc|desc)$/, ""), sortDir: sortDirProp };
      }
      const match = String(sortKey).match(/^(.+)_(asc|desc)$/);
      if (match) {
        return { sortBase: match[1], sortDir: match[2] };
      }
      const base = String(sortKey);
      return { sortBase: base, sortDir: DEFAULT_SORT_DIR_MAP[base] || "asc" };
    }

    function formatSceneResolution(file) {
      if (!file) return "";
      const h = Number(file.height) || 0;
      const w = Number(file.width) || 0;
      if (!h && !w) return "";
      let tier = "";
      if (h >= 2160) tier = "4K";
      else if (h >= 1440) tier = "1440p";
      else if (h >= 1080) tier = "1080p";
      else if (h >= 720) tier = "720p";
      else if (h > 0) tier = "SD";
      const dims = w && h ? `${w}×${h}` : `${h}p`;
      return tier ? `${tier} (${dims})` : dims;
    }

    const MISSING_FIELD_OPTIONS = [
      { id: "title", label: "Title" },
      { id: "studio", label: "Studio" },
      { id: "performers", label: "Performers" },
      { id: "date", label: "Date" },
      { id: "code", label: "Code" },
      { id: "tags", label: "Tags" },
      { id: "cover", label: "Cover" },
    ];

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

    // ==========================================
    // GraphQL Entity Resolvers for Inline Row Edit
    // ==========================================
    async function resolveOrCreateStudioByName(name) {
      const clean = String(name || "").trim();
      if (!clean) return null;
      const sRes = await gqlFetch(
        `query FindStudio($name: String!) {
          findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
            studios { id name }
          }
        }`,
        { name: clean }
      );
      let found = sRes?.findStudios?.studios?.[0];
      if (!found) {
        try {
          const cRes = await gqlFetch(
            `mutation CreateStudio($name: String!) {
              studioCreate(input: { name: $name }) { id name }
            }`,
            { name: clean }
          );
          found = cRes?.studioCreate;
        } catch (e) {
          const sRes2 = await gqlFetch(
            `query FindStudio2($name: String!) {
              findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
                studios { id name }
              }
            }`,
            { name: clean }
          );
          found = sRes2?.findStudios?.studios?.[0];
        }
      }
      return found || null;
    }

    async function resolveOrCreatePerformerByName(name) {
      const clean = String(name || "").trim();
      if (!clean) return null;
      const pRes = await gqlFetch(
        `query FindPerformer($name: String!) {
          findPerformers(performer_filter: { name: { value: $name, modifier: EQUALS } }) {
            performers { id name }
          }
        }`,
        { name: clean }
      );
      let found = pRes?.findPerformers?.performers?.[0];
      if (!found) {
        try {
          const cRes = await gqlFetch(
            `mutation CreatePerformer($name: String!) {
              performerCreate(input: { name: $name }) { id name }
            }`,
            { name: clean }
          );
          found = cRes?.performerCreate;
        } catch (e) {
          const pRes2 = await gqlFetch(
            `query FindPerformer2($name: String!) {
              findPerformers(performer_filter: { name: { value: $name, modifier: EQUALS } }) {
                performers { id name }
              }
            }`,
            { name: clean }
          );
          found = pRes2?.findPerformers?.performers?.[0];
        }
      }
      return found || null;
    }

    async function resolveOrCreateTagByName(name) {
      const clean = String(name || "").trim();
      if (!clean) return null;
      const tRes = await gqlFetch(
        `query FindTag($name: String!) {
          findTags(tag_filter: { name: { value: $name, modifier: EQUALS } }) {
            tags { id name }
          }
        }`,
        { name: clean }
      );
      let found = tRes?.findTags?.tags?.[0];
      if (!found) {
        try {
          const cRes = await gqlFetch(
            `mutation CreateTag($name: String!) {
              tagCreate(input: { name: $name }) { id name }
            }`,
            { name: clean }
          );
          found = cRes?.tagCreate;
        } catch (e) {
          const tRes2 = await gqlFetch(
            `query FindTag2($name: String!) {
              findTags(tag_filter: { name: { value: $name, modifier: EQUALS } }) {
                tags { id name }
              }
            }`,
            { name: clean }
          );
          found = tRes2?.findTags?.tags?.[0];
        }
      }
      return found || null;
    }

    // ==========================================
    // SceneCard Component
    // ==========================================
    function SceneCard({ scene, onPlay, isSelected, onToggleSelect, showFolderBadge, isSubfolderContext, currentPath }) {
      const [isHovered, setIsHovered] = useState(false);
      const showFolder = showFolderBadge !== undefined ? showFolderBadge : Boolean(isSubfolderContext);
      const thumbUrl = scene.paths?.screenshot || `/scene/${scene.id}/screenshot`;
      const previewVideoUrl = scene.paths?.preview || `/scene/${scene.id}/preview`;
      const studioName = scene.studio?.name;
      const performers = scene.performers?.map((p) => p.name).join(", ");
      const duration = formatDuration(scene.files?.[0]?.duration);
      const height = scene.files?.[0]?.height;
      const resolution = height
        ? height >= 2160
          ? "4K"
          : height >= 1440
          ? "1440p"
          : height >= 1080
          ? "1080p"
          : height >= 720
          ? "720p"
          : null
        : null;

      return React.createElement(
        "div",
        { className: `card scene-card sfm-scene-card sfm-native-scene-card ${isSelected ? "sfm-card-selected" : ""}` },
        React.createElement(
          "div",
          {
            className: `sfm-card-select-wrap ${isSelected ? "sfm-selected" : ""}`,
            onClick: (e) => {
              e.stopPropagation();
              if (onToggleSelect) onToggleSelect(scene.id);
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
            className: "card-image-container image-container sfm-scene-thumb-container",
            onMouseEnter: () => setIsHovered(true),
            onMouseLeave: () => setIsHovered(false),
            onClick: () => onPlay && onPlay(scene),
          },
          React.createElement("img", {
            src: thumbUrl,
            alt: scene.title || "Scene",
            className: "card-image sfm-scene-thumb",
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
          duration && React.createElement("div", { className: "sfm-duration-badge" }, duration),
          resolution && React.createElement("div", { className: "sfm-resolution-badge" }, resolution)
        ),
        React.createElement(
          "div",
          { className: "card-section scene-card__details sfm-scene-info p-2" },
          React.createElement(
            "div",
            { className: "scene-card__title" },
            React.createElement(
              "a",
              {
                href: `/scenes/${scene.id}`,
                target: "_blank",
                rel: "noreferrer",
                className: "sfm-scene-title font-weight-bold",
                title: scene.title || scene.files?.[0]?.basename,
              },
              scene.title || scene.files?.[0]?.basename || `Scene #${scene.id}`
            )
          ),
          studioName &&
            React.createElement(
              "div",
              { className: "badge badge-primary text-truncate mb-1", style: { maxWidth: "100%" } },
              studioName
            ),
          performers && React.createElement("div", { className: "text-truncate small text-info mb-1" }, performers),
          showFolder &&
            scene._folderPath &&
            (() => {
              const relFolder =
                currentPath && scene._folderPath.startsWith(currentPath + "/")
                  ? scene._folderPath.slice(currentPath.length + 1)
                  : currentPath === scene._folderPath
                  ? ""
                  : scene._folderPath;
              return relFolder
                ? React.createElement(
                    "div",
                    { className: "text-truncate small text-muted mb-1 d-flex align-items-center", title: `Folder: ${scene._folderPath}` },
                    React.createElement(IconFolder, { size: 11, className: "mr-1 text-info" }),
                    relFolder
                  )
                : null;
            })(),
          React.createElement(
            "div",
            { className: "sfm-scene-meta d-flex justify-content-between align-items-center small text-muted mt-1" },
            React.createElement("span", null, scene.date || "No date"),
            React.createElement(
              "span",
              { className: "d-inline-flex align-items-center gap-1" },
              scene.organized && React.createElement("span", { className: "badge badge-success py-0 px-1 mr-1", title: "Organized" }, "✓"),
              scene.rating100 && React.createElement("span", { className: "text-warning" }, `★ ${(scene.rating100 / 20).toFixed(1)}`)
            )
          )
        )
      );
    }

    // ==========================================
    // Consolidated Customizable Table View (R3, R4)
    // Replaces both SceneTableView and SceneNamesTableView
    // ==========================================
    function SceneTableView({
      scenes,
      directScenes,
      selectedIds,
      onToggleSelect,
      onToggleSelectScene,
      onToggleSelectAll,
      onSelectAll,
      onPlay,
      onPlayScene,
      onSceneClick,
      showFolderBadge,
      currentPath,
      sortKey,
      sortDir,
      onHeaderSort,
      columnsConfig,
      onColumnsConfigChange,
      onOpenColumnsConfig,
      onToggleOrganized,
      onInlineEditScene,
      onScenePatched,
    }) {
      const effectiveScenes = Array.isArray(scenes) ? scenes : Array.isArray(directScenes) ? directScenes : [];
      const effectiveSelectedIds =
        selectedIds instanceof Set ? selectedIds : new Set(Array.isArray(selectedIds) ? selectedIds : []);
      const handleToggleSelect = onToggleSelect || onToggleSelectScene || (() => {});
      const handleSelectAll = onToggleSelectAll || onSelectAll || (() => {});
      const handlePlay = onPlay || onPlayScene || (() => {});

      const [internalColumns, setInternalColumns] = useState(() => loadTableColumnsConfig());
      const effectiveColumns = useMemo(() => {
        return Array.isArray(columnsConfig) ? normalizeTableColumns(columnsConfig) : internalColumns;
      }, [columnsConfig, internalColumns]);

      const updateColumns = useCallback(
        (updater) => {
          const base = Array.isArray(columnsConfig) ? normalizeTableColumns(columnsConfig) : internalColumns;
          const next = normalizeTableColumns(typeof updater === "function" ? updater(base) : updater);
          saveTableColumnsConfig(next);
          if (!Array.isArray(columnsConfig)) {
            setInternalColumns(next);
          }
          if (typeof onColumnsConfigChange === "function") {
            onColumnsConfigChange(next);
          }
        },
        [columnsConfig, internalColumns, onColumnsConfigChange]
      );

      const [showColumnsDrawer, setShowColumnsDrawer] = useState(false);
      const [draggedColId, setDraggedColId] = useState(null);
      const [busyOrganizedIds, setBusyOrganizedIds] = useState(() => new Set());
      const [editingSceneId, setEditingSceneId] = useState(null);
      const [editDraft, setEditDraft] = useState(null);
      const [isSavingEdit, setIsSavingEdit] = useState(false);
      const [editError, setEditError] = useState("");

      const visibleColumns = useMemo(() => {
        return effectiveColumns
          .filter((c) => c.visible && COLUMN_DEF_MAP[c.id])
          .map((c) => ({ ...COLUMN_DEF_MAP[c.id], visible: true }));
      }, [effectiveColumns]);

      const { sortBase: activeSortBase, sortDir: activeSortDir } = parseSortKeyParts(sortKey, sortDir);
      const allSelected = effectiveScenes.length > 0 && effectiveScenes.every((s) => effectiveSelectedIds.has(s.id));

      const handleToggleColumnVisibility = (colId) => {
        updateColumns((prev) =>
          prev.map((c) => (c.id === colId ? { ...c, visible: !c.visible } : c))
        );
      };

      const handleMoveColumn = (colId, delta) => {
        updateColumns((prev) => {
          const current = prev.find((c) => c.id === colId);
          if (!current) return prev;
          if (current.visible) {
            const visibleList = prev.filter((c) => c.visible);
            const vIdx = visibleList.findIndex((c) => c.id === colId);
            if (vIdx === -1) return prev;
            const targetVIdx = vIdx + delta;
            if (targetVIdx < 0 || targetVIdx >= visibleList.length) return prev;
            const targetCol = visibleList[targetVIdx];
            const origFrom = prev.findIndex((c) => c.id === colId);
            const origTo = prev.findIndex((c) => c.id === targetCol.id);
            const copy = [...prev];
            const [moved] = copy.splice(origFrom, 1);
            copy.splice(origTo, 0, moved);
            return copy;
          }
          const idx = prev.findIndex((c) => c.id === colId);
          if (idx === -1) return prev;
          const targetIdx = idx + delta;
          if (targetIdx < 0 || targetIdx >= prev.length) return prev;
          const copy = [...prev];
          const [moved] = copy.splice(idx, 1);
          copy.splice(targetIdx, 0, moved);
          return copy;
        });
      };

      const handleReorderColumns = (sourceId, targetId) => {
        if (!sourceId || !targetId || sourceId === targetId) return;
        updateColumns((prev) => {
          const fromIdx = prev.findIndex((c) => c.id === sourceId);
          const toIdx = prev.findIndex((c) => c.id === targetId);
          if (fromIdx === -1 || toIdx === -1) return prev;
          const copy = [...prev];
          const [moved] = copy.splice(fromIdx, 1);
          copy.splice(toIdx, 0, moved);
          return copy;
        });
      };

      const handleResetColumns = () => {
        updateColumns(getDefaultTableColumns());
      };

      const handleOrganizedCheckboxChange = async (scene, nextVal) => {
        if (!scene || scene.id === undefined) return;
        if (typeof onToggleOrganized === "function") {
          await onToggleOrganized(scene, nextVal);
          return;
        }
        setBusyOrganizedIds((prev) => {
          const next = new Set(prev);
          next.add(scene.id);
          return next;
        });
        try {
          await gqlFetch(
            `mutation ToggleSceneOrganized($input: SceneUpdateInput!) {
              sceneUpdate(input: $input) {
                id
                organized
              }
            }`,
            { input: { id: scene.id, organized: Boolean(nextVal) } }
          );
          const patched = patchCatalogSceneInPlace({ id: scene.id, organized: Boolean(nextVal) });
          if (typeof onScenePatched === "function") {
            onScenePatched(patched || { ...scene, organized: Boolean(nextVal) });
          }
        } catch (err) {
          console.error("[SFM] Failed to toggle organized:", err);
        } finally {
          setBusyOrganizedIds((prev) => {
            const next = new Set(prev);
            next.delete(scene.id);
            return next;
          });
        }
      };

      const handleStartInlineEdit = (scene) => {
        if (!scene) return;
        setEditError("");
        setEditingSceneId(scene.id);
        setEditDraft({
          title: scene.title || "",
          date: scene.date || "",
          studio: scene.studio?.name || "",
          code: scene.code || "",
          organized: Boolean(scene.organized),
          performers: Array.isArray(scene.performers) ? scene.performers.map((p) => p.name).filter(Boolean).join(", ") : "",
          tags: Array.isArray(scene.tags) ? scene.tags.map((t) => t.name).filter(Boolean).join(", ") : "",
          rating100: scene.rating100 !== undefined && scene.rating100 !== null ? String(scene.rating100) : "",
          director: scene.director || "",
          _origStudio: scene.studio?.name || "",
          _origPerformers: Array.isArray(scene.performers) ? scene.performers.map((p) => p.name).filter(Boolean).join(", ") : "",
          _origTags: Array.isArray(scene.tags) ? scene.tags.map((t) => t.name).filter(Boolean).join(", ") : "",
        });
      };

      const handleCancelInlineEdit = () => {
        setEditingSceneId(null);
        setEditDraft(null);
        setEditError("");
      };

      const handleSaveInlineEdit = async (scene) => {
        if (!scene || !editDraft) return;
        setIsSavingEdit(true);
        setEditError("");
        try {
          const input = {
            id: scene.id,
            title: editDraft.title.trim(),
            code: editDraft.code.trim(),
            organized: Boolean(editDraft.organized),
            director: editDraft.director.trim(),
          };
          const trimmedDate = editDraft.date.trim();
          if (!trimmedDate || /^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
            input.date = trimmedDate || null;
          } else {
            throw new Error("Date must be YYYY-MM-DD or empty.");
          }
          input.rating100 = editDraft.rating100 !== "" ? Number(editDraft.rating100) : null;

          let nextStudio = scene.studio || null;
          const studioTrim = editDraft.studio.trim();
          if (studioTrim !== editDraft._origStudio.trim()) {
            if (!studioTrim) {
              input.studio_id = null;
              nextStudio = null;
            } else {
              const resolvedStudio = await resolveOrCreateStudioByName(studioTrim);
              if (resolvedStudio?.id) {
                input.studio_id = resolvedStudio.id;
                nextStudio = { id: resolvedStudio.id, name: resolvedStudio.name || studioTrim };
              }
            }
          }

          let nextPerformers = Array.isArray(scene.performers) ? scene.performers : [];
          const perfTrim = editDraft.performers.trim();
          if (perfTrim !== editDraft._origPerformers.trim()) {
            if (!perfTrim) {
              input.performer_ids = [];
              nextPerformers = [];
            } else {
              const names = perfTrim.split(",").map((n) => n.trim()).filter(Boolean);
              const resolved = [];
              for (const n of names) {
                const p = await resolveOrCreatePerformerByName(n);
                if (p?.id) resolved.push({ id: p.id, name: p.name || n });
              }
              input.performer_ids = resolved.map((p) => p.id);
              nextPerformers = resolved;
            }
          }

          let nextTags = Array.isArray(scene.tags) ? scene.tags : [];
          const tagsTrim = editDraft.tags.trim();
          if (tagsTrim !== editDraft._origTags.trim()) {
            if (!tagsTrim) {
              input.tag_ids = [];
              nextTags = [];
            } else {
              const names = tagsTrim.split(",").map((n) => n.trim()).filter(Boolean);
              const resolved = [];
              for (const n of names) {
                const t = await resolveOrCreateTagByName(n);
                if (t?.id) resolved.push({ id: t.id, name: t.name || n });
              }
              input.tag_ids = resolved.map((t) => t.id);
              nextTags = resolved;
            }
          }

          const res = await gqlFetch(
            `mutation UpdateSceneInline($input: SceneUpdateInput!) {
              sceneUpdate(input: $input) {
                id
                title
                date
                code
                organized
                rating100
                director
                studio { id name }
                performers { id name }
                tags { id name }
              }
            }`,
            { input }
          );

          const serverScene = res?.sceneUpdate;
          const patchedPayload = {
            id: scene.id,
            title: serverScene?.title !== undefined ? serverScene.title : input.title,
            date: serverScene?.date !== undefined ? serverScene.date : input.date || "",
            code: serverScene?.code !== undefined ? serverScene.code : input.code,
            organized: serverScene?.organized !== undefined ? Boolean(serverScene.organized) : input.organized,
            rating100: serverScene?.rating100 !== undefined ? serverScene.rating100 : input.rating100,
            director: serverScene?.director !== undefined ? serverScene.director : input.director,
            studio: serverScene?.studio !== undefined ? serverScene.studio : nextStudio,
            performers: Array.isArray(serverScene?.performers) ? serverScene.performers : nextPerformers,
            tags: Array.isArray(serverScene?.tags) ? serverScene.tags : nextTags,
          };

          const merged = patchCatalogSceneInPlace(patchedPayload) || { ...scene, ...patchedPayload };
          if (typeof onScenePatched === "function") {
            onScenePatched(merged);
          }
          if (typeof onInlineEditScene === "function") {
            onInlineEditScene(merged);
          }
          setEditingSceneId(null);
          setEditDraft(null);
        } catch (err) {
          setEditError(err?.message || String(err));
        } finally {
          setIsSavingEdit(false);
        }
      };

      const renderCell = (col, scene) => {
        const isSelected = effectiveSelectedIds.has(scene.id);
        const file = scene.files?.[0] || {};
        const filename = file.basename || "";
        const thumbUrl = scene.paths?.screenshot || `/scene/${scene.id}/screenshot`;

        switch (col.id) {
          case "checkbox":
            return React.createElement(
              "td",
              { key: col.id, style: { textAlign: "center" } },
              React.createElement("input", {
                type: "checkbox",
                checked: isSelected,
                onChange: () => handleToggleSelect(scene.id),
                onClick: (e) => e.stopPropagation(),
              })
            );
          case "cover":
            return React.createElement(
              "td",
              { key: col.id },
              React.createElement(
                "div",
                {
                  className: "sfm-table-thumb-wrap",
                  onClick: (e) => {
                    e.stopPropagation();
                    handlePlay(scene);
                  },
                  title: "Click to play inline",
                },
                React.createElement("img", {
                  src: thumbUrl,
                  alt: scene.title || filename || "",
                  className: "sfm-table-thumb",
                  loading: "lazy",
                }),
                React.createElement("span", { className: "sfm-table-play-icon" }, "▶")
              )
            );
          case "filename":
            return React.createElement(
              "td",
              { key: col.id },
              React.createElement(
                "span",
                {
                  className: "sfm-filename-text text-monospace small",
                  style: { fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
                  title: file.path || filename || "",
                },
                filename || "—"
              ),
              showFolderBadge &&
                scene._folderPath &&
                (() => {
                  const relFolder =
                    currentPath && scene._folderPath.startsWith(currentPath + "/")
                      ? scene._folderPath.slice(currentPath.length + 1)
                      : currentPath === scene._folderPath
                      ? ""
                      : scene._folderPath;
                  return relFolder
                    ? React.createElement(
                        "div",
                        { className: "sfm-table-subtext text-muted d-flex align-items-center" },
                        React.createElement(IconFolder, { size: 10, className: "mr-1 text-info" }),
                        relFolder
                      )
                    : null;
                })()
            );
          case "title":
            return React.createElement(
              "td",
              { key: col.id },
              React.createElement(
                "a",
                {
                  href: `/scenes/${scene.id}`,
                  target: "_blank",
                  rel: "noreferrer",
                  className: "sfm-table-title",
                  onClick: (e) => {
                    if (typeof onSceneClick === "function") {
                      onSceneClick(scene, e);
                    }
                  },
                },
                scene.title || filename || `Scene #${scene.id}`
              )
            );
          case "date":
            return React.createElement("td", { key: col.id, className: "small text-muted text-nowrap" }, scene.date || "—");
          case "studio":
            return React.createElement(
              "td",
              { key: col.id },
              scene.studio?.name
                ? React.createElement(
                    "span",
                    { className: "badge badge-primary text-truncate d-inline-block", style: { maxWidth: "120px" }, title: scene.studio.name },
                    scene.studio.name
                  )
                : React.createElement("span", { className: "text-muted small" }, "—")
            );
          case "code":
            return React.createElement(
              "td",
              { key: col.id },
              scene.code
                ? React.createElement("span", { className: "badge badge-dark border border-secondary text-info small" }, scene.code)
                : React.createElement("span", { className: "text-muted small" }, "—")
            );
          case "performers": {
            const perfText = Array.isArray(scene.performers)
              ? scene.performers.map((p) => p?.name).filter(Boolean).join(", ")
              : "";
            return React.createElement(
              "td",
              { key: col.id },
              perfText
                ? React.createElement(
                    "span",
                    { className: "text-info small text-truncate d-inline-block", style: { maxWidth: "155px" }, title: perfText },
                    perfText
                  )
                : React.createElement("span", { className: "text-muted small" }, "—")
            );
          }
          case "organized": {
            const isBusy = busyOrganizedIds.has(scene.id);
            return React.createElement(
              "td",
              { key: col.id, style: { textAlign: "center" } },
              React.createElement("input", {
                type: "checkbox",
                className: "sfm-organized-checkbox",
                checked: Boolean(scene.organized),
                disabled: isBusy,
                onChange: (e) => handleOrganizedCheckboxChange(scene, e.target.checked),
                onClick: (e) => e.stopPropagation(),
                title: scene.organized ? "Organized (click to mark unorganized)" : "Unorganized (click to mark organized)",
                "aria-label": `Organized status for ${scene.title || filename || scene.id}`,
              })
            );
          }
          case "actions": {
            const isEditing = editingSceneId === scene.id;
            return React.createElement(
              "td",
              { key: col.id, style: { textAlign: "center" } },
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: `btn ${isEditing ? "btn-warning" : "btn-outline-warning"} py-0 px-2 sfm-row-edit-btn sfm-btn-inline-edit`,
                    onClick: (e) => {
                      e.stopPropagation();
                      if (isEditing) handleCancelInlineEdit();
                      else handleStartInlineEdit(scene);
                    },
                    title: isEditing ? "Close inline editor" : "Inline Edit Metadata",
                  },
                  React.createElement(IconEdit, { size: 11 }),
                  "Edit"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-outline-info py-0 px-2",
                    onClick: (e) => {
                      e.stopPropagation();
                      handlePlay(scene);
                    },
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
                    onClick: (e) => e.stopPropagation(),
                  },
                  "↗"
                )
              )
            );
          }
          case "tags": {
            const tags = Array.isArray(scene.tags) ? scene.tags.filter((t) => t?.name) : [];
            return React.createElement(
              "td",
              { key: col.id },
              tags.length > 0
                ? React.createElement(
                    "div",
                    { className: "d-flex flex-wrap gap-1", style: { maxWidth: "200px" }, title: tags.map((t) => t.name).join(", ") },
                    tags.slice(0, 3).map((t) =>
                      React.createElement("span", { key: t.id || t.name, className: "badge badge-secondary mr-1 mb-1 small" }, t.name)
                    ),
                    tags.length > 3 && React.createElement("span", { className: "badge badge-dark text-muted small mb-1" }, `+${tags.length - 3}`)
                  )
                : React.createElement("span", { className: "text-muted small" }, "—")
            );
          }
          case "rating100":
            return React.createElement(
              "td",
              { key: col.id },
              scene.rating100 !== undefined && scene.rating100 !== null && scene.rating100 > 0
                ? React.createElement("span", { className: "text-warning small font-weight-bold" }, `★ ${(scene.rating100 / 20).toFixed(1)}`)
                : React.createElement("span", { className: "text-muted small" }, "—")
            );
          case "o_counter":
            return React.createElement(
              "td",
              { key: col.id, style: { textAlign: "center" }, className: "small text-light" },
              scene.o_counter !== undefined && scene.o_counter !== null ? String(scene.o_counter) : "0"
            );
          case "play_count":
            return React.createElement(
              "td",
              { key: col.id, style: { textAlign: "center" }, className: "small text-light" },
              scene.play_count !== undefined && scene.play_count !== null ? String(scene.play_count) : "0"
            );
          case "duration":
            return React.createElement("td", { key: col.id, className: "small text-muted text-nowrap" }, formatDuration(file.duration) || "—");
          case "resolution":
            return React.createElement("td", { key: col.id, className: "small text-info text-nowrap" }, formatSceneResolution(file) || "—");
          case "video_codec": {
            const codecText = [file.video_codec, file.format].filter(Boolean).join(" / ");
            return React.createElement("td", { key: col.id, className: "small text-muted text-nowrap" }, codecText || "—");
          }
          case "bitrate_fps": {
            const br = file.bit_rate ? `${(Number(file.bit_rate) / 1000000).toFixed(1)} Mbps` : "";
            const fps = file.frame_rate ? `${Math.round(Number(file.frame_rate) * 100) / 100} fps` : "";
            const txt = [br, fps].filter(Boolean).join(" · ");
            return React.createElement("td", { key: col.id, className: "small text-muted text-nowrap" }, txt || "—");
          }
          case "size":
            return React.createElement("td", { key: col.id, className: "small text-muted text-nowrap" }, file.size ? formatBytes(file.size) : "—");
          case "created_at":
            return React.createElement(
              "td",
              { key: col.id, className: "small text-muted text-nowrap", title: scene.created_at || "" },
              scene.created_at ? String(scene.created_at).slice(0, 10) : "—"
            );
          case "updated_at":
            return React.createElement(
              "td",
              { key: col.id, className: "small text-muted text-nowrap", title: scene.updated_at || "" },
              scene.updated_at ? String(scene.updated_at).slice(0, 10) : "—"
            );
          case "last_played_at":
            return React.createElement(
              "td",
              { key: col.id, className: "small text-muted text-nowrap", title: scene.last_played_at || "" },
              scene.last_played_at ? String(scene.last_played_at).slice(0, 10) : "—"
            );
          case "director":
            return React.createElement("td", { key: col.id, className: "small text-light" }, scene.director || "—");
          case "urls_stash_ids": {
            const urls = Array.isArray(scene.urls) ? scene.urls.filter(Boolean) : [];
            const sids = Array.isArray(scene.stash_ids) ? scene.stash_ids : [];
            return React.createElement(
              "td",
              { key: col.id, className: "small text-muted" },
              urls.length === 0 && sids.length === 0
                ? "—"
                : React.createElement(
                    "div",
                    { className: "d-flex flex-column", style: { maxWidth: "150px" } },
                    urls[0] &&
                      React.createElement(
                        "a",
                        {
                          href: urls[0],
                          target: "_blank",
                          rel: "noreferrer",
                          className: "text-info text-truncate",
                          title: urls.join("\n"),
                        },
                        urls[0].replace(/^https?:\/\//, "")
                      ),
                    sids.length > 0 &&
                      React.createElement(
                        "span",
                        { className: "text-muted small", title: sids.map((s) => `${s.endpoint}: ${s.stash_id}`).join("\n") },
                        `${sids.map((s) => (s.endpoint || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean).join(", ") || `${sids.length} StashID${sids.length > 1 ? "s" : ""}`}`
                      )
                  )
            );
          }
          case "folder_path": {
            const fp = scene._folderPath || resolveSceneFolder(scene) || "";
            return React.createElement(
              "td",
              { key: col.id, className: "small text-muted text-truncate", style: { maxWidth: "180px" }, title: fp },
              fp || "—"
            );
          }
          default:
            return React.createElement("td", { key: col.id }, "—");
        }
      };

      const renderInlineEditRow = (scene) => {
        if (!editDraft || editingSceneId !== scene.id) return null;
        return React.createElement(
          "tr",
          { key: `${scene.id}-inline-edit`, className: "sfm-inline-edit-row bg-dark" },
          React.createElement(
            "td",
            { colSpan: Math.max(1, visibleColumns.length), className: "p-3" },
            React.createElement(
              "div",
              { className: "sfm-inline-editor-card sfm-inline-editor p-2 border border-info rounded" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-2" },
                React.createElement("strong", { className: "small text-info" }, `Editing Scene #${scene.id}: ${scene.files?.[0]?.basename || scene.title || ""}`),
                editError && React.createElement("span", { className: "small text-danger" }, editError)
              ),
              React.createElement(
                "div",
                { className: "row" },
                React.createElement(
                  "div",
                  { className: "col-md-4 mb-2" },
                  React.createElement("label", { className: "small text-muted mb-1 d-block" }, "Title"),
                  React.createElement("input", {
                    type: "text",
                    name: "title",
                    "data-field": "title",
                    className: "form-control form-control-sm bg-dark text-light border-secondary",
                    value: editDraft.title,
                    onChange: (e) => setEditDraft((p) => ({ ...p, title: e.target.value })),
                  })
                ),
                React.createElement(
                  "div",
                  { className: "col-md-2 mb-2" },
                  React.createElement("label", { className: "small text-muted mb-1 d-block" }, "Date"),
                  React.createElement("input", {
                    type: "text",
                    name: "date",
                    "data-field": "date",
                    placeholder: "YYYY-MM-DD",
                    className: "form-control form-control-sm bg-dark text-light border-secondary",
                    value: editDraft.date,
                    onChange: (e) => setEditDraft((p) => ({ ...p, date: e.target.value })),
                  })
                ),
                React.createElement(
                  "div",
                  { className: "col-md-3 mb-2" },
                  React.createElement("label", { className: "small text-muted mb-1 d-block" }, "Studio"),
                  React.createElement("input", {
                    type: "text",
                    name: "studio",
                    "data-field": "studio",
                    className: "form-control form-control-sm bg-dark text-light border-secondary",
                    value: editDraft.studio,
                    onChange: (e) => setEditDraft((p) => ({ ...p, studio: e.target.value })),
                  })
                ),
                React.createElement(
                  "div",
                  { className: "col-md-3 mb-2" },
                  React.createElement("label", { className: "small text-muted mb-1 d-block" }, "Code"),
                  React.createElement("input", {
                    type: "text",
                    name: "code",
                    "data-field": "code",
                    className: "form-control form-control-sm bg-dark text-light border-secondary",
                    value: editDraft.code,
                    onChange: (e) => setEditDraft((p) => ({ ...p, code: e.target.value })),
                  })
                )
              ),
              React.createElement(
                "div",
                { className: "row" },
                React.createElement(
                  "div",
                  { className: "col-md-4 mb-2" },
                  React.createElement("label", { className: "small text-muted mb-1 d-block" }, "Performers (comma-separated)"),
                  React.createElement("input", {
                    type: "text",
                    name: "performers",
                    "data-field": "performers",
                    className: "form-control form-control-sm bg-dark text-light border-secondary",
                    value: editDraft.performers,
                    onChange: (e) => setEditDraft((p) => ({ ...p, performers: e.target.value })),
                  })
                ),
                React.createElement(
                  "div",
                  { className: "col-md-4 mb-2" },
                  React.createElement("label", { className: "small text-muted mb-1 d-block" }, "Tags (comma-separated)"),
                  React.createElement("input", {
                    type: "text",
                    name: "tags",
                    "data-field": "tags",
                    className: "form-control form-control-sm bg-dark text-light border-secondary",
                    value: editDraft.tags,
                    onChange: (e) => setEditDraft((p) => ({ ...p, tags: e.target.value })),
                  })
                ),
                React.createElement(
                  "div",
                  { className: "col-md-2 mb-2" },
                  React.createElement("label", { className: "small text-muted mb-1 d-block" }, "Rating"),
                  React.createElement(
                    "select",
                    {
                      name: "rating100",
                      "data-field": "rating",
                      className: "form-control form-control-sm bg-dark text-light border-secondary",
                      value: editDraft.rating100,
                      onChange: (e) => setEditDraft((p) => ({ ...p, rating100: e.target.value })),
                    },
                    React.createElement("option", { value: "" }, "Unrated"),
                    React.createElement("option", { value: "100" }, "★★★★★ (5)"),
                    React.createElement("option", { value: "80" }, "★★★★☆ (4)"),
                    React.createElement("option", { value: "60" }, "★★★☆☆ (3)"),
                    React.createElement("option", { value: "40" }, "★★☆☆☆ (2)"),
                    React.createElement("option", { value: "20" }, "★☆☆☆☆ (1)")
                  )
                ),
                React.createElement(
                  "div",
                  { className: "col-md-2 mb-2 d-flex align-items-end justify-content-between" },
                  React.createElement(
                    "label",
                    { className: "small text-light mb-1 d-inline-flex align-items-center", style: { cursor: "pointer" } },
                    React.createElement("input", {
                      type: "checkbox",
                      name: "organized",
                      "data-field": "organized",
                      className: "mr-1",
                      checked: Boolean(editDraft.organized),
                      onChange: (e) => setEditDraft((p) => ({ ...p, organized: e.target.checked })),
                    }),
                    "Organized"
                  )
                )
              ),
              React.createElement(
                "div",
                { className: "d-flex justify-content-end gap-2 mt-1" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-secondary mr-2",
                    onClick: handleCancelInlineEdit,
                    disabled: isSavingEdit,
                  },
                  "Cancel"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-primary",
                    onClick: () => handleSaveInlineEdit(scene),
                    disabled: isSavingEdit,
                  },
                  React.createElement(IconCheck, { size: 12, className: "mr-1" }),
                  isSavingEdit ? "Saving..." : "Save"
                )
              )
            )
          )
        );
      };

      return React.createElement(
        "div",
        { className: "sfm-table-container position-relative" },
        // Table Top Bar with ⚙ Columns Configurator Button & Drawer
        React.createElement(
          "div",
          { className: "sfm-table-topbar d-flex justify-content-between align-items-center mb-2 px-1" },
          React.createElement(
            "span",
            { className: "small text-muted" },
            `Showing ${visibleColumns.length} of ${effectiveColumns.length} columns · Click sortable column headers to sort`
          ),
          React.createElement(
            "div",
            { className: "position-relative" },
            React.createElement(
              "button",
              {
                type: "button",
                className: `btn btn-sm ${showColumnsDrawer ? "btn-info" : "btn-outline-secondary"} py-0 px-2 sfm-columns-btn d-inline-flex align-items-center`,
                onClick: () => {
                  setShowColumnsDrawer((prev) => !prev);
                  if (typeof onOpenColumnsConfig === "function") {
                    onOpenColumnsConfig();
                  }
                },
                title: "Customize visible table columns and order",
              },
              React.createElement(IconColumns, { size: 13, className: "mr-1" }),
              "⚙ Columns"
            ),
            showColumnsDrawer &&
              React.createElement(
                "div",
                {
                  className: "sfm-columns-drawer card bg-dark border border-secondary p-3 shadow-lg",
                  style: {
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: "6px",
                    width: "320px",
                    maxHeight: "420px",
                    overflowY: "auto",
                    zIndex: 1040,
                  },
                  onClick: (e) => e.stopPropagation(),
                },
                React.createElement(
                  "div",
                  { className: "d-flex justify-content-between align-items-center border-bottom border-secondary pb-2 mb-2" },
                  React.createElement("strong", { className: "small text-light" }, "Table Columns"),
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center gap-1" },
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "btn btn-xs btn-outline-warning py-0 px-2 mr-1 sfm-columns-reset-btn",
                        onClick: handleResetColumns,
                        title: "Reset columns and order to defaults",
                      },
                      "Reset to Defaults"
                    ),
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "btn btn-xs btn-outline-secondary py-0 px-1",
                        onClick: () => setShowColumnsDrawer(false),
                        title: "Close",
                      },
                      React.createElement(IconX, { size: 11 })
                    )
                  )
                ),
                React.createElement(
                  "div",
                  { className: "sfm-columns-list d-flex flex-column gap-1" },
                  effectiveColumns.map((colItem, idx) => {
                    const def = COLUMN_DEF_MAP[colItem.id];
                    if (!def) return null;
                    return React.createElement(
                      "div",
                      {
                        key: colItem.id,
                        draggable: true,
                        onDragStart: () => setDraggedColId(colItem.id),
                        onDragOver: (e) => e.preventDefault(),
                        onDrop: () => {
                          if (draggedColId) handleReorderColumns(draggedColId, colItem.id);
                          setDraggedColId(null);
                        },
                        className: "sfm-column-config-row d-flex align-items-center justify-content-between py-1 px-2 rounded",
                        style: { backgroundColor: "rgba(255,255,255,0.03)" },
                      },
                      React.createElement(
                        "label",
                        { className: "d-flex align-items-center mb-0 small text-light flex-grow-1", style: { cursor: "pointer" } },
                        React.createElement("input", {
                          type: "checkbox",
                          name: colItem.id,
                          "data-col-id": colItem.id,
                          title: def.label,
                          className: "mr-2",
                          checked: Boolean(colItem.visible),
                          onChange: () => handleToggleColumnVisibility(colItem.id),
                        }),
                        React.createElement("span", null, def.label)
                      ),
                      React.createElement(
                        "div",
                        { className: "btn-group btn-group-sm" },
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-outline-secondary py-0 px-1",
                            disabled: idx === 0,
                            onClick: () => handleMoveColumn(colItem.id, -1),
                            title: "Move Up",
                          },
                          React.createElement(IconChevronUp, { size: 11 })
                        ),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-outline-secondary py-0 px-1",
                            disabled: idx === effectiveColumns.length - 1,
                            onClick: () => handleMoveColumn(colItem.id, 1),
                            title: "Move Down",
                          },
                          React.createElement(IconChevronDown, { size: 11 })
                        )
                      )
                    );
                  })
                )
              )
          )
        ),
        React.createElement(
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
                visibleColumns.map((col) => {
                  if (col.id === "checkbox") {
                    return React.createElement(
                      "th",
                      { key: col.id, style: { width: col.width, textAlign: "center" } },
                      React.createElement("input", {
                        type: "checkbox",
                        checked: allSelected,
                        onChange: handleSelectAll,
                        title: "Select All / None",
                      })
                    );
                  }
                  const isSortable = Boolean(col.sortBase);
                  const isActiveSort = isSortable && activeSortBase === col.sortBase;
                  const indicator = isActiveSort ? (activeSortDir === "asc" ? " ▲" : " ▼") : "";

                  return React.createElement(
                    "th",
                    {
                      key: col.id,
                      className: `${isSortable ? "sfm-th-sortable" : ""} ${isActiveSort ? "sfm-th-sort-active text-info" : ""}`.trim(),
                      style: {
                        width: col.width,
                        minWidth: col.minWidth,
                        textAlign: col.align || "left",
                        cursor: isSortable ? "pointer" : "default",
                        userSelect: "none",
                      },
                      "aria-sort": isActiveSort ? (activeSortDir === "asc" ? "ascending" : "descending") : isSortable ? "none" : undefined,
                      onClick: isSortable && typeof onHeaderSort === "function" ? () => onHeaderSort(col.sortBase) : undefined,
                      title: isSortable ? `Sort by ${col.label}` : undefined,
                    },
                    React.createElement("span", null, col.label),
                    isActiveSort && React.createElement("span", { className: "sfm-sort-indicator text-info ml-1" }, indicator.trim())
                  );
                })
              )
            ),
            React.createElement(
              "tbody",
              null,
              effectiveScenes.map((scene) => {
                const isSelected = effectiveSelectedIds.has(scene.id);
                return React.createElement(
                  React.Fragment,
                  { key: scene.id },
                  React.createElement(
                    "tr",
                    { className: isSelected ? "sfm-row-selected" : "" },
                    visibleColumns.map((col) => renderCell(col, scene))
                  ),
                  editingSceneId === scene.id && renderInlineEditRow(scene)
                );
              })
            )
          )
        )
      );
    }

    // Compatibility alias required by R3 & existing test suites
    const SceneNamesTableView = SceneTableView;

    // ==========================================
    // Modal: Plugin Settings & Troubleshooting Tasks
    // ==========================================
    function SettingsAndTasksModal({ isOpen, onClose, settings, onSaveSettings, onTriggerRebuild, onResetDefaults, onResetSettings }) {
      const normalizedSceneMode = normalizeViewMode(settings?.scene_view_mode || "grid");
      const [formData, setFormData] = useState({
        default_transcode_method: settings?.default_transcode_method || "direct",
        fallback_transcode_method: settings?.fallback_transcode_method || "hls",
        root_library_path: settings?.root_library_path || "",
        folder_view_mode: settings?.folder_view_mode || "cards",
        scene_view_mode: normalizedSceneMode,
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
            scene_view_mode: normalizeViewMode(settings?.scene_view_mode || "grid"),
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

      if (isOpen === false) return null;

      const handleReset = onResetDefaults || onResetSettings;

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
            React.createElement(
              "h5",
              { className: "mb-0" },
              React.createElement(IconSettings, { size: 18, color: "#88c0d0", className: "mr-2" }),
              "Stash File Manager — Settings & Tasks"
            ),
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

            React.createElement(
              "h6",
              { className: "text-primary border-bottom border-secondary pb-1 mb-3 d-flex align-items-center" },
              React.createElement(IconFilm, { size: 15, color: "#88c0d0", className: "mr-2" }),
              "Video Playback & Transcoding"
            ),
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

            React.createElement(
              "h6",
              { className: "text-primary border-bottom border-secondary pb-1 mb-3 mt-4 d-flex align-items-center" },
              React.createElement(IconFolder, { size: 15, color: "#88c0d0", className: "mr-2" }),
              "Navigation & Library Root"
            ),
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

            React.createElement(
              "h6",
              { className: "text-primary border-bottom border-secondary pb-1 mb-3 mt-4 d-flex align-items-center" },
              React.createElement(IconGrid, { size: 15, color: "#88c0d0", className: "mr-2" }),
              "View Modes & Layout Preferences"
            ),
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
                  React.createElement("option", { value: "grid" }, "Grid Cards (16:9)"),
                  React.createElement("option", { value: "table" }, "Table View (Customizable Columns)")
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

            React.createElement(
              "h6",
              { className: "text-primary border-bottom border-secondary pb-1 mb-3 mt-4 d-flex align-items-center" },
              React.createElement(IconRefresh, { size: 15, color: "#88c0d0", className: "mr-2" }),
              "Stash Plugin Tasks & Troubleshooting"
            ),
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
                React.createElement(IconRefresh, { size: 14, className: "mr-1" }),
                "Rescan & Rebuild Tree"
              ),
              React.createElement(
                "button",
                {
                  className: "btn btn-outline-danger btn-sm mr-2 mb-2",
                  onClick: handleReset,
                  title: "Reset all plugin settings back to initial factory defaults",
                },
                React.createElement(IconAlert, { size: 14, className: "mr-1" }),
                "Reset All Settings to Default"
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
            React.createElement("span", { className: "small text-muted" }, "Settings are saved to Stash config and synchronized across browsers."),
            React.createElement(
              "div",
              null,
              React.createElement("button", { className: "btn btn-secondary btn-sm mr-2", onClick: onClose }, "Cancel"),
              React.createElement(
                "button",
                { className: "btn btn-primary btn-sm", onClick: handleSave, disabled: isSaving },
                React.createElement(IconCheck, { size: 14, className: "mr-1" }),
                isSaving ? "Saving..." : "Save to Stash Config"
              )
            )
          )
        )
      );
    }

    // ==========================================
    // Main Native Route Component: FileManagerView (R1-R5)
    // ==========================================
    function FileManagerView({ initialPath, location, onClose } = {}) {
      const [trie, setTrie] = useState(null);
      const [catalogVersion, setCatalogVersion] = useState(0);
      const historyStack = useRef([]);
      const isInternalRoutePushRef = useRef(false);

      const readRouteState = useCallback(() => {
        const searchStr = typeof location?.search === "string" && window.location?.search === "" ? location.search : window.location?.search || "";
        return parseQueryState(searchStr);
      }, [location]);

      const initialRouteState = useMemo(() => {
        return parseQueryState(typeof location?.search === "string" ? location.search : window.location?.search || "");
      }, []);

      const [currentPath, setCurrentPath] = useState(() => {
        if (typeof initialPath === "string") return normalizePath(initialPath);
        if (initialRouteState?.path) return normalizePath(initialRouteState.path);
        const searchStr = typeof location?.search === "string" ? location.search : window.location?.search || "";
        if (searchStr.includes("path=")) return "";
        try {
          return normalizePath(window.localStorage.getItem("sfm_last_folder_path") || "");
        } catch (e) {
          return "";
        }
      });

      const pushOrReplaceRoute = useCallback((url, replace = false) => {
        isInternalRoutePushRef.current = true;
        try {
          navigateToPluginRoute(url, replace);
        } finally {
          isInternalRoutePushRef.current = false;
        }
      }, []);

      const navigateToFolder = useCallback(
        (nextPath) => {
          const normalizedNext = normalizePath(nextPath);
          if (normalizedNext !== currentPath) {
            historyStack.current.push(currentPath);
          }
          setCurrentPath(normalizedNext);
          try {
            window.localStorage.setItem("sfm_last_folder_path", normalizedNext);
          } catch (e) {}
          const targetUrl = buildRouteUrlForPath(normalizedNext, null, null);
          const currentUrl = `${window.location?.pathname || ""}${window.location?.search || ""}`;
          if (currentUrl !== targetUrl) {
            pushOrReplaceRoute(targetUrl, false);
          }
        },
        [currentPath, pushOrReplaceRoute]
      );

      const handleGoBackInHistory = useCallback(() => {
        if (historyStack.current.length > 0) {
          const prev = historyStack.current.pop();
          const normalizedPrev = normalizePath(prev);
          setCurrentPath(normalizedPrev);
          try {
            window.localStorage.setItem("sfm_last_folder_path", normalizedPrev);
          } catch (e) {}
          const targetUrl = buildRouteUrlForPath(normalizedPrev, null, null);
          const currentUrl = `${window.location?.pathname || ""}${window.location?.search || ""}`;
          if (currentUrl !== targetUrl) {
            pushOrReplaceRoute(targetUrl, false);
          }
        } else if (currentPath) {
          const segs = currentPath.split("/").filter(Boolean);
          const parent = segs.slice(0, -1).join("/");
          navigateToFolder(parent);
        }
      }, [currentPath, navigateToFolder, pushOrReplaceRoute]);

      const handleGoUpOneLevel = useCallback(() => {
        if (!currentPath) return;
        const segs = currentPath.split("/").filter(Boolean);
        const parent = segs.slice(0, -1).join("/");
        navigateToFolder(parent);
      }, [currentPath, navigateToFolder]);

      const [loading, setLoading] = useState(true);
      const [statusText, setStatusText] = useState("Checking cache...");
      const [refreshKey, setRefreshKey] = useState(0);
      const [notification, setNotification] = useState("");

      // Search, Sort, Shuffle & Attribute Filters
      const [searchQuery, setSearchQuery] = useState("");
      const searchInputRef = useRef(null);
      const [folderSort, setFolderSort] = useState("name_asc");
      const [sceneSort, setSceneSort] = useState("title_asc");
      const [shuffleSeed, setShuffleSeed] = useState(1);

      const folderSortBase = folderSort.startsWith("count") ? "count" : "name";
      const folderSortDir = folderSort.endsWith("_desc") ? "desc" : "asc";
      const { sortBase: curSceneSortBase, sortDir: curSceneSortDir } = parseSortKeyParts(sceneSort);

      const [organizedFilter, setOrganizedFilter] = useState("all");
      const [missingFields, setMissingFields] = useState([]);
      const [resolutionFilter, setResolutionFilter] = useState("all");
      const [minRating, setMinRating] = useState(0);

      const handleSceneSortChange = useCallback((nextSort) => {
        if (!nextSort) return;
        if (nextSort === "random") {
          setSceneSort("random");
          setShuffleSeed((prev) => prev + 1);
          return;
        }
        if (nextSort.endsWith("_asc") || nextSort.endsWith("_desc")) {
          setSceneSort(nextSort);
          return;
        }
        const { sortDir: curDir } = parseSortKeyParts(sceneSort);
        const dir = curDir || DEFAULT_SORT_DIR_MAP[nextSort] || "asc";
        setSceneSort(`${nextSort}_${dir}`);
      }, [sceneSort]);

      const handleToggleSceneSortDir = useCallback(() => {
        if (sceneSort === "random") return;
        const { sortBase, sortDir } = parseSortKeyParts(sceneSort);
        const base = sortBase || "title";
        const nextDir = sortDir === "asc" ? "desc" : "asc";
        setSceneSort(`${base}_${nextDir}`);
      }, [sceneSort]);

      const handleToggleFolderSortDir = useCallback(() => {
        const isCount = folderSort.startsWith("count");
        const base = isCount ? "count" : "name";
        const isDesc = folderSort.endsWith("_desc");
        const nextDir = isDesc ? "asc" : "desc";
        setFolderSort(`${base}_${nextDir}`);
      }, [folderSort]);

      const handleReshuffle = useCallback(() => {
        setSceneSort("random");
        setShuffleSeed((prev) => prev + 1);
      }, []);

      const handleHeaderSort = useCallback(
        (sortBase) => {
          if (!sortBase) return;
          const { sortBase: curBase, sortDir: curDir } = parseSortKeyParts(sceneSort);
          const def = TABLE_COLUMN_DEFINITIONS.find((c) => c.sortBase === sortBase);
          const defaultDir = def?.defaultDir || "asc";
          let nextDir = defaultDir;
          if (curBase === sortBase) {
            nextDir = curDir === "asc" ? "desc" : "asc";
          }
          setSceneSort(`${sortBase}_${nextDir}`);
        },
        [sceneSort]
      );

      const handleToggleMissingField = useCallback((field) => {
        setMissingFields((prev) =>
          prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
        );
      }, []);

      const handleClearAllFilters = useCallback(() => {
        setSearchQuery("");
        setOrganizedFilter("all");
        setMissingFields([]);
        setResolutionFilter("all");
        setMinRating(0);
      }, []);

      const hasActiveFilters = Boolean(
        searchQuery.trim() ||
          organizedFilter !== "all" ||
          missingFields.length > 0 ||
          resolutionFilter !== "all" ||
          minRating > 0
      );

      // Subfolder & Section Toggles
      const [hideEmpty, setHideEmpty] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_hide_empty") === "true";
        } catch (e) {
          return false;
        }
      });

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

      const [includeSubfolders, setIncludeSubfolders] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_include_subfolders") === "true";
        } catch (e) {
          return false;
        }
      });

      const handleToggleIncludeSubfolders = useCallback((val) => {
        setIncludeSubfolders(val);
        setSceneSort("title_desc");
        try {
          window.localStorage.setItem("sfm_include_subfolders", String(val));
        } catch (e) {}
      }, []);

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
        setSceneSort("title_desc");
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

      // Consolidated Scene View Mode: ONLY "grid" or "table"
      const [viewMode, setViewMode] = useState(() => {
        try {
          return normalizeViewMode(window.localStorage.getItem("sfm_view_mode") || "grid");
        } catch (e) {
          return "grid";
        }
      });

      const [columnsConfig, setColumnsConfig] = useState(() => loadTableColumnsConfig());

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

      const [selectedSceneIds, setSelectedSceneIds] = useState(new Set());

      // Unified Metadata Studio Modal state (replaces separate BatchMetadataModal)
      const [showParserModal, setShowParserModal] = useState(false);
      const [parserInitialTab, setParserInitialTab] = useState("scrape");
      const [showSettingsModal, setShowSettingsModal] = useState(false);

      const [playingScene, setPlayingScene] = useState(() => {
        if (initialRouteState?.sceneId) {
          return { id: initialRouteState.sceneId };
        }
        return null;
      });

      const openMetadataStudio = useCallback((tab = "scrape") => {
        setParserInitialTab(tab || "scrape");
        setShowParserModal(true);
      }, []);

      const SCENE_CHUNK_SIZE = 48;
      const [visibleSceneCount, setVisibleSceneCount] = useState(SCENE_CHUNK_SIZE);
      const sceneSentinelRef = useRef(null);
      const isSceneLoadingRef = useRef(false);

      // Folder Profile & Video Wall State
      const [showFolderProfile, setShowFolderProfile] = useState(() => {
        return initialRouteState?.view === "profile" || initialRouteState?.view === "discover";
      });
      const [currentProfilePage, setCurrentProfilePage] = useState(() => {
        return initialRouteState?.view === "discover" ? 1 : 0;
      });

      const handleOpenFolderProfile = useCallback(
        (page = 0) => {
          setShowFolderProfile(true);
          setCurrentProfilePage(page);
          const viewName = page === 1 ? "discover" : "profile";
          const targetUrl = buildRouteUrlForPath(currentPath, viewName, null);
          const currentUrl = `${window.location?.pathname || ""}${window.location?.search || ""}`;
          if (currentUrl !== targetUrl) {
            pushOrReplaceRoute(targetUrl, false);
          }
        },
        [currentPath, pushOrReplaceRoute]
      );

      const handleCloseFolderProfile = useCallback(() => {
        setShowFolderProfile(false);
        const curDepth =
          window.history?.state && typeof window.history.state.sfmDepth === "number"
            ? window.history.state.sfmDepth
            : 0;
        if (curDepth > 1 && (window.location?.search || "").includes("view=")) {
          window.history.back();
        } else {
          const targetUrl = buildRouteUrlForPath(currentPath, null, null);
          const currentUrl = `${window.location?.pathname || ""}${window.location?.search || ""}`;
          if (currentUrl !== targetUrl) {
            pushOrReplaceRoute(targetUrl, true);
          }
        }
      }, [currentPath, pushOrReplaceRoute]);

      const [customPlayerScenes, setCustomPlayerScenes] = useState(null);
      const isClosingPlayerRef = useRef(false);

      const handleOpenProfileFromPlayer = useCallback(
        (targetPath) => {
          if (typeof document !== "undefined" && document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
          setPlayingScene(null);
          setCustomPlayerScenes(null);
          const p = normalizePath(targetPath);
          setCurrentPath(p);
          setShowFolderProfile(true);
          setCurrentProfilePage(0);
          const targetUrl = buildRouteUrlForPath(p, "profile", null);
          pushOrReplaceRoute(targetUrl, true);
        },
        [pushOrReplaceRoute]
      );

      const handlePlayScene = useCallback(
        (s, queue = null) => {
          if (!s) return;
          const sFolder = resolveSceneFolder(s, trie);
          if (sFolder && !s._folderPath) {
            s._folderPath = sFolder;
          }

          let effectiveQueue = null;
          if (trie && sFolder) {
            const node = trie.getNode(sFolder);
            if (node && Array.isArray(node.directScenes) && node.directScenes.length > 0) {
              effectiveQueue = node.directScenes;
            }
          }
          if (!effectiveQueue && Array.isArray(queue) && queue.length > 0) {
            effectiveQueue = queue;
          }

          const curSearch = window.location?.search || "";
          const isCurrentlyViewingVideo = Boolean(curSearch.includes("scene=") && !curSearch.includes("view="));

          setPlayingScene(s);
          setCustomPlayerScenes(effectiveQueue);
          setShowFolderProfile(false);

          const targetUrl = buildRouteUrlForPath(sFolder || currentPath, null, s.id);
          const currentUrl = `${window.location?.pathname || ""}${curSearch}`;
          if (currentUrl !== targetUrl) {
            pushOrReplaceRoute(targetUrl, isCurrentlyViewingVideo);
          }
        },
        [currentPath, trie, pushOrReplaceRoute]
      );

      const handleClosePlayer = useCallback(() => {
        if (typeof document !== "undefined" && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        isClosingPlayerRef.current = true;
        setPlayingScene(null);
        setCustomPlayerScenes(null);
        const curDepth =
          window.history?.state && typeof window.history.state.sfmDepth === "number"
            ? window.history.state.sfmDepth
            : 0;
        if (curDepth > 1 && (window.location?.search || "").includes("scene=")) {
          window.history.back();
        } else {
          const currentView = showFolderProfile ? (currentProfilePage === 1 ? "discover" : "profile") : null;
          const targetUrl = buildRouteUrlForPath(currentPath, currentView, null);
          const currentUrl = `${window.location?.pathname || ""}${window.location?.search || ""}`;
          if (currentUrl !== targetUrl) {
            pushOrReplaceRoute(targetUrl, true);
          }
          isClosingPlayerRef.current = false;
        }
      }, [currentPath, showFolderProfile, currentProfilePage, pushOrReplaceRoute]);

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
              try {
                window.localStorage.setItem("sfm_stream_mode", cfg.default_transcode_method);
              } catch (e) {}
            }
          }
          if (cfg.fallback_transcode_method) {
            window.__SFM_FALLBACK_TRANSCODE_METHOD__ = cfg.fallback_transcode_method;
          }
          const hasUrlPathParam = (window.location?.search || "").includes("path=");
          if (!hasUrlPathParam && typeof initialPath !== "string") {
            if (cfg.remember_last_path === false) {
              setCurrentPath(cfg.root_library_path ? normalizePath(cfg.root_library_path) : "");
            } else if (cfg.root_library_path && !currentPath && !window.localStorage.getItem("sfm_last_folder_path")) {
              setCurrentPath(normalizePath(cfg.root_library_path));
            }
          }
          if (cfg.folder_view_mode && !window.localStorage.getItem("sfm_folder_view_mode")) {
            setFolderViewMode(cfg.folder_view_mode);
          }
          if (cfg.scene_view_mode && !window.localStorage.getItem("sfm_view_mode")) {
            setViewMode(normalizeViewMode(cfg.scene_view_mode));
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
        return () => {
          isMounted = false;
        };
      }, []);

      const handleToggleViewMode = (mode) => {
        const normalized = normalizeViewMode(mode);
        setViewMode(normalized);
        try {
          window.localStorage.setItem("sfm_view_mode", normalized);
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

      const handleToggleHideEmpty = (val) => {
        setHideEmpty(val);
        try {
          window.localStorage.setItem("sfm_hide_empty", val ? "true" : "false");
        } catch (e) {}
      };

      const fetchCatalog = useCallback(async (forceBypassCache = false) => {
        setLoading(true);
        try {
          const loadedTrie = await ensureCatalog(forceBypassCache, (status) => setStatusText(status));
          if (loadedTrie) {
            setTrie(loadedTrie);
            setCatalogVersion((v) => v + 1);
          }
        } catch (err) {
          console.error(err);
          setNotification("Failed to load library: " + (err && err.message ? err.message : String(err)));
        } finally {
          setLoading(false);
        }
      }, []);

      useEffect(() => {
        fetchCatalog(refreshKey > 0);
      }, [fetchCatalog, refreshKey]);

      // Hydrate stub playingScene from ?scene=... once catalog loads
      useEffect(() => {
        if (playingScene && playingScene.id && (!playingScene.files || playingScene.files.length === 0)) {
          const allScenes = window.__SFM_GLOBAL_CACHE__?.scenes || [];
          const full = allScenes.find((s) => String(s.id) === String(playingScene.id));
          if (full) {
            setPlayingScene(full);
          }
        }
      }, [trie, catalogVersion, playingScene]);

      const handleRescan = async () => {
        if (window.__SFM_GLOBAL_CACHE__) {
          window.__SFM_GLOBAL_CACHE__.trie = null;
          window.__SFM_GLOBAL_CACHE__.scenes = null;
        }
        await idbClear();
        setRefreshKey((k) => k + 1);
      };

      const handleScenePatched = useCallback((patchedScene) => {
        if (!patchedScene) return;
        patchCatalogSceneInPlace(patchedScene);
        setCatalogVersion((v) => v + 1);
      }, []);

      const currentNode = useMemo(() => {
        if (!trie) return null;
        const node = trie.getNode(currentPath);
        if (!node && currentPath) {
          const sub = currentPath.split("/").slice(1).join("/");
          if (sub && trie.getNode(sub)) {
            return trie.getNode(sub);
          }
          return trie.root;
        }
        return node || trie.root;
      }, [trie, currentPath, catalogVersion]);

      useEffect(() => {
        if (!trie || !currentPath) return;
        const node = trie.getNode(currentPath);
        if (!node) {
          const sub = currentPath.split("/").slice(1).join("/");
          if (sub && trie.getNode(sub)) {
            setCurrentPath(sub);
          } else {
            setCurrentPath("");
          }
        }
      }, [trie, currentPath]);

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
      }, [currentNode, hideEmpty, searchQuery, folderSort, catalogVersion]);

      const filteredAndSortedScenes = useMemo(() => {
        if (!currentNode) return [];

        const filterCriteria = {
          searchQuery,
          organizedFilter,
          missingFields,
          resolutionFilter,
          minRating,
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
          if (sortByFolderFirst && sceneSort !== "random") {
            const seenIds = new Set();
            const collectHierarchy = (node) => {
              const collected = [];
              if (!node) return collected;

              if (node.folders) {
                const sortedKeys = sortFolderKeys(Object.keys(node.folders), node);
                for (const k of sortedKeys) {
                  collected.push(...collectHierarchy(node.folders[k]));
                }
              }

              if (node.directScenes && node.directScenes.length > 0) {
                const sortedDirect = sortScenesWithOrder(node.directScenes, sceneSort, shuffleSeed);
                for (const s of sortedDirect) {
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
            list = sortScenesWithOrder(getAllDescendantScenes(currentNode), sceneSort, shuffleSeed);
          }
        } else {
          list = sortScenesWithOrder(currentNode.directScenes || [], sceneSort, shuffleSeed);
        }

        return list.filter((s) => matchesSceneFilters(s, filterCriteria));
      }, [
        currentNode,
        includeSubfolders,
        searchQuery,
        organizedFilter,
        missingFields,
        resolutionFilter,
        minRating,
        sceneSort,
        shuffleSeed,
        folderSort,
        sortByFolderFirst,
        catalogVersion,
      ]);

      useEffect(() => {
        setVisibleSceneCount(SCENE_CHUNK_SIZE);
      }, [
        currentPath,
        searchQuery,
        organizedFilter,
        missingFields,
        resolutionFilter,
        minRating,
        sceneSort,
        shuffleSeed,
        folderSort,
        includeSubfolders,
        sortByFolderFirst,
      ]);

      useEffect(() => {
        if (typeof IntersectionObserver === "undefined") return;
        const sentinel = sceneSentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
          (entries) => {
            const first = entries[0];
            if (first && first.isIntersecting && !isSceneLoadingRef.current) {
              if (visibleSceneCount < filteredAndSortedScenes.length) {
                isSceneLoadingRef.current = true;
                setVisibleSceneCount((prev) => Math.min(prev + SCENE_CHUNK_SIZE, filteredAndSortedScenes.length));
                setTimeout(() => {
                  isSceneLoadingRef.current = false;
                }, 100);
              }
            }
          },
          { root: null, rootMargin: "350px 0px", threshold: 0.05 }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
      }, [visibleSceneCount, filteredAndSortedScenes.length]);

      const visibleScenes = useMemo(() => {
        return filteredAndSortedScenes.slice(0, visibleSceneCount);
      }, [filteredAndSortedScenes, visibleSceneCount]);

      const allDescendantIds = currentNode ? Array.from(currentNode.allSceneIds) : [];
      const currentFolderName = currentPath.split("/").filter(Boolean).pop() || "Stash";

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

      // Listen to sfm:set-path inter-component navigation events
      useEffect(() => {
        const handleCustomPath = (e) => {
          if (e.detail && typeof e.detail.path === "string") {
            const p = normalizePath(e.detail.path);
            if (e.detail.view) {
              setShowFolderProfile(true);
              setCurrentProfilePage(e.detail.view === "discover" ? 1 : 0);
            } else if (e.detail.view === null && !e.detail.sceneId) {
              setShowFolderProfile(false);
            }
            if (e.detail.sceneId) {
              const allAvailable = window.__SFM_GLOBAL_CACHE__?.scenes || [];
              const found = allAvailable.find((s) => String(s.id) === String(e.detail.sceneId)) || { id: e.detail.sceneId };
              setPlayingScene(found);
            }
            if (e.detail.isBrowserNav) {
              if (p !== currentPath) {
                setCurrentPath(p);
                try {
                  window.localStorage.setItem("sfm_last_folder_path", p);
                } catch (err) {}
              }
            } else {
              navigateToFolder(p);
            }
          }
        };
        window.addEventListener("sfm:set-path", handleCustomPath);
        return () => window.removeEventListener("sfm:set-path", handleCustomPath);
      }, [navigateToFolder, currentPath]);

      // Listen to popstate (browser Back/Forward) to restore ?path=, ?view=, and ?scene=
      useEffect(() => {
        const handleLocationChange = () => {
          if (isInternalRoutePushRef.current) return;
          const pathname = window.location?.pathname || "";
          const hash = window.location?.hash || "";
          if (pathname && !pathname.startsWith("/plugin/file-manager") && !hash.startsWith("#file-manager")) {
            return;
          }
          const state = parseQueryState(window.location?.search || "");
          if (!state) return;

          if (state.path !== currentPath) {
            setCurrentPath(state.path);
            try {
              window.localStorage.setItem("sfm_last_folder_path", state.path);
            } catch (err) {}
          }

          if (state.view === "profile" || state.view === "discover") {
            setShowFolderProfile(true);
            setCurrentProfilePage(state.view === "discover" ? 1 : 0);
            if (playingScene) {
              setPlayingScene(null);
              setCustomPlayerScenes(null);
            }
            isClosingPlayerRef.current = false;
            return;
          } else {
            setShowFolderProfile(false);
          }

          if (isClosingPlayerRef.current) {
            if (state.sceneId) {
              const targetUrl = buildRouteUrlForPath(state.path || currentPath, null, null);
              pushOrReplaceRoute(targetUrl, true);
            }
            isClosingPlayerRef.current = false;
            setPlayingScene(null);
            setCustomPlayerScenes(null);
            return;
          }

          if (state.sceneId) {
            if (!playingScene || String(playingScene.id) !== String(state.sceneId)) {
              const allAvailable = window.__SFM_GLOBAL_CACHE__?.scenes || (currentNode ? currentNode.directScenes : []);
              const found = allAvailable.find((s) => String(s.id) === String(state.sceneId)) || { id: state.sceneId };
              setPlayingScene(found);
            }
          } else if (playingScene) {
            setPlayingScene(null);
            setCustomPlayerScenes(null);
          }
        };

        window.addEventListener("popstate", handleLocationChange);
        return () => window.removeEventListener("popstate", handleLocationChange);
      }, [currentPath, playingScene, currentNode, pushOrReplaceRoute]);

      // Directory Keyboard Shortcuts
      useEffect(() => {
        const handleDirectoryKeyDown = (e) => {
          if (loading || playingScene || showSettingsModal || showParserModal) {
            return;
          }

          const activeEl = document.activeElement;
          const isInputActive =
            activeEl && (["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName) || activeEl.isContentEditable);

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
        showParserModal,
        currentPath,
        searchQuery,
        selectedSceneIds,
        handleGoUpOneLevel,
        handleSelectAllFolderScenes,
        onClose,
      ]);

      // Resolve sibling components dynamically from window.__SFM__ at render time
      const FilenameParserModal = window.__SFM__?.FilenameParserModal;
      const FolderProfileView = window.__SFM__?.FolderProfileView;
      const BingeReelPlayerModal = window.__SFM__?.BingeReelPlayerModal;

      if (loading) {
        return React.createElement(
          "div",
          { className: "sfm-native-page" },
          React.createElement(
            "div",
            { className: "sfm-workspace-header" },
            React.createElement(
              "div",
              { className: "sfm-workspace-title" },
              React.createElement(IconFolder, { size: 20, color: "#88c0d0" }),
              React.createElement("span", { className: "ml-2 sfm-native-heading" }, "Stash File Manager")
            )
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
      const isOverlayActive = Boolean(showFolderProfile || playingScene);

      const modalTargetScenes =
        selectedSceneIds.size > 0
          ? includeSubfolders
            ? getAllDescendantScenes(currentNode).filter((s) => selectedSceneIds.has(s.id))
            : currentNode
            ? currentNode.directScenes.filter((s) => selectedSceneIds.has(s.id))
            : []
          : includeSubfolders
          ? getAllDescendantScenes(currentNode)
          : currentNode
          ? currentNode.directScenes
          : [];

      return React.createElement(
        "div",
        { className: `sfm-native-page ${isOverlayActive ? "sfm-overlay-open" : ""}` },
        // Native Header
        React.createElement(
          "div",
          {
            className: "sfm-workspace-header",
            style: isOverlayActive ? { display: "none" } : undefined,
          },
          React.createElement(
            "div",
            { className: "sfm-workspace-title" },
            React.createElement(IconFolder, { size: 22, color: "#88c0d0" }),
            React.createElement("span", { className: "ml-2 sfm-native-heading" }, "Stash File Manager"),
            trie &&
              React.createElement(
                "span",
                { className: "sfm-stat-pill badge badge-dark ml-2 font-weight-normal" },
                React.createElement("strong", { style: { color: "#88c0d0" } }, trie.root.allSceneIds.size),
                React.createElement("span", { className: "ml-1 text-muted" }, "total scenes")
              )
          ),
          notification &&
            React.createElement(
              "div",
              { className: "small text-info text-truncate mx-3", title: notification },
              notification
            )
        ),
        // Scrollable Body
        React.createElement(
          "div",
          {
            className: "sfm-workspace-content",
            style: isOverlayActive ? { display: "none" } : undefined,
          },
          // Folder Navigation Control Line
          React.createElement(
            "div",
            { className: "sfm-nav-control-line mb-3" },
            // Line 1: Back/Up + Breadcrumbs + Stats + Scan/Profile + Settings
            React.createElement(
              "div",
              { className: "sfm-nav-line sfm-nav-line-path d-flex align-items-center justify-content-between flex-wrap gap-2" },
              React.createElement(
                "div",
                { className: "sfm-breadcrumbs-wrap d-flex align-items-center flex-wrap" },
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
                      onClick: () => handleOpenFolderProfile(0),
                      title: "Open Folder Profile & Video Wall (Explore Mode)",
                    },
                    React.createElement(IconGrid, { size: 14 })
                  )
                )
              ),
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
            // Line 2: Folder Sort + Scene Sort + Reshuffle + Search + Unified Metadata Studio Launchers
            React.createElement(
              "div",
              { className: "sfm-nav-line sfm-nav-line-controls d-flex align-items-center gap-2 mt-2 flex-wrap" },
                React.createElement(
                  "div",
                  { className: "sfm-sort-group d-flex align-items-center gap-2 flex-shrink-0 flex-wrap" },
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center sfm-sort-item" },
                    React.createElement("span", { className: "sfm-sort-label mr-1 text-muted small" }, "Folders:"),
                    React.createElement(
                      "select",
                      {
                        className: "sfm-sort-select sfm-folder-sort-select",
                        value: folderSortBase,
                        onChange: (e) => {
                          const val = e.target.value;
                          if (val.endsWith("_asc") || val.endsWith("_desc")) {
                            setFolderSort(val);
                          } else {
                            setFolderSort(`${val}_${folderSortDir}`);
                          }
                        },
                        title: "Sort Subfolders",
                      },
                      React.createElement("option", { value: "name" }, "Name"),
                      React.createElement("option", { value: "count" }, "Count")
                    ),
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "btn btn-sm btn-outline-secondary sfm-sort-dir-btn ml-1 py-0 px-2 d-inline-flex align-items-center",
                        onClick: handleToggleFolderSortDir,
                        title: folderSortDir === "asc" ? "Ascending (click to sort Descending)" : "Descending (click to sort Ascending)",
                        "data-sort-dir": folderSortDir,
                      },
                      folderSortDir === "asc"
                        ? React.createElement(IconArrowUp, { size: 13 })
                        : React.createElement(IconArrowDown, { size: 13 })
                    )
                  ),
                  React.createElement(
                    "div",
                    { className: "d-flex align-items-center sfm-sort-item" },
                    React.createElement("span", { className: "sfm-sort-label mr-1 text-muted small" }, "Scenes:"),
                    React.createElement(
                      "select",
                      {
                        className: "sfm-sort-select sfm-scene-sort-select",
                        value: sceneSort === "random" ? "random" : (curSceneSortBase || sceneSort),
                        onChange: (e) => handleSceneSortChange(e.target.value),
                        title: "Sort Scenes",
                        "data-sort-key": sceneSort,
                        "data-sort-dir": curSceneSortDir || undefined,
                      },
                      SCENE_SORT_OPTIONS.map((opt) =>
                        React.createElement("option", { key: opt.value, value: opt.value }, opt.label)
                      )
                    ),
                    sceneSort !== "random" &&
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-sm btn-outline-secondary sfm-sort-dir-btn ml-1 py-0 px-2 d-inline-flex align-items-center",
                          onClick: handleToggleSceneSortDir,
                          title: curSceneSortDir === "asc" ? "Ascending (click to sort Descending)" : "Descending (click to sort Ascending)",
                          "data-sort-dir": curSceneSortDir,
                        },
                        curSceneSortDir === "asc"
                          ? React.createElement(IconArrowUp, { size: 13 })
                          : React.createElement(IconArrowDown, { size: 13 })
                      ),
                    sceneSort === "random" &&
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-sm ml-1 py-0 px-2 sfm-reshuffle-btn d-inline-flex align-items-center btn-info font-weight-bold",
                          onClick: handleReshuffle,
                          title: "Reshuffle scenes order",
                        },
                        React.createElement(IconShuffle, { size: 13, className: "mr-1" }),
                        "Reshuffle"
                      )
                  )
                ),
              React.createElement(
                "div",
                { className: "sfm-search-wrap sfm-search-stretch flex-grow-1 mx-2" },
                React.createElement(
                  "span",
                  { className: "sfm-search-icon" },
                  React.createElement(IconSearch, { size: 14, color: "#81a1c1" })
                ),
                React.createElement("input", {
                  ref: searchInputRef,
                  type: "text",
                  className: "sfm-search-input w-100",
                  placeholder: "Search folder or scenes by title, tags, code... (Press / to focus)",
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
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm sfm-tools-group flex-shrink-0 ml-auto" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-outline-secondary py-1 px-2 sfm-launch-bulk-edit-btn",
                    onClick: () => openMetadataStudio("bulk_edit"),
                    title: "Open Unified Metadata Studio on Bulk Edit tab",
                  },
                  React.createElement(IconEdit, { size: 13, className: "mr-1" }),
                  "Bulk Edit"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-sm btn-outline-secondary py-1 px-2 sfm-launch-scrape-btn",
                    onClick: () => openMetadataStudio("scrape"),
                    title: "Scrape scenes from Stash-box / sites, parse filenames & rename",
                  },
                  React.createElement(IconGlobe, { size: 13, className: "mr-1 text-info" }),
                  "Parse & Scrape"
                )
              )
            ),
            // Line 3: Attribute Filter Bar (Organized, Missing Metadata, Resolution, Min Rating)
            React.createElement(
              "div",
              { className: "sfm-attr-filter-bar d-flex align-items-center flex-wrap gap-2 mt-2 pt-2 border-top border-secondary" },
              React.createElement(
                "span",
                { className: "small text-muted d-inline-flex align-items-center mr-1" },
                React.createElement(IconFilter, { size: 12, className: "mr-1 text-info" }),
                "Filters:"
              ),
              // Organized Filter Select & Buttons
              React.createElement(
                "div",
                { className: "d-flex align-items-center mr-2 sfm-filter-organized-wrap" },
                React.createElement("span", { className: "small text-muted mr-1" }, "Organized:"),
                React.createElement(
                  "select",
                  {
                    className: "sfm-sort-select sfm-filter-organized-select",
                    value: organizedFilter,
                    onChange: (e) => setOrganizedFilter(e.target.value),
                    title: "Filter by organized status",
                  },
                  React.createElement("option", { value: "all" }, "All"),
                  React.createElement("option", { value: "organized" }, "Organized"),
                  React.createElement("option", { value: "unorganized" }, "Unorganized")
                )
              ),
              // Missing Metadata Pills
              React.createElement(
                "div",
                { className: "d-flex align-items-center mr-2 sfm-filter-missing-wrap" },
                React.createElement("span", { className: "small text-muted mr-1 font-weight-bold" }, "Missing:")
              ),
              React.createElement(
                "div",
                { className: "d-flex align-items-center flex-wrap gap-1 mr-2 sfm-filter-missing-group" },
                MISSING_FIELD_OPTIONS.map((mf) => {
                  const active = missingFields.includes(mf.id);
                  return React.createElement(
                    "button",
                    {
                      key: mf.id,
                      type: "button",
                      className: `badge sfm-badge-btn mr-1 ${active ? "badge-warning text-dark font-weight-bold" : "badge-dark text-muted border border-secondary"}`,
                      onClick: () => handleToggleMissingField(mf.id),
                      title: active ? `Remove missing ${mf.label} filter` : `Filter scenes missing ${mf.label}`,
                    },
                    mf.label
                  );
                })
              ),
              // Resolution Filter
              React.createElement(
                "div",
                { className: "d-flex align-items-center mr-2" },
                React.createElement("span", { className: "small text-muted mr-1" }, "Res:"),
                React.createElement(
                  "select",
                  {
                    className: "sfm-sort-select sfm-filter-resolution-select",
                    value: resolutionFilter,
                    onChange: (e) => setResolutionFilter(e.target.value),
                    title: "Filter by video resolution",
                  },
                  React.createElement("option", { value: "all" }, "All"),
                  React.createElement("option", { value: "4k" }, "4K UHD"),
                  React.createElement("option", { value: "1440p" }, "1440 QHD"),
                  React.createElement("option", { value: "1080p" }, "1080 FHD"),
                  React.createElement("option", { value: "720p" }, "720 HD"),
                  React.createElement("option", { value: "sd" }, "SD")
                )
              ),
              // Min Rating Filter
              React.createElement(
                "div",
                { className: "d-flex align-items-center mr-2" },
                React.createElement("span", { className: "small text-muted mr-1" }, "Min Rating:"),
                React.createElement(
                  "select",
                  {
                    className: "sfm-sort-select sfm-filter-rating-select",
                    value: String(minRating),
                    onChange: (e) => setMinRating(Number(e.target.value) || 0),
                    title: "Filter by minimum star rating",
                  },
                  React.createElement("option", { value: "0" }, "All"),
                  React.createElement("option", { value: "20" }, "1★+"),
                  React.createElement("option", { value: "40" }, "2★+"),
                  React.createElement("option", { value: "60" }, "3★+"),
                  React.createElement("option", { value: "80" }, "4★+"),
                  React.createElement("option", { value: "100" }, "5★")
                )
              ),
              hasActiveFilters &&
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "btn btn-xs btn-outline-danger py-0 px-2 ml-auto sfm-clear-filters-btn",
                    onClick: handleClearAllFilters,
                  },
                  "Clear Filters"
                )
            )
          ),

          // Subfolders Section
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
                    React.createElement("span", { className: "sfm-section-title-label" }, "Sub-folders"),
                    React.createElement(
                      "span",
                      { className: "badge badge-dark sfm-section-count-badge font-weight-normal" },
                      React.createElement("strong", { style: { color: "#88c0d0" } }, filteredAndSortedSubfolders.length)
                    )
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge sfm-badge-btn sfm-state-pill ml-2 font-weight-bold sfm-pill-subfolders ${includeSubfolders ? "sfm-state-active" : "sfm-state-inactive"}`,
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
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge sfm-badge-btn sfm-state-pill ml-2 font-weight-bold sfm-pill-foldersort ${sortByFolderFirst ? "sfm-state-active" : "sfm-state-inactive"}`,
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
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge sfm-badge-btn sfm-state-pill ml-2 font-weight-bold sfm-pill-hideempty ${hideEmpty ? "sfm-state-active" : "sfm-state-inactive"}`,
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
                          onClick: () => {
                            setIsSubfoldersCollapsed(false);
                            handleSetFolderViewMode("cards");
                          },
                          title: "Compact Cards View",
                        },
                        "Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${folderViewMode === "list" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => {
                            setIsSubfoldersCollapsed(false);
                            handleSetFolderViewMode("list");
                          },
                          title: "Compact List View",
                        },
                        "List"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${folderViewMode === "detail" ? "btn-info" : "btn-outline-secondary"} py-0 px-2`,
                          onClick: () => {
                            setIsSubfoldersCollapsed(false);
                            handleSetFolderViewMode("detail");
                          },
                          title: "Folder Details View",
                        },
                        "Details"
                      )
                    )
                  )
              ),
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
                        const firstSceneId =
                          childNode && childNode.allSceneIds && childNode.allSceneIds.size > 0
                            ? childNode.allSceneIds.values().next().value
                            : null;
                        const firstScene = firstSceneId
                          ? (window.__SFM_GLOBAL_CACHE__?.scenes || []).find((s) => String(s.id) === String(firstSceneId)) || null
                          : null;
                        const folderThumb = firstScene?.paths?.screenshot || "";
                        const subCount = childNode ? Object.keys(childNode.folders).length : 0;

                        return React.createElement(
                          "div",
                          {
                            key: folderName,
                            className: "card studio-card sfm-native-folder-card sfm-folder-card sfm-folder-card-compact",
                            style: { width: `${folderCardSize}px`, minWidth: `${Math.min(130, folderCardSize)}px` },
                            onClick: () => navigateToFolder(nextPath),
                            title: `${folderName} (${count} scenes, ${size})`,
                          },
                          React.createElement(
                            "div",
                            { className: "card-image-container image-container sfm-folder-cover-container" },
                            folderThumb
                              ? React.createElement("img", {
                                  src: folderThumb,
                                  alt: folderName,
                                  className: "card-image sfm-folder-cover-img",
                                  loading: "lazy",
                                })
                              : React.createElement(
                                  "div",
                                  { className: "sfm-folder-cover-placeholder d-flex align-items-center justify-content-center" },
                                  React.createElement(IconFolderCard, {
                                    size: Math.max(28, Math.min(48, Math.round(folderCardSize * 0.22))),
                                    color: "#81a1c1",
                                  })
                                ),
                            React.createElement(
                              "div",
                              { className: "sfm-folder-type-badge" },
                              React.createElement(IconFolder, { size: 12, color: "#ffffff" }),
                              React.createElement("span", { className: "ml-1" }, "FOLDER")
                            ),
                            React.createElement(
                              "div",
                              { className: "sfm-folder-card-hover-actions" },
                              count > 0 &&
                                React.createElement(
                                  "button",
                                  {
                                    type: "button",
                                    className: "btn btn-sm btn-primary sfm-folder-quick-btn",
                                    onClick: (e) => {
                                      e.stopPropagation();
                                      const q = (window.__SFM_GLOBAL_CACHE__?.scenes || []).filter((s) => childNode.allSceneIds.has(s.id));
                                      if (q.length > 0) handlePlayScene(q[0], q);
                                    },
                                    title: "Play all scenes in Binge Reel",
                                  },
                                  "▶ Reel"
                                ),
                              React.createElement(
                                "button",
                                {
                                  type: "button",
                                  className: "btn btn-sm btn-secondary sfm-folder-quick-btn ml-1",
                                  onClick: (e) => {
                                    e.stopPropagation();
                                    navigateToFolder(nextPath);
                                    setShowFolderProfile(true);
                                    setCurrentProfilePage(0);
                                    pushOrReplaceRoute(buildRouteUrlForPath(nextPath, "profile", null), false);
                                  },
                                  title: "Open Video Wall",
                                },
                                "▦ Wall"
                              )
                            ),
                            React.createElement(
                              "div",
                              { className: "sfm-folder-thumb-badges" },
                              React.createElement(
                                "span",
                                { className: "badge badge-secondary sfm-badge" },
                                React.createElement("strong", { style: { color: "#88c0d0" } }, count),
                                " scenes"
                              ),
                              count > 0 && React.createElement("span", { className: "badge badge-dark sfm-badge ml-1" }, size)
                            )
                          ),
                          React.createElement(
                            "div",
                            { className: "card-section sfm-folder-card-details p-2" },
                            React.createElement(
                              "h5",
                              { className: "card-title sfm-folder-name text-truncate mb-1 font-weight-bold", title: folderName },
                              folderName
                            ),
                            React.createElement(
                              "div",
                              { className: "card-subtitle text-muted small text-truncate d-flex align-items-center justify-content-between" },
                              React.createElement("span", null, subCount > 0 ? `${subCount} subfolders` : "Folder"),
                              React.createElement("span", { className: "badge badge-dark text-info" }, `/${folderName}`)
                            )
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
                          React.createElement(
                            "div",
                            { className: "sfm-folder-list-icon" },
                            React.createElement(IconFolderCard, { size: 18, color: "#81a1c1" })
                          ),
                          React.createElement("div", { className: "sfm-folder-list-name text-truncate font-weight-bold" }, folderName),
                          React.createElement(
                            "span",
                            { className: "sfm-folder-list-badge" },
                            React.createElement("strong", { style: { color: "#88c0d0" } }, count)
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
                                  React.createElement(
                                    "span",
                                    { className: "mr-2" },
                                    React.createElement(IconFolderCard, { size: 18, color: "#81a1c1" })
                                  ),
                                  React.createElement("span", { className: "sfm-folder-table-name font-weight-bold" }, folderName)
                                )
                              ),
                              React.createElement("td", { className: "text-muted small" }, "Directory"),
                              React.createElement(
                                "td",
                                null,
                                React.createElement(
                                  "span",
                                  { className: "badge badge-dark" },
                                  React.createElement("strong", { style: { color: "#88c0d0" } }, count),
                                  " scenes"
                                )
                              ),
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
                                        await gqlFetch(
                                          `mutation ScanPath($paths: [String!]) { metadataScan(input: { paths: $paths }) }`,
                                          { paths: [nextPath] }
                                        );
                                        setNotification(`Scan triggered for "${nextPath}". Check Settings -> Tasks.`);
                                      } catch (err) {
                                        setNotification(`Scan error: ${err.message}`);
                                      }
                                    },
                                    title: "Trigger Stash filesystem scan for this folder",
                                  },
                                  React.createElement(IconSearch, { size: 12, className: "mr-1" }),
                                  "Scan"
                                )
                              )
                            );
                          })
                        )
                      )
                    ))
            ),

          // Direct Scenes Section (2 Consolidated Modes: Cards ("grid") & Table ("table"))
          filteredAndSortedScenes.length > 0 &&
            React.createElement(
              "div",
              { className: "mb-4" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2 position-relative" },
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
                    React.createElement(
                      "span",
                      { className: "badge badge-dark sfm-section-count-badge font-weight-normal" },
                      React.createElement("strong", { style: { color: "#88c0d0" } }, filteredAndSortedScenes.length)
                    )
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge sfm-badge-btn sfm-stat-pill sfm-badge-indicator sfm-state-pill ml-2 font-weight-bold sfm-pill-subfolders ${includeSubfolders ? "sfm-state-active" : "sfm-state-inactive"}`,
                      onClick: (e) => {
                        e.stopPropagation();
                        handleToggleIncludeSubfolders(!includeSubfolders);
                      },
                      title: includeSubfolders
                        ? "Sub-folders are included in scenes view (Click to exclude)"
                        : "Sub-folders are excluded from scenes view (Click to include)",
                    },
                    includeSubfolders ? "Sub-Folders Included" : "Sub-Folders Excluded"
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `badge sfm-badge-btn sfm-stat-pill sfm-badge-indicator sfm-state-pill ml-2 font-weight-bold sfm-pill-foldersort ${sortByFolderFirst ? "sfm-state-active" : "sfm-state-inactive"}`,
                      onClick: (e) => {
                        e.stopPropagation();
                        handleToggleSortByFolderFirst(!sortByFolderFirst);
                      },
                      title: sortByFolderFirst
                        ? "Scenes ordered by folder sort first (Click to sort altogether)"
                        : "Scenes sorted altogether across all folders (Click to group by folder)",
                    },
                    sortByFolderFirst ? "Grouped by Folder" : "Sorted Altogether"
                  )
                ),
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
                        title:
                          selectedSceneIds.size > 0
                            ? `Click to deselect all (${selectedSceneIds.size} selected)`
                            : "Select all visible scenes in folder",
                      },
                      selectedSceneIds.size > 0 ? `${selectedSceneIds.size} Selected` : "Select All"
                    )
                  ),
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
                          className: `btn btn-sm ${viewMode === "grid" ? "btn-info" : "btn-outline-secondary"} py-0 px-2 sfm-view-mode-grid-btn`,
                          onClick: () => handleToggleViewMode("grid"),
                          title: "16:9 Thumbnail Cards View",
                        },
                        "Cards"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${viewMode === "table" ? "btn-info" : "btn-outline-secondary"} py-0 px-2 sfm-view-mode-table-btn`,
                          onClick: () => handleToggleViewMode("table"),
                          title: "Customizable Metadata Table View",
                        },
                        "Table"
                      )
                    )
                  )
              ),
              !isFilesCollapsed &&
                React.createElement(
                  React.Fragment,
                  null,
                  viewMode === "table"
                    ? React.createElement(SceneTableView, {
                        scenes: visibleScenes,
                        selectedIds: selectedSceneIds,
                        onToggleSelect: handleToggleSelect,
                        onToggleSelectAll: handleSelectAllFolderScenes,
                        onPlay: (s) => handlePlayScene(s),
                        showFolderBadge: includeSubfolders,
                        currentPath,
                        sortKey: sceneSort,
                        onHeaderSort: handleHeaderSort,
                        columnsConfig,
                        onColumnsConfigChange: setColumnsConfig,
                        onScenePatched: handleScenePatched,
                      })
                    : React.createElement(
                        "div",
                        {
                          className: "sfm-scene-cards-grid",
                          style: { "--sfm-scene-card-size": `${sceneCardSize}px` },
                        },
                        visibleScenes.map((scene) =>
                          React.createElement(SceneCard, {
                            key: scene.id,
                            scene,
                            onPlay: () => handlePlayScene(scene),
                            isSelected: selectedSceneIds.has(scene.id),
                            onToggleSelect: handleToggleSelect,
                            showFolderBadge: includeSubfolders,
                            currentPath,
                          })
                        )
                      ),
                  React.createElement(
                    "div",
                    {
                      ref: sceneSentinelRef,
                      className: "sfm-scene-sentinel py-3 text-center w-100",
                    },
                    visibleSceneCount < filteredAndSortedScenes.length
                      ? React.createElement(
                          "div",
                          { className: "d-inline-flex flex-column align-items-center gap-1 text-muted small" },
                          React.createElement(
                            "span",
                            null,
                            `Showing ${visibleScenes.length} of ${filteredAndSortedScenes.length} scenes`
                          ),
                          React.createElement(
                            "button",
                            {
                              type: "button",
                              className: "btn btn-sm btn-outline-info px-3 py-1 mt-1 font-weight-bold",
                              onClick: () => setVisibleSceneCount((prev) => Math.min(prev + SCENE_CHUNK_SIZE, filteredAndSortedScenes.length)),
                            },
                            `Load Next ${Math.min(SCENE_CHUNK_SIZE, filteredAndSortedScenes.length - visibleScenes.length)} Scenes`
                          )
                        )
                      : filteredAndSortedScenes.length > SCENE_CHUNK_SIZE
                      ? React.createElement(
                          "span",
                          { className: "text-muted small font-italic" },
                          `✓ All ${filteredAndSortedScenes.length} scenes loaded`
                        )
                      : null
                  )
                )
            ),

          // Empty State
          filteredAndSortedSubfolders.length === 0 &&
            filteredAndSortedScenes.length === 0 &&
            React.createElement(
              "div",
              { className: "text-center py-5 text-muted" },
              React.createElement(
                "h5",
                null,
                hasActiveFilters ? "No matching folders or scenes found." : "This folder contains no scanned media files."
              ),
              hasActiveFilters
                ? React.createElement(
                    "button",
                    { className: "btn btn-outline-secondary mt-2", onClick: handleClearAllFilters },
                    "Clear Filters & Search"
                  )
                : React.createElement(
                    "button",
                    { className: "btn btn-outline-secondary mt-2", onClick: () => navigateToFolder("") },
                    "Return to Stash"
                  )
            ),

          // Floating Bulk Action Bar
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
                    className: "btn btn-sm btn-primary font-weight-bold py-0 px-3 sfm-pill-selectall sfm-bulk-select-btn",
                    onClick: handleClearSelection,
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
                      className: "btn btn-sm btn-outline-secondary py-1 px-2 sfm-bulk-edit-btn",
                      onClick: () => openMetadataStudio("bulk_edit"),
                      title: "Bulk edit selected scenes in Unified Metadata Studio",
                    },
                    React.createElement(IconEdit, { size: 13, className: "mr-1" }),
                    "Bulk Edit"
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-sm btn-outline-secondary py-1 px-2 sfm-bulk-scrape-btn",
                      onClick: () => openMetadataStudio("scrape"),
                      title: "Scrape selected scenes from Stash-box / sites & parse filenames",
                    },
                    React.createElement(IconGlobe, { size: 13, className: "mr-1 text-info" }),
                    "Parse & Scrape"
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
                  )
                )
              )
            ),

          // Unified Metadata Studio Modal (Scrape, Pattern, Bulk Edit, Rename)
          showParserModal &&
            FilenameParserModal &&
            React.createElement(FilenameParserModal, {
              currentFolder: selectedSceneIds.size > 0 ? `${selectedSceneIds.size} selected scenes` : currentFolderName,
              currentPath: currentPath || "",
              directScenes: modalTargetScenes,
              selectedSceneIds: Array.from(selectedSceneIds),
              initialTab: parserInitialTab,
              onClose: () => setShowParserModal(false),
              onScenePatched: handleScenePatched,
              onApplied: () => {
                handleClearSelection();
                handleRescan();
              },
            }),

          // Settings & Tasks Modal
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
                  try {
                    window.localStorage.setItem("sfm_stream_mode", newVals.default_transcode_method);
                  } catch (e) {}
                }
                if (newVals.fallback_transcode_method) {
                  window.__SFM_FALLBACK_TRANSCODE_METHOD__ = newVals.fallback_transcode_method;
                }
                if (newVals.folder_view_mode) {
                  setFolderViewMode(newVals.folder_view_mode);
                  try {
                    window.localStorage.setItem("sfm_folder_view_mode", newVals.folder_view_mode);
                  } catch (e) {}
                }
                if (newVals.scene_view_mode) {
                  const m = normalizeViewMode(newVals.scene_view_mode);
                  setViewMode(m);
                  try {
                    window.localStorage.setItem("sfm_view_mode", m);
                  } catch (e) {}
                }
                if (newVals.folder_card_size) {
                  setFolderCardSize(Number(newVals.folder_card_size));
                  try {
                    window.localStorage.setItem("sfm_folder_card_size", String(newVals.folder_card_size));
                  } catch (e) {}
                }
                if (newVals.scene_card_size) {
                  setSceneCardSize(Number(newVals.scene_card_size));
                  try {
                    window.localStorage.setItem("sfm_scene_card_size", String(newVals.scene_card_size));
                  } catch (e) {}
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
                  scene_view_mode: "grid",
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
                } catch (e) {}
                setFolderCardSize(160);
                setSceneCardSize(240);
                setFolderViewMode("cards");
                setViewMode("grid");
                setShowSettingsModal(false);
                setNotification("✓ Settings reset to defaults");
                setTimeout(() => setNotification(""), 3500);
                handleRescan();
              },
            })
        ),

        // Folder Profile / Video Wall (Synced with sceneSort & shuffleSeed)
        showFolderProfile &&
          FolderProfileView &&
          (() => {
            const activeProfilePath = (playingScene ? resolveSceneFolder(playingScene, trie) : null) || currentPath || "";
            const activeProfileName = activeProfilePath ? activeProfilePath.split("/").filter(Boolean).pop() : currentFolderName || "Root";
            const activeDisplayPath = activeProfilePath ? `/${activeProfilePath}` : "/";

            return React.createElement(FolderProfileView, {
              folderName: activeProfileName,
              currentFolderName: activeProfileName,
              targetFolderPath: activeProfilePath,
              currentFolderPath: activeProfilePath,
              displayFolderPath: activeDisplayPath,
              scenes: filteredAndSortedScenes,
              trie,
              currentScene: playingScene || filteredAndSortedScenes[0],
              posterUrl: playingScene?.paths?.screenshot || filteredAndSortedScenes[0]?.paths?.screenshot || "",
              isForceMobile: false,
              initialPage: currentProfilePage,
              syncedSort: sceneSort,
              syncedShuffleSeed: shuffleSeed,
              onSortChange: handleSceneSortChange,
              onReshuffle: handleReshuffle,
              onFolderChange: (newPath) => {
                if (newPath !== currentPath) {
                  setCurrentPath(newPath);
                  try {
                    window.localStorage.setItem("sfm_last_folder_path", newPath);
                  } catch (e) {}
                }
              },
              onPageChange: (newPage) => {
                setCurrentProfilePage(newPage);
                const viewName = newPage === 1 ? "discover" : "profile";
                const targetUrl = buildRouteUrlForPath(activeProfilePath, viewName, null);
                const currentUrl = `${window.location?.pathname || ""}${window.location?.search || ""}`;
                if (currentUrl !== targetUrl) {
                  pushOrReplaceRoute(targetUrl, true);
                }
              },
              isInsidePlayer: false,
              onSelectScene: (s, q) => handlePlayScene(s, q),
              onCloseProfile: handleCloseFolderProfile,
              onClose: handleCloseFolderProfile,
              onNavigateToDirectory: (fPath) => {
                handleCloseFolderProfile();
                const dest = fPath !== undefined ? fPath : activeProfilePath;
                if (dest !== currentPath) {
                  navigateToFolder(dest);
                }
              },
              onNavigateToFolder: (fPath) => {
                handleCloseFolderProfile();
                const dest = fPath !== undefined ? fPath : activeProfilePath;
                if (dest !== currentPath) {
                  navigateToFolder(dest);
                }
              },
              onPlayAll: (q) => {
                const list = Array.isArray(q) && q.length > 0 ? q : filteredAndSortedScenes;
                if (list.length > 0) {
                  handlePlayScene(list[0], list);
                }
              },
              onShuffleAll: () => {
                if (filteredAndSortedScenes.length > 0) {
                  const q = createShuffledQueue(filteredAndSortedScenes, filteredAndSortedScenes[0], shuffleSeed);
                  handlePlayScene(q[0], q);
                }
              },
            });
          })(),

        // Binge Reel Player Modal
        playingScene &&
          BingeReelPlayerModal &&
          React.createElement(
            SafeErrorBoundary,
            { onReset: handleClosePlayer },
            React.createElement(BingeReelPlayerModal, {
              scene: playingScene,
              scenes: customPlayerScenes || filteredAndSortedScenes,
              onSelectScene: (s, q) => handlePlayScene(s, q),
              onClose: handleClosePlayer,
              onOpenProfile: handleOpenProfileFromPlayer,
              folderName: currentFolderName,
              currentPath: currentPath,
              onNavigateToFolder: (p) => {
                handleClosePlayer();
                navigateToFolder(p);
              },
            })
          )
      );
    }

    // Export M4 components & helpers onto window.__SFM__
    Object.assign(window.__SFM__, {
      SceneCard,
      SceneTableView,
      SceneNamesTableView,
      SettingsAndTasksModal,
      FileManagerView,
      TABLE_COLUMNS_STORAGE_KEY,
      TABLE_COLUMN_DEFINITIONS,
      getDefaultTableColumns,
      loadTableColumnsConfig,
      normalizeViewMode,
    });
  } catch (err) {
    console.error("[PathFileManager] Critical error in sfm_views.js:", err);
  }
})();

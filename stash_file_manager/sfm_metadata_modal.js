(function () {
  "use strict";

  try {
    const SFM = window.__SFM__;
    if (!SFM || !SFM.React) {
      console.warn("[PathFileManager] window.__SFM__ is not ready for sfm_metadata_modal.js");
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
      clearCachedScenes,
      patchCatalogSceneInPlace,
      sortScenesWithOrder,
      matchesSceneFilters,
      formatBytes,
      formatDuration,
      icons = {},
    } = SFM;

    const {
      IconGlobe,
      IconSettings,
      IconTag,
      IconSearch,
      IconEdit,
      IconFolder,
      IconScissors,
      IconSparkles,
      IconFilter,
      IconCheck,
      IconX,
      IconAlert,
      IconRefresh,
      IconColumns,
      IconTrash,
    } = icons;

    function renderIcon(IconComp, props, fallbackText = "") {
      if (typeof IconComp === "function") {
        return React.createElement(IconComp, props);
      }
      if (!fallbackText) return null;
      return React.createElement("span", { className: props?.className || "" }, fallbackText);
    }

    const VALID_TABS = ["scrape", "pattern", "bulk_edit", "rename"];

    const SCRAPE_LAYOUT_TEMPLATES = {
      COMPACT_2TIER: "compact_2tier",
      STANDARD_1TIER: "standard_1tier",
      MINIMAL: "minimal",
    };

    const DEFAULT_SCRAPE_WIDTHS_2TIER = {
      checkbox: 36,
      cover: 56,
      title_filename: 240,
      studio_performers: 165,
      date_code: 110,
      organized_status: 105,
      actions: 140,
    };

    const DEFAULT_SCRAPE_WIDTHS_1TIER = {
      checkbox: 34,
      cover: 48,
      filename: 120,
      title: 150,
      date: 80,
      studio: 95,
      code: 70,
      performers: 105,
      organized: 60,
      source: 75,
      status: 70,
      actions: 130,
    };

    const PRESETS = [
      { label: "Auto-Detected / Interactive Pattern", pattern: "", caseInsensitive: true },
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

    const RENAME_PRESETS = [
      { label: "Studio - Code - Title: {studio} - {code} - {title}.{ext}", scheme: "{studio} - {code} - {title}.{ext}" },
      { label: "({studio})({code})({performers})({title}).{ext}", scheme: "({studio})({code})({performers})({title}).{ext}" },
      { label: "Studio - Date - Title: {studio} - {date} - {title}.{ext}", scheme: "{studio} - {date} - {title}.{ext}" },
      { label: "Date - Studio - Title: {date} - {studio} - {title}.{ext}", scheme: "{date} - {studio} - {title}.{ext}" },
      { label: "Studio - Performers - Title: {studio} - {performers} - {title}.{ext}", scheme: "{studio} - {performers} - {title}.{ext}" },
      { label: "Performers - Title ({year}): {performers} - {title} ({year}).{ext}", scheme: "{performers} - {title} ({year}).{ext}" },
      { label: "Code - Title [{resolution}]: {code} - {title} [{resolution}].{ext}", scheme: "{code} - {title} [{resolution}].{ext}" },
      { label: "Studio - Code - Performers - Title [{resolution}]: {studio} - {code} - {performers} - {title} [{resolution}].{ext}", scheme: "{studio} - {code} - {performers} - {title} [{resolution}].{ext}" },
    ];

    const RENAME_TAGS = [
      { tag: "{studio}", label: "{studio}", desc: "Studio Name", color: "#81a1c1" },
      { tag: "{code}", label: "{code}", desc: "Studio / Scene Code", color: "#ebcb8b" },
      { tag: "{performers}", label: "{performers}", desc: "Performers", color: "#d08770" },
      { tag: "{title}", label: "{title}", desc: "Scene Title", color: "#88c0d0" },
      { tag: "{date}", label: "{date}", desc: "Date (YYYY-MM-DD)", color: "#a3be8c" },
      { tag: "{year}", label: "{year}", desc: "Release Year (YYYY)", color: "#b48ead" },
      { tag: "{resolution}", label: "{resolution}", desc: "Resolution (4K, 1080p...)", color: "#5e81ac" },
      { tag: "{ext}", label: "{ext}", desc: "File Extension (mp4, mkv...)", color: "#4c566a" },
    ];

    const MISSING_FIELD_OPTIONS = [
      { key: "title", label: "Title" },
      { key: "studio", label: "Studio" },
      { key: "performers", label: "Performers" },
      { key: "date", label: "Date" },
      { key: "code", label: "Code" },
      { key: "tags", label: "Tags" },
      { key: "cover", label: "Cover" },
    ];

    const TABLE_SORTABLE_COLUMNS = [
      { key: "filename", label: "Filename", style: { width: "120px", maxWidth: "120px", textAlign: "center" } },
      { key: "title", label: "Title", style: { width: "150px", maxWidth: "150px", textAlign: "center" } },
      { key: "date", label: "Date", style: { width: "80px", maxWidth: "80px", textAlign: "center" } },
      { key: "studio", label: "Studio", style: { width: "95px", maxWidth: "95px", textAlign: "center" } },
      { key: "code", label: "Code", style: { width: "70px", maxWidth: "70px", textAlign: "center" } },
      { key: "performers", label: "Performers", style: { width: "105px", maxWidth: "105px", textAlign: "center" } },
      { key: "organized", label: "Organized", style: { width: "60px", maxWidth: "60px", textAlign: "center" } },
      { key: "source", label: "Source", style: { width: "75px", maxWidth: "75px", textAlign: "center" } },
      { key: "status", label: "Status", style: { width: "70px", maxWidth: "70px", textAlign: "center" } },
    ];

    function normalizeInitialScenes(directScenes, scenes) {
      if (Array.isArray(directScenes) && directScenes.length > 0) return directScenes;
      if (Array.isArray(scenes) && scenes.length > 0) return scenes;
      return Array.isArray(directScenes) ? directScenes : [];
    }

    function computeInitialSelectedSet(initialSelectedIds, sceneIds, inputScenes) {
      if (initialSelectedIds instanceof Set) {
        return new Set(Array.from(initialSelectedIds).map(String));
      }
      if (Array.isArray(initialSelectedIds)) {
        return new Set(initialSelectedIds.map(String));
      }
      if (sceneIds instanceof Set) {
        return new Set(Array.from(sceneIds).map(String));
      }
      if (Array.isArray(sceneIds)) {
        return new Set(sceneIds.map(String));
      }
      return new Set(inputScenes.map((s) => String(s.id)));
    }

    function FilenameParserModal({
      currentFolder = "",
      currentPath = "",
      directScenes = [],
      scenes = null,
      selectedSceneIds: initialSelectedIds = null,
      sceneIds = null,
      initialTab = "scrape",
      onClose = () => {},
      onApplied = null,
      onSuccess = null,
      onScenePatched = null,
      autoCloseOnBulkEdit = false,
    }) {
      const incomingScenes = useMemo(
        () => normalizeInitialScenes(directScenes, scenes),
        [directScenes, scenes]
      );

      const [localScenes, setLocalScenes] = useState(() => incomingScenes);
      const incomingSignature = useMemo(
        () => incomingScenes.map((s) => `${s?.id ?? ""}:${s?.files?.[0]?.basename ?? ""}`).join("|"),
        [incomingScenes]
      );
      const prevSignatureRef = useRef(incomingSignature);

      useEffect(() => {
        if (prevSignatureRef.current !== incomingSignature) {
          prevSignatureRef.current = incomingSignature;
          setLocalScenes(incomingScenes);
        }
      }, [incomingSignature, incomingScenes]);

      const notifyApplied = useCallback(() => {
        if (typeof onApplied === "function") onApplied();
        else if (typeof onSuccess === "function") onSuccess();
      }, [onApplied, onSuccess]);

      const applyLocalScenePatch = useCallback(
        (updatedScene) => {
          if (!updatedScene || updatedScene.id === undefined || updatedScene.id === null) return null;
          const targetId = String(updatedScene.id);
          let mergedResult = updatedScene;

          setLocalScenes((prev) =>
            prev.map((s) => {
              if (!s || String(s.id) !== targetId) return s;
              mergedResult = {
                ...s,
                ...updatedScene,
                paths: updatedScene.paths ? { ...(s.paths || {}), ...updatedScene.paths } : s.paths,
                files: Array.isArray(updatedScene.files) ? updatedScene.files : s.files,
              };
              return mergedResult;
            })
          );

          if (typeof patchCatalogSceneInPlace === "function") {
            const patched = patchCatalogSceneInPlace(mergedResult);
            if (patched) mergedResult = patched;
          }
          if (typeof onScenePatched === "function") {
            onScenePatched(mergedResult);
          }
          return mergedResult;
        },
        [onScenePatched]
      );

      const initialSampleBasename = incomingScenes[0]?.files?.[0]?.basename || "";
      const initialSampleNoExt = initialSampleBasename.replace(/\.[^/.]+$/, "");
      const isInitialDunder = /^([A-Za-z0-9]{2,8})__([A-Z]+(?:_[A-Z]+)*)_+(.+?)(?:__[a-zA-Z0-9]{4,10})?$/.test(
        initialSampleNoExt
      );
      const dunderPattern =
        "^(?<code>[A-Za-z0-9]+)__(?<performers>[A-Z]+(?:_[A-Z]+)*)_+(?<title>.+?)__(?:[a-zA-Z0-9]+)(?:\\.[^.]+)?$";

      // 4 Dedicated Tabs: "scrape", "pattern", "bulk_edit", "rename"
      const [activeTab, setActiveTab] = useState(() =>
        VALID_TABS.includes(initialTab) ? initialTab : "scrape"
      );
      useEffect(() => {
        if (VALID_TABS.includes(initialTab)) {
          setActiveTab(initialTab);
        }
      }, [initialTab]);

      const [builderMode, setBuilderMode] = useState("guided"); // "guided" | "raw"
      const [sampleIndex, setSampleIndex] = useState(0);
      const [pattern, setPattern] = useState(() => (isInitialDunder ? dunderPattern : (initialTab === "pattern" ? PRESETS[1].pattern : "")));
      const [caseInsensitive, setCaseInsensitive] = useState(() => !isInitialDunder);
      const [cleanSpaces, setCleanSpaces] = useState(true);
      const [titleCase, setTitleCase] = useState(true);
      const [normalizeDate, setNormalizeDate] = useState(true);
      const [previewFilter, setPreviewFilter] = useState("all"); // "all" | "matched" | "unmatched"
      const [chunks, setChunks] = useState([]);
      const [activeSplitChunkId, setActiveSplitChunkId] = useState(null);
      const [splitAtInput, setSplitAtInput] = useState("");
      const [selectedSceneIds, setSelectedSceneIds] = useState(() =>
        computeInitialSelectedSet(initialSelectedIds, sceneIds, incomingScenes)
      );
      const [isExecuting, setIsExecuting] = useState(false);
      const [progressText, setProgressText] = useState("");

      // Attribute Filter Bar State (R2)
      const [attrSearchQuery, setAttrSearchQuery] = useState("");
      const [organizedFilter, setOrganizedFilter] = useState("all"); // "all" | "organized" | "unorganized"
      const [missingFields, setMissingFields] = useState([]); // string[]
      const [missingMode, setMissingMode] = useState("any"); // "any" | "all"

      // Table Column Click-to-Sort State (R2)
      const [tableSortKey, setTableSortKey] = useState(null);
      const [tableSortDir, setTableSortDir] = useState("asc");

      // Organized Checkbox Async Tracking (R2)
      const [organizedSavingIds, setOrganizedSavingIds] = useState(() => new Set());
      const [organizedErrors, setOrganizedErrors] = useState({});

      // Inline Row Edit State (R2)
      const [inlineEditRowId, setInlineEditRowId] = useState(null);
      const [inlineEditForm, setInlineEditForm] = useState({
        title: "",
        studioName: "",
        date: "",
        code: "",
        organized: false,
        performersText: "",
        tagsText: "",
        rating100: "",
      });
      const [inlineEditSaving, setInlineEditSaving] = useState(false);
      const [inlineEditError, setInlineEditError] = useState("");

      // Bulk Edit Tab State (R2 - merged BatchMetadataModal)
      const [bulkStudioName, setBulkStudioName] = useState("");
      const [bulkAddPerformer, setBulkAddPerformer] = useState("");
      const [bulkAddTag, setBulkAddTag] = useState("");
      const [bulkRating, setBulkRating] = useState("");
      const [bulkOrganized, setBulkOrganized] = useState(""); // "" | "true" | "false"
      const [bulkSubmitting, setBulkSubmitting] = useState(false);
      const [bulkMessage, setBulkMessage] = useState("");
      const [bulkError, setBulkError] = useState("");

      // Bulk Rename State
      const [renameScheme, setRenameScheme] = useState(() => {
        return (
          (typeof window !== "undefined" && window.localStorage
            ? window.localStorage.getItem("sfm_last_rename_scheme")
            : null) || "({studio})({code})({performers})({title}).{ext}"
        );
      });
      const [selectedRenameIds, setSelectedRenameIds] = useState(
        () => new Set(incomingScenes.map((s) => String(s.id)))
      );
      const [renameStates, setRenameStates] = useState({});
      const [isRenaming, setIsRenaming] = useState(false);
      const [renameProgressText, setRenameProgressText] = useState("");
      const [renameFilter, setRenameFilter] = useState("all"); // "all" | "changed" | "unchanged"
      const renameInputRef = useRef(null);

      // Path Clues & Scrape Sources
      const [pathClues, setPathClues] = useState([]);
      const [availableSources, setAvailableSources] = useState([]);
      const [selectedSourceKey, setSelectedSourceKey] = useState(() => {
        return (
          (typeof window !== "undefined" && window.localStorage
            ? window.localStorage.getItem("sfm_last_scrape_source")
            : null) || "auto"
        );
      });
      const [scrapeStrategy, setScrapeStrategy] = useState("smart"); // "smart" | "fingerprint" | "query"
      const [isScrapingAll, setIsScrapingAll] = useState(false);
      const [scrapeProgress, setScrapeProgress] = useState({ current: 0, total: 0, text: "" });
      const [scrapeStates, setScrapeStates] = useState({});
      const [cloudMatches, setCloudMatches] = useState({});

      // Inline Query Search State per row
      const [inlineSearchRowId, setInlineSearchRowId] = useState(null);
      const [inlineSearchQuery, setInlineSearchQuery] = useState("");
      const [inlineSearchSource, setInlineSearchSource] = useState("");
      const [inlineSearchResults, setInlineSearchResults] = useState([]);
      const [inlineSearchLoading, setInlineSearchLoading] = useState(false);

      // Field selection for applying scrapes/patterns
      const [fieldsToApply, setFieldsToApply] = useState({
        title: true,
        date: true,
        studio: true,
        performers: true,
        tags: true,
        details: true,
        code: true,
        cover: true,
      });

      // Scrape Table Layout & Width Customization (1-tier standard single-line & 2-tier compact)
      const [layoutTemplate, setLayoutTemplate] = useState(() => {
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            const saved = window.localStorage.getItem("sfm_scrape_layout_template");
            if (saved === SCRAPE_LAYOUT_TEMPLATES.COMPACT_2TIER || saved === SCRAPE_LAYOUT_TEMPLATES.STANDARD_1TIER) {
              return saved;
            }
          }
        } catch (e) {}
        return SCRAPE_LAYOUT_TEMPLATES.STANDARD_1TIER;
      });
      const [colWidths, setColWidths] = useState(() => {
        try {
          const saved =
            typeof window !== "undefined" && window.localStorage
              ? window.localStorage.getItem("sfm_scrape_col_widths")
              : null;
          if (saved) return JSON.parse(saved);
        } catch (e) {}
        return { ...DEFAULT_SCRAPE_WIDTHS_1TIER };
      });
      const [showLayoutModal, setShowLayoutModal] = useState(false);

      const handleSelectTemplate = (tpl) => {
        setLayoutTemplate(tpl);
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("sfm_scrape_layout_template", tpl);
          }
        } catch (e) {}
        if (tpl === SCRAPE_LAYOUT_TEMPLATES.COMPACT_2TIER) {
          setColWidths((prev) => ({ ...DEFAULT_SCRAPE_WIDTHS_2TIER, ...prev }));
        } else if (tpl === SCRAPE_LAYOUT_TEMPLATES.STANDARD_1TIER) {
          setColWidths((prev) => ({ ...DEFAULT_SCRAPE_WIDTHS_1TIER, ...prev }));
        }
      };

      const handleUpdateColWidth = (key, val) => {
        const num = Math.max(20, Math.min(800, parseInt(val, 10) || 50));
        setColWidths((prev) => {
          const next = { ...prev, [key]: num };
          try {
            if (typeof window !== "undefined" && window.localStorage) {
              window.localStorage.setItem("sfm_scrape_col_widths", JSON.stringify(next));
            }
          } catch (e) {}
          return next;
        });
      };

      const handleResetColWidths = () => {
        const defaults =
          layoutTemplate === SCRAPE_LAYOUT_TEMPLATES.COMPACT_2TIER
            ? DEFAULT_SCRAPE_WIDTHS_2TIER
            : DEFAULT_SCRAPE_WIDTHS_1TIER;
        setColWidths({ ...defaults });
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("sfm_scrape_col_widths", JSON.stringify(defaults));
          }
        } catch (e) {}
      };

      const [expandedRowIds, setExpandedRowIds] = useState(() => new Set());
      const resolvedStudiosRef = useRef({});
      const resolvedPerformersRef = useRef({});
      const resolvedTagsRef = useRef({});

      const handleToggleFieldToApply = (field) => {
        setFieldsToApply((prev) => ({ ...prev, [field]: !prev[field] }));
      };

      const handleToggleExpandRow = (sceneId) => {
        const sId = String(sceneId);
        setExpandedRowIds((prev) => {
          const next = new Set(prev);
          if (next.has(sId)) next.delete(sId);
          else next.add(sId);
          return next;
        });
      };

      const sampleScene = localScenes[sampleIndex] || localScenes[0];
      const sampleRawBasename = sampleScene?.files?.[0]?.basename || "";
      const sampleWithoutExt = sampleRawBasename.replace(/\.[^/.]+$/, "");
      const escapeRegex = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

      const cleanFilenameToQuery = (rawFilename) => {
        if (!rawFilename) return "";
        let name = rawFilename.replace(/\.[^/.]+$/, "");
        const dunder = name.match(/^([A-Za-z0-9]+)__([A-Z_]+)_+(.+?)(?:__[a-zA-Z0-9]+)?$/);
        if (dunder) {
          const perf = dunder[2].replace(/_/g, " ");
          const title = dunder[3].replace(/_+/g, " ").replace(/\bXxx\b/gi, "").trim();
          return `${perf} ${title}`.trim();
        }
        name = name.replace(
          /\b(1080p|2160p|4k|720p|480p|hevc|x264|x265|h264|h265|web-dl|aac|uhd|hd|sd|vr|60fps|3dh|sbs|xxx)\b/gi,
          " "
        );
        name = name.replace(/\b\d{2,4}[-._]\d{2}[-._]\d{2}\b/g, " ");
        name = name.replace(/\[\s*\]|\(\s*\)|\{\s*\}/g, " ");
        name = name.replace(/[()[\]{}]/g, " ");
        name = name.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
        return name;
      };

      const cleanExtracted = useCallback(
        (fieldId, rawVal) => {
          if (!rawVal) return "";
          let val = String(rawVal).trim();
          if (fieldId === "title") {
            if (cleanSpaces) {
              val = val.replace(/__+/g, " - ").replace(/[_.]+/g, " ");
            }
            val = val.replace(/\s+/g, " ").trim();
            if (titleCase) {
              val = val.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
              val = val.replace(/\bXxx\b/g, "XXX");
              val = val.replace(/\b4k\b/g, "4K");
            }
          } else if (fieldId === "studio" || fieldId === "performers") {
            if (cleanSpaces) {
              val = val.replace(/__+/g, ", ").replace(/[_.]+/g, " ");
            }
            val = val.replace(/\s+/g, " ").trim();
            if (titleCase) {
              val = val.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
            }
          } else if (fieldId === "date") {
            if (normalizeDate) {
              val = val.replace(/[._]/g, "-");
              if (/^\d{8}$/.test(val)) {
                val = `${val.substring(0, 4)}-${val.substring(4, 6)}-${val.substring(6, 8)}`;
              }
            }
          }
          return val;
        },
        [cleanSpaces, titleCase, normalizeDate]
      );

      // Path Clues & Scrape Sources initialization
      useEffect(() => {
        const fullSamplePath = sampleScene?.files?.[0]?.path || currentPath || "";
        const normalized = fullSamplePath.replace(/\\/g, "/");
        const dirParts = normalized.split("/").filter(Boolean);
        if (dirParts.length > 0 && dirParts[dirParts.length - 1].includes(".")) {
          dirParts.pop();
        }

        const relevantParts = dirParts.slice(-3);
        const initialClues = relevantParts.map((part, idx) => {
          const isParent = idx === relevantParts.length - 1;
          const isGrandparent = idx === relevantParts.length - 2;
          let role = "ignore";
          if (isParent) role = "studio";
          else if (isGrandparent && /^vr|4k|1080p|uhd$/i.test(part)) role = "tag";
          return { name: part, role, verifiedStudioId: null };
        });

        setPathClues(initialClues);

        if (typeof gqlFetch === "function") {
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
                    prev.map((c) =>
                      c.name === parentClue.name ? { ...c, role: "studio", verifiedStudioId: matchedStudio.id } : c
                    )
                  );
                }
              })
              .catch(() => {});
          }

          gqlFetch(`query GetScrapeSources {
            configuration {
              general {
                stashBoxes {
                  name
                  endpoint
                }
              }
            }
            listScrapers(types: [SCENE]) {
              id
              name
              scene {
                supported_scrapes
              }
            }
          }`)
            .then((res) => {
              const boxes = res?.configuration?.general?.stashBoxes || [];
              const scrapers = res?.listScrapers || [];

              const stashboxSources = boxes.map((box) => ({
                key: `stashbox:${box.endpoint}`,
                type: "stashbox",
                endpoint: box.endpoint,
                name: box.name || box.endpoint,
                label: `stash-box: ${box.name || box.endpoint}`,
              }));

              const siteSources = scrapers.map((s) => ({
                key: `site:${s.id}`,
                type: "site",
                scraperId: s.id,
                name: s.name,
                label: `site: ${s.name}`,
              }));

              const combined = [
                { key: "auto", type: "auto", name: "Auto (Stash-box first)", label: "Auto (Stash-box first)" },
                ...stashboxSources,
                ...siteSources,
              ];

              setAvailableSources(combined);

              const saved =
                (typeof window !== "undefined" && window.localStorage
                  ? window.localStorage.getItem("sfm_last_scrape_source")
                  : null) || "";
              if (saved && combined.some((s) => s.key === saved)) {
                setSelectedSourceKey(saved);
              } else if (stashboxSources.length > 0) {
                setSelectedSourceKey(stashboxSources[0].key);
              } else {
                setSelectedSourceKey("auto");
              }
            })
            .catch(() => {});
        }
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

      const compileRegexFromChunks = (currentChunks, sampleText) => {
        if (!currentChunks || currentChunks.length === 0) return;

        let cursor = 0;
        let regex = "^";
        let hasUppercaseOnlyGroup = false;
        const usedGroups = new Set();

        const namedOrNonCap = (groupName, inner) => {
          if (usedGroups.has(groupName)) return `(?:${inner})`;
          usedGroups.add(groupName);
          return `(?<${groupName}>${inner})`;
        };

        currentChunks.forEach((chunk, idx) => {
          const isLast = idx === currentChunks.length - 1;
          const chunkText = chunk.text;
          const pos = sampleText.indexOf(chunkText, cursor);

          if (pos > cursor) {
            const sepText = sampleText.substring(cursor, pos);
            if (sepText === "__") {
              regex += "__";
            } else if (/^_+$/.test(sepText)) {
              regex += "_+";
            } else if (sepText.includes(" - ")) {
              regex += "\\s*-\\s*";
            } else if (/^\s+$/.test(sepText)) {
              regex += "\\s+";
            } else {
              regex += escapeRegex(sepText);
            }
          }

          if (chunk.fieldId === "ignore") {
            regex += isLast ? "(?:.+)" : "(?:[a-zA-Z0-9]+)";
          } else if (chunk.fieldId === "code") {
            if (/^\d+$/.test(chunkText)) {
              regex += namedOrNonCap("code", "\\d+");
            } else {
              regex += namedOrNonCap("code", "[A-Za-z0-9]+");
            }
          } else if (chunk.fieldId === "studio") {
            if (/^[A-Za-z]+$/.test(chunkText)) {
              regex += namedOrNonCap("studio", "[A-Za-z]+");
            } else {
              regex += namedOrNonCap("studio", "[A-Za-z0-9]+");
            }
          } else if (chunk.fieldId === "performers") {
            if (/^[A-Z_]+$/.test(chunkText)) {
              hasUppercaseOnlyGroup = true;
              regex += namedOrNonCap("performers", "[A-Z]+(?:_[A-Z]+)*");
            } else {
              regex += namedOrNonCap("performers", "[A-Za-z]+(?:[\\s_][A-Za-z]+)*");
            }
          } else if (chunk.fieldId === "title") {
            regex += namedOrNonCap("title", isLast ? ".+" : ".+?");
          } else if (chunk.fieldId === "date") {
            regex += namedOrNonCap("date", "\\d{4}[-._]\\d{2}[-._]\\d{2}|\\d{6,8}");
          } else if (chunk.fieldId === "duration") {
            regex += namedOrNonCap("duration", "\\d+(?:m|min|s|sec)?|\\d+:\\d+(?::\\d+)?");
          }

          cursor = pos >= 0 ? pos + chunkText.length : cursor;
        });

        if (cursor < sampleText.length) {
          const trailing = sampleText.substring(cursor);
          if (trailing === "__") regex += "__";
          else if (/^_+$/.test(trailing)) regex += "_+";
          else regex += escapeRegex(trailing);
        }

        regex += "(?:\\.[^.]+)?$";
        setPattern(regex);

        if (hasUppercaseOnlyGroup) {
          setCaseInsensitive(false);
        }
      };

      const autoDetectFromFilename = (filename, forcedDelimiter = null) => {
        if (!filename) return;

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

        const rawParts = filename
          .split(delimiter)
          .map((p) => p.trim())
          .filter(Boolean);
        const detectedChunks = [];

        rawParts.forEach((part, idx) => {
          let fieldId = "title";
          if (/^(1080p|2160p|4k|720p|480p|hevc|x264|x265|h264|h265|web-dl|aac|uhd|hd|sd|vr|60fps|3dh|sbs)$/i.test(part)) {
            fieldId = "ignore";
          } else if (idx === rawParts.length - 1 && /^[a-zA-Z0-9]{5,8}$/.test(part)) {
            fieldId = "ignore";
          } else if (/^\d{4}[-._]\d{2}[-._]\d{2}$/.test(part) || /^\d{6,8}$/.test(part)) {
            fieldId = "date";
          } else if (/^[A-Za-z0-9]{2,6}[-_]?[0-9]{2,5}$/i.test(part) || /^[A-Z]{2,}\d{2,}$/i.test(part)) {
            fieldId = "code";
          } else if (/^\d+[mhms]$/i.test(part) || /^\d+:\d+(?::\d+)?$/.test(part)) {
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

      useEffect(() => {
        if (sampleWithoutExt && (activeTab === "pattern" || isInitialDunder)) {
          autoDetectFromFilename(sampleWithoutExt);
        }
      }, [sampleIndex, activeTab]);

      const handleSetChunkField = (chunkId, newFieldId) => {
        const updated = chunks.map((c) => (c.id === chunkId ? { ...c, fieldId: newFieldId } : c));
        setChunks(updated);
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

      const handleDeleteChunk = (chunkId) => {
        const updated = chunks.filter((c) => c.id !== chunkId);
        setChunks(updated);
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

      const handleSplitChunk = (chunkId, part1, part2, field1, field2) => {
        const idx = chunks.findIndex((c) => c.id === chunkId);
        if (idx === -1) return;
        if (!part1 || !part2) return;

        const newChunk1 = { id: Date.now(), text: part1, fieldId: field1 || chunks[idx].fieldId };
        const newChunk2 = { id: Date.now() + 1, text: part2, fieldId: field2 || "title" };

        const updated = [...chunks.slice(0, idx), newChunk1, newChunk2, ...chunks.slice(idx + 1)];
        setChunks(updated);
        setActiveSplitChunkId(null);
        setSplitAtInput("");
        compileRegexFromChunks(updated, sampleWithoutExt);
      };

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

      const parsedResults = useMemo(() => {
        let re = null;
        let regexError = null;
        if (pattern && pattern.trim()) {
          try {
            re = new RegExp(pattern, caseInsensitive ? "i" : "");
          } catch (e) {
            regexError = e.message;
          }
        }

        const items = localScenes.map((scene) => {
          const rawBasename = scene.files?.[0]?.basename || "";
          if (!re) {
            return { scene, rawBasename, matched: false, groups: {} };
          }
          const nameWithoutExt = rawBasename.replace(/\.[^/.]+$/, "");
          const match = re.exec(nameWithoutExt) || re.exec(rawBasename);

          if (!match || !match.groups) {
            return { scene, rawBasename, matched: false, groups: {} };
          }
          return { scene, rawBasename, matched: true, groups: match.groups };
        });

        return { error: regexError, items };
      }, [pattern, caseInsensitive, localScenes]);

      const getSceneBestQuery = (scene, matchedGroups) => {
        if (matchedGroups?.title && matchedGroups.title.trim()) {
          return cleanExtracted("title", matchedGroups.title);
        }
        if (matchedGroups?.code && matchedGroups.code.trim()) {
          return matchedGroups.code.trim();
        }
        if (scene?.title && !scene.title.includes(".")) {
          return scene.title.trim();
        }
        const basename = scene?.files?.[0]?.basename || "";
        return cleanFilenameToQuery(basename);
      };

      // GraphQL Scraper Queries
      const Q_SCRAPE_SINGLE = `query ScrapeSingleScene($source: ScraperSourceInput!, $input: ScrapeSingleSceneInput!) {
        scrapeSingleScene(source: $source, input: $input) {
          title
          details
          url
          date
          code
          image
          studio { stored_id name }
          performers { stored_id name disambiguation gender }
          tags { stored_id name }
        }
      }`;

      const Q_SCRAPE_URL_DIRECT = `query ScrapeSceneURL($url: String!) {
        scrapeSceneURL(url: $url) {
          title
          details
          url
          date
          code
          image
          studio { stored_id name }
          performers { stored_id name disambiguation gender }
          tags { stored_id name }
        }
      }`;

      const isUsableScrapedResult = (r) => {
        if (!r) return false;
        return Boolean(
          (r.title && r.title.trim()) ||
            (r.details && r.details.trim()) ||
            (r.studio && r.studio.name && r.studio.name.trim()) ||
            (r.tags && r.tags.length > 0) ||
            (r.performers && r.performers.length > 0) ||
            (r.code && r.code.trim()) ||
            (r.date && r.date.trim())
        );
      };

      const pickBestHit = (raw) => {
        if (!raw) return null;
        const list = Array.isArray(raw) ? raw.filter(Boolean) : [raw];
        return list.find(isUsableScrapedResult) || (list[0] && isUsableScrapedResult(list[0]) ? list[0] : null);
      };

      const executeScrapeForScene = async (scene, sourceKey, strategy = "smart", queryOverride = null) => {
        const queryText = (
          queryOverride || getSceneBestQuery(scene, parsedResults?.items?.find((i) => String(i.scene.id) === String(scene.id))?.groups)
        ).trim();
        const sceneId = String(scene.id);
        const stashIds = scene.stash_ids || [];
        const sceneUrls = scene.urls || [];

        const queryBox = async (endpoint, boxName) => {
          const matchingStashId = stashIds.find((x) => x.endpoint === endpoint && x.stash_id);
          if (matchingStashId) {
            try {
              const res = await gqlFetch(Q_SCRAPE_SINGLE, {
                source: { stash_box_endpoint: endpoint },
                input: { query: matchingStashId.stash_id },
              });
              const hit = pickBestHit(res?.scrapeSingleScene);
              if (hit) return { scraped: hit, sourceName: `${boxName} (StashID)` };
            } catch (e) {}
          }

          if (strategy !== "query") {
            try {
              const res = await gqlFetch(Q_SCRAPE_SINGLE, {
                source: { stash_box_endpoint: endpoint },
                input: { scene_id: sceneId },
              });
              const hit = pickBestHit(res?.scrapeSingleScene);
              if (hit) return { scraped: hit, sourceName: `${boxName} (Hash)` };
            } catch (e) {}
          }

          if (strategy !== "fingerprint" && queryText) {
            try {
              const res = await gqlFetch(Q_SCRAPE_SINGLE, {
                source: { stash_box_endpoint: endpoint },
                input: { query: queryText },
              });
              const hit = pickBestHit(res?.scrapeSingleScene);
              if (hit) return { scraped: hit, sourceName: `${boxName} (Query)` };
            } catch (e) {}
          }
          return null;
        };

        const querySite = async (scraperId, scraperName) => {
          if (sceneUrls.length > 0) {
            try {
              const res = await gqlFetch(Q_SCRAPE_URL_DIRECT, { url: sceneUrls[0] });
              const hit = res?.scrapeSceneURL;
              if (isUsableScrapedResult(hit)) return { scraped: hit, sourceName: `${scraperName} (URL)` };
            } catch (e) {}
          }

          if (strategy !== "fingerprint" && queryText) {
            try {
              const res = await gqlFetch(Q_SCRAPE_SINGLE, {
                source: { scraper_id: scraperId },
                input: { query: queryText },
              });
              const hit = pickBestHit(res?.scrapeSingleScene);
              if (hit) return { scraped: hit, sourceName: `${scraperName} (Query)` };
            } catch (e) {}
          }
          return null;
        };

        if (sourceKey === "auto") {
          const boxes = availableSources.filter((s) => s.type === "stashbox");
          const sites = availableSources.filter((s) => s.type === "site");

          for (const box of boxes) {
            const hit = await queryBox(box.endpoint, box.name);
            if (hit) return hit;
          }
          for (const site of sites) {
            const hit = await querySite(site.scraperId, site.name);
            if (hit) return hit;
          }
          return null;
        }

        if (sourceKey.startsWith("stashbox:")) {
          const endpoint = sourceKey.replace("stashbox:", "");
          const box = availableSources.find((s) => s.key === sourceKey) || { name: endpoint };
          return await queryBox(endpoint, box.name);
        }

        if (sourceKey.startsWith("site:")) {
          const scraperId = sourceKey.replace("site:", "");
          const site = availableSources.find((s) => s.key === sourceKey) || { name: scraperId };
          return await querySite(scraperId, site.name);
        }

        return null;
      };

      const handleScrapeAll = async () => {
        if (isScrapingAll) return;
        setIsScrapingAll(true);
        const todo = localScenes;
        const total = todo.length;
        let completed = 0;
        const CONCURRENCY = 4;
        setScrapeProgress({ current: 0, total, text: `Starting parallel scrape (0/${total})...` });

        const processItem = async (scene) => {
          const sId = String(scene.id);
          setScrapeStates((prev) => ({
            ...prev,
            [sId]: { status: "scraping", sourceName: "" },
          }));
          try {
            const res = await executeScrapeForScene(scene, selectedSourceKey, scrapeStrategy);
            if (res?.scraped) {
              setCloudMatches((prev) => ({ ...prev, [sId]: res.scraped }));
              setScrapeStates((prev) => ({
                ...prev,
                [sId]: { status: "scraped", sourceName: res.sourceName },
              }));
              setExpandedRowIds((prev) => new Set(prev).add(sId));
              setSelectedSceneIds((prev) => new Set(prev).add(sId));
            } else {
              setScrapeStates((prev) => ({
                ...prev,
                [sId]: { status: "nomatch", sourceName: "" },
              }));
            }
          } catch (err) {
            setScrapeStates((prev) => ({
              ...prev,
              [sId]: { status: "error", error: err.message || String(err) },
            }));
          } finally {
            completed++;
            setScrapeProgress({
              current: completed,
              total,
              text: `Scraped ${completed}/${total}: ${scene.files?.[0]?.basename || scene.title || ""}`,
            });
          }
        };

        let queueIdx = 0;
        const workers = Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
          while (queueIdx < todo.length) {
            const item = todo[queueIdx++];
            await processItem(item);
          }
        });

        await Promise.all(workers);
        setIsScrapingAll(false);
      };

      const handleMassSearch = async () => {
        if (isScrapingAll) return;
        const unscraped = localScenes.filter((s) => !cloudMatches[String(s.id)]);
        if (unscraped.length === 0) return;

        setIsScrapingAll(true);
        const total = unscraped.length;
        let completed = 0;
        const CONCURRENCY = 4;
        setScrapeProgress({ current: 0, total, text: `Mass searching by title (0/${total})...` });

        const processItem = async (scene) => {
          const sId = String(scene.id);
          setScrapeStates((prev) => ({
            ...prev,
            [sId]: { status: "scraping", sourceName: "" },
          }));
          try {
            const res = await executeScrapeForScene(scene, selectedSourceKey, "query");
            if (res?.scraped) {
              setCloudMatches((prev) => ({ ...prev, [sId]: res.scraped }));
              setScrapeStates((prev) => ({
                ...prev,
                [sId]: { status: "scraped", sourceName: res.sourceName },
              }));
              setExpandedRowIds((prev) => new Set(prev).add(sId));
              setSelectedSceneIds((prev) => new Set(prev).add(sId));
            } else {
              setScrapeStates((prev) => ({
                ...prev,
                [sId]: { status: "nomatch", sourceName: "" },
              }));
            }
          } catch (err) {
            setScrapeStates((prev) => ({
              ...prev,
              [sId]: { status: "error", error: err.message || String(err) },
            }));
          } finally {
            completed++;
            setScrapeProgress({
              current: completed,
              total,
              text: `Searched ${completed}/${total}: ${scene.files?.[0]?.basename || scene.title || ""}`,
            });
          }
        };

        let queueIdx = 0;
        const workers = Array.from({ length: Math.min(CONCURRENCY, unscraped.length) }, async () => {
          while (queueIdx < unscraped.length) {
            const item = unscraped[queueIdx++];
            await processItem(item);
          }
        });

        await Promise.all(workers);
        setIsScrapingAll(false);
      };

      const handleScrapeSingleRow = async (scene) => {
        const sId = String(scene.id);
        setScrapeStates((prev) => ({
          ...prev,
          [sId]: { status: "scraping", sourceName: "" },
        }));
        try {
          const res = await executeScrapeForScene(scene, selectedSourceKey, scrapeStrategy);
          if (res?.scraped) {
            setCloudMatches((prev) => ({ ...prev, [sId]: res.scraped }));
            setScrapeStates((prev) => ({
              ...prev,
              [sId]: { status: "scraped", sourceName: res.sourceName },
            }));
            setExpandedRowIds((prev) => new Set(prev).add(sId));
            setSelectedSceneIds((prev) => new Set(prev).add(sId));
          } else {
            setScrapeStates((prev) => ({
              ...prev,
              [sId]: { status: "nomatch", sourceName: "" },
            }));
          }
        } catch (err) {
          setScrapeStates((prev) => ({
            ...prev,
            [sId]: { status: "error", error: err.message || String(err) },
          }));
        }
      };

      const handleOpenInlineSearch = (scene) => {
        const sId = String(scene.id);
        if (inlineSearchRowId === sId) {
          setInlineSearchRowId(null);
          return;
        }
        setInlineSearchRowId(sId);
        const query = getSceneBestQuery(
          scene,
          parsedResults?.items?.find((i) => String(i.scene.id) === sId)?.groups
        );
        setInlineSearchQuery(query);
        setInlineSearchSource(
          selectedSourceKey === "auto"
            ? availableSources.find((s) => s.type === "stashbox")?.key || availableSources[0]?.key || ""
            : selectedSourceKey
        );
        setInlineSearchResults([]);
      };

      const handleExecuteInlineSearch = async () => {
        if (!inlineSearchQuery.trim()) return;
        setInlineSearchLoading(true);
        setInlineSearchResults([]);

        const targetSource = inlineSearchSource || selectedSourceKey;
        let candidates = [];

        try {
          if (targetSource.startsWith("stashbox:")) {
            const endpoint = targetSource.replace("stashbox:", "");
            const res = await gqlFetch(Q_SCRAPE_SINGLE, {
              source: { stash_box_endpoint: endpoint },
              input: { query: inlineSearchQuery.trim() },
            });
            candidates = res?.scrapeSingleScene || [];
          } else if (targetSource.startsWith("site:")) {
            const scraperId = targetSource.replace("site:", "");
            const res = await gqlFetch(Q_SCRAPE_SINGLE, {
              source: { scraper_id: scraperId },
              input: { query: inlineSearchQuery.trim() },
            });
            candidates = res?.scrapeSingleScene || [];
          } else {
            const firstBox = availableSources.find((s) => s.type === "stashbox");
            if (firstBox) {
              const res = await gqlFetch(Q_SCRAPE_SINGLE, {
                source: { stash_box_endpoint: firstBox.endpoint },
                input: { query: inlineSearchQuery.trim() },
              });
              candidates = res?.scrapeSingleScene || [];
            }
          }
          setInlineSearchResults(
            Array.isArray(candidates) ? candidates.filter(Boolean) : candidates ? [candidates] : []
          );
        } catch (err) {
          console.warn("Inline search error:", err);
          setInlineSearchResults([]);
        } finally {
          setInlineSearchLoading(false);
        }
      };

      const handleSelectCandidate = (sceneId, candidate, applyImmediately = false) => {
        const sId = String(sceneId);
        const sourceObj = availableSources.find((s) => s.key === inlineSearchSource) || { name: "Manual Search" };
        setCloudMatches((prev) => ({ ...prev, [sId]: candidate }));
        setScrapeStates((prev) => ({
          ...prev,
          [sId]: { status: "scraped", sourceName: `${sourceObj.name} (Selected)` },
        }));
        setExpandedRowIds((prev) => new Set(prev).add(sId));
        setSelectedSceneIds((prev) => new Set(prev).add(sId));
        setInlineSearchRowId(null);
        setInlineSearchResults([]);
        if (applyImmediately) {
          const scene = localScenes.find((s) => String(s.id) === sId);
          if (scene) {
            setTimeout(() => handleApplySingle(scene, candidate), 50);
          }
        }
      };

      const resolveOrCreateStudio = async (name) => {
        const trimmed = (name || "").trim();
        if (!trimmed) return null;
        if (resolvedStudiosRef.current[trimmed]) return resolvedStudiosRef.current[trimmed];
        const sRes = await gqlFetch(
          `query FindStudio($name: String!) {
            findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
              studios { id name }
            }
          }`,
          { name: trimmed }
        );
        let found = sRes?.findStudios?.studios?.[0] || null;
        if (!found) {
          try {
            const cRes = await gqlFetch(
              `mutation CreateStudio($name: String!) {
                studioCreate(input: { name: $name }) { id name }
              }`,
              { name: trimmed }
            );
            found = cRes?.studioCreate || null;
          } catch (e) {
            const sRes2 = await gqlFetch(
              `query FindStudio2($name: String!) {
                findStudios(studio_filter: { name: { value: $name, modifier: EQUALS } }) {
                  studios { id name }
                }
              }`,
              { name: trimmed }
            );
            found = sRes2?.findStudios?.studios?.[0] || null;
          }
        }
        if (found?.id) {
          const obj = { id: String(found.id), name: found.name || trimmed };
          resolvedStudiosRef.current[trimmed] = obj;
          return obj;
        }
        return null;
      };

      const resolveOrCreatePerformer = async (name) => {
        const trimmed = (name || "").trim();
        if (!trimmed) return null;
        if (resolvedPerformersRef.current[trimmed]) return resolvedPerformersRef.current[trimmed];
        const pRes = await gqlFetch(
          `query FindPerformer($name: String!) {
            findPerformers(performer_filter: { name: { value: $name, modifier: EQUALS } }) {
              performers { id name }
            }
          }`,
          { name: trimmed }
        );
        let found = pRes?.findPerformers?.performers?.[0] || null;
        if (!found) {
          try {
            const cRes = await gqlFetch(
              `mutation CreatePerformer($name: String!) {
                performerCreate(input: { name: $name }) { id name }
              }`,
              { name: trimmed }
            );
            found = cRes?.performerCreate || null;
          } catch (e) {
            const pRes2 = await gqlFetch(
              `query FindPerformer2($name: String!) {
                findPerformers(performer_filter: { name: { value: $name, modifier: EQUALS } }) {
                  performers { id name }
                }
              }`,
              { name: trimmed }
            );
            found = pRes2?.findPerformers?.performers?.[0] || null;
          }
        }
        if (found?.id) {
          const obj = { id: String(found.id), name: found.name || trimmed };
          resolvedPerformersRef.current[trimmed] = obj;
          return obj;
        }
        return null;
      };

      const resolveOrCreateTag = async (name) => {
        const trimmed = (name || "").trim();
        if (!trimmed) return null;
        if (resolvedTagsRef.current[trimmed]) return resolvedTagsRef.current[trimmed];
        const tRes = await gqlFetch(
          `query FindTag($name: String!) {
            findTags(tag_filter: { name: { value: $name, modifier: EQUALS } }) {
              tags { id name }
            }
          }`,
          { name: trimmed }
        );
        let found = tRes?.findTags?.tags?.[0] || null;
        if (!found) {
          try {
            const cRes = await gqlFetch(
              `mutation CreateTag($name: String!) {
                tagCreate(input: { name: $name }) { id name }
              }`,
              { name: trimmed }
            );
            found = cRes?.tagCreate || null;
          } catch (e) {
            const tRes2 = await gqlFetch(
              `query FindTag2($name: String!) {
                findTags(tag_filter: { name: { value: $name, modifier: EQUALS } }) {
                  tags { id name }
                }
              }`,
              { name: trimmed }
            );
            found = tRes2?.findTags?.tags?.[0] || null;
          }
        }
        if (found?.id) {
          const obj = { id: String(found.id), name: found.name || trimmed };
          resolvedTagsRef.current[trimmed] = obj;
          return obj;
        }
        return null;
      };

      const applySceneMetadata = async (scene, cloud, parsed, fields) => {
        const updateInput = { id: scene.id };
        const patchedFields = {};

        if (fields.title) {
          const finalTitle = cloud?.title || cleanExtracted("title", parsed?.title);
          if (finalTitle) {
            updateInput.title = finalTitle;
            patchedFields.title = finalTitle;
          }
        }

        if (fields.date) {
          const finalDate = cloud?.date || cleanExtracted("date", parsed?.date);
          if (finalDate && /^\d{4}-\d{2}-\d{2}$/.test(finalDate)) {
            updateInput.date = finalDate;
            patchedFields.date = finalDate;
          }
        }

        if (fields.code) {
          const finalCode = cloud?.code || (parsed?.code || "").trim();
          if (finalCode) {
            updateInput.code = finalCode;
            patchedFields.code = finalCode;
          }
        }

        if (fields.details && cloud?.details) {
          updateInput.details = cloud.details;
          patchedFields.details = cloud.details;
        }

        if (fields.cover && cloud?.image) {
          updateInput.cover_image = cloud.image;
        }

        if (cloud?.url) {
          updateInput.urls = [cloud.url];
          patchedFields.urls = [cloud.url];
        }

        if (fields.studio) {
          const studioName = cloud?.studio?.name || cleanExtracted("studio", parsed?.studio) || activeStudioClue;
          if (studioName) {
            let studioId = cloud?.studio?.stored_id;
            let studioObj = studioId ? { id: String(studioId), name: studioName } : null;
            if (!studioId) {
              studioObj = await resolveOrCreateStudio(studioName);
              studioId = studioObj?.id;
            }
            if (studioId) {
              updateInput.studio_id = studioId;
              patchedFields.studio = studioObj || { id: String(studioId), name: studioName };
            }
          }
        }

        if (fields.performers) {
          const pNames = cloud?.performers
            ? cloud.performers.map((p) => p.name)
            : (cleanExtracted("performers", parsed?.performers) || activePerformerClue)
                .split(/,|&|\band\b/i)
                .map((s) => s.trim())
                .filter(Boolean);

          const pObjs = [];
          for (const pName of pNames) {
            if (!pName) continue;
            const pObj = await resolveOrCreatePerformer(pName);
            if (pObj?.id) pObjs.push(pObj);
          }
          if (pObjs.length > 0) {
            updateInput.performer_ids = pObjs.map((p) => p.id);
            patchedFields.performers = pObjs;
          }
        }

        if (fields.tags && cloud?.tags?.length > 0) {
          const tObjs = [];
          for (const tag of cloud.tags) {
            const tName = tag.name?.trim();
            if (!tName) continue;
            const tObj = await resolveOrCreateTag(tName);
            if (tObj?.id) tObjs.push(tObj);
          }
          if (tObjs.length > 0) {
            updateInput.tag_ids = tObjs.map((t) => t.id);
            patchedFields.tags = tObjs;
          }
        }

        await gqlFetch(
          `mutation UpdateScene($input: SceneUpdateInput!) {
            sceneUpdate(input: $input) { id }
          }`,
          { input: updateInput }
        );
        return { ...scene, ...patchedFields };
      };

      const handleApplySingle = async (scene, overrideCloud = null) => {
        const sId = String(scene.id);
        const cloud = overrideCloud || cloudMatches[sId];
        const parsed = parsedResults.items.find((it) => String(it.scene.id) === sId)?.groups || {};
        setScrapeStates((prev) => ({
          ...prev,
          [sId]: { status: "applying", sourceName: prev[sId]?.sourceName || "" },
        }));
        try {
          const updatedScene = await applySceneMetadata(scene, cloud, parsed, fieldsToApply);
          applyLocalScenePatch(updatedScene);
          setScrapeStates((prev) => ({
            ...prev,
            [sId]: { status: "done", sourceName: prev[sId]?.sourceName || "Applied" },
          }));
          setSelectedSceneIds((prev) => {
            const next = new Set(prev);
            next.delete(sId);
            return next;
          });
        } catch (err) {
          setScrapeStates((prev) => ({
            ...prev,
            [sId]: { status: "error", error: err.message || String(err) },
          }));
        }
      };

      const handleSkipSingle = (sceneId) => {
        const sId = String(sceneId);
        setScrapeStates((prev) => {
          const current = prev[sId]?.status;
          return {
            ...prev,
            [sId]: {
              status: current === "skipped" ? (cloudMatches[sId] ? "scraped" : "idle") : "skipped",
              sourceName: prev[sId]?.sourceName || "",
            },
          };
        });
        setSelectedSceneIds((prev) => {
          const next = new Set(prev);
          next.delete(sId);
          return next;
        });
      };

      const handleClearSingle = (sceneId) => {
        const sId = String(sceneId);
        setCloudMatches((prev) => {
          const next = { ...prev };
          delete next[sId];
          return next;
        });
        setScrapeStates((prev) => ({
          ...prev,
          [sId]: { status: "idle", sourceName: "" },
        }));
        setExpandedRowIds((prev) => {
          const next = new Set(prev);
          next.delete(sId);
          return next;
        });
      };

      // Interactive Organized Checkbox Toggle (R2)
      const handleToggleRowOrganized = async (scene, e) => {
        if (e && typeof e.stopPropagation === "function") e.stopPropagation();
        const sId = String(scene.id);
        const prevVal = Boolean(scene.organized);
        const nextVal = !prevVal;

        setOrganizedSavingIds((prev) => new Set(prev).add(sId));
        setOrganizedErrors((prev) => {
          const copy = { ...prev };
          delete copy[sId];
          return copy;
        });

        applyLocalScenePatch({ ...scene, organized: nextVal });

        try {
          const res = await gqlFetch(
            `mutation ToggleSceneOrganized($input: SceneUpdateInput!) {
              sceneUpdate(input: $input) {
                id
                organized
              }
            }`,
            { input: { id: sId, organized: nextVal } }
          );
          const confirmedOrg =
            res?.sceneUpdate?.organized !== undefined ? Boolean(res.sceneUpdate.organized) : nextVal;
          applyLocalScenePatch({ ...scene, organized: confirmedOrg });
        } catch (err) {
          applyLocalScenePatch({ ...scene, organized: prevVal });
          setOrganizedErrors((prev) => ({
            ...prev,
            [sId]: err?.message || "Failed to update organized status",
          }));
        } finally {
          setOrganizedSavingIds((prev) => {
            const next = new Set(prev);
            next.delete(sId);
            return next;
          });
        }
      };

      // Clear All Fields for Scene (Reset to blank for correcting mistaken scrapes)
      const handleClearSceneMetadata = async (scene, skipConfirm = false) => {
        const sId = String(scene.id);
        const sceneName = scene.title || scene.files?.[0]?.basename || sId;
        if (!skipConfirm && typeof window !== "undefined" && typeof window.confirm === "function") {
          const ok = window.confirm(`Clear all metadata (title, details, studio, performers, tags, code) for "${sceneName}"?`);
          if (!ok) return;
        }
        setScrapeStates((prev) => ({
          ...prev,
          [sId]: { status: "applying", sourceName: "Clearing..." },
        }));
        try {
          await gqlFetch(
            `mutation ClearSceneMetadata($input: SceneUpdateInput!) {
              sceneUpdate(input: $input) {
                id
                title
                details
                date
                code
                director
                organized
                studio { id name }
                performers { id name }
                tags { id name }
              }
            }`,
            {
              input: {
                id: sId,
                title: "",
                details: "",
                date: "",
                code: "",
                director: "",
                studio_id: null,
                performer_ids: [],
                tag_ids: [],
                organized: false,
              },
            }
          );
          const clearedScene = {
            ...scene,
            title: "",
            details: "",
            date: "",
            code: "",
            director: "",
            studio: null,
            performers: [],
            tags: [],
            organized: false,
          };
          applyLocalScenePatch(clearedScene);
          setCloudMatches((prev) => {
            const next = { ...prev };
            delete next[sId];
            return next;
          });
          setScrapeStates((prev) => ({
            ...prev,
            [sId]: { status: "idle", sourceName: "" },
          }));
        } catch (err) {
          console.error("[SFM] Failed to clear scene metadata:", err);
          setScrapeStates((prev) => ({
            ...prev,
            [sId]: { status: "idle", sourceName: "Error" },
          }));
        }
      };

      const handleClearSelectedScenes = async () => {
        if (selectedSceneIds.size === 0) return;
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
          const ok = window.confirm(`Clear all metadata for ${selectedSceneIds.size} selected scene(s)?`);
          if (!ok) return;
        }
        const targets = localScenes.filter((s) => selectedSceneIds.has(String(s.id)));
        for (const sc of targets) {
          await handleClearSceneMetadata(sc, true);
        }
      };

      // Inline Row Editor Handlers (R2)
      const handleOpenInlineEdit = (scene) => {
        const sId = String(scene.id);
        if (inlineEditRowId === sId) {
          setInlineEditRowId(null);
          setInlineEditError("");
          return;
        }
        setInlineEditRowId(sId);
        setInlineEditError("");
        setInlineEditForm({
          title: scene.title || "",
          studioName: scene.studio?.name || "",
          date: scene.date || "",
          code: scene.code || "",
          organized: Boolean(scene.organized),
          performersText: Array.isArray(scene.performers)
            ? scene.performers.map((p) => p?.name).filter(Boolean).join(", ")
            : "",
          tagsText: Array.isArray(scene.tags)
            ? scene.tags.map((t) => t?.name).filter(Boolean).join(", ")
            : "",
          rating100: scene.rating100 !== null && scene.rating100 !== undefined ? String(scene.rating100) : "",
        });
      };

      const handleFillInlineEditFromCloud = (scene) => {
        const sId = String(scene.id);
        const cloud = cloudMatches[sId];
        if (!cloud) return;
        setInlineEditForm((prev) => ({
          ...prev,
          title: cloud.title || prev.title,
          studioName: cloud.studio?.name || prev.studioName,
          date: cloud.date || prev.date,
          code: cloud.code || prev.code,
          performersText:
            Array.isArray(cloud.performers) && cloud.performers.length > 0
              ? cloud.performers.map((p) => p.name).filter(Boolean).join(", ")
              : prev.performersText,
          tagsText:
            Array.isArray(cloud.tags) && cloud.tags.length > 0
              ? cloud.tags.map((t) => t.name).filter(Boolean).join(", ")
              : prev.tagsText,
        }));
      };

      const handleSaveInlineEdit = async (scene) => {
        const sId = String(scene.id);
        const trimmedDate = (inlineEditForm.date || "").trim();
        if (trimmedDate && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
          setInlineEditError("Date must be in YYYY-MM-DD format (or empty).");
          return;
        }

        let parsedRating = undefined;
        const rawRating = String(inlineEditForm.rating100 ?? "").trim();
        if (rawRating !== "") {
          const num = parseInt(rawRating, 10);
          if (isNaN(num) || num < 0 || num > 100) {
            setInlineEditError("Rating must be a number between 0 and 100.");
            return;
          }
          parsedRating = num;
        }

        setInlineEditSaving(true);
        setInlineEditError("");

        try {
          const input = {
            id: sId,
            title: (inlineEditForm.title || "").trim(),
            date: trimmedDate || null,
            code: (inlineEditForm.code || "").trim(),
            organized: Boolean(inlineEditForm.organized),
          };
          if (parsedRating !== undefined) {
            input.rating100 = parsedRating;
          } else if (scene.rating100 !== null && scene.rating100 !== undefined) {
            input.rating100 = null;
          }

          let resolvedStudio = null;
          const studioName = (inlineEditForm.studioName || "").trim();
          if (studioName) {
            resolvedStudio = await resolveOrCreateStudio(studioName);
            if (!resolvedStudio?.id) {
              throw new Error(`Could not resolve or create studio "${studioName}".`);
            }
            input.studio_id = resolvedStudio.id;
          } else {
            input.studio_id = null;
          }

          const performerNames = (inlineEditForm.performersText || "")
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean);
          const resolvedPerformers = [];
          for (const pName of performerNames) {
            const pObj = await resolveOrCreatePerformer(pName);
            if (!pObj?.id) {
              throw new Error(`Could not resolve or create performer "${pName}".`);
            }
            resolvedPerformers.push(pObj);
          }
          input.performer_ids = resolvedPerformers.map((p) => p.id);

          const tagNames = (inlineEditForm.tagsText || "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          const resolvedTags = [];
          for (const tName of tagNames) {
            const tObj = await resolveOrCreateTag(tName);
            if (!tObj?.id) {
              throw new Error(`Could not resolve or create tag "${tName}".`);
            }
            resolvedTags.push(tObj);
          }
          input.tag_ids = resolvedTags.map((t) => t.id);

          const res = await gqlFetch(
            `mutation InlineUpdateScene($input: SceneUpdateInput!) {
              sceneUpdate(input: $input) {
                id
                title
                date
                code
                organized
                rating100
                studio { id name }
                performers { id name }
                tags { id name }
              }
            }`,
            { input }
          );

          const serverScene = res?.sceneUpdate || {};
          const updatedScene = {
            ...scene,
            title: serverScene.title !== undefined ? serverScene.title : input.title,
            date: serverScene.date !== undefined ? serverScene.date : trimmedDate,
            code: serverScene.code !== undefined ? serverScene.code : input.code,
            organized: serverScene.organized !== undefined ? Boolean(serverScene.organized) : input.organized,
            rating100:
              serverScene.rating100 !== undefined
                ? serverScene.rating100
                : parsedRating !== undefined
                ? parsedRating
                : null,
            studio: serverScene.studio !== undefined ? serverScene.studio : resolvedStudio,
            performers:
              Array.isArray(serverScene.performers) && serverScene.performers.length === resolvedPerformers.length
                ? serverScene.performers
                : resolvedPerformers,
            tags:
              Array.isArray(serverScene.tags) && serverScene.tags.length === resolvedTags.length
                ? serverScene.tags
                : resolvedTags,
          };

          applyLocalScenePatch(updatedScene);
          setInlineEditRowId(null);
          setInlineEditError("");
        } catch (err) {
          setInlineEditError(err?.message || String(err));
        } finally {
          setInlineEditSaving(false);
        }
      };

      const handleToggleSelectScene = (sceneId) => {
        const sId = String(sceneId);
        setSelectedSceneIds((prev) => {
          const next = new Set(prev);
          if (next.has(sId)) next.delete(sId);
          else next.add(sId);
          return next;
        });
      };

      const isItemMatched = useCallback(
        (item) => {
          const sId = String(item.scene.id);
          const hasCloud = Boolean(cloudMatches[sId]);
          if (activeTab === "scrape") return hasCloud;
          return Boolean(item.matched || hasCloud);
        },
        [cloudMatches, activeTab]
      );

      const handleToggleMissingField = (fieldKey) => {
        setMissingFields((prev) =>
          prev.includes(fieldKey) ? prev.filter((k) => k !== fieldKey) : [...prev, fieldKey]
        );
      };

      const handleResetFilters = () => {
        setAttrSearchQuery("");
        setOrganizedFilter("all");
        setMissingFields([]);
        setMissingMode("any");
        setPreviewFilter("all");
      };

      const handleHeaderSort = (colKey) => {
        if (tableSortKey === colKey) {
          setTableSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
          setTableSortKey(colKey);
          setTableSortDir("asc");
        }
      };

      // Attribute-filtered items (used across Scrape, Pattern, and Bulk Edit target resolution)
      const attributeFilteredItems = useMemo(() => {
        return parsedResults.items.filter((item) => {
          const s = item.scene;
          const sId = String(s.id);
          if (typeof matchesSceneFilters === "function") {
            const baseMatch = matchesSceneFilters(s, {
              searchQuery: "",
              organizedFilter,
              missingFields,
              missingMode,
            });
            if (!baseMatch) return false;
            const q = attrSearchQuery.trim();
            if (!q) return true;
            if (matchesSceneFilters(s, { searchQuery: q })) return true;

            const ql = q.toLowerCase();
            const cloud = cloudMatches[sId];
            const parsed = item.groups || {};
            const extraHaystack = [
              cloud?.title,
              cloud?.code,
              cloud?.studio?.name,
              ...(cloud?.performers || []).map((p) => p?.name),
              ...(cloud?.tags || []).map((t) => t?.name),
              parsed.title,
              parsed.code,
              parsed.studio,
              parsed.performers,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return extraHaystack.includes(ql);
          }

          if (organizedFilter === "organized" && !s.organized) return false;
          if (organizedFilter === "unorganized" && s.organized) return false;
          if (attrSearchQuery.trim()) {
            const ql = attrSearchQuery.trim().toLowerCase();
            const hay = `${s.title || ""} ${item.rawBasename || ""} ${s.code || ""} ${s.studio?.name || ""}`.toLowerCase();
            if (!hay.includes(ql)) return false;
          }
          return true;
        });
      }, [
        parsedResults.items,
        organizedFilter,
        missingFields,
        missingMode,
        attrSearchQuery,
        cloudMatches,
      ]);

      const matchedCount = useMemo(
        () => attributeFilteredItems.filter(isItemMatched).length,
        [attributeFilteredItems, isItemMatched]
      );
      const unmatchedCount = attributeFilteredItems.length - matchedCount;

      const handleSelectAllMatched = () => {
        const matchedIds = attributeFilteredItems.filter(isItemMatched).map((i) => String(i.scene.id));
        const allMatchedSelected =
          matchedIds.length > 0 && matchedIds.every((id) => selectedSceneIds.has(id));
        if (allMatchedSelected) {
          setSelectedSceneIds((prev) => {
            const next = new Set(prev);
            matchedIds.forEach((id) => next.delete(id));
            return next;
          });
        } else {
          setSelectedSceneIds((prev) => {
            const next = new Set(prev);
            matchedIds.forEach((id) => next.add(id));
            return next;
          });
        }
      };

      const filteredItems = useMemo(() => {
        let list = attributeFilteredItems;
        if (previewFilter === "matched") list = list.filter(isItemMatched);
        else if (previewFilter === "unmatched") list = list.filter((i) => !isItemMatched(i));

        if (tableSortKey) {
          const dirMult = tableSortDir === "asc" ? 1 : -1;
          const getSortValue = (item) => {
            const s = item.scene;
            const sId = String(s.id);
            const cloud = cloudMatches[sId];
            const sState = scrapeStates[sId] || { status: "idle" };

            switch (tableSortKey) {
              case "filename":
                return String(item.rawBasename || s.files?.[0]?.basename || "");
              case "title":
                return String(
                  cloud?.title ||
                    (activeTab === "pattern" ? cleanExtracted("title", item.groups.title) || s.title : s.title || cleanExtracted("title", item.groups.title)) ||
                    item.rawBasename ||
                    ""
                );
              case "date":
                return String(
                  cloud?.date ||
                    (activeTab === "pattern" ? cleanExtracted("date", item.groups.date) || s.date : s.date || cleanExtracted("date", item.groups.date)) ||
                    ""
                );
              case "studio":
                return String(
                  cloud?.studio?.name ||
                    (activeTab === "pattern"
                      ? cleanExtracted("studio", item.groups.studio) || s.studio?.name
                      : s.studio?.name || cleanExtracted("studio", item.groups.studio)) ||
                    activeStudioClue ||
                    ""
                );
              case "code":
                return String(
                  cloud?.code ||
                    (activeTab === "pattern" ? (item.groups.code || "").trim() || s.code : s.code || (item.groups.code || "").trim()) ||
                    ""
                );
              case "performers":
                return String(
                  cloud?.performers
                    ? cloud.performers.map((p) => p.name).join(", ")
                    : (activeTab === "pattern"
                        ? cleanExtracted("performers", item.groups.performers) || (s.performers || []).map((p) => p.name).join(", ")
                        : (s.performers || []).map((p) => p.name).join(", ") || cleanExtracted("performers", item.groups.performers)) ||
                        activePerformerClue ||
                        ""
                );
              case "organized":
                return s.organized ? 1 : 0;
              case "source":
                return String(
                  sState.sourceName || (cloud ? "Scraped" : item.matched ? "Pattern" : "")
                );
              case "status":
                return String(
                  sState.status === "applying"
                    ? "Applying"
                    : sState.status === "done"
                    ? "Applied"
                    : sState.status === "skipped"
                    ? "Skipped"
                    : sState.status === "scraping"
                    ? "Scraping"
                    : cloud || item.matched
                    ? "Matched"
                    : sState.status === "nomatch"
                    ? "No Result"
                    : "Idle"
                );
              default:
                return String(s.title || "");
            }
          };

          list = [...list].sort((a, b) => {
            const va = getSortValue(a);
            const vb = getSortValue(b);
            if (typeof va === "number" && typeof vb === "number") {
              return (va - vb) * dirMult;
            }
            return String(va).localeCompare(String(vb), undefined, { sensitivity: "base" }) * dirMult;
          });
          return list;
        }

        if (activeTab === "scrape") {
          const rank = (item) => {
            const sId = String(item.scene.id);
            const hasCloud = Boolean(cloudMatches[sId]);
            const st = scrapeStates[sId]?.status || "idle";
            if (hasCloud && st !== "done" && st !== "skipped") return 0;
            if (st === "scraping") return 1;
            if (hasCloud && st === "done") return 2;
            if (hasCloud && st === "skipped") return 3;
            return 4;
          };
          list = [...list].sort((a, b) => rank(a) - rank(b));
        }
        return list;
      }, [
        attributeFilteredItems,
        previewFilter,
        isItemMatched,
        tableSortKey,
        tableSortDir,
        cloudMatches,
        scrapeStates,
        activeTab,
        cleanExtracted,
        activeStudioClue,
        activePerformerClue,
      ]);

      // Apply batch metadata updates from Scrape / Pattern tabs
      const handleExecute = async () => {
        const scenesToUpdate = localScenes.filter((s) => selectedSceneIds.has(String(s.id)));
        if (scenesToUpdate.length === 0) return;
        setIsExecuting(true);
        setProgressText(`Starting updates for ${scenesToUpdate.length} scenes...`);

        try {
          let success = 0;
          for (let i = 0; i < scenesToUpdate.length; i++) {
            const scene = scenesToUpdate[i];
            const sId = String(scene.id);
            const cloud = cloudMatches[sId];
            const parsed = parsedResults.items.find((it) => String(it.scene.id) === sId)?.groups || {};
            setProgressText(
              `Updating scene ${i + 1}/${scenesToUpdate.length}: ${scene.files?.[0]?.basename || scene.title || ""}...`
            );

            const updatedScene = await applySceneMetadata(scene, cloud, parsed, fieldsToApply);
            applyLocalScenePatch(updatedScene);
            setScrapeStates((prev) => ({
              ...prev,
              [sId]: { status: "done", sourceName: prev[sId]?.sourceName || "Applied" },
            }));
            success++;
          }

          setProgressText(`Successfully updated ${success} scenes with verified metadata!`);
          setTimeout(() => {
            if (typeof clearCachedScenes === "function") clearCachedScenes();
            notifyApplied();
            onClose();
          }, 1200);
        } catch (err) {
          console.error(err);
          setProgressText(`Error: ${err.message}`);
          setIsExecuting(false);
        }
      };

      // Bulk Edit Tab Target Scenes & Execution (R2)
      const selectedBulkScenes = useMemo(
        () => localScenes.filter((s) => selectedSceneIds.has(String(s.id))),
        [localScenes, selectedSceneIds]
      );
      const bulkTargetScenes = useMemo(
        () => (selectedBulkScenes.length > 0 ? selectedBulkScenes : filteredItems.map((it) => it.scene)),
        [selectedBulkScenes, filteredItems]
      );

      const handleExecuteBulkEdit = async () => {
        setBulkError("");
        setBulkMessage("");

        if (bulkTargetScenes.length === 0) {
          setBulkError("No target scenes available for bulk edit.");
          return;
        }

        const hasStudio = bulkStudioName.trim().length > 0;
        const hasPerformer = bulkAddPerformer.trim().length > 0;
        const hasTag = bulkAddTag.trim().length > 0;
        const hasRating = bulkRating !== "";
        const hasOrganized = bulkOrganized === "true" || bulkOrganized === "false";

        if (!hasStudio && !hasPerformer && !hasTag && !hasRating && !hasOrganized) {
          setBulkError("Please specify at least one field to bulk update.");
          return;
        }

        setBulkSubmitting(true);
        setBulkMessage(`Applying bulk changes to ${bulkTargetScenes.length} scene(s)...`);

        try {
          const targetIds = bulkTargetScenes.map((s) => String(s.id));
          const input = { ids: targetIds };
          let resolvedStudio = null;
          let resolvedPerformers = [];
          let resolvedTags = [];
          let parsedRating = null;
          let orgVal = undefined;

          if (hasStudio) {
            resolvedStudio = await resolveOrCreateStudio(bulkStudioName.trim());
            if (!resolvedStudio?.id) {
              throw new Error(`Studio "${bulkStudioName.trim()}" could not be resolved or created.`);
            }
            input.studio_id = resolvedStudio.id;
          }

          if (hasPerformer) {
            const pNames = bulkAddPerformer
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean);
            for (const pName of pNames) {
              const pObj = await resolveOrCreatePerformer(pName);
              if (!pObj?.id) {
                throw new Error(`Performer "${pName}" could not be resolved or created.`);
              }
              resolvedPerformers.push(pObj);
            }
            if (resolvedPerformers.length > 0) {
              input.performer_ids = { ids: resolvedPerformers.map((p) => p.id), mode: "ADD" };
            }
          }

          if (hasTag) {
            const tNames = bulkAddTag
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean);
            for (const tName of tNames) {
              const tObj = await resolveOrCreateTag(tName);
              if (!tObj?.id) {
                throw new Error(`Tag "${tName}" could not be resolved or created.`);
              }
              resolvedTags.push(tObj);
            }
            if (resolvedTags.length > 0) {
              input.tag_ids = { ids: resolvedTags.map((t) => t.id), mode: "ADD" };
            }
          }

          if (hasRating) {
            const num = parseInt(bulkRating, 10);
            if (isNaN(num) || num < 0 || num > 100) {
              throw new Error("Rating must be between 0 and 100.");
            }
            parsedRating = num;
            input.rating100 = num;
          }

          if (hasOrganized) {
            orgVal = bulkOrganized === "true";
            input.organized = orgVal;
          }

          try {
            await gqlFetch(
              `mutation BatchAssign($input: BulkSceneUpdateInput!) {
                bulkSceneUpdate(input: $input) { id }
              }`,
              { input }
            );
          } catch (bulkErr) {
            const errMsg = String(bulkErr?.message || "");
            if (hasOrganized && /organized/i.test(errMsg) && /BulkSceneUpdateInput/i.test(errMsg)) {
              const inputWithoutOrg = { ...input };
              delete inputWithoutOrg.organized;
              const hasOtherFields =
                inputWithoutOrg.studio_id ||
                inputWithoutOrg.performer_ids ||
                inputWithoutOrg.tag_ids ||
                inputWithoutOrg.rating100 !== undefined;
              if (hasOtherFields) {
                await gqlFetch(
                  `mutation BatchAssign($input: BulkSceneUpdateInput!) {
                    bulkSceneUpdate(input: $input) { id }
                  }`,
                  { input: inputWithoutOrg }
                );
              }
              for (const tId of targetIds) {
                await gqlFetch(
                  `mutation UpdateSceneOrganized($input: SceneUpdateInput!) {
                    sceneUpdate(input: $input) { id organized }
                  }`,
                  { input: { id: tId, organized: orgVal } }
                );
              }
            } else {
              throw bulkErr;
            }
          }

          // Patch all affected scenes in local state & catalog cache immediately
          bulkTargetScenes.forEach((s) => {
            const patched = { ...s };
            if (resolvedStudio) patched.studio = resolvedStudio;
            if (resolvedPerformers.length > 0) {
              const existing = Array.isArray(s.performers) ? s.performers : [];
              const existingIds = new Set(existing.map((p) => String(p.id)));
              patched.performers = [
                ...existing,
                ...resolvedPerformers.filter((p) => !existingIds.has(String(p.id))),
              ];
            }
            if (resolvedTags.length > 0) {
              const existing = Array.isArray(s.tags) ? s.tags : [];
              const existingIds = new Set(existing.map((t) => String(t.id)));
              patched.tags = [
                ...existing,
                ...resolvedTags.filter((t) => !existingIds.has(String(t.id))),
              ];
            }
            if (parsedRating !== null) patched.rating100 = parsedRating;
            if (orgVal !== undefined) patched.organized = orgVal;
            applyLocalScenePatch(patched);
          });

          setBulkMessage(`Successfully updated ${bulkTargetScenes.length} scene(s).`);
          setBulkStudioName("");
          setBulkAddPerformer("");
          setBulkAddTag("");
          setBulkRating("");
          setBulkOrganized("");

          if (autoCloseOnBulkEdit) {
            setTimeout(() => {
              if (typeof clearCachedScenes === "function") clearCachedScenes();
              notifyApplied();
              onClose();
            }, 1200);
          } else {
            notifyApplied();
          }
        } catch (err) {
          console.error(err);
          setBulkMessage("");
          setBulkError(err?.message || String(err));
        } finally {
          setBulkSubmitting(false);
        }
      };

      // Bulk Rename Functions & Memoized Data
      const handleInsertRenameTag = (tagText) => {
        const input = renameInputRef.current;
        let nextVal = "";
        if (!input) {
          nextVal = renameScheme + tagText;
        } else {
          const start = input.selectionStart ?? renameScheme.length;
          const end = input.selectionEnd ?? renameScheme.length;
          nextVal = renameScheme.slice(0, start) + tagText + renameScheme.slice(end);
          setTimeout(() => {
            if (input.focus) input.focus();
            if (input.setSelectionRange) input.setSelectionRange(start + tagText.length, start + tagText.length);
          }, 0);
        }
        setRenameScheme(nextVal);
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem("sfm_last_rename_scheme", nextVal);
        }
      };

      const generateProposedFilename = useCallback(
        (scene, scheme, cloudMatch, parsedGroups) => {
          if (!scene) return "";
          const origBasename = scene.files?.[0]?.basename || scene.title || "";
          const lastDot = origBasename.lastIndexOf(".");
          const ext = (lastDot > 0 ? origBasename.substring(lastDot + 1) : "mp4").toLowerCase();

          const studio = (
            cloudMatch?.studio?.name ||
            scene.studio?.name ||
            parsedGroups?.studio ||
            activeStudioClue ||
            ""
          ).trim();
          const code = (cloudMatch?.code || scene.code || parsedGroups?.code || "").trim();
          const rawTitle = (cloudMatch?.title || scene.title || parsedGroups?.title || "").trim();
          const title = (
            rawTitle && !rawTitle.toLowerCase().endsWith(`.${ext}`)
              ? rawTitle
              : origBasename.replace(/\.[^/.]+$/, "")
          ).trim();

          const performers = (
            cloudMatch?.performers?.map((p) => p.name).join(", ") ||
            (scene.performers || []).map((p) => p.name).join(", ") ||
            parsedGroups?.performers ||
            activePerformerClue ||
            ""
          ).trim();

          const date = (cloudMatch?.date || scene.date || parsedGroups?.date || "").trim();
          const year = date ? date.substring(0, 4) : "";

          const h = scene.files?.[0]?.height || 0;
          const w = scene.files?.[0]?.width || 0;
          let resolution = "";
          if (h >= 2160 || w >= 3840) resolution = "4K";
          else if (h >= 1440) resolution = "1440p";
          else if (h >= 1080) resolution = "1080p";
          else if (h >= 720) resolution = "720p";
          else if (h >= 480) resolution = "480p";
          else if (h > 0) resolution = `${h}p`;

          let proposed = scheme || "({studio})({code})({performers})({title}).{ext}";
          proposed = proposed.replace(/\{studio\}/gi, studio);
          proposed = proposed.replace(/\{code\}/gi, code);
          proposed = proposed.replace(/\{performers\}/gi, performers);
          proposed = proposed.replace(/\{title\}/gi, title);
          proposed = proposed.replace(/\{date\}/gi, date);
          proposed = proposed.replace(/\{year\}/gi, year);
          proposed = proposed.replace(/\{resolution\}/gi, resolution);
          proposed = proposed.replace(/\{ext\}/gi, ext);

          proposed = proposed.replace(/[/\\:*?"<>|]/g, " - ");
          proposed = proposed.replace(/\(\s*-\s*\)/g, "").replace(/\[\s*-\s*\]/g, "");
          proposed = proposed.replace(/\(\s*\)/g, "").replace(/\[\s*\]/g, "");
          proposed = proposed.replace(/\s*-\s*(?:-\s*)+/g, " - ");
          proposed = proposed.replace(/\s+/g, " ").trim();
          proposed = proposed.replace(/^[-_.\s]+/, "");

          if (!proposed.toLowerCase().endsWith("." + ext)) {
            proposed = proposed + "." + ext;
          }
          return proposed;
        },
        [activeStudioClue, activePerformerClue]
      );

      const renamePreviewItems = useMemo(() => {
        return localScenes.map((scene) => {
          const sId = String(scene.id);
          const cloud = cloudMatches[sId];
          const parsed = parsedResults.items.find((it) => String(it.scene.id) === sId)?.groups || {};
          const currentBasename = scene.files?.[0]?.basename || scene.title || "";
          const proposedBasename = generateProposedFilename(scene, renameScheme, cloud, parsed);
          const isChanged = currentBasename !== proposedBasename;
          return {
            scene,
            currentBasename,
            proposedBasename,
            isChanged,
            cloud,
            parsed,
          };
        });
      }, [localScenes, renameScheme, cloudMatches, parsedResults, generateProposedFilename]);

      const changedRenameCount = renamePreviewItems.filter((i) => i.isChanged).length;
      const unchangedRenameCount = renamePreviewItems.length - changedRenameCount;

      const filteredRenameItems = useMemo(() => {
        if (renameFilter === "changed") return renamePreviewItems.filter((i) => i.isChanged);
        if (renameFilter === "unchanged") return renamePreviewItems.filter((i) => !i.isChanged);
        return renamePreviewItems;
      }, [renamePreviewItems, renameFilter]);

      const handleToggleSelectRenameScene = (sceneId) => {
        const sId = String(sceneId);
        setSelectedRenameIds((prev) => {
          const next = new Set(prev);
          if (next.has(sId)) next.delete(sId);
          else next.add(sId);
          return next;
        });
      };

      const handleSelectAllChangedRename = () => {
        const changedIds = renamePreviewItems.filter((i) => i.isChanged).map((i) => String(i.scene.id));
        if (selectedRenameIds.size === changedIds.length && changedIds.length > 0) {
          setSelectedRenameIds(new Set());
        } else {
          setSelectedRenameIds(new Set(changedIds));
        }
      };

      const handleExecuteBulkRename = async () => {
        const selectedItems = renamePreviewItems.filter((item) =>
          selectedRenameIds.has(String(item.scene.id))
        );
        if (selectedItems.length === 0) return;

        setIsRenaming(true);
        setRenameProgressText(`Submitting bulk rename task for ${selectedItems.length} scenes to Stash...`);

        const itemsPayload = selectedItems.map((item) => ({
          scene_id: String(item.scene.id),
          file_id: item.scene.files?.[0]?.id,
          old_path: item.scene.files?.[0]?.path,
          old_basename: item.currentBasename,
          new_basename: item.proposedBasename,
        }));

        const updatedStates = { ...renameStates };
        selectedItems.forEach((it) => {
          updatedStates[String(it.scene.id)] = { status: "renaming", msg: "Renaming on disk & database..." };
        });
        setRenameStates(updatedStates);

        const patchRenamedFile = (scene, newBasename) => {
          if (!scene || !Array.isArray(scene.files) || scene.files.length === 0) return;
          const nextFiles = scene.files.map((f, idx) =>
            idx === 0 ? { ...f, basename: newBasename } : f
          );
          applyLocalScenePatch({ ...scene, files: nextFiles });
        };

        const applyResultSummary = (summary) => {
          const results = summary?.results || [];
          let okCount = 0;
          let errCount = 0;

          itemsPayload.forEach((p) => {
            const r = results.find(
              (res) => String(res.scene_id) === String(p.scene_id) || Number(res.file_id) === Number(p.file_id)
            );
            const scene = localScenes.find((s) => String(s.id) === String(p.scene_id));
            if (!r || r.status === "success" || r.status === "partial") {
              patchRenamedFile(scene, p.new_basename);
              updatedStates[p.scene_id] = {
                status: "done",
                msg: r?.status === "partial" ? "Renamed (DB unconfirmed)" : "✓ Renamed",
              };
              okCount++;
            } else if (r.status === "unchanged") {
              updatedStates[p.scene_id] = { status: "idle", msg: "Unchanged" };
            } else {
              updatedStates[p.scene_id] = { status: "error", msg: r.message || "Rename failed" };
              errCount++;
            }
          });

          setRenameStates({ ...updatedStates });
          if (errCount === 0) {
            setRenameProgressText(
              `Bulk rename completed successfully for ${okCount} files! Stash associations preserved.`
            );
          } else {
            setRenameProgressText(`Bulk rename finished: ${okCount} succeeded, ${errCount} errors.`);
          }

          setTimeout(() => {
            if (typeof clearCachedScenes === "function") clearCachedScenes();
            notifyApplied();
          }, 1500);
        };

        try {
          const res = await gqlFetch(
            `mutation RunBulkRenameTask($args_map: Map) {
              runPluginTask(plugin_id: "stash_file_manager", task_name: "Bulk Rename Files", args_map: $args_map)
            }`,
            {
              args_map: {
                mode: "rename",
                items: itemsPayload,
              },
            }
          );

          const taskId = res?.runPluginTask;
          setRenameProgressText(`Bulk rename task queued (Job #${taskId || "1"}). Waiting for execution...`);

          let isFinished = false;
          let jobStatus = "RUNNING";
          for (let poll = 0; poll < 60; poll++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              const jobRes = await gqlFetch(
                `query CheckJob($id: ID!) {
                  findJob(input: { id: $id }) {
                    id
                    status
                    error
                  }
                }`,
                { id: String(taskId) }
              );
              const job = jobRes?.findJob;
              jobStatus = job?.status || "RUNNING";
              if (jobStatus === "FINISHED" || jobStatus === "FAILED" || jobStatus === "CANCELLED") {
                isFinished = true;
                break;
              }
            } catch (pollErr) {}
          }

          if (isFinished && jobStatus === "FINISHED") {
            itemsPayload.forEach((p) => {
              const scene = localScenes.find((s) => String(s.id) === String(p.scene_id));
              patchRenamedFile(scene, p.new_basename);
              updatedStates[p.scene_id] = { status: "done", msg: "✓ Renamed" };
            });
            setRenameStates({ ...updatedStates });
            setRenameProgressText(
              `Bulk rename completed successfully for ${itemsPayload.length} files! Stash associations preserved.`
            );
            setTimeout(() => {
              if (typeof clearCachedScenes === "function") clearCachedScenes();
              notifyApplied();
            }, 1200);
          } else if (jobStatus === "FAILED") {
            throw new Error("Stash background task failed.");
          } else {
            setRenameProgressText(`Bulk rename job #${taskId} submitted. Stash associations preserved.`);
            setTimeout(() => {
              if (typeof clearCachedScenes === "function") clearCachedScenes();
              notifyApplied();
            }, 1500);
          }
        } catch (err) {
          console.error("runPluginTask error, attempting runPluginOperation fallback:", err);
          try {
            setRenameProgressText("Executing rename via synchronous plugin operation...");
            const opRes = await gqlFetch(
              `mutation RunBulkRenameOp($args: Map) {
                runPluginOperation(plugin_id: "stash_file_manager", args: $args)
              }`,
              {
                args: {
                  mode: "rename",
                  items: itemsPayload,
                },
              }
            );

            let opSummary = null;
            const rawOpOut = opRes?.runPluginOperation;
            if (typeof rawOpOut === "string") {
              const jsonMatch = rawOpOut.match(/\{[\s\S]*"results"[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  opSummary = JSON.parse(jsonMatch[0]);
                } catch (pe) {}
              }
            } else if (typeof rawOpOut === "object" && rawOpOut !== null) {
              opSummary = rawOpOut;
            }

            if (opSummary) {
              applyResultSummary(opSummary);
            } else {
              itemsPayload.forEach((p) => {
                const scene = localScenes.find((s) => String(s.id) === String(p.scene_id));
                patchRenamedFile(scene, p.new_basename);
                updatedStates[p.scene_id] = { status: "done", msg: "✓ Renamed" };
              });
              setRenameStates({ ...updatedStates });
              setRenameProgressText(`Bulk rename completed for ${itemsPayload.length} files!`);
              setTimeout(() => {
                if (typeof clearCachedScenes === "function") clearCachedScenes();
                notifyApplied();
              }, 1200);
            }
          } catch (opErr) {
            console.error(opErr);
            setRenameProgressText(`Error renaming files: ${opErr.message || err.message}`);
          }
        } finally {
          setIsRenaming(false);
        }
      };

      const sampleProposedName = sampleScene
        ? generateProposedFilename(
            sampleScene,
            renameScheme,
            cloudMatches[String(sampleScene.id)],
            parsedResults.items.find((it) => String(it.scene.id) === String(sampleScene.id))?.groups || {}
          )
        : "";

      const hasAnyAttributeFilter =
        Boolean(attrSearchQuery.trim()) ||
        organizedFilter !== "all" ||
        missingFields.length > 0 ||
        previewFilter !== "all";

      // Reusable Attribute Filter Bar (used in Scrape, Pattern, and Bulk Edit)
      const renderAttributeFilterBar = (showMatchFilter = true) =>
        React.createElement(
          "div",
          {
            className: "sfm-studio-filter-bar p-2 px-3 mb-2 rounded bg-dark border border-secondary",
            style: { backgroundColor: "#141822" },
          },
          React.createElement(
            "div",
            { className: "d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2" },
            // Quick text search across attributes
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-2 flex-grow-1", style: { minWidth: "200px", maxWidth: "340px" } },
              renderIcon(IconSearch, { size: 12, className: "text-info" }),
              React.createElement("input", {
                type: "text",
                className: "form-control form-control-sm bg-black text-light border-secondary sfm-studio-search-input",
                style: { height: "28px", fontSize: "0.78rem" },
                placeholder: "Filter items by name, code, metadata...",
                value: attrSearchQuery,
                onChange: (e) => setAttrSearchQuery(e.target.value),
              })
            ),
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-3 flex-wrap" },
              // Match status filter pills (when table is shown)
              showMatchFilter &&
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center gap-1 sfm-match-filter-group" },
                  React.createElement("span", { className: "sfm-filter-label mr-1" }, "Status:"),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `sfm-pill-btn ${previewFilter === "all" ? "active-secondary" : ""}`,
                      onClick: () => setPreviewFilter("all"),
                    },
                    `All (${attributeFilteredItems.length})`
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `sfm-pill-btn ${previewFilter === "matched" ? "active-success" : ""}`,
                      onClick: () => setPreviewFilter("matched"),
                    },
                    `Matched (${matchedCount})`
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: `sfm-pill-btn ${previewFilter === "unmatched" ? "active-warning" : ""}`,
                      onClick: () => setPreviewFilter("unmatched"),
                    },
                    `Unmatched (${unmatchedCount})`
                  )
                ),
              // Organized filter pills
              React.createElement(
                "div",
                { className: "d-flex align-items-center gap-1 sfm-organized-filter-group" },
                React.createElement("span", { className: "sfm-filter-label mr-1" }, "Organized:"),
                [
                  { id: "all", label: "All" },
                  { id: "organized", label: "Organized" },
                  { id: "unorganized", label: "Unorganized" },
                ].map((opt) =>
                  React.createElement(
                    "button",
                    {
                      key: opt.id,
                      type: "button",
                      className: `sfm-pill-btn ${
                        organizedFilter === opt.id
                          ? opt.id === "organized"
                            ? "active-primary"
                            : "active-secondary"
                          : ""
                      }`,
                      onClick: () => setOrganizedFilter(opt.id),
                    },
                    opt.label
                  )
                ),
                React.createElement(
                  "select",
                  {
                    className: "sfm-filter-organized form-select form-select-sm d-none",
                    "aria-hidden": "true",
                    tabIndex: -1,
                    value: organizedFilter,
                    onChange: (e) => setOrganizedFilter(e.target.value),
                  },
                  React.createElement("option", { value: "all" }, "All"),
                  React.createElement("option", { value: "organized" }, "Organized"),
                  React.createElement("option", { value: "unorganized" }, "Unorganized")
                )
              )
            )
          ),
          // Second row: Missing Fields multi-pill filter + Clear + Counts
          React.createElement(
            "div",
            { className: "d-flex align-items-center justify-content-between flex-wrap gap-2" },
            React.createElement(
              "div",
              { className: "d-flex align-items-center flex-wrap gap-1 sfm-missing-fields-bar" },
              React.createElement("span", { className: "sfm-filter-label mr-1" }, "Missing Fields:"),
              MISSING_FIELD_OPTIONS.map((mf) => {
                const isActive = missingFields.includes(mf.key);
                return React.createElement(
                  "button",
                  {
                    key: mf.key,
                    type: "button",
                    className: `sfm-pill-btn ${isActive ? "active-warning" : ""}`,
                    style: { fontSize: "0.72rem", padding: "0.12rem 0.5rem" },
                    onClick: () => handleToggleMissingField(mf.key),
                    title: `Filter scenes missing ${mf.label}`,
                  },
                  mf.label
                );
              }),
              missingFields.length > 1 &&
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "sfm-pill-btn text-info ml-1",
                    style: { borderColor: "rgba(0, 189, 196, 0.4)", fontSize: "0.7rem", padding: "0.12rem 0.45rem" },
                    onClick: () => setMissingMode((m) => (m === "any" ? "all" : "any")),
                    title: "Toggle whether scenes must be missing ANY or ALL selected fields",
                  },
                  missingMode === "any" ? "Mode: Any" : "Mode: All"
                ),
              hasAnyAttributeFilter &&
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "sfm-pill-btn sfm-action-btn-clear ml-1",
                    style: { fontSize: "0.7rem", padding: "0.12rem 0.45rem" },
                    onClick: handleResetFilters,
                  },
                  "Clear Filters"
                )
            ),
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-2" },
              tableSortKey &&
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "sfm-pill-btn",
                    style: { fontSize: "0.7rem", padding: "0.12rem 0.45rem" },
                    onClick: () => setTableSortKey(null),
                    title: "Reset column sort order",
                  },
                  "Reset Sort"
                ),
              React.createElement(
                "span",
                { className: "small text-muted font-weight-500", style: { fontSize: "0.74rem" } },
                `Showing ${filteredItems.length} of ${localScenes.length}`
              )
            )
          )
        );

      const allFilteredSelected =
        filteredItems.length > 0 && filteredItems.every((it) => selectedSceneIds.has(String(it.scene.id)));

      const is2Tier = layoutTemplate === SCRAPE_LAYOUT_TEMPLATES.COMPACT_2TIER;

      // Action Buttons Cell Helper (Used by both 2-tier and 1-tier layouts)
      const renderActionsCell = (item, sId, sState, cloud, isExpanded, isInlineSearchOpen, isInlineEditOpen) =>
        React.createElement(
          "td",
          {
            key: "td-actions",
            className: is2Tier ? "sfm-full-cell" : undefined,
            style: { width: `${colWidths.actions || 130}px`, textAlign: "center" },
            onClick: (e) => e.stopPropagation(),
          },
          React.createElement(
            "div",
            { className: "d-inline-flex gap-1 align-items-center justify-content-center" },
            cloud &&
              React.createElement(
                "button",
                {
                  type: "button",
                  className: `btn btn-xs ${
                    sState.status === "done"
                      ? "btn-outline-success disabled"
                      : "btn-success font-weight-bold"
                  } py-0 px-2 mr-1`,
                  disabled: sState.status === "applying" || sState.status === "done",
                  onClick: () => handleApplySingle(item.scene),
                  title: "Apply scraped metadata immediately",
                },
                sState.status === "applying" ? "..." : sState.status === "done" ? "✓" : "Apply"
              ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-xs btn-outline-info py-0 px-2 mr-1",
                onClick: () => handleScrapeSingleRow(item.scene),
                title: "Scrape this scene using selected source",
              },
              "Scrape"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: `btn btn-xs ${
                  isInlineSearchOpen ? "btn-warning" : "btn-secondary text-light"
                } py-0 px-2 mr-1`,
                onClick: () => handleOpenInlineSearch(item.scene),
                title: "Search this scene by custom title/query across scrapers",
              },
              renderIcon(IconSearch, { size: 10, className: "mr-1" }),
              "Search"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: `btn btn-xs ${
                  isInlineEditOpen ? "btn-primary font-weight-bold" : "btn-outline-warning"
                } py-0 px-2 mr-1 sfm-row-edit-btn sfm-btn-inline-edit`,
                onClick: () => handleOpenInlineEdit(item.scene),
                title: "Edit scene metadata inline",
              },
              renderIcon(IconEdit, { size: 10, className: "mr-1" }),
              "Edit"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn btn-xs sfm-action-btn-clear py-0 px-2 mr-1 sfm-row-clear-btn sfm-btn-clear-scene",
                onClick: () => handleClearSceneMetadata(item.scene),
                title: "Clear all metadata fields from this scene (reset to blank)",
              },
              renderIcon(IconTrash, { size: 10, className: "mr-1" }),
              "Clear"
            ),
            cloud &&
              React.createElement(
                "button",
                {
                  type: "button",
                  className: `btn btn-xs ${
                    isExpanded ? "btn-dark text-info" : "btn-outline-info"
                  } py-0 px-1`,
                  onClick: () => handleToggleExpandRow(sId),
                  title: isExpanded ? "Collapse scraped details" : "Expand scraped details",
                },
                isExpanded ? "▲" : "▼"
              )
          )
        );

      const renderLayoutTemplateModal = () => {
        if (!showLayoutModal) return null;

        const currentWidths = colWidths || (is2Tier ? DEFAULT_SCRAPE_WIDTHS_2TIER : DEFAULT_SCRAPE_WIDTHS_1TIER);

        const widthFields2Tier = [
          { key: "checkbox", label: "Checkbox (Full)", min: 28, max: 80 },
          { key: "cover", label: "Cover (Full)", min: 40, max: 120 },
          { key: "title_filename", label: "Title / Filename (Split)", min: 140, max: 500 },
          { key: "studio_performers", label: "Studio / Performers (Split)", min: 100, max: 400 },
          { key: "date_code", label: "Date / Code (Split)", min: 80, max: 250 },
          { key: "organized_status", label: "Organized / Status (Split)", min: 80, max: 250 },
          { key: "actions", label: "Actions (Full)", min: 100, max: 300 },
        ];

        const widthFields1Tier = [
          { key: "checkbox", label: "Checkbox", min: 24, max: 80 },
          { key: "cover", label: "Cover", min: 36, max: 120 },
          { key: "filename", label: "Filename", min: 80, max: 350 },
          { key: "title", label: "Title", min: 90, max: 450 },
          { key: "date", label: "Date", min: 60, max: 180 },
          { key: "studio", label: "Studio", min: 70, max: 300 },
          { key: "code", label: "Code", min: 50, max: 200 },
          { key: "performers", label: "Performers", min: 70, max: 350 },
          { key: "organized", label: "Organized", min: 45, max: 150 },
          { key: "source", label: "Source", min: 50, max: 180 },
          { key: "status", label: "Status", min: 50, max: 180 },
          { key: "actions", label: "Actions", min: 90, max: 300 },
        ];

        const activeFields = is2Tier ? widthFields2Tier : widthFields1Tier;
        const totalCalculatedWidth = activeFields.reduce(
          (sum, f) =>
            sum +
            (Number(currentWidths[f.key]) ||
              (is2Tier ? DEFAULT_SCRAPE_WIDTHS_2TIER[f.key] : DEFAULT_SCRAPE_WIDTHS_1TIER[f.key]) ||
              100),
          0
        );

        return React.createElement(
          "div",
          {
            className: "sfm-layout-modal-backdrop d-flex align-items-center justify-content-center",
            onClick: () => setShowLayoutModal(false),
          },
          React.createElement(
            "div",
            {
              className: "sfm-layout-modal bg-dark text-light border border-secondary rounded shadow-lg p-3",
              style: { width: "560px", maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", zIndex: 1070 },
              onClick: (e) => e.stopPropagation(),
            },
            React.createElement(
              "div",
              { className: "d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom border-secondary" },
              React.createElement(
                "h5",
                { className: "m-0 d-flex align-items-center gap-2 font-weight-bold" },
                renderIcon(IconColumns, { size: 18, className: "text-info mr-2" }),
                "Layout Templates & Column Widths"
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "close text-light sfm-layout-modal-close",
                  onClick: () => setShowLayoutModal(false),
                },
                "×"
              )
            ),
            React.createElement(
              "div",
              { className: "mb-3" },
              React.createElement("label", { className: "font-weight-bold text-info small mb-2 d-block" }, "1. Select Layout Mode"),
              React.createElement(
                "div",
                { className: "row g-2" },
                React.createElement(
                  "div",
                  { className: "col-6" },
                  React.createElement(
                    "div",
                    {
                      className: `sfm-template-card p-2 rounded border cursor-pointer ${
                        is2Tier ? "border-info bg-primary bg-opacity-25" : "border-secondary"
                      }`,
                      style: {
                        cursor: "pointer",
                        background: is2Tier ? "rgba(136, 192, 208, 0.12)" : "rgba(255, 255, 255, 0.03)",
                      },
                      onClick: () => handleSelectTemplate(SCRAPE_LAYOUT_TEMPLATES.COMPACT_2TIER),
                    },
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center justify-content-between mb-1" },
                      React.createElement("span", { className: "font-weight-bold text-light" }, "Compact 2-Tier"),
                      React.createElement("span", { className: "badge badge-success py-0 px-1 small" }, "Recommended")
                    ),
                    React.createElement(
                      "div",
                      { className: "small text-muted", style: { fontSize: "0.74rem", lineHeight: "1.2" } },
                      "Full-height controls + 2-tier stacked metadata cells. Eliminates horizontal scrolling."
                    )
                  )
                ),
                React.createElement(
                  "div",
                  { className: "col-6" },
                  React.createElement(
                    "div",
                    {
                      className: `sfm-template-card p-2 rounded border cursor-pointer ${
                        !is2Tier ? "border-info bg-primary bg-opacity-25" : "border-secondary"
                      }`,
                      style: {
                        cursor: "pointer",
                        background: !is2Tier ? "rgba(136, 192, 208, 0.12)" : "rgba(255, 255, 255, 0.03)",
                      },
                      onClick: () => handleSelectTemplate(SCRAPE_LAYOUT_TEMPLATES.STANDARD_1TIER),
                    },
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center justify-content-between mb-1" },
                      React.createElement("span", { className: "font-weight-bold text-light" }, "Standard 1-Tier")
                    ),
                    React.createElement(
                      "div",
                      { className: "small text-muted", style: { fontSize: "0.74rem", lineHeight: "1.2" } },
                      "Traditional single-line table with all 12 columns side-by-side."
                    )
                  )
                )
              )
            ),
            React.createElement(
              "div",
              { className: "mb-3" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-2" },
                React.createElement(
                  "label",
                  { className: "font-weight-bold text-info small m-0" },
                  "2. Adjust Column Widths"
                ),
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center gap-2" },
                  React.createElement(
                    "span",
                    { className: "small text-muted mr-2" },
                    `Total: ~${totalCalculatedWidth}px`
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-xs btn-outline-secondary py-0 px-2 sfm-reset-widths-btn",
                      onClick: handleResetColWidths,
                      title: "Reset column widths to default",
                    },
                    "Reset Defaults"
                  )
                )
              ),
              React.createElement(
                "div",
                {
                  className: "sfm-width-adjusters p-2 rounded border border-secondary",
                  style: { backgroundColor: "rgba(0, 0, 0, 0.25)", maxHeight: "230px", overflowY: "auto" },
                },
                activeFields.map((f) => {
                  const val =
                    currentWidths[f.key] !== undefined
                      ? currentWidths[f.key]
                      : (is2Tier ? DEFAULT_SCRAPE_WIDTHS_2TIER[f.key] : DEFAULT_SCRAPE_WIDTHS_1TIER[f.key]);
                  return React.createElement(
                    "div",
                    {
                      key: f.key,
                      className: "d-flex align-items-center justify-content-between mb-2 py-1 px-1 border-bottom border-dark",
                    },
                    React.createElement(
                      "span",
                      { className: "small text-light", style: { width: "190px", fontSize: "0.78rem" } },
                      f.label
                    ),
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center gap-2 flex-grow-1 ml-2" },
                      React.createElement("input", {
                        type: "range",
                        className: "form-range flex-grow-1",
                        min: f.min,
                        max: f.max,
                        value: val,
                        onChange: (e) => handleUpdateColWidth(f.key, e.target.value),
                        style: { cursor: "pointer", height: "18px" },
                      }),
                      React.createElement("input", {
                        type: "number",
                        className: "form-control form-control-sm bg-dark text-light border-secondary text-right px-1",
                        style: { width: "65px", height: "24px", fontSize: "0.78rem" },
                        min: f.min,
                        max: f.max,
                        value: val,
                        onChange: (e) => handleUpdateColWidth(f.key, e.target.value),
                      }),
                      React.createElement("span", { className: "small text-muted" }, "px")
                    )
                  );
                })
              )
            ),
            React.createElement(
              "div",
              { className: "d-flex justify-content-between align-items-center pt-2 border-top border-secondary" },
              React.createElement(
                "span",
                { className: "small text-muted" },
                "Changes are saved automatically."
              ),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "btn btn-sm btn-info font-weight-bold px-3 sfm-layout-modal-done",
                  onClick: () => setShowLayoutModal(false),
                },
                "Done"
              )
            )
          )
        );
      };

      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "div",
          { className: "sfm-modal-backdrop", onClick: onClose },
          React.createElement(
            "div",
            {
              className: "sfm-modal-dialog sfm-modal-dialog-large sfm-parser-modal",
              onClick: (e) => e.stopPropagation(),
            },
          // Header with 4 Dedicated Tabs
          React.createElement(
            "div",
            { className: "sfm-modal-header d-flex justify-content-between align-items-center" },
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-3 flex-wrap" },
              React.createElement(
                "h5",
                { className: "mb-0 d-flex align-items-center" },
                renderIcon(IconGlobe, { size: 17, color: "#88c0d0", className: "mr-2" }),
                "Unified Metadata Studio"
              ),
              React.createElement(
                "div",
                { className: "btn-group btn-group-sm ml-2 sfm-studio-tabs" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    "data-tab": "scrape",
                    className: `btn btn-sm ${
                      activeTab === "scrape" ? "btn-primary font-weight-bold" : "btn-outline-secondary"
                    } py-1 px-3`,
                    onClick: () => setActiveTab("scrape"),
                  },
                  renderIcon(IconGlobe, { size: 13, className: "mr-1" }),
                  "Scrape & Search"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    "data-tab": "pattern",
                    className: `btn btn-sm ${
                      activeTab === "pattern" ? "btn-primary font-weight-bold" : "btn-outline-secondary"
                    } py-1 px-3`,
                    onClick: () => setActiveTab("pattern"),
                  },
                  renderIcon(IconSettings, { size: 13, className: "mr-1" }),
                  "Filename Patterns"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    "data-tab": "bulk_edit",
                    className: `btn btn-sm ${
                      activeTab === "bulk_edit" ? "btn-primary font-weight-bold" : "btn-outline-secondary"
                    } py-1 px-3`,
                    onClick: () => setActiveTab("bulk_edit"),
                  },
                  renderIcon(IconEdit, { size: 13, className: "mr-1" }),
                  "Bulk Edit"
                ),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    "data-tab": "rename",
                    className: `btn btn-sm ${
                      activeTab === "rename" ? "btn-primary font-weight-bold" : "btn-outline-secondary"
                    } py-1 px-3`,
                    onClick: () => setActiveTab("rename"),
                  },
                  renderIcon(IconTag, { size: 13, className: "mr-1" }),
                  "Bulk Rename Files"
                )
              ),
              currentFolder && React.createElement("span", { className: "small text-muted" }, currentFolder)
            ),
            React.createElement(
              "button",
              { type: "button", className: "close text-light", onClick: onClose },
              "×"
            )
          ),
          // Body
          React.createElement(
            "div",
            { className: "sfm-modal-body" },
            activeTab === "rename"
              ? React.createElement(
                  "div",
                  { className: "sfm-rename-section mb-3" },
                  // Scheme Builder Card
                  React.createElement(
                    "div",
                    { className: "sfm-rename-card p-3 mb-3 rounded bg-dark border border-secondary" },
                    React.createElement(
                      "div",
                      { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                      React.createElement(
                        "div",
                        { className: "d-flex align-items-center gap-2" },
                        React.createElement(
                          "span",
                          { className: "badge badge-primary d-inline-flex align-items-center font-weight-bold" },
                          renderIcon(IconTag, { size: 11, className: "mr-1" }),
                          "Rename Scheme"
                        ),
                        React.createElement(
                          "span",
                          { className: "small text-muted" },
                          "Build filename template using clickable tags & presets:"
                        )
                      ),
                      React.createElement(
                        "div",
                        { className: "d-flex align-items-center gap-2" },
                        React.createElement("span", { className: "small text-muted font-weight-bold" }, "Presets:"),
                        React.createElement(
                          "select",
                          {
                            className: "form-control form-control-sm bg-dark text-info border-secondary py-0 font-weight-bold",
                            style: { width: "auto", height: "26px", fontSize: "0.8rem" },
                            value: renameScheme,
                            onChange: (e) => {
                              const val = e.target.value;
                              setRenameScheme(val);
                              if (typeof window !== "undefined" && window.localStorage) {
                                window.localStorage.setItem("sfm_last_rename_scheme", val);
                              }
                            },
                          },
                          RENAME_PRESETS.map((p) =>
                            React.createElement("option", { key: p.label, value: p.scheme }, p.label)
                          )
                        )
                      )
                    ),
                    // Interactive Tag Chips
                    React.createElement(
                      "div",
                      { className: "mb-3" },
                      React.createElement(
                        "div",
                        { className: "d-flex justify-content-between align-items-center mb-1" },
                        React.createElement(
                          "label",
                          { className: "small font-weight-bold text-muted mb-0" },
                          "CLICK TAGS TO INSERT INTO SCHEME:"
                        ),
                        React.createElement(
                          "span",
                          { className: "small text-muted" },
                          "Click tag chip to insert at cursor position"
                        )
                      ),
                      React.createElement(
                        "div",
                        {
                          className:
                            "d-flex align-items-center flex-wrap gap-1 p-2 rounded bg-black border border-secondary",
                        },
                        RENAME_TAGS.map((t) =>
                          React.createElement(
                            "button",
                            {
                              key: t.tag,
                              type: "button",
                              className: "btn btn-xs sfm-tag-chip py-1 px-2 font-weight-bold mr-1 mb-1",
                              style: {
                                backgroundColor: t.color,
                                color: "#141822",
                                border: "none",
                                borderRadius: "4px",
                              },
                              onClick: () => handleInsertRenameTag(t.tag),
                              title: `${t.desc} - Click to insert ${t.tag} into scheme`,
                            },
                            renderIcon(IconTag, { size: 10, className: "mr-1" }),
                            t.label
                          )
                        ),
                        React.createElement("span", { className: "text-muted mx-1" }, "|"),
                        [" - ", "_", ".", "(", ")", "[", "]"].map((sep) =>
                          React.createElement(
                            "button",
                            {
                              key: sep,
                              type: "button",
                              className: "btn btn-xs btn-outline-secondary py-1 px-2 mr-1 mb-1 font-weight-bold",
                              style: { fontFamily: "monospace" },
                              onClick: () => handleInsertRenameTag(sep),
                              title: `Insert '${sep}'`,
                            },
                            sep
                          )
                        )
                      )
                    ),
                    // Scheme Input Field
                    React.createElement(
                      "div",
                      { className: "form-group mb-3" },
                      React.createElement(
                        "div",
                        { className: "d-flex justify-content-between align-items-center mb-1" },
                        React.createElement(
                          "label",
                          { className: "small font-weight-bold mb-0 text-light" },
                          "Active Rename Scheme"
                        ),
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs btn-link text-muted p-0",
                            onClick: () => {
                              const def = "({studio})({code})({performers})({title}).{ext}";
                              setRenameScheme(def);
                              if (typeof window !== "undefined" && window.localStorage) {
                                window.localStorage.setItem("sfm_last_rename_scheme", def);
                              }
                            },
                          },
                          "Reset Default"
                        )
                      ),
                      React.createElement("input", {
                        ref: renameInputRef,
                        type: "text",
                        className: "form-control font-weight-bold bg-dark text-info border-secondary sfm-scheme-input",
                        value: renameScheme,
                        onChange: (e) => {
                          setRenameScheme(e.target.value);
                          if (typeof window !== "undefined" && window.localStorage) {
                            window.localStorage.setItem("sfm_last_rename_scheme", e.target.value);
                          }
                        },
                        placeholder: "e.g. ({studio})({code})({performers})({title}).{ext}",
                        style: { fontFamily: "monospace", fontSize: "0.95rem" },
                      })
                    ),
                    // Live Sample Preview Banner
                    React.createElement(
                      "div",
                      { className: "sfm-rename-preview-banner p-2 px-3 rounded bg-black border border-secondary" },
                      React.createElement(
                        "div",
                        { className: "d-flex justify-content-between align-items-center mb-1 flex-wrap gap-2" },
                        React.createElement(
                          "div",
                          { className: "d-flex align-items-center gap-2" },
                          React.createElement("span", { className: "badge badge-secondary py-0 px-1" }, "Sample Scene Preview"),
                          React.createElement(
                            "span",
                            { className: "text-muted small text-truncate", style: { maxWidth: "340px" } },
                            sampleScene?.files?.[0]?.basename || sampleScene?.title || ""
                          )
                        ),
                        localScenes.length > 1 &&
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
                            React.createElement(
                              "span",
                              { className: "text-muted small" },
                              `${sampleIndex + 1} of ${localScenes.length}`
                            ),
                            React.createElement(
                              "button",
                              {
                                type: "button",
                                className: "btn btn-xs btn-outline-secondary py-0 px-2",
                                disabled: sampleIndex >= localScenes.length - 1,
                                onClick: () => setSampleIndex(Math.min(localScenes.length - 1, sampleIndex + 1)),
                              },
                              "Next ▶"
                            )
                          )
                      ),
                      React.createElement(
                        "div",
                        { className: "d-flex align-items-center gap-2 flex-wrap" },
                        React.createElement("span", { className: "text-muted small font-weight-bold" }, "Proposed Name:"),
                        React.createElement(
                          "span",
                          {
                            className: "font-weight-bold text-success sfm-proposed-name",
                            style: { fontFamily: "monospace", fontSize: "0.92rem" },
                          },
                          sampleProposedName || "—"
                        )
                      )
                    )
                  ),
                  (isRenaming || renameProgressText) &&
                    React.createElement(
                      "div",
                      {
                        className:
                          "alert alert-info py-2 px-3 small mb-3 d-flex align-items-center justify-content-between flex-wrap gap-2",
                      },
                      React.createElement("span", { className: "font-weight-bold" }, renameProgressText)
                    ),
                  // Filter & Selection Bar
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
                          className: `btn btn-sm ${
                            renameFilter === "all" ? "btn-secondary font-weight-bold" : "btn-outline-secondary"
                          } py-0 px-2`,
                          onClick: () => setRenameFilter("all"),
                        },
                        `All (${renamePreviewItems.length})`
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${
                            renameFilter === "changed" ? "btn-success font-weight-bold" : "btn-outline-secondary"
                          } py-0 px-2`,
                          onClick: () => setRenameFilter("changed"),
                        },
                        `Changed (${changedRenameCount})`
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: `btn btn-sm ${
                            renameFilter === "unchanged" ? "btn-warning font-weight-bold" : "btn-outline-secondary"
                          } py-0 px-2`,
                          onClick: () => setRenameFilter("unchanged"),
                        },
                        `Unchanged (${unchangedRenameCount})`
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
                          onClick: handleSelectAllChangedRename,
                        },
                        selectedRenameIds.size === changedRenameCount && changedRenameCount > 0
                          ? "Deselect Changed"
                          : "Select All Changed"
                      ),
                      React.createElement(
                        "span",
                        { className: "badge badge-info" },
                        `${selectedRenameIds.size} of ${localScenes.length} files selected`
                      )
                    )
                  ),
                  // Live Rename Table
                  React.createElement(
                    "div",
                    { className: "sfm-parser-table-wrap mb-3" },
                    React.createElement(
                      "table",
                      { className: "sfm-parser-table sfm-rename-table table table-dark table-sm table-striped" },
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
                              checked: selectedRenameIds.size === localScenes.length && localScenes.length > 0,
                              onChange: () => {
                                if (selectedRenameIds.size === localScenes.length) setSelectedRenameIds(new Set());
                                else setSelectedRenameIds(new Set(localScenes.map((s) => String(s.id))));
                              },
                            })
                          ),
                          React.createElement("th", { style: { width: "64px", textAlign: "center" } }, "Cover"),
                          React.createElement("th", { style: { maxWidth: "240px" } }, "Current Filename"),
                          React.createElement("th", null, "Proposed New Filename"),
                          React.createElement("th", { style: { width: "180px" } }, "Tags Preview"),
                          React.createElement("th", { style: { width: "120px", textAlign: "center" } }, "Status")
                        )
                      ),
                      React.createElement(
                        "tbody",
                        null,
                        filteredRenameItems.map((item) => {
                          const sId = String(item.scene.id);
                          const isSelected = selectedRenameIds.has(sId);
                          const rState = renameStates[sId] || { status: "idle" };
                          const posterUrl = item.scene.paths?.screenshot || `/scene/${sId}/screenshot`;

                          return React.createElement(
                            "tr",
                            {
                              key: sId,
                              style: { cursor: "pointer", opacity: isSelected ? 1 : 0.65 },
                              onClick: () => handleToggleSelectRenameScene(sId),
                            },
                            React.createElement(
                              "td",
                              { style: { textAlign: "center" } },
                              React.createElement("input", {
                                type: "checkbox",
                                checked: isSelected,
                                onChange: () => handleToggleSelectRenameScene(sId),
                                onClick: (e) => e.stopPropagation(),
                              })
                            ),
                            React.createElement(
                              "td",
                              { style: { textAlign: "center" } },
                              React.createElement("img", {
                                src: posterUrl,
                                className: "sfm-scrape-thumb",
                                alt: "Thumb",
                                loading: "lazy",
                                onError: (e) => {
                                  e.target.style.display = "none";
                                },
                              })
                            ),
                            React.createElement(
                              "td",
                              { className: "text-truncate", style: { maxWidth: "240px" }, title: item.currentBasename },
                              React.createElement(
                                "span",
                                { style: { fontFamily: "monospace", fontSize: "0.82rem" } },
                                item.currentBasename
                              )
                            ),
                            React.createElement(
                              "td",
                              null,
                              React.createElement(
                                "span",
                                {
                                  className: item.isChanged ? "text-success font-weight-bold" : "text-muted",
                                  style: { fontFamily: "monospace", fontSize: "0.85rem" },
                                  title: item.proposedBasename,
                                },
                                item.proposedBasename
                              ),
                              !item.isChanged &&
                                React.createElement(
                                  "span",
                                  { className: "badge badge-dark text-muted ml-2 py-0 px-1", style: { fontSize: "0.72rem" } },
                                  "Unchanged"
                                )
                            ),
                            React.createElement(
                              "td",
                              null,
                              React.createElement(
                                "div",
                                { className: "d-flex align-items-center flex-wrap gap-1" },
                                (item.cloud?.studio?.name || item.scene.studio?.name || item.parsed?.studio) &&
                                  React.createElement(
                                    "span",
                                    { className: "badge badge-secondary py-0 px-1", style: { fontSize: "0.72rem" } },
                                    item.cloud?.studio?.name || item.scene.studio?.name || item.parsed?.studio
                                  ),
                                (item.cloud?.code || item.scene.code || item.parsed?.code) &&
                                  React.createElement(
                                    "span",
                                    {
                                      className: "badge badge-dark text-warning py-0 px-1",
                                      style: { fontSize: "0.72rem" },
                                    },
                                    item.cloud?.code || item.scene.code || item.parsed?.code
                                  )
                              )
                            ),
                            React.createElement(
                              "td",
                              { style: { textAlign: "center" } },
                              rState.status === "renaming"
                                ? React.createElement("span", { className: "badge badge-info" }, "Renaming...")
                                : rState.status === "done"
                                ? React.createElement("span", { className: "badge badge-success" }, "✓ Renamed")
                                : rState.status === "error"
                                ? React.createElement(
                                    "span",
                                    { className: "badge badge-danger", title: rState.msg || "Error" },
                                    "Error"
                                  )
                                : !item.isChanged
                                ? React.createElement("span", { className: "badge badge-secondary" }, "Unchanged")
                                : React.createElement("span", { className: "badge badge-primary font-weight-bold" }, "Ready")
                            )
                          );
                        })
                      )
                    )
                  )
                )
              : activeTab === "bulk_edit"
              ? React.createElement(
                  "div",
                  { className: "sfm-bulk-edit-section mb-3" },
                  renderAttributeFilterBar(false),
                  React.createElement(
                    "div",
                    {
                      className: "p-3 rounded bg-dark border border-secondary mb-3",
                      style: { backgroundColor: "#161a24" },
                    },
                    React.createElement(
                      "div",
                      { className: "d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2" },
                      React.createElement(
                        "div",
                        null,
                        React.createElement(
                          "h6",
                          { className: "mb-1 d-flex align-items-center text-info font-weight-bold" },
                          renderIcon(IconEdit, { size: 14, className: "mr-2" }),
                          `Bulk Edit Metadata${currentFolder ? `: "${currentFolder}"` : ""}`
                        ),
                        React.createElement(
                          "div",
                          { className: "small text-muted" },
                          selectedBulkScenes.length > 0
                            ? `Operating on ${selectedBulkScenes.length} selected scene(s) (uncheck all rows in Scrape/Pattern tab to target all filtered scenes).`
                            : `No scenes individually selected — operating on all ${bulkTargetScenes.length} filtered scene(s).`
                        )
                      ),
                      React.createElement(
                        "div",
                        { className: "d-flex align-items-center gap-2" },
                        React.createElement(
                          "span",
                          { className: "badge badge-info py-1 px-2" },
                          `${bulkTargetScenes.length} Target Scene(s)`
                        ),
                        selectedBulkScenes.length > 0 &&
                          React.createElement(
                            "button",
                            {
                              type: "button",
                              className: "btn btn-xs btn-outline-secondary py-0 px-2",
                              onClick: () => setSelectedSceneIds(new Set()),
                            },
                            "Use All Filtered"
                          )
                      )
                    ),
                    React.createElement(
                      "div",
                      { className: "row" },
                      React.createElement(
                        "div",
                        { className: "col-md-6 form-group mb-3" },
                        React.createElement(
                          "label",
                          { className: "small font-weight-bold text-light" },
                          "Assign Studio (Resolved or Created)"
                        ),
                        React.createElement("input", {
                          type: "text",
                          className: "form-control form-control-sm bg-black text-light border-secondary",
                          placeholder: "Studio (e.g. Wicked Pictures)",
                          value: bulkStudioName,
                          onChange: (e) => setBulkStudioName(e.target.value),
                        })
                      ),
                      React.createElement(
                        "div",
                        { className: "col-md-6 form-group mb-3" },
                        React.createElement(
                          "label",
                          { className: "small font-weight-bold text-light" },
                          "Add Performer(s) (Comma-separated, Resolved or Created)"
                        ),
                        React.createElement("input", {
                          type: "text",
                          className: "form-control form-control-sm bg-black text-light border-secondary",
                          placeholder: "e.g. Angela White, Jane Doe",
                          value: bulkAddPerformer,
                          onChange: (e) => setBulkAddPerformer(e.target.value),
                        })
                      ),
                      React.createElement(
                        "div",
                        { className: "col-md-4 form-group mb-3" },
                        React.createElement(
                          "label",
                          { className: "small font-weight-bold text-light" },
                          "Add Tag(s) (Comma-separated, Auto-created)"
                        ),
                        React.createElement("input", {
                          type: "text",
                          className: "form-control form-control-sm bg-black text-light border-secondary",
                          placeholder: "e.g. 4K, Favorites",
                          value: bulkAddTag,
                          onChange: (e) => setBulkAddTag(e.target.value),
                        })
                      ),
                      React.createElement(
                        "div",
                        { className: "col-md-4 form-group mb-3" },
                        React.createElement(
                          "label",
                          { className: "small font-weight-bold text-light" },
                          "Set Rating (Stars)"
                        ),
                        React.createElement(
                          "select",
                          {
                            className: "form-control form-control-sm bg-black text-light border-secondary",
                            value: bulkRating,
                            onChange: (e) => setBulkRating(e.target.value),
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
                      React.createElement(
                        "div",
                        { className: "col-md-4 form-group mb-3" },
                        React.createElement(
                          "label",
                          { className: "small font-weight-bold text-light" },
                          "Organized Status"
                        ),
                        React.createElement(
                          "select",
                          {
                            className: "form-control form-control-sm bg-black text-light border-secondary sfm-bulk-organized-select",
                            value: bulkOrganized,
                            onChange: (e) => setBulkOrganized(e.target.value),
                          },
                          React.createElement("option", { value: "" }, "Unchanged (Keep existing)"),
                          React.createElement("option", { value: "true" }, "Mark Organized (True)"),
                          React.createElement("option", { value: "false" }, "Mark Unorganized (False)")
                        )
                      )
                    ),
                    bulkError &&
                      React.createElement(
                        "div",
                        { className: "alert alert-danger py-2 px-3 small mt-2 mb-2" },
                        bulkError
                      ),
                    bulkMessage &&
                      React.createElement(
                        "div",
                        { className: "alert alert-info py-2 px-3 small mt-2 mb-2" },
                        bulkMessage
                      ),
                    React.createElement(
                      "div",
                      { className: "d-flex justify-content-end align-items-center gap-2 pt-2 border-top border-secondary" },
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-primary btn-sm font-weight-bold px-3",
                          disabled: bulkSubmitting || bulkTargetScenes.length === 0,
                          onClick: handleExecuteBulkEdit,
                        },
                        bulkSubmitting
                          ? "Applying Bulk Edit..."
                          : `Apply Bulk Edit to ${bulkTargetScenes.length} Scene(s)`
                      )
                    )
                  )
                )
              : React.createElement(
                  React.Fragment,
                  null,
                  activeTab === "scrape"
                    ? React.createElement(
                        "div",
                        { className: "sfm-scrape-section mb-3" },
                        // Scrape Toolbar
                        React.createElement(
                          "div",
                          {
                            className:
                              "d-flex justify-content-between align-items-center p-2 px-3 mb-3 rounded bg-dark border border-secondary flex-wrap gap-2",
                          },
                          React.createElement(
                            "div",
                            { className: "d-flex align-items-center gap-2 flex-wrap" },
                            React.createElement(
                              "span",
                              { className: "small text-light font-weight-bold" },
                              renderIcon(IconGlobe, { size: 13, className: "mr-1 text-info" }),
                              "Scrape Source:"
                            ),
                            React.createElement(
                              "select",
                              {
                                className:
                                  "form-control form-control-sm bg-dark text-info border-secondary py-0 font-weight-bold",
                                style: { width: "auto", height: "26px", fontSize: "0.8rem" },
                                value: selectedSourceKey,
                                onChange: (e) => {
                                  const val = e.target.value;
                                  setSelectedSourceKey(val);
                                  if (typeof window !== "undefined" && window.localStorage) {
                                    window.localStorage.setItem("sfm_last_scrape_source", val);
                                  }
                                },
                              },
                              availableSources.map((src) =>
                                React.createElement("option", { key: src.key, value: src.key }, src.label)
                              )
                            ),
                            React.createElement(
                              "select",
                              {
                                className: "form-control form-control-sm bg-dark text-muted border-secondary py-0",
                                style: { width: "auto", height: "26px", fontSize: "0.78rem" },
                                value: scrapeStrategy,
                                onChange: (e) => setScrapeStrategy(e.target.value),
                                title: "Scrape Strategy: Smart (Hash + Title Query), Hash Only, or Title Query Only",
                              },
                              React.createElement("option", { value: "smart" }, "Smart (Hash + Title)"),
                              React.createElement("option", { value: "fingerprint" }, "Hash Fingerprint Only"),
                              React.createElement("option", { value: "query" }, "Title Query Only")
                            )
                          ),
                          React.createElement(
                            "div",
                            { className: "d-flex align-items-center gap-2" },
                            React.createElement(
                              "button",
                              {
                                type: "button",
                                className: "btn btn-sm btn-primary font-weight-bold py-1 px-3",
                                disabled: isScrapingAll || localScenes.length === 0,
                                onClick: handleScrapeAll,
                                title: "Scrape all scenes in parallel using hashes, stash-ids, and titles",
                              },
                              renderIcon(IconGlobe, { size: 13, className: "mr-1" }),
                              isScrapingAll ? "Scraping in Parallel..." : `Scrape All (${localScenes.length})`
                            ),
                            React.createElement(
                              "button",
                              {
                                type: "button",
                                className: "btn btn-sm btn-outline-info font-weight-bold py-1 px-2",
                                disabled: isScrapingAll || localScenes.length === 0,
                                onClick: handleMassSearch,
                                title: "Mass search all un-scraped scenes by title",
                              },
                              renderIcon(IconSearch, { size: 13, className: "mr-1" }),
                              "Search by Title"
                            )
                          )
                        )
                      )
                    : React.createElement(
                        "div",
                        { className: "sfm-patterns-section mb-3" },
                        // Directory Path Clues
                        React.createElement(
                          "div",
                          { className: "sfm-path-clues-card p-2 px-3 mb-3 rounded bg-dark border border-secondary" },
                          React.createElement(
                            "div",
                            { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                            React.createElement(
                              "div",
                              { className: "d-flex align-items-center gap-2" },
                              React.createElement(
                                "span",
                                { className: "badge badge-info d-inline-flex align-items-center" },
                                renderIcon(IconFolder, { size: 11, className: "mr-1" }),
                                "Path Clues"
                              ),
                              React.createElement(
                                "span",
                                { className: "small text-muted" },
                                "Folder hierarchy context inferred from filesystem:"
                              )
                            ),
                            React.createElement(
                              "div",
                              { className: "btn-group btn-group-xs" },
                              React.createElement(
                                "button",
                                {
                                  type: "button",
                                  className: `btn btn-xs ${
                                    builderMode === "guided" ? "btn-info font-weight-bold" : "btn-outline-secondary"
                                  } py-0 px-2`,
                                  onClick: () => setBuilderMode("guided"),
                                },
                                "Guided"
                              ),
                              React.createElement(
                                "button",
                                {
                                  type: "button",
                                  className: `btn btn-xs ${
                                    builderMode === "raw" ? "btn-info font-weight-bold" : "btn-outline-secondary"
                                  } py-0 px-2`,
                                  onClick: () => setBuilderMode("raw"),
                                },
                                "Raw Regex"
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
                                  className:
                                    "sfm-path-clue-pill d-inline-flex align-items-center p-1 px-2 rounded bg-black border border-secondary",
                                },
                                React.createElement(
                                  "span",
                                  { className: "text-muted small mr-1" },
                                  idx === pathClues.length - 1 ? "Parent:" : "Folder:"
                                ),
                                React.createElement(
                                  "span",
                                  { className: "font-weight-bold text-light mr-2", style: { fontFamily: "monospace" } },
                                  clue.name
                                ),
                                React.createElement(
                                  "select",
                                  {
                                    className: "form-control form-control-sm border-0 py-0 px-1 font-weight-bold",
                                    style: {
                                      width: "auto",
                                      height: "22px",
                                      fontSize: "0.75rem",
                                      backgroundColor:
                                        clue.role === "studio"
                                          ? "#81a1c1"
                                          : clue.role === "performer"
                                          ? "#d08770"
                                          : clue.role === "tag"
                                          ? "#ebcb8b"
                                          : "#4c566a",
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
                                  React.createElement(
                                    "span",
                                    {
                                      className: "badge badge-success ml-2 py-0 px-1",
                                      title: "Matched verified Studio in local Stash database",
                                    },
                                    "✓ DB Studio"
                                  )
                              )
                            )
                          )
                        ),
                        builderMode === "guided"
                          ? React.createElement(
                              "div",
                              { className: "sfm-guided-card p-3 mb-3 rounded bg-dark border border-secondary" },
                              React.createElement(
                                "div",
                                { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                                React.createElement(
                                  "div",
                                  { className: "d-flex align-items-center gap-2" },
                                  React.createElement("span", { className: "badge badge-secondary" }, "Sample File"),
                                  React.createElement(
                                    "span",
                                    { className: "font-weight-bold text-light", style: { fontFamily: "monospace" } },
                                    sampleWithoutExt
                                  )
                                ),
                                localScenes.length > 1 &&
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
                                    React.createElement(
                                      "span",
                                      { className: "text-muted small" },
                                      `${sampleIndex + 1} of ${localScenes.length}`
                                    ),
                                    React.createElement(
                                      "button",
                                      {
                                        type: "button",
                                        className: "btn btn-xs btn-outline-secondary py-0 px-2",
                                        disabled: sampleIndex >= localScenes.length - 1,
                                        onClick: () => setSampleIndex(Math.min(localScenes.length - 1, sampleIndex + 1)),
                                      },
                                      "Next ▶"
                                    )
                                  )
                              ),
                              React.createElement(
                                "div",
                                { className: "mb-3" },
                                React.createElement(
                                  "div",
                                  { className: "d-flex justify-content-between align-items-center mb-1" },
                                  React.createElement(
                                    "label",
                                    { className: "small font-weight-bold text-muted mb-0" },
                                    "CUSTOMIZE & ADJUST FIELDS:"
                                  ),
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
                                      renderIcon(IconSparkles, { size: 12, className: "mr-1" }),
                                      "Auto-Detect"
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
                                        className: "btn btn-xs btn-outline-info py-0 px-2 ml-1",
                                        onClick: () => {
                                          const p = PRESETS.find((x) => x.label.includes("Studio - Code - Title"));
                                          if (p) {
                                            setPattern(p.pattern);
                                            if (p.caseInsensitive !== undefined) setCaseInsensitive(p.caseInsensitive);
                                          }
                                        },
                                        title: "Preset: Studio - Code - Title",
                                      },
                                      "Studio - Code - Title"
                                    )
                                  )
                                ),
                                React.createElement(
                                  "div",
                                  {
                                    className:
                                      "d-flex align-items-center flex-wrap gap-2 p-2 rounded bg-black border border-secondary",
                                  },
                                  chunks.map((chunk, idx) => {
                                    const fObj = FIELDS.find((f) => f.id === chunk.fieldId) || FIELDS[0];
                                    const isSplitting = activeSplitChunkId === chunk.id;
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
                                        React.createElement(
                                          "button",
                                          {
                                            type: "button",
                                            className: `btn btn-xs ${
                                              isSplitting ? "btn-warning" : "btn-outline-secondary"
                                            } py-0 px-1 mr-1`,
                                            onClick: () => {
                                              if (isSplitting) {
                                                setActiveSplitChunkId(null);
                                                setSplitAtInput("");
                                              } else {
                                                setActiveSplitChunkId(chunk.id);
                                                setSplitAtInput(String(Math.floor(chunk.text.length / 2)));
                                              }
                                            },
                                            title: "Break / Split this field into two separate fields",
                                          },
                                          renderIcon(IconScissors, { size: 11 })
                                        ),
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
                                      isSplitting &&
                                        React.createElement(
                                          "div",
                                          { className: "d-flex align-items-center gap-1 mt-1 pt-1 border-top border-secondary" },
                                          React.createElement("input", {
                                            type: "number",
                                            min: 1,
                                            max: Math.max(1, chunk.text.length - 1),
                                            className: "form-control form-control-sm bg-dark text-light border-secondary py-0 px-1",
                                            style: { width: "54px", height: "20px", fontSize: "0.72rem" },
                                            value: splitAtInput,
                                            onChange: (e) => setSplitAtInput(e.target.value),
                                          }),
                                          React.createElement(
                                            "button",
                                            {
                                              type: "button",
                                              className: "btn btn-xs btn-warning py-0 px-1",
                                              onClick: () => {
                                                const pos = parseInt(splitAtInput, 10);
                                                if (!isNaN(pos) && pos > 0 && pos < chunk.text.length) {
                                                  handleSplitChunk(
                                                    chunk.id,
                                                    chunk.text.slice(0, pos),
                                                    chunk.text.slice(pos),
                                                    chunk.fieldId,
                                                    "title"
                                                  );
                                                }
                                              },
                                            },
                                            "Split"
                                          )
                                        )
                                    );
                                  })
                                )
                              ),
                              React.createElement(
                                "div",
                                {
                                  className:
                                    "d-flex align-items-center flex-wrap gap-3 small text-muted pt-2 border-top border-secondary",
                                },
                                React.createElement(
                                  "div",
                                  { className: "d-flex align-items-center gap-1 cursor-pointer" },
                                  React.createElement("input", {
                                    type: "checkbox",
                                    id: "sfm-clean-spaces",
                                    checked: cleanSpaces,
                                    onChange: (e) => setCleanSpaces(e.target.checked),
                                  }),
                                  React.createElement(
                                    "label",
                                    { htmlFor: "sfm-clean-spaces", className: "mb-0 ml-1 text-light cursor-pointer" },
                                    "Replace _ and . with spaces"
                                  )
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
                                  React.createElement(
                                    "label",
                                    { htmlFor: "sfm-clean-titlecase", className: "mb-0 ml-1 text-light cursor-pointer" },
                                    "Title Case"
                                  )
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
                                  React.createElement(
                                    "label",
                                    { htmlFor: "sfm-clean-normdate", className: "mb-0 ml-1 text-light cursor-pointer" },
                                    "Normalize Date (YYYY-MM-DD)"
                                  )
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
                                  PRESETS.map((p) =>
                                    React.createElement("option", { key: p.label, value: p.pattern }, p.label)
                                  )
                                )
                              )
                            ),
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
                              React.createElement(
                                "label",
                                { htmlFor: "sfm-case-sens", className: "mb-0 cursor-pointer" },
                                "Case insensitive (?i)"
                              )
                            )
                          ),
                          React.createElement("input", {
                            type: "text",
                            className: "form-control font-weight-bold bg-dark text-info border-secondary sfm-regex-input",
                            value: pattern,
                            readOnly: builderMode === "guided",
                            onChange: (e) => setPattern(e.target.value),
                            style: { fontFamily: "monospace", fontSize: "0.9rem" },
                          }),
                          parsedResults.error &&
                            React.createElement(
                              "div",
                              { className: "text-danger small mt-1" },
                              `Regex error: ${parsedResults.error}`
                            )
                        )
                      ),
                  // Progress Bar (during scraping or updates)
                  (isScrapingAll || scrapeProgress.total > 0 || progressText) &&
                    React.createElement(
                      "div",
                      {
                        className:
                          "alert alert-info py-2 px-3 small mb-3 d-flex align-items-center justify-content-between flex-wrap gap-2",
                      },
                      React.createElement("span", { className: "font-weight-bold" }, scrapeProgress.text || progressText),
                      scrapeProgress.total > 0 &&
                        React.createElement(
                          "span",
                          { className: "badge badge-primary py-1 px-2" },
                          `${Math.round((scrapeProgress.current / scrapeProgress.total) * 100)}%`
                        )
                    ),
                  // Attribute Filter Bar (Organized, Missing Fields, Quick Search, Match Status)
                  renderAttributeFilterBar(true),
                  // Selection Bar
                  React.createElement(
                    "div",
                    { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                    React.createElement(
                      "span",
                      { className: "small text-muted" },
                      "Click any column header to sort ascending/descending."
                    ),
                    React.createElement(
                      "div",
                      { className: "d-flex align-items-center gap-2 flex-wrap" },
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-xs btn-outline-secondary py-1 px-2 text-light sfm-layout-template-btn",
                          style: { borderColor: "#475569", background: "rgba(255, 255, 255, 0.05)" },
                          onClick: () => setShowLayoutModal(true),
                          title: "Switch layout templates & customize column widths",
                        },
                        renderIcon(IconColumns, { size: 11, className: "mr-1 text-info" }),
                        "Layout & Widths"
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "btn btn-xs btn-outline-info py-1 px-2",
                          onClick: handleSelectAllMatched,
                        },
                        matchedCount > 0 &&
                          attributeFilteredItems
                            .filter(isItemMatched)
                            .every((i) => selectedSceneIds.has(String(i.scene.id)))
                          ? "Deselect All Matched"
                          : "Select All Matched"
                      ),
                      selectedSceneIds.size > 0 &&
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "btn btn-xs sfm-action-btn-clear py-1 px-2 sfm-btn-batch-clear",
                            onClick: handleClearSelectedScenes,
                            title: `Clear all metadata fields from ${selectedSceneIds.size} selected scene(s)`,
                          },
                          renderIcon(IconTrash, { size: 11, className: "mr-1" }),
                          `Clear Fields (${selectedSceneIds.size})`
                        ),
                      React.createElement(
                        "span",
                        {
                          className: "badge badge-info py-1 px-2 font-weight-bold",
                          style: { background: "var(--sfm-accent, #00bdc4)", color: "#0f172a", fontSize: "0.74rem" },
                        },
                        `${selectedSceneIds.size} of ${localScenes.length} scenes selected`
                      )
                    ),
                    // Unified Live Preview Table
                    React.createElement(
                      "div",
                      { className: "sfm-parser-table-wrap mb-3", style: { overflowX: "auto" } },
                    React.createElement(
                      "table",
                      { className: `sfm-parser-table table table-dark table-sm table-striped ${is2Tier ? "sfm-table-2tier" : "sfm-table-1tier"}` },
                      React.createElement(
                        "thead",
                        null,
                        React.createElement(
                          "tr",
                          null,
                          ...(is2Tier
                            ? [
                                React.createElement(
                                  "th",
                                  { key: "th-cb", className: "sfm-full-th", style: { width: `${colWidths.checkbox || 36}px`, textAlign: "center" } },
                                  React.createElement("input", {
                                    type: "checkbox",
                                    checked: allFilteredSelected,
                                    onChange: () => {
                                      if (allFilteredSelected) {
                                        setSelectedSceneIds((prev) => {
                                          const next = new Set(prev);
                                          filteredItems.forEach((it) => next.delete(String(it.scene.id)));
                                          return next;
                                        });
                                      } else {
                                        setSelectedSceneIds((prev) => {
                                          const next = new Set(prev);
                                          filteredItems.forEach((it) => next.add(String(it.scene.id)));
                                          return next;
                                        });
                                      }
                                    },
                                  })
                                ),
                                React.createElement(
                                  "th",
                                  { key: "th-cover", className: "sfm-full-th", style: { width: `${colWidths.cover || 56}px`, textAlign: "center" } },
                                  "Cover"
                                ),
                                React.createElement(
                                  "th",
                                  {
                                    key: "th-title-filename",
                                    className: "sfm-split-th",
                                    style: { width: `${colWidths.title_filename || 240}px`, maxWidth: `${colWidths.title_filename || 240}px` },
                                  },
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-top ${tableSortKey === "title" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "title",
                                      "data-sort-dir": tableSortKey === "title" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("title"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("title");
                                        }
                                      },
                                      title: "Sort by Title",
                                    },
                                    "Title",
                                    tableSortKey === "title" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  ),
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-bottom ${tableSortKey === "filename" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "filename",
                                      "data-sort-dir": tableSortKey === "filename" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("filename"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("filename");
                                        }
                                      },
                                      title: "Sort by Filename",
                                    },
                                    "Filename",
                                    tableSortKey === "filename" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  )
                                ),
                                React.createElement(
                                  "th",
                                  {
                                    key: "th-studio-performers",
                                    className: "sfm-split-th",
                                    style: { width: `${colWidths.studio_performers || 165}px`, maxWidth: `${colWidths.studio_performers || 165}px` },
                                  },
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-top ${tableSortKey === "studio" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "studio",
                                      "data-sort-dir": tableSortKey === "studio" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("studio"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("studio");
                                        }
                                      },
                                      title: "Sort by Studio",
                                    },
                                    "Studio",
                                    tableSortKey === "studio" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  ),
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-bottom ${tableSortKey === "performers" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "performers",
                                      "data-sort-dir": tableSortKey === "performers" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("performers"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("performers");
                                        }
                                      },
                                      title: "Sort by Performers",
                                    },
                                    "Performers",
                                    tableSortKey === "performers" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  )
                                ),
                                React.createElement(
                                  "th",
                                  {
                                    key: "th-date-code",
                                    className: "sfm-split-th",
                                    style: { width: `${colWidths.date_code || 110}px`, maxWidth: `${colWidths.date_code || 110}px` },
                                  },
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-top ${tableSortKey === "date" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "date",
                                      "data-sort-dir": tableSortKey === "date" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("date"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("date");
                                        }
                                      },
                                      title: "Sort by Date",
                                    },
                                    "Date",
                                    tableSortKey === "date" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  ),
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-bottom ${tableSortKey === "code" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "code",
                                      "data-sort-dir": tableSortKey === "code" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("code"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("code");
                                        }
                                      },
                                      title: "Sort by Code",
                                    },
                                    "Code",
                                    tableSortKey === "code" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  )
                                ),
                                React.createElement(
                                  "th",
                                  {
                                    key: "th-organized-status",
                                    className: "sfm-split-th",
                                    style: { width: `${colWidths.organized_status || 105}px`, maxWidth: `${colWidths.organized_status || 105}px` },
                                  },
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-top ${tableSortKey === "organized" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "organized",
                                      "data-sort-dir": tableSortKey === "organized" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("organized"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("organized");
                                        }
                                      },
                                      title: "Sort by Organized",
                                    },
                                    "Organized",
                                    tableSortKey === "organized" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  ),
                                  React.createElement(
                                    "div",
                                    {
                                      className: `sfm-subth sfm-subth-bottom ${tableSortKey === "status" ? "sfm-sort-active text-info" : ""}`,
                                      role: "button",
                                      tabIndex: 0,
                                      "data-sort-key": "status",
                                      "data-sort-dir": tableSortKey === "status" ? tableSortDir : undefined,
                                      onClick: () => handleHeaderSort("status"),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort("status");
                                        }
                                      },
                                      title: "Sort by Status",
                                    },
                                    "Status",
                                    tableSortKey === "status" && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, tableSortDir === "asc" ? "▲" : "▼")
                                  )
                                ),
                                React.createElement(
                                  "th",
                                  {
                                    key: "th-actions",
                                    className: "sfm-full-th",
                                    style: { width: `${colWidths.actions || 140}px`, textAlign: "center" },
                                  },
                                  "Actions"
                                ),
                              ]
                            : [
                                React.createElement(
                                  "th",
                                  { key: "th-cb", style: { width: `${colWidths.checkbox || 34}px`, textAlign: "center" } },
                                  React.createElement("input", {
                                    type: "checkbox",
                                    checked: allFilteredSelected,
                                    onChange: () => {
                                      if (allFilteredSelected) {
                                        setSelectedSceneIds((prev) => {
                                          const next = new Set(prev);
                                          filteredItems.forEach((it) => next.delete(String(it.scene.id)));
                                          return next;
                                        });
                                      } else {
                                        setSelectedSceneIds((prev) => {
                                          const next = new Set(prev);
                                          filteredItems.forEach((it) => next.add(String(it.scene.id)));
                                          return next;
                                        });
                                      }
                                    },
                                  })
                                ),
                                React.createElement("th", { key: "th-cover", style: { width: `${colWidths.cover || 48}px`, textAlign: "center" } }, "Cover"),
                                ...TABLE_SORTABLE_COLUMNS.map((col) => {
                                  const isActive = tableSortKey === col.key;
                                  const arrow = isActive ? (tableSortDir === "asc" ? " ▲" : " ▼") : "";
                                  const dynamicWidth = colWidths[col.key] ? `${colWidths[col.key]}px` : undefined;
                                  return React.createElement(
                                    "th",
                                    {
                                      key: col.key,
                                      className: `sfm-sortable-th ${isActive ? "sfm-sort-active text-info" : ""}`.trim(),
                                      "data-sort-key": col.key,
                                      "data-sort-dir": isActive ? tableSortDir : undefined,
                                      role: "button",
                                      tabIndex: 0,
                                      style: {
                                        ...col.style,
                                        width: dynamicWidth || col.style.width,
                                        maxWidth: dynamicWidth || col.style.maxWidth,
                                        textAlign: "center",
                                        cursor: "pointer",
                                        userSelect: "none",
                                      },
                                      title: `Sort by ${col.label}`,
                                      onClick: () => handleHeaderSort(col.key),
                                      onKeyDown: (e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault();
                                          handleHeaderSort(col.key);
                                        }
                                      },
                                    },
                                    React.createElement(
                                      "div",
                                      { className: "d-flex align-items-center justify-content-center" },
                                      col.label,
                                      arrow && React.createElement("span", { className: "sfm-sort-indicator ml-1" }, arrow)
                                    )
                                  );
                                }),
                                React.createElement(
                                  "th",
                                  { key: "th-actions", style: { width: `${colWidths.actions || 130}px`, textAlign: "center" } },
                                  "Actions"
                                ),
                              ])
                        )
                      ),
                      React.createElement(
                        "tbody",
                        null,
                        filteredItems.length === 0
                          ? null
                          : filteredItems.map((item) => {
                              const sId = String(item.scene.id);
                              const isSelected = selectedSceneIds.has(sId);
                              const cloud = cloudMatches[sId];
                              const sState = scrapeStates[sId] || { status: "idle" };

                              const displayTitle =
                                cloud?.title ||
                                (activeTab === "pattern" ? cleanExtracted("title", item.groups.title) || item.scene.title : item.scene.title || cleanExtracted("title", item.groups.title)) ||
                                "—";
                              const displayDate =
                                cloud?.date ||
                                (activeTab === "pattern" ? cleanExtracted("date", item.groups.date) || item.scene.date : item.scene.date || cleanExtracted("date", item.groups.date)) ||
                                "—";
                              const displayStudio =
                                cloud?.studio?.name ||
                                (activeTab === "pattern"
                                  ? cleanExtracted("studio", item.groups.studio) || activeStudioClue || item.scene.studio?.name
                                  : item.scene.studio?.name || cleanExtracted("studio", item.groups.studio) || activeStudioClue) ||
                                "—";
                              const displayCode =
                                cloud?.code ||
                                (activeTab === "pattern" ? (item.groups.code || "").trim() || item.scene.code : item.scene.code || (item.groups.code || "").trim()) ||
                                "—";
                              const displayPerformers = cloud?.performers
                                ? cloud.performers.map((p) => p.name).join(", ")
                                : (activeTab === "pattern"
                                    ? cleanExtracted("performers", item.groups.performers) || (item.scene.performers || []).map((p) => p.name).join(", ")
                                    : (item.scene.performers || []).map((p) => p.name).join(", ") || cleanExtracted("performers", item.groups.performers)) ||
                                  activePerformerClue ||
                                  "—";

                              const isFromPathStudio = !cloud && !item.groups.studio && activeStudioClue;
                              const posterUrl = item.scene.paths?.screenshot || `/scene/${sId}/screenshot`;
                              const thumbUrl = cloud?.image || posterUrl;
                              const isInlineSearchOpen = inlineSearchRowId === sId;
                              const isInlineEditOpen = inlineEditRowId === sId;
                              const isOrganizedSaving = organizedSavingIds.has(sId);
                              const orgError = organizedErrors[sId];

                              const isExpanded =
                                expandedRowIds.has(sId) || (!!cloud && sState.status !== "skipped");

                              const existingRatingNum =
                                item.scene.rating100 !== null && item.scene.rating100 !== undefined
                                  ? Number(item.scene.rating100)
                                  : null;
                              const standardRatings = new Set([100, 80, 60, 40, 20, 0]);
                              const hasCustomRating =
                                existingRatingNum !== null &&
                                !isNaN(existingRatingNum) &&
                                !standardRatings.has(existingRatingNum);

                              return React.createElement(
                                React.Fragment,
                                { key: sId },
                                React.createElement(
                                  "tr",
                                  {
                                    key: `row-${sId}`,
                                    className: cloud ? "sfm-matched-row" : "",
                                    style: { cursor: "pointer", opacity: isSelected ? 1 : 0.7 },
                                    onClick: () => handleToggleSelectScene(sId),
                                  },
                                  ...(is2Tier
                                    ? [
                                        React.createElement(
                                          "td",
                                          { key: "td-cb", className: "sfm-full-cell", style: { width: `${colWidths.checkbox || 36}px`, textAlign: "center" } },
                                          React.createElement("input", {
                                            type: "checkbox",
                                            checked: isSelected,
                                            onChange: () => handleToggleSelectScene(sId),
                                            onClick: (e) => e.stopPropagation(),
                                          })
                                        ),
                                        React.createElement(
                                          "td",
                                          { key: "td-cover", className: "sfm-full-cell", style: { width: `${colWidths.cover || 56}px`, textAlign: "center" } },
                                          React.createElement("img", {
                                            src: thumbUrl,
                                            className: `sfm-scrape-thumb ${cloud ? "sfm-scrape-thumb-matched" : ""}`,
                                            alt: "Thumb",
                                            loading: "lazy",
                                            onError: (e) => {
                                              e.target.src = posterUrl;
                                            },
                                          })
                                        ),
                                        // Split 1: Title / Filename
                                        React.createElement(
                                          "td",
                                          {
                                            key: "td-title-filename",
                                            className: "sfm-split-cell",
                                            style: { width: `${colWidths.title_filename || 240}px`, maxWidth: `${colWidths.title_filename || 240}px` },
                                          },
                                          React.createElement(
                                            "div",
                                            {
                                              className: `sfm-subcell sfm-subcell-top ${cloud ? "text-success font-weight-bold" : "text-info font-weight-bold"}`,
                                              title: displayTitle,
                                            },
                                            cloud &&
                                              React.createElement(
                                                "span",
                                                { className: "badge badge-success mr-1 py-0 px-1", style: { fontSize: "0.68rem" } },
                                                "✓"
                                              ),
                                            displayTitle
                                          ),
                                          React.createElement(
                                            "div",
                                            {
                                              className: "sfm-subcell sfm-subcell-bottom text-muted",
                                              title: item.rawBasename,
                                            },
                                            item.rawBasename
                                          )
                                        ),
                                        // Split 2: Studio / Performers
                                        React.createElement(
                                          "td",
                                          {
                                            key: "td-studio-performers",
                                            className: "sfm-split-cell",
                                            style: { width: `${colWidths.studio_performers || 165}px`, maxWidth: `${colWidths.studio_performers || 165}px` },
                                          },
                                          React.createElement(
                                            "div",
                                            { className: "sfm-subcell sfm-subcell-top", title: displayStudio },
                                            displayStudio !== "—"
                                              ? React.createElement(
                                                  "span",
                                                  {
                                                    className: cloud?.studio?.name
                                                      ? "badge badge-secondary py-0 px-1 font-weight-bold"
                                                      : "",
                                                  },
                                                  displayStudio,
                                                  isFromPathStudio &&
                                                    React.createElement(
                                                      "span",
                                                      {
                                                        className: "badge badge-dark text-info ml-1 py-0",
                                                        title: "Resolved from Directory Path Clue",
                                                      },
                                                      "Path"
                                                    )
                                                )
                                              : "—"
                                          ),
                                          React.createElement(
                                            "div",
                                            {
                                              className: "sfm-subcell sfm-subcell-bottom text-muted",
                                              title: displayPerformers,
                                            },
                                            displayPerformers
                                          )
                                        ),
                                        // Split 3: Date / Code
                                        React.createElement(
                                          "td",
                                          {
                                            key: "td-date-code",
                                            className: "sfm-split-cell",
                                            style: { width: `${colWidths.date_code || 110}px`, maxWidth: `${colWidths.date_code || 110}px` },
                                          },
                                          React.createElement(
                                            "div",
                                            { className: "sfm-subcell sfm-subcell-top", title: displayDate },
                                            displayDate
                                          ),
                                          React.createElement(
                                            "div",
                                            {
                                              className: "sfm-subcell sfm-subcell-bottom sfm-code-cell",
                                              style: { fontFamily: "monospace", fontSize: "0.78rem" },
                                              title: displayCode,
                                            },
                                            displayCode !== "—"
                                              ? React.createElement(
                                                  "span",
                                                  { className: "badge badge-dark text-warning py-0 px-1" },
                                                  displayCode
                                                )
                                              : "—"
                                          )
                                        ),
                                        // Split 4: Organized / Status
                                        React.createElement(
                                          "td",
                                          {
                                            key: "td-organized-status",
                                            className: "sfm-split-cell",
                                            style: { width: `${colWidths.organized_status || 105}px`, maxWidth: `${colWidths.organized_status || 105}px` },
                                          },
                                          React.createElement(
                                            "div",
                                            {
                                              className: "sfm-subcell sfm-subcell-top d-flex justify-content-center align-items-center",
                                              onClick: (e) => e.stopPropagation(),
                                              title: orgError || (item.scene.organized ? "Organized" : "Unorganized"),
                                            },
                                            React.createElement("input", {
                                              type: "checkbox",
                                              className: "sfm-organized-checkbox",
                                              checked: Boolean(item.scene.organized),
                                              disabled: isOrganizedSaving,
                                              onChange: (e) => handleToggleRowOrganized(item.scene, e),
                                              onClick: (e) => e.stopPropagation(),
                                              "aria-label": `Organized for ${displayTitle}`,
                                            }),
                                            orgError &&
                                              React.createElement(
                                                "span",
                                                { className: "text-danger ml-1", style: { fontSize: "0.66rem" } },
                                                "Err"
                                              )
                                          ),
                                          React.createElement(
                                            "div",
                                            {
                                              className: "sfm-subcell sfm-subcell-bottom d-flex justify-content-center align-items-center",
                                              title: sState.error || sState.status,
                                            },
                                            sState.status === "applying"
                                              ? React.createElement("span", { className: "badge badge-info py-0 px-1" }, "Applying...")
                                              : sState.status === "done"
                                              ? React.createElement("span", { className: "badge badge-success py-0 px-1" }, "✓ Applied")
                                              : sState.status === "skipped"
                                              ? React.createElement("span", { className: "badge badge-warning py-0 px-1" }, "Skipped")
                                              : sState.status === "scraping"
                                              ? React.createElement("span", { className: "badge badge-info py-0 px-1" }, "Scraping...")
                                              : cloud
                                              ? React.createElement(
                                                  "span",
                                                  { className: "badge badge-success font-weight-bold py-0 px-1" },
                                                  "Matched"
                                                )
                                              : item.matched
                                              ? React.createElement("span", { className: "badge badge-success py-0 px-1" }, "Matched")
                                              : sState.status === "nomatch"
                                              ? React.createElement("span", { className: "badge badge-warning py-0 px-1" }, "No Result")
                                              : sState.status === "error"
                                              ? React.createElement(
                                                  "span",
                                                  { className: "badge badge-danger py-0 px-1", title: sState.error || "Error" },
                                                  "Error"
                                                )
                                              : React.createElement("span", { className: "badge badge-secondary py-0 px-1" }, "Idle")
                                          )
                                        ),
                                        renderActionsCell(item, sId, sState, cloud, isExpanded, isInlineSearchOpen, isInlineEditOpen),
                                      ]
                                    : [
                                        React.createElement(
                                          "td",
                                          { key: "td-cb", style: { textAlign: "center" } },
                                          React.createElement("input", {
                                            type: "checkbox",
                                            checked: isSelected,
                                            onChange: () => handleToggleSelectScene(sId),
                                            onClick: (e) => e.stopPropagation(),
                                          })
                                        ),
                                        React.createElement(
                                          "td",
                                          { key: "td-cover", style: { textAlign: "center" } },
                                          React.createElement("img", {
                                            src: thumbUrl,
                                            className: `sfm-scrape-thumb ${cloud ? "sfm-scrape-thumb-matched" : ""}`,
                                            alt: "Thumb",
                                            loading: "lazy",
                                            onError: (e) => {
                                              e.target.src = posterUrl;
                                            },
                                          })
                                        ),
                                        React.createElement(
                                          "td",
                                          { key: "td-filename", className: "text-truncate", style: { width: `${colWidths.filename || 120}px`, maxWidth: `${colWidths.filename || 120}px` }, title: item.rawBasename },
                                          item.rawBasename
                                        ),
                                        React.createElement(
                                          "td",
                                          {
                                            key: "td-title",
                                            className: `text-truncate ${
                                              cloud ? "text-success font-weight-bold" : "text-info font-weight-bold"
                                            }`,
                                            style: { width: `${colWidths.title || 150}px`, maxWidth: `${colWidths.title || 150}px` },
                                            title: displayTitle,
                                          },
                                          cloud &&
                                            React.createElement(
                                              "span",
                                              { className: "badge badge-success mr-1 py-0 px-1", style: { fontSize: "0.68rem" } },
                                              "✓"
                                            ),
                                          displayTitle
                                        ),
                                        React.createElement("td", { key: "td-date", style: { width: `${colWidths.date || 80}px`, maxWidth: `${colWidths.date || 80}px`, textAlign: "center", whiteSpace: "nowrap" } }, displayDate),
                                        React.createElement(
                                          "td",
                                          { key: "td-studio", className: "text-truncate", style: { width: `${colWidths.studio || 95}px`, maxWidth: `${colWidths.studio || 95}px` }, title: displayStudio },
                                          displayStudio !== "—"
                                            ? React.createElement(
                                                "span",
                                                {
                                                  className: cloud?.studio?.name
                                                    ? "badge badge-secondary py-1 px-2 font-weight-bold"
                                                    : "",
                                                },
                                                displayStudio,
                                                isFromPathStudio &&
                                                  React.createElement(
                                                    "span",
                                                    {
                                                      className: "badge badge-dark text-info ml-1 py-0",
                                                      title: "Resolved from Directory Path Clue",
                                                    },
                                                    "Path"
                                                  )
                                              )
                                            : "—"
                                        ),
                                        // Code Column (R2)
                                        React.createElement(
                                          "td",
                                          {
                                            key: "td-code",
                                            className: "sfm-code-cell text-truncate",
                                            style: { width: `${colWidths.code || 70}px`, maxWidth: `${colWidths.code || 70}px`, textAlign: "center", fontFamily: "monospace", fontSize: "0.76rem" },
                                            title: displayCode,
                                          },
                                          displayCode !== "—"
                                            ? React.createElement(
                                                "span",
                                                { className: "badge badge-dark text-warning py-0 px-1" },
                                                displayCode
                                              )
                                            : "—"
                                        ),
                                        React.createElement(
                                          "td",
                                          { key: "td-performers", className: "text-truncate", style: { width: `${colWidths.performers || 105}px`, maxWidth: `${colWidths.performers || 105}px` }, title: displayPerformers },
                                          displayPerformers
                                        ),
                                        // Organized Checkbox Column (R2)
                                        React.createElement(
                                          "td",
                                          {
                                            key: "td-organized",
                                            style: { width: `${colWidths.organized || 60}px`, maxWidth: `${colWidths.organized || 60}px`, textAlign: "center" },
                                            onClick: (e) => e.stopPropagation(),
                                            title: orgError || (item.scene.organized ? "Organized" : "Unorganized"),
                                          },
                                          React.createElement("input", {
                                            type: "checkbox",
                                            className: "sfm-organized-checkbox",
                                            checked: Boolean(item.scene.organized),
                                            disabled: isOrganizedSaving,
                                            onChange: (e) => handleToggleRowOrganized(item.scene, e),
                                            onClick: (e) => e.stopPropagation(),
                                            "aria-label": `Organized for ${displayTitle}`,
                                          }),
                                          orgError &&
                                            React.createElement(
                                              "div",
                                              { className: "text-danger", style: { fontSize: "0.66rem" } },
                                              "Err"
                                            )
                                        ),
                                        React.createElement(
                                          "td",
                                          { key: "td-source", style: { width: `${colWidths.source || 75}px`, maxWidth: `${colWidths.source || 75}px`, textAlign: "center" } },
                                          sState.sourceName
                                            ? React.createElement(
                                                "span",
                                                { className: "badge badge-primary py-0 px-1", style: { fontSize: "0.72rem" } },
                                                sState.sourceName
                                              )
                                            : cloud
                                            ? React.createElement("span", { className: "badge badge-primary py-0 px-1" }, "Scraped")
                                            : item.matched
                                            ? React.createElement(
                                                "span",
                                                { className: "badge badge-dark text-muted py-0 px-1" },
                                                "Pattern"
                                              )
                                            : "—"
                                        ),
                                        React.createElement(
                                          "td",
                                          { key: "td-status", style: { width: `${colWidths.status || 70}px`, maxWidth: `${colWidths.status || 70}px`, textAlign: "center" } },
                                          sState.status === "applying"
                                            ? React.createElement("span", { className: "badge badge-info" }, "Applying...")
                                            : sState.status === "done"
                                            ? React.createElement("span", { className: "badge badge-success" }, "✓ Applied")
                                            : sState.status === "skipped"
                                            ? React.createElement("span", { className: "badge badge-warning" }, "Skipped")
                                            : sState.status === "scraping"
                                            ? React.createElement("span", { className: "badge badge-info" }, "Scraping...")
                                            : cloud
                                            ? React.createElement(
                                                "span",
                                                { className: "badge badge-success font-weight-bold" },
                                                "Matched"
                                              )
                                            : item.matched
                                            ? React.createElement("span", { className: "badge badge-success" }, "Matched")
                                            : sState.status === "nomatch"
                                            ? React.createElement("span", { className: "badge badge-warning" }, "No Result")
                                            : sState.status === "error"
                                            ? React.createElement(
                                                "span",
                                                { className: "badge badge-danger", title: sState.error || "Error" },
                                                "Error"
                                              )
                                            : React.createElement("span", { className: "badge badge-secondary" }, "Idle")
                                        ),
                                        renderActionsCell(item, sId, sState, cloud, isExpanded, isInlineSearchOpen, isInlineEditOpen),
                                      ])
                                  ),
                                // Inline Row Metadata Editor (R2)
                                isInlineEditOpen &&
                                  React.createElement(
                                    "tr",
                                    { key: `edit-${sId}`, className: "bg-black sfm-inline-edit-row" },
                                    React.createElement(
                                      "td",
                                      { colSpan: is2Tier ? 7 : 12, className: "p-2 px-3" },
                                      React.createElement(
                                        "div",
                                        {
                                          className: "sfm-inline-edit-card sfm-inline-editor p-3 rounded border border-warning",
                                          style: { backgroundColor: "#141822" },
                                          onClick: (e) => e.stopPropagation(),
                                        },
                                        React.createElement(
                                          "div",
                                          { className: "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2" },
                                          React.createElement(
                                            "div",
                                            { className: "font-weight-bold text-warning small d-flex align-items-center" },
                                            renderIcon(IconEdit, { size: 12, className: "mr-1" }),
                                            `Inline Edit: ${item.rawBasename || item.scene.title || sId}`
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "d-flex align-items-center gap-2" },
                                            cloud &&
                                              React.createElement(
                                                "button",
                                                {
                                                  type: "button",
                                                  className: "btn btn-xs btn-outline-info py-0 px-2",
                                                  onClick: () => handleFillInlineEditFromCloud(item.scene),
                                                },
                                                "Fill from Scrape"
                                              ),
                                            React.createElement(
                                              "button",
                                              {
                                                type: "button",
                                                className: "btn btn-xs btn-outline-secondary py-0 px-2",
                                                onClick: () => {
                                                  setInlineEditRowId(null);
                                                  setInlineEditError("");
                                                },
                                              },
                                              "Cancel"
                                            )
                                          )
                                        ),
                                        React.createElement(
                                          "div",
                                          { className: "row" },
                                          React.createElement(
                                            "div",
                                            { className: "col-md-4 form-group mb-2" },
                                            React.createElement("label", { className: "small text-muted mb-1" }, "Title"),
                                            React.createElement("input", {
                                              type: "text",
                                              name: "title",
                                              "data-field": "title",
                                              className: "form-control form-control-sm bg-dark text-light border-secondary",
                                              value: inlineEditForm.title,
                                              onChange: (e) =>
                                                setInlineEditForm((p) => ({ ...p, title: e.target.value })),
                                            })
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "col-md-3 form-group mb-2" },
                                            React.createElement("label", { className: "small text-muted mb-1" }, "Studio"),
                                            React.createElement("input", {
                                              type: "text",
                                              name: "studio",
                                              "data-field": "studio",
                                              className: "form-control form-control-sm bg-dark text-light border-secondary",
                                              value: inlineEditForm.studioName,
                                              onChange: (e) =>
                                                setInlineEditForm((p) => ({ ...p, studioName: e.target.value })),
                                            })
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "col-md-2 form-group mb-2" },
                                            React.createElement(
                                              "label",
                                              { className: "small text-muted mb-1" },
                                              "Date (YYYY-MM-DD)"
                                            ),
                                            React.createElement("input", {
                                              type: "text",
                                              name: "date",
                                              "data-field": "date",
                                              placeholder: "YYYY-MM-DD",
                                              className: "form-control form-control-sm bg-dark text-light border-secondary",
                                              value: inlineEditForm.date,
                                              onChange: (e) =>
                                                setInlineEditForm((p) => ({ ...p, date: e.target.value })),
                                            })
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "col-md-2 form-group mb-2" },
                                            React.createElement("label", { className: "small text-muted mb-1" }, "Code"),
                                            React.createElement("input", {
                                              type: "text",
                                              name: "code",
                                              "data-field": "code",
                                              className: "form-control form-control-sm bg-dark text-light border-secondary",
                                              value: inlineEditForm.code,
                                              onChange: (e) =>
                                                setInlineEditForm((p) => ({ ...p, code: e.target.value })),
                                            })
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "col-md-1 form-group mb-2 d-flex flex-column justify-content-end" },
                                            React.createElement(
                                              "label",
                                              { className: "small text-muted mb-1 d-flex align-items-center gap-1 cursor-pointer" },
                                              React.createElement("input", {
                                                type: "checkbox",
                                                name: "organized",
                                                "data-field": "organized",
                                                checked: Boolean(inlineEditForm.organized),
                                                onChange: (e) =>
                                                  setInlineEditForm((p) => ({ ...p, organized: e.target.checked })),
                                              }),
                                              React.createElement("span", { className: "ml-1 text-light" }, "Organized")
                                            )
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "col-md-5 form-group mb-2" },
                                            React.createElement(
                                              "label",
                                              { className: "small text-muted mb-1" },
                                              "Performers (comma-separated)"
                                            ),
                                            React.createElement("input", {
                                              type: "text",
                                              name: "performers",
                                              "data-field": "performers",
                                              className: "form-control form-control-sm bg-dark text-light border-secondary",
                                              placeholder: "Performer A, Performer B",
                                              value: inlineEditForm.performersText,
                                              onChange: (e) =>
                                                setInlineEditForm((p) => ({ ...p, performersText: e.target.value })),
                                            })
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "col-md-4 form-group mb-2" },
                                            React.createElement(
                                              "label",
                                              { className: "small text-muted mb-1" },
                                              "Tags (comma-separated)"
                                            ),
                                            React.createElement("input", {
                                              type: "text",
                                              name: "tags",
                                              "data-field": "tags",
                                              className: "form-control form-control-sm bg-dark text-light border-secondary",
                                              placeholder: "Tag 1, Tag 2",
                                              value: inlineEditForm.tagsText,
                                              onChange: (e) =>
                                                setInlineEditForm((p) => ({ ...p, tagsText: e.target.value })),
                                            })
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "col-md-3 form-group mb-2" },
                                            React.createElement("label", { className: "small text-muted mb-1" }, "Rating"),
                                            React.createElement(
                                              "select",
                                              {
                                                name: "rating100",
                                                "data-field": "rating",
                                                className: "form-control form-control-sm bg-dark text-light border-secondary",
                                                value: inlineEditForm.rating100,
                                                onChange: (e) =>
                                                  setInlineEditForm((p) => ({ ...p, rating100: e.target.value })),
                                              },
                                              React.createElement("option", { value: "" }, "Unrated"),
                                              hasCustomRating &&
                                                React.createElement(
                                                  "option",
                                                  { value: String(existingRatingNum) },
                                                  `${existingRatingNum}%`
                                                ),
                                              React.createElement("option", { value: "100" }, "★★★★★ (100%)"),
                                              React.createElement("option", { value: "80" }, "★★★★☆ (80%)"),
                                              React.createElement("option", { value: "60" }, "★★★☆☆ (60%)"),
                                              React.createElement("option", { value: "40" }, "★★☆☆☆ (40%)"),
                                              React.createElement("option", { value: "20" }, "★☆☆☆☆ (20%)"),
                                              React.createElement("option", { value: "0" }, "0% (Clear)")
                                            )
                                          )
                                        ),
                                        inlineEditError &&
                                          React.createElement(
                                            "div",
                                            { className: "alert alert-danger py-1 px-2 small mb-2" },
                                            inlineEditError
                                          ),
                                        React.createElement(
                                          "div",
                                          { className: "d-flex justify-content-end gap-2 pt-1" },
                                          React.createElement(
                                            "button",
                                            {
                                              type: "button",
                                              className: "btn btn-xs btn-secondary py-1 px-2 mr-1",
                                              disabled: inlineEditSaving,
                                              onClick: () => {
                                                setInlineEditRowId(null);
                                                setInlineEditError("");
                                              },
                                            },
                                            "Cancel"
                                          ),
                                          React.createElement(
                                            "button",
                                            {
                                              type: "button",
                                              className: "btn btn-xs btn-success font-weight-bold py-1 px-3",
                                              disabled: inlineEditSaving,
                                              onClick: () => handleSaveInlineEdit(item.scene),
                                            },
                                            inlineEditSaving ? "Saving..." : "Save"
                                          )
                                        )
                                      )
                                    )
                                  ),
                                // Scraped Metadata Detailed Info Card
                                cloud &&
                                  isExpanded &&
                                  React.createElement(
                                    "tr",
                                    { key: `scraped-card-${sId}`, className: "bg-black" },
                                    React.createElement(
                                      "td",
                                      { colSpan: is2Tier ? 7 : 12, className: "p-0 border-0" },
                                      React.createElement(
                                        "div",
                                        {
                                          className: `sfm-scraped-detail-card p-3 rounded bg-dark border ${
                                            sState.status === "done"
                                              ? "border-success sfm-status-done"
                                              : sState.status === "skipped"
                                              ? "border-warning sfm-status-skipped"
                                              : "border-secondary"
                                          } mb-2 mx-2`,
                                          style: { backgroundColor: "#151922" },
                                        },
                                        React.createElement(
                                          "div",
                                          { className: "d-flex gap-3 flex-wrap flex-md-nowrap" },
                                          React.createElement(
                                            "div",
                                            { className: "d-flex flex-column align-items-center flex-shrink-0" },
                                            React.createElement("img", {
                                              src: cloud.image || posterUrl,
                                              className: "sfm-scraped-cover mb-1",
                                              alt: "Scraped Cover",
                                              loading: "lazy",
                                              onError: (e) => {
                                                e.target.src = posterUrl;
                                              },
                                            }),
                                            cloud.image &&
                                              React.createElement(
                                                "span",
                                                {
                                                  className: "badge badge-success py-0 px-1 mt-1",
                                                  style: { fontSize: "0.68rem" },
                                                },
                                                "New Cover Image"
                                              ),
                                            cloud.code &&
                                              React.createElement(
                                                "span",
                                                {
                                                  className: "badge badge-dark text-warning mt-1 py-0 px-1",
                                                  style: { fontSize: "0.72rem" },
                                                },
                                                `Code: ${cloud.code}`
                                              )
                                          ),
                                          React.createElement(
                                            "div",
                                            { className: "flex-grow-1 overflow-hidden" },
                                            React.createElement(
                                              "div",
                                              { className: "d-flex justify-content-between align-items-start gap-2 mb-1" },
                                              React.createElement(
                                                "h6",
                                                {
                                                  className: "mb-0 font-weight-bold text-info",
                                                  style: { fontSize: "1.05rem" },
                                                },
                                                cloud.title || displayTitle
                                              ),
                                              React.createElement(
                                                "div",
                                                { className: "d-flex align-items-center gap-1 flex-shrink-0" },
                                                sState.sourceName &&
                                                  React.createElement(
                                                    "span",
                                                    { className: "badge badge-primary py-1 px-2" },
                                                    sState.sourceName
                                                  ),
                                                sState.status === "done" &&
                                                  React.createElement(
                                                    "span",
                                                    { className: "badge badge-success py-1 px-2" },
                                                    "✓ Applied to Stash"
                                                  ),
                                                sState.status === "skipped" &&
                                                  React.createElement(
                                                    "span",
                                                    { className: "badge badge-warning py-1 px-2" },
                                                    "Skipped"
                                                  )
                                              )
                                            ),
                                            React.createElement(
                                              "div",
                                              { className: "d-flex align-items-center gap-3 mb-2 flex-wrap small" },
                                              displayStudio !== "—" &&
                                                React.createElement(
                                                  "div",
                                                  { className: "d-inline-flex align-items-center" },
                                                  React.createElement("strong", { className: "text-muted mr-1" }, "Studio:"),
                                                  React.createElement(
                                                    "span",
                                                    { className: "badge badge-secondary py-1 px-2 font-weight-bold" },
                                                    displayStudio
                                                  )
                                                ),
                                              displayDate !== "—" &&
                                                React.createElement(
                                                  "div",
                                                  { className: "d-inline-flex align-items-center" },
                                                  React.createElement("strong", { className: "text-muted mr-1" }, "Date:"),
                                                  React.createElement("span", { className: "text-light" }, displayDate)
                                                ),
                                              cloud.url &&
                                                React.createElement(
                                                  "a",
                                                  {
                                                    href: cloud.url,
                                                    target: "_blank",
                                                    rel: "noopener noreferrer",
                                                    className: "text-info small ml-auto text-truncate",
                                                    style: { maxWidth: "240px" },
                                                  },
                                                  "Scraped Source Page ↗"
                                                )
                                            ),
                                            cloud.performers?.length > 0 &&
                                              React.createElement(
                                                "div",
                                                { className: "d-flex align-items-center flex-wrap gap-1 mb-2" },
                                                React.createElement(
                                                  "span",
                                                  { className: "small text-muted mr-1 font-weight-bold" },
                                                  "Performers:"
                                                ),
                                                cloud.performers.map((p, pIdx) =>
                                                  React.createElement(
                                                    "span",
                                                    {
                                                      key: pIdx,
                                                      className: `badge ${
                                                        p.gender === "FEMALE"
                                                          ? "badge-info"
                                                          : p.gender === "MALE"
                                                          ? "badge-secondary"
                                                          : "badge-dark"
                                                      } py-1 px-2`,
                                                      style: { fontSize: "0.78rem" },
                                                    },
                                                    p.name,
                                                    p.disambiguation ? ` (${p.disambiguation})` : ""
                                                  )
                                                )
                                              ),
                                            cloud.tags?.length > 0 &&
                                              React.createElement(
                                                "div",
                                                { className: "d-flex align-items-center flex-wrap gap-1 mb-2" },
                                                React.createElement(
                                                  "span",
                                                  { className: "small text-muted mr-1 font-weight-bold" },
                                                  "Tags:"
                                                ),
                                                cloud.tags.map((t, tIdx) =>
                                                  React.createElement(
                                                    "span",
                                                    {
                                                      key: tIdx,
                                                      className: "badge badge-dark text-info py-0 px-2",
                                                      style: { border: "1px solid #434c5e", fontSize: "0.74rem" },
                                                    },
                                                    `#${t.name}`
                                                  )
                                                )
                                              ),
                                            cloud.details &&
                                              React.createElement(
                                                "div",
                                                {
                                                  className: "small text-muted font-italic p-2 rounded mb-2",
                                                  style: {
                                                    backgroundColor: "rgba(0,0,0,0.3)",
                                                    maxHeight: "65px",
                                                    overflowY: "auto",
                                                    borderLeft: "2px solid #88c0d0",
                                                  },
                                                },
                                                cloud.details
                                              ),
                                            React.createElement(
                                              "div",
                                              {
                                                className:
                                                  "d-flex align-items-center justify-content-between pt-2 border-top border-secondary flex-wrap gap-2",
                                              },
                                              React.createElement(
                                                "div",
                                                { className: "d-flex align-items-center gap-2" },
                                                React.createElement(
                                                  "button",
                                                  {
                                                    type: "button",
                                                    className: `btn btn-sm ${
                                                      sState.status === "done"
                                                        ? "btn-outline-success disabled"
                                                        : "btn-success font-weight-bold"
                                                    } py-1 px-3`,
                                                    disabled: sState.status === "applying" || sState.status === "done",
                                                    onClick: () => handleApplySingle(item.scene),
                                                    title: "Apply this scene's scraped metadata immediately to Stash",
                                                  },
                                                  sState.status === "applying"
                                                    ? "Applying..."
                                                    : sState.status === "done"
                                                    ? "✓ Applied"
                                                    : "Apply"
                                                ),
                                                React.createElement(
                                                  "button",
                                                  {
                                                    type: "button",
                                                    className: `btn btn-sm ${
                                                      sState.status === "skipped"
                                                        ? "btn-warning font-weight-bold"
                                                        : "btn-outline-warning"
                                                    } py-1 px-3`,
                                                    onClick: () => handleSkipSingle(sId),
                                                    title:
                                                      sState.status === "skipped"
                                                        ? "Unskip scene"
                                                        : "Skip this scene from updates",
                                                  },
                                                  sState.status === "skipped" ? "Unskip" : "Skip"
                                                ),
                                                React.createElement(
                                                  "button",
                                                  {
                                                    type: "button",
                                                    className: "btn btn-sm btn-outline-danger py-1 px-3",
                                                    onClick: () => handleClearSingle(sId),
                                                    title: "Clear scraped result and reset back to idle",
                                                  },
                                                  "Clear"
                                                )
                                              ),
                                              React.createElement(
                                                "button",
                                                {
                                                  type: "button",
                                                  className: "btn btn-xs btn-secondary text-light py-0 px-2",
                                                  onClick: () => handleToggleExpandRow(sId),
                                                },
                                                "▲ Collapse"
                                              )
                                            )
                                          )
                                        )
                                      )
                                    )
                                  ),
                                // Inline Search Expansion Row
                                isInlineSearchOpen &&
                                  React.createElement(
                                    "tr",
                                    { key: `search-${sId}`, className: "bg-black" },
                                    React.createElement(
                                      "td",
                                      { colSpan: is2Tier ? 7 : 12, className: "p-2 px-3" },
                                      React.createElement(
                                        "div",
                                        { className: "sfm-inline-search-card" },
                                        React.createElement(
                                          "div",
                                          {
                                            className:
                                              "d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2",
                                          },
                                          React.createElement(
                                            "div",
                                            { className: "d-flex align-items-center gap-2" },
                                            React.createElement(
                                              "span",
                                              { className: "font-weight-bold text-info small" },
                                              renderIcon(IconSearch, { size: 12, className: "mr-1" }),
                                              "Query Search:"
                                            ),
                                            React.createElement("input", {
                                              type: "text",
                                              className: "form-control form-control-sm bg-dark text-light border-secondary",
                                              style: { width: "320px", height: "26px", fontSize: "0.82rem" },
                                              value: inlineSearchQuery,
                                              onChange: (e) => setInlineSearchQuery(e.target.value),
                                              onKeyDown: (e) => e.key === "Enter" && handleExecuteInlineSearch(),
                                              placeholder: "Enter search title...",
                                            }),
                                            React.createElement(
                                              "select",
                                              {
                                                className:
                                                  "form-control form-control-sm bg-dark text-info border-secondary py-0",
                                                style: { width: "auto", height: "26px", fontSize: "0.8rem" },
                                                value: inlineSearchSource,
                                                onChange: (e) => setInlineSearchSource(e.target.value),
                                              },
                                              availableSources.map((s) =>
                                                React.createElement("option", { key: s.key, value: s.key }, s.label)
                                              )
                                            ),
                                            React.createElement(
                                              "button",
                                              {
                                                type: "button",
                                                className: "btn btn-xs btn-primary font-weight-bold py-1 px-3",
                                                disabled: inlineSearchLoading,
                                                onClick: handleExecuteInlineSearch,
                                              },
                                              inlineSearchLoading ? "Searching..." : "Search"
                                            )
                                          ),
                                          React.createElement(
                                            "button",
                                            {
                                              type: "button",
                                              className: "btn btn-xs btn-outline-secondary py-0 px-2",
                                              onClick: () => setInlineSearchRowId(null),
                                            },
                                            "Close"
                                          )
                                        ),
                                        inlineSearchResults.length > 0 &&
                                          React.createElement(
                                            "div",
                                            { className: "sfm-candidate-list mt-2" },
                                            React.createElement(
                                              "div",
                                              { className: "small font-weight-bold text-muted mb-1" },
                                              `Found ${inlineSearchResults.length} candidate results:`
                                            ),
                                            inlineSearchResults.map((cand, cIdx) =>
                                              React.createElement(
                                                "div",
                                                { key: cIdx, className: "sfm-candidate-item" },
                                                React.createElement(
                                                  "div",
                                                  { className: "d-flex align-items-center gap-2 text-truncate" },
                                                  cand.image &&
                                                    React.createElement("img", {
                                                      src: cand.image,
                                                      style: {
                                                        width: "42px",
                                                        height: "28px",
                                                        objectFit: "cover",
                                                        borderRadius: "3px",
                                                      },
                                                      alt: "",
                                                    }),
                                                  React.createElement(
                                                    "div",
                                                    null,
                                                    React.createElement(
                                                      "div",
                                                      {
                                                        className: "font-weight-bold text-info small text-truncate",
                                                        style: { maxWidth: "500px" },
                                                      },
                                                      cand.title || "Untitled"
                                                    ),
                                                    React.createElement(
                                                      "div",
                                                      { className: "small text-muted" },
                                                      cand.date &&
                                                        React.createElement("span", { className: "mr-2" }, cand.date),
                                                      cand.studio?.name &&
                                                        React.createElement(
                                                          "span",
                                                          { className: "badge badge-secondary mr-2" },
                                                          cand.studio.name
                                                        ),
                                                      cand.performers?.length > 0 &&
                                                        React.createElement(
                                                          "span",
                                                          null,
                                                          cand.performers.map((p) => p.name).join(", ")
                                                        )
                                                    )
                                                  )
                                                ),
                                                React.createElement(
                                                  "div",
                                                  { className: "d-flex align-items-center gap-1 ml-2" },
                                                  React.createElement(
                                                    "button",
                                                    {
                                                      type: "button",
                                                      className: "btn btn-xs btn-outline-info font-weight-bold py-1 px-2",
                                                      onClick: () => handleSelectCandidate(sId, cand, false),
                                                      title: "Select this candidate to inspect, edit, or apply below",
                                                    },
                                                    "Select"
                                                  ),
                                                  React.createElement(
                                                    "button",
                                                    {
                                                      type: "button",
                                                      className: "btn btn-xs btn-success font-weight-bold py-1 px-2",
                                                      onClick: () => handleSelectCandidate(sId, cand, true),
                                                      title: "Immediately apply this match to Stash",
                                                    },
                                                    "Apply Directly"
                                                  )
                                                )
                                              )
                                            )
                                          ),
                                        !inlineSearchLoading &&
                                          inlineSearchResults.length === 0 &&
                                          inlineSearchRowId === sId &&
                                          React.createElement(
                                            "div",
                                            { className: "small text-muted" },
                                            'No results yet. Enter a title and click "Search".'
                                          )
                                      )
                                    )
                                  )
                              );
                            })
                      )
                    )
                  )
                )
          ),
          // Footer
          activeTab === "rename"
            ? React.createElement(
                "div",
                { className: "sfm-modal-footer d-flex justify-content-between align-items-center flex-wrap gap-2" },
                React.createElement(
                  "div",
                  { className: "small text-muted" },
                  React.createElement(
                    "span",
                    { className: "font-weight-bold text-light mr-1" },
                    `Selected: ${selectedRenameIds.size} of ${localScenes.length} files`
                  ),
                  React.createElement(
                    "span",
                    null,
                    `(${renamePreviewItems.filter((i) => selectedRenameIds.has(String(i.scene.id)) && i.isChanged).length} changed)`
                  )
                ),
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center gap-2" },
                  React.createElement("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: onClose }, "Cancel"),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-primary btn-sm font-weight-bold",
                      disabled: isRenaming || selectedRenameIds.size === 0,
                      onClick: handleExecuteBulkRename,
                    },
                    isRenaming ? "Renaming Files..." : `Bulk Rename ${selectedRenameIds.size} Selected Files`
                  )
                )
              )
            : activeTab === "bulk_edit"
            ? React.createElement(
                "div",
                { className: "sfm-modal-footer d-flex justify-content-between align-items-center flex-wrap gap-2" },
                React.createElement(
                  "div",
                  { className: "small text-muted" },
                  `Target: ${bulkTargetScenes.length} scene(s)`
                ),
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center gap-2" },
                  React.createElement("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: onClose }, "Close")
                )
              )
            : React.createElement(
                "div",
                { className: "sfm-modal-footer d-flex justify-content-between align-items-center flex-wrap gap-2" },
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center flex-wrap gap-3 small text-muted" },
                  React.createElement("span", { className: "font-weight-bold text-light mr-2" }, "Fields to apply:"),
                  [
                    ["title", "Title"],
                    ["date", "Date"],
                    ["studio", "Studio"],
                    ["performers", "Performers"],
                    ["tags", "Tags"],
                    ["details", "Details"],
                    ["code", "Code"],
                    ["cover", "Cover Image"],
                  ].map(([key, label]) =>
                    React.createElement(
                      "div",
                      { key, className: "d-flex align-items-center mr-3 cursor-pointer" },
                      React.createElement("input", {
                        type: "checkbox",
                        id: `sfm-apply-${key}`,
                        checked: !!fieldsToApply[key],
                        onChange: () => handleToggleFieldToApply(key),
                      }),
                      React.createElement(
                        "label",
                        { htmlFor: `sfm-apply-${key}`, className: "mb-0 ml-1 text-light cursor-pointer small" },
                        label
                      )
                    )
                  )
                ),
                React.createElement(
                  "div",
                  { className: "d-flex align-items-center gap-2" },
                  React.createElement("button", { type: "button", className: "btn btn-secondary btn-sm", onClick: onClose }, "Cancel"),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "btn btn-primary btn-sm font-weight-bold",
                      disabled: isExecuting || selectedSceneIds.size === 0,
                      onClick: handleExecute,
                    },
                    isExecuting ? "Executing Updates..." : `Apply to ${selectedSceneIds.size} Selected Scenes`
                  )
                )
              )
          )
        )
      ),
      renderLayoutTemplateModal()
    );
  }

    // Compatibility Wrapper for legacy BatchMetadataModal callers
    function BatchMetadataModal(props) {
      const {
        currentFolder = "",
        currentPath = "",
        sceneCount,
        sceneIds = [],
        directScenes = null,
        scenes = null,
        selectedSceneIds = null,
        onClose = () => {},
        onApplied = null,
        onSuccess = null,
        onScenePatched = null,
      } = props || {};

      const resolvedDirectScenes = useMemo(() => {
        if (Array.isArray(directScenes) && directScenes.length > 0) return directScenes;
        if (Array.isArray(scenes) && scenes.length > 0) return scenes;

        const targetIds = Array.isArray(sceneIds)
          ? sceneIds.map(String)
          : sceneIds instanceof Set
          ? Array.from(sceneIds).map(String)
          : [];
        const cachedScenes = window.__SFM_GLOBAL_CACHE__?.scenes;
        if (Array.isArray(cachedScenes) && cachedScenes.length > 0 && targetIds.length > 0) {
          const idSet = new Set(targetIds);
          const matched = cachedScenes.filter((s) => s && idSet.has(String(s.id)));
          if (matched.length > 0) return matched;
        }
        return [];
      }, [directScenes, scenes, sceneIds]);

      const [fetchedScenes, setFetchedScenes] = useState(null);

      useEffect(() => {
        const targetIds = Array.isArray(sceneIds)
          ? sceneIds.map(String)
          : sceneIds instanceof Set
          ? Array.from(sceneIds).map(String)
          : [];
        if (resolvedDirectScenes.length === 0 && targetIds.length > 0 && typeof gqlFetch === "function") {
          let cancelled = false;
          gqlFetch(
            `query GetBatchModalScenes($ids: [ID!]) {
              findScenes(scene_ids: $ids, filter: { per_page: -1 }) {
                scenes {
                  id
                  title
                  date
                  rating100
                  organized
                  code
                  details
                  urls
                  studio { id name }
                  performers { id name }
                  tags { id name }
                  paths { screenshot preview stream }
                  files { id path basename size duration width height }
                }
              }
            }`,
            { ids: targetIds }
          )
            .then((res) => {
              if (!cancelled && Array.isArray(res?.findScenes?.scenes)) {
                setFetchedScenes(res.findScenes.scenes);
              }
            })
            .catch(() => {});
          return () => {
            cancelled = true;
          };
        }
        return undefined;
      }, [resolvedDirectScenes.length, sceneIds]);

      const stubScenes = useMemo(() => {
        const targetIds = Array.isArray(sceneIds)
          ? sceneIds.map(String)
          : sceneIds instanceof Set
          ? Array.from(sceneIds).map(String)
          : [];
        return targetIds.map((id) => ({
          id,
          title: `Scene #${id}`,
          files: [],
          performers: [],
          tags: [],
        }));
      }, [sceneIds]);

      const finalScenes =
        resolvedDirectScenes.length > 0
          ? resolvedDirectScenes
          : Array.isArray(fetchedScenes) && fetchedScenes.length > 0
          ? fetchedScenes
          : stubScenes;

      const effectiveSelectedIds =
        selectedSceneIds != null
          ? selectedSceneIds
          : Array.isArray(sceneIds) && sceneIds.length > 0
          ? sceneIds
          : sceneIds instanceof Set && sceneIds.size > 0
          ? sceneIds
          : finalScenes.map((s) => String(s.id));

      return React.createElement(FilenameParserModal, {
        currentFolder: currentFolder || (sceneCount ? `${sceneCount} scenes` : ""),
        currentPath,
        directScenes: finalScenes,
        selectedSceneIds: effectiveSelectedIds,
        initialTab: "bulk_edit",
        onClose,
        onApplied: onApplied || onSuccess,
        onScenePatched,
        autoCloseOnBulkEdit: true,
      });
    }

    Object.assign(SFM, {
      FilenameParserModal,
      MetadataStudioModal: FilenameParserModal,
      BatchMetadataModal,
    });
  } catch (err) {
    console.error("[PathFileManager] Critical error in sfm_metadata_modal.js:", err);
  }
})();

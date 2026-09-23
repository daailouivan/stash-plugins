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
    // Modal: Inline Video Player (Feature 3)
    // ==========================================
    function InlinePlayerModal({ scene, onClose }) {
      useEffect(() => {
        const handleKeyDown = (e) => {
          if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
      }, [onClose]);

      if (!scene) return null;
      const streamUrl = `/scene/${scene.id}/stream`;
      const title = scene.title || scene.files?.[0]?.basename || `Scene #${scene.id}`;

      return React.createElement(
        "div",
        { className: "sfm-modal-backdrop", onClick: onClose },
        React.createElement(
          "div",
          { className: "sfm-player-dialog", onClick: (e) => e.stopPropagation() },
          React.createElement(
            "div",
            { className: "sfm-modal-header" },
            React.createElement("h5", { className: "mb-0 text-truncate font-weight-bold" }, `▶ ${title}`),
            React.createElement("button", { className: "close text-light", onClick: onClose }, "×")
          ),
          React.createElement(
            "div",
            { className: "sfm-video-container" },
            React.createElement("video", {
              src: streamUrl,
              controls: true,
              autoPlay: true,
              className: "sfm-video-element",
            })
          ),
          React.createElement(
            "div",
            { className: "p-3 bg-dark d-flex justify-content-between align-items-center flex-wrap gap-2 text-muted small" },
            React.createElement(
              "div",
              null,
              scene.studio?.name && React.createElement("span", { className: "badge badge-primary mr-2" }, scene.studio.name),
              scene.date && React.createElement("span", { className: "mr-3" }, `📅 ${scene.date}`),
              scene.files?.[0]?.size && React.createElement("span", null, `💾 ${formatBytes(scene.files[0].size)}`)
            ),
            React.createElement(
              "a",
              { href: `/scenes/${scene.id}`, target: "_blank", rel: "noreferrer", className: "btn btn-sm btn-outline-info" },
              "Open Scene Details ↗"
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
    // Main App Component (Features 5, 1, 2, 3, 4)
    // ==========================================
    function FileManagerView({ onClose }) {
      const [trie, setTrie] = useState(null);
      const [currentPath, setCurrentPath] = useState("");
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

      // Milestone 2: View Mode (Grid Cards vs Table View)
      const [viewMode, setViewMode] = useState(() => {
        try {
          return window.localStorage.getItem("sfm_view_mode") || "grid";
        } catch (e) {
          return "grid";
        }
      });

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
                  paths { screenshot preview }
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
        if (onClose) onClose();
        window.location.href = `/scenes?c=${encodeURIComponent(JSON.stringify(filterCriterion))}`;
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
                  "button",
                  { className: "sfm-crumb-btn", onClick: () => setCurrentPath(""), title: "Return to Root" },
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
                        onClick: () => setCurrentPath(p),
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
                React.createElement(
                  "div",
                  { className: "btn-group btn-group-sm ml-2", role: "group" },
                  React.createElement(
                    "button",
                    {
                      className: `btn btn-sm ${viewMode === "grid" ? "btn-info" : "btn-outline-secondary"}`,
                      onClick: () => handleToggleViewMode("grid"),
                      title: "Grid Card View",
                    },
                    "⊞ Cards"
                  ),
                  React.createElement(
                    "button",
                    {
                      className: `btn btn-sm ${viewMode === "list" ? "btn-info" : "btn-outline-secondary"}`,
                      onClick: () => handleToggleViewMode("list"),
                      title: "Detailed Table View",
                    },
                    "☰ Table"
                  )
                )
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
          // Subfolders Section
          filteredAndSortedSubfolders.length > 0 &&
            React.createElement(
              "div",
              { className: "mb-4" },
              React.createElement("div", { className: "sfm-section-header" }, React.createElement("span", null, "Subfolders"), React.createElement("span", { className: "badge badge-dark ml-2 font-weight-normal" }, filteredAndSortedSubfolders.length)),
              React.createElement(
                "div",
                { className: "row" },
                filteredAndSortedSubfolders.map((folderName) => {
                  const childNode = currentNode.folders[folderName];
                  const count = childNode ? childNode.allSceneIds.size : 0;
                  const size = childNode ? formatBytes(childNode.totalSize) : "0 B";
                  const nextPath = currentPath ? `${currentPath}/${folderName}` : folderName;
                  return React.createElement(
                    "div",
                    { key: folderName, className: "col-6 col-sm-4 col-md-3 col-lg-2 mb-3" },
                    React.createElement(
                      "div",
                      { className: "sfm-folder-card", onClick: () => setCurrentPath(nextPath) },
                      React.createElement("div", { className: "sfm-folder-icon-wrap" }, React.createElement(IconFolderCard, { size: 46, color: "#81a1c1" })),
                      React.createElement("div", { className: "sfm-folder-name" }, folderName),
                      React.createElement(
                        "div",
                        { className: "sfm-folder-badges" },
                        React.createElement("span", { className: "sfm-badge" }, `${count} scenes`),
                        count > 0 && React.createElement("span", { className: "sfm-badge text-muted" }, size)
                      )
                    )
                  );
                })
              )
            ),
          // Direct Scenes Section (Milestone 1 & 2)
          filteredAndSortedScenes.length > 0 &&
            React.createElement(
              "div",
              { className: "mb-4" },
              React.createElement(
                "div",
                { className: "d-flex justify-content-between align-items-center mb-3" },
                React.createElement(
                  "div",
                  { className: "sfm-section-header mb-0" },
                  React.createElement("span", null, `Scenes (${filteredAndSortedScenes.length})`),
                  selectedSceneIds.size > 0 &&
                    React.createElement("span", { className: "badge badge-info ml-2" }, `${selectedSceneIds.size} selected`)
                ),
                React.createElement(
                  "button",
                  {
                    className: "btn btn-sm btn-outline-secondary py-0 px-2",
                    onClick: handleSelectAllFolderScenes,
                    title: "Select or deselect all visible scenes in folder",
                  },
                  filteredAndSortedScenes.every((s) => selectedSceneIds.has(s.id)) ? "Deselect All" : "Select All"
                )
              ),
              viewMode === "list"
                ? React.createElement(SceneTableView, {
                    scenes: filteredAndSortedScenes,
                    onPlay: (s) => setPlayingScene(s),
                    selectedIds: selectedSceneIds,
                    onToggleSelect: handleToggleSelect,
                    onSelectAll: handleSelectAllFolderScenes,
                  })
                : React.createElement(
                    "div",
                    { className: "row" },
                    filteredAndSortedScenes.map((scene) =>
                      React.createElement(
                        "div",
                        { key: scene.id, className: "col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 mb-3" },
                        React.createElement(SceneCard, {
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
                : React.createElement("button", { className: "btn btn-outline-secondary mt-2", onClick: () => setCurrentPath("") }, "Return to Root")
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
            React.createElement(InlinePlayerModal, {
              scene: playingScene,
              onClose: () => setPlayingScene(null),
            })
        )
      );
    }

    // Modal Manager / View Opener
    function closeWorkspace() {
      const root = document.getElementById("sfm-workspace-root");
      if (root) {
        root.style.display = "none";
      }
      if (window.location.hash === "#file-manager") {
        window.history.pushState(null, "", window.location.pathname + window.location.search);
      }
    }

    function openFileManager() {
      let root = document.getElementById("sfm-workspace-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "sfm-workspace-root";
        document.body.appendChild(root);
        ReactDOM.render(React.createElement(FileManagerView, { onClose: closeWorkspace }), root);
      } else {
        root.style.display = "block";
      }

      if (window.location.hash !== "#file-manager") {
        window.history.pushState(null, "", "#file-manager");
      }
    }

    // Listen to hash changes
    window.addEventListener("hashchange", () => {
      if (window.location.hash === "#file-manager") {
        openFileManager();
      } else {
        const root = document.getElementById("sfm-workspace-root");
        if (root) {
          root.style.display = "none";
        }
      }
    });

    if (window.location.hash === "#file-manager") {
      setTimeout(openFileManager, 200);
    }

    if (register && register.route) {
      register.route("/plugin/file-manager", FileManagerView);
    }

    // Main Navigation Bar Button Injection (matches native Stash nav items pixel-for-pixel)
    function injectMainBarButton() {
      if (document.getElementById("sfm-main-nav-item")) return;

      const anchor =
        document.querySelector('.navbar-nav a[href*="/scenes"]') ||
        document.querySelector('.navbar-nav a[href*="/images"]') ||
        document.querySelector('.navbar-nav a[href*="/performers"]') ||
        document.querySelector('.navbar-nav a[href*="/studios"]') ||
        document.querySelector('.navbar-nav a[href*="/tags"]') ||
        document.querySelector('.navbar-nav a[href*="/movies"]') ||
        document.querySelector('.navbar-nav a') ||
        document.querySelector('a[href*="/scenes"]');

      if (!anchor) return;

      // Crucial: Identify the true top-level item container (.nav-item, li, etc.)
      // and NOT anchor.parentElement if anchor is already inside a .nav-item!
      const navItem = anchor.closest(".nav-item, li") || anchor;
      const navBar = navItem.closest(".navbar-nav, .nav, nav") || navItem.parentElement;
      if (!navBar) return;

      const newLink = document.createElement("a");
      newLink.className = (anchor.className || "nav-link").replace(/\bactive\b/g, "").trim();
      newLink.classList.add("sfm-nav-link");
      newLink.href = "#file-manager";
      newLink.setAttribute("role", "button");
      newLink.setAttribute("title", "File Manager (Browse by Directory)");

      const siblingSvg = anchor.querySelector("svg");
      const siblingSpan = anchor.querySelector("span");

      // Dynamically measure sibling SVG dimensions or default to 26px
      let targetSize = 26;
      if (siblingSvg) {
        const rect = siblingSvg.getBoundingClientRect();
        if (rect && rect.width >= 16 && rect.height >= 16) {
          targetSize = Math.round(rect.width);
        }
      }

      // Solid bold folder icon matching Stash's native filled icons
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", String(targetSize));
      svg.setAttribute("height", String(targetSize));
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("role", "img");
      svg.setAttribute("fill", "currentColor");
      svg.style.width = `${targetSize}px`;
      svg.style.height = `${targetSize}px`;
      svg.style.fontSize = `${targetSize}px`;

      let svgClassStr = "svg-inline--fa fa-folder fa-2x sfm-nav-svg";
      if (siblingSvg) {
        const origClasses = (siblingSvg.getAttribute("class") || "").split(/\s+/);
        const sizeClasses = origClasses.filter(c => c === "fa-2x" || c === "fa-lg" || c === "fa-sm" || c === "fa-fw" || c.startsWith("fa-w-"));
        if (sizeClasses.length > 0) {
          svgClassStr = `svg-inline--fa fa-folder ${sizeClasses.join(" ")} sfm-nav-svg`;
        }
      }
      svg.setAttribute("class", svgClassStr);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "currentColor");
      path.setAttribute("d", "M10 4H4c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z");
      svg.appendChild(path);

      const labelSpan = document.createElement("span");
      if (siblingSpan) {
        labelSpan.className = siblingSpan.className;
        if (siblingSpan.getAttribute("style")) {
          labelSpan.setAttribute("style", siblingSpan.getAttribute("style"));
        }
      }
      labelSpan.className = (labelSpan.className + " sfm-nav-label").trim();
      labelSpan.textContent = "Files";

      if (siblingSvg && siblingSvg.parentElement && siblingSvg.parentElement !== anchor) {
        const wrapper = document.createElement(siblingSvg.parentElement.tagName.toLowerCase());
        wrapper.className = siblingSvg.parentElement.className;
        if (siblingSvg.parentElement.getAttribute("style")) {
          wrapper.setAttribute("style", siblingSvg.parentElement.getAttribute("style"));
        }
        wrapper.appendChild(svg);
        newLink.appendChild(wrapper);
      } else {
        newLink.appendChild(svg);
      }

      if (siblingSvg && siblingSpan) {
        newLink.appendChild(document.createTextNode(" "));
      }
      newLink.appendChild(labelSpan);

      let newItem = null;
      function syncActiveState() {
        if (window.location.hash === "#file-manager") {
          newLink.classList.add("active");
          if (newItem) newItem.classList.add("active");
        } else {
          newLink.classList.remove("active");
          if (newItem) newItem.classList.remove("active");
        }
      }
      window.addEventListener("hashchange", syncActiveState);
      syncActiveState();

      newLink.addEventListener("click", function (e) {
        e.preventDefault();
        openFileManager();
      });

      if (navItem !== anchor) {
        // navItem is a distinct container (<div class="nav-item"> or <li>)
        newItem = document.createElement(navItem.tagName.toLowerCase());
        newItem.className = navItem.className;
        newItem.id = "sfm-main-nav-item";
        newItem.appendChild(newLink);
        // Insert right after navItem as a true peer in the navbar row
        if (navItem.nextSibling) {
          navBar.insertBefore(newItem, navItem.nextSibling);
        } else {
          navBar.appendChild(newItem);
        }
      } else {
        // anchor is a direct child of navBar
        newLink.id = "sfm-main-nav-item";
        newItem = newLink;
        if (anchor.nextSibling) {
          navBar.insertBefore(newLink, anchor.nextSibling);
        } else {
          navBar.appendChild(newLink);
        }
      }
    }

    setInterval(injectMainBarButton, 1000);
    setTimeout(injectMainBarButton, 200);

    if (window.PluginApi.Event) {
      window.PluginApi.Event.addEventListener("stash:location", () => {
        setTimeout(injectMainBarButton, 150);
      });
    }

    console.log("[PathFileManager] Initialized successfully with all enhanced features.");
  } catch (err) {
    console.error("[PathFileManager] Startup error:", err);
  }
})();

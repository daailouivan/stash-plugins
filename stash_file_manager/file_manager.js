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

    // Cache Configuration (Feature 5)
    const CACHE_KEY = "sfm_library_cache_v2";
    const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

    function getCachedScenes() {
      try {
        const raw = window.sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
          window.sessionStorage.removeItem(CACHE_KEY);
          return null;
        }
        return parsed.scenes;
      } catch (e) {
        return null;
      }
    }

    function setCachedScenes(scenes) {
      try {
        // Store compact representation to stay well within quota
        const compact = scenes.map(s => ({
          id: s.id,
          title: s.title,
          date: s.date,
          rating100: s.rating100,
          studio: s.studio ? { id: s.studio.id, name: s.studio.name } : null,
          performers: s.performers ? s.performers.map(p => ({ id: p.id, name: p.name })) : [],
          tags: s.tags ? s.tags.map(t => ({ id: t.id, name: t.name })) : [],
          paths: {
            screenshot: s.paths?.screenshot,
            preview: s.paths?.preview
          },
          files: s.files ? s.files.map(f => ({
            path: f.path,
            basename: f.basename,
            size: f.size,
            duration: f.duration
          })) : []
        }));

        window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          timestamp: Date.now(),
          scenes: compact
        }));
      } catch (e) {
        console.warn("[PathFileManager] sessionStorage caching skipped:", e.message);
      }
    }

    function clearCachedScenes() {
      try {
        window.sessionStorage.removeItem(CACHE_KEY);
      } catch (e) {}
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
    function SceneCard({ scene, onPlay }) {
      const [isHovered, setIsHovered] = useState(false);
      const thumbUrl = scene.paths?.screenshot || `/scene/${scene.id}/screenshot`;
      const previewVideoUrl = scene.paths?.preview || `/scene/${scene.id}/preview`;
      const studioName = scene.studio?.name;
      const performers = scene.performers?.map((p) => p.name).join(", ");
      const duration = formatDuration(scene.files?.[0]?.duration);

      return React.createElement(
        "div",
        { className: "sfm-scene-card" },
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

      // Modals
      const [showBatchModal, setShowBatchModal] = useState(false);
      const [showParserModal, setShowParserModal] = useState(false);
      const [playingScene, setPlayingScene] = useState(null);

      // Save hide empty preference
      const handleToggleHideEmpty = (val) => {
        setHideEmpty(val);
        try {
          window.localStorage.setItem("sfm_hide_empty", val ? "true" : "false");
        } catch (e) {}
      };

      // Feature 5: Progressive Indexing & Caching
      const fetchCatalog = useCallback(async (forceBypassCache = false) => {
        setLoading(true);

        if (!forceBypassCache) {
          setStatusText("Loading cached directory tree...");
          const cached = getCachedScenes();
          if (cached && cached.length > 0) {
            const newTrie = new PathTrie();
            cached.forEach((s) => newTrie.insert(s));
            setTrie(newTrie);
            setLoading(false);
            return;
          }
        }

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

          setStatusText(`Building Path Trie for ${scenes.length} scenes...`);
          const newTrie = new PathTrie();
          scenes.forEach((s) => newTrie.insert(s));

          setTrie(newTrie);
          setCachedScenes(scenes);
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

      const handleRescan = () => {
        clearCachedScenes();
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

      if (loading) {
        return React.createElement(
          "div",
          { className: "sfm-workspace-overlay" },
          React.createElement(
            "div",
            { className: "sfm-workspace-header" },
            React.createElement("div", { className: "sfm-workspace-title" }, "📁 File Manager"),
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
        // Header
        React.createElement(
          "div",
          { className: "sfm-workspace-header" },
          React.createElement(
            "div",
            { className: "sfm-workspace-title" },
            React.createElement("span", { style: { color: "#ebcb8b" } }, "📁"),
            React.createElement("span", null, "Stash File Manager"),
            trie && React.createElement("span", { className: "badge badge-dark ml-2 text-muted small" }, `${trie.root.allSceneIds.size} total scenes`)
          ),
          onClose && React.createElement("button", { className: "sfm-workspace-close", onClick: onClose }, "✕ Close")
        ),
        // Scrollable Body
        React.createElement(
          "div",
          { className: "sfm-workspace-content" },
          // Breadcrumbs Bar with Search & Sort controls (Feature 2)
          React.createElement(
            "div",
            { className: "sfm-breadcrumb-bar" },
            React.createElement(
              "div",
              { className: "sfm-breadcrumbs" },
              React.createElement(
                "button",
                { className: "sfm-crumb-btn", onClick: () => setCurrentPath("") },
                "📁 Root"
              ),
              segments.map((seg, idx) => {
                const p = segments.slice(0, idx + 1).join("/");
                return React.createElement(
                  React.Fragment,
                  { key: p },
                  React.createElement("span", { className: "sfm-crumb-separator" }, "/"),
                  React.createElement(
                    "button",
                    { className: "sfm-crumb-btn", onClick: () => setCurrentPath(p) },
                    seg
                  )
                );
              })
            ),
            React.createElement(
              "div",
              { className: "sfm-filter-controls" },
              React.createElement("input", {
                type: "text",
                className: "sfm-search-input",
                placeholder: "Search folder or scenes...",
                value: searchQuery,
                onChange: (e) => setSearchQuery(e.target.value),
              }),
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
              React.createElement(
                "select",
                {
                  className: "sfm-sort-select",
                  value: folderSort,
                  onChange: (e) => setFolderSort(e.target.value),
                  title: "Sort Folders",
                },
                React.createElement("option", { value: "name_asc" }, "Folder (A-Z)"),
                React.createElement("option", { value: "name_desc" }, "Folder (Z-A)"),
                React.createElement("option", { value: "count_desc" }, "Scene Count (High-Low)"),
                React.createElement("option", { value: "count_asc" }, "Scene Count (Low-High)")
              ),
              React.createElement(
                "button",
                { className: "btn btn-sm btn-outline-secondary", onClick: handleRescan, title: "Clear cache and rebuild tree" },
                "🔄 Rescan"
              ),
              currentPath &&
                React.createElement(
                  "button",
                  { className: "btn btn-sm btn-outline-info", onClick: openInNativeGrid, title: "Open Stash Native Grid" },
                  "↗️ Grid"
                )
            )
          ),
          // Action Toolbar
          React.createElement(
            "div",
            { className: "sfm-toolbar" },
            React.createElement(
              "div",
              { className: "sfm-folder-info" },
              React.createElement("h5", { className: "sfm-folder-title" }, `📁 ${currentFolderName}`),
              React.createElement(
                "small",
                { className: "text-muted" },
                `${currentNode ? currentNode.directScenes.length : 0} direct scenes, ${allDescendantIds.length} total in subtrees (${formatBytes(currentNode?.totalSize)})`
              )
            ),
            React.createElement(
              "div",
              { className: "d-flex align-items-center gap-2 flex-wrap" },
              React.createElement(
                "label",
                { className: "small text-muted mb-0 d-flex align-items-center gap-1 cursor-pointer mr-2" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: hideEmpty,
                  onChange: (e) => handleToggleHideEmpty(e.target.checked),
                }),
                "Hide empty folders"
              ),
              currentPath && React.createElement(
                "div",
                { className: "btn-group" },
                React.createElement(
                  "button",
                  { className: "btn btn-sm btn-outline-warning", onClick: () => setShowParserModal(true) },
                  "🔍 Parse Filenames"
                ),
                React.createElement(
                  "button",
                  { className: "btn btn-sm btn-info", onClick: handleAutoDetect },
                  "⚡ Auto-Detect"
                ),
                React.createElement(
                  "button",
                  { className: "btn btn-sm btn-primary", onClick: () => setShowBatchModal(true) },
                  "✏️ Batch Edit"
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
              React.createElement("h6", { className: "text-muted font-weight-bold mb-3" }, "FOLDERS"),
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
                      React.createElement("div", { className: "sfm-folder-icon" }, "📁"),
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
          // Direct Scenes Section
          filteredAndSortedScenes.length > 0 &&
            React.createElement(
              "div",
              { className: "mb-4" },
              React.createElement(
                "h6",
                { className: "text-muted font-weight-bold mb-3" },
                `SCENES IN THIS FOLDER (${filteredAndSortedScenes.length})`
              ),
              React.createElement(
                "div",
                { className: "row" },
                filteredAndSortedScenes.map((scene) =>
                  React.createElement(
                    "div",
                    { key: scene.id, className: "col-12 col-sm-6 col-md-4 col-lg-3 col-xl-2 mb-3" },
                    React.createElement(SceneCard, {
                      scene,
                      onPlay: (s) => setPlayingScene(s),
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
          // Modals
          showBatchModal &&
            React.createElement(BatchMetadataModal, {
              currentFolder: currentFolderName,
              sceneCount: allDescendantIds.length,
              sceneIds: allDescendantIds,
              onClose: () => setShowBatchModal(false),
              onApplied: handleRescan,
            }),
          showParserModal &&
            React.createElement(FilenameParserModal, {
              currentFolder: currentFolderName,
              directScenes: currentNode ? currentNode.directScenes : [],
              onClose: () => setShowParserModal(false),
              onApplied: handleRescan,
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
    function openFileManager() {
      let root = document.getElementById("sfm-workspace-root");
      if (!root) {
        root = document.createElement("div");
        root.id = "sfm-workspace-root";
        document.body.appendChild(root);
      }

      function closeWorkspace() {
        if (root) {
          ReactDOM.unmountComponentAtNode(root);
          root.remove();
        }
        if (window.location.hash === "#file-manager") {
          window.history.pushState(null, "", window.location.pathname + window.location.search);
        }
      }

      window.history.pushState(null, "", "#file-manager");
      ReactDOM.render(React.createElement(FileManagerView, { onClose: closeWorkspace }), root);
    }

    // Listen to hash changes
    window.addEventListener("hashchange", () => {
      if (window.location.hash === "#file-manager") {
        openFileManager();
      } else {
        const root = document.getElementById("sfm-workspace-root");
        if (root) {
          ReactDOM.unmountComponentAtNode(root);
          root.remove();
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
        document.querySelector('.navbar-nav a[href*="/performers"]') ||
        document.querySelector('.navbar-nav a[href*="/studios"]') ||
        document.querySelector('.navbar-nav a[href*="/tags"]') ||
        document.querySelector('.navbar-nav a[href*="/images"]') ||
        document.querySelector('.navbar-nav a[href*="/movies"]') ||
        document.querySelector('.navbar-nav a') ||
        document.querySelector('a[href*="/scenes"]') ||
        document.querySelector('a[href*="/studios"]');

      if (!anchor) return;

      const parentLi = anchor.closest("li");
      const container = parentLi ? parentLi.parentElement : anchor.parentElement;
      if (!container) return;

      const newLink = document.createElement("a");
      newLink.className = anchor.className;
      newLink.href = "#file-manager";
      newLink.setAttribute("role", "button");
      newLink.setAttribute("title", "File Manager");

      const siblingSvg = anchor.querySelector("svg");
      const siblingSpan = anchor.querySelector("span");

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      let svgClassStr = "svg-inline--fa fa-folder fa-w-16";
      if (siblingSvg) {
        const origClasses = (siblingSvg.getAttribute("class") || "").split(/\s+/);
        const filtered = origClasses.filter(c => !c.startsWith("fa-") || c === "fa-w-16" || c === "fa-fw");
        filtered.push("fa-folder");
        svgClassStr = filtered.join(" ");
      }
      svg.setAttribute("class", svgClassStr);
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      svg.setAttribute("data-prefix", "fas");
      svg.setAttribute("data-icon", "folder");
      svg.setAttribute("role", "img");
      svg.setAttribute("viewBox", "0 0 512 512");

      if (siblingSvg && siblingSvg.getAttribute("style")) {
        svg.setAttribute("style", siblingSvg.getAttribute("style"));
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("fill", "currentColor");
      path.setAttribute("d", "M464 128H272l-64-64H48C21.49 64 0 85.49 0 112v288c0 26.51 21.49 48 48 48h416c26.51 0 48-21.49 48-48V176c0-26.51-21.49-48-48-48z");
      svg.appendChild(path);

      const labelSpan = document.createElement("span");
      if (siblingSpan) {
        labelSpan.className = siblingSpan.className;
        if (siblingSpan.getAttribute("style")) {
          labelSpan.setAttribute("style", siblingSpan.getAttribute("style"));
        }
      }
      labelSpan.textContent = "File Manager";

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

      function syncActiveState() {
        if (window.location.hash === "#file-manager") {
          newLink.classList.add("active");
        } else {
          newLink.classList.remove("active");
        }
      }
      window.addEventListener("hashchange", syncActiveState);
      syncActiveState();

      newLink.addEventListener("click", function (e) {
        e.preventDefault();
        openFileManager();
      });

      if (parentLi) {
        const newLi = document.createElement("li");
        newLi.className = parentLi.className;
        newLi.id = "sfm-main-nav-item";
        newLi.appendChild(newLink);
        container.appendChild(newLi);
      } else {
        newLink.id = "sfm-main-nav-item";
        container.appendChild(newLink);
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

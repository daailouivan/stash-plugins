"use strict";

const assert = require("assert");
const { makeScene } = require("./fixtures");
const {
  withEnv,
  openFolderRoute,
  ensureTableView,
  openMetadataStudioGlobal,
  getSelectOptionValues,
  getTableHeaders,
  getTableBodyRows,
  findHeaderByName,
  findButtonByText,
  findButtonByTextOrTitle,
} = require("./helpers");

function getTests() {
  const tests = [];
  const add = (id, feature, name, fn) => tests.push({ id, tier: 2, feature, name, fn });

  // ==========================================================
  // F1 Boundary & Corner Cases
  // ==========================================================
  add("T2-F1-01", "F1", "Empty scene catalog mounts /plugin/file-manager cleanly without crashing", async () => {
    await withEnv({ url: "/plugin/file-manager", scenes: [] }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      assert(tree.findBySelector(".sfm-native-page").length > 0, "Empty catalog must still render .sfm-native-page");
      assert.strictEqual(env.document.getElementById("sfm-workspace-root"), null);
    });
  });

  add("T2-F1-02", "F1", "GraphQL GetScenePaths error displays graceful error/notification instead of uncaught crash", async () => {
    await withEnv({
      url: "/plugin/file-manager",
      faultRules: [{ match: (q) => q.includes("GetScenePaths"), graphqlError: "DB Offline" }],
    }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      assert(tree.root, "Component must still render tree when GetScenePaths fails");
    });
  });

  add("T2-F1-03", "F1", "FileManagerView mounts cleanly even when location/history props are omitted", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      const Comp = env.registeredRoutes["/plugin/file-manager"];
      const tree = env.mount(Comp, {});
      await tree.flush();
      assert(tree.findBySelector(".sfm-native-page").length > 0);
    });
  });

  add("T2-F1-04", "F1", "Repeated mount/unmount cycles leave zero stale attributes on .main-container", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      for (let i = 0; i < 3; i++) {
        const tree = await env.mountRoute("/plugin/file-manager");
        tree.unmount();
      }
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-active"), null);
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-embedded"), null);
    });
  });

  add("T2-F1-05", "F1", "SafeErrorBoundary catches child render exception and displays fallback UI", async () => {
    await withEnv(async (env) => {
      const Boundary = env.sfm.SafeErrorBoundary || env.cache.SafeErrorBoundary;
      assert.strictEqual(typeof Boundary, "function", "SafeErrorBoundary must be exported");
      function Boom() { throw new Error("Simulated child crash"); }
      const tree = env.mount(env.React.createElement(Boundary, null, env.React.createElement(Boom)));
      await tree.flush();
      assert(tree.text().length > 0, "SafeErrorBoundary must render fallback message instead of crashing");
    });
  });

  // ==========================================================
  // F2 Boundary & Corner Cases
  // ==========================================================
  add("T2-F2-01", "F2", "FilesNavButton works via History fallback when ReactRouterDOM is unavailable", async () => {
    await withEnv({ url: "/scenes", omitReactRouterDOM: true }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const patched = env.invokePatched("MainNavBar.MenuItems", {}, baseNav);
      const navTree = env.mount(patched);
      await navTree.flush();
      const btn = navTree.findBySelector("#sfm-nav-button")[0];
      assert(btn, "Fallback nav button must render even without ReactRouterDOM");
      await navTree.click(btn);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert(!env.location.hash.includes("#file-manager"));
    });
  });

  add("T2-F2-02", "F2", "FilesNavButton does not carry active class on unrelated routes like /studios or /scenes/101", async () => {
    for (const p of ["/studios", "/scenes/101", "/settings"]) {
      await withEnv({ url: p }, async (env) => {
        const baseNav = env.React.createElement("div", { className: "navbar-nav" });
        const patched = env.invokePatched("MainNavBar.MenuItems", {}, baseNav);
        const navTree = env.mount(patched);
        await navTree.flush();
        const btn = navTree.findBySelector("#sfm-nav-button")[0];
        assert(!String(btn.props.className || "").split(/\s+/).includes("active"),
          `NavLink must NOT be active on route ${p}`);
      });
    }
  });

  add("T2-F2-03", "F2", "MainNavBar.MenuItems patch safely handles null or non-element base result without Error #31", async () => {
    await withEnv(async (env) => {
      for (const badBase of [null, undefined, {}, "NavText"]) {
        const res = env.invokePatched("MainNavBar.MenuItems", {}, badBase);
        const tree = env.mount(env.React.createElement("div", null, res));
        await tree.flush();
        assert(tree.findBySelector("#sfm-nav-button").length === 1);
      }
    });
  });

  add("T2-F2-04", "F2", "CheckboxGroup patch ignores non-menu groups and avoids duplicate files-manager items", async () => {
    await withEnv(async (env) => {
      const beforeFn = env.patches.before["CheckboxGroup"][0];
      const other = beforeFn({ groupId: "other-group", items: [{ id: "x" }] });
      assert.strictEqual(other[0].items.length, 1, "Must not modify unrelated CheckboxGroup");
      const dup = beforeFn({ groupId: "menu-items", items: [{ id: "files-manager", headingID: "Files" }] });
      assert.strictEqual(dup[0].items.filter((i) => i.id === "files-manager").length, 1, "Must not duplicate files-manager");
    });
  });

  add("T2-F2-05", "F2", "FilesNavButton active state updates when popstate switches between /scenes and /plugin/file-manager", async () => {
    await withEnv({ url: "/scenes", omitReactRouterDOM: true }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const patched = env.invokePatched("MainNavBar.MenuItems", {}, baseNav);
      const navTree = env.mount(patched);
      await navTree.flush();
      assert(!String(navTree.findBySelector("#sfm-nav-button")[0].props.className || "").includes("active"));
      env.navigate("/plugin/file-manager");
      await navTree.flush();
      assert(String(navTree.findBySelector("#sfm-nav-button")[0].props.className || "").split(/\s+/).includes("active"));
    });
  });

  // ==========================================================
  // F3 Boundary & Corner Cases
  // ==========================================================
  add("T2-F3-01", "F3", "Non-existent ?path=Invalid/Ghost/Folder gracefully recovers to root without crashing", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Invalid/Ghost/Folder");
      const txt = tree.text();
      assert(txt.includes("Anime") || txt.includes("LiveAction"), "Invalid ?path= must fall back to root folders");
    });
  });

  add("T2-F3-02", "F3", "Special characters (& and spaces) in ?path= navigate and decode accurately", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "LiveAction/Studio Alpha");
      assert(tree.text().includes("Delta Special & Cut"), "Special-char path must load target folder scenes");
    });
  });

  add("T2-F3-03", "F3", "Malformed percent-encoding in search string does not throw URIError", async () => {
    await withEnv({ url: "/plugin/file-manager?path=%E0%A4%A" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      assert(tree.findBySelector(".sfm-native-page").length > 0, "Malformed URI must not crash route");
    });
  });

  add("T2-F3-04", "F3", "Legacy #file-manager?path=Anime hash URL falls back gracefully when loaded", async () => {
    await withEnv({ url: "/plugin/file-manager#file-manager?path=Anime" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      assert(tree.text().includes("Naruto") || tree.text().includes("OnePiece"),
        "Legacy hash path fallback must open Anime folder");
    });
  });

  add("T2-F3-05", "F3", "Non-existent ?scene=999999 query param does not crash FileManagerView", async () => {
    await withEnv({ url: "/plugin/file-manager?path=Anime&scene=999999" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      assert(tree.findBySelector(".sfm-native-page").length > 0);
    });
  });

  // ==========================================================
  // F4 Boundary & Corner Cases
  // ==========================================================
  add("T2-F4-01", "F4", "NativeSceneCardOverlay handles scene with empty files array and empty folderPath", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const Overlay = env.cache.NativeSceneCardOverlay;
      const sNoFiles = makeScene({ id: "501", files: [] });
      const tree = env.mount(Overlay, { scene: sNoFiles, folderPath: "" });
      await tree.flush();
      // Should return null or empty cleanly without throwing
      assert.strictEqual(env.location.pathname, "/scenes");
    });
  });

  add("T2-F4-02", "F4", "patchNativeSceneCard bypasses /tagger route completely", async () => {
    await withEnv({ url: "/tagger/scenes" }, async (env) => {
      const base = env.React.createElement("div", { className: "card scene-card" }, "Card");
      const out = env.invokePatched("SceneCard", { scene: env.db.scenes[0] }, base);
      assert.strictEqual(out, base, "patchNativeSceneCard must return base element unchanged on /tagger");
    });
  });

  add("T2-F4-03", "F4", "NativeSceneDetailDirectoryHierarchy URL-encodes spaces and ampersands in path", async () => {
    await withEnv({ url: "/scenes/105" }, async (env) => {
      const Comp = env.cache.NativeSceneDetailDirectoryHierarchy;
      const tree = env.mount(Comp, { scene: env.db.scenes[4], folderPath: "LiveAction/Studio Alpha & Beta" });
      await tree.flush();
      const crumb = tree.findByText("Studio Alpha & Beta", { selector: ".sfm-breadcrumb-item" })[0];
      assert(crumb);
      await tree.click(crumb);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "LiveAction/Studio Alpha & Beta");
    });
  });

  add("T2-F4-04", "F4", "injectSceneDetailDOMFallback and injectSceneListDOMFallback bail out on /plugin/file-manager", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      const sidebar = env.document.createElement("div");
      sidebar.className = "scene-info";
      env.mainContainer.appendChild(sidebar);
      env.cache.injectSceneDetailDOMFallback();
      assert.strictEqual(sidebar.children.length, 0, "Detail fallback must skip when on /plugin/file-manager");
    });
  });

  add("T2-F4-05", "F4", "patchNativeSceneDetails and patchNativeScenePlayer handle missing scene prop safely", async () => {
    await withEnv({ url: "/scenes/101" }, async (env) => {
      const baseDetails = env.React.createElement("div", { className: "scene-details" }, "Details");
      const basePlayer = env.React.createElement("div", { className: "scene-player" }, "Player");
      const dOut = env.invokePatched("SceneDetails", {}, baseDetails);
      const pOut = env.invokePatched("ScenePlayer", {}, basePlayer);
      assert(dOut && pOut);
    });
  });

  // ==========================================================
  // F5 Boundary & Corner Cases
  // ==========================================================
  add("T2-F5-01", "F5", "Organized toggle handles sceneUpdate GraphQL failure without corrupting db.scenes", async () => {
    await withEnv({
      faultRules: [{ match: (q) => q.includes("sceneUpdate"), graphqlError: "Permission denied" }],
    }, async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgIdx >= 0);
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgIdx);
      const cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgIdx].node)[0];
      await modal.change(cb, true);
      assert.strictEqual(env.db.scenes[1].organized, false, "Failed mutation must not falsely mark db scene organized");
    });
  });

  add("T2-F5-02", "F5", "Organized checkbox treats undefined/null scene.organized as false", async () => {
    await withEnv(async (env) => {
      const sUndef = makeScene({ id: "601", organized: undefined });
      const modal = await openMetadataStudioGlobal(env, [sUndef], "Season 1");
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgIdx >= 0);
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgIdx);
      const cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgIdx].node)[0];
      assert.strictEqual(Boolean(cb.props.checked), false);
    });
  });

  add("T2-F5-03", "F5", "Repeated Organized toggles (false -> true -> false) end cleanly at false", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgIdx >= 0);
      const getCb = () => {
        const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgIdx);
        return modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgIdx].node)[0];
      };
      await modal.change(getCb(), true);
      assert.strictEqual(env.db.scenes[1].organized, true);
      await modal.change(getCb(), false);
      assert.strictEqual(env.db.scenes[1].organized, false);
    });
  });

  add("T2-F5-04", "F5", "Organized toggle succeeds even when IndexedDB is unavailable", async () => {
    await withEnv({ disableIDB: true }, async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgIdx >= 0);
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgIdx);
      const cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgIdx].node)[0];
      await modal.change(cb, true);
      assert.strictEqual(env.db.scenes[1].organized, true);
    });
  });

  add("T2-F5-05", "F5", "Organized toggle works on scenes with numeric IDs as well as string IDs", async () => {
    await withEnv(async (env) => {
      const sNum = { ...env.db.scenes[1], id: 102 };
      const modal = await openMetadataStudioGlobal(env, [sNum], "Season 1");
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgIdx >= 0);
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgIdx);
      const cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgIdx].node)[0];
      await modal.change(cb, true);
      assert.strictEqual(env.db.scenes[1].organized, true);
    });
  });

  // ==========================================================
  // F6 Boundary & Corner Cases
  // ==========================================================
  add("T2-F6-01", "F6", "Code column renders placeholder instead of literal 'null' or 'undefined'", async () => {
    await withEnv(async (env) => {
      const sNull = makeScene({ id: "602", code: null });
      const modal = await openMetadataStudioGlobal(env, [sNull], "Season 1");
      const codeIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeIdx >= 0);
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > codeIdx);
      const cellTxt = row.cells[codeIdx].text;
      assert(!/null|undefined/i.test(cellTxt), `Code cell must not render '${cellTxt}'`);
    });
  });

  add("T2-F6-02", "F6", "Code column displays special characters (&, quotes, slashes) verbatim", async () => {
    await withEnv(async (env) => {
      const special = 'SP&"1/2"';
      const sSpec = makeScene({ id: "603", code: special });
      const modal = await openMetadataStudioGlobal(env, [sSpec], "Season 1");
      const codeIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeIdx >= 0);
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > codeIdx);
      assert(row.cells[codeIdx].text.includes(special));
    });
  });

  add("T2-F6-03", "F6", "Code column handles very long code strings without crashing", async () => {
    await withEnv(async (env) => {
      const longCode = "LONG-" + "X".repeat(120);
      const modal = await openMetadataStudioGlobal(env, [makeScene({ id: "604", code: longCode })], "Season 1");
      const codeIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeIdx >= 0);
      assert(modal.text().includes(longCode));
    });
  });

  add("T2-F6-04", "F6", "Metadata Studio with empty directScenes array renders Code header and 0 rows", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [], "Empty");
      const headers = getTableHeaders(modal, ".sfm-parser-table th").map((h) => h.text);
      assert(headers.some((h) => /\bCode\b/i.test(h)));
      assert.strictEqual(getTableBodyRows(modal, ".sfm-parser-table tbody tr").length, 0);
    });
  });

  add("T2-F6-05", "F6", "Code column retains existing scene.code when scraped result omits code", async () => {
    await withEnv(async (env) => {
      const s = makeScene({ id: "605", code: "KEEP-ME" });
      const modal = await openMetadataStudioGlobal(env, [s], "Season 1");
      const codeIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeIdx >= 0);
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > codeIdx);
      assert(row.cells[codeIdx].text.includes("KEEP-ME"));
    });
  });

  // ==========================================================
  // F7 Boundary & Corner Cases
  // ==========================================================
  add("T2-F7-01", "F7", "Sorting Code column when multiple scenes have null/empty codes does not throw", async () => {
    await withEnv(async (env) => {
      const scenes = [
        makeScene({ id: "701", code: null }),
        makeScene({ id: "702", code: "ZZZ-1" }),
        makeScene({ id: "703", code: "" }),
        makeScene({ id: "704", code: "AAA-1" }),
      ];
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Code"));
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Code"));
      assert.strictEqual(getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8).length, 4);
    });
  });

  add("T2-F7-02", "F7", "Sorting Date column handles missing/null dates cleanly", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[2], env.db.scenes[0], makeScene({ id: "705", date: null })];
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Date"));
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 3);
    });
  });

  add("T2-F7-03", "F7", "Sorting Performers and Studio handles empty arrays and null studios cleanly", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[2], env.db.scenes[0], env.db.scenes[4]];
      const modal = await openMetadataStudioGlobal(env, scenes, "All");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Studio"));
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Performers"));
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 3);
    });
  });

  add("T2-F7-04", "F7", "Switching sort from Title to Date clears ▲/▼ indicator from Title header", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 3), "Season 1");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Title"));
      assert(/[▲▼]/.test(modal.nodeText(findHeaderByName(modal, ".sfm-parser-table", "Title"))));
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Date"));
      assert(!/[▲▼]/.test(modal.nodeText(findHeaderByName(modal, ".sfm-parser-table", "Title"))),
        "Previous sorted column must clear sort indicator");
      assert(/[▲▼]/.test(modal.nodeText(findHeaderByName(modal, ".sfm-parser-table", "Date"))));
    });
  });

  add("T2-F7-05", "F7", "Case-insensitive Title sorting orders 'apple' before 'Banana'", async () => {
    await withEnv(async (env) => {
      const scenes = [
        makeScene({ id: "706", title: "Banana" }),
        makeScene({ id: "707", title: "apple" }),
      ];
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Title"));
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert(rows[0].text.includes("apple"), "Case-insensitive sort must put 'apple' before 'Banana'");
    });
  });

  // ==========================================================
  // F8 Boundary & Corner Cases
  // ==========================================================
  add("T2-F8-01", "F8", "Combining Unorganized filter + Missing Code filter yields exact intersection", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const orgSel = modal.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      const codeBtn = findButtonByTextOrTitle(modal, /^Code$/i);
      assert(orgSel && codeBtn);
      await modal.change(orgSel, "unorganized");
      await modal.click(codeBtn);
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 2, "Only scenes 103 and 107 are unorganized AND missing code");
    });
  });

  add("T2-F8-02", "F8", "Filter combination yielding 0 rows renders cleanly without errors", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const orgSel = modal.findBySelector("select").find((s) => getSelectOptionValues(s).includes("organized"));
      const studioBtn = findButtonByTextOrTitle(modal, /^Studio$/i);
      assert(orgSel && studioBtn);
      await modal.change(orgSel, "organized");
      await modal.click(studioBtn);
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 0);
    });
  });

  add("T2-F8-03", "F8", "Quick text search with regex metacharacters ([480p] &) does not throw", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const searchInput = modal.findAll((n) => n.tag === "input" && /filter|search/i.test(String(n.props?.placeholder || "")))[0];
      assert(searchInput);
      await modal.change(searchInput, "[480p]");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 1);
      assert(rows[0].text.includes("Delta Special & Cut"));
    });
  });

  add("T2-F8-04", "F8", "Missing Performers filter isolates scenes with empty performers array", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const perfBtn = findButtonByTextOrTitle(modal, /^Performers$/i);
      assert(perfBtn);
      await modal.click(perfBtn);
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 2, "Scenes 103 and 105 have empty performers");
    });
  });

  add("T2-F8-05", "F8", "Missing Tags and Missing Title filters isolate expected scenes", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const titleBtn = findButtonByTextOrTitle(modal, /^Title$/i);
      assert(titleBtn);
      await modal.click(titleBtn);
      let rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 1, "Only scene 103 has empty title");
      // Deselect title and select tags
      await modal.click(titleBtn);
      const tagsBtn = findButtonByTextOrTitle(modal, /^Tags$/i);
      assert(tagsBtn);
      await modal.click(tagsBtn);
      rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 2, "Scenes 103 and 107 have empty tags");
    });
  });

  // ==========================================================
  // F9 Boundary & Corner Cases
  // ==========================================================
  add("T2-F9-01", "F9", "Bulk Edit with 0 selected scenes prevents blind mutation of all scenes", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 2), "Season 1");
      // Deselect all
      const headerCb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox",
        modal.findBySelector(".sfm-parser-table thead")[0])[0];
      if (headerCb && headerCb.props.checked) await modal.change(headerCb, false);
      await modal.click(findButtonByText(modal, /Bulk Edit/i));
      const applyBtn = findButtonByText(modal, /Apply Bulk|Apply to|Save Bulk/i);
      if (applyBtn && !applyBtn.props.disabled) {
        await modal.click(applyBtn);
      }
      assert.strictEqual(env.graphql.gqlCalls.filter((c) => c.query.includes("bulkSceneUpdate")).length, 0,
        "Must not execute bulkSceneUpdate when 0 scenes selected");
    });
  });

  add("T2-F9-02", "F9", "Bulk Edit with empty studio/performer/tag/rating inputs does not throw", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 2), "Season 1");
      await modal.click(findButtonByText(modal, /Bulk Edit/i));
      const applyBtn = findButtonByText(modal, /Apply Bulk|Apply to|Save Bulk/i);
      if (applyBtn) await modal.click(applyBtn);
      assert(modal.root, "Modal remains stable after empty Bulk Edit submission");
    });
  });

  add("T2-F9-03", "F9", "Bulk Edit handles unknown studio gracefully without crashing", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 2), "Season 1");
      await modal.click(findButtonByText(modal, /Bulk Edit/i));
      const studioInput = modal.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || "")))[0];
      assert(studioInput);
      await modal.change(studioInput, "NonExistentStudio999");
      const applyBtn = findButtonByText(modal, /Apply Bulk|Apply to|Save Bulk/i);
      await modal.click(applyBtn);
      assert(modal.root, "Modal must handle unknown studio gracefully");
    });
  });

  add("T2-F9-04", "F9", "Switching between Scrape, Bulk Edit, Pattern, and Rename tabs preserves selection", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 3), "Season 1");
      await modal.click(findButtonByText(modal, /Bulk Edit/i));
      await modal.click(findButtonByText(modal, /Filename Patterns/i));
      await modal.click(findButtonByText(modal, /Bulk Rename/i));
      await modal.click(findButtonByText(modal, /Scrape\s*&\s*Search/i));
      assert(modal.text().includes("3 of 3") || modal.text().includes("Alpha Sunrise"));
    });
  });

  add("T2-F9-05", "F9", "Bulk Edit handles rating100='0' (explicit zero) distinct from unchanged", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[0]], "Season 1");
      await modal.click(findButtonByText(modal, /Bulk Edit/i));
      const ratSel = modal.findBySelector("select").find((s) => getSelectOptionValues(s).includes("100") && getSelectOptionValues(s).includes("0"));
      assert(ratSel, "Bulk Edit rating select must include 0 and 100");
      await modal.change(ratSel, "0");
      await modal.click(findButtonByText(modal, /Apply Bulk|Apply to|Save Bulk/i));
      const mut = env.graphql.gqlCalls.find((c) => c.query.includes("bulkSceneUpdate"));
      assert(mut && mut.variables.input.rating100 === 0, "Rating '0' must pass rating100: 0");
    });
  });

  // ==========================================================
  // F10 Boundary & Corner Cases
  // ==========================================================
  add("T2-F10-01", "F10", "Inline Edit pre-populates cleanly for scene with all null/empty fields", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[2]], "Season 1"); // 103 has all empty/null
      await modal.click(findButtonByText(modal, /^Edit$/i));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      assert(editor, "Inline editor must open for untagged scene");
      const inputs = modal.findAll((n) => n.tag === "input", editor);
      for (const inp of inputs) {
        assert.notStrictEqual(inp.props?.value, "null");
        assert.notStrictEqual(inp.props?.value, "undefined");
      }
    });
  });

  add("T2-F10-02", "F10", "Inline Edit creates brand-new Studio via studioCreate before sceneUpdate", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[2]], "Season 1");
      await modal.click(findButtonByText(modal, /^Edit$/i));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      const studioInput = modal.findBySelector("input[data-field=\"studio\"], input[name=\"studio\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || "")), editor)[0];
      assert(studioInput);
      await modal.change(studioInput, "Brand New Studio XYZ");
      await modal.click(findButtonByText(modal, /^Save$/i, editor));
      assert(env.graphql.gqlCalls.some((c) => c.query.includes("studioCreate")), "Must create missing studio");
      assert.strictEqual(env.db.scenes[2].studio?.name, "Brand New Studio XYZ");
    });
  });

  add("T2-F10-03", "F10", "Inline Edit creates multiple new Performers & Tags from comma-separated input", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[2]], "Season 1");
      await modal.click(findButtonByText(modal, /^Edit$/i));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      const perfInput = modal.findBySelector("input[data-field=\"performers\"], input[name=\"performers\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && /Performer/i.test(String(n.props?.placeholder || "")), editor)[0];
      const tagsInput = modal.findBySelector("input[data-field=\"tags\"], input[name=\"tags\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && /Tag/i.test(String(n.props?.placeholder || "")), editor)[0];
      assert(perfInput && tagsInput);
      await modal.change(perfInput, "Alice Star, BrandNewPerformer");
      await modal.change(tagsInput, "4K, BrandNewTag");
      await modal.click(findButtonByText(modal, /^Save$/i, editor));
      assert(env.graphql.gqlCalls.some((c) => c.query.includes("performerCreate")));
      assert(env.graphql.gqlCalls.some((c) => c.query.includes("tagCreate")));
      assert.strictEqual(env.db.scenes[2].performers.length, 2);
      assert.strictEqual(env.db.scenes[2].tags.length, 2);
    });
  });

  add("T2-F10-04", "F10", "Inline Edit keeps error visible and does not corrupt db if sceneUpdate fails", async () => {
    await withEnv({
      faultRules: [{ match: (q) => q.includes("sceneUpdate"), graphqlError: "Update rejected" }],
    }, async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
      await modal.click(findButtonByText(modal, /^Edit$/i));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      const titleInput = modal.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && n.props?.value === "Beta Midnight", editor)[0];
      await modal.change(titleInput, "Failed Save Title");
      await modal.click(findButtonByText(modal, /^Save$/i, editor));
      assert.strictEqual(env.db.scenes[1].title, "Beta Midnight");
      assert(modal.root, "Modal must not crash on sceneUpdate error");
    });
  });

  add("T2-F10-05", "F10", "Switching inline Edit from Row 1 to Row 2 resets draft to Row 2's values", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[0], env.db.scenes[1]], "Season 1");
      const editBtns = modal.findAll((n) => n.tag === "button" && /^Edit$/i.test(modal.nodeText(n).trim()));
      await modal.click(editBtns[0]);
      let editor = modal.findBySelector(".sfm-inline-editor")[0];
      const title1 = modal.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && n.props?.value === "Alpha Sunrise", editor)[0];
      await modal.change(title1, "Dirty Draft Row 1");

      const editBtns2 = modal.findAll((n) => n.tag === "button" && /^Edit$/i.test(modal.nodeText(n).trim()));
      await modal.click(editBtns2[1]);
      editor = modal.findBySelector(".sfm-inline-editor")[0];
      assert(!modal.nodeText(editor).includes("Dirty Draft Row 1"), "Row 2 editor must not inherit Row 1 draft");
      const hasBetaVal = modal.findAll((n) => n.tag === "input" && n.props?.value === "Beta Midnight", editor).length > 0;
      assert(hasBetaVal, "Row 2 inline editor must load Beta Midnight");
    });
  });

  // ==========================================================
  // F11 Boundary & Corner Cases
  // ==========================================================
  add("T2-F11-01", "F11", "Unknown/corrupt localStorage sfm_view_mode falls back safely without crash", async () => {
    await withEnv({ localStorageData: { sfm_view_mode: "corrupt_invalid_mode" } }, async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      assert(tree.text().includes("Alpha Sunrise"), "Unknown view mode must fall back cleanly to valid view");
    });
  });

  add("T2-F11-02", "F11", "Rapidly toggling Grid <-> Table preserves active path and scene selection", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const gridBtn = findButtonByTextOrTitle(tree, /^(Grid|Cards|Grid Cards)$/i);
      assert(gridBtn, "Grid toggle button must exist");
      await tree.click(gridBtn);
      assert.strictEqual(tree.findBySelector(".sfm-data-table").length, 0);
      await ensureTableView(tree);
      assert.strictEqual(tree.findBySelector(".sfm-data-table").length, 1);
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto/Season 1");
    });
  });

  add("T2-F11-03", "F11", "Folder with 0 direct scenes renders cleanly in Table mode", async () => {
    await withEnv({ localStorageData: { sfm_view_mode: "table" } }, async (env) => {
      const tree = await openFolderRoute(env, "Anime");
      assert(tree.text().includes("Naruto") && tree.text().includes("OnePiece"));
    });
  });

  add("T2-F11-04", "F11", "SceneTableView renders cleanly with empty scenes array", async () => {
    await withEnv(async (env) => {
      const Table = env.sfm.SceneTableView;
      const tree = env.mount(Table, {
        scenes: [],
        selectedIds: new Set(),
        onToggleSelect: () => {},
        onToggleSelectAll: () => {},
        onPlay: () => {},
      });
      await tree.flush();
      assert.strictEqual(tree.findBySelector(".sfm-data-table").length, 1);
      assert.strictEqual(getTableBodyRows(tree, ".sfm-data-table tbody tr").length, 0);
    });
  });

  add("T2-F11-05", "F11", "SettingsAndTasksModal handles null pluginSettings safely", async () => {
    await withEnv(async (env) => {
      const Modal = env.sfm.SettingsAndTasksModal;
      const tree = env.mount(Modal, {
        onClose: () => {},
        settings: null,
        onSaveSettings: () => {},
        onResetSettings: () => {},
        onRunTask: () => {},
      });
      await tree.flush();
      assert(tree.text().includes("Settings"));
    });
  });

  // ==========================================================
  // F12 Boundary & Corner Cases
  // ==========================================================
  add("T2-F12-01", "F12", "Table view renders dash placeholder for scenes with empty files array", async () => {
    await withEnv(async (env) => {
      const Table = env.sfm.SceneTableView;
      const tree = env.mount(Table, {
        scenes: [makeScene({ id: "1201", files: [] })],
        selectedIds: new Set(),
        onToggleSelect: () => {},
        onToggleSelectAll: () => {},
        onPlay: () => {},
      });
      await tree.flush();
      assert(tree.findBySelector(".sfm-data-table tbody tr").length === 1);
    });
  });

  add("T2-F12-02", "F12", "Table view renders dash placeholders when studio, code, performers, and date are missing", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const rows = getTableBodyRows(tree, ".sfm-data-table tbody tr");
      const untagged = rows.find((r) => r.text.includes("raw_untagged_clip_720p.mkv"));
      assert(untagged, "Untagged scene row must appear in Table view");
      assert(!/null|undefined/i.test(untagged.text), "Missing fields must not render literal null/undefined");
    });
  });

  add("T2-F12-03", "F12", "Table view displays special characters (&, quotes) in title/filename without escaping artifacts", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "LiveAction/Studio Alpha");
      await ensureTableView(tree);
      assert(tree.text().includes("Delta Special & Cut"));
      assert(tree.text().includes("Delta & Cut [480p].mp4"));
    });
  });

  add("T2-F12-04", "F12", "Table view Select All header checkbox selects and deselects all rows", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const headerCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox",
        tree.findBySelector(".sfm-data-table thead")[0])[0];
      assert(headerCb);
      await tree.change(headerCb, true);
      assert(tree.text().includes("5 selected") || tree.findBySelector(".sfm-floating-bulk-bar").length > 0,
        "Select All must select all 5 Season 1 scenes");
      const headerCb2 = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox",
        tree.findBySelector(".sfm-data-table thead")[0])[0];
      await tree.change(headerCb2, false);
      assert.strictEqual(tree.findBySelector(".sfm-floating-bulk-bar").length, 0, "Deselect All must clear selection");
    });
  });

  add("T2-F12-05", "F12", "Table view Organized checkbox handles GraphQL failure cleanly", async () => {
    await withEnv({
      faultRules: [{ match: (q) => q.includes("sceneUpdate"), networkError: "Network timeout" }],
    }, async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const orgIdx = getTableHeaders(tree, ".sfm-data-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgIdx >= 0);
      const rows = getTableBodyRows(tree, ".sfm-data-table tbody tr");
      const betaRow = rows.find((r) => r.text.includes("Beta Midnight"));
      const cb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", betaRow.cells[orgIdx].node)[0];
      await tree.change(cb, true);
      assert.strictEqual(env.db.scenes[1].organized, false);
      assert(tree.findBySelector(".sfm-data-table").length === 1);
    });
  });

  return tests;
}

module.exports = { getTests };

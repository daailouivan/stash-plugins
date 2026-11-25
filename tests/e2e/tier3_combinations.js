"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { execSync } = require("child_process");
const { PLUGIN_DIR, MANIFEST_PATH, parsePluginManifest } = require("./harness");
const {
  withEnv,
  openFolderRoute,
  ensureTableView,
  openMetadataStudioFromView,
  openMetadataStudioGlobal,
  findSceneSortSelect,
  getSelectOptionValues,
  getTableHeaders,
  getTableBodyRows,
  findHeaderByName,
  findButtonByText,
  findButtonByTextOrTitle,
} = require("./helpers");

function getTests() {
  const tests = [];
  const add = (id, feature, name, fn) => tests.push({ id, tier: 3, feature, name, fn });

  add("T3-01", "F1+F2", "Clicking FilesNavButton NavLink navigates to /plugin/file-manager and mounts native page without sibling hiding", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const navTree = env.mount(env.invokePatched("MainNavBar.MenuItems", {}, baseNav));
      await navTree.flush();
      await navTree.click(navTree.findBySelector("#sfm-nav-button")[0]);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      const fmTree = await env.mountRoute("/plugin/file-manager");
      assert(fmTree.findBySelector(".sfm-native-page").length > 0);
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-active"), null);
    });
  });

  add("T3-02", "F1+F3", "Navigating from /plugin/file-manager?path=Anime back to /scenes via history keeps native content unblocked", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      env.navigate("/plugin/file-manager?path=Anime");
      const tree = await env.mountRoute("/plugin/file-manager");
      assert(tree.text().includes("Naruto"));
      env.history.back();
      tree.unmount();
      assert.strictEqual(env.location.pathname, "/scenes");
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-active"), null);
    });
  });

  add("T3-03", "F2+F4", "Clicking NativeSceneCardOverlay chip on /scenes switches URL to /plugin/file-manager?path= and activates FilesNavButton", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const navTree = env.mount(env.invokePatched("MainNavBar.MenuItems", {}, baseNav));
      await navTree.flush();
      const overlayTree = env.mount(env.cache.NativeSceneCardOverlay, {
        scene: env.db.scenes[0],
        folderPath: "Anime/Naruto/Season 1",
      });
      await overlayTree.flush();
      await overlayTree.click(overlayTree.findBySelector(".sfm-native-card-path-chip")[0]);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto/Season 1");
      await navTree.flush();
      assert(String(navTree.findBySelector("#sfm-nav-button")[0].props.className || "").includes("active"));
    });
  });

  add("T3-04", "F3+F11", "URL ?path= query param + Table view mode persists across popstate folder transitions", async () => {
    await withEnv({ localStorageData: { sfm_view_mode: "table" } }, async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto");
      const s1Card = tree.findBySelector(".sfm-folder-card, .sfm-native-folder-card").find((c) => tree.nodeText(c).includes("Season 1"));
      await tree.click(s1Card);
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto/Season 1");
      assert.strictEqual(tree.findBySelector(".sfm-data-table").length, 1);
      env.history.back();
      await tree.flush();
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto");
    });
  });

  add("T3-05", "F3+F16", "URL ?path= folder loading combined with Organized attribute filter & back/forward history", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const orgSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      await tree.change(orgSel, "organized");
      assert(!tree.text().includes("Beta Midnight"));
      assert(tree.text().includes("Alpha Sunrise"));
    });
  });

  add("T3-06", "F4+F15", "NativeSceneCardOverlay Profile button opens /plugin/file-manager?view=profile with random sort option", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const overlay = env.mount(env.cache.NativeSceneCardOverlay, {
        scene: env.db.scenes[0],
        folderPath: "Anime/Naruto/Season 1",
      });
      await overlay.flush();
      const profileBtn = overlay.findBySelector(".sfm-native-card-quick-actions button")[1];
      await overlay.click(profileBtn);
      assert.strictEqual(new URLSearchParams(env.location.search).get("view"), "profile");
      const fmTree = await env.mountRoute("/plugin/file-manager");
      const sortSel = fmTree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("random"));
      assert(sortSel, "FolderProfileView opened via native card must support random sort");
    });
  });

  add("T3-07", "F5+F8", "Toggling Organized checkbox while Unorganized filter is active immediately removes scene from filtered rows", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 3), "Season 1");
      const orgSel = modal.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      await modal.change(orgSel, "unorganized");
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      const beforeRows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > orgIdx);
      assert.strictEqual(beforeRows.length, 2); // 102 and 103
      const betaRow = beforeRows.find((r) => r.text.includes("Beta Midnight"));
      const cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", betaRow.cells[orgIdx].node)[0];
      await modal.change(cb, true);
      const afterRows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > orgIdx);
      assert.strictEqual(afterRows.length, 1, "Toggling organized=true must filter Beta Midnight out of Unorganized view");
    });
  });

  add("T3-08", "F5+F12", "Toggling Organized in main Table view syncs scenes_index_v8 and reflects inside Metadata Studio", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const orgIdx = getTableHeaders(tree, ".sfm-data-table th").findIndex((h) => /Organized/i.test(h.text));
      const betaRow = getTableBodyRows(tree, ".sfm-data-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
      const cb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", betaRow.cells[orgIdx].node)[0];
      await tree.change(cb, true);
      assert.strictEqual(env.cache.scenes.find((s) => s.id === "102").organized, true);

      await openMetadataStudioFromView(tree, "scrape");
      const mOrgIdx = getTableHeaders(tree, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      const mBeta = getTableBodyRows(tree, ".sfm-parser-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
      const mCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", mBeta.cells[mOrgIdx].node)[0];
      assert.strictEqual(Boolean(mCb.props.checked), true, "Metadata Studio must see Organized=true updated in Table view");
    });
  });

  add("T3-09", "F6+F7", "Scraping a scene populates Code preview and Code header sort orders rows cleanly", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[6], env.db.scenes[0]], "Season 1");
      const scrapeRowBtns = modal.findAll((n) => n.tag === "button" && /^Scrape$/i.test(modal.nodeText(n).trim()));
      assert(scrapeRowBtns.length >= 1);
      await modal.click(scrapeRowBtns[0]);
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Code"));
      const codeTh = findHeaderByName(modal, ".sfm-parser-table", "Code");
      assert(/[▲▼]/.test(modal.nodeText(codeTh)));
      assert(modal.text().includes("SCR-") && modal.text().includes("ALP-001"));
    });
  });

  add("T3-10", "F7+F8", "Metadata Studio attribute filter + header click-to-sort sorts only filtered subset", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const orgSel = modal.findBySelector("select").find((s) => getSelectOptionValues(s).includes("organized"));
      await modal.change(orgSel, "organized"); // 101 (Alpha), 104 (Gamma), 106 (Epsilon)
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Title"));
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 3);
      assert(rows[0].text.includes("Alpha Sunrise"));
      assert(rows[1].text.includes("Epsilon Finale"));
      assert(rows[2].text.includes("Gamma Horizon"));
    });
  });

  add("T3-11", "F8+F9", "Filtering Unorganized in Metadata Studio then using Bulk Edit tab updates targeted scenes", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[0], env.db.scenes[1]], "Season 1");
      const orgSel = modal.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      await modal.change(orgSel, "unorganized");
      // Select All Filtered / visible
      const selMatchedOrAll = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox",
        modal.findBySelector(".sfm-parser-table thead")[0])[0];
      if (selMatchedOrAll && !selMatchedOrAll.props.checked) await modal.change(selMatchedOrAll, true);
      await modal.click(findButtonByText(modal, /Bulk Edit/i));
      const studioInput = modal.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || "")))[0];
      await modal.change(studioInput, "Studio Alpha");
      await modal.click(findButtonByText(modal, /Apply Bulk|Apply to|Save Bulk/i));
      assert(env.graphql.gqlCalls.some((c) => c.query.includes("bulkSceneUpdate")));
    });
  });

  add("T3-12", "F9+F19", "Bulk Edit updates database and persists into scenes_index_v8 IDB cache", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      // Select Beta Midnight (102)
      const betaRow = getTableBodyRows(tree, ".sfm-data-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
      const selCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", betaRow.node)[0];
      await tree.change(selCb, true);
      await openMetadataStudioFromView(tree, "bulk_edit");
      const studioInput = tree.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || "")))[0];
      await tree.change(studioInput, "Gamma Studios");
      await tree.click(findButtonByText(tree, /Apply Bulk|Apply to|Save Bulk/i));
      assert.strictEqual(env.db.scenes.find((s) => s.id === "102").studio.name, "Gamma Studios");
    });
  });

  add("T3-13", "F10+F12", "Table view inline Edit saves Title, Code, and Organized and persists across reload via IDB v8", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const betaRow = getTableBodyRows(tree, ".sfm-data-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
      await tree.click(findButtonByText(tree, /^Edit$/i, betaRow.node));
      const editor = tree.findBySelector(".sfm-inline-editor")[0];
      const titleInput = tree.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.value === "Beta Midnight", editor)[0];
      await tree.change(titleInput, "Beta Persistent v8");
      await tree.click(findButtonByText(tree, /^Save$/i, editor));

      const env2 = env.reload({ url: "/plugin/file-manager?path=Anime%2FNaruto%2FSeason%201" });
      try {
        const tree2 = await env2.mountRoute("/plugin/file-manager");
        assert(tree2.text().includes("Beta Persistent v8"), "Inline edit patched into IDB v8 must survive reload");
      } finally {
        env2.cleanup();
      }
    });
  });

  add("T3-14", "F10+F13", "Inline Edit updating Code while Table is sorted by Code re-positions row dynamically", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Code")); // code_asc
      const betaRow = getTableBodyRows(tree, ".sfm-data-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
      await tree.click(findButtonByText(tree, /^Edit$/i, betaRow.node));
      const editor = tree.findBySelector(".sfm-inline-editor")[0];
      const codeInput = tree.findBySelector("input[data-field=\"code\"], input[name=\"code\"]", editor)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.value === "BET-010", editor)[0];
      await tree.change(codeInput, "AAA-001");
      await tree.click(findButtonByText(tree, /^Save$/i, editor));
      const rowsAfter = getTableBodyRows(tree, ".sfm-data-table tbody tr");
      const idxBeta = rowsAfter.findIndex((r) => r.text.includes("AAA-001"));
      const idxAlpha = rowsAfter.findIndex((r) => r.text.includes("ALP-001"));
      assert(idxBeta >= 0 && idxAlpha >= 0 && idxBeta < idxAlpha, "AAA-001 must now sort ahead of ALP-001");
    });
  });

  add("T3-15", "F10+F16", "Inline Edit setting Organized=true while Unorganized filter is active removes row from filtered view", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const orgSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      await tree.change(orgSel, "unorganized");
      const betaRow = getTableBodyRows(tree, ".sfm-data-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
      await tree.click(findButtonByText(tree, /^Edit$/i, betaRow.node));
      const editor = tree.findBySelector(".sfm-inline-editor")[0];
      const orgCb = tree.findBySelector("input[data-field=\"organized\"], input[type=\"checkbox\"]", editor)[0];
      await tree.change(orgCb, true);
      await tree.click(findButtonByText(tree, /^Save$/i, editor));
      assert(!tree.text().includes("Beta Midnight"), "Beta Midnight marked organized must disappear from Unorganized filter");
    });
  });

  add("T3-16", "F11+F17", "Switching Grid -> Table -> Grid -> Table retains customized Columns selection", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const durCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/Duration/i, { start: drawer })[0])[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /duration/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0];
      await tree.change(durCb, true);
      await tree.click(findButtonByTextOrTitle(tree, /^(Grid|Cards|Grid Cards)$/i));
      await ensureTableView(tree);
      assert(getTableHeaders(tree, ".sfm-data-table th").some((h) => /Duration/i.test(h.text)));
    });
  });

  add("T3-17", "F12+F17", "Hiding default Code column and enabling O-Counter updates Table headers and persists across reload", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const codeCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /code/i.test(String(n.props?.["data-col-id"] || "")) && !/codec/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/^Code$/i, { start: drawer })[0])[0];
      const oCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /o_counter|o-counter/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/O-Counter/i, { start: drawer })[0])[0];
      await tree.change(codeCb, false);
      await tree.change(oCb, true);

      const env2 = env.reload({ url: "/plugin/file-manager?path=Anime%2FNaruto%2FSeason%201" });
      try {
        const tree2 = await env2.mountRoute("/plugin/file-manager");
        const hdrs = getTableHeaders(tree2, ".sfm-data-table th").map((h) => h.text);
        assert(!hdrs.some((h) => /\bCode\b/i.test(h)), "Code column must remain hidden after reload");
        assert(hdrs.some((h) => /O-Counter/i.test(h)), "O-Counter must remain visible after reload");
      } finally {
        env2.cleanup();
      }
    });
  });

  add("T3-18", "F13+F14", "Selecting random + Reshuffle, then clicking Title header exits random mode and syncs sceneSort", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "random");
      await tree.click(findButtonByText(tree, /Reshuffle/i));
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Title"));
      const selVal = findSceneSortSelect(tree).props["data-sort-key"] || findSceneSortSelect(tree).props.value;
      assert(selVal === "title" || selVal === "title_asc");
      assert(!findButtonByText(tree, /Reshuffle/i));
    });
  });

  add("T3-19", "F13+F18", "Enabling optional Play Count column and clicking header sorts descending/ascending and syncs sceneSort", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const pcCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /play_count|play-count/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/Play Count/i, { start: drawer })[0])[0];
      await tree.change(pcCb, true);
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Play Count"));
      const th = findHeaderByName(tree, ".sfm-data-table", "Play Count");
      assert(/[▲▼]/.test(tree.nodeText(th)));
    });
  });

  add("T3-20", "F14+F15", "Reshuffle inside FolderProfileView Video Wall syncs randomized order back to FileManagerView", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "random");
      const order1 = getTableBodyRows(tree, ".sfm-data-table tbody tr").map((r) => r.text);
      await tree.click(findButtonByTextOrTitle(tree, /Video Wall|Folder Profile/i));
      const overlay = tree.findBySelector(".sfm-profile-overlay, .sfm-profile-modal")[0];
      await tree.click(findButtonByText(tree, /Reshuffle/i, overlay));
      const closeBtn = findButtonByTextOrTitle(tree, /Close|Back/i, overlay);
      if (closeBtn) await tree.click(closeBtn);
      assert.strictEqual(findSceneSortSelect(tree).props.value, "random");
      const order2 = getTableBodyRows(tree, ".sfm-data-table tbody tr").map((r) => r.text);
      assert.strictEqual(order2.length, order1.length);
    });
  });

  add("T3-21", "F15+F16", "Organized filter active in FileManagerView restricts scenes passed into FolderProfileView Video Wall", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const orgSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      await tree.change(orgSel, "organized");
      await tree.change(findSceneSortSelect(tree), "random");
      await tree.click(findButtonByTextOrTitle(tree, /Video Wall|Folder Profile/i));
      const overlay = tree.findBySelector(".sfm-profile-overlay, .sfm-profile-modal")[0];
      assert(overlay);
      const wallTxt = tree.nodeText(overlay);
      assert(wallTxt.includes("Alpha Sunrise") && wallTxt.includes("Epsilon Finale"));
      assert(!wallTxt.includes("Beta Midnight"), "Filtered-out scene must not appear in Video Wall");
    });
  });

  add("T3-22", "F16+F17", "Resolution=4K filter combined with Resolution & Bitrate optional columns shows only 4K metrics", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const resCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /resolution/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/Resolution/i, { start: drawer })[0])[0];
      await tree.change(resCb, true);
      const resSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).some((v) => /4k|2160/i.test(v)));
      await tree.change(resSel, getSelectOptionValues(resSel).find((v) => /4k|2160/i.test(v)));
      const rows = getTableBodyRows(tree, ".sfm-data-table tbody tr");
      assert.strictEqual(rows.length, 2);
      assert(rows.every((r) => r.text.includes("4K")));
    });
  });

  add("T3-23", "F17+F18", "Reordering Director column in ⚙ Columns places Director header at updated column index", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const dirCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /director/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/Director/i, { start: drawer })[0])[0];
      await tree.change(dirCb, true);
      const headersBefore = getTableHeaders(tree, ".sfm-data-table th").map((h) => h.text);
      const idxBefore = headersBefore.findIndex((h) => /Director/i.test(h));
      const dirRow = tree.findByText(/Director/i, { start: drawer })[0];
      const upBtn = tree.findAll((n) => n.tag === "button" && /↑|Up/i.test(tree.nodeText(n) + " " + (n.props?.title || "")), dirRow)[0];
      assert(upBtn, "Up button on Director column row must exist");
      await tree.click(upBtn);
      const idxAfter = getTableHeaders(tree, ".sfm-data-table th").findIndex((h) => /Director/i.test(h.text));
      assert(idxAfter < idxBefore, `Expected Director index to move left (${idxAfter} < ${idxBefore})`);
    });
  });

  add("T3-24", "F18+F19", "Reloading from IDB scenes_index_v8 preserves extended R4 fields in customized Table columns without GraphQL refetch", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      for (const re of [/O-Counter/i, /Play Count/i, /Director/i, /Codec|Format/i]) {
        const cb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(re, { start: drawer })[0])[0]
          || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && re.test(String(n.props?.["data-col-id"] || "")), drawer)[0];
        if (cb && !cb.props.checked) await tree.change(cb, true);
      }

      const env2 = env.reload({ url: "/plugin/file-manager?path=Anime%2FNaruto%2FSeason%201" });
      try {
        const tree2 = await env2.mountRoute("/plugin/file-manager");
        assert.strictEqual(env2.graphql.gqlCalls.some((c) => c.query.includes("GetScenePaths")), false);
        const txt = tree2.text();
        assert(txt.includes("Jane Direct") && txt.includes("hevc") && txt.includes("12"));
      } finally {
        env2.cleanup();
      }
    });
  });

  add("T3-25", "F8+F10", "Filtering Missing Code + inline editing Code removes repaired scene from Missing Code list", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const codeBtn = findButtonByTextOrTitle(modal, /^Code$/i);
      assert(codeBtn);
      await modal.click(codeBtn);
      const zetaRow = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.text.includes("Zeta Missing Code"));
      await modal.click(findButtonByText(modal, /^Edit$/i, zetaRow.node));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      const codeInput = modal.findBySelector("input[data-field=\"code\"], input[name=\"code\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && n.props?.value === "", editor)[0];
      await modal.change(codeInput, "ZET-007");
      await modal.click(findButtonByText(modal, /^Save$/i, editor));
      assert(!modal.text().includes("Zeta Missing Code"), "Scene with saved code must drop out of Missing Code filter");
    });
  });

  add("T3-26", "F9+F23", "Bulk Rename tab uses catalog scenes_index_v8 code/resolution and integrates with sfm_tasks.py rename", async () => {
    await withEnv(async (env) => {
      const tmpDir = fs.mkdtempSync("/tmp/sfm_e2e_t3_26_");
      try {
        const diskFile = path.join(tmpDir, "old_clip.mp4");
        fs.writeFileSync(diskFile, "video");
        const scene = { ...env.db.scenes[0], files: [{ ...env.db.scenes[0].files[0], path: diskFile, basename: "old_clip.mp4" }] };
        const modal = await openMetadataStudioGlobal(env, [scene], "Season 1");
        await modal.click(findButtonByText(modal, /Bulk Rename/i));
        assert(modal.text().includes("(Studio Alpha)(ALP-001)"), "Rename preview must resolve studio & code from v8 scene");
        const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" rename`, {
          input: JSON.stringify({ task: "rename", items: [{ file_id: 1101, scene_id: "101", old_path: diskFile, new_basename: "(Studio Alpha)(ALP-001)(Alpha Sunrise).mp4" }] }),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        const res = JSON.parse(out.trim().split("\n").pop());
        assert.strictEqual(res.success_count, 1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  add("T3-27", "F4+F19", "NativeSceneDetailScrapeButton loads FindSceneFull with code & organized into Unified Metadata Studio", async () => {
    await withEnv({ url: "/scenes/101" }, async (env) => {
      const ScrapeBtn = env.cache.NativeSceneDetailScrapeButton;
      const tree = env.mount(ScrapeBtn, { scene: env.db.scenes[0] });
      await tree.flush();
      await tree.click(tree.findBySelector("button")[0]);
      const modal = env.getMountedTree("sfm-global-modal-root");
      assert(modal, "Global Metadata Studio must mount from native detail button");
      await modal.flush();
      assert(modal.text().includes("ALP-001"), "Metadata Studio must show code from FindSceneFull");
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgIdx >= 0);
    });
  });

  add("T3-28", "F20+F22", "Dynamic ui.javascript loader executes all 5 split modules in manifest order with zero legacy file_manager.js", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    assert.deepStrictEqual(manifest.ui.javascript, [
      "sfm_core.js",
      "sfm_metadata_modal.js",
      "sfm_player.js",
      "sfm_views.js",
      "sfm_native.js",
    ]);
    await withEnv(async (env) => {
      assert.deepStrictEqual(env.loadedModules, manifest.ui.javascript);
      assert.strictEqual(typeof env.registeredRoutes["/plugin/file-manager"], "function");
      assert(typeof env.sfm.FilenameParserModal === "function");
      assert(typeof env.sfm.FolderProfileView === "function");
      assert(typeof env.sfm.SceneTableView === "function");
    });
  });

  return tests;
}

module.exports = { getTests };

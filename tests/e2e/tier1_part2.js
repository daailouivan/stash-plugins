"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { execSync } = require("child_process");
const {
  REPO_ROOT,
  PLUGIN_DIR,
  MANIFEST_PATH,
  CSS_PATH,
  INDEX_YML_PATH,
  ZIP_PATH,
  parsePluginManifest,
  parseIndexYml,
  computeFileSha256,
  listZipEntries,
} = require("./harness");
const {
  withEnv,
  openFolderRoute,
  ensureTableView,
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
  const add = (id, feature, name, fn) => tests.push({ id, tier: 1, feature, name, fn });

  // ==========================================================
  // F13: Synchronized Table header <-> sceneSort
  // ==========================================================
  add("T1-F13-01", "F13", "Clicking Table Title header updates sceneSort dropdown value to title_asc/title_desc", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "date");
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Title"));
      const selVal1 = findSceneSortSelect(tree).props["data-sort-key"] || findSceneSortSelect(tree).props.value;
      assert(selVal1 === "title_asc" || selVal1 === "title");
      const dirBtn1 = tree.findBySelector(".sfm-scene-sort-wrap .sfm-sort-dir-btn")[0];
      if (dirBtn1) assert.strictEqual(dirBtn1.props["data-sort-dir"], "asc");
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Title"));
      const selVal2 = findSceneSortSelect(tree).props["data-sort-key"] || findSceneSortSelect(tree).props.value;
      assert(selVal2 === "title_desc" || selVal2 === "title");
      const dirBtn2 = tree.findBySelector(".sfm-scene-sort-wrap .sfm-sort-dir-btn")[0];
      if (dirBtn2) assert.strictEqual(dirBtn2.props["data-sort-dir"], "desc");
    });
  });

  add("T1-F13-02", "F13", "Changing sceneSort dropdown updates active Table header ▲/▼ indicator", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "date_desc");
      const dateTh = findHeaderByName(tree, ".sfm-data-table", "Date");
      assert(tree.nodeText(dateTh).includes("▼"), "Date header must display ▼ when sceneSort='date_desc'");
      await tree.change(findSceneSortSelect(tree), "studio_asc");
      const studioTh = findHeaderByName(tree, ".sfm-data-table", "Studio");
      assert(tree.nodeText(studioTh).includes("▲"), "Studio header must display ▲ when sceneSort='studio_asc'");
    });
  });

  add("T1-F13-03", "F13", "Clicking Code header in Table sorts rows by code and syncs sceneSort", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Code"));
      const sel = findSceneSortSelect(tree);
      const selVal = sel.props["data-sort-key"] || sel.props.value;
      assert(selVal === "code" || selVal === "code_asc" || selVal === "code_desc", `Expected code sort, got ${selVal}`);
      const codeTh = findHeaderByName(tree, ".sfm-data-table", "Code");
      assert(/[▲▼]/.test(tree.nodeText(codeTh)));
    });
  });

  add("T1-F13-04", "F13", "Clicking Organized header in Table sorts by organized status and syncs sceneSort", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Organized"));
      const sel = findSceneSortSelect(tree);
      const selVal = sel.props["data-sort-key"] || sel.props.value;
      assert(selVal === "organized" || selVal === "organized_asc" || selVal === "organized_desc", `Expected organized sort, got ${selVal}`);
    });
  });

  add("T1-F13-05", "F13", "Clicking Filename header sorts by file basename and syncs sceneSort", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Filename"));
      const sel = findSceneSortSelect(tree);
      const selVal = sel.props["data-sort-key"] || sel.props.value;
      assert(selVal === "filename" || selVal === "filename_asc" || selVal === "filename_desc", `Expected filename sort, got ${selVal}`);
      const rows = getTableBodyRows(tree, ".sfm-data-table tbody tr");
      assert(rows.length === 5);
    });
  });

  // ==========================================================
  // F14: True Randomize (random) + Reshuffle
  // ==========================================================
  add("T1-F14-01", "F14", "sceneSort dropdown includes 'random' (Random / Shuffle) option", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const opts = getSelectOptionValues(findSceneSortSelect(tree));
      assert(opts.includes("random"), `sceneSort options must include 'random', got: ${opts.join(", ")}`);
    });
  });

  add("T1-F14-02", "F14", "Selecting 'random' in sceneSort renders a Reshuffle button", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      assert(!findButtonByText(tree, /Reshuffle/i), "Reshuffle button should not appear before random sort");
      await tree.change(findSceneSortSelect(tree), "random");
      assert(findButtonByText(tree, /Reshuffle/i), "Reshuffle button must render when random sort is active");
    });
  });

  add("T1-F14-03", "F14", "Random sort order remains stable across unrelated UI re-renders", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "random");
      const orderBefore = getTableBodyRows(tree, ".sfm-data-table tbody tr").map((r) => r.text);
      // Toggle a checkbox in first row -> triggers state re-render
      const cb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findBySelector(".sfm-data-table tbody")[0])[0];
      await tree.change(cb, true);
      const orderAfter = getTableBodyRows(tree, ".sfm-data-table tbody tr").map((r) => r.text);
      assert.deepStrictEqual(orderAfter, orderBefore, "Unrelated selection re-render must NOT reshuffle order");
    });
  });

  add("T1-F14-04", "F14", "Clicking Reshuffle generates a new permutation while preserving all scenes", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "random");
      const getIds = () => getTableBodyRows(tree, ".sfm-data-table tbody tr").map((r) => r.text.slice(0, 60));
      const first = getIds();
      let changed = false;
      for (let i = 0; i < 4; i++) {
        await tree.click(findButtonByText(tree, /Reshuffle/i));
        const next = getIds();
        assert.strictEqual(next.length, first.length, "Reshuffle must preserve exact scene count");
        if (JSON.stringify(next) !== JSON.stringify(first)) {
          changed = true;
          break;
        }
      }
      assert(changed, "Clicking Reshuffle must produce a new scene order");
    });
  });

  add("T1-F14-05", "F14", "sortScenesWithOrder deterministic seeded shuffle helper preserves all items", async () => {
    await withEnv(async (env) => {
      assert.strictEqual(typeof env.sfm.sortScenesWithOrder, "function", "window.__SFM__.sortScenesWithOrder must exist");
      const items = env.db.scenes;
      const a1 = env.sfm.sortScenesWithOrder(items, "random", 42).map((s) => s.id);
      const a2 = env.sfm.sortScenesWithOrder(items, "random", 42).map((s) => s.id);
      const b1 = env.sfm.sortScenesWithOrder(items, "random", 99).map((s) => s.id);
      assert.deepStrictEqual(a1, a2, "Same seed must produce identical deterministic order");
      assert.notDeepStrictEqual(a1, b1, "Different seeds must produce different orders");
      assert.deepStrictEqual([...a1].sort(), items.map((s) => s.id).sort(), "Shuffle must not drop or duplicate scenes");
    });
  });

  // ==========================================================
  // F15: Video Wall random & sort sync
  // ==========================================================
  add("T1-F15-01", "F15", "FolderProfileView profileSort selector includes 'random' option", async () => {
    await withEnv(async (env) => {
      const FPV = env.sfm.FolderProfileView;
      assert.strictEqual(typeof FPV, "function", "window.__SFM__.FolderProfileView must exist");
      const tree = env.mount(FPV, {
        folderName: "Season 1",
        currentFolderPath: "Anime/Naruto/Season 1",
        scenes: env.db.scenes.slice(0, 5),
        onSelectScene: () => {},
        onClose: () => {},
      });
      await tree.flush();
      const sortSel = tree.findBySelector("select").find((s) => {
        const opts = getSelectOptionValues(s);
        return opts.includes("date_desc") || opts.includes("date");
      });
      assert(sortSel, "FolderProfileView profileSort <select> must exist");
      assert(getSelectOptionValues(sortSel).includes("random"), "profileSort must include 'random' option");
    });
  });

  add("T1-F15-02", "F15", "Selecting 'random' in FolderProfileView renders Reshuffle button and shuffles wall", async () => {
    await withEnv(async (env) => {
      const FPV = env.sfm.FolderProfileView;
      assert.strictEqual(typeof FPV, "function");
      const tree = env.mount(FPV, {
        folderName: "Season 1",
        currentFolderPath: "Anime/Naruto/Season 1",
        scenes: env.db.scenes,
        onSelectScene: () => {},
        onClose: () => {},
      });
      await tree.flush();
      const sortSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("random"));
      await tree.change(sortSel, "random");
      const reshuffleBtn = findButtonByText(tree, /Reshuffle/i);
      assert(reshuffleBtn, "FolderProfileView must render Reshuffle button when random is active");
      await tree.click(reshuffleBtn);
    });
  });

  add("T1-F15-03", "F15", "FileManagerView sceneSort='random' propagates to FolderProfileView Video Wall", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await tree.change(findSceneSortSelect(tree), "random");
      const wallBtn = findButtonByTextOrTitle(tree, /Video Wall|Folder Profile/i);
      assert(wallBtn, "Video Wall launch button must exist in FileManagerView");
      await tree.click(wallBtn);
      const profileSelect = tree.findBySelector(".sfm-profile-overlay select, .sfm-profile-modal select, select")
        .find((s) => getSelectOptionValues(s).includes("random") && s.props?.value === "random");
      assert(profileSelect, "Video Wall profileSort must inherit 'random' from FileManagerView sceneSort");
    });
  });

  add("T1-F15-04", "F15", "Changing profileSort in Video Wall synchronizes back to FileManagerView sceneSort", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const wallBtn = findButtonByTextOrTitle(tree, /Video Wall|Folder Profile/i);
      assert(wallBtn);
      await tree.click(wallBtn);
      const profileSelects = tree.findBySelector("select").filter((s) => getSelectOptionValues(s).includes("random"));
      const pSel = profileSelects[profileSelects.length - 1];
      await tree.change(pSel, "random");
      const closeBtn = findButtonByTextOrTitle(tree, /Close|Back/i, tree.findBySelector(".sfm-profile-overlay, .sfm-profile-modal")[0]);
      if (closeBtn) await tree.click(closeBtn);
      assert.strictEqual(findSceneSortSelect(tree).props.value, "random",
        "FileManagerView sceneSort must synchronize when profileSort changes in Video Wall");
    });
  });

  add("T1-F15-05", "F15", "Standalone FolderProfileView persists profileSort='random' in localStorage sfm_profile_scene_sort", async () => {
    await withEnv(async (env) => {
      const FPV = env.sfm.FolderProfileView;
      assert.strictEqual(typeof FPV, "function");
      const tree = env.mount(FPV, {
        folderName: "Season 1",
        currentFolderPath: "Anime/Naruto/Season 1",
        scenes: env.db.scenes,
        onSelectScene: () => {},
        onClose: () => {},
      });
      await tree.flush();
      const sortSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("random"));
      await tree.change(sortSel, "random");
      assert.strictEqual(env.localStorage.getItem("sfm_profile_scene_sort"), "random");
    });
  });

  // ==========================================================
  // F16: Main browsing attribute filter bar
  // ==========================================================
  add("T1-F16-01", "F16", "Main browsing view renders attribute filter bar with Organized filter", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const orgSel = tree.findBySelector("select").find((s) =>
        getSelectOptionValues(s).includes("unorganized") && getSelectOptionValues(s).includes("organized")
      );
      assert(orgSel, "Main view must provide Organized/Unorganized filter");
      await tree.change(orgSel, "organized");
      const txt = tree.text();
      assert(txt.includes("Alpha Sunrise") && txt.includes("Epsilon Finale"));
      assert(!txt.includes("Beta Midnight"), "Organized filter must hide unorganized Beta Midnight");
    });
  });

  add("T1-F16-02", "F16", "Main browsing Missing Metadata filter isolates scenes missing Studio or Code", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const codeBtn = findButtonByTextOrTitle(tree, /^Code$/i);
      assert(codeBtn, "Main view must provide Missing Code filter button");
      await tree.click(codeBtn);
      const txt = tree.text();
      assert(txt.includes("Zeta Missing Code"), "Missing Code filter must keep Zeta Missing Code");
      assert(!txt.includes("Alpha Sunrise"), "Missing Code filter must hide scenes that have a code");
    });
  });

  add("T1-F16-03", "F16", "Main browsing Resolution filter isolates 4K scenes", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const resSel = tree.findBySelector("select").find((s) =>
        getSelectOptionValues(s).some((v) => /4k|2160/i.test(v)) &&
        getSelectOptionValues(s).some((v) => /1080/i.test(v))
      );
      assert(resSel, "Main view must provide Resolution filter");
      const val4k = getSelectOptionValues(resSel).find((v) => /4k|2160/i.test(v));
      await tree.change(resSel, val4k);
      const txt = tree.text();
      assert(txt.includes("Alpha Sunrise") && txt.includes("Epsilon Finale"));
      assert(!txt.includes("Beta Midnight"), "4K filter must exclude 1080p Beta Midnight");
    });
  });

  add("T1-F16-04", "F16", "Main browsing Minimum Rating filter isolates >= 4 star scenes", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const ratSel = tree.findBySelector("select").find((s) =>
        getSelectOptionValues(s).some((v) => v === "80" || v === "4")
      );
      assert(ratSel, "Main view must provide Minimum Rating filter");
      const val4 = getSelectOptionValues(ratSel).find((v) => v === "80" || v === "4");
      await tree.change(ratSel, val4);
      const txt = tree.text();
      assert(txt.includes("Alpha Sunrise") && txt.includes("Epsilon Finale"));
      assert(!txt.includes("Beta Midnight"), "Min rating 4★ (80) must exclude 3★ (60) Beta Midnight");
    });
  });

  add("T1-F16-05", "F16", "Main browsing attribute filter Clear/Reset restores all scenes", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const orgSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      assert(orgSel);
      await tree.change(orgSel, "organized");
      assert(!tree.text().includes("Beta Midnight"));
      const clearBtn = findButtonByText(tree, /Clear Filters|Reset Filters/i);
      if (clearBtn) {
        await tree.click(clearBtn);
      } else {
        await tree.change(orgSel, "all");
      }
      assert(tree.text().includes("Beta Midnight"), "Resetting filters must restore Beta Midnight");
    });
  });

  // ==========================================================
  // F17: ⚙ Columns configuration drawer
  // ==========================================================
  add("T1-F17-01", "F17", "Table view provides ⚙ Columns button that opens configuration drawer", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const colBtn = findButtonByText(tree, /Columns/i);
      assert(colBtn, "⚙ Columns button must exist in Table view");
      await tree.click(colBtn);
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      assert(drawer, "Columns configuration drawer must open when clicked");
    });
  });

  add("T1-F17-02", "F17", "Columns drawer toggles column visibility in live Table view", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      assert(drawer);
      // Enable Rating and hide Code
      const ratingRow = tree.findByText(/\bRating\b/i, { start: drawer })[0];
      const ratingCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", ratingRow)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /rating/i.test(String(n.props?.["data-col-id"] || n.props?.name || "")), drawer)[0];
      assert(ratingCb, "Rating checkbox must exist in Columns drawer");
      await tree.change(ratingCb, true);
      const headers = getTableHeaders(tree, ".sfm-data-table th").map((h) => h.text);
      assert(headers.some((h) => /Rating/i.test(h)), "Enabling Rating column must render Rating header");
    });
  });

  add("T1-F17-03", "F17", "Columns drawer reorders columns via move up/down controls", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const before = getTableHeaders(tree, ".sfm-data-table th").map((h) => h.text);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const moveUpBtns = tree.findAll((n) => n.tag === "button" && /↑|Up/i.test(tree.nodeText(n) + " " + (n.props?.title || "")), drawer);
      assert(moveUpBtns.length > 0, "Reorder up/down buttons must exist in Columns drawer");
      await tree.click(moveUpBtns[Math.min(3, moveUpBtns.length - 1)]);
      const after = getTableHeaders(tree, ".sfm-data-table th").map((h) => h.text);
      assert.notDeepStrictEqual(after, before, "Reordering columns must change header order");
    });
  });

  add("T1-F17-04", "F17", "Columns preferences persist in localStorage sfm_table_columns_v1 across page reload", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const oCounterCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /o_counter|o-counter/i.test(String(n.props?.["data-col-id"] || n.props?.name || "")), drawer)[0]
        || (() => {
          const r = tree.findByText(/O-Counter/i, { start: drawer })[0];
          return r ? tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", r)[0] : null;
        })();
      assert(oCounterCb, "O-Counter toggle must exist in Columns drawer");
      await tree.change(oCounterCb, true);
      assert(env.localStorage.getItem("sfm_table_columns_v1"), "Column config must persist in sfm_table_columns_v1");

      const env2 = env.reload({ url: "/plugin/file-manager?path=Anime%2FNaruto%2FSeason%201" });
      try {
        const tree2 = await env2.mountRoute("/plugin/file-manager");
        const headers2 = getTableHeaders(tree2, ".sfm-data-table th").map((h) => h.text);
        assert(headers2.some((h) => /O-Counter/i.test(h)), "O-Counter column must persist across page reload");
      } finally {
        env2.cleanup();
      }
    });
  });

  add("T1-F17-05", "F17", "Columns drawer Reset to Defaults restores original 10 columns", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const ratingItem = tree.findByText(/\bRating\b/i, { start: drawer })[0];
      const ratingCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", ratingItem)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /rating/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0];
      await tree.change(ratingCb, true);
      assert(getTableHeaders(tree, ".sfm-data-table th").length > 10);

      const resetBtn = findButtonByText(tree, /Reset/i, drawer);
      assert(resetBtn, "Reset to Defaults button must exist in Columns drawer");
      await tree.click(resetBtn);
      assert.strictEqual(getTableHeaders(tree, ".sfm-data-table th").length, 10, "Reset must restore 10 default columns");
    });
  });

  // ==========================================================
  // F18: Extended optional Table columns
  // ==========================================================
  async function verifyOptionalColumns(env, colLabels, expectedSubstrings) {
    const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
    await ensureTableView(tree);
    await tree.click(findButtonByText(tree, /Columns/i));
    const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
    assert(drawer, "Columns drawer must exist");
    for (const labelRe of colLabels) {
      const match = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && labelRe.test(String(n.props?.["data-col-id"] || n.props?.name || n.props?.title || "")), drawer)[0]
        || (() => {
          const item = tree.findByText(labelRe, { start: drawer })[0];
          return item ? tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", item)[0] : null;
        })();
      assert(match, `Optional column checkbox matching ${labelRe} must exist`);
      if (!match.props.checked) await tree.change(match, true);
    }
    const headers = getTableHeaders(tree, ".sfm-data-table th").map((h) => h.text);
    const txt = tree.text();
    for (const labelRe of colLabels) {
      assert(headers.some((h) => labelRe.test(h)), `Header matching ${labelRe} must render`);
    }
    for (const sub of expectedSubstrings) {
      assert(txt.includes(sub), `Expected extended column value "${sub}" in table text`);
    }
  }

  add("T1-F18-01", "F18", "Extended columns render Tags, Rating, O-Counter, and Play Count", async () => {
    await withEnv(async (env) => {
      await verifyOptionalColumns(env, [/Tags/i, /Rating/i, /O-Counter/i, /Play Count/i], ["Outdoor", "12"]);
    });
  });

  add("T1-F18-02", "F18", "Extended columns render Duration, Resolution, and File Size", async () => {
    await withEnv(async (env) => {
      await verifyOptionalColumns(env, [/Duration/i, /Resolution/i, /Size/i], ["4K", "1080p", "GB"]);
    });
  });

  add("T1-F18-03", "F18", "Extended columns render Video Codec/Format and Bitrate/FPS", async () => {
    await withEnv(async (env) => {
      await verifyOptionalColumns(env, [/Codec|Format/i, /Bitrate|FPS/i], ["hevc", "60"]);
    });
  });

  add("T1-F18-04", "F18", "Extended columns render Director and Folder Path", async () => {
    await withEnv(async (env) => {
      await verifyOptionalColumns(env, [/Director/i, /Folder/i], ["Jane Direct", "Season 1"]);
    });
  });

  add("T1-F18-05", "F18", "Extended columns render Created/Updated/Last Played timestamps and URLs/StashIDs", async () => {
    await withEnv(async (env) => {
      await verifyOptionalColumns(env, [/Created/i, /Updated/i, /Last Played/i, /URL|Stash/i], ["2026-01-11", "stashdb.org"]);
    });
  });

  // ==========================================================
  // F19: GraphQL catalog scenes_index_v8
  // ==========================================================
  add("T1-F19-01", "F19", "GetScenePaths GraphQL query requests all R4 scene and file stream fields", async () => {
    await withEnv(async (env) => {
      await env.sfm.ensureCatalog(true);
      const qCall = env.graphql.gqlCalls.find((c) => c.query.includes("GetScenePaths"));
      assert(qCall, "GetScenePaths query must be sent");
      for (const f of ["organized", "play_count", "o_counter", "director", "created_at", "updated_at", "last_played_at", "width", "height", "frame_rate", "bit_rate", "video_codec", "format"]) {
        assert(qCall.query.includes(f), `GetScenePaths query missing required R4 field: ${f}`);
      }
    });
  });

  add("T1-F19-02", "F19", "ensureCatalog writes compacted catalog to IndexedDB under scenes_index_v8", async () => {
    await withEnv(async (env) => {
      await env.sfm.ensureCatalog(true);
      const dbMap = env.idbBacking.get("stash_file_manager_db");
      assert(dbMap, "IDB database stash_file_manager_db must exist");
      const libStore = dbMap.get("library");
      assert(libStore && libStore.has("scenes_index_v8"), "IDB store must persist catalog under key 'scenes_index_v8'");
      assert(!libStore.has("scenes_index_v7"), "Stale v7 cache key must not be used");
    });
  });

  add("T1-F19-03", "F19", "compact preserves all R4 fields in memory cache and across IDB reload without GraphQL refetch", async () => {
    await withEnv(async (env) => {
      await env.sfm.ensureCatalog(true);
      const s101 = env.cache.scenes.find((s) => s.id === "101");
      assert.strictEqual(s101.organized, true);
      assert.strictEqual(s101.play_count, 12);
      assert.strictEqual(s101.o_counter, 5);
      assert.strictEqual(s101.director, "Jane Direct");
      assert.strictEqual(s101.code, "ALP-001");
      assert.strictEqual(s101.files[0].height, 2160);
      assert.strictEqual(s101.files[0].video_codec, "hevc");

      const env2 = env.reload({ url: "/plugin/file-manager" });
      try {
        await env2.sfm.ensureCatalog(false);
        const refetched = env2.graphql.gqlCalls.some((c) => c.query.includes("GetScenePaths"));
        assert.strictEqual(refetched, false, "Reload with valid scenes_index_v8 must NOT refetch GetScenePaths");
        const reloaded101 = env2.cache.scenes.find((s) => s.id === "101");
        assert.strictEqual(reloaded101.o_counter, 5);
        assert.strictEqual(reloaded101.play_count, 12);
        assert.strictEqual(reloaded101.files[0].frame_rate, 60);
        assert.strictEqual(reloaded101.files[0].bit_rate, 18000000);
      } finally {
        env2.cleanup();
      }
    });
  });

  add("T1-F19-04", "F19", "patchCatalogSceneInPlace updates memory cache and IDB scenes_index_v8", async () => {
    await withEnv(async (env) => {
      await env.sfm.ensureCatalog(true);
      assert.strictEqual(typeof env.sfm.patchCatalogSceneInPlace, "function", "patchCatalogSceneInPlace must be exported");
      await env.sfm.patchCatalogSceneInPlace({ id: "102", organized: true, code: "BET-PATCHED", title: "Patched Beta" });
      const mem = env.cache.scenes.find((s) => s.id === "102");
      assert.strictEqual(mem.organized, true);
      assert.strictEqual(mem.code, "BET-PATCHED");
      const idbRec = env.idbBacking.get("stash_file_manager_db").get("library").get("scenes_index_v8");
      const idb102 = idbRec.scenes.find((s) => s.id === "102");
      assert.strictEqual(idb102.organized, true);
      assert.strictEqual(idb102.code, "BET-PATCHED");
    });
  });

  add("T1-F19-05", "F19", "Native FindSceneFull & GetScenesByIds queries include code, organized, and file stream fields", async () => {
    await withEnv({ url: "/scenes/101" }, async (env) => {
      const ScrapeBtn = env.cache.NativeSceneDetailScrapeButton;
      assert.strictEqual(typeof ScrapeBtn, "function");
      const tree = env.mount(ScrapeBtn, { scene: env.db.scenes[0] });
      await tree.flush();
      const btn = tree.findBySelector("button")[0];
      await tree.click(btn);
      const q = env.graphql.gqlCalls.find((c) => c.query.includes("findScene("));
      assert(q, "NativeSceneDetailScrapeButton click must query findScene");
      assert(q.query.includes("code") && q.query.includes("organized"), "FindSceneFull must select code and organized");
    });
  });

  // ==========================================================
  // F20: 5-module codebase split
  // ==========================================================
  add("T1-F20-01", "F20", "stash_file_manager.yml ui.javascript declares the 5 split modules in exact dependency order", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    assert.deepStrictEqual(manifest.ui.javascript, [
      "sfm_core.js",
      "sfm_metadata_modal.js",
      "sfm_player.js",
      "sfm_views.js",
      "sfm_native.js",
    ]);
  });

  add("T1-F20-02", "F20", "All 5 split modules exist on disk and monolithic file_manager.js is deleted", async () => {
    for (const f of ["sfm_core.js", "sfm_metadata_modal.js", "sfm_player.js", "sfm_views.js", "sfm_native.js"]) {
      assert(fs.existsSync(path.join(PLUGIN_DIR, f)), `Missing module: ${f}`);
    }
    assert(!fs.existsSync(path.join(PLUGIN_DIR, "file_manager.js")), "Monolithic file_manager.js must be deleted");
  });

  add("T1-F20-03", "F20", "All 5 modules are classic IIFEs with zero top-level ESM import/export syntax", async () => {
    for (const f of ["sfm_core.js", "sfm_metadata_modal.js", "sfm_player.js", "sfm_views.js", "sfm_native.js"]) {
      const p = path.join(PLUGIN_DIR, f);
      assert(fs.existsSync(p), `Missing module: ${f}`);
      const content = fs.readFileSync(p, "utf8");
      assert(!/^\s*(import|export)\s+/m.test(content), `${f} must not contain top-level import/export syntax`);
    }
  });

  add("T1-F20-04", "F20", "window.__SFM__ exposes documented cross-module contracts across all 5 modules", async () => {
    await withEnv(async (env) => {
      for (const sym of [
        "ensureCatalog", "patchCatalogSceneInPlace", "sortScenesWithOrder", "matchesSceneFilters",
        "buildRouteUrlForPath", "parseQueryState", "FilenameParserModal", "BatchMetadataModal",
        "FolderProfileView", "BingeReelPlayerModal", "SceneCard", "SceneTableView",
        "SettingsAndTasksModal", "FileManagerView",
      ]) {
        assert(env.sfm[sym] !== undefined, `window.__SFM__.${sym} must be defined`);
      }
    });
  });

  add("T1-F20-05", "F20", "sfm_native.js logs initialization marker and attaches window.PluginApi.Filemanager", async () => {
    await withEnv(async (env) => {
      assert(env.consoleLogs.some((l) => l.includes("[PathFileManager] Initialized successfully with all enhanced features.")));
      assert.strictEqual(env.PluginApi.Filemanager, env.cache);
    });
  });

  // ==========================================================
  // F21: CSS cleanup & polish
  // ==========================================================
  add("T1-F21-01", "F21", "file_manager.css removes legacy data-sfm-active sibling-hiding rule", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(!css.includes("[data-sfm-active=\"true\"] > :not(#sfm-workspace-root)"),
      "Legacy sibling-hiding CSS hack must be removed");
  });

  add("T1-F21-02", "F21", "file_manager.css defines CSS custom properties in :root", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(/:root\s*\{[^}]*--sfm-accent/s.test(css), "Expected :root --sfm-accent CSS custom property");
  });

  add("T1-F21-03", "F21", "file_manager.css enables sticky headers on .sfm-data-table th", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(/\.sfm-data-table[^{]*th\s*\{[^}]*position:\s*sticky/s.test(css),
      ".sfm-data-table th must have position: sticky");
  });

  add("T1-F21-04", "F21", "file_manager.css includes styles for column drawer, inline editor, filter bar, and sort indicators", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(css.includes(".sfm-columns-drawer") || css.includes(".sfm-columns-popover"), "Missing column drawer CSS");
    assert(css.includes(".sfm-inline-editor"), "Missing inline editor CSS");
    assert(css.includes(".sfm-filter-bar"), "Missing filter bar CSS");
  });

  add("T1-F21-05", "F21", "file_manager.css has balanced braces and responsive @media rules", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    const opens = (css.match(/\{/g) || []).length;
    const closes = (css.match(/\}/g) || []).length;
    assert.strictEqual(opens, closes, `Unbalanced CSS braces: ${opens} opens vs ${closes} closes`);
    assert(css.includes("@media"), "Missing responsive @media queries");
  });

  // ==========================================================
  // F22: Manifest, test migration & syntax checks
  // ==========================================================
  add("T1-F22-01", "F22", "stash_file_manager.yml version is bumped to 4.0.0", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    assert.strictEqual(manifest.version, "4.0.0", `Expected version 4.0.0, got ${manifest.version}`);
  });

  add("T1-F22-02", "F22", "All declared ui.javascript modules pass node --check", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    for (const jsRel of manifest.ui.javascript) {
      execSync(`node --check "${path.join(PLUGIN_DIR, jsRel)}"`, { stdio: "pipe" });
    }
  });

  add("T1-F22-03", "F22", "Root test_components.js & test_parallel_scrape_and_sources.js load split modules cleanly and pass", async () => {
    for (const f of ["test_components.js", "test_parallel_scrape_and_sources.js"]) {
      const content = fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
      assert(!content.includes("stash_file_manager/file_manager.js"), `${f} must not hardcode deleted file_manager.js`);
      execSync(`node "${path.join(REPO_ROOT, f)}"`, { cwd: REPO_ROOT, stdio: "pipe" });
    }
  });

  add("T1-F22-04", "F22", "Root test_bulk_rename.js & test_react_error_31_regression.js pass against split modules", async () => {
    for (const f of ["test_bulk_rename.js", "test_react_error_31_regression.js"]) {
      const content = fs.readFileSync(path.join(REPO_ROOT, f), "utf8");
      assert(!content.includes("file_manager.js"), `${f} must not hardcode deleted file_manager.js`);
      execSync(`node "${path.join(REPO_ROOT, f)}"`, { cwd: REPO_ROOT, stdio: "pipe" });
    }
  });

  add("T1-F22-05", "F22", "Root v3.0.x tests pass and no longer assert legacy #file-manager overlay or stale 3.0.x version regex", async () => {
    for (const f of ["test_v3.0.0_native_card_and_scene_detail.js", "test_v3.0.0_native_embedded_cards.js", "test_v3.0.2_title_line_alignment.js"]) {
      execSync(`node "${path.join(REPO_ROOT, f)}"`, { cwd: REPO_ROOT, stdio: "pipe" });
    }
  });

  // ==========================================================
  // F23: Release packaging & NAS deploy
  // ==========================================================
  add("T1-F23-01", "F23", "stash_file_manager.zip exists and has top-level stash_file_manager/ with 5 split modules", async () => {
    assert(fs.existsSync(ZIP_PATH), "stash_file_manager.zip must exist");
    const entries = listZipEntries(ZIP_PATH);
    assert(entries.every((e) => e.startsWith("stash_file_manager/")), "All zip entries must live under top-level stash_file_manager/");
    for (const mod of ["sfm_core.js", "sfm_metadata_modal.js", "sfm_player.js", "sfm_views.js", "sfm_native.js"]) {
      assert(entries.includes(`stash_file_manager/${mod}`), `Zip missing stash_file_manager/${mod}`);
    }
    assert(!entries.includes("stash_file_manager/file_manager.js"), "Zip must not contain deleted file_manager.js");
  });

  add("T1-F23-02", "F23", "index.yml declares version 4.0.0 and valid timestamp", async () => {
    const idx = parseIndexYml(INDEX_YML_PATH);
    assert.strictEqual(idx.version, "4.0.0", `index.yml version must be 4.0.0, got ${idx.version}`);
    assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(idx.date), `Invalid index.yml date format: ${idx.date}`);
  });

  add("T1-F23-03", "F23", "index.yml sha256 exactly matches SHA-256 of stash_file_manager.zip", async () => {
    const idx = parseIndexYml(INDEX_YML_PATH);
    const actualSha = computeFileSha256(ZIP_PATH);
    assert.strictEqual(idx.sha256, actualSha, `index.yml sha256 (${idx.sha256}) != zip sha256 (${actualSha})`);
  });

  add("T1-F23-04", "F23", "sfm_tasks.py executes init and rename tasks cleanly", async () => {
    const tmpDir = fs.mkdtempSync("/tmp/sfm_e2e_py_");
    try {
      const f1 = path.join(tmpDir, "clip_a.mp4");
      fs.writeFileSync(f1, "data");
      const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" rename`, {
        input: JSON.stringify({ task: "rename", items: [{ file_id: 1, scene_id: "1", old_path: f1, new_basename: "Clip_Renamed.mp4" }] }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const res = JSON.parse(out.trim().split("\n").pop());
      assert.strictEqual(res.success_count, 1);
      assert(fs.existsSync(path.join(tmpDir, "Clip_Renamed.mp4")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  add("T1-F23-05", "F23", "NAS deployment directory is synchronized with v4.0.0 files and preserves .sfm_rename_result.json", async () => {
    const nasDir = "/hed-nas/docker/stashapp/stash-config/plugins/stash_file_manager/stash_file_manager";
    assert(fs.existsSync(nasDir), "NAS target directory must be accessible");
    const nasManifest = parsePluginManifest(path.join(nasDir, "stash_file_manager.yml"));
    assert.strictEqual(nasManifest.version, "4.0.0", "NAS stash_file_manager.yml must be bumped to 4.0.0");
    assert(!fs.existsSync(path.join(nasDir, "file_manager.js")), "Stale file_manager.js on NAS must be removed");
    for (const f of ["sfm_core.js", "sfm_metadata_modal.js", "sfm_player.js", "sfm_views.js", "sfm_native.js", "file_manager.css"]) {
      assert.strictEqual(computeFileSha256(path.join(nasDir, f)), computeFileSha256(path.join(PLUGIN_DIR, f)),
        `NAS file ${f} checksum mismatch with repo`);
    }
    assert(fs.existsSync(path.join(nasDir, ".sfm_rename_result.json")), "NAS .sfm_rename_result.json must be preserved");
  });

  return tests;
}

module.exports = { getTests };

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { execSync } = require("child_process");
const {
  PLUGIN_DIR,
  MANIFEST_PATH,
  CSS_PATH,
  INDEX_YML_PATH,
  parsePluginManifest,
  parseIndexYml,
  createStashEnv,
} = require("./harness");
const { makeScene } = require("./fixtures");
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
  const add = (id, feature, name, fn) => tests.push({ id, tier: 2, feature, name, fn });

  // ==========================================================
  // F13 Boundary & Corner Cases
  // ==========================================================
  add("T2-F13-01", "F13", "Clicking non-sortable headers (Cover, Actions) leaves active sort unchanged", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "title");
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Cover"));
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Actions"));
      const selVal = findSceneSortSelect(tree).props["data-sort-key"] || findSceneSortSelect(tree).props.value;
      assert(selVal === "title" || selVal === "title_asc");
    });
  });

  add("T2-F13-02", "F13", "Clicking Table header while sceneSort is 'random' switches cleanly out of random mode", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "random");
      assert(findButtonByText(tree, /Reshuffle/i));
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Title"));
      const selVal = findSceneSortSelect(tree).props["data-sort-key"] || findSceneSortSelect(tree).props.value;
      assert(selVal === "title" || selVal === "title_asc");
      assert(!findButtonByText(tree, /Reshuffle/i), "Reshuffle must hide when switching from random to column sort");
    });
  });

  add("T2-F13-03", "F13", "Sorting Code/Studio/Date in Table view handles null/empty fields without crashing", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      for (const col of ["Code", "Studio", "Date", "Title", "Filename", "Organized"]) {
        await tree.click(findHeaderByName(tree, ".sfm-data-table", col));
        await tree.click(findHeaderByName(tree, ".sfm-data-table", col));
      }
      assert.strictEqual(getTableBodyRows(tree, ".sfm-data-table tbody tr").length, 5);
    });
  });

  add("T2-F13-04", "F13", "Header sort sync works with Include Sub-Folders enabled (flat sort vs folder-first)", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "");
      const subBtn = findButtonByText(tree, /Include Sub-Folders/i);
      assert(subBtn);
      await tree.click(subBtn);
      const grpBtn = findButtonByText(tree, /Group by Folder/i);
      if (grpBtn && tree.nodeText(grpBtn).includes("Group")) {
        await tree.click(grpBtn);
      }
      await ensureTableView(tree);
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Title"));
      const selVal = findSceneSortSelect(tree).props["data-sort-key"] || findSceneSortSelect(tree).props.value;
      assert(selVal === "title" || selVal === "title_asc");
    });
  });

  add("T2-F13-05", "F13", "Sorting an enabled optional column (Rating) syncs header indicator", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      assert(drawer);
      const ratingCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /rating/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/\bRating\b/i, { start: drawer })[0])[0];
      await tree.change(ratingCb, true);
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Rating"));
      const ratingTh = findHeaderByName(tree, ".sfm-data-table", "Rating");
      assert(/[▲▼]/.test(tree.nodeText(ratingTh)));
    });
  });

  // ==========================================================
  // F14 Boundary & Corner Cases
  // ==========================================================
  add("T2-F14-01", "F14", "Random sort on empty scenes list [] returns [] safely", async () => {
    await withEnv(async (env) => {
      assert.deepStrictEqual(env.sfm.sortScenesWithOrder([], "random", 123), []);
    });
  });

  add("T2-F14-02", "F14", "Random sort on single-scene folder returns that scene without error", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/OnePiece");
      await tree.change(findSceneSortSelect(tree), "random");
      assert(tree.text().includes("Gamma Horizon"));
      assert(findButtonByText(tree, /Reshuffle/i));
      await tree.click(findButtonByText(tree, /Reshuffle/i));
      assert(tree.text().includes("Gamma Horizon"));
    });
  });

  add("T2-F14-03", "F14", "createShuffledQueue handles null currentItem and empty arrays cleanly", async () => {
    await withEnv(async (env) => {
      const fn = env.sfm.createShuffledQueue;
      assert.strictEqual(typeof fn, "function");
      assert.deepStrictEqual(fn([], null, 1), []);
      const res = fn(env.db.scenes.slice(0, 3), null, 7);
      assert.strictEqual(res.length, 3);
    });
  });

  add("T2-F14-04", "F14", "Switching from random to date_desc removes Reshuffle button", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await tree.change(findSceneSortSelect(tree), "random");
      assert(findButtonByText(tree, /Reshuffle/i));
      await tree.change(findSceneSortSelect(tree), "date_desc");
      assert(!findButtonByText(tree, /Reshuffle/i));
    });
  });

  add("T2-F14-05", "F14", "Random sort respects active search/attribute filters without leaking filtered-out scenes", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const orgSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      assert(orgSel);
      await tree.change(orgSel, "organized");
      await tree.change(findSceneSortSelect(tree), "random");
      await tree.click(findButtonByText(tree, /Reshuffle/i));
      assert(!tree.text().includes("Beta Midnight"), "Randomize/Reshuffle must not re-introduce filtered-out scenes");
    });
  });

  // ==========================================================
  // F15 Boundary & Corner Cases
  // ==========================================================
  add("T2-F15-01", "F15", "FolderProfileView handles empty scenes array in random mode without crashing", async () => {
    await withEnv(async (env) => {
      const FPV = env.sfm.FolderProfileView;
      const tree = env.mount(FPV, {
        folderName: "Empty",
        currentFolderPath: "Empty",
        scenes: [],
        syncedSort: "random",
        syncedShuffleSeed: 5,
        onSelectScene: () => {},
        onClose: () => {},
      });
      await tree.flush();
      assert(tree.root);
    });
  });

  add("T2-F15-02", "F15", "FolderProfileView handles single scene in random mode + Reshuffle click", async () => {
    await withEnv(async (env) => {
      const FPV = env.sfm.FolderProfileView;
      let reshuffled = 0;
      const tree = env.mount(FPV, {
        folderName: "OnePiece",
        currentFolderPath: "Anime/OnePiece",
        scenes: [env.db.scenes[3]],
        syncedSort: "random",
        syncedShuffleSeed: 1,
        onReshuffle: () => { reshuffled++; },
        onSelectScene: () => {},
        onClose: () => {},
      });
      await tree.flush();
      const btn = findButtonByText(tree, /Reshuffle/i);
      assert(btn);
      await tree.click(btn);
      assert.strictEqual(reshuffled, 1);
    });
  });

  add("T2-F15-03", "F15", "FolderProfileView works standalone without onSortChange or onReshuffle callbacks", async () => {
    await withEnv(async (env) => {
      const FPV = env.sfm.FolderProfileView;
      const tree = env.mount(FPV, {
        folderName: "Season 1",
        currentFolderPath: "Anime/Naruto/Season 1",
        scenes: env.db.scenes.slice(0, 4),
        onSelectScene: () => {},
        onClose: () => {},
      });
      await tree.flush();
      const sortSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("random"));
      await tree.change(sortSel, "random");
      const btn = findButtonByText(tree, /Reshuffle/i);
      assert(btn);
      await tree.click(btn);
      assert(tree.root);
    });
  });

  add("T2-F15-04", "F15", "FolderProfileView recovers safely from invalid localStorage sfm_profile_scene_sort", async () => {
    await withEnv({ localStorageData: { sfm_profile_scene_sort: "invalid_sort_key" } }, async (env) => {
      const FPV = env.sfm.FolderProfileView;
      const tree = env.mount(FPV, {
        folderName: "Season 1",
        currentFolderPath: "Anime/Naruto/Season 1",
        scenes: env.db.scenes.slice(0, 3),
        onSelectScene: () => {},
        onClose: () => {},
      });
      await tree.flush();
      assert(tree.text().includes("Alpha Sunrise"));
    });
  });

  add("T2-F15-05", "F15", "Clicking Reshuffle inside Video Wall invokes onReshuffle and syncs seed with FileManagerView", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await tree.change(findSceneSortSelect(tree), "random");
      await tree.click(findButtonByTextOrTitle(tree, /Video Wall|Folder Profile/i));
      const profileOverlay = tree.findBySelector(".sfm-profile-overlay, .sfm-profile-modal")[0];
      assert(profileOverlay);
      const wallReshuffle = findButtonByText(tree, /Reshuffle/i, profileOverlay);
      assert(wallReshuffle, "Video Wall must render Reshuffle button");
      await tree.click(wallReshuffle);
    });
  });

  // ==========================================================
  // F16 Boundary & Corner Cases
  // ==========================================================
  add("T2-F16-01", "F16", "Combining Unorganized + 4K + Min Rating yields 0 matches cleanly without error", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const orgSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("unorganized"));
      const resSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).some((v) => /4k|2160/i.test(v)));
      assert(orgSel && resSel);
      await tree.change(orgSel, "unorganized");
      await tree.change(resSel, getSelectOptionValues(resSel).find((v) => /4k|2160/i.test(v)));
      assert(!tree.text().includes("Alpha Sunrise") && !tree.text().includes("Beta Midnight"));
    });
  });

  add("T2-F16-02", "F16", "Minimum Rating filter treats null and 0 rating100 identically as unrated (excluded from >=1★)", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const ratSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).some((v) => v === "20" || v === "1"));
      assert(ratSel);
      await tree.change(ratSel, getSelectOptionValues(ratSel).find((v) => v === "20" || v === "1"));
      assert(!tree.text().includes("raw_untagged_clip_720p.mkv"), "Null rating scene 103 must be excluded");
      assert(!tree.text().includes("Zeta Missing Code"), "Zero rating scene 107 must be excluded");
      assert(tree.text().includes("Beta Midnight"), "60 rating scene 102 must remain");
    });
  });

  add("T2-F16-03", "F16", "Resolution filter SD (<720p) isolates 480p Delta Special & Cut", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "");
      await tree.click(findButtonByText(tree, /Include Sub-Folders/i));
      const resSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).some((v) => /sd|480/i.test(v)));
      assert(resSel);
      await tree.change(resSel, getSelectOptionValues(resSel).find((v) => /sd|480/i.test(v)));
      assert(tree.text().includes("Delta Special & Cut"));
      assert(!tree.text().includes("Alpha Sunrise"));
    });
  });

  add("T2-F16-04", "F16", "matchesSceneFilters helper handles missing fields and null scene properties cleanly", async () => {
    await withEnv(async (env) => {
      assert.strictEqual(typeof env.sfm.matchesSceneFilters, "function");
      const emptyScene = makeScene({ id: "1601", title: "", studio: null, performers: [], tags: [], date: "", code: "", organized: false, rating100: null, files: [] });
      assert.strictEqual(env.sfm.matchesSceneFilters(emptyScene, { organizedFilter: "unorganized" }), true);
      assert.strictEqual(env.sfm.matchesSceneFilters(emptyScene, { organizedFilter: "organized" }), false);
      assert.strictEqual(env.sfm.matchesSceneFilters(emptyScene, { missingFields: ["studio"] }), true);
      assert.strictEqual(env.sfm.matchesSceneFilters(emptyScene, { minRating: 20 }), false);
    });
  });

  add("T2-F16-05", "F16", "Missing Cover filter isolates scene 103 when browsing Season 1", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const coverBtn = findButtonByTextOrTitle(tree, /^Cover$/i);
      assert(coverBtn);
      await tree.click(coverBtn);
      assert(tree.text().includes("raw_untagged_clip_720p.mkv"));
      assert(!tree.text().includes("Alpha Sunrise"));
    });
  });

  // ==========================================================
  // F17 Boundary & Corner Cases
  // ==========================================================
  add("T2-F17-01", "F17", "Corrupt JSON in localStorage sfm_table_columns_v1 falls back safely to default 10 columns", async () => {
    await withEnv({ localStorageData: { sfm_table_columns_v1: "{not-valid-json!!!" } }, async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      assert.strictEqual(getTableHeaders(tree, ".sfm-data-table th").length, 10,
        "Corrupt localStorage must fall back to 10 default columns");
    });
  });

  add("T2-F17-02", "F17", "Unknown column IDs in sfm_table_columns_v1 are safely ignored", async () => {
    await withEnv({
      localStorageData: {
        sfm_table_columns_v1: JSON.stringify([{ id: "nonexistent_col", visible: true }, { id: "title", visible: true }]),
      },
    }, async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      assert(getTableHeaders(tree, ".sfm-data-table th").length >= 1);
    });
  });

  add("T2-F17-03", "F17", "Boundary reorder (moving first item up / last item down) does not throw or corrupt array", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const upBtns = tree.findAll((n) => n.tag === "button" && /↑|Up/i.test(tree.nodeText(n) + " " + (n.props?.title || "")), drawer);
      const downBtns = tree.findAll((n) => n.tag === "button" && /↓|Down/i.test(tree.nodeText(n) + " " + (n.props?.title || "")), drawer);
      if (upBtns[0] && !upBtns[0].props.disabled) await tree.click(upBtns[0]);
      if (downBtns[downBtns.length - 1] && !downBtns[downBtns.length - 1].props.disabled) await tree.click(downBtns[downBtns.length - 1]);
      assert(getTableHeaders(tree, ".sfm-data-table th").length === 10);
    });
  });

  add("T2-F17-04", "F17", "Hiding all optional/middle columns keeps Checkbox and Actions usable", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const cbs = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && n.props?.checked && !n.props?.disabled, drawer);
      for (const cb of cbs.slice(0, 4)) {
        await tree.change(cb, false);
      }
      assert(getTableHeaders(tree, ".sfm-data-table th").length >= 2);
    });
  });

  add("T2-F17-05", "F17", "Closing Columns drawer via toggle button preserves unsaved-reset toggles", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const ratingCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/\bRating\b/i, { start: drawer })[0])[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /rating/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0];
      await tree.change(ratingCb, true);
      await tree.click(findButtonByText(tree, /Columns/i));
      assert.strictEqual(tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover").length, 0);
      assert(getTableHeaders(tree, ".sfm-data-table th").some((h) => /Rating/i.test(h.text)));
    });
  });

  // ==========================================================
  // F18 Boundary & Corner Cases
  // ==========================================================
  async function mountTableWithAllOptionalCols(env, scenes) {
    const tree = await openFolderRoute(env, "");
    await ensureTableView(tree);
    await tree.click(findButtonByText(tree, /Columns/i));
    const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
    assert(drawer);
    const cbs = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && !n.props?.checked, drawer);
    for (const cb of cbs) await tree.change(cb, true);
    return tree;
  }

  add("T2-F18-01", "F18", "Extended O-Counter, Play Count, and Rating handle zero and null without NaN or 'null'", async () => {
    await withEnv({
      scenes: [makeScene({ id: "1801", o_counter: 0, play_count: 0, rating100: null })],
    }, async (env) => {
      const tree = await mountTableWithAllOptionalCols(env);
      const txt = tree.text();
      assert(!/\bNaN\b|\bundefined\b|\bnull\b/i.test(txt), `Rendered text must not contain NaN/null/undefined: ${txt}`);
    });
  });

  add("T2-F18-02", "F18", "Extended Bitrate/FPS, Resolution, Codec, Size, Duration handle missing/zero file metadata cleanly", async () => {
    await withEnv({
      scenes: [makeScene({ id: "1802", files: [{ id: "f1", path: "/data/videos/x.mp4", basename: "x.mp4", size: 0, duration: 0, width: 0, height: 0, frame_rate: 0, bit_rate: 0, video_codec: "", format: "" }] })],
    }, async (env) => {
      const tree = await mountTableWithAllOptionalCols(env);
      const txt = tree.text();
      assert(!/\bNaN\b|\bundefined\b|0p\b/i.test(txt), `Zero file fields rendered poorly: ${txt}`);
    });
  });

  add("T2-F18-03", "F18", "Extended Last Played, Created, Updated timestamps handle null dates cleanly", async () => {
    await withEnv({
      scenes: [makeScene({ id: "1803", created_at: null, updated_at: null, last_played_at: null })],
    }, async (env) => {
      const tree = await mountTableWithAllOptionalCols(env);
      assert(!/\bInvalid Date\b|\bnull\b/i.test(tree.text()));
    });
  });

  add("T2-F18-04", "F18", "Extended URLs/StashIDs and Director handle empty arrays and empty strings cleanly", async () => {
    await withEnv({
      scenes: [makeScene({ id: "1804", urls: [], stash_ids: [], director: "", tags: [] })],
    }, async (env) => {
      const tree = await mountTableWithAllOptionalCols(env);
      assert(!/\bundefined\b|\bnull\b/i.test(tree.text()));
    });
  });

  add("T2-F18-05", "F18", "Extended columns display accurate 1440p and 720p resolution badges", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "");
      await tree.click(findButtonByText(tree, /Include Sub-Folders/i));
      await ensureTableView(tree);
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      const resCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(/Resolution/i, { start: drawer })[0])[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && /resolution/i.test(String(n.props?.["data-col-id"] || "")), drawer)[0];
      assert(resCb);
      await tree.change(resCb, true);
      const txt = tree.text();
      assert(txt.includes("1440p") && txt.includes("720p"), "Resolution column must render 1440p and 720p");
    });
  });

  // ==========================================================
  // F19 Boundary & Corner Cases
  // ==========================================================
  add("T2-F19-01", "F19", "Expired scenes_index_v8 (>24h TTL) triggers fresh GraphQL GetScenePaths fetch", async () => {
    const backing = new Map();
    backing.set("stash_file_manager_db", new Map([
      ["library", new Map([
        ["scenes_index_v8", { timestamp: Date.now() - (25 * 60 * 60 * 1000), scenes: [] }],
      ])],
    ]));
    await withEnv({ idbBacking: backing }, async (env) => {
      await env.sfm.ensureCatalog(false);
      assert(env.graphql.gqlCalls.some((c) => c.query.includes("GetScenePaths")), "Expired cache must re-query GraphQL");
    });
  });

  add("T2-F19-02", "F19", "Stale scenes_index_v7 entry in IDB is ignored in favor of v8 fetch", async () => {
    const backing = new Map();
    backing.set("stash_file_manager_db", new Map([
      ["library", new Map([
        ["scenes_index_v7", { timestamp: Date.now(), scenes: [{ id: "999", title: "Old v7", files: [{ path: "/data/videos/old.mp4" }] }] }],
      ])],
    ]));
    await withEnv({ idbBacking: backing }, async (env) => {
      await env.sfm.ensureCatalog(false);
      assert(env.graphql.gqlCalls.some((c) => c.query.includes("GetScenePaths")), "Must ignore old scenes_index_v7 key");
      assert(!env.cache.scenes.some((s) => s.id === "999"));
    });
  });

  add("T2-F19-03", "F19", "Concurrent ensureCatalog() calls deduplicate into a single GraphQL GetScenePaths request", async () => {
    await withEnv(async (env) => {
      env.cache.trie = null;
      env.cache.scenes = null;
      await Promise.all([env.sfm.ensureCatalog(false), env.sfm.ensureCatalog(false), env.sfm.ensureCatalog(false)]);
      const count = env.graphql.gqlCalls.filter((c) => c.query.includes("GetScenePaths")).length;
      assert.strictEqual(count, 1, `Expected 1 deduplicated GetScenePaths call, got ${count}`);
    });
  });

  add("T2-F19-04", "F19", "patchCatalogSceneInPlace ignores unknown scene ID gracefully without error", async () => {
    await withEnv(async (env) => {
      await env.sfm.ensureCatalog(true);
      await env.sfm.patchCatalogSceneInPlace({ id: "nonexistent-999", title: "Ghost" });
      assert.strictEqual(env.cache.scenes.length, 7);
    });
  });

  add("T2-F19-05", "F19", "ensureCatalog works cleanly when window.indexedDB is null", async () => {
    await withEnv({ disableIDB: true }, async (env) => {
      const trie = await env.sfm.ensureCatalog(false);
      assert(trie && env.cache.scenes.length === 7);
    });
  });

  // ==========================================================
  // F20 Boundary & Corner Cases
  // ==========================================================
  add("T2-F20-01", "F20", "All 5 split modules bail out safely if window.PluginApi is missing", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    for (const jsRel of manifest.ui.javascript) {
      const code = fs.readFileSync(path.join(PLUGIN_DIR, jsRel), "utf8");
      const sandbox = { window: { location: { pathname: "/" } }, document: {}, console: { warn: () => {}, log: () => {}, error: () => {} } };
      sandbox.window.window = sandbox.window;
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
    }
  });

  add("T2-F20-02", "F20", "sfm_core.js initializes window.__SFM__ independently before UI modules load", async () => {
    const corePath = path.join(PLUGIN_DIR, "sfm_core.js");
    assert(fs.existsSync(corePath), "sfm_core.js must exist");
    const code = fs.readFileSync(corePath, "utf8");
    const env = createStashEnv();
    try {
      const sandbox = { window: { PluginApi: env.PluginApi, location: { pathname: "/", search: "", hash: "" }, history: env.history, localStorage: env.localStorage, document: env.document, addEventListener: () => {} }, document: env.document, console: { log: () => {}, warn: () => {}, error: () => {} } };
      sandbox.window.window = sandbox.window;
      vm.createContext(sandbox);
      vm.runInContext(code, sandbox);
      assert(sandbox.window.__SFM__ && typeof sandbox.window.__SFM__.ensureCatalog === "function");
    } finally {
      env.cleanup();
    }
  });

  add("T2-F20-03", "F20", "All 5 modules are strictly non-empty (>500 bytes each)", async () => {
    for (const f of ["sfm_core.js", "sfm_metadata_modal.js", "sfm_player.js", "sfm_views.js", "sfm_native.js"]) {
      const p = path.join(PLUGIN_DIR, f);
      assert(fs.existsSync(p), `Missing ${f}`);
      assert(fs.statSync(p).size > 500, `${f} unexpectedly small`);
    }
  });

  add("T2-F20-04", "F20", "No split module declares top-level bare globals leaking outside IIFE", async () => {
    for (const f of ["sfm_core.js", "sfm_metadata_modal.js", "sfm_player.js", "sfm_views.js", "sfm_native.js"]) {
      const p = path.join(PLUGIN_DIR, f);
      assert(fs.existsSync(p), `Missing ${f}`);
      const content = fs.readFileSync(p, "utf8").trim();
      assert(content.startsWith("(function") || content.startsWith("/*") || content.startsWith("//"),
        `${f} must be wrapped in an IIFE`);
    }
  });

  add("T2-F20-05", "F20", "stash_file_manager.yml ui.javascript has zero duplicate or nonexistent entries", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    const unique = new Set(manifest.ui.javascript);
    assert.strictEqual(unique.size, manifest.ui.javascript.length, "Duplicate entries in ui.javascript");
    for (const jsRel of manifest.ui.javascript) {
      assert(fs.existsSync(path.join(PLUGIN_DIR, jsRel)), `Missing declared script: ${jsRel}`);
    }
  });

  // ==========================================================
  // F21 Boundary & Corner Cases
  // ==========================================================
  add("T2-F21-01", "F21", "file_manager.css removes #sfm-workspace-root fullscreen hijack and data-sfm-embedded hiding", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(!css.includes("[data-sfm-embedded=\"true\"][data-sfm-active=\"true\"]"),
      "Legacy data-sfm-embedded sibling hiding rule must be removed");
  });

  add("T2-F21-02", "F21", "file_manager.css defines .sfm-native-page layout styling", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(css.includes(".sfm-native-page"), "file_manager.css must style .sfm-native-page");
  });

  add("T2-F21-03", "F21", "file_manager.css preserves native Stash card parity classes and section alignment rules", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(css.includes(".sfm-native-scene-card.card"));
    assert(css.includes(".sfm-native-folder-card.card"));
    assert(css.includes(".sfm-section-title-box"));
  });

  add("T2-F21-04", "F21", "file_manager.css includes mobile breakpoints (<= 768px) for responsive tables/cards", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(/@media\s*\(max-width:\s*768px\)/.test(css), "Expected 768px responsive breakpoint");
  });

  add("T2-F21-05", "F21", "file_manager.css contains sort indicator styling for clickable table headers", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(css.includes(".sfm-sort-indicator") || css.includes("th.sfm-sortable") || css.includes(".sfm-th-sortable"),
      "Expected sortable header / indicator CSS classes");
  });

  // ==========================================================
  // F22 Boundary & Corner Cases
  // ==========================================================
  add("T2-F22-01", "F22", "stash_file_manager.yml retains all 4 backend tasks and ui.css file_manager.css", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    assert.deepStrictEqual(manifest.ui.css, ["file_manager.css"]);
    assert.strictEqual(manifest.tasks.length, 4);
  });

  add("T2-F22-02", "F22", "sfm_tasks.py compiles cleanly with python3 -m py_compile", async () => {
    execSync(`python3 -m py_compile "${path.join(PLUGIN_DIR, "sfm_tasks.py")}"`, { stdio: "pipe" });
  });

  add("T2-F22-03", "F22", "index.yml id, name, and path fields match stash_file_manager.zip", async () => {
    const idx = parseIndexYml(INDEX_YML_PATH);
    assert.strictEqual(idx.id, "stash_file_manager");
    assert.strictEqual(idx.path, "stash_file_manager.zip");
  });

  add("T2-F22-04", "F22", "No root test_*.js file retains stale 3\\.0\\.[1-9] version regex", async () => {
    const content = fs.readFileSync(path.join(path.resolve(PLUGIN_DIR, ".."), "test_v3.0.2_title_line_alignment.js"), "utf8");
    assert(!content.includes("3\\.0\\.[1-9]"), "Stale 3.0.x version regex must be updated for v4.0.0");
  });

  add("T2-F22-05", "F22", "Manifest version matches index.yml version (4.0.0 === 4.0.0)", async () => {
    const m = parsePluginManifest(MANIFEST_PATH);
    const i = parseIndexYml(INDEX_YML_PATH);
    assert.strictEqual(m.version, "4.0.0");
    assert.strictEqual(i.version, m.version);
  });

  // ==========================================================
  // F23 Boundary & Corner Cases
  // ==========================================================
  add("T2-F23-01", "F23", "sfm_tasks.py rename reports error_count for missing disk files without aborting batch", async () => {
    const tmpDir = fs.mkdtempSync("/tmp/sfm_e2e_py_b1_");
    try {
      const fOk = path.join(tmpDir, "ok.mp4");
      fs.writeFileSync(fOk, "x");
      const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" rename`, {
        input: JSON.stringify({
          task: "rename",
          items: [
            { file_id: 1, scene_id: "1", old_path: "/tmp/does_not_exist_xyz_999.mp4", new_basename: "nope.mp4" },
            { file_id: 2, scene_id: "2", old_path: fOk, new_basename: "ok_renamed.mp4" },
          ],
        }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const res = JSON.parse(out.trim().split("\n").pop());
      assert.strictEqual(res.error_count, 1);
      assert.strictEqual(res.success_count, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  add("T2-F23-02", "F23", "sfm_tasks.py handles case-only filename rename via 2-step temp rename", async () => {
    const tmpDir = fs.mkdtempSync("/tmp/sfm_e2e_py_b2_");
    try {
      const f1 = path.join(tmpDir, "case_clip.mp4");
      fs.writeFileSync(f1, "x");
      const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" rename`, {
        input: JSON.stringify({
          task: "rename",
          items: [{ file_id: 3, scene_id: "3", old_path: f1, new_basename: "CASE_CLIP.mp4" }],
        }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const res = JSON.parse(out.trim().split("\n").pop());
      assert.strictEqual(res.success_count, 1);
      assert(fs.readdirSync(tmpDir).includes("CASE_CLIP.mp4"));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  add("T2-F23-03", "F23", "sfm_tasks.py handles empty rename items list cleanly", async () => {
    const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" rename`, {
      input: JSON.stringify({ task: "rename", items: [] }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const res = JSON.parse(out.trim().split("\n").pop());
    assert.strictEqual(res.error_count || 0, 0);
  });

  add("T2-F23-04", "F23", "sfm_tasks.py rebuild handles unreachable Stash server gracefully", async () => {
    const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" rebuild`, {
      input: JSON.stringify({ server_connection: { Host: "127.0.0.1", Port: 59999 } }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const res = JSON.parse(out.trim().split("\n").pop());
    assert.strictEqual(res.status, "ok");
  });

  add("T2-F23-05", "F23", "sfm_tasks.py reset outputs valid JSON with DEFAULT_SETTINGS", async () => {
    const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" reset`, {
      input: JSON.stringify({ server_connection: { Host: "127.0.0.1", Port: 59999 } }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const res = JSON.parse(out.trim().split("\n").pop());
    assert.strictEqual(res.status, "ok");
    assert(res.settings && res.settings.default_transcode_method === "direct");
  });

  return tests;
}

module.exports = { getTests };

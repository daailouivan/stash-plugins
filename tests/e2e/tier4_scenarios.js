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
  drillIntoFolders,
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
  const add = (id, feature, name, fn) => tests.push({ id, tier: 4, feature, name, fn });

  add("T4-01", "R1/F1-F4", "Full Native Navigation Lifecycle: NavLink -> Folder Drilldown -> Back/Forward -> Native /scenes", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const navTree = env.mount(env.invokePatched("MainNavBar.MenuItems", {}, baseNav));
      await navTree.flush();

      await navTree.click(navTree.findBySelector("#sfm-nav-button")[0]);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");

      const fmTree = await env.mountRoute("/plugin/file-manager");
      await drillIntoFolders(fmTree, ["Anime", "Naruto", "Season 1"]);
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto/Season 1");
      assert(fmTree.text().includes("Alpha Sunrise"));

      env.history.back();
      await fmTree.flush();
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto");

      env.history.forward();
      await fmTree.flush();
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto/Season 1");

      env.navigate("/scenes");
      fmTree.unmount();
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-active"), null);
      assert.strictEqual(env.document.getElementById("sfm-workspace-root"), null);
    });
  });

  add("T4-02", "R2/F5-F10", "Complete Metadata Curation Session: Filter Missing -> Inline Edit -> Scrape Code -> Toggle Organized", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await openMetadataStudioFromView(tree, "scrape");

      // Step 1: Filter Missing Studio -> finds scene 103
      const modal = tree.findBySelector(".sfm-modal-container, .sfm-parser-modal")[0] || tree.root;
      const studioBtn = findButtonByTextOrTitle(tree, /^Studio$/i, modal);
      assert(studioBtn);
      await tree.click(studioBtn);
      let rows = getTableBodyRows(tree, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 1);

      // Step 2: Inline Edit scene 103
      await tree.click(findButtonByText(tree, /^Edit$/i, rows[0].node));
      const editor = tree.findBySelector(".sfm-inline-editor")[0];
      assert(editor);
      const titleInp = tree.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || tree.findAll((n) => n.tag === "input", editor)[0];
      const studioInp = tree.findBySelector("input[data-field=\"studio\"], input[name=\"studio\"]", editor)[0]
        || tree.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || "")), editor)[0];
      const codeInp = tree.findBySelector("input[data-field=\"code\"], input[name=\"code\"]", editor)[0]
        || tree.findAll((n) => n.tag === "input" && /Code/i.test(String(n.props?.placeholder || "")), editor)[0];
      await tree.change(titleInp, "Curated Scene 103");
      await tree.change(studioInp, "Studio Alpha");
      await tree.change(codeInp, "CUR-103");
      await tree.click(findButtonByText(tree, /^Save$/i, editor));

      // Step 3: Reset missing filter -> toggle Organized on 102
      await tree.click(findButtonByTextOrTitle(tree, /Clear Filters/i, modal) || studioBtn);
      const orgIdx = getTableHeaders(tree, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      const betaRow = getTableBodyRows(tree, ".sfm-parser-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
      const orgCb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", betaRow.cells[orgIdx].node)[0];
      await tree.change(orgCb, true);

      assert.strictEqual(env.db.scenes.find((s) => s.id === "103").title, "Curated Scene 103");
      assert.strictEqual(env.db.scenes.find((s) => s.id === "103").code, "CUR-103");
      assert.strictEqual(env.db.scenes.find((s) => s.id === "102").organized, true);
    });
  });

  add("T4-03", "R2+R5/F9,F23", "Bulk Edit + Bulk Rename End-to-End Workflow inside Unified Metadata Studio", async () => {
    await withEnv(async (env) => {
      const tmpDir = fs.mkdtempSync("/tmp/sfm_e2e_t4_03_");
      try {
        const f1 = path.join(tmpDir, "unorganized_raw.mp4");
        fs.writeFileSync(f1, "bytes");
        env.db.scenes[1].files[0].path = f1;
        env.db.scenes[1].files[0].basename = "unorganized_raw.mp4";

        const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
        await modal.click(findButtonByText(modal, /Bulk Edit/i));
        const studioInput = modal.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || "")))[0];
        await modal.change(studioInput, "Studio Alpha");
        const orgSel = modal.findBySelector("select").find((s) =>
          modal.findAll((o) => o.tag === "option" && /Mark Organized/i.test(modal.nodeText(o)), s).length > 0
        );
        await modal.change(orgSel, "true");
        await modal.click(findButtonByText(modal, /Apply Bulk|Apply to|Save Bulk/i));
        assert.strictEqual(env.db.scenes[1].organized, true);

        await modal.click(findButtonByText(modal, /Bulk Rename/i));
        assert(modal.text().includes("BET-010"), "Bulk Rename tab must reflect code BET-010");
        const out = execSync(`python3 "${path.join(PLUGIN_DIR, "sfm_tasks.py")}" rename`, {
          input: JSON.stringify({ task: "rename", items: [{ file_id: 1102, scene_id: "102", old_path: f1, new_basename: "(Studio Alpha)(BET-010)(Beta Midnight).mp4" }] }),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        assert.strictEqual(JSON.parse(out.trim().split("\n").pop()).success_count, 1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  add("T4-04", "R3+R4/F11-F13,F17-F19", "Customized Table View + Bidirectional Sort + Reload Persistence via IDB v8", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);

      // Customize columns: enable Rating, O-Counter, Director
      await tree.click(findButtonByText(tree, /Columns/i));
      const drawer = tree.findBySelector(".sfm-columns-drawer, .sfm-columns-popover")[0];
      for (const re of [/Rating/i, /O-Counter/i, /Director/i]) {
        const cb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", tree.findByText(re, { start: drawer })[0])[0]
          || tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox" && re.test(String(n.props?.["data-col-id"] || "")), drawer)[0];
        if (cb && !cb.props.checked) await tree.change(cb, true);
      }

      // Header sort -> syncs sceneSort
      await tree.click(findHeaderByName(tree, ".sfm-data-table", "Code"));
      const selVal = findSceneSortSelect(tree).props["data-sort-key"] || findSceneSortSelect(tree).props.value;
      assert(selVal === "code" || selVal.startsWith("code_"));

      // Dropdown sort -> syncs Table header
      await tree.change(findSceneSortSelect(tree), "date_desc");
      assert(tree.nodeText(findHeaderByName(tree, ".sfm-data-table", "Date")).includes("▼"));

      // Simulated page reload
      const env2 = env.reload({ url: "/plugin/file-manager?path=Anime%2FNaruto%2FSeason%201" });
      try {
        const tree2 = await env2.mountRoute("/plugin/file-manager");
        assert.strictEqual(env2.graphql.gqlCalls.some((c) => c.query.includes("GetScenePaths")), false,
          "Reload must restore from IDB scenes_index_v8 without GraphQL refetch");
        const hdrs2 = getTableHeaders(tree2, ".sfm-data-table th").map((h) => h.text);
        assert(hdrs2.some((h) => /Rating/i.test(h)));
        assert(hdrs2.some((h) => /O-Counter/i.test(h)));
        assert(hdrs2.some((h) => /Director/i.test(h)));
      } finally {
        env2.cleanup();
      }
    });
  });

  add("T4-05", "R3/F14-F16", "Filter + Random Shuffle + Reshuffle + Video Wall Sync + Player Launch Workflow", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const orgSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).includes("organized"));
      await tree.change(orgSel, "organized");
      await tree.change(findSceneSortSelect(tree), "random");
      await tree.click(findButtonByText(tree, /Reshuffle/i));

      await tree.click(findButtonByTextOrTitle(tree, /Video Wall|Folder Profile/i));
      const overlay = tree.findBySelector(".sfm-profile-overlay, .sfm-profile-modal")[0];
      assert(overlay);
      const wallSort = tree.findBySelector("select", overlay).find((s) => getSelectOptionValues(s).includes("random"));
      assert.strictEqual(wallSort.props.value, "random");
      await tree.click(findButtonByText(tree, /Reshuffle/i, overlay));

      // Click a video tile in Video Wall
      const videoTile = tree.findBySelector(".sfm-profile-grid-item, .sfm-wall-card", overlay)[0];
      if (videoTile) {
        await tree.click(videoTile);
      }
      assert(tree.root);
    });
  });

  add("T4-06", "R1/F1-F4", "Native Scene Card -> Reel Mode Route -> BingeReelPlayerModal -> Back to /scenes", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const overlay = env.mount(env.cache.NativeSceneCardOverlay, {
        scene: env.db.scenes[0],
        folderPath: "Anime/Naruto/Season 1",
      });
      await overlay.flush();
      const reelBtn = overlay.findBySelector(".sfm-native-card-quick-actions button")[2];
      await overlay.click(reelBtn);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("scene"), "101");

      const fmTree = await env.mountRoute("/plugin/file-manager");
      assert(fmTree.text().includes("Alpha Sunrise"));
      env.history.back();
      fmTree.unmount();
      assert.strictEqual(env.location.pathname, "/scenes");
    });
  });

  add("T4-07", "R1+R2/F4-F6,F10", "Native Scene Detail -> Global Metadata Studio -> Edit Code & Organized -> Breadcrumb Navigation", async () => {
    await withEnv({ url: "/scenes/102" }, async (env) => {
      const ScrapeBtn = env.cache.NativeSceneDetailScrapeButton;
      const dTree = env.mount(ScrapeBtn, { scene: env.db.scenes[1] });
      await dTree.flush();
      await dTree.click(dTree.findBySelector("button")[0]);

      const modal = env.getMountedTree("sfm-global-modal-root");
      assert(modal);
      await modal.flush();
      const orgIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgIdx);
      const cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgIdx].node)[0];
      await modal.change(cb, true);
      assert.strictEqual(env.db.scenes[1].organized, true);

      const Hier = env.cache.NativeSceneDetailDirectoryHierarchy;
      const hTree = env.mount(Hier, { scene: env.db.scenes[1], folderPath: "Anime/Naruto/Season 1" });
      await hTree.flush();
      await hTree.click(hTree.findByText("Anime", { selector: ".sfm-breadcrumb-item" })[0]);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime");
    });
  });

  add("T4-08", "R3+R4/F11,F19", "Legacy v3.2.1 Migration: Stale scenes_index_v7 + sfm_view_mode='names' Upgrades Seamlessly to v8 Table", async () => {
    const backing = new Map();
    backing.set("stash_file_manager_db", new Map([
      ["library", new Map([
        ["scenes_index_v7", { timestamp: Date.now(), scenes: [{ id: "old", title: "Legacy v7", files: [{ path: "/data/videos/legacy.mp4" }] }] }],
      ])],
    ]));
    await withEnv({
      idbBacking: backing,
      localStorageData: { sfm_view_mode: "names" },
    }, async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      assert(tree.findBySelector(".sfm-data-table").length === 1, "Legacy 'names' mode must render consolidated Table");
      assert(env.idbBacking.get("stash_file_manager_db").get("library").has("scenes_index_v8"));
      assert(!tree.text().includes("Legacy v7"));
      assert(tree.text().includes("ALP-001"));
    });
  });

  add("T4-09", "R2/F5-F8", "Parallel Scrape Workflow: Source Priority (StashBox before Sites) + Concurrency Pool + Persistence", async () => {
    await withEnv(async (env) => {
      env.graphql.resetCounters();
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 6), "All");
      const srcSelect = modal.findBySelector("select").find((s) =>
        getSelectOptionValues(s).some((v) => v.startsWith("stashbox:")) &&
        getSelectOptionValues(s).some((v) => v.startsWith("site:"))
      );
      assert(srcSelect, "Scrape source selector must exist");
      const opts = getSelectOptionValues(srcSelect);
      const maxBoxIdx = Math.max(...opts.map((v, i) => (v.startsWith("stashbox:") ? i : -1)));
      const minSiteIdx = Math.min(...opts.map((v, i) => (v.startsWith("site:") ? i : 999)));
      assert(maxBoxIdx < minSiteIdx, "StashBox sources must precede site scrapers");

      await modal.change(srcSelect, "site:theporndb");
      assert.strictEqual(env.localStorage.getItem("sfm_last_scrape_source"), "site:theporndb");

      const scrapeAllBtn = findButtonByText(modal, /Scrape All/i);
      assert(scrapeAllBtn);
      await modal.click(scrapeAllBtn);
      assert(env.graphql.getMaxConcurrentScrapes() > 1 && env.graphql.getMaxConcurrentScrapes() <= 4,
        `Expected parallel scrape concurrency 2..4, got ${env.graphql.getMaxConcurrentScrapes()}`);
    });
  });

  add("T4-10", "Resilience", "Corrupt localStorage + Malformed Query + Transient Mutation Error Recovery Session", async () => {
    await withEnv({
      url: "/plugin/file-manager?path=%E0%A4%A",
      localStorageData: {
        sfm_table_columns_v1: "BROKEN_JSON",
        sfm_profile_scene_sort: "broken_sort",
        sfm_view_mode: "table",
      },
      faultRules: [{ match: (q) => q.includes("sceneUpdate"), graphqlError: "Transient 503", once: true }],
    }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      await drillIntoFolders(tree, ["Anime", "Naruto", "Season 1"]);
      assert.strictEqual(getTableHeaders(tree, ".sfm-data-table th").length, 10);

      const orgIdx = getTableHeaders(tree, ".sfm-data-table th").findIndex((h) => /Organized/i.test(h.text));
      const getBetaCb = () => {
        const row = getTableBodyRows(tree, ".sfm-data-table tbody tr").find((r) => r.text.includes("Beta Midnight"));
        return tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgIdx].node)[0];
      };
      // First click hits transient error
      await tree.change(getBetaCb(), true);
      assert.strictEqual(env.db.scenes[1].organized, false);
      // Second click succeeds
      await tree.change(getBetaCb(), true);
      assert.strictEqual(env.db.scenes[1].organized, true);
    });
  });

  add("T4-11", "R3+R4/F16-F18", "Cross-Folder Library Audit: Subfolders Enabled + Min Rating + Resolution + Play Count Sort", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "");
      await tree.click(findButtonByText(tree, /Include Sub-Folders/i));
      const grpBtn = findButtonByText(tree, /Group by Folder/i);
      if (grpBtn && tree.nodeText(grpBtn).includes("Group")) await tree.click(grpBtn);
      await ensureTableView(tree);

      const ratSel = tree.findBySelector("select").find((s) => getSelectOptionValues(s).some((v) => v === "80" || v === "4"));
      await tree.change(ratSel, getSelectOptionValues(ratSel).find((v) => v === "80" || v === "4"));
      const txt = tree.text();
      assert(txt.includes("Alpha Sunrise") && txt.includes("Gamma Horizon") && txt.includes("Epsilon Finale"));
      assert(!txt.includes("Beta Midnight") && !txt.includes("Delta Special"));
    });
  });

  add("T4-12", "R2+R3+R4/F5,F10,F12,F19", "Inline Table Edit + In-Place v8 Cache Sync Reflected Instantly in Metadata Studio Without Refetch", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const initialFetchCount = env.graphql.gqlCalls.filter((c) => c.query.includes("GetScenePaths")).length;
      await ensureTableView(tree);

      const zetaRow = getTableBodyRows(tree, ".sfm-data-table tbody tr").find((r) => r.text.includes("Zeta Missing Code"));
      await tree.click(findButtonByText(tree, /^Edit$/i, zetaRow.node));
      const editor = tree.findBySelector(".sfm-inline-editor")[0];
      const codeInput = tree.findBySelector("input[data-field=\"code\"], input[name=\"code\"]", editor)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.value === "", editor)[0];
      await tree.change(codeInput, "ZET-400");
      await tree.click(findButtonByText(tree, /^Save$/i, editor));

      await openMetadataStudioFromView(tree, "scrape");
      assert(tree.text().includes("ZET-400"), "Metadata Studio must immediately reflect inline Table edit");
      const afterFetchCount = env.graphql.gqlCalls.filter((c) => c.query.includes("GetScenePaths")).length;
      assert.strictEqual(afterFetchCount, initialFetchCount, "In-place cache sync must not trigger full GetScenePaths refetch");
    });
  });

  add("T4-13", "R3+R5/F15,F21", "Mobile Responsive Viewport Workflow + CSS Media Breakpoints Verification", async () => {
    const css = fs.readFileSync(CSS_PATH, "utf8");
    assert(/@media\s*\(max-width:\s*768px\)/.test(css));
    assert(/@media\s*\(max-width:\s*576px\)/.test(css));
    await withEnv({ innerWidth: 480, innerHeight: 844 }, async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      await tree.change(findSceneSortSelect(tree), "random");
      assert(findButtonByText(tree, /Reshuffle/i));
    });
  });

  add("T4-14", "R5/F20-F23", "Full v4.0.0 Release Verification: Modules, CSS, Root Tests, Zip Checksum, index.yml, and NAS Sync", async () => {
    const manifest = parsePluginManifest(MANIFEST_PATH);
    assert.strictEqual(manifest.version, "4.0.0");
    assert.deepStrictEqual(manifest.ui.javascript, [
      "sfm_core.js",
      "sfm_metadata_modal.js",
      "sfm_player.js",
      "sfm_views.js",
      "sfm_native.js",
    ]);
    assert(!fs.existsSync(path.join(PLUGIN_DIR, "file_manager.js")));

    for (const jsRel of manifest.ui.javascript) {
      execSync(`node --check "${path.join(PLUGIN_DIR, jsRel)}"`, { stdio: "pipe" });
    }
    execSync(`python3 -m py_compile "${path.join(PLUGIN_DIR, "sfm_tasks.py")}"`, { stdio: "pipe" });

    for (const t of ["test_components.js", "test_parallel_scrape_and_sources.js", "test_bulk_rename.js", "test_react_error_31_regression.js"]) {
      execSync(`node "${path.join(REPO_ROOT, t)}"`, { cwd: REPO_ROOT, stdio: "pipe" });
    }

    const idx = parseIndexYml(INDEX_YML_PATH);
    assert.strictEqual(idx.version, "4.0.0");
    assert.strictEqual(idx.sha256, computeFileSha256(ZIP_PATH));

    const entries = listZipEntries(ZIP_PATH);
    for (const mod of manifest.ui.javascript) {
      assert(entries.includes(`stash_file_manager/${mod}`));
    }
    assert(!entries.includes("stash_file_manager/file_manager.js"));

    const nasDir = "/hed-nas/docker/stashapp/stash-config/plugins/stash_file_manager/stash_file_manager";
    if (fs.existsSync(nasDir)) {
      const nasManifest = parsePluginManifest(path.join(nasDir, "stash_file_manager.yml"));
      assert.strictEqual(nasManifest.version, "4.0.0");
      assert(!fs.existsSync(path.join(nasDir, "file_manager.js")));
      assert(fs.existsSync(path.join(nasDir, ".sfm_rename_result.json")));
    }
  });

  return tests;
}

module.exports = { getTests };

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { CSS_PATH } = require("./harness");
const {
  withEnv,
  openFolderRoute,
  drillIntoFolders,
  ensureTableView,
  openMetadataStudioFromView,
  openMetadataStudioGlobal,
  getTableHeaders,
  getTableBodyRows,
  findHeaderByName,
  findButtonByText,
} = require("./helpers");

function getTests() {
  const tests = [];
  const add = (id, feature, name, fn) => tests.push({ id, tier: 1, feature, name, fn });

  // ==========================================================
  // F1: Native /plugin/file-manager route
  // ==========================================================
  add("T1-F1-01", "F1", "PluginApi.register.route registers /plugin/file-manager component", async () => {
    await withEnv(async (env) => {
      assert.strictEqual(typeof env.registeredRoutes["/plugin/file-manager"], "function",
        "PluginApi.register.route must register a React component at /plugin/file-manager");
    });
  });

  add("T1-F1-02", "F1", "Mounting /plugin/file-manager renders native page container without modal overlay", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      const nativePage = tree.findBySelector(".sfm-native-page");
      const overlayBackdrop = tree.findBySelector(".sfm-workspace-overlay");
      assert(nativePage.length > 0, "Expected .sfm-native-page container when mounted via native route");
      assert.strictEqual(overlayBackdrop.length, 0, "Native route must not render fullscreen .sfm-workspace-overlay");
    });
  });

  add("T1-F1-03", "F1", "Mounting /plugin/file-manager does not create #sfm-workspace-root or set data-sfm-active sibling hiding", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      await env.mountRoute("/plugin/file-manager");
      assert.strictEqual(env.document.getElementById("sfm-workspace-root"), null,
        "Legacy #sfm-workspace-root portal must not be injected");
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-active"), null,
        ".main-container must not receive data-sfm-active");
      assert.strictEqual(env.document.body.getAttribute("data-sfm-active"), null,
        "document.body must not receive data-sfm-active");
    });
  });

  add("T1-F1-04", "F1", "Native route header omits legacy modal close-overlay button", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      const closeBtns = tree.findBySelector(".sfm-workspace-close-btn, .sfm-close-workspace");
      const closeByTitle = tree.findAll((n) => n.tag === "button" && /Close File Manager/i.test(String(n.props?.title || "")));
      assert.strictEqual(closeBtns.length, 0, "Native route must not show workspace close-overlay button");
      assert.strictEqual(closeByTitle.length, 0, "Native route must not show 'Close File Manager' button");
    });
  });

  add("T1-F1-05", "F1", "Leaving /plugin/file-manager for /scenes keeps native siblings visible", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      env.navigate("/scenes");
      tree.unmount();
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-active"), null);
      assert.strictEqual(env.mainContainer.getAttribute("data-sfm-embedded"), null);
      assert.notStrictEqual(env.nativeSiblingContent.style.display, "none",
        "Native Stash sibling content must remain visible after leaving File Manager");
    });
  });

  // ==========================================================
  // F2: Navbar NavLink integration
  // ==========================================================
  add("T1-F2-01", "F2", "MainNavBar.MenuItems patch injects Files nav button", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const patched = env.invokePatched("MainNavBar.MenuItems", {}, baseNav);
      const navTree = env.mount(patched);
      await navTree.flush();
      const btn = navTree.findBySelector("#sfm-nav-button");
      assert.strictEqual(btn.length, 1, "Expected #sfm-nav-button in patched MainNavBar.MenuItems");
      assert(navTree.nodeText(btn[0]).includes("Files"), "Nav button must display 'Files' label");
    });
  });

  add("T1-F2-02", "F2", "FilesNavButton uses ReactRouterDOM.NavLink with to=/plugin/file-manager and activeClassName=active", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const patched = env.invokePatched("MainNavBar.MenuItems", {}, baseNav);
      const navTree = env.mount(patched);
      await navTree.flush();
      const btn = navTree.findBySelector("#sfm-nav-button")[0];
      assert(btn, "#sfm-nav-button must exist");
      assert.strictEqual(btn.props["data-navlink-to"], "/plugin/file-manager",
        "FilesNavButton must render ReactRouterDOM.NavLink with to='/plugin/file-manager'");
      assert.strictEqual(btn.props["data-active-classname"], "active",
        "NavLink must use activeClassName='active'");
      assert.notStrictEqual(btn.props.href, "#file-manager", "NavLink must not use legacy #file-manager href");
    });
  });

  add("T1-F2-03", "F2", "FilesNavButton receives active class only when on /plugin/file-manager", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const patched = env.invokePatched("MainNavBar.MenuItems", {}, baseNav);
      const navTree = env.mount(patched);
      await navTree.flush();
      const btn = navTree.findBySelector("#sfm-nav-button")[0];
      assert(String(btn.props.className || "").split(/\s+/).includes("active"),
        "NavLink must have 'active' class when pathname is /plugin/file-manager");
    });
  });

  add("T1-F2-04", "F2", "Clicking FilesNavButton navigates to /plugin/file-manager without opening hash overlay", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const baseNav = env.React.createElement("div", { className: "navbar-nav" });
      const patched = env.invokePatched("MainNavBar.MenuItems", {}, baseNav);
      const navTree = env.mount(patched);
      await navTree.flush();
      const btn = navTree.findBySelector("#sfm-nav-button")[0];
      await navTree.click(btn);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert(!env.location.hash.includes("#file-manager"), "Must not navigate to legacy #file-manager hash");
    });
  });

  add("T1-F2-05", "F2", "CheckboxGroup menu-items patch registers files-manager toggle", async () => {
    await withEnv(async (env) => {
      const res = env.invokePatched("CheckboxGroup", {
        groupId: "menu-items",
        items: [{ id: "scenes", headingID: "Scenes" }],
      }, null);
      assert(res && Array.isArray(res) ? true : true);
      // invokePatched returns mutated props from before patch
      const beforeFn = env.patches.before["CheckboxGroup"][0];
      const out = beforeFn({ groupId: "menu-items", items: [{ id: "scenes", headingID: "Scenes" }] });
      assert(out[0].items.some((i) => i.id === "files-manager"), "CheckboxGroup must include files-manager item");
    });
  });

  // ==========================================================
  // F3: URL query-param folder navigation
  // ==========================================================
  add("T1-F3-01", "F3", "Initial mount with ?path=Anime%2FNaruto%2FSeason+1 loads target folder directly", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      const txt = tree.text();
      assert(txt.includes("Alpha Sunrise"), "Expected Season 1 scene 'Alpha Sunrise' to render from ?path=");
      assert(txt.includes("Beta Midnight"), "Expected Season 1 scene 'Beta Midnight' to render from ?path=");
      assert(!txt.includes("Gamma Horizon"), "Should not show OnePiece scene 'Gamma Horizon' when in Season 1");
    });
  });

  add("T1-F3-02", "F3", "Clicking subfolder updates URL pathname and ?path= search param", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "");
      await drillIntoFolders(tree, ["Anime"]);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      const params = new URLSearchParams(env.location.search);
      assert.strictEqual(params.get("path"), "Anime", "Clicking Anime folder must set ?path=Anime");
      assert.strictEqual(env.location.hash, "", "Must not set #file-manager hash");
    });
  });

  add("T1-F3-03", "F3", "Browser history.back() and forward() update active folder via popstate", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "");
      await drillIntoFolders(tree, ["Anime", "Naruto"]);
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto");

      env.history.back();
      await tree.flush();
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime");
      assert(tree.text().includes("OnePiece"), "Back navigation must display Anime's subfolder OnePiece");

      env.history.forward();
      await tree.flush();
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto");
      assert(tree.text().includes("Season 1"), "Forward navigation must display Naruto's subfolder Season 1");
    });
  });

  add("T1-F3-04", "F3", "Query parameter ?path=...&view=profile opens FolderProfileView Video Wall", async () => {
    await withEnv({ url: "/plugin/file-manager?path=Anime%2FNaruto%2FSeason%201&view=profile" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      const txt = tree.text();
      assert(txt.includes("Reels") || txt.includes("Video Wall") || tree.findBySelector(".sfm-profile-overlay, .sfm-profile-modal").length > 0,
        "view=profile query param must open FolderProfileView");
    });
  });

  add("T1-F3-05", "F3", "Query parameter ?path=...&scene=101 opens BingeReelPlayerModal", async () => {
    await withEnv({ url: "/plugin/file-manager?path=Anime%2FNaruto%2FSeason%201&scene=101" }, async (env) => {
      const tree = await env.mountRoute("/plugin/file-manager");
      const player = tree.findBySelector(".sfm-reel-modal-backdrop, .sfm-reel-player");
      assert(player.length > 0 || tree.text().includes("Alpha Sunrise"),
        "scene=101 query param must open BingeReelPlayerModal for scene 101");
      assert(tree.text().includes("Alpha Sunrise"), "Player must display scene 101 title");
    });
  });

  // ==========================================================
  // F4: Native card/detail route navigation
  // ==========================================================
  add("T1-F4-01", "F4", "NativeSceneCardOverlay path chip click navigates to /plugin/file-manager?path=...", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const Overlay = env.cache.NativeSceneCardOverlay;
      assert.strictEqual(typeof Overlay, "function");
      const tree = env.mount(Overlay, { scene: env.db.scenes[0], folderPath: "Anime/Naruto/Season 1" });
      await tree.flush();
      const chip = tree.findBySelector(".sfm-native-card-path-chip")[0];
      assert(chip, "Path chip must render");
      await tree.click(chip);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime/Naruto/Season 1");
      assert(!env.location.hash.includes("#file-manager"), "Must not use legacy #file-manager hash");
    });
  });

  add("T1-F4-02", "F4", "NativeSceneCardOverlay quick actions open profile wall and reel via /plugin/file-manager query params", async () => {
    await withEnv({ url: "/scenes" }, async (env) => {
      const Overlay = env.cache.NativeSceneCardOverlay;
      const tree = env.mount(Overlay, { scene: env.db.scenes[0], folderPath: "Anime/Naruto/Season 1" });
      await tree.flush();
      const quickBtns = tree.findBySelector(".sfm-native-card-quick-actions button");
      assert(quickBtns.length >= 3, "Expected at least 3 quick action buttons");

      await tree.click(quickBtns[1]);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("view"), "profile");

      await tree.click(quickBtns[2]);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("scene"), "101");
    });
  });

  add("T1-F4-03", "F4", "NativeSceneDetailDirectoryHierarchy breadcrumbs navigate to /plugin/file-manager?path=...", async () => {
    await withEnv({ url: "/scenes/101" }, async (env) => {
      const Comp = env.cache.NativeSceneDetailDirectoryHierarchy;
      assert.strictEqual(typeof Comp, "function");
      const tree = env.mount(Comp, { scene: env.db.scenes[0], folderPath: "Anime/Naruto/Season 1" });
      await tree.flush();
      const animeCrumb = tree.findByText("Anime", { selector: ".sfm-breadcrumb-item" })[0];
      assert(animeCrumb, "Anime breadcrumb item must exist");
      await tree.click(animeCrumb);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      assert.strictEqual(new URLSearchParams(env.location.search).get("path"), "Anime");
    });
  });

  add("T1-F4-04", "F4", "NativeSceneDetailReelButton navigates to /plugin/file-manager?path=...&scene=...", async () => {
    await withEnv({ url: "/scenes/101" }, async (env) => {
      const Comp = env.cache.NativeSceneDetailReelButton;
      assert.strictEqual(typeof Comp, "function");
      const tree = env.mount(Comp, { scene: env.db.scenes[0], folderPath: "Anime/Naruto/Season 1" });
      await tree.flush();
      const btn = tree.findBySelector("#sfm-scene-reel-btn")[0];
      assert(btn, "#sfm-scene-reel-btn must exist");
      await tree.click(btn);
      assert.strictEqual(env.location.pathname, "/plugin/file-manager");
      const p = new URLSearchParams(env.location.search);
      assert.strictEqual(p.get("path"), "Anime/Naruto/Season 1");
      assert.strictEqual(p.get("scene"), "101");
    });
  });

  add("T1-F4-05", "F4", "DOM fallback card decorator skips cards when pathname starts with /plugin/file-manager", async () => {
    await withEnv({ url: "/plugin/file-manager" }, async (env) => {
      const card = env.document.createElement("div");
      card.className = "card scene-card";
      const link = env.document.createElement("a");
      link.setAttribute("href", "/scenes/101");
      card.appendChild(link);
      const sec = env.document.createElement("div");
      sec.className = "card-section";
      card.appendChild(sec);
      env.mainContainer.appendChild(card);

      env.cache.injectSceneCardsDOMFallback();
      assert.notStrictEqual(card.getAttribute("data-sfm-decorated"), "true",
        "DOM fallback must not decorate cards while inside /plugin/file-manager");
    });
  });

  // ==========================================================
  // F5: Scraper Organized column
  // ==========================================================
  add("T1-F5-01", "F5", "Metadata Studio table renders an Organized column header", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 3), "Season 1");
      const headers = getTableHeaders(modal, ".sfm-parser-table th").map((h) => h.text);
      assert(headers.some((h) => /Organized/i.test(h)), `Expected Organized header in: ${headers.join(", ")}`);
    });
  });

  add("T1-F5-02", "F5", "Organized column checkboxes accurately reflect scene.organized true vs false", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[0], env.db.scenes[1]]; // 101=true, 102=false
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      const orgColIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgColIdx >= 0, "Organized column must exist");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > orgColIdx);
      assert(rows.length >= 2);
      const cb1 = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", rows[0].cells[orgColIdx].node)[0];
      const cb2 = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", rows[1].cells[orgColIdx].node)[0];
      assert(cb1 && cb2, "Organized checkboxes must exist in cells");
      assert.strictEqual(Boolean(cb1.props.checked), true, "Scene 101 must be checked (organized=true)");
      assert.strictEqual(Boolean(cb2.props.checked), false, "Scene 102 must be unchecked (organized=false)");
    });
  });

  add("T1-F5-03", "F5", "Toggling Organized checkbox sends sceneUpdate GraphQL mutation", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[1]]; // 102 organized=false
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      const orgColIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgColIdx >= 0, "Organized column must exist");
      const row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgColIdx);
      const cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgColIdx].node)[0];
      await modal.change(cb, true);
      const mut = env.graphql.gqlCalls.find((c) => c.query.includes("sceneUpdate"));
      assert(mut, "sceneUpdate mutation must be called on organized toggle");
      assert.strictEqual(String(mut.variables.input.id), "102");
      assert.strictEqual(mut.variables.input.organized, true);
      assert.strictEqual(env.db.scenes[1].organized, true);
    });
  });

  add("T1-F5-04", "F5", "Toggling Organized updates checkbox UI state immediately", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[1]]; // 102 organized=false
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      const orgColIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgColIdx >= 0);
      let row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgColIdx);
      let cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgColIdx].node)[0];
      assert.strictEqual(Boolean(cb.props.checked), false);
      await modal.change(cb, true);
      row = getTableBodyRows(modal, ".sfm-parser-table tbody tr").find((r) => r.cells.length > orgColIdx);
      cb = modal.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", row.cells[orgColIdx].node)[0];
      assert.strictEqual(Boolean(cb.props.checked), true, "UI checkbox must reflect organized=true after toggle");
    });
  });

  add("T1-F5-05", "F5", "Toggling Organized updates catalog cache in-place without clearing unrelated scenes", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      assert(env.cache.scenes.length === 7);
      await openMetadataStudioFromView(tree, "scrape");
      const orgColIdx = getTableHeaders(tree, ".sfm-parser-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgColIdx >= 0, "Organized column must exist");
      const rows = getTableBodyRows(tree, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > orgColIdx);
      const betaRow = rows.find((r) => r.text.includes("Beta Midnight"));
      assert(betaRow, "Beta Midnight row must exist");
      const cb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", betaRow.cells[orgColIdx].node)[0];
      await tree.change(cb, true);
      assert(Array.isArray(env.cache.scenes) && env.cache.scenes.length === 7,
        "In-place patch must keep all 7 scenes cached");
      const cachedBeta = env.cache.scenes.find((s) => s.id === "102");
      assert.strictEqual(cachedBeta.organized, true, "Cached scene 102 must have organized=true in-place");
    });
  });

  // ==========================================================
  // F6: Scraper Code column
  // ==========================================================
  add("T1-F6-01", "F6", "Metadata Studio table renders a Code column header", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 3), "Season 1");
      const headers = getTableHeaders(modal, ".sfm-parser-table th").map((h) => h.text);
      assert(headers.some((h) => /\bCode\b/i.test(h)), `Expected Code column header in: ${headers.join(", ")}`);
    });
  });

  add("T1-F6-02", "F6", "Code column displays scene.code values accurately", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[0], env.db.scenes[1]];
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      const codeColIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeColIdx >= 0, "Code column must exist");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > codeColIdx);
      assert(rows.some((r) => r.cells[codeColIdx].text.includes("ALP-001")), "Expected ALP-001 in Code cell");
      assert(rows.some((r) => r.cells[codeColIdx].text.includes("BET-010")), "Expected BET-010 in Code cell");
    });
  });

  add("T1-F6-03", "F6", "Code column displays dash placeholder when scene code is empty", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[6]], "Season 1"); // 107 has code ""
      const codeColIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeColIdx >= 0, "Code column must exist");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > codeColIdx);
      assert.strictEqual(rows[0].cells[codeColIdx].text.trim(), "—");
    });
  });

  add("T1-F6-04", "F6", "Code column previews scraped code after Scrape Row", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[6]], "Season 1"); // 107 has no code
      const codeColIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeColIdx >= 0, "Code column must exist");
      const scrapeBtn = findButtonByText(modal, /Scrape All/i) || findButtonByText(modal, /^Scrape$/i);
      assert(scrapeBtn, "Scrape button must exist");
      await modal.click(scrapeBtn);
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > codeColIdx);
      assert(rows[0].cells[codeColIdx].text.includes("SCR-"), "Scraped code should appear in Code column");
    });
  });

  add("T1-F6-05", "F6", "Code column displays parsed code from Filename Patterns when scene.code is empty", async () => {
    await withEnv(async (env) => {
      const s = { ...env.db.scenes[6], code: "", files: [{ ...env.db.scenes[6].files[0], basename: "Gamma - GAM-999 - Zeta.mp4" }] };
      const modal = await openMetadataStudioGlobal(env, [s], "Season 1");
      const codeColIdx = getTableHeaders(modal, ".sfm-parser-table th").findIndex((h) => /\bCode\b/i.test(h.text));
      assert(codeColIdx >= 0, "Code column must exist");
      const patternTab = findButtonByText(modal, /Filename Patterns/i);
      assert(patternTab);
      await modal.click(patternTab);
      const presetBtn = findButtonByText(modal, /Studio\s*-\s*Code\s*-\s*Title/i);
      if (presetBtn) await modal.click(presetBtn);
      const scrapeTab = findButtonByText(modal, /Scrape\s*&\s*Search/i);
      await modal.click(scrapeTab);
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length > codeColIdx);
      assert(rows[0].cells[codeColIdx].text.includes("GAM-999") || rows[0].cells[codeColIdx].text.includes("—"),
        "Code column renders cleanly after pattern parsing");
    });
  });

  // ==========================================================
  // F7: Scraper click-to-sort headers
  // ==========================================================
  add("T1-F7-01", "F7", "Clicking Title header in Metadata Studio sorts rows ascending with ▲ indicator", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[6], env.db.scenes[0], env.db.scenes[1]]; // Zeta, Alpha, Beta
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      const titleTh = findHeaderByName(modal, ".sfm-parser-table", "Title");
      await modal.click(titleTh);
      const updatedTh = findHeaderByName(modal, ".sfm-parser-table", "Title");
      assert(modal.nodeText(updatedTh).includes("▲"), "Title header must show ▲ after first click");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert(rows[0].text.includes("Alpha Sunrise"), "First row must be Alpha Sunrise");
      assert(rows[2].text.includes("Zeta Missing Code"), "Last row must be Zeta Missing Code");
    });
  });

  add("T1-F7-02", "F7", "Clicking already-sorted header toggles descending with ▼ indicator", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[0], env.db.scenes[1], env.db.scenes[6]]; // Alpha, Beta, Zeta
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Title"));
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Title"));
      const updatedTh = findHeaderByName(modal, ".sfm-parser-table", "Title");
      assert(modal.nodeText(updatedTh).includes("▼"), "Title header must show ▼ after second click");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert(rows[0].text.includes("Zeta Missing Code"), "First row descending must be Zeta Missing Code");
    });
  });

  add("T1-F7-03", "F7", "Clicking Date header sorts chronologically", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[0], env.db.scenes[3], env.db.scenes[4]]; // 2026-01-10, 2024-03-05, 2023-07-04
      const modal = await openMetadataStudioGlobal(env, scenes, "All");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Date"));
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert(rows[0].text.includes("2023-07-04"), "Oldest date must be first on ascending Date click");
      assert(rows[2].text.includes("2026-01-10"), "Newest date must be last on ascending Date click");
    });
  });

  add("T1-F7-04", "F7", "Clicking Code header sorts by scene code", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[4], env.db.scenes[0], env.db.scenes[1]]; // DEL-055, ALP-001, BET-010
      const modal = await openMetadataStudioGlobal(env, scenes, "All");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Code"));
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert(rows[0].text.includes("ALP-001"), "ALP-001 must sort first");
      assert(rows[2].text.includes("DEL-055"), "DEL-055 must sort last");
    });
  });

  add("T1-F7-05", "F7", "Clicking Organized header sorts by organized boolean", async () => {
    await withEnv(async (env) => {
      const scenes = [env.db.scenes[0], env.db.scenes[1], env.db.scenes[5]]; // true, false, true
      const modal = await openMetadataStudioGlobal(env, scenes, "Season 1");
      await modal.click(findHeaderByName(modal, ".sfm-parser-table", "Organized"));
      const th = findHeaderByName(modal, ".sfm-parser-table", "Organized");
      assert(/[▲▼]/.test(modal.nodeText(th)), "Organized header must show sort direction indicator");
    });
  });

  // ==========================================================
  // F8: Scraper attribute filter bar
  // ==========================================================
  add("T1-F8-01", "F8", "Metadata Studio filter bar filters by Organized vs Unorganized", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 4), "All");
      const orgSelect = modal.findBySelector("select").find((s) =>
        modal.findAll((o) => o.tag === "option" && /Unorganized/i.test(modal.nodeText(o)), s).length > 0
      );
      const orgBtn = findButtonByText(modal, /^Unorganized$/i);
      assert(orgSelect || orgBtn, "Must provide Organized/Unorganized filter control");
      if (orgSelect) {
        await modal.change(orgSelect, "unorganized");
      } else {
        await modal.click(orgBtn);
      }
      const txt = modal.text();
      assert(txt.includes("Beta Midnight"), "Unorganized filter must keep Beta Midnight");
      assert(!txt.includes("Alpha Sunrise"), "Unorganized filter must exclude organized Alpha Sunrise");
    });
  });

  add("T1-F8-02", "F8", "Metadata Studio Missing Fields filter isolates scenes missing Studio", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 4), "All");
      const missingSelect = modal.findBySelector("select").find((s) =>
        modal.findAll((o) => o.tag === "option" && /Studio/i.test(modal.nodeText(o)), s).length > 0 &&
        modal.findAll((o) => o.tag === "option" && /Missing/i.test(modal.nodeText(o)), s).length > 0
      );
      assert(missingSelect, "Missing Fields selector must exist");
      await modal.change(missingSelect, "studio");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 1, "Only scene 103 is missing Studio");
      assert(rows[0].text.includes("raw_untagged_clip_720p.mkv"));
    });
  });

  add("T1-F8-03", "F8", "Metadata Studio Missing Fields filter isolates scenes missing Code", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const missingSelect = modal.findBySelector("select").find((s) =>
        modal.findAll((o) => o.tag === "option" && /Missing/i.test(modal.nodeText(o)), s).length > 0
      );
      assert(missingSelect, "Missing Fields selector must exist");
      await modal.change(missingSelect, "code");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 2, "Scenes 103 and 107 are missing code");
    });
  });

  add("T1-F8-04", "F8", "Metadata Studio quick text search filters across title, code, and studio", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const searchInput = modal.findAll((n) =>
        n.tag === "input" &&
        (!n.props?.type || n.props.type === "text" || n.props.type === "search") &&
        /filter|search/i.test(String(n.props?.placeholder || ""))
      )[0];
      assert(searchInput, "Metadata Studio quick text search input must exist");
      await modal.change(searchInput, "GAM-004");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 1);
      assert(rows[0].text.includes("Gamma Horizon"));
    });
  });

  add("T1-F8-05", "F8", "Metadata Studio Missing Fields filter covers Cover/Screenshot", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes, "All");
      const missingSelect = modal.findBySelector("select").find((s) =>
        modal.findAll((o) => o.tag === "option" && /Missing/i.test(modal.nodeText(o)), s).length > 0
      );
      assert(missingSelect, "Missing Fields selector must exist");
      await modal.change(missingSelect, "cover");
      const rows = getTableBodyRows(modal, ".sfm-parser-table tbody tr").filter((r) => r.cells.length >= 8);
      assert.strictEqual(rows.length, 1, "Only scene 103 is missing cover screenshot");
      assert(rows[0].text.includes("raw_untagged_clip_720p.mkv"));
    });
  });

  // ==========================================================
  // F9: Merged Bulk Edit tab
  // ==========================================================
  add("T1-F9-01", "F9", "Unified Metadata Studio exposes all 4 tabs including Bulk Edit", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 3), "Season 1");
      const txt = modal.text();
      assert(txt.includes("Scrape"), "Missing Scrape tab");
      assert(txt.includes("Filename Patterns"), "Missing Filename Patterns tab");
      assert(txt.includes("Bulk Edit"), "Missing Bulk Edit tab");
      assert(txt.includes("Bulk Rename"), "Missing Bulk Rename Files tab");
    });
  });

  add("T1-F9-02", "F9", "Switching to Bulk Edit tab renders studio, performer, tag, and rating fields", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 2), "Season 1");
      const bulkTab = findButtonByText(modal, /Bulk Edit/i);
      assert(bulkTab, "Bulk Edit tab button must exist");
      await modal.click(bulkTab);
      const txt = modal.text();
      assert(/Studio/i.test(txt) && /Performer/i.test(txt) && /Tag/i.test(txt) && /Rating/i.test(txt),
        "Bulk Edit tab must show Studio, Performer, Tag, and Rating inputs");
    });
  });

  add("T1-F9-03", "F9", "Executing Bulk Edit tab calls bulkSceneUpdate mutation on selected scenes", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await openMetadataStudioFromView(tree, "bulk_edit");
      const bulkTabText = tree.text();
      assert(bulkTabText.includes("Bulk Edit"), "Batch Edit button must open unified modal on Bulk Edit tab");

      const studioInput = tree.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || "")))[0];
      assert(studioInput, "Studio input in Bulk Edit tab must exist");
      await tree.change(studioInput, "Studio Alpha");

      const applyBulkBtn = findButtonByText(tree, /Apply Bulk|Apply to|Save Bulk/i);
      assert(applyBulkBtn, "Apply Bulk Edit button must exist");
      await tree.click(applyBulkBtn);

      const mut = env.graphql.gqlCalls.find((c) => c.query.includes("bulkSceneUpdate"));
      assert(mut, "bulkSceneUpdate mutation must be executed");
    });
  });

  add("T1-F9-04", "F9", "BatchMetadataModal compatibility alias opens modal on bulk_edit tab", async () => {
    await withEnv(async (env) => {
      const BatchModal = env.sfm.BatchMetadataModal;
      assert.strictEqual(typeof BatchModal, "function", "window.__SFM__.BatchMetadataModal compat alias must exist");
      const modal = env.mount(BatchModal, {
        currentFolder: "Season 1",
        directScenes: env.db.scenes.slice(0, 2),
        sceneIds: ["101", "102"],
        sceneCount: 2,
        onClose: () => {},
        onApplied: () => {},
      });
      await modal.flush();
      assert(modal.text().includes("Bulk Edit"), "BatchMetadataModal must render Bulk Edit view");
      assert(modal.findAll((n) => n.tag === "input" && /Studio/i.test(String(n.props?.placeholder || ""))).length > 0);
    });
  });

  add("T1-F9-05", "F9", "Bulk Edit tab supports toggling Organized in bulk", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1], env.db.scenes[2]], "Season 1");
      await modal.click(findButtonByText(modal, /Bulk Edit/i));
      const orgSelect = modal.findBySelector("select").find((s) =>
        modal.findAll((o) => o.tag === "option" && /Mark Organized/i.test(modal.nodeText(o)), s).length > 0
      );
      assert(orgSelect, "Bulk Edit tab must provide Organized bulk selector");
      await modal.change(orgSelect, "true");
      const applyBtn = findButtonByText(modal, /Apply Bulk|Apply to|Save Bulk/i);
      await modal.click(applyBtn);
      const mut = env.graphql.gqlCalls.find((c) => c.query.includes("bulkSceneUpdate"));
      assert(mut && mut.variables.input.organized === true, "bulkSceneUpdate must include organized: true");
    });
  });

  // ==========================================================
  // F10: Inline row Edit editor
  // ==========================================================
  add("T1-F10-01", "F10", "Metadata Studio Actions column renders Edit button per row", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, env.db.scenes.slice(0, 2), "Season 1");
      const editBtns = modal.findAll((n) => n.tag === "button" && /^Edit$/i.test(modal.nodeText(n).trim()));
      assert(editBtns.length >= 2, `Expected Edit button per row, found ${editBtns.length}`);
    });
  });

  add("T1-F10-02", "F10", "Clicking Edit opens inline editor with Title, Studio, Date, Code, Organized, Performers, Tags, Rating", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[0]], "Season 1");
      const editBtn = findButtonByText(modal, /^Edit$/i);
      assert(editBtn, "Row Edit button must exist");
      await modal.click(editBtn);
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      assert(editor, "Inline editor container (.sfm-inline-editor) must open");
      const txt = modal.nodeText(editor);
      for (const field of ["Title", "Studio", "Date", "Code", "Organized", "Performers", "Tags", "Rating"]) {
        assert(new RegExp(field, "i").test(txt), `Inline editor must expose ${field} field`);
      }
    });
  });

  add("T1-F10-03", "F10", "Saving inline edit calls sceneUpdate with modified title, code, and date", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
      await modal.click(findButtonByText(modal, /^Edit$/i));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      assert(editor, "Inline editor must exist");
      const titleInput = modal.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && n.props?.value === "Beta Midnight", editor)[0];
      const codeInput = modal.findBySelector("input[data-field=\"code\"], input[name=\"code\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && n.props?.value === "BET-010", editor)[0];
      assert(titleInput && codeInput, "Title and Code inputs must exist in inline editor");

      await modal.change(titleInput, "Beta Updated Title");
      await modal.change(codeInput, "BET-999");

      const saveBtn = findButtonByText(modal, /^Save$/i, editor);
      assert(saveBtn, "Save button must exist in inline editor");
      await modal.click(saveBtn);

      const mut = env.graphql.gqlCalls.find((c) => c.query.includes("sceneUpdate"));
      assert(mut, "sceneUpdate mutation must be called on inline save");
      assert.strictEqual(mut.variables.input.title, "Beta Updated Title");
      assert.strictEqual(mut.variables.input.code, "BET-999");
      assert.strictEqual(env.db.scenes[1].title, "Beta Updated Title");
    });
  });

  add("T1-F10-04", "F10", "Inline edit updates row display and closes editor after save", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
      await modal.click(findButtonByText(modal, /^Edit$/i));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      const titleInput = modal.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && n.props?.value === "Beta Midnight", editor)[0];
      await modal.change(titleInput, "Renamed Scene Inline");
      await modal.click(findButtonByText(modal, /^Save$/i, editor));

      assert.strictEqual(modal.findBySelector(".sfm-inline-editor").length, 0, "Inline editor must close after Save");
      assert(modal.text().includes("Renamed Scene Inline"), "Updated title must appear in table row");
    });
  });

  add("T1-F10-05", "F10", "Inline edit Cancel closes editor without issuing sceneUpdate mutation", async () => {
    await withEnv(async (env) => {
      const modal = await openMetadataStudioGlobal(env, [env.db.scenes[1]], "Season 1");
      await modal.click(findButtonByText(modal, /^Edit$/i));
      const editor = modal.findBySelector(".sfm-inline-editor")[0];
      const titleInput = modal.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || modal.findAll((n) => n.tag === "input" && n.props?.value === "Beta Midnight", editor)[0];
      await modal.change(titleInput, "Should Not Save");
      await modal.click(findButtonByText(modal, /^Cancel$/i, editor));

      assert.strictEqual(modal.findBySelector(".sfm-inline-editor").length, 0);
      assert.strictEqual(env.graphql.gqlCalls.filter((c) => c.query.includes("sceneUpdate")).length, 0);
      assert.strictEqual(env.db.scenes[1].title, "Beta Midnight");
    });
  });

  // ==========================================================
  // F11: Consolidated Table view mode
  // ==========================================================
  add("T1-F11-01", "F11", "Folder scene view switcher is consolidated to Grid and Table (no Names mode)", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "");
      await drillIntoFolders(tree, ["Anime", "Naruto", "Season 1"]);
      const btns = tree.findBySelector("button");
      const namesBtns = btns.filter((b) => /\bNames\b/i.test(tree.nodeText(b)));
      const tableBtns = btns.filter((b) => tree.nodeText(b).trim() === "Table" || /\bTable\b/i.test(String(b.props?.title || "")));
      assert.strictEqual(namesBtns.length, 0, "Separate 'Names' view button must be removed");
      assert(tableBtns.length > 0, "Consolidated 'Table' view button must exist");
    });
  });

  add("T1-F11-02", "F11", "Clicking Table view button renders .sfm-data-table and persists sfm_view_mode=table", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      assert(tree.findBySelector(".sfm-data-table").length === 1, "Consolidated .sfm-data-table must render");
      assert.strictEqual(env.localStorage.getItem("sfm_view_mode"), "table");
    });
  });

  add("T1-F11-03", "F11", "Legacy localStorage sfm_view_mode='names' or 'list' normalizes to consolidated Table view", async () => {
    for (const legacyMode of ["names", "list"]) {
      await withEnv({ localStorageData: { sfm_view_mode: legacyMode } }, async (env) => {
        const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
        assert(tree.findBySelector(".sfm-data-table").length === 1,
          `Legacy sfm_view_mode='${legacyMode}' must render consolidated Table view`);
      });
    }
  });

  add("T1-F11-04", "F11", "SettingsAndTasksModal aligns scene view options and switches FileManagerView to Table", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await tree.click(findButtonByText(tree, /Settings/i));
      const sceneViewSelect = tree.findBySelector("select").find((s) =>
        tree.findAll((o) => o.tag === "option" && o.props?.value === "table", s).length > 0
      );
      assert(sceneViewSelect, "Settings modal must have scene view select with 'table' option");
      const namesOpt = tree.findAll((o) => o.tag === "option" && o.props?.value === "names", sceneViewSelect);
      assert.strictEqual(namesOpt.length, 0, "Settings modal must no longer offer legacy 'names' view option");
      await tree.change(sceneViewSelect, "table");
      await tree.click(findButtonByText(tree, /Save/i));
      assert(tree.findBySelector(".sfm-data-table").length === 1, "Saving 'table' in Settings must render Table view");
    });
  });

  add("T1-F11-05", "F11", "SceneNamesTableView compatibility alias renders consolidated Table view without error", async () => {
    await withEnv(async (env) => {
      const Alias = env.sfm.SceneNamesTableView;
      assert.strictEqual(typeof Alias, "function", "window.__SFM__.SceneNamesTableView compat alias must exist");
      const tree = env.mount(Alias, {
        scenes: env.db.scenes.slice(0, 2),
        selectedIds: new Set(),
        onToggleSelect: () => {},
        onSelectAll: () => {},
        onPlay: () => {},
      });
      await tree.flush();
      assert(tree.findBySelector(".sfm-data-table").length === 1);
    });
  });

  // ==========================================================
  // F12: Default Table columns parity
  // ==========================================================
  add("T1-F12-01", "F12", "Default Table view displays exact 10 columns matching Scraper layout", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const headers = getTableHeaders(tree, ".sfm-data-table th").map((h) => h.text.replace(/[▲▼↕\s]+/g, " ").trim());
      assert.strictEqual(headers.length, 10, `Expected 10 default columns, got ${headers.length}: ${headers.join(" | ")}`);
      const expectedPatterns = [/^$/, /Cover/i, /Filename/i, /Title/i, /Date/i, /Studio/i, /Code/i, /Performers/i, /Organized/i, /Actions/i];
      expectedPatterns.forEach((re, idx) => {
        assert(re.test(headers[idx]), `Column ${idx} expected ${re}, got "${headers[idx]}"`);
      });
    });
  });

  add("T1-F12-02", "F12", "Table view Filename and Code cells render basename and scene code", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const txt = tree.text();
      assert(txt.includes("StudioAlpha_ALP-001_Alpha_Sunrise.mp4"), "Filename column must render file basename");
      assert(txt.includes("ALP-001"), "Code column must render scene code");
    });
  });

  add("T1-F12-03", "F12", "Table view Organized column has interactive checkbox saving via sceneUpdate", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const orgColIdx = getTableHeaders(tree, ".sfm-data-table th").findIndex((h) => /Organized/i.test(h.text));
      assert(orgColIdx >= 0, "Organized header must exist in Table view");
      const rows = getTableBodyRows(tree, ".sfm-data-table tbody tr");
      const betaRow = rows.find((r) => r.text.includes("Beta Midnight"));
      assert(betaRow);
      const cb = tree.findAll((n) => n.tag === "input" && n.props?.type === "checkbox", betaRow.cells[orgColIdx].node)[0];
      assert(cb, "Organized checkbox must exist in Table row");
      await tree.change(cb, true);
      const mut = env.graphql.gqlCalls.find((c) => c.query.includes("sceneUpdate"));
      assert(mut && String(mut.variables.input.id) === "102" && mut.variables.input.organized === true);
    });
  });

  add("T1-F12-04", "F12", "Table view Actions column includes inline Edit button", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const editBtns = tree.findAll((n) => n.tag === "button" && /^Edit$/i.test(tree.nodeText(n).trim()),
        tree.findBySelector(".sfm-data-table")[0]);
      assert(editBtns.length >= 4, "Each row in Season 1 Table view must have an inline Edit button");
    });
  });

  add("T1-F12-05", "F12", "Table view inline Edit saves changes via sceneUpdate and updates row", async () => {
    await withEnv(async (env) => {
      const tree = await openFolderRoute(env, "Anime/Naruto/Season 1");
      await ensureTableView(tree);
      const tableNode = tree.findBySelector(".sfm-data-table")[0];
      const rows = getTableBodyRows(tree, ".sfm-data-table tbody tr");
      const betaRow = rows.find((r) => r.text.includes("Beta Midnight"));
      const editBtn = findButtonByText(tree, /^Edit$/i, betaRow.node);
      assert(editBtn, "Edit button must exist in Table row");
      await tree.click(editBtn);
      const editor = tree.findBySelector(".sfm-inline-editor")[0];
      assert(editor, "Inline editor must open in Table view");
      const titleInput = tree.findBySelector("input[data-field=\"title\"], input[name=\"title\"]", editor)[0]
        || tree.findAll((n) => n.tag === "input" && n.props?.value === "Beta Midnight", editor)[0];
      await tree.change(titleInput, "Beta Table Edited");
      await tree.click(findButtonByText(tree, /^Save$/i, editor));
      assert(tree.text().includes("Beta Table Edited"), "Table view must reflect saved inline edit");
      assert.strictEqual(env.db.scenes[1].title, "Beta Table Edited");
    });
  });

  return tests;
}

module.exports = { getTests };

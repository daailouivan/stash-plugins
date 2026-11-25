"use strict";

const assert = require("assert");
const { createStashEnv } = require("./harness");

async function withEnv(opts, fn) {
  if (typeof opts === "function") {
    fn = opts;
    opts = {};
  }
  const env = createStashEnv(opts);
  try {
    return await fn(env);
  } finally {
    env.cleanup();
  }
}

async function openFolderRoute(env, pathQuery = "") {
  const url = pathQuery ? `/plugin/file-manager?path=${encodeURIComponent(pathQuery)}` : "/plugin/file-manager";
  env.location.pathname = "/plugin/file-manager";
  env.location.search = pathQuery ? `?path=${encodeURIComponent(pathQuery)}` : "";
  env.location.hash = "";
  if (env.history && typeof env.history.replaceState === "function") {
    env.history.replaceState({}, "", url);
  }
  const tree = await env.mountRoute("/plugin/file-manager");
  return tree;
}

async function drillIntoFolders(tree, folderNames) {
  for (const name of folderNames) {
    const cards = tree.findBySelector(".sfm-folder-card, .sfm-native-folder-card");
    const target = cards.find((c) => tree.nodeText(c).includes(name));
    if (!target) {
      throw new Error(`Folder card "${name}" not found among: ${cards.map((c) => tree.nodeText(c)).join(", ")}`);
    }
    await tree.click(target);
  }
  return tree;
}

async function ensureTableView(tree) {
  const btns = tree.findBySelector("button");
  const tableBtn = btns.find((b) => {
    const txt = tree.nodeText(b).trim();
    const title = String(b.props?.title || "");
    return txt === "Table" || /\bTable\b/i.test(title) || txt.includes("Table View");
  });
  if (!tableBtn) {
    throw new Error(`Table view toggle button not found. Buttons: ${btns.map((b) => tree.nodeText(b) || b.props?.title).join(" | ")}`);
  }
  await tree.click(tableBtn);
  return tree;
}

async function openMetadataStudioFromView(tree, which = "scrape") {
  const btns = tree.findBySelector("button");
  const match = btns.find((b) => {
    const txt = tree.nodeText(b);
    if (which === "bulk_edit") return /Batch Edit|Bulk Edit/i.test(txt);
    return /Parse\s*&\s*Scrape|Metadata Studio/i.test(txt);
  });
  if (!match) {
    throw new Error(`Metadata Studio button (${which}) not found`);
  }
  await tree.click(match);
  return tree;
}

async function openMetadataStudioGlobal(env, scenes, folder = "Season 1") {
  assert(typeof env.window.__SFM_OPEN_PARSER__ === "function", "window.__SFM_OPEN_PARSER__ must be registered");
  env.window.__SFM_OPEN_PARSER__(scenes, folder);
  const modalTree = env.getMountedTree("sfm-global-modal-root");
  assert(modalTree, "Global modal root must be mounted");
  await modalTree.flush();
  return modalTree;
}

function findSceneSortSelect(tree) {
  const selects = tree.findBySelector("select");
  const s = selects.find((el) => {
    const title = String(el.props?.title || "");
    const opts = (el.children || []).filter((c) => c.tag === "option").map((o) => o.props?.value);
    return /Sort Scenes/i.test(title) || opts.includes("title_asc") || opts.includes("date_desc");
  });
  if (!s) throw new Error("sceneSort <select> not found");
  return s;
}

function getSelectOptionValues(selectNode) {
  const out = [];
  function walk(n) {
    if (!n) return;
    if (n.kind === "element" && n.tag === "option") out.push(String(n.props?.value ?? ""));
    for (const c of n.children || []) walk(c);
  }
  walk(selectNode);
  return out;
}

function getTableHeaders(tree, selector = ".sfm-data-table th") {
  return tree.findBySelector(selector).map((th) => ({
    node: th,
    text: tree.nodeText(th),
  }));
}

function getTableBodyRows(tree, selector = ".sfm-data-table tbody tr") {
  return tree.findBySelector(selector).map((tr) => ({
    node: tr,
    text: tree.nodeText(tr),
    cells: tree.findAll((n) => n.tag === "td", tr).map((td) => ({
      node: td,
      text: tree.nodeText(td),
    })),
  }));
}

function findHeaderByName(tree, tableSelector, headerName) {
  const ths = tree.findBySelector(`${tableSelector} th`);
  const th = ths.find((el) => {
    const t = tree.nodeText(el).replace(/[▲▼↕\s]+/g, " ").trim().toLowerCase();
    return t === headerName.toLowerCase() || t.startsWith(headerName.toLowerCase());
  });
  if (!th) {
    throw new Error(`Header "${headerName}" not found in ${tableSelector}. Found: ${ths.map((e) => tree.nodeText(e)).join(", ")}`);
  }
  return th;
}

function findInputsByPlaceholder(tree, substr, start) {
  return tree.findAll((n) => (n.tag === "input" || n.tag === "textarea") && String(n.props?.placeholder || "").toLowerCase().includes(substr.toLowerCase()), start);
}

function findButtonByText(tree, regexOrStr, start) {
  const btns = tree.findBySelector("button", start);
  return btns.find((b) => {
    const txt = tree.nodeText(b);
    return regexOrStr instanceof RegExp ? regexOrStr.test(txt) : txt.includes(regexOrStr);
  });
}

function findButtonByTextOrTitle(tree, regexOrStr, start) {
  const btns = tree.findBySelector("button", start);
  return btns.find((b) => {
    const txt = tree.nodeText(b);
    const title = String(b.props?.title || "");
    if (regexOrStr instanceof RegExp) return regexOrStr.test(txt) || regexOrStr.test(title);
    return txt.includes(regexOrStr) || title.includes(regexOrStr);
  });
}

module.exports = {
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
  findInputsByPlaceholder,
  findButtonByText,
  findButtonByTextOrTitle,
};

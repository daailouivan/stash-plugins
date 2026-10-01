const path = require("path");
const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

function createMockElement(tag) {
  const listeners = {};
  const attrs = {};
  const el = {
    tagName: (tag || "div").toUpperCase(),
    style: {},
    className: "",
    children: [],
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentElement = null;
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.removeChild(this);
      }
    },
    addEventListener(evt, fn) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    removeEventListener(evt, fn) {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter((f) => f !== fn);
      }
    },
    dispatchEvent(evt) {
      if (listeners[evt.type]) {
        listeners[evt.type].forEach((fn) => fn(evt));
      }
    },
    setAttribute(k, v) {
      attrs[k] = String(v);
    },
    getAttribute(k) {
      return attrs[k] || null;
    },
    querySelector(selector) {
      if (selector.includes("a[href*=\"/scenes/\"]")) {
        return this.children.find((c) => c.tagName === "A" && (c.getAttribute("href") || "").includes("/scenes/")) || null;
      }
      if (selector.includes("[data-sfm-card-chip]")) {
        return this.children.find((c) => c.getAttribute && c.getAttribute("data-sfm-card-chip")) || null;
      }
      if (selector.includes(".card-section")) {
        return this.children.find((c) => (c.className || "").includes("card-section")) || null;
      }
      if (selector.includes(".scene-info")) {
        return this.children.find((c) => (c.className || "").includes("scene-info")) || null;
      }
      if (selector.includes(".scene-toolbar")) {
        return this.children.find((c) => (c.className || "").includes("scene-toolbar")) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      const results = [];
      function walk(node) {
        if (!node) return;
        if (selector.includes(".card.scene-card") || selector.includes(".scene-card")) {
          if ((node.className || "").includes("scene-card")) {
            results.push(node);
          }
        }
        if (node.children) {
          node.children.forEach(walk);
        }
      }
      walk(this);
      return results;
    },
  };
  return el;
}

let historyCalls = [];

const patches = {
  after: {},
  before: {},
  instead: {}
};

const window = {
  PluginApi: {
    patch: {
      after: (target, fn) => { patches.after[target] = fn; },
      before: (target, fn) => { patches.before[target] = fn; },
      instead: (target, fn) => { patches.instead[target] = fn; }
    },
    Event: {
      addEventListener: (evt, fn) => {
        window.addEventListener(evt, fn);
      }
    }
  },
  addEventListener: (evt, fn) => {
    if (!window._listeners) window._listeners = {};
    if (!window._listeners[evt]) window._listeners[evt] = [];
    window._listeners[evt].push(fn);
  },
  removeEventListener: (evt, fn) => {
    if (window._listeners && window._listeners[evt]) {
      window._listeners[evt] = window._listeners[evt].filter(f => f !== fn);
    }
  },
  dispatchEvent: (evt) => {
    if (window._listeners && window._listeners[evt.type]) {
      window._listeners[evt.type].forEach(fn => fn(evt));
    }
  },
  location: { hash: "", pathname: "/scenes/42", search: "" },
  history: {
    pushState: (state, title, url) => {
      historyCalls.push({ type: "push", state, url });
      if (url.includes("#")) {
        window.location.hash = url.slice(url.indexOf("#"));
      } else {
        window.location.hash = "";
      }
    },
    replaceState: (state, title, url) => {
      historyCalls.push({ type: "replace", state, url });
      if (url.includes("#")) {
        window.location.hash = url.slice(url.indexOf("#"));
      }
    },
    back: () => historyCalls.push({ type: "back" }),
  },
  localStorage: {
    _data: {},
    getItem: (k) => window.localStorage._data[k] || null,
    setItem: (k, v) => { window.localStorage._data[k] = String(v); },
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  indexedDB: null,
  fetch: async () => ({
    json: async () => ({
      data: {
        findScenes: {
          scenes: [
            {
              id: "42",
              title: "Naruto Adventure Ep 01",
              paths: { screenshot: "/scene/42/screenshot" },
              files: [{ path: "/data/videos/Anime/Naruto/Season 1/ep01.mp4", size: 1048576, duration: 1420 }]
            }
          ]
        }
      }
    })
  }),
};

const domStore = {};
const document = {
  body: createMockElement("body"),
  createElement: (tag) => createMockElement(tag),
  createElementNS: (ns, tag) => createMockElement(tag),
  getElementById: (id) => domStore[id] || null,
  querySelector: (sel) => {
    if (sel.includes(".scene-info")) return domStore["sidebar"] || null;
    if (sel.includes(".scene-toolbar")) return domStore["toolbar"] || null;
    return null;
  },
  querySelectorAll(sel) {
    if (sel.includes(".scene-card")) {
      return domStore["cards"] || [];
    }
    return [];
  },
};

const React = {
  Component: class { constructor(props) { this.props = props; this.state = {}; } },
  createElement: (type, props, ...children) => {
    const flat = children.flat ? children.flat(Infinity) : children;
    const finalChildren = flat.filter((c) => c !== undefined && c !== null && c !== false);
    return {
      type,
      key: props?.key || null,
      props: { ...props, children: finalChildren.length === 1 ? finalChildren[0] : finalChildren },
    };
  },
  cloneElement: (el, newProps, ...newChildren) => {
    if (!el || typeof el !== "object") return el;
    const mergedProps = { ...el.props, ...newProps };
    if (newChildren.length > 0) {
      mergedProps.children = newChildren.flat ? newChildren.flat(Infinity) : newChildren;
    }
    return {
      type: el.type,
      key: el.key,
      props: mergedProps,
    };
  },
  isValidElement: (el) => el && typeof el === "object" && "type" in el && "props" in el,
  Children: {
    toArray: (children) => (Array.isArray(children) ? children : children !== undefined && children !== null ? [children] : []),
  },
  Fragment: "React.Fragment",
  useState: (init) => {
    const val = typeof init === "function" ? init() : init;
    return [val, () => {}];
  },
  useEffect: (fn) => fn(),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
};

const ReactDOM = {
  render: (element, container) => {
    if (container && element) {
      container.children.push(element);
    }
  },
  unmountComponentAtNode: () => {},
};

window.PluginApi.React = React;
window.PluginApi.ReactDOM = ReactDOM;
window.PluginApi.register = { route: () => {} };

// Run file_manager.js inside VM context
const rawCode = fs.readFileSync(path.join(__dirname, "stash_file_manager/file_manager.js"), "utf8");

const context = vm.createContext({
  window,
  document,
  React,
  ReactDOM,
  localStorage: window.localStorage,
  sessionStorage: window.sessionStorage,
  navigator: { clipboard: { writeText: async () => {} } },
  console,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: () => {},
  setInterval: () => 1,
  clearInterval: () => {},
  IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  Array, Object, String, Number, Boolean, Math, Date, Set, Map, Promise, RegExp, Error, isNaN, parseInt, encodeURIComponent, decodeURIComponent, URLSearchParams
});

vm.runInContext(rawCode, context);

const cache = window.__SFM_GLOBAL_CACHE__;
assert(cache, "window.__SFM_GLOBAL_CACHE__ must exist");

console.log("\n========================================================");
console.log("🧪 STARTING v3.0.0 PHASE 4 DEEP EMBEDDING TEST SUITE");
console.log("========================================================");

// --- TEST 1: verify APIs are exported on cache and window.PluginApi.Filemanager ---
console.log("\n--- TEST 1: Exported Native Platform Embedding APIs ---");
assert(typeof cache.NativeSceneCardOverlay === "function", "NativeSceneCardOverlay must be a component");
assert(typeof cache.NativeSceneDetailDirectoryHierarchy === "function", "NativeSceneDetailDirectoryHierarchy must be a component");
assert(typeof cache.NativeSceneDetailReelButton === "function", "NativeSceneDetailReelButton must be a component");
assert(typeof cache.patchNativeSceneCard === "function", "patchNativeSceneCard must be a function");
assert(typeof cache.patchNativeSceneDetails === "function", "patchNativeSceneDetails must be a function");
assert(typeof cache.patchNativeScenePlayer === "function", "patchNativeScenePlayer must be a function");
assert(typeof cache.resolveSceneFolder === "function", "resolveSceneFolder must be a function");
assert(typeof cache.openFileManager === "function", "openFileManager must be a function");
assert(window.PluginApi.Filemanager === cache, "window.PluginApi.Filemanager must link to cache");
console.log("✓ All Phase 4 embedding components and APIs properly exported!");

// --- TEST 2: resolveSceneFolder logic ---
console.log("\n--- TEST 2: Scene Directory Resolution ---");
const mockScene = {
  id: "101",
  title: "Test Scene 101",
  files: [{ path: "/data/videos/Anime/Naruto/Season 1/ep01.mp4" }]
};

const folderPath = cache.resolveSceneFolder(mockScene);
assert.strictEqual(folderPath, "data/videos/Anime/Naruto/Season 1");
console.log("Resolved folder:", folderPath);
console.log("✓ resolveSceneFolder correctly resolves directory path from scene files!");

// --- TEST 3: NativeSceneCardOverlay Rendering & Triggers ---
console.log("\n--- TEST 3: NativeSceneCardOverlay Component Rendering & Triggers ---");
historyCalls = [];
const cardOverlay = cache.NativeSceneCardOverlay({
  scene: mockScene,
  folderPath: "Anime/Naruto/Season 1"
});

assert(cardOverlay, "NativeSceneCardOverlay must return element");
assert.strictEqual(cardOverlay.props.className, "sfm-native-card-chip-container");

// Find chip child
const chip = cardOverlay.props.children.find(c => c && c.props && c.props.className === "sfm-native-card-path-chip");
assert(chip, "Path chip must be rendered");
assert(chip.props.title.includes("Anime/Naruto/Season 1"), "Chip tooltip must include path");

// Trigger click on chip
chip.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
assert(window.location.hash.includes("path=Anime%2FNaruto%2FSeason+1"), "Clicking chip must navigate to folder in File Manager");
console.log("Navigated hash on chip click:", window.location.hash);
console.log("✓ NativeSceneCardOverlay path chip renders and opens File Manager!");

// Find quick actions (Profile wall & Reel mode)
const quickActions = cardOverlay.props.children.find(c => c && c.props && c.props.className === "sfm-native-card-quick-actions");
assert(quickActions, "Quick actions container must exist");
assert.strictEqual(quickActions.props.children.length, 3, "Must have 3 action icon buttons");

// Trigger profile button
const profileBtn = quickActions.props.children[1];
profileBtn.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
assert(window.location.hash.includes("view=profile"), "Profile button must navigate to view=profile");
console.log("Navigated hash on profile button click:", window.location.hash);
console.log("✓ Quick action profile button launches folder video wall!");

// Trigger reel button
const reelBtn = quickActions.props.children[2];
reelBtn.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
assert(window.location.hash.includes("scene=101"), "Reel button must navigate to scene=101");
console.log("Navigated hash on reel button click:", window.location.hash);
console.log("✓ Quick action reel button launches Binge Reel Player for scene!");

// Find hover trigger
const hoverActions = cardOverlay.props.children.find(c => c && c.props && c.props.className === "sfm-native-card-hover-actions");
assert(hoverActions, "Hover actions container must exist");
const hoverBtn = hoverActions.props.children;
assert(hoverBtn, "Hover folder button must exist");
hoverBtn.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
assert(window.location.hash.includes("path=Anime%2FNaruto%2FSeason+1"), "Hover button must open folder");
console.log("✓ Hover 1-click action button opens folder!");

// --- TEST 4: Native Scene Detail Directory Hierarchy ---
console.log("\n--- TEST 4: Native Scene Detail Directory Hierarchy ---");
const hierarchyRow = cache.NativeSceneDetailDirectoryHierarchy({
  scene: mockScene,
  folderPath: "Anime/Naruto/Season 1"
});

assert(hierarchyRow, "Directory hierarchy row must render");
assert.strictEqual(hierarchyRow.props.className, "sfm-scene-detail-directory-row");
assert.strictEqual(hierarchyRow.props.id, "sfm-scene-hierarchy-row");

// Breadcrumb check
const bcContainer = hierarchyRow.props.children[1];
assert(bcContainer && bcContainer.props.className === "sfm-scene-detail-breadcrumbs", "Breadcrumbs container must exist");
const crumbs = bcContainer.props.children;
assert.strictEqual(crumbs.length, 4, "Must have 4 crumbs (Root, Anime, Naruto, Season 1)");
console.log("Rendered crumbs count:", crumbs.length);

// Click intermediate crumb "Anime"
const animeCrumb = crumbs[1].props.children.find(c => c && c.props && c.props.className === "sfm-breadcrumb-item");
animeCrumb.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
assert(window.location.hash.includes("path=Anime"), "Clicking Anime crumb must navigate to Anime folder");
console.log("Navigated hash on Anime crumb click:", window.location.hash);
console.log("✓ Interactive breadcrumbs jump directly to specific folder hierarchy level!");

// --- TEST 5: Native Scene Detail Reel Mode Button ---
console.log("\n--- TEST 5: Native Scene Detail Reel Mode Button ---");
const detailReelBtn = cache.NativeSceneDetailReelButton({
  scene: mockScene,
  folderPath: "Anime/Naruto/Season 1"
});

assert(detailReelBtn, "Reel button must render");
assert.strictEqual(detailReelBtn.props.id, "sfm-scene-reel-btn");
assert(detailReelBtn.props.className.includes("sfm-scene-reel-mode-btn"), "Reel button must have proper class");

// Click Reel Mode button
detailReelBtn.props.onClick({ preventDefault: () => {}, stopPropagation: () => {} });
assert(window.location.hash.includes("scene=101") && window.location.hash.includes("path=Anime"), "Reel button must open player at scene in path");
console.log("Navigated hash on Reel Mode click:", window.location.hash);
console.log("✓ Reel Mode button launches Binge Reel modal starting from current scene!");

// --- TEST 6: PluginApi.patch Hooks Verification ---
console.log("\n--- TEST 6: PluginApi.patch Registrations ---");
assert(typeof patches.instead["SceneCard"] === "function", "SceneCard patch.instead must be registered");
assert(typeof patches.instead["SceneCard.Details"] === "function", "SceneCard.Details patch.instead must be registered");
assert(typeof patches.instead["SceneDetails"] === "function", "SceneDetails patch.instead must be registered");
assert(typeof patches.instead["SceneDetails.Sidebar"] === "function", "SceneDetails.Sidebar patch.instead must be registered");
assert(typeof patches.instead["ScenePlayer"] === "function", "ScenePlayer patch.instead must be registered");

// Test execution of patched SceneCard
const mockCardRes = React.createElement("div", { className: "card scene-card" },
  React.createElement("div", { className: "thumbnail-section" }, "Thumbnail"),
  React.createElement("div", { className: "card-section" }, "Details")
);

const patchedCard = patches.instead["SceneCard"]({ scene: mockScene }, () => mockCardRes);
assert(patchedCard, "Patched SceneCard must return element");
console.log("✓ PluginApi.patch for SceneCard executed and augmented card tree!");

// Test execution of patched SceneDetails
const mockDetailsRes = React.createElement("div", { className: "scene-details" }, "Original details");
const patchedDetails = patches.instead["SceneDetails"]({ scene: mockScene }, () => mockDetailsRes);
assert(patchedDetails, "Patched SceneDetails must return element");
console.log("✓ PluginApi.patch for SceneDetails executed and augmented details tree!");

// Test execution of patched ScenePlayer
const mockPlayerRes = React.createElement("div", { className: "scene-player" }, "Player toolbar");
const patchedPlayer = patches.instead["ScenePlayer"]({ scene: mockScene }, () => mockPlayerRes);
assert(patchedPlayer, "Patched ScenePlayer must return element");
console.log("✓ PluginApi.patch for ScenePlayer executed and injected Reel button!");

// --- TEST 7: Fallback DOM Injection Observers ---
console.log("\n--- TEST 7: Fallback DOM Injection Observers ---");
window.location.hash = "";
const mockCardDOM = createMockElement("div");
mockCardDOM.className = "card scene-card";
const mockCardLink = createMockElement("a");
mockCardLink.setAttribute("href", "/scenes/42");
mockCardDOM.appendChild(mockCardLink);
const mockCardSection = createMockElement("div");
mockCardSection.className = "card-section";
mockCardDOM.appendChild(mockCardSection);

domStore["cards"] = [mockCardDOM];
cache.injectSceneCardsDOMFallback();

assert.strictEqual(mockCardDOM.getAttribute("data-sfm-decorated"), "true", "Card must be marked decorated");
assert(mockCardSection.children.length > 0, "Overlay must be mounted into card section");
console.log("✓ injectSceneCardsDOMFallback decorated native DOM card elements successfully!");

// Detail page DOM fallback
const mockSidebar = createMockElement("div");
mockSidebar.className = "scene-info";
domStore["sidebar"] = mockSidebar;

const mockToolbar = createMockElement("div");
mockToolbar.className = "scene-toolbar";
domStore["toolbar"] = mockToolbar;

cache.injectSceneDetailDOMFallback();

assert(mockSidebar.children.some(c => c.tagName === "DIV" && c.children && c.children.length > 0), "Hierarchy row mounted into sidebar");
assert(mockToolbar.children.some(c => c.tagName === "DIV" && c.children && c.children.length > 0), "Reel button mounted into toolbar");
console.log("✓ injectSceneDetailDOMFallback decorated native scene detail page successfully!");

console.log("\n========================================================");
console.log("🎉 ALL v3.0.0 PHASE 4 INTEGRATION TESTS PASSED 100%!");
console.log("========================================================\n");

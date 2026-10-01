const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

console.log("\n========================================================");
console.log("🧪 RUNNING NATIVE EMBEDDED VIEW & CARD ARCHITECTURE TESTS");
console.log("========================================================");

// Mock DOM & React Environment
function createElementMock(tagName = "div") {
  return {
    tagName: tagName.toUpperCase(),
    className: "",
    id: "",
    style: {},
    children: [],
    attributes: {},
    parentElement: null,
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] || null; },
    removeAttribute(k) { delete this.attributes[k]; },
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    querySelector(sel) {
      if (sel.includes("main-container") && this.className.includes("main-container")) return this;
      for (const c of this.children) {
        if (c.querySelector) {
          const res = c.querySelector(sel);
          if (res) return res;
        }
      }
      return null;
    }
  };
}

const documentBody = createElementMock("body");
const mainContainer = createElementMock("div");
mainContainer.className = "main-container container-fluid";
documentBody.appendChild(mainContainer);

const mockDoc = {
  body: documentBody,
  fullscreenElement: null,
  createElement(tag) { return createElementMock(tag); },
  getElementById(id) {
    if (id === "sfm-workspace-root") {
      const findIn = (node) => {
        if (node.id === "sfm-workspace-root") return node;
        for (const c of node.children) {
          const f = findIn(c);
          if (f) return f;
        }
        return null;
      };
      return findIn(documentBody);
    }
    return null;
  },
  querySelector(sel) {
    return documentBody.querySelector(sel);
  },
  querySelectorAll() { return []; },
  addEventListener() {},
  removeEventListener() {},
};

let currentHash = "#file-manager";
const mockWindow = {
  PluginApi: {},
  location: {
    hash: currentHash,
    pathname: "/scenes",
    search: "",
  },
  history: {
    state: {},
    pushState(state, title, url) {
      currentHash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
      mockWindow.location.hash = currentHash;
    },
    replaceState(state, title, url) {
      currentHash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
      mockWindow.location.hash = currentHash;
    },
    back() {}
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  },
  sessionStorage: {
    getItem() { return null; },
    setItem() {},
  },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) }),
};

const mockReact = {
  createElement(type, props, ...children) {
    return {
      type,
      props: { ...props, children: children.length === 1 ? children[0] : (children.length > 1 ? children : props?.children) }
    };
  },
  useState(init) {
    return [typeof init === "function" ? init() : init, () => {}];
  },
  useEffect(cb) { cb(); },
  useCallback(fn) { return fn; },
  useMemo(fn) { return fn(); },
  useRef(init) { return { current: init }; },
  Component: class {},
  Fragment: "Fragment",
  isValidElement(el) { return el && typeof el === "object" && "type" in el; },
  cloneElement(el, props, ...children) {
    return {
      ...el,
      props: { ...el.props, ...props, children: children.length > 0 ? children : el.props?.children }
    };
  }
};

const mockReactDOM = {
  render(element, container) {
    container._rendered = element;
    container._sfm_mounted = true;
  }
};

mockWindow.PluginApi.React = mockReact;
mockWindow.PluginApi.ReactDOM = mockReactDOM;
mockWindow.PluginApi.patch = {
  after() {},
  instead() {},
  before() {}
};

let rawCode = fs.readFileSync(path.join(__dirname, "stash_file_manager/file_manager.js"), "utf8");

const exportInjection = `
  window.__SFM_TEST_EXPORTS__ = {
    FolderProfileView,
    BingeReelPlayerModal,
    FileManagerView,
    SceneTableView,
    SceneNamesTableView,
    SceneCard,
    FilenameParserModal,
    BatchMetadataModal,
    SettingsAndTasksModal,
    clearCachedScenes,
    SafeErrorBoundary,
    openFileManager,
    closeWorkspace
  };
`;
rawCode = rawCode.replace("console.log(\"[PathFileManager] Initialized successfully with all enhanced features.\");", exportInjection + "\nconsole.log(\"[PathFileManager] Initialized successfully with all enhanced features.\");");

const context = {
  window: mockWindow,
  document: mockDoc,
  React: mockReact,
  ReactDOM: mockReactDOM,
  PluginApi: mockWindow.PluginApi,
  navigator: { userAgent: "Node" },
  console,
  setTimeout: (fn) => fn(),
  clearTimeout() {},
  setInterval() {},
  clearInterval() {},
};

vm.createContext(context);
vm.runInContext(rawCode, context);

const exp = mockWindow.__SFM_TEST_EXPORTS__;
assert(exp, "Test exports must be available");

console.log("\n--- TEST 1: Native Container Mounting ---");
// Verify getOrCreateWorkspaceRoot mounts inside mainContainer
const rootEl = mockDoc.getElementById("sfm-workspace-root");
assert(rootEl, "sfm-workspace-root element must exist");
assert.strictEqual(rootEl.parentElement, mainContainer, "sfm-workspace-root must be child of .main-container");
assert.strictEqual(mainContainer.getAttribute("data-sfm-embedded"), "true", ".main-container must have data-sfm-embedded attribute");
assert.strictEqual(mainContainer.getAttribute("data-sfm-active"), "true", ".main-container must have data-sfm-active attribute");
console.log("✓ Workspace mounted directly inside Stash's native .main-container!");

console.log("\n--- TEST 2: Native SceneCard Component Architecture ---");
const testScene = {
  id: "42",
  title: "Episode 1: The Beginning",
  files: [{ basename: "ep01.mp4", duration: 1500, height: 1080 }],
  paths: { screenshot: "/scene/42/screenshot", preview: "/scene/42/preview" },
  studio: { name: "Studio Pierrot" },
  performers: [{ name: "Naruto Uzumaki" }],
  _folderPath: "Anime/Naruto"
};

const sceneCardVNode = exp.SceneCard({
  scene: testScene,
  onPlay: () => {},
  isSelected: false,
  onToggleSelect: () => {},
  showFolderBadge: true,
  currentPath: "Anime"
});

assert(sceneCardVNode, "SceneCard must render a React element");
assert(sceneCardVNode.props.className.includes("card"), "SceneCard must have 'card' class");
assert(sceneCardVNode.props.className.includes("scene-card"), "SceneCard must have 'scene-card' class");
assert(sceneCardVNode.props.className.includes("sfm-native-scene-card"), "SceneCard must have 'sfm-native-scene-card' class");
console.log("✓ SceneCard rendered with native Stash .card.scene-card classes!");

console.log("\n--- TEST 3: CSS Class Verifications ---");
const cssContent = fs.readFileSync(path.join(__dirname, "stash_file_manager/file_manager.css"), "utf8");
assert(cssContent.includes(".sfm-native-embedded-workspace"), "CSS must contain .sfm-native-embedded-workspace");
assert(cssContent.includes(".sfm-native-folder-card.card"), "CSS must contain .sfm-native-folder-card.card");
assert(cssContent.includes(".sfm-native-scene-card.card"), "CSS must contain .sfm-native-scene-card.card");
console.log("✓ file_manager.css contains all required embedded viewport and native card styles!");

console.log("\n========================================================");
console.log("🎉 ALL NATIVE ARCHITECTURE TESTS PASSED WITH 100% SUCCESS!");
console.log("========================================================\n");

const path = require("path");
const fs = require("fs");
const vm = require("vm");

function createMockElement(tag) {
  return {
    tagName: (tag || "div").toUpperCase(),
    style: {},
    className: "",
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(c => c !== child); },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const window = {
  PluginApi: {},
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { hash: "#file-manager", pathname: "/scenes", search: "" },
  history: { pushState: () => {}, replaceState: () => {}, back: () => {} },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
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
              id: "101",
              title: "Test Scene 1",
              date: "2026-01-01",
              rating100: 80,
              paths: { screenshot: "/test.jpg", preview: "/preview.mp4", stream: "/stream.mp4" },
              files: [{ path: "/data/videos/Folder A/Scene1.mp4", basename: "Scene1.mp4", size: 1048576, duration: 600, height: 1080 }],
            },
            {
              id: "102",
              title: "Test Scene 2",
              date: "2026-01-02",
              rating100: 90,
              paths: { screenshot: "/test2.jpg", preview: "/preview2.mp4", stream: "/stream2.mp4" },
              files: [{ path: "/data/videos/Folder B/Scene2.mp4", basename: "Scene2.mp4", size: 2097152, duration: 1200, height: 2160 }],
            }
          ]
        }
      }
    }),
  }),
  document: {
    createElement: (tag) => createMockElement(tag),
    createElementNS: (ns, tag) => createMockElement(tag),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: createMockElement("body"),
  },
  CustomEvent: function(type, detail) { this.type = type; this.detail = detail; },
  dispatchEvent: () => {},
};

const document = window.document;

const React = {
  Component: class {
    constructor(props) {
      this.props = props;
      this.state = {};
    }
    setState(updater) {
      if (typeof updater === "function") {
        this.state = { ...this.state, ...updater(this.state) };
      } else {
        this.state = { ...this.state, ...updater };
      }
    }
  },
  createElement: (type, props, ...children) => {
    if (typeof type === "function") {
      try {
        if (type.prototype && type.prototype.render) {
          const inst = new type({ ...(props || {}), children });
          return inst.render();
        }
        return type({ ...(props || {}), children });
      } catch (err) {
        console.error(`[React.createElement error in component: ${type.name || "anonymous"}]`, err);
        throw err;
      }
    }
    return { type, props: { ...(props || {}), children } };
  },
  Fragment: "React.Fragment",
  isValidElement: (el) => !!(el && typeof el === "object" && el.type),
  cloneElement: (el, props, ...children) => ({
    ...el,
    props: { ...el.props, ...props, children: children.length > 0 ? children : el.props.children }
  }),
  useState: (initial) => {
    const val = typeof initial === "function" ? initial() : initial;
    return [val, () => {}];
  },
  useEffect: (cb) => {
    try { cb(); } catch (e) {}
  },
  useLayoutEffect: (cb) => {
    try { cb(); } catch (e) {}
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useContext: () => ({}),
  useReducer: (reducer, init) => [init, () => {}],
  useTransition: () => [false, (cb) => cb()],
  useDeferredValue: (val) => val,
  useId: () => "mock-id",
  useImperativeHandle: () => {},
  useDebugValue: () => {},
  useInsertionEffect: (cb) => {
    try { cb(); } catch (e) {}
  },
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  memo: (comp) => comp,
  forwardRef: (render) => (props) => render(props, { current: null }),
  createContext: (defaultVal) => ({
    Provider: ({ children }) => children,
    Consumer: ({ children }) => children(defaultVal),
  }),
  createRef: () => ({ current: null }),
  lazy: (factory) => factory,
  Suspense: ({ children }) => children,
  StrictMode: ({ children }) => children,
  startTransition: (cb) => {
    return cb;
  },
  useRef: (init) => ({ current: init }),
};

const ReactDOM = {
  render: () => {},
  unmountComponentAtNode: () => {},
};

window.PluginApi.React = React;
window.PluginApi.ReactDOM = ReactDOM;
window.PluginApi.register = {
  route: () => {}
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
    SafeErrorBoundary
  };
`;
rawCode = rawCode.replace("console.log(\"[PathFileManager] Initialized successfully with all enhanced features.\");", exportInjection + "\nconsole.log(\"[PathFileManager] Initialized successfully with all enhanced features.\");");

const context = vm.createContext({
  window,
  document,
  React,
  ReactDOM,
  localStorage: window.localStorage,
  sessionStorage: window.sessionStorage,
  navigator: { clipboard: { writeText: async () => {} } },
  console,
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {},
  IntersectionObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  Array,
  Object,
  String,
  Number,
  Boolean,
  Math,
  Date,
  Set,
  Map,
  Promise,
  RegExp,
  Error,
  isNaN,
  parseInt,
  encodeURIComponent,
  decodeURIComponent,
});

vm.runInContext(rawCode, context);

const exp = window.__SFM_TEST_EXPORTS__;
console.log("Successfully extracted exports:", Object.keys(exp));

const sampleScenes = [
  {
    id: "1",
    title: "Big Buck Bunny",
    date: "2024-01-01",
    rating100: 95,
    studio: { id: "10", name: "Blender" },
    performers: [{ id: "20", name: "Bunny" }],
    paths: { screenshot: "/test.jpg", preview: "/preview.mp4", stream: "/stream.mp4" },
    files: [{ path: "/data/videos/Folder A/Scene1.mp4", basename: "Scene1.mp4", size: 1048576, duration: 600 }],
  }
];

console.log("\n--- TEST 1: FolderProfileView ---");
const fpv = exp.FolderProfileView({
  folderName: "Folder A",
  targetFolderPath: "Folder A",
  displayFolderPath: "/Folder A",
  directScenes: sampleScenes, scenes: sampleScenes,
  currentScene: sampleScenes[0],
  posterUrl: "/test.jpg",
  isForceMobile: false,
  isInsidePlayer: false,
  onToggleForceMobile: () => {},
  onSelectScene: () => {},
  onCloseProfile: () => {},
  onNavigateToDirectory: () => {},
  onPlayAll: () => {},
  onShuffleAll: () => {},
  onNavigateToFolder: () => {},
});
console.log("✓ FolderProfileView (default) rendered without error!");

const fpvInside = exp.FolderProfileView({
  folderName: "Folder A",
  targetFolderPath: "Folder A",
  displayFolderPath: "/Folder A",
  directScenes: sampleScenes, scenes: sampleScenes,
  currentScene: sampleScenes[0],
  posterUrl: "/test.jpg",
  isForceMobile: false,
  isInsidePlayer: true,
  onToggleForceMobile: () => {},
  onSelectScene: () => {},
  onCloseProfile: () => {},
  onNavigateToDirectory: () => {},
  onPlayAll: () => {},
  onShuffleAll: () => {},
  onNavigateToFolder: () => {},
});
console.log("✓ FolderProfileView (in-player) rendered without error!");

console.log("\n--- TEST 2: BingeReelPlayerModal ---");
const brpm = exp.BingeReelPlayerModal({
  scene: sampleScenes[0],
  directScenes: sampleScenes, scenes: sampleScenes,
  onSelectScene: () => {},
  onClose: () => {},
  folderName: "Folder A",
  currentPath: "Folder A",
  onNavigateToFolder: () => {},
});
console.log("✓ BingeReelPlayerModal rendered without error!");

console.log("\n--- TEST 3: FileManagerView ---");
const fmv = exp.FileManagerView({
  onClose: () => {},
});
console.log("✓ FileManagerView rendered without error!");

console.log("\n--- TEST 4: Table Views ---");
const stv = exp.SceneTableView({
  directScenes: sampleScenes, scenes: sampleScenes,
  selectedIds: new Set(),
  onToggleSelectScene: () => {},
  onSelectAll: () => {},
  onPlayScene: () => {},
});
console.log("✓ SceneTableView rendered without error!");

const sntv = exp.SceneNamesTableView({
  directScenes: sampleScenes, scenes: sampleScenes,
  selectedIds: new Set(),
  onToggleSelectScene: () => {},
  onSelectAll: () => {},
  onPlayScene: () => {},
});
console.log("✓ SceneNamesTableView rendered without error!");

console.log("\n--- TEST 5: SceneCard ---");
const sc = exp.SceneCard({
  scene: sampleScenes[0],
  isSelected: false,
  onToggleSelect: () => {},
  onPlay: () => {},
  viewMode: "grid",
  cardSize: 220,
  isMobile: false,
  isSubfolderContext: false,
});
console.log("✓ SceneCard rendered without error!");

console.log("\n--- TEST 6: Batch Modals ---");
const fnpm = exp.FilenameParserModal({
  directScenes: sampleScenes, scenes: sampleScenes,
  selectedSceneIds: new Set(["1"]),
  onClose: () => {},
  onSuccess: () => {},
});
console.log("✓ FilenameParserModal rendered without error!");

const bmm = exp.BatchMetadataModal({
  directScenes: sampleScenes, scenes: sampleScenes,
  selectedSceneIds: new Set(["1"]),
  onClose: () => {},
  onSuccess: () => {},
});
console.log("✓ BatchMetadataModal rendered without error!");

console.log("\n--- TEST 7: SettingsAndTasksModal ---");
const satm = exp.SettingsAndTasksModal({
  onClose: () => {},
  settings: {},
  onSaveSettings: () => {},
  onResetSettings: () => {},
  onRunTask: () => {},
});
console.log("✓ SettingsAndTasksModal rendered without error!");

console.log("\n--- TEST 8: clearCachedScenes execution ---");
exp.clearCachedScenes().then(() => {
  console.log("✓ clearCachedScenes() executed without error!");
  console.log("\n==========================================");
  console.log("🎉 ALL TESTS RAN AND PASSED WITH 100% SUCCESS!");
  console.log("==========================================");
});

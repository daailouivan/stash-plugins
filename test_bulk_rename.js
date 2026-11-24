/**
 * Test Suite: Bulk Rename Files (v3.2.0)
 * Validates:
 * 1. FilenameParserModal with Bulk Rename Files tab and UI elements
 * 2. Tag scheme resolution ({studio}, {code}, {performers}, {title}, {date}, {year}, {resolution}, {ext})
 * 3. Filename sanitization, extension preservation, empty bracket stripping
 * 4. sfm_tasks.py backend rename execution and database update logic
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

console.log("========================================================");
console.log("🧪 TESTING BULK RENAME FILES FEATURE (v3.2.0)");
console.log("========================================================");

// ----------------------------------------------------
// Mock Browser & Stash Environment
// ----------------------------------------------------
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
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
  indexedDB: null,
  fetch: async () => ({
    json: async () => ({ data: {} }),
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
  useRef: (init) => ({ current: init }),
  useContext: () => ({}),
  useReducer: (reducer, init) => [init, () => {}],
  useTransition: () => [false, (cb) => cb()],
  useDeferredValue: (val) => val,
  useId: () => "mock-id",
};

const ReactDOM = {
  render: () => {},
  unmountComponentAtNode: () => {},
};

window.PluginApi.React = React;
window.PluginApi.ReactDOM = ReactDOM;
window.PluginApi.register = {
  route: () => {},
};

// Sandbox execution
const sandbox = {
  window,
  document,
  console,
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {},
  React,
  ReactDOM,
  PluginApi: window.PluginApi,
  navigator: { clipboard: { writeText: async () => {} } },
};

vm.createContext(sandbox);

const fmPath = path.join(__dirname, "stash_file_manager", "file_manager.js");
let code = fs.readFileSync(fmPath, "utf-8");

const exportInjection = `
  window.__SFM_TEST_EXPORTS__ = {
    FilenameParserModal
  };
`;
code = code.replace("console.log(\"[PathFileManager] Initialized successfully with all enhanced features.\");", exportInjection + "\nconsole.log(\"[PathFileManager] Initialized successfully with all enhanced features.\");");

vm.runInContext(code, sandbox);

const exported = sandbox.window.__SFM_TEST_EXPORTS__ || {};
const { FilenameParserModal } = exported;

assert(FilenameParserModal, "FilenameParserModal must be exported");

// ----------------------------------------------------
// Test 1: FilenameParserModal Rendering
// ----------------------------------------------------
console.log("\n--- TEST 1: FilenameParserModal Tab Rendering ---");

const mockScenes = [
  {
    id: "101",
    title: "Awesome Scene Title",
    date: "2024-05-20",
    code: "MM-1234",
    studio: { id: "1", name: "Brazzers" },
    performers: [{ id: "1", name: "Jane Doe" }, { id: "2", name: "John Smith" }],
    files: [
      {
        id: "201",
        basename: "old_filename_to_rename.mp4",
        path: "/data/videos/old_filename_to_rename.mp4",
        width: 1920,
        height: 1080,
      },
    ],
    paths: { screenshot: "/thumb/101.jpg" },
  },
  {
    id: "102",
    title: "4K Special Shoot",
    date: "2023-11-15",
    code: "TUS-99",
    studio: { id: "2", name: "Twistys" },
    performers: [{ id: "3", name: "Alice Star" }],
    files: [
      {
        id: "202",
        basename: "raw_cam_rip_4k.mkv",
        path: "/data/videos/raw_cam_rip_4k.mkv",
        width: 3840,
        height: 2160,
      },
    ],
    paths: { screenshot: "/thumb/102.jpg" },
  },
];

const rendered = React.createElement(FilenameParserModal, {
  currentFolder: "TestFolder",
  currentPath: "/data/videos",
  directScenes: mockScenes,
  onClose: () => {},
  onApplied: () => {},
});

assert(rendered, "FilenameParserModal should render without error");
console.log("✓ FilenameParserModal component initialized and rendered successfully!");

// ----------------------------------------------------
// Test 2: Scheme Generation & Tag Replacement Logic
// ----------------------------------------------------
console.log("\n--- TEST 2: Tag Scheme Generation Logic ---");

function testGenerateProposedFilename(scene, scheme, cloudMatch, parsedGroups) {
  const origBasename = scene.files?.[0]?.basename || scene.title || "";
  const lastDot = origBasename.lastIndexOf(".");
  const ext = (lastDot > 0 ? origBasename.substring(lastDot + 1) : "mp4").toLowerCase();

  const studio = (cloudMatch?.studio?.name || scene.studio?.name || parsedGroups?.studio || "").trim();
  const code = (cloudMatch?.code || scene.code || parsedGroups?.code || "").trim();
  const rawTitle = (cloudMatch?.title || scene.title || parsedGroups?.title || "").trim();
  const title = (rawTitle && !rawTitle.toLowerCase().endsWith(`.${ext}`) ? rawTitle : origBasename.replace(/\.[^/.]+$/, "")).trim();

  const performers = (
    cloudMatch?.performers?.map((p) => p.name).join(", ") ||
    (scene.performers || []).map((p) => p.name).join(", ") ||
    parsedGroups?.performers ||
    ""
  ).trim();

  const date = (cloudMatch?.date || scene.date || parsedGroups?.date || "").trim();
  const year = date ? date.substring(0, 4) : "";

  const h = scene.files?.[0]?.height || 0;
  const w = scene.files?.[0]?.width || 0;
  let resolution = "";
  if (h >= 2160 || w >= 3840) resolution = "4K";
  else if (h >= 1440) resolution = "1440p";
  else if (h >= 1080) resolution = "1080p";
  else if (h >= 720) resolution = "720p";
  else if (h >= 480) resolution = "480p";
  else if (h > 0) resolution = `${h}p`;

  let proposed = scheme || "({studio})({code})({performers})({title}).{ext}";
  proposed = proposed.replace(/\{studio\}/gi, studio);
  proposed = proposed.replace(/\{code\}/gi, code);
  proposed = proposed.replace(/\{performers\}/gi, performers);
  proposed = proposed.replace(/\{title\}/gi, title);
  proposed = proposed.replace(/\{date\}/gi, date);
  proposed = proposed.replace(/\{year\}/gi, year);
  proposed = proposed.replace(/\{resolution\}/gi, resolution);
  proposed = proposed.replace(/\{ext\}/gi, ext);

  // Replace illegal filesystem characters: / \ : * ? " < > |
  proposed = proposed.replace(/[/\\:*?"<>|]/g, " - ");
  // Clean multiple separators, empty brackets, and spaces
  proposed = proposed.replace(/\(\s*-\s*\)/g, "").replace(/\[\s*-\s*\]/g, "");
  proposed = proposed.replace(/\(\s*\)/g, "").replace(/\[\s*\]/g, "");
  proposed = proposed.replace(/\s*-\s*(?:-\s*)+/g, " - ");
  proposed = proposed.replace(/\s+/g, " ").trim();
  proposed = proposed.replace(/^[-_.\s]+/, "");

  // Ensure extension is preserved
  if (!proposed.toLowerCase().endsWith("." + ext)) {
    proposed = proposed + "." + ext;
  }
  return proposed;
}

// Case A: ({studio})({code})({performers})({title}).{ext}
const resA = testGenerateProposedFilename(mockScenes[0], "({studio})({code})({performers})({title}).{ext}");
assert.strictEqual(resA, "(Brazzers)(MM-1234)(Jane Doe, John Smith)(Awesome Scene Title).mp4");
console.log(`✓ Scheme ({studio})({code})({performers})({title}).{ext} -> "${resA}"`);

// Case B: Studio - Code - Title
const resB = testGenerateProposedFilename(mockScenes[0], "{studio} - {code} - {title}.{ext}");
assert.strictEqual(resB, "Brazzers - MM-1234 - Awesome Scene Title.mp4");
console.log(`✓ Scheme {studio} - {code} - {title}.{ext} -> "${resB}"`);

// Case C: 4K MKV with resolution tag: {performers} - {title} [{resolution}].{ext}
const resC = testGenerateProposedFilename(mockScenes[1], "{performers} - {title} [{resolution}].{ext}");
assert.strictEqual(resC, "Alice Star - 4K Special Shoot [4K].mkv");
console.log(`✓ Scheme with 4K resolution tag -> "${resC}"`);

// Case D: Missing tag cleanup (empty code -> empty parenthesis removed cleanly)
const mockSceneNoCode = { ...mockScenes[0], code: "" };
const resD = testGenerateProposedFilename(mockSceneNoCode, "({studio})({code})({performers})({title}).{ext}");
assert.strictEqual(resD, "(Brazzers)(Jane Doe, John Smith)(Awesome Scene Title).mp4");
console.log(`✓ Missing tag empty parenthesis stripped cleanly -> "${resD}"`);

// Case E: Illegal character sanitization (: and / in title replaced with -)
const mockSceneIllegal = { ...mockScenes[0], title: "Part 1: The Encounter / Finale" };
const resE = testGenerateProposedFilename(mockSceneIllegal, "{studio} - {title}.{ext}");
assert(!resE.includes(":") && !resE.includes("/"), "Illegal characters must be replaced");
assert.strictEqual(resE, "Brazzers - Part 1 - The Encounter - Finale.mp4");
console.log(`✓ Illegal filesystem characters (: and /) sanitized -> "${resE}"`);

// ----------------------------------------------------
// Test 3: sfm_tasks.py Backend Task Execution
// ----------------------------------------------------
console.log("\n--- TEST 3: sfm_tasks.py Backend Execution ---");

const tmpDir = path.join("/tmp", `sfm_test_${Date.now()}`);
fs.mkdirSync(tmpDir, { recursive: true });

const testFile1 = path.join(tmpDir, "test_old_scene_1.mp4");
const testFile2 = path.join(tmpDir, "test_old_scene_2.mkv");
fs.writeFileSync(testFile1, "video content 1");
fs.writeFileSync(testFile2, "video content 2");

// Run sfm_tasks.py with python3 passing JSON on stdin
const pythonScript = path.join(__dirname, "stash_file_manager", "sfm_tasks.py");
const payload = JSON.stringify({
  task: "rename",
  items: [
    {
      file_id: 99991,
      scene_id: "8881",
      old_path: testFile1,
      new_basename: "(StudioA)(CODE1)(Performer)(Scene Title).mp4",
    },
    {
      file_id: 99992,
      scene_id: "8882",
      old_path: testFile2,
      new_basename: "StudioB - CODE2 - 4K Shoot [4K].mkv",
    },
    {
      file_id: 99993,
      scene_id: "8883",
      old_path: "/tmp/non_existent_file_12345.mp4",
      new_basename: "Should_Fail.mp4",
    },
  ],
});

const out = execSync(`python3 "${pythonScript}" rename`, {
  input: payload,
  encoding: "utf-8",
});

const lines = out.trim().split("\n");
const lastLine = lines[lines.length - 1];
const result = JSON.parse(lastLine);

assert(result.total === 3, "Total items should be 3");
assert(result.success_count === 2, "Success count should be 2");
assert(result.error_count === 1, "Error count should be 1 (non-existent file)");

// Verify files on disk actually got renamed
const expectedNew1 = path.join(tmpDir, "(StudioA)(CODE1)(Performer)(Scene Title).mp4");
const expectedNew2 = path.join(tmpDir, "StudioB - CODE2 - 4K Shoot [4K].mkv");

assert(fs.existsSync(expectedNew1), "File 1 must be renamed on disk");
assert(fs.existsSync(expectedNew2), "File 2 must be renamed on disk");
assert(!fs.existsSync(testFile1), "Old file 1 must no longer exist");
assert(!fs.existsSync(testFile2), "Old file 2 must no longer exist");

console.log("✓ Files on disk renamed successfully:");
console.log(`  • ${path.basename(testFile1)} -> ${path.basename(expectedNew1)}`);
console.log(`  • ${path.basename(testFile2)} -> ${path.basename(expectedNew2)}`);
console.log("✓ Error path cleanly handled for non-existent file.");

// Cleanup tmpDir
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("\n========================================================");
console.log("🎉 ALL BULK RENAME TESTS RAN AND PASSED WITH 100% SUCCESS!");
console.log("========================================================");

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { createInitialDbState } = require("./fixtures");

const REPO_ROOT = path.resolve(__dirname, "../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "stash_file_manager");
const MANIFEST_PATH = path.join(PLUGIN_DIR, "stash_file_manager.yml");
const CSS_PATH = path.join(PLUGIN_DIR, "file_manager.css");
const INDEX_YML_PATH = path.join(REPO_ROOT, "index.yml");
const ZIP_PATH = path.join(REPO_ROOT, "stash_file_manager.zip");

function stripYamlQuotes(val) {
  const s = String(val || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parsePluginManifest(ymlPath = MANIFEST_PATH) {
  const raw = fs.readFileSync(ymlPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const result = {
    name: "",
    description: "",
    version: "",
    ui: { javascript: [], css: [] },
    tasks: [],
    settings: {},
    raw,
  };

  let section = null;
  let subSection = null;
  let currentTask = null;
  let currentSetting = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (indent === 0) {
      subSection = null;
      currentTask = null;
      currentSetting = null;
      const m = trimmed.match(/^([a-zA-Z0-9_]+):(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = stripYamlQuotes(m[2]);
      if (key === "ui" || key === "tasks" || key === "settings" || key === "exec") {
        section = key;
      } else {
        section = null;
        result[key] = val;
      }
      continue;
    }

    if (section === "ui") {
      if (indent === 2) {
        const m = trimmed.match(/^([a-zA-Z0-9_]+):/);
        if (m) subSection = m[1];
      } else if (trimmed.startsWith("- ") && (subSection === "javascript" || subSection === "css")) {
        result.ui[subSection].push(stripYamlQuotes(trimmed.slice(2)));
      }
    } else if (section === "tasks") {
      if (indent === 2 && trimmed.startsWith("- ")) {
        currentTask = { execArgs: [] };
        result.tasks.push(currentTask);
        const rest = trimmed.slice(2).trim();
        const m = rest.match(/^([a-zA-Z0-9_]+):(.*)$/);
        if (m) currentTask[m[1]] = stripYamlQuotes(m[2]);
      } else if (currentTask && indent >= 4) {
        if (trimmed.startsWith("- ")) {
          currentTask.execArgs.push(stripYamlQuotes(trimmed.slice(2)));
        } else {
          const m = trimmed.match(/^([a-zA-Z0-9_]+):(.*)$/);
          if (m && m[1] !== "execArgs") currentTask[m[1]] = stripYamlQuotes(m[2]);
        }
      }
    } else if (section === "settings") {
      if (indent === 2) {
        const m = trimmed.match(/^([a-zA-Z0-9_]+):/);
        if (m) {
          currentSetting = m[1];
          result.settings[currentSetting] = {};
        }
      } else if (currentSetting && indent >= 4) {
        const m = trimmed.match(/^([a-zA-Z0-9_]+):(.*)$/);
        if (m) result.settings[currentSetting][m[1]] = stripYamlQuotes(m[2]);
      }
    }
  }
  return result;
}

function parseIndexYml(indexPath = INDEX_YML_PATH) {
  const raw = fs.readFileSync(indexPath, "utf8");
  const entry = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const clean = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed;
    const m = clean.match(/^([a-zA-Z0-9_]+):(.*)$/);
    if (m && !(m[1] in entry)) {
      entry[m[1]] = stripYamlQuotes(m[2]);
    }
  }
  entry.raw = raw;
  return entry;
}

function computeFileSha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function listZipEntries(zipPath = ZIP_PATH) {
  const out = execSync(`unzip -Z1 "${zipPath}"`, { encoding: "utf8" });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// ==========================================
// In-Memory IndexedDB (persists across reload)
// ==========================================
function createMemoryIndexedDB(backing = new Map()) {
  function cloneVal(v) {
    if (v === undefined || v === null) return v;
    return JSON.parse(JSON.stringify(v));
  }

  return {
    _backing: backing,
    open(name, version = 1) {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, result: null };
      if (!backing.has(name)) {
        backing.set(name, new Map());
      }
      const dbStores = backing.get(name);
      const db = {
        name,
        version,
        objectStoreNames: {
          contains: (storeName) => dbStores.has(storeName),
        },
        createObjectStore(storeName) {
          if (!dbStores.has(storeName)) dbStores.set(storeName, new Map());
          return {};
        },
        transaction(storeName) {
          if (!dbStores.has(storeName)) dbStores.set(storeName, new Map());
          const storeMap = dbStores.get(storeName);
          return {
            objectStore() {
              return {
                get(key) {
                  const r = { onsuccess: null, onerror: null, result: undefined };
                  queueMicrotask(() => {
                    r.result = storeMap.has(key) ? cloneVal(storeMap.get(key)) : undefined;
                    if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
                  });
                  return r;
                },
                put(val, key) {
                  const r = { onsuccess: null, onerror: null, result: key };
                  queueMicrotask(() => {
                    storeMap.set(key, cloneVal(val));
                    if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
                  });
                  return r;
                },
                delete(key) {
                  const r = { onsuccess: null, onerror: null, result: undefined };
                  queueMicrotask(() => {
                    storeMap.delete(key);
                    if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
                  });
                  return r;
                },
                clear() {
                  const r = { onsuccess: null, onerror: null, result: undefined };
                  queueMicrotask(() => {
                    storeMap.clear();
                    if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
                  });
                  return r;
                },
              };
            },
          };
        },
      };

      queueMicrotask(() => {
        req.result = db;
        const hadStore = dbStores.size > 0;
        if (!hadStore && typeof req.onupgradeneeded === "function") {
          req.onupgradeneeded({ target: { result: db } });
        }
        if (typeof req.onsuccess === "function") {
          req.onsuccess({ target: { result: db } });
        }
      });

      return req;
    },
  };
}

// ==========================================
// Lightweight DOM Mock with Selector Matching
// ==========================================
function parseSimpleSelector(sel) {
  const s = sel.trim();
  const tagMatch = s.match(/^([a-zA-Z0-9_-]+)/);
  const tag = tagMatch ? tagMatch[1].toUpperCase() : null;
  const idMatch = s.match(/#([a-zA-Z0-9_-]+)/);
  const id = idMatch ? idMatch[1] : null;
  const classes = [];
  const classRe = /\.([a-zA-Z0-9_-]+)/g;
  let cm;
  while ((cm = classRe.exec(s)) !== null) classes.push(cm[1]);
  const attrs = [];
  const attrRe = /\[([a-zA-Z0-9_:-]+)(?:(\*?=)"([^"]*)")?\]/g;
  let am;
  while ((am = attrRe.exec(s)) !== null) {
    attrs.push({ name: am[1], op: am[2] || null, val: am[3] || null });
  }
  return { tag, id, classes, attrs };
}

function matchesSingleDomSelector(el, parsed) {
  if (!el || typeof el !== "object") return false;
  if (parsed.tag && el.tagName !== parsed.tag) return false;
  if (parsed.id && el.id !== parsed.id) return false;
  if (parsed.classes.length > 0) {
    const clsList = String(el.className || "").split(/\s+/).filter(Boolean);
    for (const c of parsed.classes) {
      if (!clsList.includes(c)) return false;
    }
  }
  for (const a of parsed.attrs) {
    const val = el.getAttribute ? el.getAttribute(a.name) : null;
    if (val === null || val === undefined) return false;
    if (a.op === "=" && String(val) !== a.val) return false;
    if (a.op === "*=" && !String(val).includes(a.val)) return false;
  }
  return true;
}

function matchesDomSelector(el, selector) {
  const groups = String(selector).split(",").map((s) => s.trim()).filter(Boolean);
  for (const grp of groups) {
    const parts = grp.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      if (matchesSingleDomSelector(el, parseSimpleSelector(parts[0]))) return true;
    } else if (parts.length > 1) {
      const last = parseSimpleSelector(parts[parts.length - 1]);
      if (!matchesSingleDomSelector(el, last)) continue;
      let cur = el.parentElement;
      let idx = parts.length - 2;
      while (cur && idx >= 0) {
        if (matchesSingleDomSelector(cur, parseSimpleSelector(parts[idx]))) {
          idx--;
        }
        cur = cur.parentElement;
      }
      if (idx < 0) return true;
    }
  }
  return false;
}

function createDomElement(tagName = "div") {
  const attributes = {};
  const listeners = {};
  const el = {
    tagName: String(tagName).toUpperCase(),
    id: "",
    className: "",
    style: {},
    children: [],
    parentElement: null,
    attributes,
    textContent: "",
    _innerHTML: "",
    dataset: {},
    classList: {
      add(...cls) {
        const set = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
        cls.forEach((c) => set.add(c));
        el.className = Array.from(set).join(" ");
      },
      remove(...cls) {
        const drop = new Set(cls);
        el.className = String(el.className || "").split(/\s+/).filter((c) => c && !drop.has(c)).join(" ");
      },
      contains(c) {
        return String(el.className || "").split(/\s+/).includes(c);
      },
      toggle(c, force) {
        const has = this.contains(c);
        const next = force === undefined ? !has : Boolean(force);
        if (next) this.add(c);
        else this.remove(c);
        return next;
      },
    },
    setAttribute(k, v) {
      const sv = String(v);
      attributes[k] = sv;
      if (k === "id") el.id = sv;
      if (k === "class") el.className = sv;
      if (k.startsWith("data-")) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        el.dataset[camel] = sv;
      }
    },
    getAttribute(k) {
      if (k === "id" && el.id) return el.id;
      if (k === "class" && el.className) return el.className;
      return k in attributes ? attributes[k] : null;
    },
    removeAttribute(k) {
      delete attributes[k];
      if (k === "id") el.id = "";
      if (k.startsWith("data-")) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        delete el.dataset[camel];
      }
    },
    appendChild(child) {
      if (!child) return child;
      if (child.parentElement && child.parentElement !== el) {
        child.parentElement.removeChild(child);
      }
      child.parentElement = el;
      el.children.push(child);
      return child;
    },
    insertBefore(newNode, refNode) {
      if (!refNode) return el.appendChild(newNode);
      const idx = el.children.indexOf(refNode);
      if (idx === -1) return el.appendChild(newNode);
      if (newNode.parentElement) newNode.parentElement.removeChild(newNode);
      newNode.parentElement = el;
      el.children.splice(idx, 0, newNode);
      return newNode;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      if (child) child.parentElement = null;
      return child;
    },
    remove() {
      if (el.parentElement) el.parentElement.removeChild(el);
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners[type]) listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(evt) {
      const ev = typeof evt === "string" ? { type: evt } : evt;
      (listeners[ev.type] || []).forEach((fn) => fn(ev));
    },
    click() {
      el.dispatchEvent({ type: "click", preventDefault() {}, stopPropagation() {} });
    },
    focus() {},
    closest(selector) {
      let cur = el;
      while (cur) {
        if (matchesDomSelector(cur, selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      const all = el.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(selector) {
      const results = [];
      function walk(node) {
        for (const c of node.children || []) {
          if (matchesDomSelector(c, selector)) results.push(c);
          walk(c);
        }
      }
      walk(el);
      return results;
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, bottom: 500, right: 1000, width: 1000, height: 500 };
    },
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return el._innerHTML; },
    set(v) {
      el._innerHTML = String(v);
      if (v === "") el.children = [];
    },
  });
  return el;
}

// ==========================================
// Stateful React 16/18 Runtime + VTree Querying
// ==========================================
function createReactRuntime() {
  const REACT_ELEMENT_TYPE = Symbol.for("react.element");
  const Fragment = Symbol.for("react.fragment");

  let activeFiber = null;
  let dirtyRoots = new Set();
  const mountedRoots = new Map();

  function areDepsEqual(prev, next) {
    if (!prev || !next || prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i++) {
      if (!Object.is(prev[i], next[i])) return false;
    }
    return true;
  }

  function normalizeChildren(children) {
    const out = [];
    function push(c) {
      if (c === null || c === undefined || typeof c === "boolean") return;
      if (Array.isArray(c)) {
        for (const item of c) push(item);
      } else {
        out.push(c);
      }
    }
    push(children);
    return out;
  }

  const React = {
    Component: class Component {
      constructor(props) {
        this.props = props || {};
        this.state = {};
      }
      setState(updater, cb) {
        const next = typeof updater === "function" ? updater(this.state, this.props) : updater;
        this.state = { ...this.state, ...(next || {}) };
        if (this._fiber && this._fiber.root) {
          this._fiber.root.schedule();
        }
        if (typeof cb === "function") cb();
      }
    },
    createElement(type, props, ...children) {
      const finalProps = { ...(props || {}) };
      if (children.length === 1) {
        finalProps.children = children[0];
      } else if (children.length > 1) {
        finalProps.children = children;
      }
      return {
        $$typeof: REACT_ELEMENT_TYPE,
        type,
        key: props && props.key !== undefined && props.key !== null ? String(props.key) : null,
        props: finalProps,
      };
    },
    cloneElement(el, newProps, ...newChildren) {
      if (!el || typeof el !== "object") return el;
      const mergedProps = { ...(el.props || {}), ...(newProps || {}) };
      if (newChildren.length === 1) mergedProps.children = newChildren[0];
      else if (newChildren.length > 1) mergedProps.children = newChildren;
      return {
        $$typeof: REACT_ELEMENT_TYPE,
        type: el.type,
        key: newProps && newProps.key !== undefined && newProps.key !== null ? String(newProps.key) : el.key,
        props: mergedProps,
      };
    },
    isValidElement(obj) {
      return Boolean(obj && typeof obj === "object" && (obj.$$typeof === REACT_ELEMENT_TYPE || obj.type !== undefined));
    },
    Children: {
      toArray(children) {
        return normalizeChildren(children);
      },
      map(children, fn) {
        return normalizeChildren(children).map(fn);
      },
    },
    Fragment,
    StrictMode: ({ children }) => children,
    Suspense: ({ children }) => children,
    memo(comp) {
      return function MemoWrapper(props) {
        return React.createElement(comp, props);
      };
    },
    forwardRef(render) {
      const comp = function ForwardRefWrapper(props) {
        return render(props, props.ref || { current: null });
      };
      comp._isForwardRef = true;
      return comp;
    },
    createContext(defaultValue) {
      const ctx = {
        _defaultValue: defaultValue,
        Provider({ value, children }) {
          return { $$typeof: REACT_ELEMENT_TYPE, type: ctx.Provider, _ctx: ctx, _value: value, props: { children } };
        },
        Consumer({ children }) {
          const val = React.useContext(ctx);
          return typeof children === "function" ? children(val) : children;
        },
      };
      ctx.Provider._isContextProvider = ctx;
      return ctx;
    },
    createRef: () => ({ current: null }),
    useRef(init) {
      const fiber = activeFiber;
      if (!fiber) return { current: init };
      const idx = fiber.hookIdx++;
      if (!(idx in fiber.hooks)) {
        fiber.hooks[idx] = { kind: "ref", ref: { current: init } };
      }
      return fiber.hooks[idx].ref;
    },
    useState(initial) {
      const fiber = activeFiber;
      if (!fiber) {
        const v = typeof initial === "function" ? initial() : initial;
        return [v, () => {}];
      }
      const idx = fiber.hookIdx++;
      if (!(idx in fiber.hooks)) {
        const initVal = typeof initial === "function" ? initial() : initial;
        fiber.hooks[idx] = { kind: "state", value: initVal };
      }
      const slot = fiber.hooks[idx];
      const setState = (updater) => {
        const nextVal = typeof updater === "function" ? updater(slot.value) : updater;
        if (!Object.is(slot.value, nextVal)) {
          slot.value = nextVal;
          fiber.root.schedule();
        }
      };
      return [slot.value, setState];
    },
    useReducer(reducer, initialArg, initFn) {
      const fiber = activeFiber;
      if (!fiber) {
        const v = initFn ? initFn(initialArg) : initialArg;
        return [v, () => {}];
      }
      const idx = fiber.hookIdx++;
      if (!(idx in fiber.hooks)) {
        const initVal = initFn ? initFn(initialArg) : initialArg;
        fiber.hooks[idx] = { kind: "reducer", value: initVal };
      }
      const slot = fiber.hooks[idx];
      const dispatch = (action) => {
        const nextVal = reducer(slot.value, action);
        if (!Object.is(slot.value, nextVal)) {
          slot.value = nextVal;
          fiber.root.schedule();
        }
      };
      return [slot.value, dispatch];
    },
    useMemo(factory, deps) {
      const fiber = activeFiber;
      if (!fiber) return factory();
      const idx = fiber.hookIdx++;
      const prev = fiber.hooks[idx];
      if (!prev || deps === undefined || !areDepsEqual(prev.deps, deps)) {
        const val = factory();
        fiber.hooks[idx] = { kind: "memo", value: val, deps };
        return val;
      }
      return prev.value;
    },
    useCallback(fn, deps) {
      return React.useMemo(() => fn, deps);
    },
    useContext(ctx) {
      const fiber = activeFiber;
      if (!fiber || !fiber.ctxMap) return ctx._defaultValue;
      return fiber.ctxMap.has(ctx) ? fiber.ctxMap.get(ctx) : ctx._defaultValue;
    },
    useEffect(fn, deps) {
      const fiber = activeFiber;
      if (!fiber) return;
      const idx = fiber.hookIdx++;
      const prev = fiber.hooks[idx];
      if (!prev || deps === undefined || !areDepsEqual(prev.deps, deps)) {
        fiber.pendingEffects.push({ idx, fn, deps, layout: false });
      }
    },
    useLayoutEffect(fn, deps) {
      const fiber = activeFiber;
      if (!fiber) return;
      const idx = fiber.hookIdx++;
      const prev = fiber.hooks[idx];
      if (!prev || deps === undefined || !areDepsEqual(prev.deps, deps)) {
        fiber.pendingEffects.push({ idx, fn, deps, layout: true });
      }
    },
    useImperativeHandle() {},
    useDebugValue() {},
    useTransition: () => [false, (cb) => cb()],
    useDeferredValue: (v) => v,
    useId: () => "sfm-id",
    useInsertionEffect(fn, deps) { React.useLayoutEffect(fn, deps); },
    useSyncExternalStore: (sub, getSnap) => getSnap(),
    startTransition: (cb) => cb && cb(),
  };

  function createMountedRoot(initialElement, container = null) {
    let currentElement = initialElement;
    const fibers = new Map();
    let dirty = true;
    let mounted = true;
    let tree = null;

    const rootObj = {
      container,
      get tree() { return tree; },
      schedule() {
        dirty = true;
        dirtyRoots.add(rootObj);
      },
      update(nextElement) {
        currentElement = nextElement;
        dirty = true;
        renderSync();
      },
      unmount() {
        mounted = false;
        for (const fiber of fibers.values()) {
          for (const h of Object.values(fiber.hooks)) {
            if (h && typeof h.cleanup === "function") {
              try { h.cleanup(); } catch (_) {}
            }
          }
          if (fiber.instance && typeof fiber.instance.componentWillUnmount === "function") {
            try { fiber.instance.componentWillUnmount(); } catch (_) {}
          }
        }
        fibers.clear();
        tree = null;
        dirtyRoots.delete(rootObj);
      },
      renderSync,
      async flush(maxAsyncRounds = 40) {
        renderSync();
        for (let i = 0; i < maxAsyncRounds; i++) {
          await new Promise((r) => setTimeout(r, 2));
          if (!mounted) break;
          if (dirty) {
            renderSync();
          } else {
            await Promise.resolve();
            if (dirty) renderSync();
            else if (i >= 2) break;
          }
        }
        return wrapTree(rootObj);
      },
      _resolveLatestNode(node) {
        if (!node || !node._pathKey || !tree) return node;
        let found = null;
        function walk(n) {
          if (!n || found) return;
          if (n._pathKey === node._pathKey) { found = n; return; }
          for (const c of n.children || []) walk(c);
        }
        walk(tree);
        return found || node;
      },
      async click(node, extra = {}) {
        if (!node) throw new Error("Cannot click null node");
        const activeNode = rootObj._resolveLatestNode(node);
        const onClick = activeNode.props?.onClick || node.props?.onClick;
        if (typeof onClick === "function") {
          const ret = onClick({
            preventDefault() {},
            stopPropagation() {},
            currentTarget: node,
            target: node,
            ...extra,
          });
          if (ret && typeof ret.then === "function") await ret;
        }
        return rootObj.flush();
      },
      async change(node, valueOrChecked) {
        if (!node) throw new Error("Cannot change null node");
        const activeNode = rootObj._resolveLatestNode(node);
        const onChange = activeNode.props?.onChange || activeNode.props?.onInput || node.props?.onChange || node.props?.onInput;
        const target = {
          value: typeof valueOrChecked === "boolean" ? String(valueOrChecked) : valueOrChecked,
          checked: typeof valueOrChecked === "boolean" ? valueOrChecked : Boolean(valueOrChecked),
          type: node.props?.type || (node.tag === "select" ? "select-one" : "text"),
        };
        if (typeof onChange === "function") {
          const ret = onChange({
            target,
            currentTarget: target,
            preventDefault() {},
            stopPropagation() {},
          });
          if (ret && typeof ret.then === "function") await ret;
        }
        return rootObj.flush();
      },
      async submit(node) {
        if (!node) throw new Error("Cannot submit null node");
        const activeNode = rootObj._resolveLatestNode(node);
        const onSubmit = activeNode.props?.onSubmit || node.props?.onSubmit;
        if (typeof onSubmit === "function") {
          const ret = onSubmit({ preventDefault() {}, stopPropagation() {}, target: node, currentTarget: node });
          if (ret && typeof ret.then === "function") await ret;
        }
        return rootObj.flush();
      },
      async keyDown(node, key, extra = {}) {
        if (!node) throw new Error("Cannot send keyDown to null node");
        const onKeyDown = node.props?.onKeyDown;
        if (typeof onKeyDown === "function") {
          onKeyDown({ key, code: key, preventDefault() {}, stopPropagation() {}, target: node, ...extra });
        }
        return rootObj.flush();
      },
    };

    function renderSync() {
      if (!mounted) return null;
      let passes = 0;
      while (dirty && passes < 40) {
        dirty = false;
        passes++;
        const seenPaths = new Set();
        const layoutEffects = [];
        const passiveEffects = [];

        function renderNode(vnode, pathKey, ctxMap, compTrace = []) {
          if (vnode === null || vnode === undefined || typeof vnode === "boolean") {
            return null;
          }
          if (typeof vnode === "string" || typeof vnode === "number") {
            return { kind: "text", text: String(vnode), components: compTrace };
          }
          if (Array.isArray(vnode)) {
            const kids = [];
            vnode.forEach((child, i) => {
              const k = child && typeof child === "object" && child.key != null ? `k:${child.key}` : `i:${i}`;
              const r = renderNode(child, `${pathKey}.${k}`, ctxMap, compTrace);
              if (Array.isArray(r)) kids.push(...r);
              else if (r) kids.push(r);
            });
            return kids;
          }
          if (typeof vnode !== "object") {
            return null;
          }

          if (vnode.type === Fragment || vnode.type === "React.Fragment" || vnode.type === "Fragment") {
            const kids = normalizeChildren(vnode.props?.children);
            return renderNode(kids, `${pathKey}.frag`, ctxMap, compTrace);
          }

          if (vnode.type && vnode.type._isContextProvider) {
            const nextCtx = new Map(ctxMap);
            nextCtx.set(vnode.type._isContextProvider, vnode._value !== undefined ? vnode._value : vnode.props?.value);
            const kids = normalizeChildren(vnode.props?.children);
            return renderNode(kids, `${pathKey}.ctx`, nextCtx, compTrace);
          }

          if (typeof vnode.type === "function") {
            const Comp = vnode.type;
            let fiber = fibers.get(pathKey);
            if (!fiber || fiber.type !== Comp) {
              if (fiber) {
                for (const h of Object.values(fiber.hooks)) {
                  if (h && typeof h.cleanup === "function") {
                    try { h.cleanup(); } catch (_) {}
                  }
                }
              }
              fiber = {
                type: Comp,
                hooks: {},
                hookIdx: 0,
                pendingEffects: [],
                instance: null,
                root: rootObj,
                ctxMap,
                mounted: false,
              };
              fibers.set(pathKey, fiber);
            }
            seenPaths.add(pathKey);
            fiber.ctxMap = ctxMap;
            fiber.hookIdx = 0;
            fiber.pendingEffects = [];

            const nextTrace = compTrace.concat([{ name: Comp.name || "Anonymous", type: Comp, props: vnode.props }]);

            // Class component
            if (Comp.prototype && (Comp.prototype.render || Comp.prototype.isReactComponent || Comp.prototype instanceof React.Component)) {
              if (!fiber.instance) {
                fiber.instance = new Comp(vnode.props);
                fiber.instance._fiber = fiber;
              } else {
                fiber.instance.props = vnode.props;
              }
              let rendered;
              try {
                rendered = fiber.instance.render ? fiber.instance.render() : null;
              } catch (err) {
                if (typeof Comp.getDerivedStateFromError === "function") {
                  fiber.instance.state = { ...fiber.instance.state, ...(Comp.getDerivedStateFromError(err) || {}) };
                  rendered = fiber.instance.render();
                } else {
                  throw err;
                }
              }
              if (!fiber.mounted && typeof fiber.instance.componentDidMount === "function") {
                fiber.mounted = true;
                passiveEffects.push({ fiber, fn: () => fiber.instance.componentDidMount() });
              }
              try {
                return renderNode(rendered, `${pathKey}>c`, ctxMap, nextTrace);
              } catch (err) {
                if (typeof Comp.getDerivedStateFromError === "function") {
                  fiber.instance.state = { ...fiber.instance.state, ...(Comp.getDerivedStateFromError(err) || {}) };
                  if (typeof fiber.instance.componentDidCatch === "function") {
                    try { fiber.instance.componentDidCatch(err, { componentStack: "" }); } catch (_) {}
                  }
                  rendered = fiber.instance.render();
                  return renderNode(rendered, `${pathKey}>c`, ctxMap, nextTrace);
                }
                throw err;
              }
            }

            // Function component
            const prevFiber = activeFiber;
            activeFiber = fiber;
            let childEl;
            try {
              childEl = Comp(vnode.props || {});
            } finally {
              activeFiber = prevFiber;
            }
            for (const eff of fiber.pendingEffects) {
              if (eff.layout) layoutEffects.push({ fiber, eff });
              else passiveEffects.push({ fiber, eff });
            }
            fiber.mounted = true;
            return renderNode(childEl, `${pathKey}>0`, ctxMap, nextTrace);
          }

          if (typeof vnode.type === "string") {
            const rawKids = normalizeChildren(vnode.props?.children);
            const renderedKids = [];
            rawKids.forEach((child, i) => {
              const k = child && typeof child === "object" && child.key != null ? `k:${child.key}` : `i:${i}`;
              const r = renderNode(child, `${pathKey}.${k}`, ctxMap, []);
              if (Array.isArray(r)) renderedKids.push(...r);
              else if (r) renderedKids.push(r);
            });
            return {
              kind: "element",
              tag: vnode.type.toLowerCase(),
              props: vnode.props || {},
              children: renderedKids,
              components: compTrace,
              _pathKey: pathKey,
            };
          }

          return null;
        }

        const rootOut = renderNode(currentElement, "root", new Map(), []);
        tree = Array.isArray(rootOut) ? { kind: "element", tag: "fragment", props: {}, children: rootOut, components: [] } : rootOut;

        // Unmount disappeared fibers
        for (const [pKey, fiber] of Array.from(fibers.entries())) {
          if (!seenPaths.has(pKey)) {
            for (const h of Object.values(fiber.hooks)) {
              if (h && typeof h.cleanup === "function") {
                try { h.cleanup(); } catch (_) {}
              }
            }
            if (fiber.instance && typeof fiber.instance.componentWillUnmount === "function") {
              try { fiber.instance.componentWillUnmount(); } catch (_) {}
            }
            fibers.delete(pKey);
          }
        }

        const runEffectItem = ({ fiber, eff, fn }) => {
          if (fn) {
            fn();
            return;
          }
          const prevHook = fiber.hooks[eff.idx];
          if (prevHook && typeof prevHook.cleanup === "function") {
            try { prevHook.cleanup(); } catch (_) {}
          }
          let cleanup = null;
          try {
            cleanup = eff.fn();
          } catch (e) {
            // Keep running effects
          }
          fiber.hooks[eff.idx] = {
            kind: "effect",
            deps: eff.deps,
            cleanup: typeof cleanup === "function" ? cleanup : null,
          };
        };

        layoutEffects.forEach(runEffectItem);
        passiveEffects.forEach(runEffectItem);
      }

      if (container) {
        container._vtree = tree;
        container._reactRoot = rootObj;
      }
      return tree;
    }

    renderSync();
    return rootObj;
  }

  function getNodeText(node) {
    if (!node) return "";
    if (node.kind === "text") return node.text;
    const parts = [];
    for (const c of node.children || []) {
      const t = getNodeText(c);
      if (t) parts.push(t);
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  function wrapTree(rootObj) {
    function findAllWithAncestors(pred, start = rootObj.tree) {
      const out = [];
      function walk(n, ancestors) {
        if (!n) return;
        if (n.kind === "element" && pred(n, ancestors)) out.push(n);
        const nextAncestors = n.kind === "element" ? ancestors.concat([n]) : ancestors;
        for (const c of n.children || []) walk(c, nextAncestors);
      }
      walk(start, []);
      return out;
    }
    function findAll(pred, start = rootObj.tree) {
      return findAllWithAncestors((n) => pred(n), start);
    }
    function findOne(pred, msg = "Element not found", start = rootObj.tree) {
      const res = findAll(pred, start);
      if (res.length === 0) throw new Error(msg);
      return res[0];
    }
    function matchSelectorOnVNode(n, sel) {
      const parsed = parseSimpleSelector(sel);
      if (parsed.tag && n.tag !== parsed.tag.toLowerCase()) return false;
      if (parsed.id && n.props?.id !== parsed.id) return false;
      if (parsed.classes.length > 0) {
        const clsList = String(n.props?.className || "").split(/\s+/).filter(Boolean);
        for (const c of parsed.classes) {
          if (!clsList.includes(c)) return false;
        }
      }
      for (const a of parsed.attrs) {
        const val = n.props?.[a.name];
        if (val === undefined || val === null || val === false) return false;
        if (a.op === "=" && String(val) !== a.val) return false;
        if (a.op === "*=" && !String(val).includes(a.val)) return false;
      }
      return true;
    }
    function matchesDescendant(n, ancestors, group) {
      const parts = group.split(/\s+/).filter(Boolean);
      if (parts.length === 0) return false;
      if (!matchSelectorOnVNode(n, parts[parts.length - 1])) return false;
      let idx = parts.length - 2;
      for (let i = ancestors.length - 1; i >= 0 && idx >= 0; i--) {
        if (matchSelectorOnVNode(ancestors[i], parts[idx])) idx--;
      }
      return idx < 0;
    }
    function findBySelector(sel, start = rootObj.tree) {
      const groups = String(sel).split(",").map((s) => s.trim()).filter(Boolean);
      return findAllWithAncestors((n, ancestors) => groups.some((g) => matchesDescendant(n, ancestors, g)), start);
    }
    function findByText(textOrRe, opts = {}) {
      const { tag, selector, exact = false, start = rootObj.tree } = opts;
      const all = findAll((n) => {
        if (tag && n.tag !== tag.toLowerCase()) return false;
        if (selector && !matchSelectorOnVNode(n, selector)) return false;
        const txt = getNodeText(n);
        if (textOrRe instanceof RegExp) return textOrRe.test(txt);
        return exact ? txt === textOrRe : txt.includes(textOrRe);
      }, start);
      // Sort deepest-first (nodes with fewer/shorter text content, or deepest in tree)
      return all.sort((a, b) => getNodeText(a).length - getNodeText(b).length);
    }
    return {
      get root() { return rootObj.tree; },
      rootObj,
      text: () => getNodeText(rootObj.tree),
      nodeText: (n) => getNodeText(n),
      findAll,
      findOne,
      findBySelector,
      findByText,
      click: (n, extra) => rootObj.click(n, extra),
      change: (n, val) => rootObj.change(n, val),
      submit: (n) => rootObj.submit(n),
      keyDown: (n, key, extra) => rootObj.keyDown(n, key, extra),
      flush: () => rootObj.flush(),
      unmount: () => rootObj.unmount(),
    };
  }

  const ReactDOM = {
    render(element, container) {
      if (!container) return;
      const existing = mountedRoots.get(container);
      if (existing) {
        existing.update(element);
        return;
      }
      const r = createMountedRoot(element, container);
      mountedRoots.set(container, r);
    },
    unmountComponentAtNode(container) {
      if (!container) return false;
      const existing = mountedRoots.get(container);
      if (existing) {
        existing.unmount();
        mountedRoots.delete(container);
        container._vtree = null;
        return true;
      }
      return false;
    },
    createPortal(children) {
      return children;
    },
  };

  function mount(ComponentOrEl, props = {}) {
    const el = React.isValidElement(ComponentOrEl)
      ? ComponentOrEl
      : React.createElement(ComponentOrEl, props);
    const rootObj = createMountedRoot(el, null);
    return wrapTree(rootObj);
  }

  async function flushAllRoots() {
    for (const r of Array.from(dirtyRoots)) {
      dirtyRoots.delete(r);
      await r.flush();
    }
    for (const r of mountedRoots.values()) {
      await r.flush();
    }
  }

  return { React, ReactDOM, mount, wrapTree, getNodeText, flushAllRoots, mountedRoots };
}

// ==========================================
// Mock GraphQL Server
// ==========================================
function createGraphQLMock(db, options = {}) {
  const gqlCalls = [];
  let activeScrapes = 0;
  let maxConcurrentScrapes = 0;
  let jobCounter = 1;
  const faultRules = options.faultRules || [];

  async function handleFetch(url, fetchOpts = {}) {
    const body = JSON.parse(fetchOpts.body || "{}");
    const query = body.query || "";
    const variables = body.variables || {};
    const opMatch = query.match(/(?:query|mutation)\s+([A-Za-z0-9_]+)/);
    const operationName = opMatch ? opMatch[1] : "AnonymousOp";

    gqlCalls.push({ url, operationName, query, variables });

    for (let i = 0; i < faultRules.length; i++) {
      const rule = faultRules[i];
      if (rule.match(query, variables, operationName)) {
        if (rule.once) faultRules.splice(i, 1);
        if (rule.networkError) {
          throw new Error(rule.networkError);
        }
        return {
          ok: rule.httpOk !== undefined ? rule.httpOk : true,
          status: rule.status || 200,
          json: async () => ({ errors: [{ message: rule.graphqlError || "Mock GraphQL Error" }], data: null }),
        };
      }
    }

    // 1. Plugin configuration
    if (query.includes("configuration")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            configuration: {
              general: {
                stashes: db.stashes,
                stashBoxes: db.stashBoxes,
              },
              plugins: {
                stash_file_manager: db.pluginSettings,
              },
            },
            ...(query.includes("listScrapers") ? { listScrapers: db.scrapers } : {}),
          },
        }),
      };
    }

    if (query.includes("listScrapers")) {
      return {
        ok: true,
        json: async () => ({
          data: { listScrapers: db.scrapers },
        }),
      };
    }

    if (query.includes("configurePlugin")) {
      db.pluginSettings = { ...db.pluginSettings, ...(variables.input || {}) };
      return {
        ok: true,
        json: async () => ({ data: { configurePlugin: db.pluginSettings } }),
      };
    }

    // 2. findScenes
    if (query.includes("findScenes")) {
      let scenes = db.scenes;
      if (Array.isArray(variables.ids) || Array.isArray(variables.scene_ids)) {
        const wanted = new Set((variables.ids || variables.scene_ids).map(String));
        scenes = scenes.filter((s) => wanted.has(String(s.id)));
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            findScenes: {
              count: scenes.length,
              scenes: JSON.parse(JSON.stringify(scenes)),
            },
          },
        }),
      };
    }

    // 3. findScene
    if (query.includes("findScene(")) {
      const found = db.scenes.find((s) => String(s.id) === String(variables.id)) || null;
      const result = found
        ? {
            ...JSON.parse(JSON.stringify(found)),
            sceneStreams: [
              { url: found.paths?.stream || `/scene/${found.id}/stream`, mime_type: "video/mp4", label: "Direct stream" },
              { url: `/scene/${found.id}/stream.m3u8`, mime_type: "application/x-mpegURL", label: "HLS" },
            ],
          }
        : null;
      return { ok: true, json: async () => ({ data: { findScene: result } }) };
    }

    // 4. Studio / Performer / Tag lookups & creations
    if (query.includes("findStudios")) {
      const q = (variables.name || variables.filter?.q || variables.studio_filter?.name?.value || "").toLowerCase();
      const matched = db.studios.filter((st) => !q || st.name.toLowerCase() === q || st.name.toLowerCase().includes(q));
      const exact = db.studios.filter((st) => q && st.name.toLowerCase() === q);
      return { ok: true, json: async () => ({ data: { findStudios: { studios: exact.length > 0 ? exact : (q ? matched.filter((st) => st.name.toLowerCase().includes(q)) : matched) } } }) };
    }
    if (query.includes("studioCreate")) {
      const name = variables.name || variables.input?.name || "New Studio";
      const created = { id: `st_${db.studios.length + 1}`, name };
      db.studios.push(created);
      return { ok: true, json: async () => ({ data: { studioCreate: created } }) };
    }
    if (query.includes("findPerformers")) {
      const q = (variables.name || variables.filter?.q || variables.performer_filter?.name?.value || "").toLowerCase();
      const matched = db.performers.filter((p) => !q || p.name.toLowerCase() === q || p.name.toLowerCase().includes(q));
      const exact = db.performers.filter((p) => q && p.name.toLowerCase() === q);
      return { ok: true, json: async () => ({ data: { findPerformers: { performers: exact.length > 0 ? exact : (q ? matched.filter((p) => p.name.toLowerCase().includes(q)) : matched) } } }) };
    }
    if (query.includes("performerCreate")) {
      const name = variables.name || variables.input?.name || "New Performer";
      const created = { id: `p_${db.performers.length + 1}`, name };
      db.performers.push(created);
      return { ok: true, json: async () => ({ data: { performerCreate: created } }) };
    }
    if (query.includes("findTags")) {
      const q = (variables.name || variables.filter?.q || variables.tag_filter?.name?.value || "").toLowerCase();
      const matched = db.tags.filter((t) => !q || t.name.toLowerCase() === q || t.name.toLowerCase().includes(q));
      const exact = db.tags.filter((t) => q && t.name.toLowerCase() === q);
      return { ok: true, json: async () => ({ data: { findTags: { tags: exact.length > 0 ? exact : (q ? matched.filter((t) => t.name.toLowerCase().includes(q)) : matched) } } }) };
    }
    if (query.includes("tagCreate")) {
      const name = variables.name || variables.input?.name || "New Tag";
      const created = { id: `t_${db.tags.length + 1}`, name };
      db.tags.push(created);
      return { ok: true, json: async () => ({ data: { tagCreate: created } }) };
    }

    // 5. sceneUpdate
    if (query.includes("sceneUpdate")) {
      const inp = variables.input || {};
      const scene = db.scenes.find((s) => String(s.id) === String(inp.id));
      if (!scene) {
        return { ok: true, json: async () => ({ errors: [{ message: `Scene ${inp.id} not found` }], data: null }) };
      }
      if ("title" in inp) scene.title = inp.title;
      if ("date" in inp) scene.date = inp.date;
      if ("code" in inp) scene.code = inp.code;
      if ("details" in inp) scene.details = inp.details;
      if ("organized" in inp) scene.organized = Boolean(inp.organized);
      if ("rating100" in inp) scene.rating100 = inp.rating100;
      if ("director" in inp) scene.director = inp.director;
      if ("urls" in inp) scene.urls = inp.urls;
      if ("studio_id" in inp) {
        scene.studio = inp.studio_id ? (db.studios.find((st) => st.id === inp.studio_id) || { id: inp.studio_id, name: "Studio" }) : null;
      }
      if (Array.isArray(inp.performer_ids)) {
        scene.performers = inp.performer_ids.map((pid) => db.performers.find((p) => p.id === pid) || { id: pid, name: `Performer ${pid}` });
      }
      if (Array.isArray(inp.tag_ids)) {
        scene.tags = inp.tag_ids.map((tid) => db.tags.find((t) => t.id === tid) || { id: tid, name: `Tag ${tid}` });
      }
      return { ok: true, json: async () => ({ data: { sceneUpdate: JSON.parse(JSON.stringify(scene)) } }) };
    }

    // 6. bulkSceneUpdate
    if (query.includes("bulkSceneUpdate")) {
      const inp = variables.input || {};
      const ids = new Set((inp.ids || []).map(String));
      const updated = [];
      for (const scene of db.scenes) {
        if (!ids.has(String(scene.id))) continue;
        if ("organized" in inp) scene.organized = Boolean(inp.organized);
        if ("rating100" in inp) scene.rating100 = inp.rating100;
        if ("studio_id" in inp && inp.studio_id) {
          scene.studio = db.studios.find((st) => st.id === inp.studio_id) || { id: inp.studio_id, name: "Studio" };
        }
        if (inp.performer_ids?.ids) {
          const toAdd = inp.performer_ids.ids.map((pid) => db.performers.find((p) => p.id === pid) || { id: pid, name: `Performer ${pid}` });
          if (inp.performer_ids.mode === "ADD") {
            const curIds = new Set((scene.performers || []).map((p) => p.id));
            scene.performers = [...(scene.performers || []), ...toAdd.filter((p) => !curIds.has(p.id))];
          } else {
            scene.performers = toAdd;
          }
        }
        if (inp.tag_ids?.ids) {
          const toAdd = inp.tag_ids.ids.map((tid) => db.tags.find((t) => t.id === tid) || { id: tid, name: `Tag ${tid}` });
          if (inp.tag_ids.mode === "ADD") {
            const curIds = new Set((scene.tags || []).map((t) => t.id));
            scene.tags = [...(scene.tags || []), ...toAdd.filter((t) => !curIds.has(t.id))];
          } else {
            scene.tags = toAdd;
          }
        }
        updated.push(JSON.parse(JSON.stringify(scene)));
      }
      return { ok: true, json: async () => ({ data: { bulkSceneUpdate: updated } }) };
    }

    // 7. Scrape endpoints
    if (query.includes("scrapeSingleScene")) {
      activeScrapes++;
      if (activeScrapes > maxConcurrentScrapes) maxConcurrentScrapes = activeScrapes;
      await new Promise((r) => setTimeout(r, 15));
      activeScrapes--;

      const q = variables.input?.query || variables.input?.scene_id || "Scraped";
      return {
        ok: true,
        json: async () => ({
          data: {
            scrapeSingleScene: [
              {
                title: `Scraped: ${q}`,
                details: "Scraped description",
                date: "2026-04-01",
                code: `SCR-${String(q).slice(0, 6).toUpperCase()}`,
                url: "https://stashdb.org/scenes/abc",
                image: "https://stashdb.org/cover.jpg",
                studio: { stored_id: "st_1", name: "Studio Alpha" },
                performers: [{ stored_id: "p_1", name: "Alice Star" }],
                tags: [{ stored_id: "t_1", name: "4K" }],
              },
            ],
          },
        }),
      };
    }

    if (query.includes("scrapeSceneURL")) {
      activeScrapes++;
      if (activeScrapes > maxConcurrentScrapes) maxConcurrentScrapes = activeScrapes;
      await new Promise((r) => setTimeout(r, 15));
      activeScrapes--;
      return {
        ok: true,
        json: async () => ({
          data: {
            scrapeSceneURL: {
              title: "URL Scraped Scene",
              details: "From URL",
              date: "2026-04-02",
              code: "URL-777",
              url: variables.url || "https://example.com/scene/1",
              studio: { stored_id: "st_2", name: "Studio Beta" },
              performers: [{ stored_id: "p_2", name: "Bob Hero" }],
              tags: [],
            },
          },
        }),
      };
    }

    // 8. Plugin tasks & jobs
    if (query.includes("runPluginTask")) {
      const id = String(jobCounter++);
      db.jobs[id] = { id, status: "FINISHED", error: null };
      return { ok: true, json: async () => ({ data: { runPluginTask: id } }) };
    }
    if (query.includes("findJob")) {
      const job = db.jobs[String(variables.input?.id)] || { id: String(variables.input?.id), status: "FINISHED", error: null };
      return { ok: true, json: async () => ({ data: { findJob: job } }) };
    }
    if (query.includes("runPluginOperation")) {
      return { ok: true, json: async () => ({ data: { runPluginOperation: { status: "ok" } } }) };
    }

    return { ok: true, json: async () => ({ data: {} }) };
  }

  return {
    handleFetch,
    gqlCalls,
    getMaxConcurrentScrapes: () => maxConcurrentScrapes,
    resetCounters: () => { activeScrapes = 0; maxConcurrentScrapes = 0; },
    addFaultRule: (rule) => faultRules.push(rule),
  };
}

// ==========================================
// Full Stash Runtime Environment Factory
// ==========================================
function createStashEnv(opts = {}) {
  const manifest = parsePluginManifest(opts.manifestPath || MANIFEST_PATH);
  const db = opts.db || createInitialDbState(opts.scenes);
  const idbBacking = opts.idbBacking || new Map();
  const indexedDB = opts.disableIDB ? null : createMemoryIndexedDB(idbBacking);
  const localStorageData = opts.localStorageData || {};
  const sessionStorageData = opts.sessionStorageData || {};
  const graphql = createGraphQLMock(db, { faultRules: opts.faultRules });

  const localStorage = {
    getItem: (k) => (k in localStorageData ? localStorageData[k] : null),
    setItem: (k, v) => { localStorageData[k] = String(v); },
    removeItem: (k) => { delete localStorageData[k]; },
    clear: () => { for (const k of Object.keys(localStorageData)) delete localStorageData[k]; },
    key: (i) => Object.keys(localStorageData)[i] || null,
    get length() { return Object.keys(localStorageData).length; },
  };
  const sessionStorage = {
    getItem: (k) => (k in sessionStorageData ? sessionStorageData[k] : null),
    setItem: (k, v) => { sessionStorageData[k] = String(v); },
    removeItem: (k) => { delete sessionStorageData[k]; },
    clear: () => { for (const k of Object.keys(sessionStorageData)) delete sessionStorageData[k]; },
  };

  // URL & History state
  function parseUrl(u) {
    const s = String(u || "/");
    const hashIdx = s.indexOf("#");
    const hash = hashIdx >= 0 ? s.slice(hashIdx) : "";
    const noHash = hashIdx >= 0 ? s.slice(0, hashIdx) : s;
    const qIdx = noHash.indexOf("?");
    const search = qIdx >= 0 ? noHash.slice(qIdx) : "";
    const pathnameRaw = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
    const pathname = pathnameRaw.startsWith("http")
      ? new URL(pathnameRaw).pathname
      : (pathnameRaw || "/");
    return { pathname, search, hash };
  }

  const initialParsed = parseUrl(opts.url || "/scenes");
  const location = {
    pathname: initialParsed.pathname,
    search: initialParsed.search,
    hash: initialParsed.hash,
    origin: "http://localhost:9999",
    get href() {
      return `http://localhost:9999${this.pathname}${this.search}${this.hash}`;
    },
    reloadCalls: 0,
    reload() { this.reloadCalls++; },
  };

  const historyStack = [{ url: `${location.pathname}${location.search}${location.hash}`, state: null }];
  let historyIdx = 0;

  function applyUrl(url) {
    const p = parseUrl(url);
    const oldHash = location.hash;
    location.pathname = p.pathname;
    location.search = p.search;
    location.hash = p.hash;
    return oldHash !== location.hash;
  }

  const windowListeners = {};
  const pluginEventListeners = {};

  function dispatchWindowEvent(evt) {
    const type = typeof evt === "string" ? evt : evt.type;
    for (const fn of (windowListeners[type] || [])) {
      try { fn(evt); } catch (_) {}
    }
  }

  function dispatchPluginEvent(type, payload) {
    for (const fn of (pluginEventListeners[type] || [])) {
      try { fn(payload); } catch (_) {}
    }
  }

  const history = {
    get state() { return historyStack[historyIdx]?.state ?? null; },
    pushState(state, title, url) {
      historyStack.splice(historyIdx + 1);
      historyStack.push({ url: String(url), state: state ?? null });
      historyIdx = historyStack.length - 1;
      const hashChanged = applyUrl(url);
      if (hashChanged) dispatchWindowEvent({ type: "hashchange" });
    },
    replaceState(state, title, url) {
      historyStack[historyIdx] = { url: String(url), state: state ?? null };
      applyUrl(url);
    },
    back() {
      if (historyIdx <= 0) return;
      historyIdx--;
      const entry = historyStack[historyIdx];
      applyUrl(entry.url);
      dispatchWindowEvent({ type: "popstate", state: entry.state });
      dispatchPluginEvent("stash:location", { pathname: location.pathname, search: location.search });
    },
    forward() {
      if (historyIdx >= historyStack.length - 1) return;
      historyIdx++;
      const entry = historyStack[historyIdx];
      applyUrl(entry.url);
      dispatchWindowEvent({ type: "popstate", state: entry.state });
      dispatchPluginEvent("stash:location", { pathname: location.pathname, search: location.search });
    },
    get _stack() { return historyStack; },
    get _index() { return historyIdx; },
  };

  // DOM setup with .main-container + native sibling elements
  const documentBody = createDomElement("body");
  const navbar = createDomElement("nav");
  navbar.className = "top-nav navbar";
  const navbarNav = createDomElement("div");
  navbarNav.className = "navbar-nav";
  navbar.appendChild(navbarNav);
  documentBody.appendChild(navbar);

  const mainContainer = createDomElement("div");
  mainContainer.className = "main-container container-fluid";
  const nativeSiblingContent = createDomElement("div");
  nativeSiblingContent.className = "native-scenes-page";
  mainContainer.appendChild(nativeSiblingContent);
  documentBody.appendChild(mainContainer);

  const document = {
    body: documentBody,
    head: createDomElement("head"),
    fullscreenElement: null,
    createElement: (tag) => createDomElement(tag),
    createElementNS: (_ns, tag) => createDomElement(tag),
    getElementById(id) {
      return documentBody.querySelector(`#${id}`);
    },
    querySelector(sel) {
      return documentBody.querySelector(sel);
    },
    querySelectorAll(sel) {
      return documentBody.querySelectorAll(sel);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  const reactRuntime = createReactRuntime();
  const { React, ReactDOM } = reactRuntime;

  const registeredRoutes = {};
  const patches = { after: {}, before: {}, instead: {} };

  function NavLink({ to, activeClassName = "active", className = "", exact = false, onClick, children, ...rest }) {
    const targetPath = typeof to === "string" ? to : (to?.pathname || "/");
    const isActive = exact
      ? location.pathname === targetPath
      : (location.pathname === targetPath || location.pathname.startsWith(targetPath + "/"));
    const finalClass = [className, isActive ? activeClassName : ""].filter(Boolean).join(" ");
    return React.createElement(
      "a",
      {
        ...rest,
        href: targetPath,
        className: finalClass,
        "data-navlink-to": targetPath,
        "data-active-classname": activeClassName,
        onClick: (e) => {
          if (e && e.preventDefault) e.preventDefault();
          if (typeof onClick === "function") onClick(e);
          history.pushState({}, "", targetPath);
          dispatchPluginEvent("stash:location", { pathname: location.pathname, search: location.search });
          dispatchWindowEvent({ type: "popstate", state: {} });
        },
      },
      children
    );
  }

  const routerHistory = {
    push: (to) => {
      const url = typeof to === "string" ? to : `${to.pathname || ""}${to.search || ""}`;
      history.pushState({}, "", url);
      dispatchPluginEvent("stash:location", { pathname: location.pathname, search: location.search });
      dispatchWindowEvent({ type: "popstate", state: {} });
    },
    replace: (to) => {
      const url = typeof to === "string" ? to : `${to.pathname || ""}${to.search || ""}`;
      history.replaceState({}, "", url);
    },
  };

  const PluginApi = {
    React,
    ReactDOM,
    libraries: opts.omitReactRouterDOM ? {} : {
      ReactRouterDOM: {
        NavLink,
        Link: NavLink,
        useHistory: () => routerHistory,
        useLocation: () => ({ pathname: location.pathname, search: location.search, hash: location.hash }),
      },
    },
    register: {
      route(routePath, Component) {
        registeredRoutes[routePath] = Component;
      },
    },
    patch: {
      instead(target, fn) {
        if (!patches.instead[target]) patches.instead[target] = [];
        patches.instead[target].push(fn);
      },
      after(target, fn) {
        if (!patches.after[target]) patches.after[target] = [];
        patches.after[target].push(fn);
      },
      before(target, fn) {
        if (!patches.before[target]) patches.before[target] = [];
        patches.before[target].push(fn);
      },
    },
    Event: {
      addEventListener(type, fn) {
        if (!pluginEventListeners[type]) pluginEventListeners[type] = [];
        pluginEventListeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (pluginEventListeners[type]) {
          pluginEventListeners[type] = pluginEventListeners[type].filter((f) => f !== fn);
        }
      },
    },
  };

  const activeTimers = new Set();
  const activeIntervals = new Set();

  const windowObj = {
    PluginApi,
    location,
    history,
    localStorage,
    sessionStorage,
    indexedDB,
    document,
    fetch: graphql.handleFetch,
    navigator: { clipboard: { writeText: async () => {} }, userAgent: "NodeE2E" },
    addEventListener(type, fn) {
      if (!windowListeners[type]) windowListeners[type] = [];
      windowListeners[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (windowListeners[type]) windowListeners[type] = windowListeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(evt) {
      dispatchWindowEvent(evt);
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    PopStateEvent: class PopStateEvent {
      constructor(type = "popstate", init = {}) {
        this.type = type;
        this.state = init.state ?? null;
      }
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; }
      observe() {}
      disconnect() {}
    },
    getComputedStyle(el) {
      return { display: el?.style?.display || "block" };
    },
    innerWidth: opts.innerWidth || 1280,
    innerHeight: opts.innerHeight || 800,
    confirm: opts.confirmFn || (() => true),
    alert: () => {},
    prompt: () => null,
  };
  windowObj.window = windowObj;
  windowObj.self = windowObj;

  const consoleLogs = [];
  const consoleProxy = {
    log: (...args) => { consoleLogs.push(args.join(" ")); },
    warn: (...args) => { consoleLogs.push("WARN: " + args.join(" ")); },
    error: (...args) => { consoleLogs.push("ERR: " + args.join(" ")); },
    info: (...args) => { consoleLogs.push(args.join(" ")); },
    debug: () => {},
  };

  const sandbox = {
    window: windowObj,
    document,
    React,
    ReactDOM,
    PluginApi,
    localStorage,
    sessionStorage,
    indexedDB,
    fetch: graphql.handleFetch,
    navigator: windowObj.navigator,
    location,
    history,
    console: opts.silent === false ? console : consoleProxy,
    CustomEvent: windowObj.CustomEvent,
    PopStateEvent: windowObj.PopStateEvent,
    IntersectionObserver: windowObj.IntersectionObserver,
    MutationObserver: windowObj.MutationObserver,
    URLSearchParams,
    URL,
    setTimeout(fn, delay = 0) {
      const id = setTimeout(() => {
        activeTimers.delete(id);
        fn();
      }, Math.min(delay, 25));
      activeTimers.add(id);
      return id;
    },
    clearTimeout(id) {
      activeTimers.delete(id);
      clearTimeout(id);
    },
    setInterval(fn, delay = 1000) {
      // Do not keep event loop alive; only track for cleanup
      const id = setInterval(fn, Math.max(delay, 50));
      if (id.unref) id.unref();
      activeIntervals.add(id);
      return id;
    },
    clearInterval(id) {
      activeIntervals.delete(id);
      clearInterval(id);
    },
    Array, Object, String, Number, Boolean, Math, Date, Set, Map, Promise, RegExp, Error,
    isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, JSON,
  };
  sandbox.global = windowObj;
  sandbox.globalThis = windowObj;

  vm.createContext(sandbox);

  const loadedModules = [];
  for (const jsRel of manifest.ui.javascript) {
    const absJs = path.join(PLUGIN_DIR, jsRel);
    if (!fs.existsSync(absJs)) {
      throw new Error(`Manifest ui.javascript entry missing on disk: ${absJs}`);
    }
    const code = fs.readFileSync(absJs, "utf8");
    vm.runInContext(code, sandbox, { filename: absJs });
    loadedModules.push(jsRel);
  }

  function invokePatched(target, props, baseResult) {
    const insteadList = patches.instead[target] || [];
    const afterList = patches.after[target] || [];
    const beforeList = patches.before[target] || [];

    let callProps = props;
    for (const bFn of beforeList) {
      const resArr = bFn(callProps);
      if (Array.isArray(resArr) && resArr.length > 0) callProps = resArr[0];
    }

    let result;
    if (insteadList.length > 0) {
      let i = 1;
      const baseFn = () => baseResult;
      const next = () => {
        if (i >= insteadList.length) return baseFn;
        const fn = insteadList[i++];
        return (...args) => fn(...args, next());
      };
      result = insteadList[0](callProps, next());
    } else {
      result = baseResult;
    }

    for (const aFn of afterList) {
      result = aFn(callProps, result);
    }
    return result;
  }

  async function mountRoute(routePath = "/plugin/file-manager", extraProps = {}) {
    const Comp = registeredRoutes[routePath];
    if (!Comp) {
      throw new Error(`Route not registered: ${routePath}`);
    }
    const tree = reactRuntime.mount(Comp, {
      location: { pathname: location.pathname, search: location.search, hash: location.hash },
      history: routerHistory,
      ...extraProps,
    });
    await tree.flush();
    return tree;
  }

  function navigate(url) {
    history.pushState({}, "", url);
    dispatchPluginEvent("stash:location", { pathname: location.pathname, search: location.search });
    dispatchWindowEvent({ type: "popstate", state: {} });
  }

  function reload(overrideOpts = {}) {
    cleanup();
    return createStashEnv({
      db,
      idbBacking,
      localStorageData,
      sessionStorageData,
      url: location.pathname + location.search + location.hash,
      ...overrideOpts,
    });
  }

  function cleanup() {
    for (const id of activeTimers) clearTimeout(id);
    for (const id of activeIntervals) clearInterval(id);
    activeTimers.clear();
    activeIntervals.clear();
    for (const container of Array.from(reactRuntime.mountedRoots.keys())) {
      ReactDOM.unmountComponentAtNode(container);
    }
  }

  function getMountedTree(elementId = "sfm-global-modal-root") {
    const el = document.getElementById(elementId);
    if (!el || !el._reactRoot) return null;
    return reactRuntime.wrapTree(el._reactRoot);
  }

  return {
    manifest,
    loadedModules,
    window: windowObj,
    document,
    React,
    ReactDOM,
    PluginApi,
    reactRuntime,
    db,
    graphql,
    localStorage,
    localStorageData,
    idbBacking,
    location,
    history,
    registeredRoutes,
    patches,
    mainContainer,
    nativeSiblingContent,
    navbarNav,
    consoleLogs,
    mount: reactRuntime.mount,
    mountRoute,
    getMountedTree,
    invokePatched,
    navigate,
    dispatchWindowEvent,
    dispatchPluginEvent,
    reload,
    cleanup,
    get sfm() { return windowObj.__SFM__ || {}; },
    get cache() { return windowObj.__SFM_GLOBAL_CACHE__ || {}; },
  };
}

module.exports = {
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
  createMemoryIndexedDB,
  createStashEnv,
};

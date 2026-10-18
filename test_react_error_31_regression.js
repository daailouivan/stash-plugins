const fs = require("fs");
const vm = require("vm");
const assert = require("assert");

console.log("========================================================");
console.log("🧪 TESTING REACT ERROR #31 REGRESSION & PATCH RESILIENCE");
console.log("========================================================");

function validateReactChild(child) {
  if (child === null || child === undefined || typeof child === "boolean" || typeof child === "string" || typeof child === "number") {
    return;
  }
  if (Array.isArray(child)) {
    child.forEach(validateReactChild);
    return;
  }
  if (child && typeof child === "object") {
    if (child.type) {
      if (child.props && child.props.children) {
        validateReactChild(child.props.children);
      }
      return;
    }
    throw new Error("React Error #31: Objects are not valid as a React child (found: object with keys " + JSON.stringify(Object.keys(child)) + ")");
  }
}

const React = {
  Component: class {},
  createElement: (type, props, ...children) => {
    const flat = children.flat ? children.flat(Infinity) : children;
    const finalChildren = flat.filter((c) => c !== undefined && c !== null && c !== false);
    finalChildren.forEach(validateReactChild);
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
      const flat = newChildren.flat ? newChildren.flat(Infinity) : newChildren;
      flat.forEach(validateReactChild);
      mergedProps.children = flat.length === 1 ? flat[0] : flat;
    }
    return {
      type: el.type,
      key: el.key,
      props: mergedProps,
    };
  },
  isValidElement: (el) => el && typeof el === "object" && !!el.type,
  Fragment: "React.Fragment",
  useState: (v) => [typeof v === "function" ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
  useMemo: (f) => f(),
  useRef: (v) => ({ current: v }),
};

function createStashEnvironment(patchMode) {
  const insteadFns = {};
  const afterFns = {};

  const patch = {};
  if (patchMode === "instead" || patchMode === "both") {
    patch.instead = (component, fn) => {
      if (!insteadFns[component]) insteadFns[component] = [];
      insteadFns[component].push(fn);
    };
  }
  if (patchMode === "after" || patchMode === "both") {
    patch.after = (component, fn) => {
      if (!afterFns[component]) afterFns[component] = [];
      afterFns[component].push(fn);
    };
  }

  function runInstead(fns, targetFn, thisArg, argArray) {
    if (!fns || !fns.length) return targetFn.apply(thisArg, argArray);
    let i = 1;
    function next() {
      if (i >= fns.length) return targetFn;
      const thisTarget = fns[i++];
      return new Proxy(thisTarget, {
        apply: function (target, ctx, args) {
          return target.apply(ctx, args.concat(next()));
        },
      });
    }
    return fns[0].apply(thisArg, argArray.concat(next()));
  }

  function PatchFunction(name, fn) {
    return new Proxy(fn, {
      apply(target, ctx, args) {
        let result;
        if (insteadFns[name]) {
          result = runInstead(insteadFns[name], target, ctx, args);
        } else {
          result = target.apply(ctx, args);
        }
        for (const afterFn of afterFns[name] || []) {
          result = afterFn.apply(ctx, args.concat(result));
        }
        return result;
      },
    });
  }

  const sandbox = {
    window: {
      PluginApi: {
        React,
        ReactDOM: {},
        patch,
        Event: { addEventListener: () => {} },
      },
      location: { hash: "", pathname: "/scenes" },
      localStorage: { getItem: () => null, setItem: () => {} },
      addEventListener: () => {},
      document: {
        addEventListener: () => {},
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: () => null,
        createElement: () => ({ style: {}, appendChild: () => {} }),
        head: { appendChild: () => {} },
        body: { appendChild: () => {} },
      },
      console: console,
      setTimeout: () => {},
      clearTimeout: () => {},
      setInterval: () => {},
      clearInterval: () => {},
    },
    console,
    setTimeout: () => {},
    clearTimeout: () => {},
    setInterval: () => {},
    clearInterval: () => {},
  };
  sandbox.global = sandbox.window;
  sandbox.window.window = sandbox.window;
  sandbox.document = sandbox.window.document;

  const code = fs.readFileSync("./stash_file_manager/file_manager.js", "utf8");
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  return { PatchFunction, sandbox };
}

const mockScene = {
  id: "42",
  title: "Test Scene Title",
  files: [{ path: "/data/videos/Anime/Naruto/Season 1/ep01.mp4" }],
};

// TEST 1: Stash environment with both patch.instead and patch.after available
console.log("\n--- TEST 1: Stash environment with both instead & after exposed ---");
{
  const { PatchFunction } = createStashEnvironment("both");
  const SceneCardDetails = PatchFunction("SceneCard.Details", () => {
    return React.createElement("div", { className: "scene-card__details" },
      React.createElement("span", { className: "date" }, "2024-01-01"),
      React.createElement("span", { className: "path" }, "/data/videos/Anime/Naruto")
    );
  });

  // Call with React signature (props, context = {})
  const result = SceneCardDetails({ scene: mockScene }, {});
  assert(result, "SceneCardDetails must return an element");
  validateReactChild(result);
  console.log("✓ SceneCard.Details rendered safely without React Error #31");

  const ScenePage = PatchFunction("ScenePage", () => {
    return React.createElement("div", { className: "scene-page" }, "Scene Details Content");
  });
  const pageResult = ScenePage({ scene: mockScene }, {});
  assert(pageResult, "ScenePage must return an element");
  validateReactChild(pageResult);
  console.log("✓ ScenePage rendered safely without React Error #31");
}

// TEST 2: Stash environment with ONLY patch.after available (fallback mode)
console.log("\n--- TEST 2: Stash environment with ONLY patch.after exposed ---");
{
  const { PatchFunction } = createStashEnvironment("after");
  const SceneCardDetails = PatchFunction("SceneCard.Details", () => {
    return React.createElement("div", { className: "scene-card__details" }, "Card details content");
  });

  const result = SceneCardDetails({ scene: mockScene }, {});
  assert(result, "SceneCardDetails must return an element");
  validateReactChild(result);
  console.log("✓ SceneCard.Details with patch.after rendered safely without React Error #31");
}

console.log("\n========================================================");
console.log("🎉 ALL REACT ERROR #31 REGRESSION TESTS PASSED 100%!");
console.log("========================================================\n");

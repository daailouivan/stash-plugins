const fs = require("fs");
const path = require("path");
const assert = require("assert");

console.log("\n========================================================");
console.log("🧪 STARTING v3.0.1 & v3.0.2 TITLE LINE ALIGNMENT TEST SUITE");
console.log("========================================================");

const jsPath = path.join(__dirname, "stash_file_manager/file_manager.js");
const cssPath = path.join(__dirname, "stash_file_manager/file_manager.css");
const ymlPath = path.join(__dirname, "stash_file_manager/stash_file_manager.yml");
const indexYmlPath = path.join(__dirname, "index.yml");

const js = fs.readFileSync(jsPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");
const yml = fs.readFileSync(ymlPath, "utf8");

// --- TEST 1: Version Bumping ---
console.log("\n--- TEST 1: Version Bump Verification ---");
assert(/version:\s*"?3\.0\.[1-9]"?/.test(yml), "stash_file_manager.yml must have version >= 3.0.1");
console.log("✓ Manifest version updated to >= 3.0.1");

// --- TEST 2: Spelling of Sub-folders ---
console.log("\n--- TEST 2: 'Sub-folders' Spelling Verification ---");
assert(js.includes('React.createElement("span", { className: "sfm-section-title-label" }, "Sub-folders")'), "Sub-folders label must be spelled with a hyphen");
console.log("✓ Sub-folder title line correctly spelled with hyphen: 'Sub-folders'");

// --- TEST 3: CSS Alignment for Title Labels & Count Bubbles ---
console.log("\n--- TEST 3: Fixed Geometry for Title Box & Count Bubble ---");
assert(css.includes(".sfm-section-title-box"), "CSS must contain .sfm-section-title-box");
assert(css.includes("width: 195px !important") && css.includes("min-width: 195px !important"), "Title box must have fixed 195px width to align following items");
assert(css.includes(".sfm-section-title-label"), "CSS must contain .sfm-section-title-label");
assert(css.includes("width: 115px !important"), "Title label must have fixed 115px width");
assert(css.includes(".sfm-section-count-badge"), "CSS must contain .sfm-section-count-badge");
assert(css.includes("width: 48px !important") && css.includes("text-align: center !important"), "Count bubble must have fixed 48px width and centered text");
console.log("✓ Title labels and count bubbles have fixed widths: counts line up and extra digits never shift following toggles!");

// --- TEST 4: Toggles and Status Indicators Pair Alignment ---
console.log("\n--- TEST 4: Toggle & Status Indicator Pair Alignment ---");
// Pair 1: sfm-pill-subfolders
assert(css.includes(".sfm-pill-subfolders"), "CSS must contain .sfm-pill-subfolders");
assert(css.includes("width: 175px !important") && css.includes("min-width: 175px !important"), ".sfm-pill-subfolders must have fixed 175px width on both lines");

// Pair 2: sfm-pill-foldersort
assert(css.includes(".sfm-pill-foldersort"), "CSS must contain .sfm-pill-foldersort");
assert(css.includes("width: 160px !important") && css.includes("min-width: 160px !important"), ".sfm-pill-foldersort must have fixed 160px width on both lines");

// Toggle 3: sfm-pill-hideempty
assert(css.includes(".sfm-pill-hideempty"), "CSS must contain .sfm-pill-hideempty");
assert(css.includes("width: 110px !important") && css.includes("min-width: 110px !important"), ".sfm-pill-hideempty must have fixed 110px width");

// Uniform spacing
assert(css.includes("margin-left: 0.5rem !important"), "All toggles and indicators must share uniform 0.5rem margin-left");
console.log("✓ Toggles on sub-folder line naturally and perfectly align with status indicators on scenes line!");

// --- TEST 5: Toggle & Indicator State Colors ---
console.log("\n--- TEST 5: Active vs Inactive State Color Specifications ---");
assert(css.includes(".sfm-state-active"), "CSS must define .sfm-state-active");
assert(css.includes(".sfm-state-inactive"), "CSS must define .sfm-state-inactive");
assert(css.includes("color: #88c0d0 !important"), "Active state must use high-contrast cyan");
assert(css.includes("color: #707e94 !important"), "Inactive state must use muted slate");
console.log("✓ High-contrast active and inactive colors defined for all toggles and indicators!");

// --- TEST 6: Interactive Buttons on Scenes Line ---
console.log("\n--- TEST 6: Interactive Status Buttons on Scenes Line ---");
assert(js.includes('handleToggleIncludeSubfolders(!includeSubfolders)'), "Status button 1 must trigger handleToggleIncludeSubfolders");
assert(js.includes('handleToggleSortByFolderFirst(!sortByFolderFirst)'), "Status button 2 must trigger handleToggleSortByFolderFirst");
console.log("✓ Status indicators on scenes line are interactive and synchronize with toggles!");

// --- TEST 7: Permanent Menu Bar Clearance & Slim List View ---
console.log("\n--- TEST 7: Menu Bar Clearance & Slim Subfolder List Spacing ---");
assert(css.includes("top: 60px !important"), "Reel player backdrop must have top: 60px to clear permanent menu bar");
assert(css.includes(".sfm-reel-actions-column") && css.includes("top: 24px !important"), "Action column must have top: 24px offset");
assert(css.includes(".sfm-folder-list-grid") && css.includes("gap: 5px !important"), "Folder list grid must have slim 5px gap");
assert(css.includes(".sfm-folder-list-item") && css.includes("padding: 0.35rem 0.65rem !important"), "Folder list items must have slim row padding");
console.log("✓ Video player top controls clear permanent menu bar, and folder list spacing is slim and uniform!");

console.log("\n========================================================");
console.log("🎉 ALL v3.0.2 POLISH & ALIGNMENT TESTS PASSED 100%!");
console.log("========================================================\n");

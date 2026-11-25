"use strict";

const tier1Part1 = require("./tier1_part1");
const tier1Part2 = require("./tier1_part2");
const tier2Part1 = require("./tier2_part1");
const tier2Part2 = require("./tier2_part2");
const tier3 = require("./tier3_combinations");
const tier4 = require("./tier4_scenarios");

function parseArgs(argv) {
  const opts = { tiers: null, feature: null, grep: null, verbose: false, json: false };
  for (const arg of argv) {
    if (arg.startsWith("--tier=")) {
      opts.tiers = new Set(arg.slice("--tier=".length).split(",").map((s) => Number(s.trim())));
    } else if (arg.startsWith("--feature=")) {
      opts.feature = arg.slice("--feature=".length).trim().toUpperCase();
    } else if (arg.startsWith("--grep=")) {
      opts.grep = new RegExp(arg.slice("--grep=".length), "i");
    } else if (arg === "--verbose" || arg === "-v") {
      opts.verbose = true;
    } else if (arg === "--json") {
      opts.json = true;
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const allTests = [
    ...tier1Part1.getTests(),
    ...tier1Part2.getTests(),
    ...tier2Part1.getTests(),
    ...tier2Part2.getTests(),
    ...tier3.getTests(),
    ...tier4.getTests(),
  ];

  const selected = allTests.filter((t) => {
    if (opts.tiers && !opts.tiers.has(t.tier)) return false;
    if (opts.feature && t.feature.toUpperCase() !== opts.feature) return false;
    if (opts.grep && !opts.grep.test(`${t.id} ${t.feature} ${t.name}`)) return false;
    return true;
  });

  const startMs = Date.now();
  const results = [];
  const tierStats = { 1: { pass: 0, fail: 0 }, 2: { pass: 0, fail: 0 }, 3: { pass: 0, fail: 0 }, 4: { pass: 0, fail: 0 } };

  if (!opts.json) {
    console.log("===================================================================");
    console.log(`Stash File Manager v4.0.0 E2E Test Suite (${selected.length} tests selected)`);
    console.log("===================================================================");
  }

  for (const t of selected) {
    const t0 = Date.now();
    try {
      await t.fn();
      tierStats[t.tier].pass++;
      results.push({ id: t.id, tier: t.tier, feature: t.feature, name: t.name, status: "PASS", ms: Date.now() - t0 });
      if (opts.verbose && !opts.json) {
        console.log(`  [PASS] ${t.id} (${t.feature}): ${t.name}`);
      }
    } catch (err) {
      tierStats[t.tier].fail++;
      const msg = err && err.message ? err.message : String(err);
      results.push({ id: t.id, tier: t.tier, feature: t.feature, name: t.name, status: "FAIL", error: msg, ms: Date.now() - t0 });
      if (!opts.json) {
        console.log(`  [FAIL] ${t.id} (${t.feature}): ${t.name}`);
        console.log(`         -> ${msg.split("\n")[0]}`);
      }
    }
  }

  const totalPass = results.filter((r) => r.status === "PASS").length;
  const totalFail = results.filter((r) => r.status === "FAIL").length;
  const elapsedMs = Date.now() - startMs;

  if (opts.json) {
    console.log(JSON.stringify({ total: selected.length, passed: totalPass, failed: totalFail, elapsedMs, tierStats, results }, null, 2));
  } else {
    console.log("\n-------------------------------------------------------------------");
    console.log("Summary by Tier:");
    for (const tierNum of [1, 2, 3, 4]) {
      const s = tierStats[tierNum];
      if (s.pass + s.fail > 0) {
        console.log(`  Tier ${tierNum}: ${s.pass} passed, ${s.fail} failed (total ${s.pass + s.fail})`);
      }
    }
    console.log(`Total: ${totalPass}/${selected.length} passed, ${totalFail} failed in ${elapsedMs}ms`);
    console.log("-------------------------------------------------------------------");
  }

  process.exit(totalFail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("E2E runner fatal error:", err);
  process.exit(2);
});

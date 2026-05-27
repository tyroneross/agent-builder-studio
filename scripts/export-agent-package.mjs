#!/usr/bin/env node
import { exportAgentPackage } from "../lib/agent-package-exporter.mjs";

const args = parseArgs(process.argv.slice(2));

try {
  const report = await exportAgentPackage({
    slug: args.slug,
    sourceDir: args.source,
    targetDir: args.target,
    skipCheck: args.skipCheck,
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Exported ${report.package.slug}`);
    console.log(`Source: ${report.package.sourceDir}`);
    console.log(`Target: ${report.package.targetDir}`);
    console.log(`Files: ${report.package.copiedFiles}`);
    if (report.setupCheck.skipped) {
      console.log("Setup check: skipped");
    } else {
      console.log(`Setup check: ${report.setupCheck.passed ? "passed" : "failed"}`);
      if (!report.setupCheck.passed) {
        console.log(report.setupCheck.stdout.trim());
        if (report.setupCheck.stderr.trim()) console.error(report.setupCheck.stderr.trim());
      }
    }
  }

  if (report.setupCheck.passed === false) process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    slug: null,
    source: null,
    target: null,
    skipCheck: false,
    json: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--slug=")) parsed.slug = arg.slice("--slug=".length);
    else if (arg.startsWith("--source=")) parsed.source = arg.slice("--source=".length);
    else if (arg.startsWith("--target=")) parsed.target = arg.slice("--target=".length);
    else if (arg === "--skip-check") parsed.skipCheck = true;
    else if (arg === "--json") parsed.json = true;
    else if (!parsed.slug) parsed.slug = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

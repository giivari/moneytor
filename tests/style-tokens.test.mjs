// Token discipline stays enforceable: no stylesheet is exempt from stylelint, and no stylesheet outside tokens.css
// declares :root or !important.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("../", import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), "utf8");
function cssFiles(dir) {
  return fs.readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? cssFiles(`${dir}${entry.name}/`) : entry.name.endsWith(".css") ? [`${dir}${entry.name}`] : []);
}

test("stylelint ignoreFiles lists no source stylesheet", () => {
  const config = JSON.parse(read(".stylelintrc.json"));
  assert.deepEqual(config.ignoreFiles.filter((entry) => entry.startsWith("src")), []);
});

test("only tokens.css declares :root; no stylesheet uses !important", () => {
  for (const file of cssFiles("src/")) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(css, /!important/, `${file} uses !important`);
    if (path.basename(file) !== "tokens.css") assert.doesNotMatch(css, /:root/, `${file} declares :root`);
  }
});

test("user-select none is banned; user-select all (copy convenience) stays allowed", () => {
  const config = JSON.parse(read(".stylelintrc.json"));
  assert.deepEqual(config.rules["declaration-property-value-disallowed-list"], { "user-select": ["none"] });
  for (const file of cssFiles("src/")) assert.doesNotMatch(read(file), /user-select:\s*none/, `${file} disables selection`);
});

test("references/design-reference is excluded from tsconfig, eslint, stylelint, and has no node_modules", () => {
  const tsconfig = JSON.parse(read("tsconfig.json"));
  assert.ok(tsconfig.exclude.includes("references/design-reference"));
  const eslint = read("eslint.config.mjs");
  assert.match(eslint, /references\/design-reference\/\*\*/);
  const stylelint = JSON.parse(read(".stylelintrc.json"));
  assert.ok(stylelint.ignoreFiles.includes("references/design-reference/**"));
  assert.equal(fs.existsSync(new URL("references/design-reference/node_modules", root)), false);
});

function parseTokens(block) {
  return Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\b/g)].map(([, k, v]) => [k, v]));
}
function luminance(hex) {
  const raw = hex.slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrastRatio(hexA, hexB) {
  const l1 = luminance(hexA), l2 = luminance(hexB);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test("semantic and text colors meet WCAG AA contrast (>= 4.5:1) in light and dark modes", () => {
  const tokensCss = read("src/app/tokens.css");
  assert.match(tokensCss, /--font-sans:\s*"Segoe UI Variable",\s*"Segoe UI",\s*system-ui,\s*sans-serif/);
  const lightBlock = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const darkBlock = tokensCss.match(/html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const light = parseTokens(lightBlock);
  const dark = parseTokens(darkBlock);
  for (const [mode, palette] of [["light", light], ["dark", dark]]) {
    for (const bgKey of ["surface", "bg", "shell-bg"]) {
      for (const fgKey of ["ink", "ink-soft", "muted", "subtle", "positive", "negative", "warning", "info", "primary"]) {
        const ratio = contrastRatio(palette[fgKey], palette[bgKey]);
        assert.ok(ratio >= 4.5, `${mode} --${fgKey} (${palette[fgKey]}) on --${bgKey} (${palette[bgKey]}) = ${ratio.toFixed(2)}`);
      }
    }
    for (const tone of ["positive", "negative", "warning", "info"]) {
      const ratio = contrastRatio(palette[tone], palette[`${tone}-light`]);
      assert.ok(ratio >= 4.5, `${mode} --${tone} (${palette[tone]}) on --${tone}-light (${palette[`${tone}-light`]}) = ${ratio.toFixed(2)}`);
    }
    const onPrimaryRatio = contrastRatio(palette["on-primary"], palette["primary"]);
    assert.ok(onPrimaryRatio >= 4.5, `${mode} --on-primary on --primary = ${onPrimaryRatio.toFixed(2)}`);
  }
});

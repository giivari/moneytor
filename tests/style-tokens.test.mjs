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

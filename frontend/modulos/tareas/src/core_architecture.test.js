import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const modulesRoot = path.resolve(root, "../..");
const coreRoot = path.join(modulesRoot, "core");
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : /\.(js|jsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : []); }
test("Core imports no module internals and local frontend imports have no cycles", () => {
    const sources = [...files(root), ...files(coreRoot)].filter(file => !file.endsWith(".test.js"));
    const graph = new Map(sources.map(file => [file, [...readFileSync(file, "utf8").matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)].map(match => path.resolve(path.dirname(file), match[1])).filter(target => /\.(js|jsx)$/.test(target))]));
    for (const [file, imports] of graph) {
        if (file.startsWith(coreRoot + path.sep)) for (const target of imports) assert.ok(target.startsWith(coreRoot + path.sep), `${file} imports ${target}`);
    }
    const complete = new Set();
    function visit(file, trail = []) {
        assert.ok(!trail.includes(file), `Circular import: ${[...trail, file].join(" -> ")}`);
        if (complete.has(file)) return;
        assert.ok(graph.has(file), `Missing import: ${file}`);
        for (const dependency of graph.get(file)) visit(dependency, [...trail, file]);
        complete.add(file);
    }
    for (const file of sources) visit(file);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const root = path.dirname(fileURLToPath(import.meta.url));
const modulesRoot = path.resolve(root, "../..");
const coreRoot = path.join(modulesRoot, "core");
const requireBuild = createRequire(path.join(coreRoot, "package.json"));
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() && !["node_modules", "dist"].includes(entry.name) ? files(path.join(dir, entry.name)) : entry.isFile() && /\.(js|jsx)$/.test(entry.name) ? [path.join(dir, entry.name)] : []); }
test("Core infrastructure imports no module internals and local frontend imports have no cycles", () => {
    const sources = files(modulesRoot).filter(file => !file.endsWith(".test.js"));
    const graph = new Map(sources.map(file => [file, [...readFileSync(file, "utf8").matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)].map(match => path.resolve(path.dirname(file), match[1])).filter(target => /\.(js|jsx)$/.test(target))]));
    for (const [file, imports] of graph) {
        if (file.startsWith(coreRoot + path.sep) && path.basename(file) !== "app.jsx") for (const target of imports) assert.ok(target.startsWith(coreRoot + path.sep), `${file} imports ${target}`);
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

test("session, calendar, task and Drive JSX have no unbound identifiers across component scopes", () => {
    // Use the Babel parser shipped with the existing Vite React build toolchain.
    const { parse } = requireBuild("@babel/parser");
    const traverse = requireBuild("@babel/traverse").default;
    const globals = new Set([...Object.getOwnPropertyNames(globalThis), "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "requestAnimationFrame", "cancelAnimationFrame", "FileReader", "HTMLElement", "Image", "ResizeObserver", "Node", "getComputedStyle"]);
    for (const file of [path.join(coreRoot, "core_provider.jsx"), path.join(modulesRoot, "calendario/calendar_module.jsx"), ...files(path.join(modulesRoot, "docs")).filter(file => file.endsWith(".jsx")), path.join(root, "task_app.jsx"), path.join(root, "paged_comments.jsx"), path.join(root, "task_pages.jsx"), path.join(root, "paged_attachments.jsx")]) {
        const ast = parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] });
        const unbound = [];
        traverse(ast, { ReferencedIdentifier(reference) {
            if (!reference.scope.hasBinding(reference.node.name) && !globals.has(reference.node.name)) unbound.push(`${reference.node.name}:${reference.node.loc.start.line}`);
        } });
        assert.deepEqual(unbound, [], file);
    }
});

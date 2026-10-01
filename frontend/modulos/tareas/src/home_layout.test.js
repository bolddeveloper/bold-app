import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHomeLayout } from "./home_layout.js";

test("keeps one widget per type except navigation shortcuts", () => {
    const layout = normalizeHomeLayout([
        { id: "metrics-1", type: "metrics", metrics: ["assigned"] },
        { id: "metrics-2", type: "metrics", metrics: ["today"] },
        { id: "shortcuts-1", type: "shortcuts", shortcuts: [] },
        { id: "shortcuts-2", type: "shortcuts", shortcuts: [] },
    ]);
    assert.deepEqual(layout.map(widget => widget.id), ["metrics-1", "shortcuts-1", "shortcuts-2"]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { clampDrawerWidth } from "./drawer_size.js";

test("task and project drawers share desktop limits and fit smaller screens", () => {
    assert.equal(clampDrawerWidth(360, 1900), 600);
    assert.equal(clampDrawerWidth(1400, 1900), 980);
    assert.equal(clampDrawerWidth(800, 1900), 800);
    assert.equal(clampDrawerWidth(980, 800), 800);
    assert.equal(clampDrawerWidth(600, 390), 390);
});

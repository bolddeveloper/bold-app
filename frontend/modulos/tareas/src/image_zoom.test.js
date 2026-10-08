import assert from "node:assert/strict";
import test from "node:test";
import {zoomImage} from "./image_zoom.js";

test("image zoom preserves pan, caps enlargement and resets position when fitted", () => {
    assert.deepEqual(zoomImage({scale: 2, x: 30, y: -20}, 1.5), {scale: 3, x: 45, y: -30});
    assert.deepEqual(zoomImage({scale: 4, x: 60, y: -40}, 1.25), {scale: 4, x: 60, y: -40});
    assert.deepEqual(zoomImage({scale: 2, x: 30, y: -20}, 0.1), {scale: 1, x: 0, y: 0});
});

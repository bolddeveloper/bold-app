import test from "node:test";
import assert from "node:assert/strict";
import {isStoredImageUrl,isServerIconUrl, resolveImageUrls} from "./media_urls.js";

const path = "/api/v2/media/images/00000000-0000-0000-0000-000000000001/";
test("image URLs preserve API origin and replace stale assignment on nested responses", () => {
    const data = {avatar: path, comments: [{body: `<img src="${path}?assignment=00000000-0000-0000-0000-000000000002">`}], count: 1};
    const result = resolveImageUrls(data, "http://localhost:8000", "new");
    assert.equal(result.avatar, `http://localhost:8000${path}?assignment=new`);
    assert.equal(result.comments[0].body, `<img src="http://localhost:8000${path}?assignment=new">`);
    assert.equal(data.avatar, path);
});
test("rich text only admits stored images on the application origin", () => {
    assert.equal(isStoredImageUrl(path), true);
    assert.equal(isStoredImageUrl("https://tracker.example" + path), false);
    assert.equal(isStoredImageUrl("javascript:alert(1)"), false);
});
test('server icons use the authenticated image cache only for versioned local endpoints',()=>{
    const icon='/api/v2/messaging/server-icons/department/00000000-0000-4000-8000-000000000001/image/?v=1';
    assert.ok(isServerIconUrl(icon));
    for(const url of [null,'https://tracker.example'+icon,icon.replace('?v=1',''),icon.replace('department','unknown')])assert.equal(isServerIconUrl(url),false);
});

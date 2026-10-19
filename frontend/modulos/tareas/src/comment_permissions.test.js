import assert from "node:assert/strict";
import test from "node:test";
import {canManageComment} from "./comment_permissions.js";

test("comments require the server's author-only capability, never task roles or names", () => {
    assert.equal(canManageComment({can_manage: true}), true);
    for (const comment of [null, {}, {can_manage: false}, {can_manage: "true"}, {author_assignment: "me"}, {author_name: "Owner", can_edit: true}]) {
        assert.equal(canManageComment(comment, "me"), false);
    }
});
test("pending and failed comments cannot be edited or deleted", () => {
    for (const local_status of ["sending", "failed", "saved"]) {
        assert.equal(canManageComment({can_manage: true, local_status}), false);
    }
});
test("local demo requires explicit author identity and never matches by display name", () => {
    assert.equal(canManageComment({author_assignment: "me"}, "me", true), true);
    assert.equal(canManageComment({author_id: "me"}, "me", true), true);
    assert.equal(canManageComment({author_name: "me"}, "me", true), false);
    assert.equal(canManageComment({author_assignment: "other", can_manage: true}, "me", true), false);
    assert.equal(canManageComment({author_assignment: "me"}, "", true), false);
});

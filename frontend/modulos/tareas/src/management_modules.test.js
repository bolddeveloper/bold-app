import test from "node:test";
import assert from "node:assert/strict";
import { canUseManagementModule } from "../../core/core_models.js";
import { searchNavigation } from "../../core/global_search.js";

test("module delegation is independent, restricted to Dirección, and not ownership", () => {
    const direction = { is_control_plane: true }, other = { is_control_plane: false };
    const assistant = { administration_enabled: true, permissions_enabled: false };
    assert.equal(canUseManagementModule("administration", {}, direction, assistant), true);
    assert.equal(canUseManagementModule("permissions", {}, direction, assistant), false);
    assert.equal(canUseManagementModule("administration", {}, other, assistant), false);
    assert.equal(canUseManagementModule("administration", {}, direction, {}), false);
    assert.equal(canUseManagementModule("permissions", { is_superuser: true }, direction, {}), true);
    assert.equal(canUseManagementModule("permissions", { is_superuser: true }, other, {}), false);
    const navigation = ["administration", "permissions"].filter(module => canUseManagementModule(module, {}, direction, assistant)).map(id => ({ id, label: id }));
    assert.equal(searchNavigation(navigation, "empleados")[0]?.module, "administration");
    assert.deepEqual(searchNavigation(navigation, "permissions"), []);
    assert.equal(canUseManagementModule("administration", {}, direction, { ...assistant, administration_enabled: false }), false);
});

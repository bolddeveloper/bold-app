import assert from "node:assert/strict";
import test from "node:test";
import { ONBOARDING_GUIDES, onboardingGuideId } from "./onboarding_guides.js";

test("cada módulo de contenido tiene una guía independiente", () => {
    for (const module of ["home", "tasks", "inbox", "calendar", "suggestions", "reports", "workspaces", "projects"]) {
        assert.equal(onboardingGuideId(module), module);
        assert.ok(ONBOARDING_GUIDES[module].steps.length >= 3);
    }
    assert.equal(onboardingGuideId("department_projects"), "projects");
});
test("administración y permisos se excluyen incluso con formularios presentes", () => {
    for (const module of ["administration", "permissions"]) {
        for (const modal of [null, "task", "project", "edit_task"]) {
            assert.equal(onboardingGuideId(module, { modal, detail: true }), null);
        }
        assert.equal(ONBOARDING_GUIDES[module], undefined);
    }
});
test("formularios y detalle no comparten el estado de la vista de tareas", () => {
    assert.equal(onboardingGuideId("tasks", { modal: "task" }), "task-create");
    assert.equal(onboardingGuideId("tasks", { modal: "edit_task" }), "task-edit");
    assert.equal(onboardingGuideId("tasks", { detail: true }), "task-detail");
    assert.equal(onboardingGuideId("projects", { modal: "project" }), "project-form");
    assert.equal(onboardingGuideId("tasks", { modal: "delete_confirm" }), null);
    assert.equal(onboardingGuideId("unknown"), null);
});
test("el catálogo es explicativo: no navega ni ejecuta acciones de dominio", () => {
    for (const guide of Object.values(ONBOARDING_GUIDES)) {
        assert.ok(guide.root);
        for (const step of guide.steps) {
            assert.equal(typeof step.element, "string");
            assert.equal(typeof step.popover.description, "string");
            assert.ok(step.popover.description.length > 70);
            assert.equal(step.popover.onNextClick, undefined);
        }
    }
});

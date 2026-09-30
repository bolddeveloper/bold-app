import assert from "node:assert/strict";
import test from "node:test";

import { buildNavigationSearchIndex, searchNavigation } from "../../core/global_search.js";

const baseNavigation = [
    { id: "home", label: "Inicio", icon: "home" },
    { id: "tasks", label: "Tareas", icon: "check" },
    { id: "calendar", label: "Calendario", icon: "calendar" },
];
const directionNavigation = [
    ...baseNavigation,
    { id: "permissions", label: "Permisos", icon: "permissions" },
];
const ownerNavigation = [
    ...directionNavigation,
    { id: "administration", label: "Administración", icon: "administration" },
];

test("el índice solo contiene módulos presentes en la navegación autorizada", () => {
    const index = buildNavigationSearchIndex(baseNavigation);
    assert.ok(index.length > baseNavigation.length);
    assert.ok(index.every(entry => baseNavigation.some(module => module.id === entry.module)));
    assert.deepEqual(searchNavigation(baseNavigation, "permisos"), []);
    assert.deepEqual(searchNavigation(baseNavigation, "empleados"), []);
});

test("Dirección puede encontrar Permisos, pero no Administración sin ser propietario", () => {
    assert.equal(searchNavigation(directionNavigation, "permisos")[0]?.module, "permissions");
    assert.deepEqual(searchNavigation(directionNavigation, "administración"), []);
    assert.deepEqual(searchNavigation(directionNavigation, "auditoría"), []);
});

test("el propietario puede buscar vistas administrativas concretas", () => {
    const result = searchNavigation(ownerNavigation, "auditoria")[0];
    assert.equal(result?.module, "administration");
    assert.equal(result?.view, "audit");
    assert.equal(result?.reference, "Administración › Auditoría");
});

test("la búsqueda ignora acentos y localiza submódulos", () => {
    assert.equal(searchNavigation(baseNavigation, "planificacion")[0]?.target, "schedules");
    assert.equal(searchNavigation(ownerNavigation, "organizacion")[0]?.view, "organization");
    assert.equal(searchNavigation(baseNavigation, "vista mensual")[0]?.view, "month");
});

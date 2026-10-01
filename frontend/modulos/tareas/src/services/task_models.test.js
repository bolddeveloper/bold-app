import { isControlPlaneContext, normalizeAssignment, selectAssignment, selectEntranceAssignment, shouldLeaveRestrictedShellModule } from "../../../core/core_models.js";
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProject, normalizeStatus, normalizeTask, normalizeTaskProject, projectTask, dateFromISO, toISODate, taskPayload, uniqueProjectName, validateProjectDraft, recentProjectIds, isActiveProject, groupProjectsByUnit, isMyTask, membersForUnit } from "./task_models.js";
test("assignment selection handles none, one, several and stale stored selection", () => {
    assert.equal(selectAssignment([], "stale"), "");
    assert.equal(selectAssignment([{ id: "a" }]), "a");
    assert.equal(selectAssignment([{ id: "a" }, { id: "b" }]), "");
    assert.equal(selectAssignment([{ id: "a" }, { id: "b" }], "b"), "b");
    assert.equal(selectAssignment([{ id: "a" }, { id: "b" }], "stale"), "");
});
test("control-plane modules are exposed only from the Direction context", () => {
    assert.equal(isControlPlaneContext({ name: "Marketing", is_control_plane: false }, { unit_name: "Marketing" }), false);
    assert.equal(isControlPlaneContext({ name: "Dirección", is_control_plane: true }, { unit_name: "Dirección" }), true);
    assert.equal(isControlPlaneContext({ name: "Dirección", is_control_plane: false }, { unit_name: "Dirección" }), false);
    assert.equal(isControlPlaneContext(null, { unit_name: "Direccion" }), true);
});
test("shell access guard preserves task subviews and leaves removed restricted modules", () => {
    const navigation = [{ id: "home", default: true }, { id: "tasks" }];
    assert.equal(shouldLeaveRestrictedShellModule("projects", navigation), false);
    assert.equal(shouldLeaveRestrictedShellModule("workspaces", navigation), false);
    assert.equal(shouldLeaveRestrictedShellModule("permissions", navigation), true);
    assert.equal(shouldLeaveRestrictedShellModule("administration", navigation), true);
    assert.equal(shouldLeaveRestrictedShellModule("permissions", [...navigation, { id: "permissions" }]), false);
});
test("normalizers retain UUID identity and distinguish project links from task ownership", () => {
    assert.deepEqual(normalizeProject({ id: "p", name: "Proyecto", color_hex: "#123456", unit: "u" }), { id: "p", name: "Proyecto", color_hex: "#123456", unit: "u", label: "Proyecto", color: "#123456", unitId: "u" });
    const person = normalizeAssignment({ id: "assignment", employee: "employee", employee_name: "Ana Martínez", unit: "u" });
    assert.equal(person.id, "assignment"); assert.equal(person.personId, "employee"); assert.equal(person.initials, "AM");
    const status = normalizeStatus({ id: "s", name: "Hecho", is_final: true, unit: "u", category: "completed" });
    assert.equal(status.isFinal, true); assert.equal(status.label, "Hecho"); assert.equal(status.unitId, "u");
    const task = normalizeTask({ id: "t", status: "s", unit: "u", assignee_assignment: "assignment", due_date: "2030-01-01", priority: "high", parent_task: "parent" }, [status]);
    assert.equal(task.assigneeId, "assignment"); assert.equal(task.completed, true); assert.equal(task.due_day, 1); assert.equal(task.priority, "Alta"); assert.equal(task.parentTaskId, "parent");
    assert.equal(task.project_id, undefined);
    task.taskProjects = [normalizeTaskProject({ id: 1, task: "t", project: "p1", section: "s1", position: "1.0000000001" }), normalizeTaskProject({ id: 2, task: "t", project: "p2", section: "s2", position: "2" })];
    assert.equal(projectTask(task, "p2").section, "s2"); assert.equal(projectTask(task, "p1").taskProjects.length, 2);
    assert.equal(task.taskProjects[0].position, "1.0000000001");
});
test("ISO dates survive month/year boundaries and reject impossible calendar dates", () => {
    for (const iso of ["2030-01-01", "2028-02-29", "2027-12-31"]) {
        const date = dateFromISO(iso); assert.equal(toISODate(date.getFullYear(), date.getMonth(), date.getDate()), iso);
    }
    for (const invalid of [null, "", "2027-02-29", "2028-02-30", "2027-13-01", "2027-01-01T00:00:00Z"]) assert.equal(dateFromISO(invalid), null);
    assert.equal(toISODate(2030, 0, null), null);
});
test("project drafts validate ranges and duplicate names get bounded suffixes", () => {
    assert.match(validateProjectDraft(" ", "", ""), /obligatorio/);
    assert.match(validateProjectDraft("Proyecto", "2030-02-01", "2030-01-31"), /final/);
    assert.equal(validateProjectDraft(" Proyecto ", "2030-01-01", "2030-01-31"), "");
    assert.equal(uniqueProjectName("Proyecto", ["Proyecto", "Proyecto (2)"]), "Proyecto (3)");
    assert.equal(uniqueProjectName("x".repeat(180), ["x".repeat(180)]).length, 180);
});
test("recent projects are ordered, bounded and limited to accessible projects", () => {
    assert.deepEqual(recentProjectIds(["p2", "deleted", "p2", "p1"], ["p1", "p2", "p3", "p4", "p5"], "p3"), ["p3", "p2", "p1", "p4"]);
});
test("owner project view keeps current projects grouped and ordered by department", () => {
    const projects = [
        { id: "p1", unitId: "ops", status: "Activo" },
        { id: "p2", unitId: "marketing", status: "Pendiente" },
        { id: "p3", unitId: "ops", status: "Inactivo" },
        { id: "p4", unitId: "marketing", status: "Activo", is_archived: true },
    ];
    const current = projects.filter(isActiveProject);
    assert.deepEqual(current.map(project => project.id), ["p1", "p2"]);
    assert.deepEqual(
        groupProjectsByUnit(current, [{ id: "ops", name: "Operaciones" }, { id: "marketing", name: "Marketing" }])
            .map(group => [group.name, group.projects.map(project => project.id)]),
        [["Marketing", ["p2"]], ["Operaciones", ["p1"]]],
    );
});
test("a fresh login skips assignment selection only when there is one option", () => {
    assert.equal(selectEntranceAssignment([{ id: "a" }], "", true), "a");
    assert.equal(selectEntranceAssignment([{ id: "a" }, { id: "b" }], "", true), "");
    assert.equal(selectEntranceAssignment([{ id: "a" }, { id: "b" }], "b", false), "b");
});
test("project collaborators are limited to the selected project unit", () => {
    const members = [
        { id: "marketing-1", unitId: "marketing" },
        { id: "operations-1", unitId: "operations" },
        { id: "marketing-2", unitId: "marketing" },
    ];
    assert.deepEqual(membersForUnit(members, "marketing").map(member => member.id), ["marketing-1", "marketing-2"]);
});
test("my tasks include responsible and follower assignments without duplicating rows", () => {
    const tasks = [
        { id: "owner", assignee_id: "a", collaborator_ids: ["a"] },
        { id: "follower", assignee_id: "b", collaborator_ids: ["a"] },
        { id: "other", assignee_id: "b", collaborator_ids: [] }
    ];
    assert.deepEqual(tasks.filter(task => isMyTask(task, "a")).map(task => task.id), ["owner", "follower"]);
});
test("payload creates atomic project link and patches only editable fields", () => {
    const statuses = [normalizeStatus({ id: "s", name: "Pendiente", unit: "u", is_final: false })];
    const task = { title: "Prueba", unitId: "u", status: "Pendiente", assignee_id: "assignment", due_date: "2030-01-01", project_id: "p", section: "section", priority: "Alta", created_by: "bad", subtasks: [] };
    const payload = taskPayload(task, statuses, { create: true });
    assert.equal(payload.project, "p"); assert.equal(payload.section, "section"); assert.equal(payload.assignee_assignment, "assignment"); assert.equal(payload.created_by, undefined); assert.equal(payload.priority, "high");
    const patch = taskPayload({ title: "Editada", due_date: null }, statuses);
    assert.deepEqual(patch, { title: "Editada", due_date: null });
    assert.throws(() => taskPayload({ unitId: "other", status: "Pendiente" }, statuses), /compatible/);
});

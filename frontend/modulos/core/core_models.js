export function selectAssignment(assignments, savedId) {
    return assignments.find(item => item.id === savedId)?.id || (assignments.length === 1 ? assignments[0].id : "");
}
export function selectEntranceAssignment(assignments, savedId, enteredFromLogin) {
    return enteredFromLogin && assignments.length > 1 ? "" : selectAssignment(assignments, savedId);
}
export const isControlPlaneContext = (activeUnit, activeAssignment) => activeUnit
    ? Boolean(activeUnit.is_control_plane)
    : ["Dirección", "Direccion"].includes(activeAssignment?.unit_name);
const restrictedShellModules = new Set(["administration", "permissions"]);
export function canUseManagementModule(module, account, activeUnit, activeAssignment) {
    return isControlPlaneContext(activeUnit, activeAssignment)
        && Boolean(account?.is_superuser || activeAssignment?.[`${module}_enabled`]);
}
export const shouldLeaveRestrictedShellModule = (activeModule, navigation) => restrictedShellModules.has(activeModule)
    && !navigation.some(item => item.id === activeModule);
export const normalizeAssignment = dto => ({ ...dto, personId: dto.employee, name: dto.employee_name, unitId: dto.unit, initials: (dto.employee_name || "").split(/\s+/).slice(0, 2).map(word => word[0]).join(""), color: "#4d9ae6", email: dto.employee_email || "" });

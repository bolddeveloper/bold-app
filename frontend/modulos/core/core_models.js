export function selectAssignment(assignments, savedId) {
    return assignments.find(item => item.id === savedId)?.id || (assignments.length === 1 ? assignments[0].id : "");
}
export const normalizeAssignment = dto => ({ ...dto, personId: dto.employee, name: dto.employee_name, unitId: dto.unit, initials: (dto.employee_name || "").split(/\s+/).slice(0, 2).map(word => word[0]).join(""), color: "#4d9ae6", email: dto.employee_email || "" });

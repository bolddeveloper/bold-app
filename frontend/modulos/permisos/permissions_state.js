export async function fetchConsistentPermissionSnapshot({ api, unitId, attempts = 2 }) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const access = await api.access();
        const [catalog, policies, grants, authorities, effective, audit] = await Promise.all([
            api.catalog(),
            api.rolePolicies(),
            api.grants(),
            api.authorities(),
            api.effective(unitId),
            access.can_read_audit && access.mfa_recent
                ? api.audit({ limit: 100 })
                : Promise.resolve([]),
        ]);
        const revisions = [
            access.policy_revision,
            policies.revision,
            grants.revision,
            authorities.revision,
            effective.revision,
        ].map(value => Number(value));
        if (revisions.every(Number.isFinite) && new Set(revisions).size === 1) {
            return {
                access,
                catalog,
                policies,
                grants: grants.results,
                authorities: authorities.results,
                effective: effective.results,
                audit,
                revision: revisions[0],
            };
        }
    }
    throw new Error("Las políticas cambiaron mientras se cargaba la pantalla. Actualiza e inténtalo de nuevo.");
}

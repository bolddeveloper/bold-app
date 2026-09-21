function cacheKey({ assignmentId, permissionCode, unitId, resourceId }) {
    return JSON.stringify([
        assignmentId ?? null,
        permissionCode ?? null,
        unitId ?? null,
        resourceId ?? null,
    ]);
}

export function createPermissionCache({ authorize, ttlMs = 5_000, now = () => Date.now() }) {
    const entries = new Map();
    let generation = 0;
    let revision = null;

    function invalidate() {
        generation += 1;
        entries.clear();
    }

    function setRevision(nextRevision) {
        if (nextRevision === undefined || nextRevision === null) return false;
        if (revision === null) {
            revision = nextRevision;
            // Una revisión obtenida fuera de una decisión (polling/WS) vuelve
            // inciertas las solicitudes que ya estaban en vuelo.
            if (entries.size) invalidate();
            return false;
        }
        if (String(revision) !== String(nextRevision)) {
            revision = nextRevision;
            invalidate();
            return true;
        }
        return false;
    }

    function clear() {
        invalidate();
        revision = null;
    }

    function can(query) {
        const key = cacheKey(query);
        const current = entries.get(key);
        const timestamp = now();
        if (current && current.expiresAt > timestamp) return current.promise;
        if (current) entries.delete(key);

        const requestGeneration = generation;
        const entry = { expiresAt: timestamp + ttlMs, promise: null };
        let authorizationRequest;
        try {
            // Inicia de inmediato para que dos llamadas del mismo tick puedan
            // compartir exactamente la misma promesa.
            authorizationRequest = authorize(query);
        } catch (error) {
            return Promise.reject(error);
        }
        entry.promise = Promise.resolve(authorizationRequest)
            .then(result => {
                const responseRevision = result?.policy_revision ?? result?.policy_version;
                if (generation === requestGeneration) {
                    if (revision !== null && responseRevision !== undefined && String(revision) !== String(responseRevision)) {
                        setRevision(responseRevision);
                    } else {
                        if (revision === null && responseRevision !== undefined) revision = responseRevision;
                        if (generation === requestGeneration) entries.set(key, entry);
                    }
                }
                return Boolean(result?.allowed);
            })
            .catch(error => {
                if (entries.get(key) === entry) entries.delete(key);
                throw error;
            });
        entries.set(key, entry);
        return entry.promise;
    }

    return { can, setRevision, invalidate, clear };
}

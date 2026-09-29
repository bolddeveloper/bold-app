export const ONBOARDING_VERSION = "1";

export function onboardingStorageKey(identity) {
    const subject = identity?.id || identity?.personId || "demo";
    return `bold_onboarding:${ONBOARDING_VERSION}:${subject}`;
}

export function readOnboardingState(storage, identity) {
    try {
        const value = JSON.parse(storage.getItem(onboardingStorageKey(identity)));
        return value && ["completed", "skipped"].includes(value.status) ? value : null;
    } catch {
        return null;
    }
}

export function writeOnboardingState(storage, identity, status) {
    const value = { status, version: ONBOARDING_VERSION, updatedAt: new Date().toISOString() };
    try { storage.setItem(onboardingStorageKey(identity), JSON.stringify(value)); } catch { /* El tutorial sigue funcionando sin persistencia. */ }
    return value;
}

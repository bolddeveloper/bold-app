export const ONBOARDING_VERSION = "2";

export function onboardingStorageKey(identity, guide = "home") {
    const subject = identity?.id || identity?.personId || "demo";
    return `bold_onboarding:${ONBOARDING_VERSION}:${subject}:${guide}`;
}

export function readOnboardingState(storage, identity, guide = "home") {
    try {
        const value = JSON.parse(storage.getItem(onboardingStorageKey(identity, guide)));
        return value?.version === ONBOARDING_VERSION && value.guide === guide && ["completed", "skipped"].includes(value.status) ? value : null;
    } catch {
        return null;
    }
}

export function writeOnboardingState(storage, identity, status, guide = "home") {
    const value = { status, guide, version: ONBOARDING_VERSION, updatedAt: new Date().toISOString() };
    try { storage.setItem(onboardingStorageKey(identity, guide), JSON.stringify(value)); } catch { /* El tutorial sigue funcionando sin persistencia. */ }
    return value;
}

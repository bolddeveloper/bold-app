// Reconnecting is not a revocation. Keep ciphertext while suspending keys;
// every reopened draft still requires a fresh resource-specific server ACL.
export function permissionDraftAction(detail){
    return detail?.uncertain || detail?.authorizationChanged===false ? "suspend":"purge";
}

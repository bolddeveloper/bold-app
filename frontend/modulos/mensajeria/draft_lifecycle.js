// Reconnecting is not a revocation. Keep ciphertext while suspending keys;
// every reopened draft still requires a fresh resource-specific server ACL.
export function permissionDraftAction(detail){
    return detail?.uncertain || detail?.authorizationChanged===false ? "suspend":"purge";
}

// Logout removes keys. Only an explicit private-cache clear deletes ciphertext;
// reopening still needs the same account and a fresh resource-specific grant.
export function cacheDraftAction(type){return type === "bold:private-cache-suspend" ? "suspend" : "purge";}

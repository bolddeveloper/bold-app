import {useEffect, useState, useSyncExternalStore} from "react";
import {createGoogleCache} from "../google_cache.js";
import {getCoreState, subscribeCore} from "../core_store.js";
import {http} from "../http_client.js";
import {isStoredImageUrl} from "./media_urls.js";

const cache = createGoogleCache({name: "bold-private-images", ttl: Infinity, maxBytes: 256 * 1024 * 1024, maxEntries: 4000});
const pending = new Map();
let generation = 0;
const listeners = new Set();
function suspendImages() { generation++; pending.clear(); cache.suspend(); for (const notify of listeners) notify(); }
function clearImages() { suspendImages(); void cache.clear(); }
function subscribeImages(notify) {
    listeners.add(notify);
    const unsubscribe = subscribeCore(notify);
    return () => {listeners.delete(notify); unsubscribe();};
}
globalThis.addEventListener?.("bold:private-cache-clear", clearImages);
globalThis.addEventListener?.("bold:unauthorized", suspendImages);
globalThis.addEventListener?.("bold:permissions-revision", clearImages);
const channel = typeof window !== "undefined" && globalThis.BroadcastChannel ? new BroadcastChannel("bold-private-images") : null;
channel?.addEventListener("message", event => event.data === "suspend" ? suspendImages() : clearImages());
globalThis.addEventListener?.("bold:private-cache-suspend", () => {suspendImages(); channel?.postMessage("suspend");});
globalThis.addEventListener?.("bold:private-cache-clear", () => channel?.postMessage("clear"));
globalThis.addEventListener?.("bold:permissions-revision", () => channel?.postMessage("clear"));
function imageScope() {
    const state = getCoreState();
    return state.account && state.activeAssignment && !state.securityUncertain ? `${state.account.id}:${state.activeAssignment.id}` : "";
}
async function loadImage(scope, src) {
    const key = `${scope}:${src}`;
    if (pending.has(key)) return pending.get(key);
    const epoch = generation;
    const operation = (async () => {
        let blob = await cache.get(scope, src);
        if (!blob) {
            blob = await http.request(src, {responseType: "blob"});
            if (epoch === generation) await cache.put(scope, src, blob);
        }
        if (epoch !== generation) throw new DOMException("Contexto cancelado", "AbortError");
        return blob;
    })();
    pending.set(key, operation);
    try {return await operation;} finally {if (pending.get(key) === operation) pending.delete(key);}
}

export function CachedImage({src, ...props}) {
    const context = useSyncExternalStore(subscribeImages, () => `${imageScope()}|${generation}`);
    const scope = context.split("|")[0];
    const stored = isStoredImageUrl(src), key = `${context}:${src}`;
    const [image, setImage] = useState(null);
    useEffect(() => {
        if (!stored || !scope) return;
        let active = true, url;
        loadImage(scope, src).then(blob => {
            if (active) {url = URL.createObjectURL(blob); setImage({key, url});}
        }).catch(error => {if (active && error.name !== "AbortError") setImage({key, url: src});});
        return () => {active = false; if (url) URL.revokeObjectURL(url);};
    }, [src, scope, stored, key]);
    return <img {...props} src={stored ? scope && image?.key === key ? image.url : undefined : src}/>;
}

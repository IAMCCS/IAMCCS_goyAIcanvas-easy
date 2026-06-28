import Constants from "./Constants.js";

const EASY_API_BASE = Constants.EASY_API_BASE || "/iamccs/goyai_easy";

export function easyApiUrl(path = "") {
    const cleanPath = String(path || "").replace(/^\/+/, "");
    return cleanPath ? `${EASY_API_BASE}/${cleanPath}` : EASY_API_BASE;
}

export async function fetchEasyJson(path, options = {}) {
    const response = await fetch(easyApiUrl(path), {
        cache: "no-store",
        ...options,
        headers: {
            ...(options.headers || {}),
        },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error || `Easy API failed (${response.status})`);
    }
    return data;
}

export async function loadEasyWorkflow(mode) {
    return fetchEasyJson(`workflow/${encodeURIComponent(String(mode || "inpaint"))}`);
}

export async function saveEasyAsset(dataUrl, prefix, options = {}) {
    const image = String(dataUrl || "");
    if (!image.startsWith("data:image/")) {
        throw new Error(`Easy ${prefix}: missing image data`);
    }
    const asset = await fetchEasyJson("save_asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, image, ...(options || {}) }),
    });
    if (!asset?.name) {
        throw new Error("Easy asset save did not return a filename");
    }
    return asset;
}

export async function loadEasySettings() {
    return fetchEasyJson("settings");
}

export async function saveEasySettings(settings = {}) {
    return fetchEasyJson("settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings || {}),
    });
}

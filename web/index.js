console.log("[IAMCCS Easy] Easy standalone extension entry loaded", import.meta.url);
import { app } from "/scripts/app.js";
import { debugTrace } from "./utils/DebugTrace.js";
import { GOYA_BUILD_INFO, getGoyaBuildLabel } from "./app/BuildInfo.js?v=20260630_EASY_OUTPAINT_CONDITIONING01";

let easyNodeUiPromise = null;

const GOYA_EASY_WEB_BUILD = `${GOYA_BUILD_INFO.id}-${Date.now()}`;
const GOYA_EASY_NODE_UI_URL = `./IAMCCS_EasyFullNodeUI.js?v=${GOYA_EASY_WEB_BUILD}`;
const GOYA_EASY_NODE_CANONICAL_TYPE = "IAMCCSGoyaCanvasEasyNode";
const GOYA_EASY_NODE_LEGACY_TYPE = "IAMCCS_goyAIcanvas-easy";
const GOYA_EASY_NODE_CLASS_NAMES = new Set([GOYA_EASY_NODE_CANONICAL_TYPE, GOYA_EASY_NODE_LEGACY_TYPE]);
const NODE_OBJECT_INSTANCES = new WeakMap();
const NODE_PENDING_MOUNTS = new WeakSet();
const NODE_RETRY_COUNTS = new WeakMap();
const REMOUNT_DELAYS_MS = [0, 50, 200, 750, 1500];

function setRuntimeDiagnostics(patch = {}) {
    try {
        window.__IAMCCS_RUNTIME_DIAGNOSTICS__ = {
            ...(window.__IAMCCS_RUNTIME_DIAGNOSTICS__ || {}),
            webBuild: GOYA_EASY_WEB_BUILD,
            buildInfo: GOYA_BUILD_INFO,
            buildLabel: getGoyaBuildLabel(),
            easyStandaloneEntrypoint: true,
            ...patch,
        };
    } catch (_e) {}
}

function stripLeadingBom(source = "") {
    return String(source || "").replace(/^\uFEFF/, "");
}

function rewriteModuleSourceToAbsoluteUrls(source = "", moduleUrl = "") {
    const resolvedModuleUrl = String(moduleUrl || "");
    if (!resolvedModuleUrl) return stripLeadingBom(source);
    let rewritten = stripLeadingBom(source);

    rewritten = rewritten.replace(
        /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
        (_match, prefix, specifier, suffix) => `${prefix}${new URL(specifier, resolvedModuleUrl).href}${suffix}`
    );

    rewritten = rewritten.replace(
        /(import\(\s*["'])(\.\.?\/[^"']+)(["']\s*\))/g,
        (_match, prefix, specifier, suffix) => `${prefix}${new URL(specifier, resolvedModuleUrl).href}${suffix}`
    );

    rewritten = rewritten.replace(
        /new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)\.href/g,
        (_match, specifier) => JSON.stringify(new URL(specifier, resolvedModuleUrl).href)
    );

    rewritten = rewritten.replace(
        /new\s+URL\(\s*["'](\.\.?\/[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
        (_match, specifier) => `new URL(${JSON.stringify(new URL(specifier, resolvedModuleUrl).href)})`
    );

    return rewritten;
}

async function importSanitizedBlobModule(moduleUrl) {
    const response = await fetch(moduleUrl, { cache: "no-store" });
    const source = await response.text();
    const rewritten = rewriteModuleSourceToAbsoluteUrls(source, moduleUrl);
    const blob = new Blob([rewritten], { type: "text/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    try {
        return await import(blobUrl);
    } finally {
        try { URL.revokeObjectURL(blobUrl); } catch (_e) {}
    }
}

function loadEasyNodeUI() {
    if (easyNodeUiPromise) return easyNodeUiPromise;
    setRuntimeDiagnostics({
        activeEasyNodeUiUrl: GOYA_EASY_NODE_UI_URL,
        activeEasyNodeUiKind: "easy-standalone",
        entrypoint: "web/index.js -> web/IAMCCS_EasyFullNodeUI.js",
    });

    easyNodeUiPromise = (async () => {
        try {
            let mod = null;
            try {
                mod = await import(GOYA_EASY_NODE_UI_URL);
            } catch (directImportError) {
                console.warn("[IAMCCS Easy] Direct module import failed, attempting sanitized blob fallback", {
                    url: GOYA_EASY_NODE_UI_URL,
                    error: directImportError,
                    stack: directImportError?.stack,
                });
                mod = await importSanitizedBlobModule(GOYA_EASY_NODE_UI_URL);
            }
            console.log("[IAMCCS Easy] Loaded standalone Easy node UI module", GOYA_EASY_NODE_UI_URL);
            debugTrace("[IAMCCS Easy] loaded-node-ui-module", { url: GOYA_EASY_NODE_UI_URL });
            setRuntimeDiagnostics({ loadedVia: mod ? "direct-or-sanitized" : "unknown" });
            return mod?.default || null;
        } catch (error) {
            console.error("[IAMCCS Easy] Failed to load standalone Easy node UI", {
                url: GOYA_EASY_NODE_UI_URL,
                error,
                stack: error?.stack,
            });
            easyNodeUiPromise = null;
            setRuntimeDiagnostics({
                activeEasyNodeUiKind: "failed",
                lastEasyNodeUiError: String(error?.message || error || ""),
            });
            return null;
        }
    })();
    return easyNodeUiPromise;
}

function getGraphNodes() {
    try {
        const graph = app?.graph;
        const nodes = graph?._nodes || graph?.nodes || [];
        return Array.isArray(nodes) ? nodes : [];
    } catch (_e) {
        return [];
    }
}

function isEasyIdentifier(value) {
    const text = String(value || "");
    return GOYA_EASY_NODE_CLASS_NAMES.has(text);
}

function isEasyNode(node) {
    if (!node) return false;
    const values = [
        node.type,
        node.comfyClass,
        node.constructor?.type,
        node.constructor?.comfyClass,
        node.constructor?.nodeData?.name,
        node.nodeData?.name,
    ].map((value) => String(value || ""));
    return values.some(isEasyIdentifier);
}

function isEasyNodeData(nodeData) {
    if (!nodeData) return false;
    const values = [
        nodeData.name,
    ].map((value) => String(value || ""));
    return values.some(isEasyIdentifier);
}

function hasEasyDomWidget(node) {
    try {
        const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
        return widgets.some((widget) => widget?.name === "iamccs_canvas"
            && widget?.element
            && (widget.element.isConnected || document.body?.contains?.(widget.element))
            && (widget.element.dataset?.goyaEasyDomWidget === "1"
                || widget.element.classList?.contains?.("iamccs-node-root")));
    } catch (_e) {
        return false;
    }
}

function normalizeNodeShell(node) {
    if (!node) return;
    try {
        if (isEasyIdentifier(node.type) && node.type !== GOYA_EASY_NODE_CANONICAL_TYPE) {
            node.type = GOYA_EASY_NODE_CANONICAL_TYPE;
        }
        if (!node.title || isEasyIdentifier(node.title)) {
            node.title = "IAMCCS_goyAIcanvas-easy";
        }
        node.resizable = true;
        if (!Array.isArray(node.size) || node.size[0] < 260 || node.size[1] < 180) {
            node.size = [300, 220];
        }
        hideEasyBackendOutputs(node);
        installEasySerializationGuard(node);
        node.setDirtyCanvas?.(true, true);
        node.graph?.setDirtyCanvas?.(true, true);
    } catch (_e) {}
}

function hideEasyBackendOutputs(node) {
    if (!node || !isEasyNode(node)) return;
    try {
        if (Array.isArray(node.outputs) && node.outputs.length) {
            node.__iamccsEasyHiddenOutputs = node.outputs.map((output) => ({ ...(output || {}) }));
            node.outputs = [];
        }
        if (Array.isArray(node.outputs) && node.outputs.length === 0) {
            node.size = Array.isArray(node.size) ? node.size : [300, 220];
        }
    } catch (_e) {}
}

function scrubEasySerializedData(node, data = null) {
    try {
        const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
        const serialized = data && typeof data === "object" ? data : null;
        const values = Array.isArray(serialized?.widgets_values)
            ? serialized.widgets_values
            : (Array.isArray(node?.widgets_values) ? node.widgets_values : null);
        widgets.forEach((widget, index) => {
            const name = String(widget?.name || "");
            const isDomWidget = name === "iamccs_canvas"
                || widget?.element?.dataset?.goyaEasyDomWidget === "1"
                || widget?.element?.classList?.contains?.("iamccs-node-root");
            if (name === "canvas_payload") {
                widget.value = "{}";
                widget.serialize = false;
                widget.options = { ...(widget.options || {}), serialize: false };
                widget.serializeValue = () => undefined;
                if (values && index >= 0) values[index] = "{}";
            }
            if (isDomWidget) {
                widget.value = "";
                widget.serialize = false;
                widget.options = { ...(widget.options || {}), serialize: false };
                widget.serializeValue = () => undefined;
                if (values && index >= 0) values[index] = "";
            }
        });
    } catch (_e) {}
}

function installEasySerializationGuard(node) {
    if (!node || node.__iamccsEasySerializationGuard) return;
    node.__iamccsEasySerializationGuard = true;
    const originalOnSerialize = node.onSerialize;
    node.onSerialize = function (data) {
        const result = originalOnSerialize?.apply(this, arguments);
        scrubEasySerializedData(this, data);
        return result;
    };
    scrubEasySerializedData(node, null);
}

function isNodeUiMounted(node, instance) {
    if (!node || !instance || instance.node !== node) return false;
    const widgets = Array.isArray(node.widgets) ? node.widgets : [];
    const hasWidget = !!instance.domWidget && widgets.includes(instance.domWidget);
    const element = instance.domWidget?.element;
    const isConnected = !!element && (element.isConnected || document.body?.contains?.(element));
    const hasRoot = !!instance.domRoot
        && !!element
        && (element === instance.domRoot
            || element.dataset?.goyaEasyDomWidget === "1"
            || element.classList?.contains?.("iamccs-node-root"));
    return hasWidget && hasRoot && isConnected;
}

function ensureNodeUI(node) {
    if (!node || !isEasyNode(node)) return;
    normalizeNodeShell(node);
    const existing = NODE_OBJECT_INSTANCES.get(node);
    if (isNodeUiMounted(node, existing)) {
        NODE_RETRY_COUNTS.delete(node);
        normalizeNodeShell(node);
        return;
    }
    if (existing) {
        try { existing.destroy?.(); } catch (error) { console.warn("[IAMCCS Easy] Failed to repair stale node UI", error); }
        NODE_OBJECT_INSTANCES.delete(node);
    }
    if (NODE_PENDING_MOUNTS.has(node)) return;
    if (typeof node.addDOMWidget !== "function") {
        scheduleNodeUI(node);
        return;
    }
    NODE_PENDING_MOUNTS.add(node);
    loadEasyNodeUI().then((LoadedNodeUI) => {
        NODE_PENDING_MOUNTS.delete(node);
        const lateExisting = NODE_OBJECT_INSTANCES.get(node);
        if (isNodeUiMounted(node, lateExisting)) return;
        if (lateExisting) {
            try { lateExisting.destroy?.(); } catch (_e) {}
            NODE_OBJECT_INSTANCES.delete(node);
        }
        if (!LoadedNodeUI || typeof node.addDOMWidget !== "function") {
            easyNodeUiPromise = null;
            scheduleNodeUI(node);
            return;
        }
        try {
            const instance = new LoadedNodeUI(node);
            NODE_OBJECT_INSTANCES.set(node, instance);
            NODE_RETRY_COUNTS.delete(node);
            normalizeNodeShell(node);
        } catch (error) {
            NODE_PENDING_MOUNTS.delete(node);
            console.error("[IAMCCS Easy] Failed to init node UI", error);
            scheduleNodeUI(node);
        }
    });
}

function scheduleNodeUI(node) {
    if (!node || !isEasyNode(node)) return;
    const count = Number(NODE_RETRY_COUNTS.get(node) || 0);
    if (count > 30 && hasEasyDomWidget(node)) return;
    NODE_RETRY_COUNTS.set(node, count + 1);
    for (const delay of REMOUNT_DELAYS_MS) {
        window.setTimeout(() => ensureNodeUI(node), delay);
    }
}

function destroyNodeUI(node) {
    const instance = NODE_OBJECT_INSTANCES.get(node);
    if (instance) {
        try { instance.destroy(); } catch (error) { console.warn("[IAMCCS Easy] Failed to destroy node UI", error); }
    }
    NODE_OBJECT_INSTANCES.delete(node);
    NODE_PENDING_MOUNTS.delete(node);
    NODE_RETRY_COUNTS.delete(node);
}

app.registerExtension({
    name: "IAMCCS.goyAIcanvasEasy",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!isEasyNodeData(nodeData)) {
            return;
        }

        const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalOnNodeCreated?.apply(this, arguments);
            try {
                this.resizable = true;
                hideEasyBackendOutputs(this);
            } catch (error) {
                console.warn("[IAMCCS Easy] Unable to mark node resizable", error);
            }
            return result;
        };

        const originalOnAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function () {
            const result = originalOnAdded?.apply(this, arguments);
            scheduleNodeUI(this);
            return result;
        };

        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            const result = originalOnConfigure?.apply(this, arguments);
            scheduleNodeUI(this);
            return result;
        };

        const originalOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            destroyNodeUI(this);
            return originalOnRemoved?.apply(this, arguments);
        };
    },
});






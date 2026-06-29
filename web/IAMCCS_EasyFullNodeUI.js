import EventBus from "./utils/EventBus.js";
import Constants from "./utils/Constants.js";
import CanvasView from "./ui/Canvas.js?v=20260630_EASY_CLEAN_CORE26";
import CanvasToolbar from "./ui/CanvasToolbar.js?v=20260630_EASY_CLEAN_CORE26";
import StatusBar from "./ui/StatusBar.js?v=20260630_EASY_CLEAN_CORE26";
import EasyLayerManager from "./engine/EasyLayerManager.js?v=20260630_EASY_CLEAN_CORE26";
import EasyMaskManager from "./engine/EasyMaskManager.js?v=20260630_EASY_CLEAN_CORE26";
import EasyPromptManager from "./engine/EasyPromptManager.js?v=20260630_EASY_CLEAN_CORE26";
import EasyStateBridge from "./engine/EasyStateBridge.js?v=20260630_EASY_CLEAN_CORE26";
import WorkflowRunner from "./engine/WorkflowRunner.js?v=20260630_EASY_CLEAN_CORE26";
import EasySettingsPanel from "./modes/easy/EasySettingsPanel.js?v=20260630_EASY_CLEAN_CORE26";
import UIHelpers from "./utils/UIHelpers.js";
import ModeSwitchBar from "./modes/ModeSwitchBar.js?v=20260630_EASY_CLEAN_CORE26";
import LayoutRouter from "./modes/LayoutRouter.js?v=20260630_EASY_CLEAN_CORE26";
import { GOYA_BUILD_INFO, getGoyaBuildLabel } from "./app/BuildInfo.js?v=20260630_EASY_CLEAN_CORE26";

const EASY_MODE_CSS_URL = new URL("./styles/easy_mode.css", import.meta.url).href + "?v=20260630_EASY_CLEAN_CORE26";
const NODE_PREVIEW_CSS_URL = new URL("./styles/node_preview.css", import.meta.url).href + "?v=20260630_EASY_CLEAN_CORE26";const EASY_STATE_SCHEMA = "iamccs.goyai.easy.state";
const EASY_STATE_BUILD = "IAMCCS_GoyAIcanvas_EasyFull_AllInOne_State_20260626";
let stylesheetInjected = false;

function ensureStylesheet() {
    if (stylesheetInjected) return;
    for (const href of [EASY_MODE_CSS_URL, NODE_PREVIEW_CSS_URL]) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.append(link);
    }
    stylesheetInjected = true;
}

function _loadImageAsync(dataUrl) {
    return new Promise((resolve, reject) => {
        try {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (e) => reject(e);
            img.src = dataUrl;
            if (img.decode) {
                img.decode().then(() => resolve(img)).catch(() => {});
            }
        } catch (e) {
            reject(e);
        }
    });
}

async function _padDataUrlAsync(dataUrl, targetW, targetH) {
    if (!dataUrl || typeof dataUrl !== "string") return dataUrl;
    const w = Math.max(1, Math.floor(Number(targetW) || 1));
    const h = Math.max(1, Math.floor(Number(targetH) || 1));
    const img = await _loadImageAsync(dataUrl);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
}

async function _resizeDataUrlToCanvasAsync(dataUrl, targetW, targetH, options = {}) {
    if (!dataUrl || typeof dataUrl !== "string") return dataUrl;
    const w = Math.max(1, Math.floor(Number(targetW) || 1));
    const h = Math.max(1, Math.floor(Number(targetH) || 1));
    const keepProportions = options.keepProportions !== false;
    const img = await _loadImageAsync(dataUrl);
    const imgW = Math.max(1, Number(img.naturalWidth || img.width) || w);
    const imgH = Math.max(1, Number(img.naturalHeight || img.height) || h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.clearRect(0, 0, w, h);
    if (keepProportions) {
        const scale = Math.min(w / imgW, h / imgH);
        const drawW = Math.max(1, Math.round(imgW * scale));
        const drawH = Math.max(1, Math.round(imgH * scale));
        const x = Math.round((w - drawW) / 2);
        const y = Math.round((h - drawH) / 2);
        ctx.drawImage(img, x, y, drawW, drawH);
    } else {
        ctx.drawImage(img, 0, 0, w, h);
    }
    return c.toDataURL("image/png");
}

function buildLayout(nodeId) {
    const root = UIHelpers.createElement("div", "goya-root goya-root--embedded", {
        attrs: { "data-node-id": String(nodeId) },
    });

    const topbar = UIHelpers.createElement("header", "goya-topbar");
    const topbarTitle = UIHelpers.createElement("div", "goya-topbar__easy-title", {
        text: "patreon.com/IAMCCS \u00B7 goyAIcanvas EASY",
    });
    const modeSwitchHost = UIHelpers.createElement("div", "mode-switch-bar-host", {
        attrs: { id: `iamccs-mode-switch-${nodeId}` },
    });
    const topbarCenter = UIHelpers.createElement("div", "goya-topbar__center");
    const topbarControls = UIHelpers.createElement("div", "goya-topbar__controls");
    topbar.append(topbarTitle, modeSwitchHost, topbarCenter, topbarControls);

    const workspace = UIHelpers.createElement("div", "goya-workspace");
    const toolbarHost = UIHelpers.createElement("aside", "goya-toolbar", {
        attrs: { id: `iamccs-toolbar-${nodeId}` },
    });
    const canvasArea = UIHelpers.createElement("main", "goya-canvas-area");
    const canvasWrapper = UIHelpers.createElement("div", "goya-canvas-wrapper", {
        attrs: { id: `iamccs-canvas-${nodeId}` },
    });
    const statusHost = UIHelpers.createElement("div", "goya-statusbar", {
        attrs: { id: `iamccs-status-${nodeId}` },
    });
    canvasArea.append(canvasWrapper, statusHost);

    const panelsHost = UIHelpers.createElement("aside", "goya-panels", {
        attrs: { id: `iamccs-panels-${nodeId}` },
    });

    // Side thumbnail navigators (left and right)
        // Side rails with icon buttons
        const leftRail = UIHelpers.createElement("div", "goya-side-rail goya-side-rail--left");
        const rightRail = UIHelpers.createElement("div", "goya-side-rail goya-side-rail--right");
        const makeRail = (railEl, items) => {
            const toggle = UIHelpers.createElement("div", "goya-side-rail__toggle", { text: "Menu" });
            toggle.title = "Mostra/Nascondi";
            let open = true;
            toggle.addEventListener("click", () => {
                open = !open; railEl.classList.toggle("is-collapsed", !open);
            });
            const list = UIHelpers.createElement("div", "goya-side-rail__list");
            items.forEach(({ label, icon }) => {
                const btn = UIHelpers.createElement("button", "goya-side-iconbtn");
                // Inject SVG icon explicitly to avoid textContent overrides
                btn.innerHTML = icon;
                btn.title = label;
                btn.addEventListener("click", () => {
                    try {
                        const headers = Array.from(workspace.querySelectorAll('.goya-panel__header'));
                        const target = headers.find(h => String(h.textContent || '').toLowerCase().includes(label.toLowerCase()));
                        target?.scrollIntoView({ behavior: "smooth", block: "start" });
                    } catch (_e) {}
                });
                list.append(btn);
            });
            railEl.append(toggle, list);
        };
        makeRail(leftRail, [
            { label: "Image", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><rect x=3 y=5 width=18 height=14 rx=2 stroke='currentColor' fill='none'/><circle cx=9 cy=11 r=2 stroke='currentColor' fill='currentColor'/><path d='M3 17l5-5 4 3 4-4 5 6' stroke='currentColor' fill='none' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>" },
            { label: "DRAW", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><path d='M3 21v-3l11-11 3 3-11 11H3' stroke='currentColor' fill='none' stroke-width='2'/><path d='M14 7l3-3 3 3-3 3' stroke='currentColor' fill='none' stroke-width='2'/></svg>" },
            { label: "Lasso", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><path d='M12 4c5 0 8 2 8 5s-3 5-8 5-8-2-8-5 3-5 8-5Z' stroke='currentColor' fill='none' stroke-width='2'/><path d='M12 14v6' stroke='currentColor' stroke-width='2'/></svg>" },
            { label: "Vector", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><path d='M5 3h4l2 4 4 2 4 8-6-2-2-4-4-2-2-6Z' stroke='currentColor' fill='none' stroke-width='2' stroke-linejoin='round'/></svg>" },
            { label: "Text", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><path d='M4 6V4h16v2h-6v14h-4V6H4Z' stroke='currentColor' fill='none' stroke-width='2'/></svg>" },
            { label: "Imagining", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><circle cx=12 cy=12 r=3 stroke='currentColor' fill='none' stroke-width='2'/><path d='M12 2v3M12 19v3M4.2 7l2.1 1.2M17.7 15.8l2.1 1.2M4.2 17l2.1-1.2M17.7 8.2l2.1-1.2' stroke='currentColor' stroke-width='2' stroke-linecap='round'/></svg>" },
            { label: "Film", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><rect x=3 y=5 width=18 height=14 rx=2 stroke='currentColor' fill='none' stroke-width='2'/><path d='M8 5v14M16 5v14' stroke='currentColor' stroke-width='2'/><circle cx=7 cy=9 r=1 fill='currentColor'/><circle cx=7 cy=13 r=1 fill='currentColor'/><circle cx=17 cy=9 r=1 fill='currentColor'/><circle cx=17 cy=13 r=1 fill='currentColor'/></svg>" },
        ]);
        makeRail(rightRail, [
            { label: "Layers", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><path d='M12 3l9 5-9 5-9-5 9-5Z' stroke='currentColor' fill='none' stroke-width='2'/><path d='M3 13l9 5 9-5' stroke='currentColor' fill='none' stroke-width='2'/><path d='M6 16l6 3 6-3' stroke='currentColor' fill='none' stroke-width='2'/></svg>" },
            { label: "Color", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><circle cx=12 cy=12 r=8 stroke='currentColor' fill='none' stroke-width='2'/><path d='M12 4a8 8 0 0 1 8 8' stroke='currentColor' stroke-width='2'/></svg>" },
            { label: "Gallery", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><rect x=3 y=5 width=18 height=14 rx=2 stroke='currentColor' fill='none'/><path d='M3 17l5-5 4 3 4-4 5 6' stroke='currentColor' fill='none' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>" },
            { label: "Global Prompt", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><path d='M12 3a9 9 0 1 0 9 9' stroke='currentColor' fill='none' stroke-width='2'/><path d='M2.6 9h18.8M4 15h12' stroke='currentColor' stroke-width='2'/></svg>" },
            { label: "Sampling Module", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><circle cx=12 cy=12 r=9 stroke='currentColor' fill='none' stroke-width='2'/><path d='M12 3v9l6 6' stroke='currentColor' stroke-width='2' stroke-linecap='round'/></svg>" },
            { label: "Save / Export", icon: "<svg width=14 height=14 viewBox='0 0 24 24'><path d='M5 20h14V4H5v16Z' stroke='currentColor' fill='none' stroke-width='2'/><path d='M9 8h6M12 12v4' stroke='currentColor' fill='currentColor'/></svg>" },
        ]);

        // Append columns; place both rails as workspace siblings so positioning can use grid edges
        workspace.append(toolbarHost, canvasArea, panelsHost, leftRail, rightRail);

    const footer = UIHelpers.createElement("footer", "goya-footer", {
        attrs: { id: `iamccs-footer-${nodeId}` },
        text: "GOYAICANVAS, multi visual editor AI motorized by Carmine Critallo Scalzi",
    });

    root.append(topbar, workspace, footer);

    return {
        root,
        topbar,
        workspace,
        toolbarHost,
        canvasArea,
        canvasWrapper,
        panelsHost,
        topbarTitle,
        topbarCenter,
        topbarControls,
        modeSwitchHost,
        statusHost,
        footer,
        leftRail,
        rightRail,
    };
}

export default class IAMCCS_EasyFullNodeUI {
    constructor(node) {
        ensureStylesheet();
        this.node = node;
        this.domRoot = null;
        this.domWidget = null;
        this.unsubscribe = [];
        this.drawOnly = Boolean(this._widgetValue("draw_only", false));
        this.qwenEnabled = false;
        this._hydrating = false;
        this._hydratedFromBackend = false;
        this._ignoreImportedResizeUntil = 0;
    this.canvasWidth = Constants.CANVAS_WIDTH;
    this.canvasHeight = Constants.CANVAS_HEIGHT;
    this.editorOpen = false;
    this.hasUnsavedChanges = false;
    this._easyProjectId = `goya_easy_${this.node?.id ?? "node"}_${Date.now()}`;
    this._easyLastCompositeDataUrl = "";
    this._easyOutpaintSourcePrepared = false;

        this._hidePayloadWidget();
        this._createDomWidget();
        this._clearEditorOpenState();
        this._applyEasyPreviewBranding();
        // DO NOT call _initApp() here - it's called by _openEditor() after auth
    }

    destroy() {
        try { this.easySettingsPanel?.destroy?.(); } catch (_e) {}
        while (this.unsubscribe.length) {
            const dispose = this.unsubscribe.pop();
            try {
                dispose?.();
            } catch (err) {
                console.warn("[IAMCCS] Failed to dispose listener", err);
            }
        }
        this._removeOwnDomWidget();
        if (this.domRoot && this.domRoot.parentElement) {
            this.domRoot.parentElement.removeChild(this.domRoot);
        }
        this.domRoot = null;
        this.domWidget = null;
    }

    _getLogoCandidates() {
        const candidates = [];
        candidates.push("/iamccs/goyai_easy_static/assets/goyaicanvas.png");
        candidates.push("/extensions/IAMCCS_goyAIcanvas-easy/assets/goyaicanvas.png");
        try {
            if (!String(import.meta.url || "").startsWith("blob:")) {
                candidates.push(new URL("./assets/goyaicanvas.png", import.meta.url).href);
            }
        } catch (_e) {}
        candidates.push("/custom_nodes/IAMCCS_goyAIcanvas-easy/web/assets/goyaicanvas.png");
        return [...new Set(candidates.filter(Boolean))];
    }

    _createDomWidget() {
        this._removeStaleDomWidgets();

        // Phase 1: Create compact preview widget with logo
        this.domRoot = document.createElement("div");
        this.domRoot.className = "iamccs-node-root";
        this.domRoot.dataset.goyaEasyDomWidget = "1";
        
        // Use PNG logo from web/assets (served by ComfyUI)
        const logoCandidates = this._getLogoCandidates();
        const logoPath = logoCandidates[0] || "";
        console.log("[IAMCCS Preview] Logo path:", logoPath);
        console.log("[IAMCCS Preview] import.meta.url:", import.meta.url);
        
        this.previewRoot = document.createElement("div");
        this.previewRoot.className = "iamccs-node-preview";
        
        // Create img element with error handling
        const imgElement = document.createElement("img");
        imgElement.className = "iamccs-logo";
        imgElement.alt = "Goya Canvas";
        imgElement.src = logoPath;
        
        imgElement.onload = () => {
            console.log("[IAMCCS Preview] OK Image loaded successfully:", logoPath);
        };
        
        imgElement.onerror = (e) => {
            logoCandidates.shift();
            const nextPath = logoCandidates[0];
            if (nextPath) {
                imgElement.src = nextPath;
                return;
            }
            console.error("[IAMCCS Preview] ERROR Image failed to load:", logoPath);
            console.error("[IAMCCS Preview] Error details:", e);
            // Add visible error message
            imgElement.style.display = "none";
            const errorDiv = document.createElement("div");
            errorDiv.style.cssText = "color: #ff6464; font-size: 12px; text-align: center; padding: 20px;";
            errorDiv.innerHTML = `<strong>Image not found</strong><br><small>${logoPath}</small>`;
            imgElement.parentElement?.appendChild(errorDiv);
        };
        
        const container = document.createElement("div");
        container.className = "iamccs-logo-container";
        container.appendChild(imgElement);
        
        const hint = document.createElement("div");
        hint.className = "iamccs-open-hint";
        hint.textContent = "Click to open editor";
        container.appendChild(hint);

        this.previewRoot.appendChild(container);
        
        this.domRoot.appendChild(this.previewRoot);
        
        // Click handler to open editor
        this.previewRoot.addEventListener("click", () => this._openEditor());
        
        const createdWidget = this.node.addDOMWidget("iamccs_canvas", "widget", this.domRoot, {
            serialize: false,
            hideOnZoom: false,
        });
        this.domWidget = createdWidget || this.node.widgets?.[this.node.widgets.length - 1];
        
        if (this.domWidget) {
            this.domWidget.serialize = false;
            this.domWidget.value = "";
            this.domWidget.options = { ...(this.domWidget.options || {}), serialize: false };
            this.domWidget.serializeValue = () => undefined;
            this.domWidget.computeSize = () => [280, 200]; // Box shape (16:9-ish)
        }
        
        // Set node to box shape initially
        if (Array.isArray(this.node.size)) {
            this.node.size = [300, 220]; // Wide box
        }
        
        // No aspect ratio lock - allow any resize
        const originalOnResize = this.node.onResize;
        this.node.onResize = (size) => {
            if (originalOnResize) {
                originalOnResize.call(this.node, size);
            }
        };

        try {
            this.node.setDirtyCanvas?.(true, true);
            this.node.graph?.setDirtyCanvas?.(true, true);
        } catch (_e) {}
    }

    _removeStaleDomWidgets() {
        try {
            if (!Array.isArray(this.node?.widgets)) return;
            for (let i = this.node.widgets.length - 1; i >= 0; i -= 1) {
                const widget = this.node.widgets[i];
                const isEasyWidget = widget?.name === "iamccs_canvas"
                    || widget?.element?.dataset?.goyaEasyDomWidget === "1"
                    || widget?.element?.classList?.contains?.("iamccs-node-root");
                if (!isEasyWidget) {
                    continue;
                }
                try { widget.element?.remove?.(); } catch (_e) {}
                this.node.widgets.splice(i, 1);
            }
        } catch (_e) {}
    }

    _removeOwnDomWidget() {
        try {
            const widgets = Array.isArray(this.node?.widgets) ? this.node.widgets : [];
            const index = widgets.indexOf(this.domWidget);
            if (index >= 0) {
                widgets.splice(index, 1);
            }
            try { this.domWidget?.element?.remove?.(); } catch (_e) {}
        } catch (_e) {}
    }

    async _openEditorGoyaBase() {
        if (this.editorOpen) return;
        
        // Phase 3: Check auth (with dev mode bypass)
        const authRequired = await this._checkAuthRequired();
        if (authRequired) {
            const authenticated = await this._showLoginDialog();
            if (!authenticated) return;
        }
        
        // Phase 2: Open fullscreen dialog
        this.editorDialog = document.createElement("dialog");
        this.editorDialog.className = "iamccs-editor-dialog";
        
        const logoPath = this._getLogoCandidates()[0] || "";
        console.log("[IAMCCS Editor] Logo path:", logoPath);
        
        this.editorDialog.innerHTML = `
            <div class="iamccs-editor-container">
                <header class="iamccs-editor-header">
                    <div class="iamccs-editor-title">
                        <img src="${logoPath}" alt="Goya Canvas" />
                        <span>patreon.com/IAMCCS &middot; goyAIcanvas EASY</span>
                    </div>
                    <div class="iamccs-editor-center-actions" aria-label="Easy editor actions"></div>
                    <div class="iamccs-editor-actions">
                        <button class="iamccs-dialog-btn iamccs-dialog-btn--close">Close</button>
                    </div>
                </header>
                <div class="iamccs-editor-body"></div>
            </div>
        `;
        
        document.body.appendChild(this.editorDialog);

        try {
            const headerLogo = this.editorDialog.querySelector(".iamccs-editor-title img");
            if (headerLogo) {
                const logoCandidates = this._getLogoCandidates();
                headerLogo.onerror = () => {
                    logoCandidates.shift();
                    const nextPath = logoCandidates[0];
                    if (nextPath) {
                        headerLogo.src = nextPath;
                    }
                };
            }
        } catch (_e) {}
        
        const bodyContainer = this.editorDialog.querySelector(".iamccs-editor-body");
        const closeBtn = this.editorDialog.querySelector(".iamccs-dialog-btn--close");
        
        closeBtn.addEventListener("click", () => this._closeEditor());
        
        // Initialize full app inside dialog
        this._initApp(bodyContainer);
        this._hydrateFromWidget();
        this._hydrateFromBackendIfWidgetIsCompact();
        this._persistState();
        
        this.editorDialog.showModal();
        this.editorOpen = true;
        this._setEditorOpenState(true);
        
        // Handle Escape key
        this.editorDialog.addEventListener("cancel", (e) => {
            e.preventDefault();
            this._closeEditor();
        });
    }

    async _closeEditor() {
        if (this.hasUnsavedChanges) {
            const shouldSave = await this._confirmSaveChanges();
            if (shouldSave === null) return; // User cancelled
            if (shouldSave) {
                this._pushPayload();
            }
        }
        
        if (this.editorDialog) {
            this._prepareEditorForRemoval();
            try { this.editorDialog.close(); } catch (_e) {}
            try { this.editorDialog.remove(); } catch (_e) {}
            this.editorDialog = null;
        }
        
        this._disposeEditorRuntime();
        this.editorOpen = false;
        this.hasUnsavedChanges = false;
        this._setEditorOpenState(false);
        try { this.node?.setDirtyCanvas?.(true, true); } catch (_e) {}
    }

    _prepareEditorForRemoval() {
        try {
            this.eventBus?.emit?.("ui:editor:close", { source: "easy-dialog-close" });
        } catch (_e) {}

        try {
            this.layout?.root?.classList?.add("goya-root--editor-closing");
            this.editorDialog?.classList?.add("iamccs-editor-dialog--closing");
            const editorBody = this.editorDialog?.querySelector?.(".iamccs-editor-body");
            if (editorBody) {
                editorBody.style.visibility = "hidden";
                editorBody.style.opacity = "0";
                editorBody.replaceChildren();
            }
            if (this.editorDialog) {
                this.editorDialog.style.visibility = "hidden";
                this.editorDialog.style.opacity = "0";
                this.editorDialog.style.pointerEvents = "none";
                // Force a style flush so Chromium drops the composited canvas layer before removal.
                void this.editorDialog.offsetHeight;
            }
        } catch (_e) {}
    }

    _disposeEditorRuntime() {
        try { this.easySettingsPanel?.destroy?.(); } catch (_e) {}
        this.easySettingsPanel = null;

        while (this.unsubscribe.length) {
            const dispose = this.unsubscribe.pop();
            try {
                dispose?.();
            } catch (err) {
                console.warn("[IAMCCS] Failed to dispose editor listener", err);
            }
        }

        try { this.layout?.root?.remove?.(); } catch (_e) {}
        this.layout = null;
        this.canvasView = null;
        this.gimpToolKernel = null;
        this.layoutRouter = null;
        this.modeSwitchBar = null;
        this.workflowRunner = null;
        this.bridge = null;
        this.promptManager = null;
        this.maskManager = null;
        this.toolController = null;
        this.commandBus = null;
        this.eventBus = null;
        this.layerManager = null;
    }

    async _confirmSaveChanges() {
        return new Promise((resolve) => {
            const confirmDialog = document.createElement("dialog");
            confirmDialog.className = "iamccs-confirm-dialog";
            
            confirmDialog.innerHTML = `
                <div class="iamccs-confirm-header">
                    <h3 class="iamccs-confirm-title">Unsaved Changes</h3>
                </div>
                <div class="iamccs-confirm-body">
                    <p class="iamccs-confirm-message">You have unsaved changes. Do you want to save them before closing?</p>
                </div>
                <div class="iamccs-confirm-footer">
                    <button class="iamccs-confirm-btn iamccs-confirm-btn--cancel">Cancel</button>
                    <button class="iamccs-confirm-btn iamccs-confirm-btn--discard">Discard</button>
                    <button class="iamccs-confirm-btn iamccs-confirm-btn--save">Save</button>
                </div>
            `;
            
            document.body.appendChild(confirmDialog);
            
            const cancelBtn = confirmDialog.querySelector(".iamccs-confirm-btn--cancel");
            const discardBtn = confirmDialog.querySelector(".iamccs-confirm-btn--discard");
            const saveBtn = confirmDialog.querySelector(".iamccs-confirm-btn--save");
            
            const cleanup = () => {
                confirmDialog.close();
                confirmDialog.remove();
            };
            
            cancelBtn.addEventListener("click", () => {
                cleanup();
                resolve(null); // Cancel close
            });
            
            discardBtn.addEventListener("click", () => {
                cleanup();
                resolve(false); // Don't save
            });
            
            saveBtn.addEventListener("click", () => {
                cleanup();
                resolve(true); // Save
            });
            
            confirmDialog.showModal();
        });
    }

    async _checkAuthRequired() {
        try {
            return false;
        } catch (err) {
            console.warn("[IAMCCS Easy] Auth bypass check failed:", err);
            return false;
        }
    }

    async _showLoginDialog() {
        return new Promise((resolve) => {
            const loginDialog = document.createElement("dialog");
            loginDialog.className = "iamccs-login-dialog";
            
            const logoPath = new URL("./assets/goyaicanvas.png", import.meta.url).href;
            console.log("[IAMCCS Login] Logo path:", logoPath);
            
            loginDialog.innerHTML = `
                <div class="iamccs-login-header">
                    <img src="${logoPath}" class="iamccs-login-logo" alt="Goya Canvas" />
                    <h2 class="iamccs-login-title">Welcome to Goya Canvas</h2>
                    <p class="iamccs-login-subtitle">Please sign in to continue</p>
                </div>
                <div class="iamccs-login-body">
                    <form class="iamccs-login-form">
                        <div class="iamccs-form-group">
                            <label class="iamccs-form-label" for="goya-username">Username</label>
                            <input type="text" id="goya-username" class="iamccs-form-input" required />
                        </div>
                        <div class="iamccs-form-group">
                            <label class="iamccs-form-label" for="goya-password">Password</label>
                            <input type="password" id="goya-password" class="iamccs-form-input" required />
                        </div>
                        <div class="iamccs-login-error">Invalid credentials. Please try again.</div>
                    </form>
                </div>
                <div class="iamccs-login-footer">
                    <button type="submit" class="iamccs-login-btn">Sign In</button>
                </div>
            `;
            
            document.body.appendChild(loginDialog);
            
            const form = loginDialog.querySelector(".iamccs-login-form");
            const loginBtn = loginDialog.querySelector(".iamccs-login-btn");
            const errorDiv = loginDialog.querySelector(".iamccs-login-error");
            const usernameInput = loginDialog.querySelector("#goya-username");
            const passwordInput = loginDialog.querySelector("#goya-password");
            
            const cleanup = () => {
                loginDialog.close();
                loginDialog.remove();
            };
            
            const handleSubmit = async (e) => {
                e.preventDefault();
                
                const username = usernameInput.value.trim();
                const password = passwordInput.value;
                
                if (!username || !password) return;
                
                loginBtn.disabled = true;
                errorDiv.classList.remove("iamccs-login-error--visible");
                
                try {
                    const response = await fetch(easyApiUrl("auth/login"), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ username, password })
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        this.authToken = data.token;
                        this.authExpiry = Date.now() + (24 * 60 * 60 * 1000); // 24h
                        
                        // Store token locally
                        try {
                            localStorage.setItem("goya:authToken", this.authToken);
                            localStorage.setItem("goya:authExpiry", String(this.authExpiry));
                        } catch (_e) {}
                        
                        cleanup();
                        resolve(true);
                    } else {
                        errorDiv.classList.add("iamccs-login-error--visible");
                        loginBtn.disabled = false;
                    }
                } catch (err) {
                    console.error("[IAMCCS] Login failed:", err);
                    errorDiv.classList.add("iamccs-login-error--visible");
                    loginBtn.disabled = false;
                }
            };
            
            form.addEventListener("submit", handleSubmit);
            loginBtn.addEventListener("click", handleSubmit);
            
            // Allow closing dialog without auth (returns false)
            loginDialog.addEventListener("cancel", (e) => {
                cleanup();
                resolve(false);
            });
            
            loginDialog.showModal();
            usernameInput.focus();
        });
    }

    _initAppGoyaBase(containerOverride = null) {
        const layout = buildLayout(this.node.id);
        this.layout = layout;
        // Wrap UI inside .iamccs-node-ui container with max-width and centering
        const container = document.createElement("div");
        container.className = "iamccs-node-ui";
        container.append(layout.root);
        
        // Append to dialog body if provided, otherwise to node widget
        const targetContainer = containerOverride || this.domRoot;
        targetContainer.append(container);

        this.eventBus = new EventBus();
        this.layerManager = new EasyLayerManager(this.eventBus, { width: this.canvasWidth, height: this.canvasHeight });
        this.maskManager = new EasyMaskManager(this.eventBus, this.layerManager);
        this.toolController = {
            setTool: (tool) => this.eventBus.emit("tool:change", tool),
            getActiveTool: () => this.maskManager?.activeTool || "cursor",
        };
        this.promptManager = new EasyPromptManager(this.eventBus);
        this.bridge = new EasyStateBridge(this.eventBus);
        this.commandBus = null;
        this.gimpToolKernel = null;
        this.workflowRunner = new WorkflowRunner(this.eventBus, this.bridge, this.layerManager, this.promptManager, this.maskManager);
        this.unsubscribe.push(
            this.eventBus.on("canvas:import:files", (payload = {}) => this._handleEasyCanvasImportFiles(payload))
        );

        const initialMode = "easy";
        try {
            window.__IAMCCS_RUNTIME_DIAGNOSTICS__ = {
                ...(window.__IAMCCS_RUNTIME_DIAGNOSTICS__ || {}),
                activeBootstrap: "IAMCCS_EasyFullNodeUI",
                buildInfo: GOYA_BUILD_INFO,
                buildLabel: getGoyaBuildLabel(),
                initialMode,
            };
        } catch (_e) {}

        this.modeSwitchBar = new ModeSwitchBar(layout.modeSwitchHost, this.eventBus, initialMode);
        this.canvasView = new CanvasView(layout.canvasWrapper, this.eventBus, this.layerManager, this.maskManager);
        this.canvasToolbar = new CanvasToolbar(layout.topbarControls, this.eventBus, this.layerManager, this.bridge, this.workflowRunner);
        new StatusBar(layout.statusHost, this.eventBus, this.canvasView, this.layerManager, this.promptManager);

        layout.footer.textContent = "goyAIcanvas EASY";

    this.layerManager.bootstrapDefaultLayers();
    this.canvasView.resize(this.canvasWidth, this.canvasHeight);
        this.eventBus.emit("layer:select", this.layerManager.getActiveLayerId());

        this._attachEventHandlers();
        this._attachWorkflowHooks();
        this._attachWidgetBindings();

        // Layout router (scoped to this node instance)
        this.layoutRouter = new LayoutRouter(this.eventBus, {
            layerManager: this.layerManager,
            maskManager: this.maskManager,
            toolController: this.toolController,
            promptManager: this.promptManager,
            qwenBridge: null,
            workflowRunner: this.workflowRunner,
            commandBus: null,
            canvasView: this.canvasView,
            gimpToolKernel: null,
            canvasWrapper: layout.canvasWrapper,
            canvasArea: layout.canvasArea,
            toolbarHost: layout.toolbarHost,
            panelsHost: layout.panelsHost,
            workspace: layout.workspace,
            root: layout.root,
            leftRail: layout.leftRail,
            rightRail: layout.rightRail,
        }, { scope: layout.root, easyOnly: true });

        this._registerCoreCommands();

        // Persist mode changes
        try {
            this.eventBus.on('mode:changed', (data) => {
                const mode = String(data?.mode || '').trim();
                if (!mode) return;                try { localStorage.setItem('goya:lastMode', mode); } catch (_e) {}
            });
        } catch (_e) {}

        // Ensure restored mode is mounted
        try { this.layoutRouter.switchMode("easy"); } catch (_e) {}

        try {
            this.easySettingsPanel = new EasySettingsPanel(
                this.eventBus,
                { workflowRunner: this.workflowRunner },
                layout.root
            );
        } catch (error) {
            console.error('[IAMCCS] EasySettingsPanel init failed', error);
            this.easySettingsPanel = null;
        }
    }

    _attachEventHandlers() {
        const logCanvasSizeEvent = (source, payload = {}, extra = {}) => {
            try {
                console.log("[IAMCCS][CanvasSize]", {
                    source,
                    payload,
                    canvasWidth: this.canvasWidth,
                    canvasHeight: this.canvasHeight,
                    viewWidth: Number(this.canvasView?.canvas?.width) || 0,
                    viewHeight: Number(this.canvasView?.canvas?.height) || 0,
                    ignoreImportedResizeUntil: this._ignoreImportedResizeUntil || 0,
                    ...extra,
                });
            } catch (_e) {}
        };
        this.unsubscribe.push(
            this.eventBus.on("layers:changed", () => this._persistState())
        );
        this.unsubscribe.push(
            this.eventBus.on("prompt:global:changed", () => this._persistState())
        );
        this.unsubscribe.push(
            this.eventBus.on("prompt:layer:changed", () => this._persistState())
        );
        this.unsubscribe.push(
            this.eventBus.on("canvas:stroke:finished", () => this._persistState())
        );
        this.unsubscribe.push(
            this.eventBus.on("canvas:transform:end", () => this._persistState())
        );
        this.unsubscribe.push(
            this.eventBus.on("workflow:queued", (payload) => this._handleWorkflowQueued(payload))
        );

        // Project clear: reset to fresh state
        this.unsubscribe.push(
            this.eventBus.on("project:clear", async (payload = {}) => {
                try {
                    const defaultWidth = Number(Constants.CANVAS_WIDTH) || 1024;
                    const defaultHeight = Number(Constants.CANVAS_HEIGHT) || 1024;
                    const clearSource = String(payload?.source || "");
                    this._ignoreImportedResizeUntil = clearSource === "easy-final-image" ? 0 : Date.now() + 1500;
                    this._easyLastCompositeDataUrl = "";
                    this._easyOutpaintSourcePrepared = false;
                    logCanvasSizeEvent("project:clear:start", { width: defaultWidth, height: defaultHeight });
                    this.canvasWidth = defaultWidth;
                    this.canvasHeight = defaultHeight;
                    if (this.workflowRunner) {
                        this.workflowRunner.canvasWidth = defaultWidth;
                        this.workflowRunner.canvasHeight = defaultHeight;
                    }
                    // Reset layer stack to background-only
                    this.layerManager.bootstrapDefaultLayers();
                    // Reset prompts
                    this.eventBus.emit("prompt:global:update", { positive: "", negative: "", strength: 1, guidance: 1, cfg: 1, applyToAll: false });
                    // Reset mask/ui toggles and tool state
                    this.eventBus.emit("mask:overlay", { enabled: false });
                    this.eventBus.emit("mask:paintMode", { enabled: false });
                    this.eventBus.emit("canvas:selection:clear");
                    this.eventBus.emit("tool:change", "pencil");
                    // Reset actual canvas dimensions to the default project size
                    this.canvasView.resize(defaultWidth, defaultHeight);
                    this.eventBus.emit("canvas:refresh", {});
                    // Push fresh payload to backend widget
                    this._pushPayload();
                    logCanvasSizeEvent("project:clear:end", { width: defaultWidth, height: defaultHeight });
                } catch (e) {
                    console.warn("[IAMCCS] Clear project failed", e);
                }
            })
        );

        this.unsubscribe.push(
            this.eventBus.on("canvas:mode", (payload) => this._handleDrawOnly(payload))
        );
        this.unsubscribe.push(
            this.eventBus.on("project:hydrate", (payload) => {
                logCanvasSizeEvent("project:hydrate", {
                    width: payload?.width,
                    height: payload?.height,
                }, {
                    layerCount: Array.isArray(payload?.layers) ? payload.layers.length : 0,
                });
                this._hydrating = true;
                if (payload?.width && payload?.height) {
                    this.canvasWidth = payload.width;
                    this.canvasHeight = payload.height;
                    this.canvasView.resize(payload.width, payload.height);
                }
                this.layerManager.hydrate(payload);
                if (payload?.prompts?.global) {
                    this.eventBus.emit("prompt:global:update", payload.prompts.global);
                }
                this._hydrating = false;
                this._persistState();
            })
        );
        this.unsubscribe.push(
            this.eventBus.on("canvas:resize:request", async (payload) => {
                if (!payload) return;
                logCanvasSizeEvent("canvas:resize:request", payload);
                const prevW = Number(this.canvasWidth) || 0;
                const prevH = Number(this.canvasHeight) || 0;
                const w = Number(payload.width) || this.canvasWidth;
                const h = Number(payload.height) || this.canvasHeight;
                const resizeImage = !!payload.resizeImage;
                const keepProportions = payload.keepProportions !== false;
                const hasVisibleBitmap = (this.layerManager?.getLayers?.() || []).some((layer) => (
                    layer?.id !== "layer_background"
                    && layer?.visible !== false
                    && typeof layer?.bitmap === "string"
                    && layer.bitmap.startsWith("data:image/")
                ));
                let resizedComposite = "";
                if (resizeImage && hasVisibleBitmap && Number.isFinite(prevW) && Number.isFinite(prevH) && prevW > 0 && prevH > 0 && (w !== prevW || h !== prevH)) {
                    try {
                        const composite = this.canvasView?.exportComposite?.();
                        if (typeof composite === "string" && composite.startsWith("data:image/")) {
                            resizedComposite = await _resizeDataUrlToCanvasAsync(composite, w, h, { keepProportions });
                        }
                    } catch (error) {
                        console.warn("[IAMCCS Easy] Failed to prepare proportional resize image", error);
                        resizedComposite = "";
                    }
                }
                this.canvasWidth = w;
                this.canvasHeight = h;

                // Keep WorkflowRunner generation dimensions in sync with the visible canvas.
                // Without this, generation/state payloads can keep stale width/height until some
                // other param changes, making it look like Advanced resize didn't apply.
                try {
                    if (this.workflowRunner) {
                        this.workflowRunner.canvasWidth = w;
                        this.workflowRunner.canvasHeight = h;
                    }
                } catch (_e) {}

                this.canvasView.resize(w, h);
                if (resizedComposite) {
                    this._replaceCanvasWithDataUrlLayer(resizedComposite, keepProportions ? "Resized Image" : "Stretched Image", {
                        easyResize: {
                            keepProportions,
                            from: { width: prevW, height: prevH },
                            to: { width: w, height: h },
                        },
                    });
                }

                // IMPORTANT: Canvas resize must be non-destructive.
                // Do NOT pad/crop layer bitmaps/masks to the new canvas size here, otherwise
                // downsizing the canvas permanently deletes pixels (e.g. 4K import -> 1K canvas).
                // The user can explicitly resample via "Fit Image" when desired.
                try {
                    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && (w !== prevW || h !== prevH)) {
                        if (this._getEasyOutpaintState().enabled) {
                            this._easyOutpaintSourcePrepared = true;
                        }

                        // Force a render and persist. Renderer will scale/transform as needed.
                        this.eventBus.emit("layers:changed", this.layerManager.getLayers());

                        // Push state immediately so backend + workflow runs use the new dimensions.
                        this.eventBus.emit("workflow:params:changed", { immediate: true });

                        // Refresh composite preview chips/monitors that depend on size.
                        this.eventBus.emit("canvas:export:composite");
                    }
                } catch (_e) {}

                this._persistState();
            })
        );

        // Keep embedded node widget payload width/height in sync with actual canvas.
        // CanvasView.resize() emits `canvas:resize`, but NodeUI previously only listened to
        // `canvas:resize:request`, causing the workflow widget `canvas_payload` to keep the
        // old size during prompt execution (backend composite then stretches).
        this.unsubscribe.push(
            this.eventBus.on("canvas:resize", (payload) => {
                try {
                    if (!payload) return;
                    logCanvasSizeEvent("canvas:resize", payload);
                    const w = Number(payload.width);
                    const h = Number(payload.height);
                    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;

                    const changed = (w !== this.canvasWidth || h !== this.canvasHeight);
                    this.canvasWidth = w;
                    this.canvasHeight = h;

                    // Mirror into WorkflowRunner so buildPayload() always reflects the actual canvas.
                    try {
                        if (this.workflowRunner) {
                            this.workflowRunner.canvasWidth = w;
                            this.workflowRunner.canvasHeight = h;
                        }
                    } catch (_e) {}

                    // If resize was triggered externally (e.g., backend state pull), ensure
                    // the view surface is also updated. Guard against loops.
                    try {
                        const curW = Number(this.canvasView?.canvas?.width);
                        const curH = Number(this.canvasView?.canvas?.height);
                        if (Number.isFinite(curW) && Number.isFinite(curH) && (curW !== w || curH !== h)) {
                            this.canvasView.resize(w, h);
                        }
                    } catch (_e) {}

                    if (changed) {
                        console.log("[IAMCCS] Synced node canvas size from canvas:resize", { w, h });
                        if (this._getEasyOutpaintState().enabled) {
                            this._easyOutpaintSourcePrepared = true;
                        }
                        this._persistState();
                    }
                } catch (e) {
                    console.warn("[IAMCCS] canvas:resize sync failed", e);
                }
            })
        );
        // Resize canvas to the exact resolution of the imported image
        this.unsubscribe.push(
            this.eventBus.on("canvas:image:imported", (payload) => {
                try {
                    if (Date.now() < this._ignoreImportedResizeUntil) {
                        logCanvasSizeEvent("canvas:image:imported:ignored", payload, { now: Date.now() });
                        return;
                    }
                    logCanvasSizeEvent("canvas:image:imported", payload);
                    const w = Number(payload?.originalWidth);
                    const h = Number(payload?.originalHeight);
                    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                        this.canvasWidth = w; this.canvasHeight = h;
                        this.canvasView.resize(w, h);
                        this._easyLastCompositeDataUrl = "";
                        this._easyOutpaintSourcePrepared = false;
                        // Ask for a composite refresh so the left chip shows the true image
                        this.eventBus.emit("canvas:export:composite");
                        this._persistState();
                    }
                } catch (e) {
                    console.warn("[IAMCCS] Failed to resize canvas on image import", e);
                }
            })
        );

        this.unsubscribe.push(
            this.eventBus.on("canvas:export:composite:ready", (payload = {}) => {
                try {
                    if (typeof payload.data === "string" && payload.data.startsWith("data:image/")) {
                        this._easyLastCompositeDataUrl = payload.data;
                        this._syncEasyState();
                    }
                } catch (_e) {}
            })
        );
        this.unsubscribe.push(
            this.eventBus.on("canvas:export:png", () => this._downloadEasyComposite("png"))
        );
        this.unsubscribe.push(
            this.eventBus.on("canvas:export:jpg", () => this._downloadEasyComposite("jpg"))
        );
        this.unsubscribe.push(
            this.eventBus.on("canvas:export:save", ({ format } = {}) => this._downloadEasyComposite(format || "png"))
        );

    }

    async _handleEasyCanvasImportFiles(payload = {}) {
        if (!payload || payload.__easyImportHandled) return;
        payload.__easyImportHandled = true;
        const files = Array.from(payload?.files || []).filter(Boolean);
        const file = files.find((entry) => String(entry?.type || "").startsWith("image/")) || files[0];
        if (!file) return;
        try {
            console.log("[GoyaEasyImport] import requested", {
                name: file.name || "image",
                type: file.type || "",
                size: file.size || 0,
                source: payload?.source || "easy-import",
                replace: payload?.replace !== false,
            });
            const dataUrl = await this._readImageFileAsDataUrl(file);
            const info = await this._decodeImageSize(dataUrl);
            const sourceCanvas = this._makeCanvasFromDecodedImage(info.image, info.width, info.height);
            const shouldReplace = payload?.replace !== false;
            if (shouldReplace) {
                this.layerManager?.bootstrapDefaultLayers?.({ reset: true });
            }
            const layer = this._importDataUrlAsNewLayer(dataUrl, file.name || "Imported Image", {
                source: {
                    type: "import",
                    name: file.name || "image",
                    mode: payload?.source || "easy-import",
                },
                originalWidth: info.width,
                originalHeight: info.height,
                easyRole: "import",
            });
            if (!layer) throw new Error("Layer creation failed");
            this.canvasWidth = info.width;
            this.canvasHeight = info.height;
            if (this.workflowRunner) {
                this.workflowRunner.canvasWidth = info.width;
                this.workflowRunner.canvasHeight = info.height;
            }
            this.canvasView?.resize?.(info.width, info.height);
            try {
                this.canvasView?.renderer?._updateBitmapLayerFromDataUrl?.(layer.id, dataUrl, sourceCanvas);
                this.canvasView?.renderer?._syncImageCache?.(this.layerManager?.getLayers?.() || []);
                this.canvasView?.renderer?._requestRender?.();
            } catch (renderError) {
                console.warn("[GoyaEasyImport] renderer cache update failed", renderError);
            }
            this.layerManager?.selectLayer?.(layer.id);
            setTimeout(() => {
                try {
                    this.canvasView?.renderer?._syncImageCache?.(this.layerManager?.getLayers?.() || []);
                    this.canvasView?.renderer?._requestRender?.();
                } catch (_e) {}
            }, 0);
            this.eventBus.emit("canvas:image:imported", {
                originalWidth: info.width,
                originalHeight: info.height,
                layerId: layer.id,
                name: file.name || null,
                source: payload?.source || "easy-import",
            });
            this.eventBus.emit("canvas:refresh", { reason: "easy-import" });
            this.eventBus.emit("canvas:export:composite", { reason: "easy-import" });
            this.eventBus.emit("workflow:params:changed", { immediate: true });
            this.eventBus.emit("status:message", `Imported ${file.name || "image"} (${info.width}x${info.height})`);
            console.log("[GoyaEasyImport] import applied", { layerId: layer.id, width: info.width, height: info.height });
            this._persistState();
        } catch (error) {
            console.error("[GoyaEasyImport] import failed", error);
            this.eventBus.emit("status:message", `Import failed: ${error?.message || error}`);
        }
    }

    _readImageFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
            reader.readAsDataURL(file);
        });
    }

    _readTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
            reader.readAsText(file, "utf-8");
        });
    }

    _buildEasyProjectFile() {
        const prompt = this.promptManager?.getGlobalPrompt?.() || {};
        const canvasWidth = Number(this.canvasView?.canvas?.width || this.canvasWidth || Constants.CANVAS_WIDTH);
        const canvasHeight = Number(this.canvasView?.canvas?.height || this.canvasHeight || Constants.CANVAS_HEIGHT);
        const clone = (value) => {
            try { return JSON.parse(JSON.stringify(value)); } catch (_e) { return value; }
        };
        return {
            schema: "iamccs.goyai.easy.project",
            version: 1,
            build: EASY_STATE_BUILD,
            name: "goyai_easy_project",
            saved_at: new Date().toISOString(),
            canvas: {
                width: canvasWidth,
                height: canvasHeight,
                transform: this._getEasyCanvasTransform?.() || {},
            },
            prompts: {
                global: {
                    positive: String(prompt.positive || ""),
                    negative: String(prompt.negative || ""),
                    strength: Number(prompt.strength ?? 1) || 1,
                    guidance: Number(prompt.guidance ?? 1) || 1,
                    cfg: Number(prompt.cfg ?? 1) || 1,
                    applyToAll: !!prompt.applyToAll,
                },
            },
            layers: clone(this.layerManager?.getLayers?.() || []),
            activeLayerId: this.layerManager?.getActiveLayerId?.() || null,
            easy_state: this.getEasyState?.() || null,
        };
    }

    _downloadEasyProject() {
        try {
            const project = this._buildEasyProjectFile();
            const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `goyai_easy_project_${Date.now()}.goya`;
            document.body.append(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.eventBus?.emit?.("status:message", "Easy project saved");
        } catch (error) {
            console.warn("[IAMCCS Easy] Project save failed", error);
            this.eventBus?.emit?.("status:message", `Project save failed: ${error?.message || error}`);
        }
    }

    async _importEasyProjectFile(file) {
        try {
            const text = await this._readTextFile(file);
            const project = JSON.parse(text);
            const canvas = project?.canvas || {};
            const width = Math.max(1, Math.round(Number(canvas.width || project.width || Constants.CANVAS_WIDTH)));
            const height = Math.max(1, Math.round(Number(canvas.height || project.height || Constants.CANVAS_HEIGHT)));
            this.canvasWidth = width;
            this.canvasHeight = height;
            if (this.workflowRunner) {
                this.workflowRunner.canvasWidth = width;
                this.workflowRunner.canvasHeight = height;
                this.workflowRunner.easyCanvasWidth = width;
                this.workflowRunner.easyCanvasHeight = height;
            }
            this.canvasView?.resize?.(width, height);
            this.eventBus.emit("canvas:resize", { width, height, source: "easy-project-import" });
            this.layerManager?.hydrate?.({
                layers: Array.isArray(project.layers) ? project.layers : [],
                activeLayerId: project.activeLayerId || project.selected_layer_id || project.active_layer || null,
            });
            const global = project?.prompts?.global || project?.easy_state || {};
            this.eventBus.emit("prompt:global:update", {
                positive: String(global.positive || global.prompt || ""),
                negative: String(global.negative || global.negativePrompt || global.negative_prompt || ""),
                strength: global.strength,
                guidance: global.guidance,
                cfg: global.cfg,
                applyToAll: !!global.applyToAll,
                source: "easy-project-import",
            });
            this.eventBus.emit("easy:prompt:update", {
                prompt: String(global.positive || global.prompt || ""),
                negativePrompt: String(global.negative || global.negativePrompt || global.negative_prompt || ""),
            });
            this.canvasView?.renderer?._syncImageCache?.(this.layerManager?.getLayers?.() || []);
            this.eventBus.emit("canvas:refresh", { reason: "easy-project-import" });
            this.eventBus.emit("canvas:export:composite", { reason: "easy-project-import" });
            this.eventBus.emit("workflow:params:changed", { immediate: true });
            this.eventBus.emit("status:message", `Imported project ${file?.name || ""}`.trim());
            this._persistState();
        } catch (error) {
            console.warn("[IAMCCS Easy] Project import failed", error);
            this.eventBus?.emit?.("status:message", `Project import failed: ${error?.message || error}`);
        }
    }

    _decodeImageSize(dataUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const width = Number(image.naturalWidth || image.width || 0);
                const height = Number(image.naturalHeight || image.height || 0);
                if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
                    reject(new Error("Unable to read imported image dimensions"));
                    return;
                }
                resolve({ width, height, image });
            };
            image.onerror = () => reject(new Error("Unable to decode imported image"));
            image.src = dataUrl;
        });
    }

    _makeCanvasFromDecodedImage(image, width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width || image?.naturalWidth || image?.width || 1));
        canvas.height = Math.max(1, Math.round(height || image?.naturalHeight || image?.height || 1));
        const ctx = canvas.getContext("2d", { desynchronized: true });
        if (!ctx || !image) return canvas;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas;
    }


    _registerCoreCommands() {
        if (!this.commandBus || this._coreCommandsRegistered) return;
        this._coreCommandsRegistered = true;

        this.commandBus.register('mode.switch', async ({ mode, target_mode } = {}) => {
            const nextMode = String(mode || target_mode || '').trim();
            if (!nextMode) {
                return { mode: this.layoutRouter?.currentMode || null };
            }

            this._switchMode(nextMode);
            return { mode: nextMode };
        }, { description: 'Switch the active GoyAIcanvas mode.' });

        this.commandBus.register('workflow.execute', async (payload = {}) => {
            this.eventBus.emit('workflow:execute', payload || {});
            return { emitted: true };
        }, { description: 'Request a workflow execution through the shared event bus.' });

        this._promptCommandUnsubscribers = registerPromptCommands(this.commandBus, {
            eventBus: this.eventBus,
            promptManager: this.promptManager,
            layerManager: this.layerManager,
        });

        this._modeActionCommandUnsubscribers = registerModeActionCommands(this.commandBus, {
            layoutRouter: this.layoutRouter,
            eventBus: this.eventBus,
        });
    }

    _switchModeGoyaBase(mode) {
        try {
            const m = String(mode || '').trim();
            if (!m) return;
            // Keep ModeSwitchBar visual state consistent.
            if (this.modeSwitchBar && typeof this.modeSwitchBar.switchMode === 'function') {
                this.modeSwitchBar.switchMode(m);
            } else {
                this.eventBus.emit('ui:mode:change', { mode: m });
            }
        } catch (e) {
            console.warn('[IAMCCS] _switchMode failed', e);
        }
    }

    _importDataUrlAsNewLayer(dataUrl, name, meta = {}) {
        const url = String(dataUrl || '');

        if (!url) return null;

        const label = String(name || 'Imported Frame').trim() || 'Imported Frame';
        const layer = this.layerManager.addLayer(label);
        if (!layer) return null;

        this.layerManager.selectLayer(layer.id);
        this.layerManager.snapshot();

        const applyBitmap = (bitmapUrl) => {
            const patch = {
                bitmap: bitmapUrl,
                visible: true,
                opacity: 1,
                blend_mode: 'normal',
                metadata: Object.assign({}, meta),
            };
            this.layerManager.updateLayer({ id: layer.id, patch });
        };

        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
            applyBitmap(url);
        } else {
            return null;
        }
        return layer;
    }

    _replaceCanvasWithDataUrlLayer(dataUrl, name, meta = {}) {
        if (!dataUrl || typeof dataUrl !== "string") return null;
        try {
            this.layerManager?.bootstrapDefaultLayers?.({ reset: true });
            try { this.canvasView?.renderer?.imageCache?.clear?.(); } catch (_e) {}
            const layer = this._importDataUrlAsNewLayer(dataUrl, name || "Resized Image", {
                ...(meta || {}),
                source: {
                    type: "easy-resize",
                    ...(meta?.source || {}),
                },
            });
            if (layer) {
                try { this.canvasView?.renderer?._updateBitmapLayerFromDataUrl?.(layer.id, dataUrl); } catch (_e) {}
                try { this.layerManager?.selectLayer?.(layer.id); } catch (_e) {}
            }
            this.eventBus.emit("canvas:refresh", {});
            this.eventBus.emit("workflow:params:changed", { immediate: true });
            return layer;
        } catch (error) {
            console.warn("[IAMCCS Easy] Failed to replace canvas image after resize", error);
            return null;
        }
    }

    _attachWorkflowHooks() {
        const originalSetSeed = this.workflowRunner.setSeed.bind(this.workflowRunner);
        this.workflowRunner.setSeed = (value) => {
            originalSetSeed(value);
            this._persistState();
        };

        const originalSetSteps = this.workflowRunner.setSteps.bind(this.workflowRunner);
        this.workflowRunner.setSteps = (value) => {
            originalSetSteps(value);
            this._persistState();
        };

        const originalSetCfg = this.workflowRunner.setCfg.bind(this.workflowRunner);
        this.workflowRunner.setCfg = (value) => {
            originalSetCfg(value);
            this._persistState();
        };

    }

    _attachWidgetBindings() {
        this.drawOnlyWidget = this._findWidget("draw_only");
        this.triggerWidget = this._findWidget("trigger");

        if (this.drawOnlyWidget) {
            const baseCallback = this.drawOnlyWidget.callback;
            this.drawOnlyWidget.callback = (...args) => {
                baseCallback?.apply(this.drawOnlyWidget, args);
                this.eventBus.emit("canvas:mode", { drawOnly: !!this.drawOnlyWidget.value });
            };
            this.drawOnly = !!this.drawOnlyWidget.value;
        }

        this.eventBus.emit("canvas:mode", { drawOnly: this.drawOnly });
    }

    async _handleWorkflowQueued(payload) {
        // The runner already pushed backend state before emitting workflow:queued.
        // Reuse the same payload here so we do not race a second backend sync.
        this._persistState({ payloadOverride: payload, skipBackendSync: true });
        // Bump trigger to mark node dirty
        if (this.triggerWidget) {
            const current = Number(this.triggerWidget.value) || 0;
            const next = (current + 1) % 2147483647;
            this.triggerWidget.value = next;
            this.triggerWidget.callback?.(next);
        }
        this.node?.setDirtyCanvas?.(true);
        if (this._isDirectPromptQueuedPayload(payload)) {
            return;
        }
        // Enqueue prompt through ComfyUI app
        await this._queuePrompt();
    }

    _isDirectPromptQueuedPayload(payload = {}) {
        const extra = payload && typeof payload === "object" ? (payload.extra || {}) : {};
        return Boolean(
            payload?.directPromptQueued
            || payload?.easyStandalone
            || extra?.direct_prompt_queued
            || extra?.easy_standalone
        );
    }

    _handleDrawOnly(payload) {
        if (!payload || typeof payload.drawOnly !== "boolean") {
            return;
        }
        this.drawOnly = payload.drawOnly;
        this._setEasyBackgroundColor(this.drawOnly ? "#ffffff" : "#101318", this.drawOnly ? "easy-draw-mode" : "easy-mode-neutral");
        if (this.drawOnlyWidget && this.drawOnlyWidget.value !== this.drawOnly) {
            this.drawOnlyWidget.value = this.drawOnly;
        }
        this.node?.setDirtyCanvas?.(true);
        this._persistState();
    }

    _setEasyBackgroundColor(color, source = "easy-background") {
        const value = String(color || "#101318").trim();
        const layer = this.layerManager?.getLayerById?.("layer_background");
        if (!layer) return;
        this.layerManager.updateLayer?.({
            id: "layer_background",
            patch: {
                metadata: {
                    ...(layer.metadata || {}),
                    backgroundColor: value,
                    easyRole: "background",
                },
            },
        });
        this.eventBus?.emit?.("background:color:update", { color: value, source });
        this.eventBus?.emit?.("canvas:render:request", { source });
    }

    async _downloadEasyComposite(format = "png") {
        const normalized = String(format || "png").toLowerCase() === "jpg" ? "jpg" : "png";
        try {
            let dataUrl = this.canvasView?.exportComposite?.() || "";
            if (normalized === "jpg" && dataUrl.startsWith("data:image/")) {
                const img = await _loadImageAsync(dataUrl);
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Number(img.naturalWidth || img.width) || Number(this.canvasWidth) || 1024);
                canvas.height = Math.max(1, Number(img.naturalHeight || img.height) || Number(this.canvasHeight) || 1024);
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                dataUrl = canvas.toDataURL("image/jpeg", 0.92);
            }
            if (!dataUrl.startsWith("data:image/")) return;
            const link = document.createElement("a");
            link.href = dataUrl;
            link.download = `goyai_easy_${Date.now()}.${normalized === "jpg" ? "jpg" : "png"}`;
            document.body.append(link);
            link.click();
            link.remove();
            this.eventBus?.emit?.("status:message", `Exported ${normalized.toUpperCase()}`);
        } catch (error) {
            console.warn("[IAMCCS Easy] Export failed", error);
            this.eventBus?.emit?.("status:message", `Export failed: ${error?.message || error}`);
        }
    }

    _hydrateFromWidget() {
        const payload = this._widgetValue("canvas_payload", "");
        if (!payload) {
            this._hydrateFromEasyStateWidget();
            return;
        }
        try {
            const parsed = JSON.parse(payload);
            this._hydrating = true;
            if (parsed?.width && parsed?.height) {
                this.canvasWidth = parsed.width;
                this.canvasHeight = parsed.height;
                this.canvasView.resize(parsed.width, parsed.height);
            }
            this.eventBus.emit("project:hydrate", parsed);
            if (typeof parsed.draw_only === "boolean") {
                this.eventBus.emit("canvas:mode", { drawOnly: parsed.draw_only });
            }
            if (typeof parsed.seed === "number") {
                this.workflowRunner.setSeed(parsed.seed);
            }
            if (typeof parsed.steps === "number") {
                this.workflowRunner.setSteps(parsed.steps);
            }
            if (typeof parsed.global_cfg === "number") {
                this.workflowRunner.setCfg(parsed.global_cfg);
            }
            if (typeof parsed.pencil_mode === "boolean") {
                this.eventBus.emit("input:pencil", { enabled: parsed.pencil_mode });
            }
        } catch (error) {
            console.warn("[IAMCCS] Failed to hydrate canvas payload", error);
        } finally {
            this._hydrating = false;
        }
    }

    _hydrateFromEasyStateWidget() {
        const state = this._readEasyStateWidget();
        if (!state || state.schema !== EASY_STATE_SCHEMA) {
            return;
        }
        try {
            this._hydrating = true;
            const width = Number(state.canvas?.width || state.width || 0);
            const height = Number(state.canvas?.height || state.height || 0);
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
                this.canvasWidth = width;
                this.canvasHeight = height;
                this.canvasView?.resize?.(width, height);
            }
            if (state.prompt || state.negative_prompt) {
                this.eventBus?.emit?.("prompt:global:update", {
                    positive: String(state.prompt || ""),
                    negative: String(state.negative_prompt || ""),
                });
            }
            if (state.source_image_b64 && !this._easyLastCompositeDataUrl) {
                this._easyLastCompositeDataUrl = state.source_image_b64;
            }
            this._easyOutpaintSourcePrepared = !!state.outpaint?.source_is_prepared;
        } catch (error) {
            console.warn("[IAMCCS Easy] Failed to hydrate goya_easy_state", error);
        } finally {
            this._hydrating = false;
        }
    }

    async _hydrateFromBackendIfWidgetIsCompact() {
        // If the workflow-embedded widget payload is compact (no bitmaps), try to rehydrate
        // from the backend state cache (which receives full layer bitmaps via bridge.pushState).
        if (this._hydratedFromBackend) return;
        let parsed = null;
        try {
            const raw = this._widgetValue("canvas_payload", "");
            parsed = raw ? JSON.parse(raw) : null;
        } catch (_e) {
            parsed = null;
        }

        const widgetHasBitmaps = (() => {
            try {
                const layers = parsed?.layers;
                if (!Array.isArray(layers) || !layers.length) return false;
                return layers.some((l) => typeof l?.bitmap === "string" && l.bitmap.length > 64);
            } catch (_e) {
                return false;
            }
        })();
        if (widgetHasBitmaps) return;

        try {
            const backend = await this.bridge.pullState();
            const backendHasBitmaps = (() => {
                try {
                    const layers = backend?.layers;
                    if (!Array.isArray(layers) || !layers.length) return false;
                    return layers.some((l) => typeof l?.bitmap === "string" && l.bitmap.length > 64);
                } catch (_e) {
                    return false;
                }
            })();
            if (backend && backendHasBitmaps) {
                this._hydratedFromBackend = true;
                this.eventBus.emit("project:hydrate", backend);
            }
        } catch (e) {
            console.warn("[IAMCCS] Backend hydrate skipped", e);
        }
    }

    _persistState(options = {}) {
        if (this._hydrating) {
            return;
        }
        const payload = options.payloadOverride || this._buildPayload();
        this._neutralizeLegacyPayloadWidget();
        
        // Mark as having unsaved changes (for dialog close confirmation)
        if (this.editorOpen) {
            this.hasUnsavedChanges = true;
        }

        try {
            const backendPayload = options.backendPayload || this.workflowRunner?.buildPayload?.();
            this._syncEasyState({ payload, backendPayload });
            if (!options.skipBackendSync && backendPayload && this.bridge?.pushState) {
                this.bridge.pushState(backendPayload).catch((error) => {
                    console.warn("[IAMCCS] Failed to sync backend state", error);
                });
            }
        } catch (error) {
            console.warn("[IAMCCS] Failed building backend state payload", error);
        }
    }

    _editorOpenStorageKey() {
        return `goya:editorOpen:${this.node?.id ?? 'unknown'}`;
    }

    _clearEditorOpenState() {
        try {
            localStorage.removeItem(this._editorOpenStorageKey());
        } catch (_e) {}
    }

    _setEditorOpenState(isOpen) {
        try {
            if (isOpen) {
                localStorage.removeItem(this._editorOpenStorageKey());
            } else {
                localStorage.setItem(this._editorOpenStorageKey(), '0');
            }
        } catch (_e) {}
    }

    _restoreEditorOpenState() {
        this._clearEditorOpenState();
    }

    _installEasyTopbarActions() {
        const host = this.editorDialog?.querySelector?.(".iamccs-editor-center-actions")
            || this.layout?.topbarCenter
            || this.layout?.topbarControls;
        const easyTitle = this.layout?.topbarTitle || this.editorDialog?.querySelector?.(".goya-topbar__easy-title");
        if (easyTitle) easyTitle.textContent = "patreon.com/IAMCCS \u00B7 goyAIcanvas EASY";
        if (!host || host.__easyActionsInstalled) {
            return;
        }
        host.__easyActionsInstalled = true;
        host.classList.remove("hidden");
        host.classList.add("goya-topbar__controls--easy-actions");
        host.innerHTML = "";

        const oldControls = this.layout?.topbarControls;
        if (oldControls && oldControls !== host) {
            oldControls.__easyActionsInstalled = false;
            oldControls.classList.remove("goya-topbar__controls--easy-actions");
            oldControls.classList.add("goya-topbar__controls--easy-empty");
            oldControls.innerHTML = "";
        }
        const oldCenter = this.layout?.topbarCenter;
        if (oldCenter && oldCenter !== host) {
            oldCenter.__easyActionsInstalled = false;
            oldCenter.classList.remove("goya-topbar__controls--easy-actions");
            oldCenter.innerHTML = "";
        }

        const makeButton = (label, action, title = label) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "goya-easy-topbar-btn";
            button.dataset.easyAction = action;
            button.title = title;
            button.textContent = label;
            host.append(button);
            return button;
        };

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = "image/*";
        fileInput.hidden = true;
        fileInput.addEventListener("change", () => {
            const files = Array.from(fileInput.files || []);
            if (files.length) {
                this.eventBus?.emit?.("canvas:import:files", {
                    files,
                    replace: true,
                    source: "easy-topbar-file",
                    __easyImportHandled: false,
                });
            }
            fileInput.value = "";
        });
        host.append(fileInput);

        const projectInput = document.createElement("input");
        projectInput.type = "file";
        projectInput.accept = ".goya,application/json";
        projectInput.hidden = true;
        projectInput.addEventListener("change", async () => {
            const file = Array.from(projectInput.files || [])[0];
            if (file) await this._importEasyProjectFile(file);
            projectInput.value = "";
        });
        host.append(projectInput);

        const fileMenu = document.createElement("div");
        fileMenu.className = "goya-easy-file-menu";
        const fileButton = document.createElement("button");
        fileButton.type = "button";
        fileButton.className = "goya-easy-topbar-btn";
        fileButton.dataset.easyAction = "file";
        fileButton.title = "File actions";
        fileButton.textContent = "File";
        const fileDropdown = document.createElement("div");
        fileDropdown.className = "goya-easy-file-menu__menu hidden";
        fileDropdown.innerHTML = `
            <button type="button" class="goya-easy-file-menu__item" data-file-action="import-image">Import Image</button>
            <button type="button" class="goya-easy-file-menu__item" data-file-action="save-project">Save Project</button>
            <button type="button" class="goya-easy-file-menu__item" data-file-action="import-project">Import Project</button>
            <button type="button" class="goya-easy-file-menu__item" data-file-action="export-png">Export Image PNG</button>
            <button type="button" class="goya-easy-file-menu__item" data-file-action="export-jpg">Export Image JPG</button>
        `;
        fileMenu.append(fileButton, fileDropdown);
        host.append(fileMenu);
        const settingsButton = makeButton("Settings", "settings", "Easy workflow model settings");
        const compareButton = makeButton("Compare", "compare", "Compare generated result with the source");

        const closeFileMenu = () => {
            fileDropdown.classList.add("hidden");
            fileButton.classList.remove("is-active");
        };
        fileButton.addEventListener("click", (event) => {
            event.stopPropagation();
            const opening = fileDropdown.classList.contains("hidden");
            fileDropdown.classList.toggle("hidden", !opening);
            fileButton.classList.toggle("is-active", opening);
        });
        fileDropdown.addEventListener("click", async (event) => {
            const item = event.target.closest("[data-file-action]");
            if (!item) return;
            event.preventDefault();
            event.stopPropagation();
            const action = item.dataset.fileAction;
            closeFileMenu();
            if (action === "import-image") fileInput.click();
            if (action === "save-project") this._downloadEasyProject();
            if (action === "import-project") projectInput.click();
            if (action === "export-png") this._downloadEasyComposite("png");
            if (action === "export-jpg") this._downloadEasyComposite("jpg");
        });
        document.addEventListener("click", closeFileMenu, { capture: true });

        settingsButton.addEventListener("click", () => {
            this.eventBus?.emit?.("easy:settings:open", { source: "topbar" });
        });

        compareButton.addEventListener("click", () => {
            this._easyCompareEnabled = !this._easyCompareEnabled;
            compareButton.classList.toggle("is-active", !!this._easyCompareEnabled);
            this.eventBus?.emit?.("compare:toggle", { enabled: !!this._easyCompareEnabled, source: "easy-topbar" });
        });

        try {
            this.unsubscribe.push(this.eventBus.on("workflow:final", () => {
                if (!this._easyCompareEnabled) return;
                compareButton.classList.add("is-active");
                this.eventBus?.emit?.("compare:toggle", { enabled: true, source: "easy-topbar:result-ready" });
            }));
        } catch (_e) {}
    }


    _enforceEasyRootMode() {
        try {
            if (this.modeSwitchBar && typeof this.modeSwitchBar.switchMode === "function" && !this.modeSwitchBar.__easyWrapped) {
                const originalModeSwitch = this.modeSwitchBar.switchMode.bind(this.modeSwitchBar);
                this.modeSwitchBar.switchMode = () => originalModeSwitch("easy");
                this.modeSwitchBar.__easyWrapped = true;
            }

            if (this.layoutRouter && typeof this.layoutRouter.switchMode === "function" && !this.layoutRouter.__easyWrapped) {
                const originalLayoutSwitch = this.layoutRouter.switchMode.bind(this.layoutRouter);
                this.layoutRouter.switchMode = () => originalLayoutSwitch("easy");
                this.layoutRouter.__easyWrapped = true;
            }

            this.layout?.modeSwitchHost?.classList?.add("hidden");
            this.layout?.topbar?.classList?.add("goya-topbar--easy-clean");
            this.modeSwitchBar?.container?.classList?.add("hidden");
            this._installEasyTopbarActions();
            this.layoutRouter?.switchMode?.("easy");
        } catch (_e) {}
    }

    _applyEasyPreviewBranding() {
        try {
            const hint = this.previewRoot?.querySelector?.(".iamccs-open-hint");
            if (hint) hint.textContent = "Click to open EASY editor";
        } catch (_e) {}
    }

    _initApp(containerOverride = null) {
        let hadStoredMode = false;
        let previousMode = null;
        try {
            hadStoredMode = localStorage.getItem("goya:lastMode") !== null;
            previousMode = localStorage.getItem("goya:lastMode");
            localStorage.setItem("goya:lastMode", "easy");
        } catch (_e) {}

        this._initAppGoyaBase(containerOverride);

        try {
            if (hadStoredMode) localStorage.setItem("goya:lastMode", previousMode || "advanced");
            else localStorage.removeItem("goya:lastMode");
        } catch (_e) {}

        this._enforceEasyRootMode();
    }

    async _openEditor() {
        await this._openEditorGoyaBase();
        try {
            const title = this.editorDialog?.querySelector?.(".iamccs-editor-title span");
            if (title) title.textContent = "patreon.com/IAMCCS \u00B7 goyAIcanvas EASY";
        } catch (_e) {}
        this._enforceEasyRootMode();
    }

    _switchMode(_mode) {
        return this._switchModeGoyaBase("easy");
    }

    _pushPayload() {
        // Explicitly push state to backend and mark as saved
        this._persistState();
        this.hasUnsavedChanges = false;
    }

    _readEasyStateWidget() {
        try {
            const raw = this._widgetValue("goya_easy_state", "");
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === "object" ? parsed : null;
        } catch (_e) {
            return null;
        }
    }

    _compactEasyStateForWorkflow(state) {
        const compact = JSON.parse(JSON.stringify(state || {}));
        ["source_image_b64", "mask_b64", "sketch_b64"].forEach((key) => {
            if (typeof compact[key] === "string" && compact[key].length > 0) {
                compact[key] = "";
            }
        });
        compact.workflow_state_compact = true;
        compact.workflow_state_note = "Large bitmap fields stay in runtime/output files, not in the ComfyUI workflow draft.";
        return compact;
    }
    _writeEasyStateWidget(state) {
        const widget = this._findWidget("goya_easy_state");
        if (!widget || !state) {
            return;
        }
        widget.value = JSON.stringify(this._compactEasyStateForWorkflow(state));
        try { widget.callback?.(widget.value); } catch (_e) {}
        this.node?.setDirtyCanvas?.(true, true);
    }

    _neutralizeLegacyPayloadWidget() {
        const widget = this._findWidget("canvas_payload");
        if (!widget) {
            return;
        }
        try {
            widget.value = "{}";
            widget.serialize = false;
            widget.options = { ...(widget.options || {}), serialize: false };
            widget.serializeValue = () => undefined;
            widget.computeSize = () => [0, 0];
            widget.hidden = true;
        } catch (_e) {}
    }

    _syncEasyState(options = {}) {
        try {
            const payload = options.payload || this._buildPayload();
            const backendPayload = options.backendPayload || null;
            const state = this.getEasyState({ payload, backendPayload });
            this._writeEasyStateWidget(state);
            return state;
        } catch (error) {
            console.warn("[IAMCCS Easy] Failed to sync goya_easy_state", error);
            return null;
        }
    }

    getEasyState(options = {}) {
        const payload = options.payload || this._buildPayload();
        const backendPayload = options.backendPayload || {};
        const global = this.promptManager?.getGlobalPrompt?.() || {};
        const outpaint = this._getEasyOutpaintState();
        const sourceImage = this._getEasySourceImage({ payload, backendPayload, outpaint });
        const maskImage = this._getEasyMaskImage();
        const sketchImage = this._getEasySketchImage();
        const now = new Date().toISOString();
        const prior = this._readEasyStateWidget() || {};
        const projectId = prior.project_id || this._easyProjectId;
        this._easyProjectId = projectId;

        return {
            schema: EASY_STATE_SCHEMA,
            build: EASY_STATE_BUILD,
            compatibility_version: 1,
            project_id: projectId,
            project_name: prior.project_name || "goyai_easy_project",
            operation: this._getEasyOperation(payload, backendPayload),
            workflow_mode: this._getEasyOperation(payload, backendPayload),
            prompt: String(global.positive ?? payload.global_positive ?? backendPayload.positive ?? ""),
            negative_prompt: String(global.negative ?? payload.global_negative ?? backendPayload.negative ?? ""),
            source_image_b64: sourceImage.dataUrl || "",
            source_image_ref: sourceImage.ref || null,
            source_image_path: sourceImage.path || null,
            mask_b64: maskImage || "",
            sketch_b64: sketchImage || "",
            crop: this._getEasyCropState(payload),
            outpaint,
            canvas: {
                width: Number(payload.width || this.canvasWidth || Constants.CANVAS_WIDTH),
                height: Number(payload.height || this.canvasHeight || Constants.CANVAS_HEIGHT),
                transform: this._getEasyCanvasTransform(),
            },
            transform: this._getEasyCanvasTransform(),
            layers: this._getEasyLayerManifest(),
            selected_layer_id: this.layerManager?.getActiveLayerId?.() || null,
            selected_tool: this.maskManager?.activeTool || this.maskManager?.toolState?.tool || "cursor",
            backend_mode: this._getEasyOperation(payload, backendPayload),
            backend_settings: this._getEasyBackendSettings(backendPayload),
            model_settings: this._getEasyBackendSettings(backendPayload),
            gallery: Array.isArray(prior.gallery) ? prior.gallery : [],
            external_editor: prior.external_editor || {},
            timestamps: {
                created_at: prior.timestamps?.created_at || now,
                updated_at: now,
            },
            truth: "GoyAIcanvas Easy full-style UI publishes the all-in-one hidden state.",
        };
    }

    setEasyState(state = {}) {
        if (!state || typeof state !== "object") {
            return;
        }
        this._writeEasyStateWidget({
            ...state,
            schema: EASY_STATE_SCHEMA,
            build: state.build || EASY_STATE_BUILD,
        });
        this._hydrateFromEasyStateWidget();
    }

    _getEasyLayerManifest() {
        const layers = this.layerManager?.getLayers?.() || [];
        return layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            visible: layer.visible !== false,
            blend_mode: layer.blend_mode || "normal",
            opacity: Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1,
            locked: !!layer.locked,
            role: layer.metadata?.easyRole || layer.metadata?.role || null,
            has_bitmap: typeof layer.bitmap === "string" && layer.bitmap.length > 32,
            has_mask: typeof layer.mask === "string" && layer.mask.length > 32,
            transform: layer.metadata?.transform || {},
            prompt: layer.prompt ? { ...layer.prompt } : {},
        }));
    }

    _getEasySourceImage({ payload = {}, backendPayload = {}, outpaint = null } = {}) {
        const prepared = !!(outpaint && outpaint.source_is_prepared);
        const layers = this.layerManager?.getLayers?.() || [];
        const activeId = this.layerManager?.getActiveLayerId?.();
        const candidates = [
            layers.find((layer) => layer.id === activeId && layer.bitmap),
            ...layers.filter((layer) => layer.visible !== false && layer.id !== "layer_background" && layer.bitmap),
            ...layers.filter((layer) => layer.bitmap),
        ].filter(Boolean);

        if (!prepared) {
            const layer = candidates.find((candidate) => typeof candidate.bitmap === "string" && candidate.bitmap.startsWith("data:image/"));
            if (layer) {
                return { dataUrl: layer.bitmap, ref: { type: "layer", id: layer.id, name: layer.name }, path: null };
            }
        }

        const extra = backendPayload?.extra || payload?.extra || {};
        for (const key of ["source_image", "composite_image", "init_image"]) {
            const value = extra?.[key];
            if (typeof value === "string" && value.startsWith("data:image/")) {
                return { dataUrl: value, ref: { type: "workflow_extra", key }, path: null };
            }
        }

        if (this._easyLastCompositeDataUrl) {
            return { dataUrl: this._easyLastCompositeDataUrl, ref: { type: "canvas_composite_cache" }, path: null };
        }

        try {
            const composite = this.canvasView?.exportComposite?.();
            if (typeof composite === "string" && composite.startsWith("data:image/")) {
                this._easyLastCompositeDataUrl = composite;
                return { dataUrl: composite, ref: { type: "canvas_composite" }, path: null };
            }
        } catch (_e) {}

        const fallbackLayer = candidates.find((candidate) => typeof candidate.bitmap === "string" && candidate.bitmap.startsWith("data:image/"));
        if (fallbackLayer) {
            return { dataUrl: fallbackLayer.bitmap, ref: { type: "layer", id: fallbackLayer.id, name: fallbackLayer.name }, path: null };
        }
        return { dataUrl: "", ref: null, path: null };
    }

    _getEasyMaskImage() {
        const layers = this.layerManager?.getLayers?.() || [];
        const activeId = this.layerManager?.getActiveLayerId?.();
        const active = layers.find((layer) => layer.id === activeId && typeof layer.mask === "string" && layer.mask.startsWith("data:image/"));
        if (active) return active.mask;
        const masked = layers.find((layer) => typeof layer.mask === "string" && layer.mask.startsWith("data:image/"));
        if (masked) return masked.mask;
        const stack = this.maskManager?.exportMaskStack?.() || [];
        const first = stack.find((entry) => typeof entry?.mask === "string" && entry.mask.startsWith("data:image/"));
        return first?.mask || "";
    }

    _getEasySketchImage() {
        const layers = this.layerManager?.getLayers?.() || [];
        const sketch = layers.find((layer) => {
            const role = String(layer.metadata?.easyRole || layer.metadata?.role || layer.name || "").toLowerCase();
            return role.includes("sketch") && typeof layer.bitmap === "string" && layer.bitmap.startsWith("data:image/");
        });
        return sketch?.bitmap || "";
    }

    _getEasyOutpaintState() {
        const runner = this.workflowRunner || {};
        const left = Math.max(0, Number(runner.fl2oLeft ?? 0) || 0);
        const top = Math.max(0, Number(runner.fl2oTop ?? 0) || 0);
        const right = Math.max(0, Number(runner.fl2oRight ?? 0) || 0);
        const bottom = Math.max(0, Number(runner.fl2oBottom ?? 0) || 0);
        const enabled = left + top + right + bottom > 0;
        const width = Number(this.canvasWidth || this.canvasView?.canvas?.width || Constants.CANVAS_WIDTH);
        const height = Number(this.canvasHeight || this.canvasView?.canvas?.height || Constants.CANVAS_HEIGHT);
        return {
            enabled,
            left,
            top,
            right,
            bottom,
            fill: "black",
            feathering: Math.max(0, Number(runner.fl2oFeathering ?? 0) || 0),
            max_width: Math.max(0, Number(runner.fl2oMaxWidth ?? 0) || 0),
            max_height: Math.max(0, Number(runner.fl2oMaxHeight ?? 0) || 0),
            source_is_prepared: enabled && !!this._easyOutpaintSourcePrepared,
            source_rect: {
                x: left,
                y: top,
                w: Math.max(1, Math.round(width - left - right)),
                h: Math.max(1, Math.round(height - top - bottom)),
                unit: "px",
            },
            style: "invoke_unicanvas_frame",
        };
    }

    _getEasyCropState(payload = {}) {
        const rect = this.canvasView?._cropRect;
        if (rect && Number.isFinite(Number(rect.w)) && Number.isFinite(Number(rect.h))) {
            return {
                x: Math.round(Number(rect.x) || 0),
                y: Math.round(Number(rect.y) || 0),
                w: Math.max(1, Math.round(Number(rect.w) || 1)),
                h: Math.max(1, Math.round(Number(rect.h) || 1)),
                unit: "px",
            };
        }
        return {
            x: 0,
            y: 0,
            w: Math.max(1, Math.round(Number(payload.width || this.canvasWidth || Constants.CANVAS_WIDTH))),
            h: Math.max(1, Math.round(Number(payload.height || this.canvasHeight || Constants.CANVAS_HEIGHT))),
            unit: "px",
        };
    }

    _getEasyCanvasTransform() {
        return {
            zoom: Number(this.canvasView?.userZoom || 1),
            base_fit_scale: Number(this.canvasView?.baseFitScale || 1),
        };
    }

    _getEasyOperation(payload = {}, backendPayload = {}) {
        const extra = backendPayload?.extra || payload?.extra || {};
        const raw = String(extra.easy_mode || extra.intent_mode || extra.scenario_override || payload.scenario || "edit").toLowerCase();
        if (raw.includes("outpaint") || raw === "fl2-o") return "outpaint";
        if (raw.includes("inpaint") || raw === "fl2-i") return "inpaint";
        if (raw.includes("i2i")) return "image-to-image";
        if (raw.includes("remove")) return "remove_bg";
        if (raw.includes("sketch")) return "sketch";
        return "edit";
    }

    _getEasyBackendSettings(backendPayload = {}) {
        const runner = this.workflowRunner || {};
        const extra = backendPayload?.extra || {};
        return {
            engine: String(extra.engine || runner.engine || ""),
            scenario: String(extra.scenario_override || backendPayload.scenario || ""),
            unet_name: String(extra.unet_model_override || runner.unetModel || runner.upscaleUnetModel || ""),
            clip_name: String(extra.clip1_model_override || runner.clip1Model || runner.upscaleClip1Model || ""),
            clip2_name: String(runner.clip2Model || runner.upscaleClip2Model || ""),
            clip_type: String(extra.clip_type || runner.clipType || runner.upscaleClipType || ""),
            vae_name: String(extra.vae_model_override || runner.vaeModel || runner.upscaleVaeModel || ""),
            sampler_name: String(extra.sampler_name || runner.sampler || ""),
            scheduler: String(extra.scheduler || runner.scheduler || ""),
            seed: Number.isFinite(Number(backendPayload.seed ?? runner.seed)) ? Number(backendPayload.seed ?? runner.seed) : -1,
            steps: Number.isFinite(Number(backendPayload.steps ?? runner.steps)) ? Number(backendPayload.steps ?? runner.steps) : 0,
            cfg: Number.isFinite(Number(backendPayload.cfg ?? runner.cfg)) ? Number(backendPayload.cfg ?? runner.cfg) : 1,
        };
    }

    _buildPayload() {
        const global = this.promptManager.getGlobalPrompt();
        // Keep ComfyUI workflow payload compact to prevent localStorage quota issues.
        // Full bitmaps/masks are pushed to backend via bridge.pushState(workflowRunner.buildPayload()).
        const layers = this.layerManager.getLayers().map((layer) => ({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            blend_mode: layer.blend_mode,
            opacity: layer.opacity,
            bitmap: null,
            mask: null,
            metadata: layer.metadata ?? {},
            prompt: { ...layer.prompt },
        }));

        // Determine current theme from DOM or persisted storage
        let currentTheme = "cosmic";
        try {
            const root = this.domRoot?.querySelector?.('.goya-root');
            currentTheme = root?.dataset?.theme || localStorage.getItem('iamccs_theme') || "cosmic";
        } catch (_e) { /* ignore */ }

        // CRITICAL: Get full workflow state including scenario_override, upscale settings, etc.
        const workflowPayload = this.workflowRunner.buildPayload();

        return {
            width: this.canvasWidth,
            height: this.canvasHeight,
            active_layer: this.layerManager.getActiveLayerId(),
            layers,
            global_positive: global.positive ?? "",
            global_negative: global.negative ?? "",
            global_strength: global.strength ?? 1,
            global_guidance: global.guidance ?? 1,
            global_cfg: global.cfg ?? 1,
            seed: this.workflowRunner.seed ?? -1,
            steps: this.workflowRunner.steps ?? 4,
            scenario: workflowPayload.scenario || "auto",  // Use dispatcher scenario
            draw_only: this.drawOnly,
            pencil_mode: this.canvasView?.pencilModeEnabled || false,
            prompts: this.promptManager.buildPayload(),
            theme: currentTheme,
            // DISPATCHER: Merge full workflow extras including scenario_override, upscale settings
            extra: workflowPayload.extra || {},
        };
    }

    _hidePayloadWidget() {
        ["canvas_payload", "goya_easy_state", "draw_only", "qwen_generation_enabled", "lora_model"].forEach((name) => {
            const widget = this._findWidget(name);
            if (!widget) {
                return;
            }
            widget.hidden = true;
            widget.computeSize = () => [0, 0];
            if (name === "canvas_payload") {
                widget.value = "{}";
                widget.serialize = false;
                widget.options = { ...(widget.options || {}), serialize: false };
                widget.serializeValue = () => undefined;
            }
        });
    }

    _findWidget(name) {
        if (!this.node?.widgets) {
            return null;
        }
        return this.node.widgets.find((widget) => widget && widget.name === name) ?? null;
    }

    async _queuePrompt() {
        const comfyApp = this.node?.graph?.comfyApp ?? window.app;
        if (!comfyApp || typeof comfyApp.queuePrompt !== "function") {
            return;
        }
        try {
            // Run the whole graph to ensure outputs are detected (avoids prompt_no_outputs)
            return await comfyApp.queuePrompt();
        } catch (error) {
            console.warn("[IAMCCS] Prompt queue rejected (primary)", error);
            try {
                const msg = String(error?.message || "");
                if (msg.includes("prompt_no_outputs") || msg.includes("no outputs")) {
                    alert("This graph has no outputs. Connect the IAMCCS node to a SaveImage/Preview and try again.");
                }
            } catch (_e) {}
            // Fallbacks for differing ComfyUI versions
            try {
                return await comfyApp.queuePrompt();
            } catch (e1) {
                console.warn("[IAMCCS] Prompt queue rejected (fallback1)", e1);
                try {
                    const msg = String(e1?.message || "");
                    if (msg.includes("prompt_no_outputs") || msg.includes("no outputs")) {
                        alert("This graph has no outputs. Connect the IAMCCS node to a SaveImage/Preview and try again.");
                    }
                } catch (_e) {}
                try {
                    return await comfyApp.queuePrompt();
                } catch (e2) {
                    console.warn("[IAMCCS] Failed to queue prompt automatically (all)", e2);
                }
            }
        }
    }

    _widgetValue(name, fallback) {
        const widget = this._findWidget(name);
        if (!widget) {
            return fallback;
        }
        return widget.value ?? fallback;
    }
}














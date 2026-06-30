/**
 * EasyMode.js
 * Entry point for EASY mode - beginner-friendly UI
 */

import EasyPanel from './EasyPanel.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';
import EasyGallery from './EasyGallery.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';
import EasyShortcutRail from './EasyShortcutRail.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';
import EasyDrawPanel from './EasyDrawPanel.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';
import EasyLayerBox from './EasyLayerBox.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';
import EasySelectionOverlay from './EasySelectionOverlay.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';
import EasyProgressPanel from './EasyProgressPanel.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';
import EasyPromptPanel from './EasyPromptPanel.js?v=20260630_EASY_IMMEDIATE_EDIT_RESULT02';

export default class EasyMode {
    constructor(workspace, eventBus, modules) {
        this.workspace = workspace;
        this.eventBus = eventBus;
        this.modules = modules;
        this.container = null;
        this._lastImportedFinalUrl = '';
        this._compareEnabled = false;
        this._lastComparePayload = null;
        
        this.render();
        this._setEasyManagedLayersVisible(true);
        this.initPanels();
    }
    
    render() {
        // Create easy mode layout structure
        this.container = document.createElement('div');
        this.container.className = 'easy-mode-container';
        this.container.innerHTML = `
            <div class="easy-sidebar-left">
                <div class="easy-panel-host" data-easy-box="workflow"></div>
                <div class="easy-prompt-panel-host" data-easy-box="prompt"></div>
                <div class="easy-draw-panel-host" data-easy-box="brush"></div>
            </div>
            <div class="easy-sidebar-right">
                <div class="easy-layer-box-host" data-easy-box="layers"></div>
                <div class="easy-shortcut-rail-host" data-easy-box="tools"></div>
                <div class="easy-progress-panel-host" data-easy-box="progress"></div>
                <div class="easy-gallery-host" data-easy-box="gallery"></div>
            </div>
        `;

        this.workspace.appendChild(this.container);

        // SHARED CANVAS CONTRACT:
        // Easy mode mounts into the existing canvas area created by the editor shell.
        // LayoutRouter.mountEasyMode() hides toolbar/panels but keeps canvas-area
        // visible. The .easy-mode-layout grid positions it at column 2.
        // Do NOT create a second canvas here.
    }
    
    initPanels() {
        const panelHost = this.container?.querySelector('.easy-panel-host');
        const galleryHost = this.container?.querySelector('.easy-gallery-host');
        const shortcutHost = this.container?.querySelector('.easy-shortcut-rail-host');
        const drawPanelHost = this.container?.querySelector('.easy-draw-panel-host');
        const layerBoxHost = this.container?.querySelector('.easy-layer-box-host');
        const progressHost = this.container?.querySelector('.easy-progress-panel-host');
        const promptHost = this.container?.querySelector('.easy-prompt-panel-host');
        
        this.easyPanel = this._mountPanel('EasyPanel', panelHost, () => new EasyPanel(panelHost, this.eventBus, this.modules));
        this.promptPanel = this._mountPanel('EasyPromptPanel', promptHost, () => new EasyPromptPanel(promptHost, this.eventBus, this.modules));
        this.gallery = this._mountPanel('EasyGallery', galleryHost, () => new EasyGallery(galleryHost, this.eventBus));
        this.shortcutRail = this._mountPanel('EasyShortcutRail', shortcutHost, () => new EasyShortcutRail(shortcutHost, this.eventBus, this.modules.canvasView));
        this.drawPanel = this._mountPanel('EasyDrawPanel', drawPanelHost, () => new EasyDrawPanel(drawPanelHost, this.eventBus, this.modules));
        this.layerBox = this._mountPanel('EasyLayerBox', layerBoxHost, () => new EasyLayerBox(layerBoxHost, this.eventBus, this.modules));
        try {
            this.selectionOverlay = new EasySelectionOverlay(this.eventBus, this.modules);
        } catch (error) {
            console.error('[EasyMode] EasySelectionOverlay failed to mount', error);
            this.selectionOverlay = null;
        }
        this.progressPanel = this._mountPanel('EasyProgressPanel', progressHost, () => new EasyProgressPanel(progressHost, this.eventBus));

        // Bridge: forward workflow:final to easy:generation:complete for gallery/compare
        this._unsubs = [];
        const onSourceSaved = ({ url, name } = {}) => {
            if (!url) return;
            this._lastSourcePayload = {
                dataUrl: url,
                name: name || '',
                source: 'easy-before-compare',
            };
        };
        this.eventBus.on('easy:source:saved', onSourceSaved);
        this._unsubs.push(() => this.eventBus.off('easy:source:saved', onSourceSaved));

        const onFinal = ({ url, name, data } = {}) => {
            if (!url) return;
            const mode = String(data?.mode || data?.intentMode || '').toLowerCase();
            const baselineDataUrl = this._lastSourcePayload?.dataUrl || this.modules?.canvasView?._preRunCompositeDataUrl || '';
            const comparePayload = {
                dataUrl: url,
                baselineDataUrl,
                source: 'easy-final-compare',
            };
            this._lastComparePayload = comparePayload;
            this.eventBus.emit('easy:generation:complete', {
                imageUrl: url,
                imageName: name || '',
                sourceImageUrl: baselineDataUrl,
            });
            if (this._compareEnabled) {
                this.eventBus.emit('canvas:compare:set', comparePayload);
                this.eventBus.emit('compare:toggle', { enabled: true, source: 'easy-final-compare' });
            }
            const canvasImportModes = new Set(['draw', 'z', 't2i', 'txt2img', 'text_to_image', 'img2img', 'i2i', 'inpaint', 'outpaint', 'upscale']);
            if (canvasImportModes.has(mode)) {
                this._importFinalImageToCanvas(url, name || `Easy ${mode} result`, {
                    source: `easy-${mode}-final`,
                    replace: true,
                    force: mode === 'inpaint' || mode === 'outpaint',
                    statusMessage: `Easy ${mode} result imported to canvas`,
                }).then(() => {
                    if (mode === 'inpaint' || mode === 'outpaint') {
                        this.eventBus.emit(`easy:${mode}:reset`, { reason: 'final-import' });
                    }
                });
            }
        };
        this.eventBus.on('workflow:final', onFinal);
        this._unsubs.push(() => this.eventBus.off('workflow:final', onFinal));

        const onWorkflowImage = ({ url, mode, name } = {}) => {
            if (!url) return;
            const normalizedMode = String(mode || '').toLowerCase();
            if (normalizedMode === 'outpaint' || normalizedMode === 'inpaint') {
                // Inpaint/outpaint are imported from workflow:final only, so the output
                // reaches the canvas once and the mask/frame can be reset deterministically.
                return;
            }
            const canvasImportModes = new Set(['draw', 'z', 't2i', 'txt2img', 'text_to_image', 'img2img', 'i2i', 'upscale']);
            if (canvasImportModes.has(normalizedMode)) {
                this._importFinalImageToCanvas(url, name || `Easy ${normalizedMode} result`);
            }
        };
        this.eventBus.on('workflow:image', onWorkflowImage);
        this._unsubs.push(() => this.eventBus.off('workflow:image', onWorkflowImage));

        const onCompareToggle = ({ enabled } = {}) => {
            this._compareEnabled = !!enabled;
            if (this._compareEnabled && this._lastComparePayload?.dataUrl) {
                this.eventBus.emit('canvas:compare:set', this._lastComparePayload);
            }
        };
        this.eventBus.on('compare:toggle', onCompareToggle);
        this._unsubs.push(() => this.eventBus.off('compare:toggle', onCompareToggle));
    }

    async _importFinalImageToCanvas(url, name = 'Easy result', options = {}) {
        if (!options.force && url === this._lastImportedFinalUrl) {
            return;
        }
        this._lastImportedFinalUrl = url;
        try {
            let blob = null;
            if (String(url || '').startsWith('data:image/')) {
                const response = await fetch(url);
                blob = await response.blob();
            } else {
                const separator = String(url || '').includes('?') ? '&' : '?';
                const response = await fetch(`${url}${separator}easy_fetch=${Date.now()}`, { cache: 'no-store' });
                if (!response.ok) throw new Error(`result fetch failed (${response.status})`);
                blob = await response.blob();
            }
            const safeName = String(name || `easy_outpaint_${Date.now()}.png`).split(/[\\/]/).pop() || `easy_outpaint_${Date.now()}.png`;
            const file = new File([blob], safeName, { type: blob.type || 'image/png' });
            this.eventBus.emit('canvas:import:files', {
                files: [file],
                source: options.source || 'easy-final-image',
                replace: options.replace !== false,
                previewRole: options.previewRole || '',
                keepRoleOnTop: options.keepRoleOnTop || '',
            });
            if (!options.keepMaskOverlay) {
                this.eventBus.emit('mask:overlay', { enabled: false });
                this.eventBus.emit('mask:paintMode', { enabled: false });
            } else {
                this.eventBus.emit('mask:paintMode', { enabled: true });
                this.eventBus.emit('mask:overlay', { enabled: true });
            }
            this.eventBus.emit('status:message', options.statusMessage || 'Easy result imported to canvas');
        } catch (error) {
            this._lastImportedFinalUrl = '';
            console.warn('[EasyMode] Failed to import final image to canvas', error);
            this.eventBus.emit('status:message', `Easy outpaint import failed: ${error?.message || error}`);
        }
    }

    _mountPanel(label, host, factory) {
        try {
            if (!host) throw new Error('missing host');
            return factory();
        } catch (error) {
            console.error(`[EasyMode] ${label} failed to mount`, error);
            if (host) {
                host.innerHTML = `
                    <section class="easy-panel easy-panel--error">
                        <div class="easy-panel__eyebrow">Panel unavailable</div>
                        <h3 class="easy-panel__title">${label}</h3>
                    </section>
                `;
            }
            return null;
        }
    }
    
    _setEasyManagedLayersVisible(visible) {
        const layerManager = this.modules?.layerManager;
        const layers = layerManager?.getLayers?.() || [];
        layers.forEach((layer) => {
            const meta = layer?.metadata || {};
            if (!meta.easyManaged && !meta.easyRole) return;
            try {
                layerManager.updateLayer?.({
                    id: layer.id,
                    patch: { visible: !!visible },
                });
            } catch (_error) {}
        });
    }

    cleanup() {
        console.log('[EasyMode] Cleaning up...');
        this._setEasyManagedLayersVisible(false);
        if (this._unsubs) { for (const u of this._unsubs) try { u(); } catch (_e) {} }
        this._unsubs = [];
        this.easyPanel?.cleanup?.();
        this.promptPanel?.cleanup?.();
        this.layerBox?.cleanup?.();
        this.selectionOverlay?.cleanup?.();
        this.drawPanel?.cleanup?.();
        this.progressPanel?.cleanup?.();
        this.shortcutRail?.cleanup?.();
        this.container?.remove();
        this.container = null;
    }
}





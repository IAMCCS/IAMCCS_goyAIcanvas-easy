/**
 * EasyComparePanel.js
 * Compare source vs generated images with toggle modes
 */

export default class EasyComparePanel {
    constructor(container, eventBus, canvasView) {
        this.container = container;
        this.eventBus = eventBus;
        this.canvasView = canvasView;
        
        this.state = {
            enabled: false,
            sourceImage: null,
            generatedImage: null,
            mode: 'generated' // 'source' | 'generated' | 'split'
        };
        
        this.render();
        this.attachListeners();
    }
    
    render() {
        this.container.innerHTML = `
            <div class="easy-compare-panel ${this.state.enabled ? '' : 'disabled'}">
                <h4 class="easy-compare-panel__title">🔄 Compare</h4>
                
                ${!this.state.enabled ? `
                    <p class="easy-compare-panel__hint">Generate an image to enable compare</p>
                ` : `
                    <div class="easy-compare-panel__modes">
                        <button class="easy-compare-mode-btn ${this.state.mode === 'source' ? 'active' : ''}" data-mode="source">
                            📷 Source
                        </button>
                        <button class="easy-compare-mode-btn ${this.state.mode === 'generated' ? 'active' : ''}" data-mode="generated">
                            ✨ Generated
                        </button>
                        <button class="easy-compare-mode-btn ${this.state.mode === 'split' ? 'active' : ''}" data-mode="split">
                            ⚖️ Split
                        </button>
                    </div>
                `}
            </div>
        `;
    }
    
    attachListeners() {
        this.container.addEventListener('click', (e) => {
            const btn = e.target.closest('.easy-compare-mode-btn');
            if (btn) {
                this.state.mode = btn.dataset.mode;
                this.updateDisplay();
                this.render();
            }
        });
        
        // Auto-enable when generation completes
        this.eventBus.on('easy:generation:complete', (data) => {
            this.state.enabled = true;
            this.state.generatedImage = data.imageUrl;
            this.state.sourceImage = data.sourceImageUrl || null;
            this.state.mode = 'generated';
            this.render();
            this.updateDisplay();
        });
    }
    
    updateDisplay() {
        if (!this.state.enabled) return;
        
        switch (this.state.mode) {
            case 'source':
                if (this.state.sourceImage) {
                    this.canvasView.showImage?.(this.state.sourceImage);
                }
                break;
            case 'generated':
                if (this.state.generatedImage) {
                    this.canvasView.showImage?.(this.state.generatedImage);
                }
                break;
            case 'split':
                if (this.state.sourceImage && this.state.generatedImage) {
                    this.canvasView.showSplitView?.(this.state.sourceImage, this.state.generatedImage);
                }
                break;
        }
    }
}

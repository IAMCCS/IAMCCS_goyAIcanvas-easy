export default class EasyPromptPanel {
    constructor(container, eventBus) {
        this.container = container;
        this.eventBus = eventBus;
        this.state = {
            easyMode: 't2i',
            prompt: '',
            negativePrompt: '',
            canGenerate: true,
            activeModel: '',
            generationState: 'idle',
            activePromptId: '',
            generationStartedAt: 0,
        };
        this._unsubs = [];
        this._bindBusListeners();
        this.render();
        this.attachListeners();
        window.setTimeout(() => this.eventBus.emit('easy:generate:availability:request'), 0);
    }

    _bindBusListeners() {
        this._unsubs.push(this.eventBus.on('easy:mode:change', ({ mode }) => {
            this.state.easyMode = mode || 't2i';
            this.render();
            this.attachListeners();
        }));
        this._unsubs.push(this.eventBus.on('easy:prompt:update', (patch = {}) => {
            if (typeof patch.prompt === 'string') this.state.prompt = patch.prompt;
            if (typeof patch.negativePrompt === 'string') this.state.negativePrompt = patch.negativePrompt;
        }));
        this._unsubs.push(this.eventBus.on('easy:generate:availability', (payload = {}) => {
            if (typeof payload.canGenerate === 'boolean') this.state.canGenerate = payload.canGenerate;
            if (typeof payload.activeModel === 'string') this.state.activeModel = payload.activeModel;
            this._syncGenerateButton();
        }));
        this._unsubs.push(this.eventBus.on('workflow:started', (payload = {}) => {
            if (!this._isEasyWorkflowEvent(payload)) return;
            const promptId = this._extractPromptId(payload);
            this.state.generationState = promptId ? 'generating' : 'idle';
            this.state.activePromptId = promptId;
            this.state.generationStartedAt = promptId ? Date.now() : 0;
            this._syncGenerateButton();
        }));
        this._unsubs.push(this.eventBus.on('workflow:queued', (payload = {}) => {
            if (!this._isEasyWorkflowEvent(payload)) return;
            const promptId = this._extractPromptId(payload) || this.state.activePromptId;
            if (this.state.generationState !== 'stopping') this.state.generationState = promptId ? 'generating' : 'idle';
            this.state.activePromptId = promptId;
            this.state.generationStartedAt = promptId ? (this.state.generationStartedAt || Date.now()) : 0;
            this._syncGenerateButton();
        }));
        const resetGenerateState = () => {
            this.state.generationState = 'idle';
            this.state.activePromptId = '';
            this.state.generationStartedAt = 0;
            this._syncGenerateButton();
        };
        this._unsubs.push(this.eventBus.on('workflow:finished', resetGenerateState));
        this._unsubs.push(this.eventBus.on('workflow:complete', resetGenerateState));
        this._unsubs.push(this.eventBus.on('workflow:final', resetGenerateState));
        this._unsubs.push(this.eventBus.on('workflow:error', resetGenerateState));
        this._unsubs.push(this.eventBus.on('easy:generation:reset', resetGenerateState));
        this._unsubs.push(this.eventBus.on('canvas:layer:cleared', resetGenerateState));
    }

    render() {
        const isT2I = this.state.easyMode === 't2i';
        const promptLabel = isT2I
            ? 'Describe the final image'
            : this.state.easyMode === 'upscale'
                ? 'Optional upscale direction'
                : 'Describe the edit you want';
        this.container.innerHTML = `
            <div class="easy-prompt-panel">
                <div class="easy-prompt-panel__header">
                    <div class="easy-prompt-panel__eyebrow">Prompt</div>
                    <div class="easy-prompt-panel__title">${promptLabel}</div>
                </div>

                <div class="easy-prompt-panel__card">
                    <label>Prompt</label>
                    <textarea id="easy-right-prompt" class="easy-panel__textarea" rows="5" placeholder="Describe what you want to generate...">${this.state.prompt}</textarea>
                </div>

                <div class="easy-prompt-panel__card">
                    <label>Negative Prompt</label>
                    <textarea id="easy-right-negative-prompt" class="easy-panel__textarea easy-panel__textarea--secondary" rows="4" placeholder="What to avoid...">${this.state.negativePrompt}</textarea>
                </div>

                <div class="easy-prompt-panel__generate">
                    <div class="easy-prompt-panel__model" title="${this._escapeAttr(this.state.activeModel)}">${this._escapeText(this.state.activeModel || 'Ready')}</div>
                    <button id="easy-right-generate-btn" class="easy-panel__button easy-panel__button--primary easy-prompt-panel__generate-btn" type="button" ${this.state.canGenerate ? '' : 'disabled'}>
                        Generate
                    </button>
                </div>
            </div>
        `;
    }

    attachListeners() {
        this.container.querySelector('#easy-right-prompt')?.addEventListener('input', (e) => {
            this.state.prompt = e.target.value;
            this.eventBus.emit('easy:prompt:update', { prompt: this.state.prompt, negativePrompt: this.state.negativePrompt });
        });

        this.container.querySelector('#easy-right-negative-prompt')?.addEventListener('input', (e) => {
            this.state.negativePrompt = e.target.value;
            this.eventBus.emit('easy:prompt:update', { prompt: this.state.prompt, negativePrompt: this.state.negativePrompt });
        });

        this.container.querySelector('#easy-right-generate-btn')?.addEventListener('click', () => {
            if (this.state.generationState === 'generating') {
                if (!this.state.activePromptId) {
                    this.state.generationState = 'idle';
                    this.state.generationStartedAt = 0;
                    this._syncGenerateButton();
                    this.eventBus.emit('easy:generate:request');
                    return;
                }
                this._requestStopGeneration();
                return;
            }
            if (this.state.generationState === 'stopping') return;
            this.eventBus.emit('easy:generate:request');
        });
        this._syncGenerateButton();
    }

    async _requestStopGeneration() {
        const promptId = String(this.state.activePromptId || '').trim();
        if (!promptId) {
            this.state.generationState = 'idle';
            this.state.generationStartedAt = 0;
            this._syncGenerateButton();
            this.eventBus.emit('status:message', 'Easy generation state reset; no active prompt to stop.');
            return;
        }
        this.state.generationState = 'stopping';
        this._syncGenerateButton();
        this.eventBus.emit('status:message', 'Easy generation stop requested.');
        try {
            await fetch('/interrupt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt_id: promptId }),
            });
            this.eventBus.emit('workflow:phase', { index: 0, count: 1, phase: 'Stopping generation', phaseProgress: 100 });
        } catch (error) {
            console.warn('[EasyPromptPanel] Failed to interrupt generation', error);
            this.eventBus.emit('status:message', 'Easy generation stop request failed.');
            this.state.generationState = 'idle';
            this._syncGenerateButton();
        }
    }

    _extractPromptId(payload = {}) {
        return String(
            payload?.promptId
            || payload?.prompt_id
            || payload?.payload?.promptId
            || payload?.payload?.prompt_id
            || payload?.data?.prompt_id
            || ''
        ).trim();
    }

    _isEasyWorkflowEvent(payload = {}) {
        const direct = payload || {};
        const nested = direct.payload || {};
        const extra = direct.extra || nested.extra || {};
        return direct.source === 'easy'
            || nested.source === 'easy'
            || direct.easyStandalone === true
            || nested.easyStandalone === true
            || extra.easy_standalone === true
            || String(direct.scenarioKey || nested.scenarioKey || '').startsWith('easy-');
    }

    _syncGenerateButton() {
        const button = this.container?.querySelector?.('#easy-right-generate-btn');
        if (button) {
            const state = this.state.generationState || 'idle';
            button.disabled = !this.state.canGenerate && state === 'idle';
            button.classList.toggle('is-generating', state === 'generating');
            button.classList.toggle('is-stopping', state === 'stopping');
            button.textContent = state === 'stopping'
                ? 'Stopping'
                : state === 'generating'
                    ? 'Generating'
                    : 'Generate';
            button.setAttribute('aria-pressed', state === 'generating' || state === 'stopping' ? 'true' : 'false');
        }
        const model = this.container?.querySelector?.('.easy-prompt-panel__model');
        if (model) {
            model.textContent = this.state.activeModel || 'Ready';
            model.title = this.state.activeModel || '';
        }
    }

    _escapeText(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    _escapeAttr(value) {
        return this._escapeText(value).replace(/"/g, '&quot;');
    }

    cleanup() {
        for (const unsub of this._unsubs) {
            try { unsub(); } catch (_e) {}
        }
        this._unsubs = [];
    }
}

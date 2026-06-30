/**
 * EasyProgressPanel.js
 * Realtime progress bars and status updates for EASY mode.
 */

export default class EasyProgressPanel {
    constructor(container, eventBus) {
        this.container = container;
        this.eventBus = eventBus;

        this._phase = 0;
        this._phaseCount = 0;
        this._progressPct = 0;
        this._statusText = 'Idle';
        this._running = false;
        this._activePromptId = '';
        this._api = null;
        this._apiHandlers = [];
        this._unsubs = [];
        this._lastTickerText = '';
        this._lastTickerAt = 0;

        this._build();
        this._attachListeners();
    }

    _build() {
        this.container.innerHTML = `
            <div class="easy-progress-panel">
                <h4 class="easy-progress-panel__title">Status</h4>
                <div class="easy-progress-panel__status" id="easy-status-text" data-state="idle">Idle</div>
                <div class="easy-progress-panel__bar-group">
                    <label class="easy-progress-panel__label">Progress</label>
                    <div class="easy-progress-panel__bar-track">
                        <div class="easy-progress-panel__bar-fill" id="easy-progress-fill" style="width:0%"></div>
                    </div>
                    <span class="easy-progress-panel__pct" id="easy-progress-pct">0%</span>
                </div>
                <div class="easy-progress-panel__bar-group">
                    <label class="easy-progress-panel__label">Phase</label>
                    <div class="easy-progress-panel__bar-track easy-progress-panel__bar-track--phase">
                        <div class="easy-progress-panel__bar-fill easy-progress-panel__bar-fill--phase" id="easy-phase-fill" style="width:0%"></div>
                    </div>
                    <span class="easy-progress-panel__pct" id="easy-phase-pct">0/0</span>
                </div>
            </div>
        `;
    }

    _attachListeners() {
        const _on = (event, handler) => {
            this.eventBus.on(event, handler);
            this._unsubs.push(() => this.eventBus.off(event, handler));
        };

        _on('workflow:started', (payload = {}) => {
            this._running = true;
            this._activePromptId = this._extractPromptId(payload);
            this._progressPct = 0;
            this._phase = 0;
            this._phaseCount = 0;
            this._setStatus('Queued', true);
            this._setProgress(0);
            this._setPhase(1, 4, 25);
            this._addTicker(`Queued ${this._activePromptId || 'generation'}`);
        });

        _on('workflow:finished', () => {
            this._running = false;
            this._activePromptId = '';
            this._setStatus('Complete');
            this._setProgress(100);
            this._setPhase(4, 4, 100);
            this._addTicker('Generation complete');
        });

        _on('workflow:complete', () => {
            this._running = false;
            this._activePromptId = '';
            this._setStatus('Complete');
            this._setProgress(100);
            this._setPhase(4, 4, 100);
        });

        _on('workflow:error', (data) => {
            this._running = false;
            this._activePromptId = '';
            this._setStatus(`Error: ${data?.message || data?.error || 'unknown'}`);
            this._setProgress(0);
            this._setPhase(0, 4, 0);
        });

        _on('workflow:progress', (data) => {
            if (!data) return;
            const completed = Number(data.completed);
            const total = Number(data.total);
            const pct = Number.isFinite(completed) && Number.isFinite(total) && total > 0
                ? (completed / total) * 100
                : Number(data.percent ?? data.value ?? data.progress ?? 0);
            if (Number.isFinite(pct)) this._setProgress(pct);
        });

        _on('status:message', (msg) => {
            if (!msg) return;
            const text = typeof msg === 'string' ? msg : (msg.text || msg.message || '');
            if (text) {
                if (!/^(Waiting for ComfyUI history:|ComfyUI still processing\b)/i.test(text)) {
                    this._addTicker(text);
                }
                this._parseProgressFromStatus(text);
            }
        });

        _on('workflow:phase', (data) => {
            if (!data) return;
            if (data.phase) this._setStatus(String(data.phase), this._running);
            this._setPhase(data.index || 0, data.count || 0, data.phaseProgress ?? data.progress ?? null);
            if (data.phase) this._addTicker(String(data.phase));
        });

        this._attachComfyProgressEvents();
    }

    async _attachComfyProgressEvents() {
        try {
            const { api } = await import('/scripts/api.js');
            this._api = api;
            const onProgress = (event) => {
                if (!this._running || !this._matchesPrompt(event?.detail)) return;
                const detail = event.detail || {};
                const value = Number(detail.value ?? detail.current ?? detail.step);
                const max = Number(detail.max ?? detail.total ?? detail.steps);
                if (Number.isFinite(value) && Number.isFinite(max) && max > 0) {
                    this._setStatus(`Sampling ${Math.round(value)}/${Math.round(max)}`, true);
                    this._setProgress((value / max) * 100);
                    this._setPhase(3, 4, 75);
                }
            };
            const onExecuting = (event) => {
                if (!this._running || !this._matchesPrompt(event?.detail)) return;
                const node = event?.detail?.node;
                if (node == null) {
                    this._setStatus('Finalizing', true);
                    this._setPhase(3, 4, 92);
                } else {
                    this._setStatus(`Executing node ${node}`, true);
                    this._setPhase(3, 4, 75);
                }
            };
            const onExecuted = (event) => {
                if (!this._running || !this._matchesPrompt(event?.detail)) return;
                const node = event?.detail?.node;
                if (node != null) this._addTicker(`Executed node ${node}`);
            };
            api.addEventListener('progress', onProgress);
            api.addEventListener('executing', onExecuting);
            api.addEventListener('executed', onExecuted);
            this._apiHandlers.push(['progress', onProgress], ['executing', onExecuting], ['executed', onExecuted]);
        } catch (error) {
            console.warn('[EasyProgressPanel] ComfyUI progress events unavailable', error);
        }
    }

    _extractPromptId(payload = {}) {
        return String(
            payload?.prompt_id
            || payload?.promptId
            || payload?.payload?.prompt_id
            || payload?.payload?.promptId
            || ''
        ).trim();
    }

    _matchesPrompt(detail = {}) {
        if (!this._activePromptId) return true;
        const id = String(detail?.prompt_id || detail?.promptId || '').trim();
        return !id || id === this._activePromptId;
    }

    _setStatus(text, animatePulse = false) {
        this._statusText = text;
        this._updateStatusChip(animatePulse);
    }

    _updateStatusChip(animatePulse = false) {
        const el = this.container.querySelector('#easy-status-text');
        if (el) {
            const status = String(this._statusText || 'Idle').replace(/\s+/g, ' ').trim();
            const pct = Math.max(0, Math.min(100, Number(this._progressPct) || 0));
            const lower = status.toLowerCase();
            const state = lower.startsWith('error') ? 'error'
                : lower.includes('complete') || lower.includes('saved') ? 'complete'
                    : this._running || animatePulse ? 'running'
                        : 'idle';
            const suffix = state === 'running' && pct > 0 ? ` - ${Math.round(pct)}%` : '';
            el.textContent = `${status}${suffix}`;
            el.dataset.state = state;
            el.classList.toggle('easy-progress-panel__status--running', animatePulse);
        }
    }

    _setProgress(pct) {
        this._progressPct = Math.max(0, Math.min(100, pct));
        const fill = this.container.querySelector('#easy-progress-fill');
        const label = this.container.querySelector('#easy-progress-pct');
        if (fill) fill.style.width = `${this._progressPct}%`;
        if (label) label.textContent = `${Math.round(this._progressPct)}%`;
        this._updateStatusChip(this._running);
    }

    _setPhase(index, count, phaseProgress = null) {
        this._phase = index;
        this._phaseCount = count;
        const fill = this.container.querySelector('#easy-phase-fill');
        const label = this.container.querySelector('#easy-phase-pct');
        const explicitPct = Number(phaseProgress);
        const rawPct = Number.isFinite(explicitPct) ? explicitPct : (count > 0 ? (index / count * 100) : 0);
        const pct = Math.max(0, Math.min(100, rawPct));
        if (fill) fill.style.width = `${pct}%`;
        if (label) label.textContent = `${index}/${count}`;
    }

    _addTicker(text) {
        const el = this.container.querySelector('#easy-ticker');
        if (!el) return;
        const clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return;
        const now = Date.now();
        if (clean === this._lastTickerText && now - this._lastTickerAt < 8000) return;
        this._lastTickerText = clean;
        this._lastTickerAt = now;
        const line = document.createElement('div');
        line.className = 'easy-progress-panel__ticker-line';
        line.textContent = clean;
        el.prepend(line);
        while (el.children.length > 4) el.lastChild.remove();
    }

    _parseProgressFromStatus(text) {
        const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
        if (pctMatch) {
            this._setProgress(parseFloat(pctMatch[1]));
            return;
        }
        const fracMatch = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (fracMatch) {
            const n = parseInt(fracMatch[1], 10);
            const m = parseInt(fracMatch[2], 10);
            if (m > 0) this._setProgress((n / m) * 100);
        }
    }

    cleanup() {
        for (const [event, handler] of this._apiHandlers) {
            try { this._api?.removeEventListener?.(event, handler); } catch (_e) {}
        }
        this._apiHandlers = [];
        for (const unsub of this._unsubs) { try { unsub(); } catch (_e) {} }
        this._unsubs = [];
    }
}

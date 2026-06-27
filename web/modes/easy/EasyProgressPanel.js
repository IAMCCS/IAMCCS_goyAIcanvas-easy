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
        this._unsubs = [];

        this._build();
        this._attachListeners();
    }

    _build() {
        this.container.innerHTML = `
            <div class="easy-progress-panel">
                <h4 class="easy-progress-panel__title">Status</h4>
                <div class="easy-progress-panel__status" id="easy-status-text">Idle</div>
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
                <div class="easy-progress-panel__ticker" id="easy-ticker"></div>
            </div>
        `;
    }

    _attachListeners() {
        const _on = (event, handler) => {
            this.eventBus.on(event, handler);
            this._unsubs.push(() => this.eventBus.off(event, handler));
        };

        _on('workflow:started', () => {
            this._running = true;
            this._progressPct = 0;
            this._phase = 0;
            this._phaseCount = 0;
            this._setStatus('Running...', true);
            this._setProgress(0);
            this._setPhase(0, 0);
        });

        _on('workflow:finished', () => {
            this._running = false;
            this._setStatus('Complete');
            this._setProgress(100);
        });

        _on('workflow:complete', () => {
            this._running = false;
            this._setStatus('Complete');
            this._setProgress(100);
        });

        _on('workflow:error', (data) => {
            this._running = false;
            this._setStatus(`Error: ${data?.message || data?.error || 'unknown'}`);
            this._setProgress(0);
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
                this._addTicker(text);
                this._parseProgressFromStatus(text);
            }
        });

        _on('workflow:phase', (data) => {
            if (!data) return;
            if (data.phase) this._setStatus(String(data.phase), this._running);
            this._setPhase(data.index || 0, data.count || 0, data.phaseProgress ?? data.progress ?? null);
        });
    }

    _setStatus(text, animatePulse = false) {
        this._statusText = text;
        const el = this.container.querySelector('#easy-status-text');
        if (el) {
            el.textContent = text;
            el.classList.toggle('easy-progress-panel__status--running', animatePulse);
        }
    }

    _setProgress(pct) {
        this._progressPct = Math.max(0, Math.min(100, pct));
        const fill = this.container.querySelector('#easy-progress-fill');
        const label = this.container.querySelector('#easy-progress-pct');
        if (fill) fill.style.width = `${this._progressPct}%`;
        if (label) label.textContent = `${Math.round(this._progressPct)}%`;
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
        const line = document.createElement('div');
        line.className = 'easy-progress-panel__ticker-line';
        line.textContent = text;
        el.prepend(line);
        while (el.children.length > 8) el.lastChild.remove();
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
        for (const unsub of this._unsubs) { try { unsub(); } catch (_e) {} }
        this._unsubs = [];
    }
}

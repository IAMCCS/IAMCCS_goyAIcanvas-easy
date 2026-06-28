import Constants from './Constants.js';

const DEFAULT_STATE = Object.freeze({
    connected: false,
    kind: 'idle',
    label: 'Task idle',
    text: '',
    phase: '',
    progress: null,
    phaseProgress: null,
    phaseIndex: 0,
    phaseCount: 0,
    updatedAt: 0,
});

function clampPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(0, Math.min(100, num));
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeStatus(raw) {
    if (!raw || typeof raw !== 'object') {
        return { ...DEFAULT_STATE, updatedAt: Date.now() };
    }

    const text = String(raw.text || raw.detail || '').trim();
    const phase = String(raw.phase || raw.phase_name || '').trim();
    const progress = clampPercent(raw.progress);
    const phaseProgress = clampPercent(raw.phase_progress);
    const phaseIndex = Math.max(0, Number(raw.phase_index) || 0);
    const phaseCount = Math.max(0, Number(raw.phase_count) || 0);
    const combined = `${phase} ${text}`.trim();
    const lower = combined.toLowerCase();
    const isError = /error|failed|failure|cancel/i.test(lower);
    const isComplete = !isError && ((progress != null && progress >= 100) || (phaseProgress != null && phaseProgress >= 100) || /complete|done|finished|ready/i.test(lower));
    const isRunning = !isError && !isComplete && (
        (progress != null && progress > 0)
        || (phaseProgress != null && phaseProgress > 0)
        || phaseCount > 0
        || /run|queue|process|render|encode|decode|sample|load|prep/i.test(lower)
    );

    let kind = 'idle';
    if (isError) kind = 'error';
    else if (isComplete) kind = 'complete';
    else if (isRunning) kind = 'running';

    const label = phase || text || (kind === 'running' ? 'Task running' : kind === 'complete' ? 'Task complete' : kind === 'error' ? 'Task error' : 'Task idle');

    return {
        connected: true,
        kind,
        label,
        text,
        phase,
        progress,
        phaseProgress,
        phaseIndex,
        phaseCount,
        updatedAt: Date.now(),
    };
}

export function renderTaskStatusMarkup(state, options = {}) {
    const current = state && typeof state === 'object' ? state : DEFAULT_STATE;
    const idleLabel = String(options.idleLabel || 'Task idle');

    if (!current.connected) {
        return `
            <div class="goya-task-chips" aria-live="polite">
                <span class="goya-task-chip goya-task-chip--offline">Status offline</span>
            </div>
        `;
    }

    const chips = [];
    const label = current.kind === 'idle' && !current.phase && !current.text ? idleLabel : current.label;
    chips.push(`<span class="goya-task-chip goya-task-chip--${escapeHtml(current.kind || 'idle')}">${escapeHtml(label)}</span>`);

    if (current.progress != null && (current.kind !== 'idle' || current.progress > 0)) {
        chips.push(`<span class="goya-task-chip">${escapeHtml(current.progress.toFixed(0))}%</span>`);
    }
    if (current.phaseCount > 0) {
        const step = Math.min(current.phaseCount, Math.max(1, current.phaseIndex || 1));
        chips.push(`<span class="goya-task-chip">Step ${escapeHtml(step)}/${escapeHtml(current.phaseCount)}</span>`);
    }
    if (current.phaseProgress != null && current.kind === 'running') {
        chips.push(`<span class="goya-task-chip">Phase ${escapeHtml(current.phaseProgress.toFixed(0))}%</span>`);
    }

    return `
        <div class="goya-task-chips" aria-live="polite">
            ${chips.join('')}
        </div>
    `;
}

class TaskStatusStore {
    constructor() {
        this.listeners = new Set();
        this.state = { ...DEFAULT_STATE };
        this._timer = 0;
        this._request = null;
        this._pollMs = 1600;
    }

    getState() {
        return { ...this.state };
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        listener(this.getState());
        if (this.listeners.size === 1) this._start();
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) this._stop();
        };
    }

    _emit() {
        const snapshot = this.getState();
        this.listeners.forEach((listener) => {
            try { listener(snapshot); } catch (_e) {}
        });
    }

    _setState(nextState) {
        this.state = nextState;
        this._emit();
    }

    _start() {
        if (this._timer) return;
        this.refresh();
        this._timer = window.setInterval(() => this.refresh(), this._pollMs);
    }

    _stop() {
        if (this._timer) {
            window.clearInterval(this._timer);
            this._timer = 0;
        }
    }

    async refresh() {
        if (this._request) return this._request;
        this._request = (async () => {
            try {
                const response = await fetch(`${Constants.API_BASE}/status`, { cache: 'no-store' });
                const raw = await response.text();
                if (!response.ok) throw new Error(raw || `status ${response.status}`);
                let payload = {};
                if (raw) {
                    try {
                        payload = JSON.parse(raw);
                    } catch (_e) {
                        payload = { text: raw };
                    }
                }
                this._setState(normalizeStatus(payload));
            } catch (_error) {
                this._setState({ ...DEFAULT_STATE, updatedAt: Date.now() });
            } finally {
                this._request = null;
            }
        })();
        return this._request;
    }
}

const taskStatusStore = new TaskStatusStore();

export default taskStatusStore;
export default class EasyStateBridge {
    constructor(eventBus) {
        this.eventBus = eventBus;
        this._state = null;
        this._pushTimer = null;
        this._pushPendingPayload = null;
        this._pushInFlight = null;
        this._lastPushSentAt = 0;
        this._pushMinIntervalMs = 150;
    }

    destroy() {
        if (this._pushTimer) clearTimeout(this._pushTimer);
        this._pushTimer = null;
        this._pushPendingPayload = null;
        this._pushInFlight = null;
        this._state = null;
    }

    _clone(value) {
        try { return JSON.parse(JSON.stringify(value)); } catch (_e) { return value; }
    }

    _sanitize(payload) {
        if (!payload || typeof payload !== "object") return payload;
        const outgoing = { ...payload, extra: { ...(payload.extra || {}) } };
        for (const key of ["live_preview", "live_status", "live_status_flux", "live_status_up", "prompt_preview", "last_generation", "last_generation_meta"]) {
            delete outgoing.extra[key];
        }
        for (const key of Object.keys(outgoing.extra)) {
            const value = outgoing.extra[key];
            if (typeof value === "string" && value.startsWith("data:") && value.length > 4096) delete outgoing.extra[key];
        }
        return outgoing;
    }

    async _sendState(payload) {
        const outgoing = this._sanitize(payload);
        this.eventBus?.emit?.("bridge:state:pushed", outgoing);
        return this._state;
    }

    async pushState(payload, options = {}) {
        this._state = this._clone(payload);
        if (options?.immediate) return await this._sendState(payload);
        this._pushPendingPayload = payload;
        if (this._pushTimer) return this._state;
        const elapsed = Date.now() - (this._lastPushSentAt || 0);
        const delay = Math.max(0, this._pushMinIntervalMs - elapsed);
        this._pushTimer = setTimeout(async () => {
            this._pushTimer = null;
            if (this._pushInFlight) {
                try { await this._pushInFlight; } catch (_e) {}
            }
            const pending = this._pushPendingPayload;
            this._pushPendingPayload = null;
            if (!pending) return;
            this._pushInFlight = this._sendState(pending);
            try { await this._pushInFlight; } finally { this._pushInFlight = null; this._lastPushSentAt = Date.now(); }
        }, delay);
        return this._state;
    }

    async pullState() {
        const cached = this._state ? this._clone(this._state) : null;
        if (cached) this.eventBus?.emit?.("bridge:state:pulled", cached);
        return cached;
    }

    async pullLastGeneration() {
        return this._state?.last_generation || null;
    }
}


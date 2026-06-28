export default class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    on(eventName, handler) {
        if (!this.listeners.has(eventName)) {
            this.listeners.set(eventName, new Set());
        }
        this.listeners.get(eventName).add(handler);
        return () => this.off(eventName, handler);
    }

    once(eventName, handler) {
        const wrapper = (...args) => {
            this.off(eventName, wrapper);
            handler(...args);
        };
        return this.on(eventName, wrapper);
    }

    off(eventName, handler) {
        const bucket = this.listeners.get(eventName);
        if (!bucket) {
            return;
        }
        bucket.delete(handler);
        if (bucket.size === 0) {
            this.listeners.delete(eventName);
        }
    }

    emit(eventName, payload) {
        const bucket = this.listeners.get(eventName);
        if (!bucket) {
            return;
        }
        for (const handler of [...bucket]) {
            try {
                handler(payload);
            } catch (error) {
                console.error(`[EventBus] Listener for ${eventName} failed`, error);
            }
        }
    }
}

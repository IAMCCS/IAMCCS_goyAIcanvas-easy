/**
 * ProgressWebSocketManager.js
 * Manages websocket connection for real-time PROGRESS sphere updates from backend
 */

export default class ProgressWebSocketManager {
    constructor() {
        this.listeners = new Map(); // Map<nodeId, callback>
        this.api = null;
        this._initializeAPI();
    }

    async _initializeAPI() {
        try {
            // Import ComfyUI API
            const apiModule = await import("/scripts/api.js");
            this.api = apiModule.api;
            
            // Register websocket listener for custom progress events
            this.api.addEventListener("iamccs_goya_progress", (event) => {
                this._handleProgressUpdate(event.detail);
            });
            
            console.log("[ProgressWebSocket] Initialized and listening for iamccs_goya_progress events");
        } catch (error) {
            console.error("[ProgressWebSocket] Failed to initialize API:", error);
        }
    }

    _handleProgressUpdate(data) {
        // Broadcast to all registered listeners
        for (const [nodeId, callback] of this.listeners.entries()) {
            try {
                callback(data);
            } catch (error) {
                console.error(`[ProgressWebSocket] Listener error for node ${nodeId}:`, error);
            }
        }
    }

    /**
     * Register a listener for progress updates
     * @param {string} nodeId - Unique identifier for the listener (e.g., node ID)
     * @param {Function} callback - Function to call with progress data
     */
    subscribe(nodeId, callback) {
        this.listeners.set(nodeId, callback);
        console.log(`[ProgressWebSocket] Subscribed: ${nodeId} (${this.listeners.size} listeners)`);
    }

    /**
     * Unregister a listener
     * @param {string} nodeId - Identifier used during subscribe
     */
    unsubscribe(nodeId) {
        const existed = this.listeners.delete(nodeId);
        if (existed) {
            console.log(`[ProgressWebSocket] Unsubscribed: ${nodeId} (${this.listeners.size} listeners)`);
        }
    }

    /**
     * Get the latest cached progress data (future enhancement)
     */
    getLatestProgress() {
        // Future: cache last received progress
        return null;
    }
}

// Singleton instance
export const progressWebSocketManager = new ProgressWebSocketManager();

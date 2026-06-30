/**
 * EasyGallery.js
 * Compact persistent gallery for Easy mode.
 */

import Constants from '../../utils/Constants.js';

export default class EasyGallery {
    constructor(container, eventBus) {
        this.container = container;
        this.eventBus = eventBus;
        this.images = [];
        this._page = 0;
        this._pageSize = 4;
        this._fileInputId = `easy-import-${Math.random().toString(36).slice(2)}`;

        this.render();
        this.attachListeners();
        this._load();
    }

    _normalizeImageKey(url, imageName = '') {
        const explicit = String(imageName || '').trim();
        if (explicit) return explicit;
        const value = String(url || '').trim();
        if (!value) return '';
        return value.replace(/([?&])t=\d+/gi, '$1').replace(/[?&]$/, '');
    }

    _normalizeTimestamp(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value > 1e12 ? value : value * 1000;
        }
        if (typeof value === 'string') {
            const parsed = Date.parse(value);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
    }

    _getVisibleImages() {
        const start = Math.max(0, this._page * this._pageSize);
        return this.images.slice(start, start + this._pageSize);
    }

    render() {
        const visibleImages = this._getVisibleImages();
        const totalPages = Math.max(1, Math.ceil(this.images.length / this._pageSize));
        const showPager = this.images.length > this._pageSize;
        this.container.innerHTML = `
            <div class="easy-gallery">
                <div class="easy-gallery__controls">
                    <button class="goya-button" id="${this._fileInputId}-btn" type="button" title="Import an image into the canvas">Import Image</button>
                    <input id="${this._fileInputId}" type="file" accept="image/*" style="display:none" />
                </div>
                <h4 class="easy-gallery__title">Gallery</h4>
                ${showPager ? `
                    <div class="easy-gallery__pager">
                        <button class="goya-button easy-gallery__pager-btn" id="easy-gallery-prev" type="button" ${this._page <= 0 ? 'disabled' : ''}>Prev</button>
                        <span class="easy-gallery__pager-label">${this._page + 1} / ${totalPages}</span>
                        <button class="goya-button easy-gallery__pager-btn" id="easy-gallery-next" type="button" ${this._page >= totalPages - 1 ? 'disabled' : ''}>Next</button>
                    </div>
                ` : ''}
                <div class="easy-gallery__grid" id="easy-gallery-grid">
                    ${this.images.length === 0 ? '<p class="easy-gallery__empty">No images yet</p>' : this.renderImages(visibleImages)}
                </div>
            </div>
        `;
        this._bindImportControls();
        this._bindPagerControls();
    }

    renderImages(images) {
        return images.map((img) => {
            const safeName = this._escapeAttr(img.name || '');
            const safeAlt = this._escapeAttr(img.name || 'Generated image');
            return `
                <div class="easy-gallery__item" data-name="${safeName}">
                    <img src="${img.url}" alt="${safeAlt}" />
                    <div class="easy-gallery__item-actions">
                        <button class="goya-button" data-action="easy-gallery-import" data-name="${safeName}" type="button">Import</button>
                        <button class="goya-button" data-action="easy-gallery-remove" data-name="${safeName}" type="button">Delete</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    attachListeners() {
        this.eventBus.on('easy:generation:complete', (data) => {
            this.addImage(data.imageUrl, data.imageName);
        });
        this.eventBus.on('easy:gallery:add', (data) => {
            this.addImage(data.imageUrl, data.imageName);
        });

        this.container.addEventListener('click', (e) => {
            const actionButton = e.target.closest('[data-action]');
            if (actionButton) {
                const name = String(actionButton.dataset.name || '').trim();
                if (actionButton.dataset.action === 'easy-gallery-import') {
                    this.importImage(name);
                    return;
                }
                if (actionButton.dataset.action === 'easy-gallery-remove') {
                    this.removeImage(name);
                    return;
                }
            }
            const item = e.target.closest('.easy-gallery__item');
            if (item) {
                this.importImage(item.dataset.name || '');
            }
        });
    }

    _bindImportControls() {
        const btn = this.container.querySelector(`#${CSS.escape(this._fileInputId)}-btn`);
        const input = this.container.querySelector(`#${CSS.escape(this._fileInputId)}`);
        btn?.addEventListener('click', () => input?.click());
        input?.addEventListener('change', () => {
            try {
                const files = input.files;
                if (files && files.length > 0) {
                    this.eventBus.emit('canvas:import:files', { files });
                }
            } finally {
                if (input) input.value = '';
            }
        });
    }

    _bindPagerControls() {
        this.container.querySelector('#easy-gallery-prev')?.addEventListener('click', () => {
            if (this._page <= 0) return;
            this._page -= 1;
            this.render();
        });
        this.container.querySelector('#easy-gallery-next')?.addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(this.images.length / this._pageSize));
            if (this._page >= totalPages - 1) return;
            this._page += 1;
            this.render();
        });
    }

    async _load() {
        try {
            const tryFetch = async (path) => {
                const response = await fetch(path, { cache: 'no-store' });
                return response.ok ? response.json() : null;
            };
            const galleryBase = Constants.EASY_API_BASE || '/iamccs/goyai_easy';
            let list = await tryFetch(`${galleryBase}/gallery/list`);
            if (!list) list = await tryFetch(`${galleryBase}/gallery/list/`);
            if (!list) return;
            const rawItems = Array.isArray(list.items) ? list.items : [];
            this.images = rawItems.map((item, index) => {
                const name = typeof item === 'string' ? item : item.name || item.file || `image_${index}`;
                const url = typeof item === 'string'
                    ? `${galleryBase}/gallery/get?name=${encodeURIComponent(name)}`
                    : item.url || `${galleryBase}/gallery/get?name=${encodeURIComponent(name)}`;
                const sortTimestamp = this._normalizeTimestamp(item?.mtime ?? item?.timestamp ?? item?.created_at ?? item?.date) || Date.now();
                return { name, url, sortTimestamp };
            }).sort((left, right) => (right.sortTimestamp || 0) - (left.sortTimestamp || 0));
            this._page = 0;
            this.render();
        } catch (error) {
            console.warn('[EasyGallery] Failed to load gallery list', error);
            this.render();
        }
    }

    addImage(url, imageName = '') {
        const key = this._normalizeImageKey(url, imageName);
        if (!key) return;
        const nextItem = { name: key, url, sortTimestamp: Date.now() };
        const existingIndex = this.images.findIndex((item) => item.name === key);
        if (existingIndex >= 0) {
            this.images.splice(existingIndex, 1, nextItem);
        } else {
            this.images.unshift(nextItem);
        }
        this.images.sort((left, right) => (right.sortTimestamp || 0) - (left.sortTimestamp || 0));
        if (this.images.length > 40) this.images.length = 40;
        this._page = 0;
        this.render();
    }

    async importImage(name) {
        const img = this.images.find((entry) => entry.name === name);
        if (!img?.url) return;
        try {
            const response = await fetch(img.url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`Image import failed (${response.status})`);
            const blob = await response.blob();
            const safeName = String(img.name || `easy_gallery_${Date.now()}.png`).split(/[\\/]/).pop() || `easy_gallery_${Date.now()}.png`;
            const file = new File([blob], safeName, { type: blob.type || 'image/png' });
            this.eventBus.emit('canvas:import:files', { files: [file], source: 'easy-gallery' });
            this.eventBus.emit('status:message', `Imported ${safeName} to canvas`);
        } catch (error) {
            console.warn('[EasyGallery] Failed to import gallery image', error);
            this.eventBus.emit('status:message', `Gallery import failed: ${error?.message || error}`);
        }
    }

    async removeImage(name) {
        const index = this.images.findIndex((entry) => entry.name === name);
        if (index < 0) return;
        const removed = this.images[index];
        const galleryBase = Constants.EASY_API_BASE || '/iamccs/goyai_easy';
        try {
            const response = await fetch(`${galleryBase}/gallery/hide`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || data.error) throw new Error(data.error || `Gallery hide failed (${response.status})`);
            this.images.splice(index, 1);
            const totalPages = Math.max(1, Math.ceil(this.images.length / this._pageSize));
            this._page = Math.min(this._page, totalPages - 1);
            this.render();
            this.eventBus.emit('status:message', `Removed ${removed?.name || 'image'} from Easy gallery list`);
        } catch (error) {
            console.warn('[EasyGallery] Failed to hide gallery image', error);
            this.eventBus.emit('status:message', `Gallery delete failed: ${error?.message || error}`);
        }
    }

    _escapeAttr(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }
}

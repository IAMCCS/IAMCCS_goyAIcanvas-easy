export default class TransformMath {
    static normalize(transform = {}) {
        return {
            dx: Number.isFinite(transform.dx) ? transform.dx : 0,
            dy: Number.isFinite(transform.dy) ? transform.dy : 0,
            sx: Number.isFinite(transform.sx) ? (transform.sx || 1) : 1,
            sy: Number.isFinite(transform.sy) ? (transform.sy || 1) : 1,
            angle: Number.isFinite(transform.angle) ? transform.angle : 0,
            ax: Number.isFinite(transform.ax) ? transform.ax : 0,
            ay: Number.isFinite(transform.ay) ? transform.ay : 0,
        };
    }

    static compose(base = {}, delta = {}) {
        const a = TransformMath.normalize(base);
        const b = TransformMath.normalize(delta);
        return {
            dx: a.dx + b.dx,
            dy: a.dy + b.dy,
            sx: a.sx * b.sx,
            sy: a.sy * b.sy,
            angle: a.angle + b.angle,
            ax: a.ax + b.ax,
            ay: a.ay + b.ay,
        };
    }

    static inverse(transform = {}) {
        const t = TransformMath.normalize(transform);
        return {
            dx: -t.dx,
            dy: -t.dy,
            sx: t.sx === 0 ? 1 : 1 / t.sx,
            sy: t.sy === 0 ? 1 : 1 / t.sy,
            angle: -t.angle,
            ax: -t.ax,
            ay: -t.ay,
        };
    }

    static applyInverse(point, inverseTransform) {
        const inv = TransformMath.normalize(inverseTransform);
        let x = point.x + inv.dx + inv.ax;
        let y = point.y + inv.dy + inv.ay;
        if (inv.angle) {
            const cos = Math.cos(inv.angle);
            const sin = Math.sin(inv.angle);
            const rx = x * cos - y * sin;
            const ry = x * sin + y * cos;
            x = rx;
            y = ry;
        }
        x *= inv.sx;
        y *= inv.sy;
        return { x, y };
    }

    static transformPoint(point, transform = {}, options = {}) {
        const t = TransformMath.normalize(transform);
        const originX = Number.isFinite(options.originX) ? options.originX : 0;
        const originY = Number.isFinite(options.originY) ? options.originY : 0;
        const localX = point.x - originX;
        const localY = point.y - originY;
        const scaledX = localX * t.sx;
        const scaledY = localY * t.sy;
        const cos = Math.cos(t.angle);
        const sin = Math.sin(t.angle);
        const rotatedX = scaledX * cos - scaledY * sin;
        const rotatedY = scaledX * sin + scaledY * cos;
        return {
            x: rotatedX + originX + t.dx + t.ax,
            y: rotatedY + originY + t.dy + t.ay,
        };
    }

    static toMatrix(transform = {}, options = {}) {
        const t = TransformMath.normalize(transform);
        const originX = Number.isFinite(options.originX) ? options.originX : 0;
        const originY = Number.isFinite(options.originY) ? options.originY : 0;
        const cos = Math.cos(t.angle);
        const sin = Math.sin(t.angle);
        const a = cos * t.sx;
        const b = sin * t.sx;
        const c = -sin * t.sy;
        const d = cos * t.sy;
        const translateX = t.dx + t.ax;
        const translateY = t.dy + t.ay;
        return {
            a,
            b,
            c,
            d,
            e: originX + translateX - a * originX - c * originY,
            f: originY + translateY - b * originX - d * originY,
        };
    }

    static multiplyMatrices(left, right) {
        const l = left || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        const r = right || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        return {
            a: l.a * r.a + l.c * r.b,
            b: l.b * r.a + l.d * r.b,
            c: l.a * r.c + l.c * r.d,
            d: l.b * r.c + l.d * r.d,
            e: l.a * r.e + l.c * r.f + l.e,
            f: l.b * r.e + l.d * r.f + l.f,
        };
    }

    static applyMatrixToPoint(point, matrix) {
        const m = matrix || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        return {
            x: point.x * m.a + point.y * m.c + m.e,
            y: point.x * m.b + point.y * m.d + m.f,
        };
    }

    static fromMatrix(matrix, options = {}) {
        const m = matrix || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        const originX = Number.isFinite(options.originX) ? options.originX : 0;
        const originY = Number.isFinite(options.originY) ? options.originY : 0;
        const sx = Math.max(0.000001, Math.hypot(m.a, m.b));
        const sy = Math.max(0.000001, Math.hypot(m.c, m.d));
        const angle = Math.atan2(m.b, m.a);
        const dx = m.e - originX + m.a * originX + m.c * originY;
        const dy = m.f - originY + m.b * originX + m.d * originY;
        return {
            dx,
            dy,
            sx,
            sy,
            angle,
            ax: 0,
            ay: 0,
        };
    }

    static transformBounds(bounds = {}, transform = {}, options = {}) {
        const rect = bounds || { x: 0, y: 0, w: 1, h: 1 };
        const t = TransformMath.normalize(transform);
        if (t.dx === 0 && t.dy === 0 && t.sx === 1 && t.sy === 1 && t.angle === 0 && t.ax === 0 && t.ay === 0) {
            return { ...rect };
        }
        const points = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h },
        ].map((point) => TransformMath.transformPoint(point, t, options));
        return TransformMath.boundsFromPoints(points);
    }

    static transformBoundsWithMatrix(bounds = {}, matrix = null) {
        const rect = bounds || { x: 0, y: 0, w: 1, h: 1 };
        const points = [
            { x: rect.x, y: rect.y },
            { x: rect.x + rect.w, y: rect.y },
            { x: rect.x + rect.w, y: rect.y + rect.h },
            { x: rect.x, y: rect.y + rect.h },
        ].map((point) => TransformMath.applyMatrixToPoint(point, matrix));
        return TransformMath.boundsFromPoints(points);
    }

    static boundsFromPoints(points = []) {
        if (!Array.isArray(points) || !points.length) {
            return { x: 0, y: 0, w: 1, h: 1 };
        }
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        return {
            x: minX,
            y: minY,
            w: Math.max(1, maxX - minX),
            h: Math.max(1, maxY - minY),
        };
    }

    static mapPointToLayer(point, transform = {}, options = {}) {
        const t = TransformMath.normalize(transform);
        if (t.dx === 0 && t.dy === 0 && t.sx === 1 && t.sy === 1 && t.angle === 0 && t.ax === 0 && t.ay === 0) {
            return point;
        }
        const originX = Number.isFinite(options.originX) ? options.originX : 0;
        const originY = Number.isFinite(options.originY) ? options.originY : 0;
        const centered = {
            x: point.x - originX,
            y: point.y - originY,
        };
        const mapped = TransformMath.applyInverse(centered, TransformMath.inverse(t));
        return {
            x: mapped.x + originX,
            y: mapped.y + originY,
        };
    }

    static computeScalePreview(mode, dx, dy, bounds, angle = 0, keepAspect = true, minScale = 0.1) {
        const rect = bounds || { x: 0, y: 0, w: 1, h: 1 };
        const width = Math.max(1, rect.w);
        const height = Math.max(1, rect.h);
        const cos = Math.cos(-angle);
        const sin = Math.sin(-angle);
        const localDx = dx * cos - dy * sin;
        const localDy = dx * sin + dy * cos;
        const handleMap = {
            'scale-tl': { handleX: -width / 2, handleY: -height / 2, anchorX: width / 2, anchorY: height / 2, axis: 'xy' },
            'scale-tr': { handleX: width / 2, handleY: -height / 2, anchorX: -width / 2, anchorY: height / 2, axis: 'xy' },
            'scale-br': { handleX: width / 2, handleY: height / 2, anchorX: -width / 2, anchorY: -height / 2, axis: 'xy' },
            'scale-bl': { handleX: -width / 2, handleY: height / 2, anchorX: width / 2, anchorY: -height / 2, axis: 'xy' },
            'scale-t': { handleX: 0, handleY: -height / 2, anchorX: 0, anchorY: height / 2, axis: 'y' },
            'scale-r': { handleX: width / 2, handleY: 0, anchorX: -width / 2, anchorY: 0, axis: 'x' },
            'scale-b': { handleX: 0, handleY: height / 2, anchorX: 0, anchorY: -height / 2, axis: 'y' },
            'scale-l': { handleX: -width / 2, handleY: 0, anchorX: width / 2, anchorY: 0, axis: 'x' },
            scale: { handleX: width / 2, handleY: height / 2, anchorX: -width / 2, anchorY: -height / 2, axis: 'xy' },
        };
        const spec = handleMap[mode] || handleMap.scale;
        const draggedX = spec.handleX + localDx;
        const draggedY = spec.handleY + localDy;
        const baseSpanX = spec.handleX - spec.anchorX;
        const baseSpanY = spec.handleY - spec.anchorY;
        let sx = 1;
        let sy = 1;
        if (spec.axis === 'x' || spec.axis === 'xy') {
            sx = Math.max(minScale, (draggedX - spec.anchorX) / (baseSpanX || 1));
        }
        if (spec.axis === 'y' || spec.axis === 'xy') {
            sy = Math.max(minScale, (draggedY - spec.anchorY) / (baseSpanY || 1));
        }
        if (keepAspect) {
            if (spec.axis === 'x') {
                sy = sx;
            } else if (spec.axis === 'y') {
                sx = sy;
            } else {
                const uniform = Math.max(minScale, Math.max(Math.abs(sx), Math.abs(sy)));
                sx = uniform;
                sy = uniform;
            }
        }
        const localAx = spec.anchorX * (1 - sx);
        const localAy = spec.anchorY * (1 - sy);
        const worldCos = Math.cos(angle);
        const worldSin = Math.sin(angle);
        return {
            sx,
            sy,
            ax: localAx * worldCos - localAy * worldSin,
            ay: localAx * worldSin + localAy * worldCos,
        };
    }
}
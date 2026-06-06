/**
 * input.js
 * 处理用户输入（点击/触摸），将屏幕坐标转换为相机空间坐标，并进行碰撞检测
 */

class InputManager {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.camera = camera;
        this.onTap = null; // 回调函数，形如 (worldX, worldY) => {}

        // 绑定事件
        const handleEvent = (e) => {
            e.preventDefault();
            let clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            const rect = this.canvas.getBoundingClientRect();
            const screenX = clientX - rect.left;
            const screenY = clientY - rect.top;

            // 坐标映射：屏幕 -> 相机空间
            const worldPos = this.screenToWorld(screenX, screenY);

            if (this.onTap) {
                this.onTap(worldPos.x, worldPos.y);
            }
        };

        this.canvas.addEventListener('mousedown', handleEvent, { passive: false });
        this.canvas.addEventListener('touchstart', handleEvent, { passive: false });
    }

    /**
     * 将屏幕坐标转换为相对于相机的世界坐标
     * @param {number} screenX 
     * @param {number} screenY 
     * @returns {Object} {x, y}
     */
    screenToWorld(screenX, screenY) {
        const cw = this.canvas.clientWidth;
        const ch = this.canvas.clientHeight;
        
        // 与 renderer.js 的 applyCamera 逻辑逆推
        // this.ctx.translate(this.width / 2, this.height / 2);
        // this.ctx.scale(this.camera.scale, this.camera.scale);
        // this.ctx.translate(-this.width / 2 - this.camera.x, -this.height / 2 - this.camera.y);

        let x = screenX - cw / 2;
        let y = screenY - ch / 2;
        
        x = x / this.camera.scale;
        y = y / this.camera.scale;
        
        x = x + cw / 2 + this.camera.x;
        y = y + ch / 2 + this.camera.y;

        return { x, y };
    }

    /**
     * 碰撞检测：检查点是否在基于 Path2D 的拼图区域内
     * 因为 Canvas ctx.isPointInPath 需要当前上下文中存在路径，我们可以简易使用 AABB (轴对齐边界框) 快速检测
     * @param {number} x 世界坐标 x
     * @param {number} y 世界坐标 y
     * @param {Object} piece 拼图对象
     * @returns {boolean}
     */
    isPointInPiece(x, y, piece) {
        // AABB 简易判定 (由于带有 ear 凸出部分，我们可以稍微放宽范围，或者直接判断其基本宽高)
        const left = piece.currentX;
        const right = piece.currentX + piece.width;
        const top = piece.currentY;
        const bottom = piece.currentY + piece.height;

        return (x >= left && x <= right && y >= top && y <= bottom);
    }
}

// 兼容导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InputManager;
}

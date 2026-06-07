/**
 * input.js
 * 处理用户输入（点击/触摸），将屏幕坐标转换为相机空间坐标，并进行碰撞检测
 */

class InputManager {
    constructor(canvas, camera) {
        this.canvas = canvas;
        this.camera = camera;
        this.onPointerDown = null;
        this.onPointerMove = null;
        this.onPointerUp = null;

        this.isDragging = false;

        this.currentScreenX = -1000;
        this.currentScreenY = -1000;

        const getPos = (e) => {
            let clientX, clientY;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
                clientY = e.touches[0].clientY;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
                clientY = e.changedTouches[0].clientY;
            } else {
                clientX = e.clientX;
                clientY = e.clientY;
            }

            const rect = this.canvas.getBoundingClientRect();
            this.currentScreenX = clientX - rect.left;
            this.currentScreenY = clientY - rect.top;
            
            return this.screenToWorld(this.currentScreenX, this.currentScreenY);
        };

        const handleDown = (e) => {
            e.preventDefault();
            this.isDragging = true;
            const worldPos = getPos(e);
            
            // 为了兼容老代码的 onTap
            if (this.onTap) this.onTap(worldPos.x, worldPos.y);
            
            if (this.onPointerDown) this.onPointerDown(worldPos.x, worldPos.y);
        };

        const handleMove = (e) => {
            e.preventDefault(); // 无论是否 dragging 都阻止默认滑动（修复原生放大与黑边滚动问题）
            const worldPos = getPos(e); // 顺便更新 screen 坐标
            if (!this.isDragging) return;
            if (this.onPointerMove) this.onPointerMove(worldPos.x, worldPos.y);
        };

        const handleUp = (e) => {
            e.preventDefault();
            this.isDragging = false;
            const worldPos = getPos(e);
            if (this.onPointerUp) this.onPointerUp(worldPos.x, worldPos.y);
        };

        this.canvas.addEventListener('mousedown', handleDown, { passive: false });
        this.canvas.addEventListener('touchstart', handleDown, { passive: false });

        window.addEventListener('mousemove', handleMove, { passive: false });
        window.addEventListener('touchmove', handleMove, { passive: false });

        window.addEventListener('mouseup', handleUp, { passive: false });
        window.addEventListener('touchend', handleUp, { passive: false });
        window.addEventListener('touchcancel', handleUp, { passive: false });
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

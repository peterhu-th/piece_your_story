/**
 * renderer.js
 * 负责所有的 Canvas 2D 绘制逻辑和图片加载
 */

class Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { alpha: false }); // alpha: false 优化不透明背景性能
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        
        // 自动调整画布尺寸
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // 缓存的资源
        this.images = {};
        
        // 相机状态 (用于平滑 Zoom)
        this.camera = {
            x: 0,
            y: 0,
            scale: 1
        };
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        // 支持视网膜高分屏
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.scale(dpr, dpr);
    }

    /**
     * 预加载所有资源图片
     * @param {Array} srcList 图片路径数组
     * @returns {Promise}
     */
    async loadImages(srcList) {
        const promises = srcList.map(src => {
            return new Promise((resolve, reject) => {
                if (this.images[src]) return resolve(); // 已经加载过
                const img = new Image();
                img.onload = () => {
                    this.images[src] = img;
                    resolve();
                };
                img.onerror = () => reject(`无法加载图片: ${src}`);
                img.src = src;
            });
        });
        return Promise.all(promises);
    }

    getImage(src) {
        return this.images[src];
    }

    /**
     * 生成并缓存模糊版本的图像
     * @param {HTMLImageElement} img 
     * @param {number} blurRadius 
     * @returns {HTMLCanvasElement} 模糊后的离屏 Canvas
     */
    generateBlurredImage(img, blurRadius) {
        const offscreen = document.createElement('canvas');
        offscreen.width = img.width;
        offscreen.height = img.height;
        const offCtx = offscreen.getContext('2d');
        offCtx.filter = `blur(${blurRadius}px)`;
        offCtx.drawImage(img, 0, 0);
        return offscreen;
    }

    /**
     * 开始新的一帧绘制前，清除画布
     */
    clear() {
        this.ctx.fillStyle = '#0d0d0d';
        this.ctx.fillRect(0, 0, this.width, this.height);
    }

    /**
     * 应用相机变换
     */
    applyCamera() {
        this.ctx.save();
        // 以屏幕中心为缩放锚点
        this.ctx.translate(this.width / 2, this.height / 2);
        this.ctx.scale(this.camera.scale, this.camera.scale);
        this.ctx.translate(-this.width / 2 - this.camera.x, -this.height / 2 - this.camera.y);
    }

    /**
     * 恢复相机变换
     */
    restoreCamera() {
        this.ctx.restore();
    }

    /**
     * 辅助绘制：基于 cover 模式计算图片的绘制参数 (填充)
     */
    getCoverDrawParams(imgWidth, imgHeight, targetWidth, targetHeight, targetX = 0, targetY = 0) {
        const scale = Math.max(targetWidth / imgWidth, targetHeight / imgHeight);
        const w = imgWidth * scale;
        const h = imgHeight * scale;
        const x = targetX + (targetWidth - w) / 2;
        const y = targetY + (targetHeight - h) / 2;
        return { x, y, w, h, scale };
    }

    /**
     * 辅助绘制：基于 contain 模式计算图片的绘制参数 (完整显示)
     */
    getContainDrawParams(imgWidth, imgHeight, targetWidth, targetHeight, targetX = 0, targetY = 0) {
        const scale = Math.min(targetWidth / imgWidth, targetHeight / imgHeight);
        const w = imgWidth * scale;
        const h = imgHeight * scale;
        const x = targetX + (targetWidth - w) / 2;
        const y = targetY + (targetHeight - h) / 2;
        return { x, y, w, h, scale };
    }

    /**
     * 在大厅墙壁上绘制关卡画框和模糊预览图
     * 使用预合成 (Pre-composition) 策略保证对齐
     */
    drawLobby(wallImgSrc, levelsData, blurImagesCache, globalAlpha = 1) {
        if (globalAlpha < 1) {
            this.ctx.globalAlpha = globalAlpha;
        }

        const wallImg = this.getImage(wallImgSrc);
        if (!wallImg) return;

        // 预合成
        if (!this.lobbyCanvas) {
            this.lobbyCanvas = document.createElement('canvas');
            this.lobbyCanvas.width = wallImg.width;
            this.lobbyCanvas.height = wallImg.height;
            const lctx = this.lobbyCanvas.getContext('2d');
            
            lctx.drawImage(wallImg, 0, 0);

            for (const level of levelsData) {
                const rect = level.lobbyFrameRect;
                const drawX = rect.x * wallImg.width;
                const drawY = rect.y * wallImg.height;
                const drawW = rect.width * wallImg.width;
                const drawH = rect.height * wallImg.height;

                const blurImg = blurImagesCache[level.image];
                if (blurImg) {
                    lctx.save();
                    lctx.beginPath();
                    lctx.rect(drawX, drawY, drawW, drawH);
                    lctx.clip(); 
                    
                    const scale = Math.max(drawW / blurImg.width, drawH / blurImg.height);
                    const bw = blurImg.width * scale;
                    const bh = blurImg.height * scale;
                    const bx = drawX + (drawW - bw) / 2;
                    const by = drawY + (drawH - bh) / 2;
                    
                    lctx.drawImage(blurImg, bx, by, bw, bh);
                    
                    lctx.strokeStyle = 'rgba(0,0,0,0.5)';
                    lctx.lineWidth = 4;
                    lctx.strokeRect(drawX, drawY, drawW, drawH);
                    lctx.restore();
                }
            }
        }

        // Contain 模式完整显示
        const params = this.getContainDrawParams(this.lobbyCanvas.width, this.lobbyCanvas.height, this.width, this.height);
        this.ctx.drawImage(this.lobbyCanvas, params.x, params.y, params.w, params.h);

        this.ctx.globalAlpha = 1;
    }

    /**
     * 绘制游戏状态时的底图 (模糊与清晰图层)
     */
    drawGameBackground(clearImgSrc, blurImg, renderParams, blurAlpha = 1) {
        const clearImg = this.getImage(clearImgSrc);
        if (!clearImg) return;
        
        const params = this.getContainDrawParams(clearImg.width, clearImg.height, this.width, this.height);
        
        // 渲染清晰底图
        this.ctx.drawImage(clearImg, params.x, params.y, params.w, params.h);
        
        // 叠加模糊层
        if (blurAlpha > 0 && blurImg) {
            this.ctx.save();
            this.ctx.globalAlpha = blurAlpha;
            this.ctx.drawImage(blurImg, params.x, params.y, params.w, params.h);
            this.ctx.restore();
        }

        // 导出此时的图片相对于屏幕的真实渲染位置，用于 core.js 计算边界盒物理位置
        if (renderParams) {
            renderParams.bgX = params.x;
            renderParams.bgY = params.y;
            renderParams.bgW = params.w;
            renderParams.bgH = params.h;
        }
    }

    /**
     * 绘制等待拼合的区域边框 (提示区域)
     */
    drawCutoutBorder(box) {
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([5, 5]); // 虚线边框
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);
        this.ctx.restore();
    }

    /**
     * 绘制单个拼图碎片
     * @param {Object} piece 碎片对象
     * @param {HTMLImageElement} sourceImg 原图
     * @param {Object} renderParams 全局渲染参数 (提供背景的位置以便映射纹理)
     * @param {Object} edgeConfig 碎片描边配置
     */
    drawPiece(piece, sourceImg, renderParams, edgeConfig) {
        this.ctx.save();
        
        // 移动到碎片的当前坐标
        this.ctx.translate(piece.currentX, piece.currentY);
        
        // 应用对应的拼图路径裁剪
        this.ctx.beginPath();
        const path = piece.path2d; // 从 templates.js 生成的 Path2D
        this.ctx.clip(path);

        // 映射源图像纹理
        // 因为 sourceImg 是按 Cover 渲染到屏幕的 renderParams (bgX, bgY, bgW, bgH)
        // 碎片的目标位置是 piece.targetX, piece.targetY
        // 所以在 clip 内部画出对应的原图部分，需要计算偏移
        const dx = renderParams.bgX - piece.targetX;
        const dy = renderParams.bgY - piece.targetY;
        
        this.ctx.drawImage(sourceImg, dx, dy, renderParams.bgW, renderParams.bgH);

        // 描边，增加立体感和边界识别
        if (edgeConfig && edgeConfig.edgeStrokeWidth > 0) {
            this.ctx.strokeStyle = edgeConfig.edgeStrokeColor;
            this.ctx.lineWidth = edgeConfig.edgeStrokeWidth;
            this.ctx.stroke(path);
        }

        this.ctx.restore();
    }

    /**
     * 绘制纯文本
     */
    drawText(text, x, y, size, alpha = 1) {
        this.ctx.save();
        this.ctx.globalAlpha = alpha;
        this.ctx.font = `${size}px sans-serif`;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        this.ctx.shadowBlur = 4;
        this.ctx.fillText(text, x, y);
        this.ctx.restore();
    }
}

// 兼容导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Renderer;
}

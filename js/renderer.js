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
     * 计算保持比例填充目标区域（多余部分会被裁切）的绘制参数
     * (Cover 逻辑，用于消除白边)
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
     * 在大厅墙壁上绘制关卡画框和模糊预览图
     * 使用预合成 (Pre-composition) 策略保证对齐
     */
    drawLobby(wallImgSrc, levelsData, blurImagesCache, globalAlpha = 1, currentLevelIndex = 0, levelStars = []) {
        if (globalAlpha < 1) {
            this.ctx.globalAlpha = globalAlpha;
        }

        const wallImg = this.getImage(wallImgSrc);
        if (!wallImg) return;

        // 预合成
        if (!this.lobbyCanvas || this.lobbyCachedLevelIndex !== currentLevelIndex) {
            this.lobbyCanvas = document.createElement('canvas');
            this.lobbyCanvas.width = wallImg.width;
            this.lobbyCanvas.height = wallImg.height;
            const lctx = this.lobbyCanvas.getContext('2d');
            
            lctx.drawImage(wallImg, 0, 0);

            for (let i = 0; i < levelsData.length; i++) {
                const level = levelsData[i];
                const isCompleted = i < currentLevelIndex;
                
                // 如果已完成，则不画模糊蒙版，直接露出 wall.png 里原本的清晰图片
                if (!isCompleted) {
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
            this.lobbyCachedLevelIndex = currentLevelIndex;
        }

        // Contain 模式完整显示
        const params = this.getContainDrawParams(this.lobbyCanvas.width, this.lobbyCanvas.height, this.width, this.height);
        this.ctx.drawImage(this.lobbyCanvas, params.x, params.y, params.w, params.h);

        // 绘制当前可解锁关卡的呼吸发光边框
        if (currentLevelIndex < levelsData.length) {
            const currentLevel = levelsData[currentLevelIndex];
            this._drawGlowFrame(currentLevel.lobbyFrameRect, params, 'normal');
        }

        this.ctx.globalAlpha = 1;
    }

    _drawGlowFrame(rect, params, type) {
        const drawX = params.x + rect.x * params.w;
        const drawY = params.y + rect.y * params.h;
        const drawW = rect.width * params.w;
        const drawH = rect.height * params.h;

        const cx = drawX + drawW / 2;
        const cy = drawY + drawH / 2;
        const maxR = Math.max(drawW, drawH) * 0.8;

        const glowAlpha = (Math.sin(Date.now() / 300) + 1) / 2 * 0.5 + 0.3; // 0.3 to 0.8
        
        const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
        if (type === 'gold') {
            gradient.addColorStop(0, `rgba(255, 215, 0, ${glowAlpha})`);
            gradient.addColorStop(0.5, `rgba(255, 165, 0, ${glowAlpha * 0.3})`);
            gradient.addColorStop(1, `rgba(255, 140, 0, 0)`);
            
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'screen';
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(drawX, drawY, drawW, drawH);
            
            this.ctx.strokeStyle = `rgba(255, 215, 0, ${glowAlpha * 0.8})`;
            this.ctx.lineWidth = 5;
            this.ctx.strokeRect(drawX, drawY, drawW, drawH);
            this.ctx.restore();
        } else {
            gradient.addColorStop(0, `rgba(255, 235, 180, ${glowAlpha})`);
            gradient.addColorStop(0.5, `rgba(255, 200, 100, ${glowAlpha * 0.3})`);
            gradient.addColorStop(1, `rgba(255, 180, 80, 0)`);
            
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'screen';
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(drawX, drawY, drawW, drawH);
            
            this.ctx.strokeStyle = `rgba(255, 215, 120, ${glowAlpha * 0.8})`;
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(drawX, drawY, drawW, drawH);
            this.ctx.restore();
        }

        this.ctx.globalAlpha = 1;
    }

    /**
     * 绘制游戏状态时的底图 (模糊与清晰图层)
     */
    drawGameBackground(clearImgSrc, blurImg, renderParams, blurAlpha = 1) {
        const clearImg = this.getImage(clearImgSrc);
        if (!clearImg) return;
        
        // 优先使用传入的静态物理位置参数，确保与初始化时计算的切块坐标绝对对齐
        let drawX, drawY, drawW, drawH;
        if (renderParams && renderParams.w !== undefined) {
            drawX = renderParams.x;
            drawY = renderParams.y;
            drawW = renderParams.w;
            drawH = renderParams.h;
        } else {
            const params = this.getContainDrawParams(clearImg.width, clearImg.height, this.width, this.height);
            drawX = params.x;
            drawY = params.y;
            drawW = params.w;
            drawH = params.h;
            
            // 导出计算出的参数
            if (renderParams) {
                renderParams.x = params.x;
                renderParams.y = params.y;
                renderParams.w = params.w;
                renderParams.h = params.h;
            }
        }
        
        // 渲染清晰底图
        this.ctx.drawImage(clearImg, drawX, drawY, drawW, drawH);
        
        // 叠加模糊层
        if (blurAlpha > 0 && blurImg) {
            this.ctx.save();
            this.ctx.globalAlpha = blurAlpha;
            this.ctx.drawImage(blurImg, drawX, drawY, drawW, drawH);
            this.ctx.restore();
        }
    }

    /**
     * 在指定的矩形区域内绘制关卡原图（用于 drag 模式的相框）
     */
    drawLevelImageRect(clearImgSrc, blurImg, rect, blurAlpha = 1) {
        const clearImg = this.getImage(clearImgSrc);
        if (!clearImg) return;
        
        // 渲染清晰底图
        // 【修复】：兼容 rect.w 和 rect.width
        const w = rect.w !== undefined ? rect.w : rect.width;
        const h = rect.h !== undefined ? rect.h : rect.height;
        this.ctx.drawImage(clearImg, rect.x, rect.y, w, h);
        
        // 叠加模糊层
        if (blurAlpha > 0 && blurImg) {
            this.ctx.save();
            this.ctx.globalAlpha = blurAlpha;
            this.ctx.drawImage(blurImg, rect.x, rect.y, w, h);
            this.ctx.restore();
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

        if (piece.rotation) {
            // 绕着碎片自身中心旋转
            this.ctx.translate(piece.width / 2, piece.height / 2);
            this.ctx.rotate(piece.rotation);
            this.ctx.translate(-piece.width / 2, -piece.height / 2);
        }
        
        // 应用对应的拼图路径裁剪
        this.ctx.beginPath();
        const path = piece.path2d; // 从 templates.js 生成的 Path2D
        this.ctx.clip(path);

        // 映射源图像纹理
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
     * 绘制普通文字，支持自动换行
     */
    drawText(text, x, y, fontSize = 24, alpha = 1) {
        this.ctx.save();
        this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        this.ctx.font = `${fontSize}px sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // 增加投影增加可读性
        this.ctx.shadowColor = 'rgba(0,0,0,0.8)';
        this.ctx.shadowBlur = 4;
        this.ctx.shadowOffsetY = 2;

        const maxWidth = this.width * 0.8;
        const lineHeight = fontSize * 1.5;
        
        // 中文按字拆分
        const words = text.split('');
        let line = '';
        let currentY = y;
        
        // 先计算总高度，为了在y处垂直居中整个文本块
        let lines = [];
        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n];
            let metrics = this.ctx.measureText(testLine);
            if (metrics.width > maxWidth && n > 0) {
                lines.push(line);
                line = words[n];
            } else {
                line = testLine;
            }
        }
        lines.push(line);
        
        const totalHeight = lines.length * lineHeight;
        let startY = y - totalHeight / 2 + lineHeight / 2;

        for (let i = 0; i < lines.length; i++) {
            this.ctx.fillText(lines[i], x, startY + i * lineHeight);
        }

        this.ctx.restore();
    }

    /**
     * 绘制带样式的关卡文案（也使用换行支持）
     */
    drawLevelText({ text, x, y, alpha }) {
        this.drawText(text, x, y, 28, alpha);
    }

    /**
     * 绘制雨滴粒子
     */
    drawRain(particles, levelsData, currentLevelIndex, params) {
        this.ctx.save();
        
        // 如果传入了 params，则应用遮罩，将雨滴限制在背景图范围内
        if (params) {
            this.ctx.beginPath();
            this.ctx.rect(params.x, params.y, params.w, params.h);
            this.ctx.clip(); // 仅允许在背景图内部绘制
        }

        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const len = p.length;
            const speed = Math.hypot(p.vx, p.vy);
            const dx = (p.vx / speed) * len;
            const dy = (p.vy / speed) * len;
            
            this.ctx.moveTo(p.x, p.y);
            this.ctx.lineTo(p.x + dx, p.y + dy);
        }
        this.ctx.stroke();
        this.ctx.restore();
    }



    /**
     * 绘制主大厅的探照灯效果
     */
    drawLobbySpotlight(mouseX, mouseY, levelsData, currentLevelIndex, params, radiusRatio = 0.3, globalAlpha = 1) {
        if (globalAlpha <= 0) return;

        // 如果是手机端（未发生交互前坐标为初始值），直接照亮当前进度照片
        if (mouseX <= -900 && mouseY <= -900) {
            const currentLevel = levelsData[currentLevelIndex];
            if (currentLevel) {
                const rect = currentLevel.lobbyFrameRect;
                mouseX = params.x + (rect.x + rect.width / 2) * params.w;
                mouseY = params.y + (rect.y + rect.height / 2) * params.h;
            } else {
                mouseX = this.width / 2;
                mouseY = this.height / 2;
            }
        }

        // 初始化或调整离屏黑幕画布的大小
        if (!this.darkCanvas || this.darkCanvas.width !== this.width || this.darkCanvas.height !== this.height) {
            if (!this.darkCanvas) this.darkCanvas = document.createElement('canvas');
            this.darkCanvas.width = this.width;
            this.darkCanvas.height = this.height;
            this.darkCtx = this.darkCanvas.getContext('2d');
        }

        const dctx = this.darkCtx;
        
        // 1. 先铺满黑底
        dctx.globalCompositeOperation = 'source-over';
        dctx.clearRect(0, 0, this.width, this.height);
        dctx.fillStyle = 'rgba(0,0,0,0.95)';
        dctx.fillRect(0, 0, this.width, this.height);

        // 2. 使用 destination-out 将光照区域的黑色挖空
        dctx.globalCompositeOperation = 'destination-out';
        
        const radius = Math.max(this.width, this.height) * radiusRatio; // 灯光范围
        
        // 挖除鼠标探照灯
        const mouseGradient = dctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, radius);
        mouseGradient.addColorStop(0, 'rgba(0,0,0,1)');
        mouseGradient.addColorStop(0.3, 'rgba(0,0,0,0.8)');
        mouseGradient.addColorStop(0.8, 'rgba(0,0,0,0.1)');
        mouseGradient.addColorStop(1, 'rgba(0,0,0,0)');
        dctx.fillStyle = mouseGradient;
        dctx.fillRect(0, 0, this.width, this.height);

        // 挖除已通关的画作（作为额外发光源）
        if (levelsData && params) {
            for (let i = 0; i < currentLevelIndex && i < levelsData.length; i++) {
                const rect = levelsData[i].lobbyFrameRect;
                const cx = params.x + (rect.x + rect.width / 2) * params.w;
                const cy = params.y + (rect.y + rect.height / 2) * params.h;
                
                const frameGradient = dctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
                frameGradient.addColorStop(0, 'rgba(0,0,0,1)');
                frameGradient.addColorStop(0.3, 'rgba(0,0,0,0.8)');
                frameGradient.addColorStop(0.8, 'rgba(0,0,0,0.1)');
                frameGradient.addColorStop(1, 'rgba(0,0,0,0)');
                
                dctx.fillStyle = frameGradient;
                dctx.fillRect(0, 0, this.width, this.height);
            }
        }

        // 3. 恢复源覆盖模式，覆盖未解锁的画作使之保持漆黑
        dctx.globalCompositeOperation = 'source-over';
        dctx.fillStyle = 'rgba(0,0,0,0.95)';
        if (levelsData && params) {
            for (let i = currentLevelIndex + 1; i < levelsData.length; i++) {
                const rect = levelsData[i].lobbyFrameRect;
                const drawX = params.x + rect.x * params.w;
                const drawY = params.y + rect.y * params.h;
                const drawW = rect.width * params.w;
                const drawH = rect.height * params.h;
                dctx.fillRect(drawX, drawY, drawW, drawH);
            }
        }
        
        // 4. 将离屏画布混合到主画布上
        this.ctx.save();
        this.ctx.globalAlpha = globalAlpha;
        this.ctx.drawImage(this.darkCanvas, 0, 0);
        this.ctx.restore();
    }

    /**
     * 绘制游戏开始界面
     */
    drawStartScreen(wallImgSrc, params) {
        // 画变暗的背景
        this.drawGameBackground(wallImgSrc, null, params, 0);
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(0, 0, this.width, this.height);
        
        this.ctx.save();
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        // 游戏标题
        this.ctx.fillStyle = '#fff';
        this.ctx.font = 'bold 56px sans-serif';
        this.ctx.shadowColor = 'rgba(0,0,0,0.8)';
        this.ctx.shadowBlur = 10;
        this.ctx.fillText("Piece Your Story", this.width / 2, this.height * 0.4);
        
        // 开始提示
        const alpha = (Math.sin(Date.now() / 300) + 1) / 2 * 0.5 + 0.3; // 呼吸闪烁
        this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        this.ctx.font = '24px sans-serif';
        this.ctx.fillText("点击任意处开始游戏", this.width / 2, this.height * 0.7);
        
        this.ctx.restore();
    }
}

// 兼容导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Renderer;
}

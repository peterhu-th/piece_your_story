/**
 * core.js
 * 游戏主程序，包含状态机、物理引擎、事件处理与游戏循环
 */

class GameCore {
    constructor() {
        this.config = GameConfig;
        this.renderer = new Renderer('gameCanvas');
        this.input = new InputManager(this.renderer.canvas, this.renderer.camera);
        
        // 绑定点击事件
        this.input.onTap = this.handleTap.bind(this);

        this.STATES = {
            LOADING: 0,
            START: 7,   // 开始界面
            LOBBY: 1,
            INTRO: 2,   // 放大镜头
            PLAY: 3,    // 游玩
            SETTLE: 4,  // 拼完，缩小镜头，显示文字
            END: 5,     // 终局轮播
            VIEW_COMPLETED: 6 // 观看已完成的画作
        };
        this.currentState = this.STATES.LOADING;
        
        // 关卡进度（按照用户要求，刷新页面重置状态，不再读取 localStorage）
        this.currentLevelIndex = 0;
        this.viewingLevelIndex = 0;
        this.viewingLevelIndex = 0;

        // 运行时数据
        this.blurCache = {}; // 缓存每关模糊图
        this.pieces = [];    // 当前关卡的拼图碎片
        this.bgParams = {};  // 背景的真实渲染尺寸和位置
        this.cutoutBox = {}; // 挖空区域的真实坐标和宽高
        this.lastTime = performance.now();
        
        this.stateStartTime = 0; // 记录状态切换的时间点，用于动画过渡
        this.isSpawning = false; // 控制是否正在等待生成新碎片
        
        // 终局动画专用
        this.endingSlideIndex = 0;
        this.endingLastSlideTime = 0;

        // 星级与游玩数据记录
        // 竞技元素（星级与时间）已移除
        
        // 雨滴粒子系统
        this.rainParticles = [];
        this.initRain();

        // 音频系统
        this.bgmAudio = new Audio(this.config.audio.bgm);
        this.bgmAudio.loop = true;
        this.drumAudio = new Audio(this.config.audio.drum);

        // 启动游戏
        this.init();
        this.setupPointerEvents();
    }

    initRain() {
        const count = 100;
        this.rainParticles = [];
        const cw = window.innerWidth * (window.devicePixelRatio || 1);
        const ch = window.innerHeight * (window.devicePixelRatio || 1);
        
        for(let i = 0; i < count; i++) {
            this.rainParticles.push({
                x: Math.random() * cw,
                y: Math.random() * ch,
                vx: -8 - Math.random() * 4, // 强风斜向吹
                vy: 20 + Math.random() * 10, // 较快的下落速度
                length: 25 + Math.random() * 15
            });
        }
    }

    async init() {
        try {
            // 收集所有需要预加载的图片
            const imagePaths = [this.config.lobby.wallImage, this.config.pieces.dragMode.backgroundImage];
            this.config.levels.forEach(l => {
                imagePaths.push(l.image);
                if (l.successWordImage) imagePaths.push(l.successWordImage); 
            });

            if (this.config.ending.finalImage) {
                imagePaths.push(this.config.ending.finalImage);
            }

            await this.renderer.loadImages(imagePaths);
            
            // 预生成模糊图片，防止游戏过程中卡顿
            this.config.levels.forEach(l => {
                const img = this.renderer.getImage(l.image);
                const blurRadius = this.config.core.lobbyBlurRadius || this.config.core.blurRadius;
                this.blurCache[l.image] = this.renderer.generateBlurredImage(img, blurRadius);
            });

            // 进入开始界面
            this.switchState(this.STATES.START);
            
            // 开始循环
            requestAnimationFrame((time) => this.loop(time));

        } catch (error) {
            console.error(error);
            document.getElementById('uiLayer').innerText = this.config.ui.errorPrompt;
        }
    }

    switchState(newState) {
        this.currentState = newState;
        this.stateStartTime = performance.now();
        const uiLayer = document.getElementById('uiLayer');
        uiLayer.innerText = ''; // 清空提示

        if (newState === this.STATES.LOBBY) {
            // 恢复相机
            this.renderer.camera.x = 0;
            this.renderer.camera.y = 0;
            this.renderer.camera.scale = 1;
            uiLayer.innerText = "";
        } 
        else if (newState === this.STATES.INTRO) {
            this.prepareLevel(this.config.levels[this.currentLevelIndex]);
            if (this.bgmAudio.paused) {
                this.bgmAudio.play().catch(e => console.log('BGM wait interaction'));
            }
        }
        else if (newState === this.STATES.PLAY) {

            const waitingPieces = this.pieces.filter(p => p.state === 'WAITING');
            waitingPieces.sort(() => Math.random() - 0.5);

            const mode = this.config.levels[this.currentLevelIndex].playMode || "timing";
            
            const initialCount = mode === "drag"
                ? waitingPieces.length
                : Math.min(waitingPieces.length, this.config.pieces.maxConcurrentPieces);

            for(let i=0; i<initialCount; i++) {
                waitingPieces[i].spawn();
            }
            this.isSpawning = false;
        }
        else if (newState === this.STATES.SETTLE) {
            // 结算阶段（计算并存储星级）
            // 竞技元素（星级与时间）已移除
        }
        else if (newState === this.STATES.END) {
            this.endingSlideIndex = 0;
            this.endingLastSlideTime = performance.now();
        }
    }

    /**
     * 准备关卡：计算裁剪区域、生成拼图碎片网格
     */
    prepareLevel(levelData) {
        const mode = levelData.playMode || "timing";
        
        if (mode === "drag") {
            const dragConf = this.config.pieces.dragMode;
            const bgImg = this.renderer.getImage(dragConf.backgroundImage);
            this.bgParams = this.renderer.getContainDrawParams(bgImg.width, bgImg.height, this.renderer.width, this.renderer.height);
            
            // 拼图相框物理区域
            const frameRect = {
                x: this.bgParams.x + dragConf.frameRect.x * this.bgParams.w,
                y: this.bgParams.y + dragConf.frameRect.y * this.bgParams.h,
                width: dragConf.frameRect.width * this.bgParams.w,
                height: dragConf.frameRect.height * this.bgParams.h
            };
            
            // 严格无白边地将原图填满相框（多余部分轻微裁切），消除两边透明缝隙
            const levelImg = this.renderer.getImage(levelData.image);
            this.coverParams = this.renderer.getCoverDrawParams(
                levelImg.width, levelImg.height, frameRect.width, frameRect.height, frameRect.x, frameRect.y
            );
            
            // 拼图相框区域（必须严格等于相框物理区域，防止拼图碎片溢出画框）
            this.puzzleRect = frameRect;
            
            // 拼图切块区域（相当于把原图缩放并放在 puzzleRect 中，然后再依据 cutoutBoundary 切割）
            this.cutoutBox = {
                x: this.puzzleRect.x + levelData.cutoutBoundary.x * this.puzzleRect.width,
                y: this.puzzleRect.y + levelData.cutoutBoundary.y * this.puzzleRect.height,
                width: levelData.cutoutBoundary.width * this.puzzleRect.width,
                height: levelData.cutoutBoundary.height * this.puzzleRect.height
            };
        } else {
            const img = this.renderer.getImage(levelData.image);
            this.bgParams = this.renderer.getContainDrawParams(img.width, img.height, this.renderer.width, this.renderer.height);
            
            this.cutoutBox = {
                x: this.bgParams.x + levelData.cutoutBoundary.x * this.bgParams.w,
                y: this.bgParams.y + levelData.cutoutBoundary.y * this.bgParams.h,
                width: levelData.cutoutBoundary.width * this.bgParams.w,
                height: levelData.cutoutBoundary.height * this.bgParams.h
            };
        }

        // 按网格拆分碎片
        this.pieces = [];
        if (levelData.shapeTemplate === "tangram") {
            const shapes = Templates.getTangramShapes(this.cutoutBox.width, this.cutoutBox.height);
            shapes.forEach(shape => {
                this.pieces.push({
                    id: shape.id,
                    width: shape.width,
                    height: shape.height,
                    targetX: this.cutoutBox.x + shape.x,
                    targetY: this.cutoutBox.y + shape.y,
                    edges: {},
                    path2d: shape.path2d,
                    state: 'WAITING',
                    currentX: 0,
                    currentY: 0,
                    speedX: 0,
                    speedY: 0,
                    zIndex: Math.random()
                });
            });
        } else {
            const cols = levelData.grid.cols;
            const rows = levelData.grid.rows;
            const pieceW = this.cutoutBox.width / cols;
            const pieceH = this.cutoutBox.height / rows;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    // 决定边缘的凹凸形状 (0: 平, 1: 凸, -1: 凹)
                    const edges = {
                        top: r === 0 ? 0 : (Math.random() > 0.5 ? 1 : -1),
                        bottom: r === rows - 1 ? 0 : (Math.random() > 0.5 ? 1 : -1),
                        left: c === 0 ? 0 : (Math.random() > 0.5 ? 1 : -1),
                        right: c === cols - 1 ? 0 : (Math.random() > 0.5 ? 1 : -1)
                    };

                // 为了让相邻的边严丝合缝，如果前一个块的右边是凸(1)，则当前块的左边必须是凹(-1)
                // 这里需要简单的联动修正
                if (c > 0) {
                    const leftPiece = this.pieces[this.pieces.length - 1];
                    edges.left = -leftPiece.edges.right;
                }
                if (r > 0) {
                    const topPiece = this.pieces[(r - 1) * cols + c];
                    edges.top = -topPiece.edges.bottom;
                }

                const targetX = this.cutoutBox.x + c * pieceW;
                const targetY = this.cutoutBox.y + r * pieceH;

                const path = Templates.getJigsawPath(pieceW, pieceH, edges);

                this.pieces.push({
                    id: `${r}-${c}`,
                    width: pieceW,
                    height: pieceH,
                    targetX: targetX,
                    targetY: targetY,
                    edges: edges,
                    path2d: path,
                    state: 'WAITING', // WAITING, MOVING, FALLING, PLACED
                    currentX: 0,
                    currentY: 0,
                    speedX: 0,
                    speedY: 0,
                    zIndex: Math.random(),
                    spawn: () => {}
                });
            }
        }
        }
        
        this.pieces.forEach(p => {
            p.spawn = () => {
                if (mode === "drag") {
                    const dragConf = this.config.pieces.dragMode;
                    const scatterMinY = this.bgParams.y + this.bgParams.h * dragConf.scatterAreaY.min;
                    // 【修复】：防止碎片过大导致 max 小于 min 的溢出问题
                    const scatterMaxY = Math.max(scatterMinY, this.bgParams.y + this.bgParams.h * dragConf.scatterAreaY.max - p.height);
                    const spawnY = scatterMinY + Math.random() * (scatterMaxY - scatterMinY);
                    
                    const scatterMinX = this.bgParams.x;
                    // 【修复】：同理，修复 X 轴溢出
                    const scatterMaxX = Math.max(scatterMinX, this.bgParams.x + this.bgParams.w - p.width);
                    const spawnX = scatterMinX + Math.random() * (scatterMaxX - scatterMinX);
                    
                    p.state = 'MOVING'; // 在拖拽模式下，MOVING表示自由散落状态
                    p.currentX = spawnX;
                    p.currentY = spawnY;
                    p.spawnX = spawnX;
                    p.spawnY = spawnY;
                    p.rotation = (dragConf.scatterRotation.min + Math.random() * (dragConf.scatterRotation.max - dragConf.scatterRotation.min)) * Math.PI / 180;
                    if (levelData.noRotation) {
                        p.rotation = 0;
                    }
                } else {
                    const conf = this.config.pieces;
                    const trackY = this.renderer.height * conf.yPositionTracks[Math.floor(Math.random() * conf.yPositionTracks.length)];
                    const speed = conf.speedRange.min + Math.random() * (conf.speedRange.max - conf.speedRange.min);
                    const isLeft = Math.random() < conf.directionProb;

                    const worldPosLeft = this.input.screenToWorld(-p.width - 100, trackY);
                    const worldPosRight = this.input.screenToWorld(this.renderer.width + 100, trackY);

                    p.state = 'MOVING';
                    // 【修复】：直接使用轨道高度，不再强行受 cutoutBox.y 挤压飞出屏幕
                    p.currentY = worldPosLeft.y;

                    if (isLeft) {
                        p.currentX = worldPosRight.x;
                        p.speedX = -speed / this.renderer.camera.scale;
                    } else {
                        p.currentX = worldPosLeft.x;
                        p.speedX = speed / this.renderer.camera.scale;
                    }
                    p.speedY = 0;
                    p.rotation = 0;
                }
            };
        });
    }

    /**
     * 设置多端指针事件
     */
    setupPointerEvents() {
        this.draggedPiece = null;
        this.dragOffsetX = 0;
        this.dragOffsetY = 0;

        this.input.onPointerDown = (wx, wy) => {
            if (this.currentState === this.STATES.PLAY) {
                const mode = this.config.levels[this.currentLevelIndex].playMode || "timing";
                
                if (mode === "drag") {
                    let hitPieces = this.pieces.filter(p => (p.state === 'MOVING' || p.state === 'RETURNING') && this.input.isPointInPiece(wx, wy, p));
                    if (hitPieces.length > 0) {
                        hitPieces.sort((a, b) => b.zIndex - a.zIndex);
                        this.draggedPiece = hitPieces[0];
                        this.draggedPiece.state = 'DRAGGING';
                        this.draggedPiece.zIndex = Math.max(...this.pieces.map(p => p.zIndex)) + 1; // 提升层级到最上层
                        this.dragOffsetX = this.draggedPiece.currentX - wx;
                        this.dragOffsetY = this.draggedPiece.currentY - wy;
                    }
                } else {
                    // Timing 模式：交由 handleTap 处理
                }
            } else {
                // 非 PLAY 状态交给 handleTap
                this.handleTap(wx, wy);
            }
        };

        this.input.onPointerMove = (wx, wy) => {
            if (this.draggedPiece) {
                this.draggedPiece.currentX = wx + this.dragOffsetX;
                this.draggedPiece.currentY = wy + this.dragOffsetY;
            }
        };

        this.input.onPointerUp = (wx, wy) => {
            if (this.draggedPiece) {
                const p = this.draggedPiece;
                this.draggedPiece = null;
                
                const dist = Math.hypot(p.currentX - p.targetX, p.currentY - p.targetY);
                if (dist <= this.config.core.snapTolerance * 2) {
                    p.state = 'PLACED';
                    p.currentX = p.targetX;
                    p.currentY = p.targetY;
                    p.rotation = 0;
                    
                    this.drumAudio.currentTime = 0;
                    this.drumAudio.play().catch(e => {});
                } else {
                    p.state = 'RETURNING';
                }
            }
        };
    }

    /**
     * 处理点击事件（大厅与状态切换）
     */
    handleTap(worldX, worldY) {
        if (this.currentState === this.STATES.START) {
            this.switchState(this.STATES.LOBBY);
            if (this.bgmAudio.paused) {
                this.bgmAudio.play().catch(e => console.log('BGM wait interaction'));
            }
            return;
        }
        else if (this.currentState === this.STATES.PLAY) {
            const mode = this.config.levels[this.currentLevelIndex].playMode || "timing";

            if (mode === "timing") {
                const hitPieces = this.pieces.filter(p => p.state === 'MOVING' && this.input.isPointInPiece(worldX, worldY, p));
                if (hitPieces.length > 0) {
                    if (this.config.core.overlapZIndexStrategy === 'highest') {
                        hitPieces.sort((a, b) => b.zIndex - a.zIndex);
                    }
                    const target = hitPieces[0];
                    target.state = 'FALLING';
                    target.speedX = 0;
                    target.speedY = 0;
                }
            }
        }
        else if (this.currentState === this.STATES.LOBBY) {
            const params = this.renderer.getContainDrawParams(this.renderer.lobbyCanvas.width, this.renderer.lobbyCanvas.height, this.renderer.width, this.renderer.height);
            // 这里 worldX 和 worldY 在 LOBBY 里就是屏幕坐标，因为 camera 未缩放平移
            const canvasX = (worldX - params.x) / params.w;
            const canvasY = (worldY - params.y) / params.h;

            let clickedIndex = -1;
            for (let i = 0; i < this.config.levels.length; i++) {
                const rect = this.config.levels[i].lobbyFrameRect;
                if (canvasX >= rect.x && canvasX <= rect.x + rect.width &&
                    canvasY >= rect.y && canvasY <= rect.y + rect.height) {
                    clickedIndex = i;
                    break;
                }
            }

            if (clickedIndex === -1) return;

            if (clickedIndex === this.currentLevelIndex) {
                this.switchState(this.STATES.INTRO);
            } else if (clickedIndex > this.currentLevelIndex) {
                if (this.config.lobby.allowFreeSelection) {
                    this.currentLevelIndex = clickedIndex;
                    this.switchState(this.STATES.INTRO);
                } else {
                    this.showToast("按顺序来吧");
                }
            } else if (clickedIndex < this.currentLevelIndex) {
                this.viewingLevelIndex = clickedIndex;
                this.switchState(this.STATES.VIEW_COMPLETED);
            }
            return;
        }
        else if (this.currentState === this.STATES.VIEW_COMPLETED) {
            const btnW = 140;
            const btnH = 44;
            const gap = 30;
            const centerY = this.renderer.height - 50;
            
            const backX = this.renderer.width / 2 - gap / 2 - btnW / 2;
            const exportX = this.renderer.width / 2 + gap / 2 + btnW / 2;
            
            // 返回主页按钮判定
            if (Math.abs(worldX - backX) <= btnW / 2 && Math.abs(worldY - centerY) <= btnH / 2) {
                this.switchState(this.STATES.LOBBY);
                return;
            }
            // 导出图片按钮判定
            else if (Math.abs(worldX - exportX) <= btnW / 2 && Math.abs(worldY - centerY) <= btnH / 2) {
                const levelData = this.config.levels[this.viewingLevelIndex];
                this.exportCompletedImage(levelData);
            }
        }
        else if (this.currentState === this.STATES.SETTLE) {
            // Settle 结束且提示文字展示完毕后，点击进入下一关或结局
            const timeSince = performance.now() - this.stateStartTime;
            if (timeSince > this.config.animation.zoomOut + this.config.animation.blurTransition + this.config.animation.textFadeIn) {
                const btnW = 140;
                const btnH = 44;
                const gap = 30;
                const centerY = this.renderer.height - 50;
                
                const backX = this.renderer.width / 2 - gap / 2 - btnW / 2;
                const exportX = this.renderer.width / 2 + gap / 2 + btnW / 2;
                
                // 返回主页按钮判定
                if (Math.abs(worldX - backX) <= btnW / 2 && Math.abs(worldY - centerY) <= btnH / 2) {
                    this.currentLevelIndex++;
                    if (this.currentLevelIndex < this.config.levels.length) {
                        this.switchState(this.STATES.LOBBY); // 回退到大厅
                    } else {
                        this.switchState(this.STATES.END);
                    }
                    return;
                }
                // 导出图片按钮判定
                else if (Math.abs(worldX - exportX) <= btnW / 2 && Math.abs(worldY - centerY) <= btnH / 2) {
                    const levelData = this.config.levels[this.currentLevelIndex];
                    this.exportCompletedImage(levelData);
                }
            }
        }
        else if (this.currentState === this.STATES.END) {
            const timeSince = performance.now() - this.stateStartTime;
            const lobbyDuration = 3000;
            const singleImageDuration = 4000;
            const startFadeToBlackTime = lobbyDuration + this.config.levels.length * singleImageDuration;
            
            if (timeSince > startFadeToBlackTime + this.config.ending.fadeToBlackDuration) {
                // 回到大厅重新游玩，保持全部解锁状态
                this.switchState(this.STATES.LOBBY);
            }
        }
    }

    /**
     * 导出带有居中文案的原图
     */
    exportCompletedImage(levelData) {
        const bgImg = this.renderer.getImage(levelData.image);
        if (!bgImg) return;
        
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = bgImg.width;
        exportCanvas.height = bgImg.height;
        const ectx = exportCanvas.getContext('2d');
        
        ectx.drawImage(bgImg, 0, 0);
        
        const wordImg = this.renderer.getImage(levelData.successWordImage);
        if (wordImg) {
            ectx.save();
            ectx.globalCompositeOperation = 'multiply';
            
            const targetW = bgImg.width * 0.7;
            const scale = targetW / wordImg.width;
            const targetH = wordImg.height * scale;
            const targetX = (bgImg.width - targetW) / 2;
            let targetY = (bgImg.height - targetH) / 2;
            
            if (levelData.id === 1) {
                targetY = bgImg.height * 0.05;
            } else if (levelData.id === 4) {
                targetY -= bgImg.height / 4;
            }
            
            ectx.drawImage(wordImg, targetX, targetY, targetW, targetH);
            ectx.restore();
        }
        
        const link = document.createElement('a');
        link.download = `piece_story_${levelData.id}.png`;
        link.href = exportCanvas.toDataURL('image/png', 0.9);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showToast('图片已开始导出');
    }

    /**
     * 弹窗提示
     */
    showToast(message) {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }
    }

    /**
     * 主循环更新
     */
    update(dt) {
        // 更新光标样式
        if (this.currentState === this.STATES.LOBBY && this.currentLevelIndex < this.config.levels.length) {
            this.renderer.canvas.style.cursor = 'none';
        } else {
            this.renderer.canvas.style.cursor = 'default';
        }

        if (this.currentLevelIndex < this.config.levels.length && this.currentState !== this.STATES.VIEW_COMPLETED) {
            const cw = window.innerWidth * (window.devicePixelRatio || 1);
            const ch = window.innerHeight * (window.devicePixelRatio || 1);
            this.rainParticles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.y > ch + p.length) {
                    p.y = -p.length;
                    p.x = Math.random() * cw;
                }
            });
        }

        if (this.currentState === this.STATES.PLAY) {
            let allPlaced = true;
            const conf = this.config.pieces;
            const mode = this.config.levels[this.currentLevelIndex].playMode || "timing";

            this.pieces.forEach(p => {
                if (p.state !== 'PLACED') allPlaced = false;

                if (mode === "timing") {
                    if (p.state === 'MOVING') {
                        // 按帧率独立更新，这里由于 dt 波动可能导致速度不一，简化为按帧加
                        p.currentX += p.speedX * (dt / (1000/60));
                        
                        const worldPosLeft = this.input.screenToWorld(-p.width - 100, 0);
                        const worldPosRight = this.input.screenToWorld(this.renderer.width + 100, 0);

                        // 飞出屏幕则状态重置
                        if (p.speedX > 0 && p.currentX > worldPosRight.x) {
                            p.state = 'WAITING';
                        } else if (p.speedX < 0 && p.currentX < worldPosLeft.x) {
                            p.state = 'WAITING';
                        }
                    } 
                    else if (p.state === 'FALLING') {
                        p.speedY += conf.fallAcceleration * (dt / (1000/60));
                        p.currentY += p.speedY * (dt / (1000/60));

                        // 吸附检测
                        if (p.currentY >= p.targetY) {
                            const dist = Math.abs(p.currentX - p.targetX);
                            if (dist <= this.config.core.snapTolerance) {
                                // 吸附成功
                                p.state = 'PLACED';
                                p.currentX = p.targetX;
                                p.currentY = p.targetY;
                                
                                this.drumAudio.currentTime = 0;
                                this.drumAudio.play().catch(e => {});
                            } else {
                                // 继续掉落
                            }
                        }

                        // 掉落出界
                        const worldBottom = this.input.screenToWorld(0, this.renderer.height + 200).y;
                        if (p.currentY > worldBottom) {
                            p.state = 'WAITING';
                        }
                    }
                } else if (mode === "drag") {
                    if (p.state === 'RETURNING') {
                        // 回弹到初始散落位置
                        const returnSpeed = conf.dragMode.returnSpeed;
                        p.currentX += (p.spawnX - p.currentX) * returnSpeed;
                        p.currentY += (p.spawnY - p.currentY) * returnSpeed;
                        
                        // 接近目标停止
                        if (Math.hypot(p.currentX - p.spawnX, p.currentY - p.spawnY) < 2) {
                            p.currentX = p.spawnX;
                            p.currentY = p.spawnY;
                            p.state = 'MOVING'; // 重新进入自由散落状态
                        }
                    }
                }
            });

            if (mode === "timing") {
                // 集中生成逻辑：补充空缺的活跃图块
                const movingCount = this.pieces.filter(p => p.state === 'MOVING' || p.state === 'FALLING').length;
                if (movingCount < conf.maxConcurrentPieces && !this.isSpawning) {
                    const waitingPieces = this.pieces.filter(p => p.state === 'WAITING');
                    if (waitingPieces.length > 0) {
                        this.isSpawning = true;
                        setTimeout(() => {
                            const currentWaiting = this.pieces.filter(p => p.state === 'WAITING');
                            if (currentWaiting.length > 0 && this.currentState === this.STATES.PLAY) {
                                const toSpawn = currentWaiting[Math.floor(Math.random() * currentWaiting.length)];
                                toSpawn.spawn();
                            }
                            this.isSpawning = false;
                        }, conf.spawnDelay.min + Math.random()*(conf.spawnDelay.max-conf.spawnDelay.min));
                    }
                }
            }

            if (allPlaced && !this.isSpawning) {
                this.switchState(this.STATES.SETTLE);
            }
        }
        else if (this.currentState === this.STATES.INTRO) {
            // 平滑放大到 cutoutBox
            const progress = Math.min(1, (performance.now() - this.stateStartTime) / this.config.animation.zoomIn);
            // easeInOut
            const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
            
            // 目标中心点和缩放
            let targetCenterX = this.cutoutBox.x + this.cutoutBox.width / 2 - this.renderer.width / 2;
            let targetCenterY = this.cutoutBox.y + this.cutoutBox.height / 2 - this.renderer.height / 2;
            
            // 【修复】：优化缩放逻辑，目标放大到占据屏幕的80%，同时绝对不允许缩小(最低为1)
            const scaleW = (this.renderer.width * 0.8) / this.cutoutBox.width;
            const scaleH = (this.renderer.height * 0.8) / this.cutoutBox.height;
            let targetScale = Math.max(1, Math.min(scaleW, scaleH));

            const mode = this.config.levels[this.currentLevelIndex].playMode || "timing";
            if (mode === "drag") {
                // 【修复】：拖拽模式必须保持整个桌面可见，不进行缩放和平移
                targetCenterX = 0;
                targetCenterY = 0;
                targetScale = 1;
            }

            this.renderer.camera.x = targetCenterX * ease;
            this.renderer.camera.y = targetCenterY * ease;
            this.renderer.camera.scale = 1 + (targetScale - 1) * ease;

            if (progress >= 1) {
                this.switchState(this.STATES.PLAY);
            }
        }
        else if (this.currentState === this.STATES.SETTLE) {
            // 平滑缩小回 1
            const progress = Math.min(1, (performance.now() - this.stateStartTime) / this.config.animation.zoomOut);
            const ease = progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;
            
            // 反向执行，这里假设 INTRO 结束时的 camera 状态是我们的起点
            let startX = this.cutoutBox.x + this.cutoutBox.width / 2 - this.renderer.width / 2;
            let startY = this.cutoutBox.y + this.cutoutBox.height / 2 - this.renderer.height / 2;
            const scaleW = (this.renderer.width * 0.8) / this.cutoutBox.width;
            const scaleH = (this.renderer.height * 0.8) / this.cutoutBox.height;
            let startScale = Math.max(1, Math.min(scaleW, scaleH));

            const mode = this.config.levels[this.currentLevelIndex].playMode || "timing";
            if (mode === "drag") {
                startX = 0;
                startY = 0;
                startScale = 1;
            }

            this.renderer.camera.x = startX * (1 - ease);
            this.renderer.camera.y = startY * (1 - ease);
            this.renderer.camera.scale = startScale + (1 - startScale) * ease;
        }
    }

    /**
     * 主循环绘制
     */
    draw() {
        this.renderer.clear();
        this.renderer.applyCamera();

        if (this.currentState === this.STATES.START) {
            this.renderer.restoreCamera();
            const wallImg = this.renderer.getImage(this.config.lobby.wallImage);
            if (wallImg) {
                const params = this.renderer.getContainDrawParams(wallImg.width, wallImg.height, this.renderer.width, this.renderer.height);
                this.renderer.drawStartScreen(this.config.lobby.wallImage, params);
            }
            return;
        }
        else if (this.currentState === this.STATES.LOBBY) {
            this.renderer.drawLobby(this.config.lobby.wallImage, this.config.levels, this.blurCache, 1, this.currentLevelIndex, []);
        }
        else if (this.currentState >= this.STATES.INTRO && this.currentState <= this.STATES.SETTLE) {
            const levelData = this.config.levels[this.currentLevelIndex];
            let blurAlpha = 1;
            
            if (this.currentState === this.STATES.SETTLE) {
                // 计算模糊消退
                const timeSince = performance.now() - this.stateStartTime;
                if (timeSince > this.config.animation.zoomOut) {
                    blurAlpha = 1 - Math.min(1, (timeSince - this.config.animation.zoomOut) / this.config.animation.blurTransition);
                }
            }

            const mode = levelData.playMode || "timing";
            
            if (mode === "drag") {
                // 拖拽模式使用专属桌面底图
                this.renderer.drawGameBackground(this.config.pieces.dragMode.backgroundImage, null, this.bgParams, 0);
                // 绘制相框内的底图 (使用 coverParams 消除白边，并用 puzzleRect 即物理画框严格裁切防溢出)
                this.renderer.ctx.save();
                this.renderer.ctx.beginPath();
                this.renderer.ctx.rect(this.puzzleRect.x, this.puzzleRect.y, this.puzzleRect.width, this.puzzleRect.height);
                this.renderer.ctx.clip();
                this.renderer.drawLevelImageRect(levelData.image, this.blurCache[levelData.image], this.coverParams, blurAlpha);
                this.renderer.ctx.restore();
                
                // 画提示边框 (针对 cutoutBox)
                if (this.currentState !== this.STATES.SETTLE || blurAlpha > 0) {
                    this.renderer.drawCutoutBorder(this.cutoutBox);
                }
            } else {
                this.renderer.drawGameBackground(levelData.image, this.blurCache[levelData.image], this.bgParams, blurAlpha);
                if (this.currentState !== this.STATES.SETTLE || blurAlpha > 0) {
                    this.renderer.drawCutoutBorder(this.cutoutBox);
                }
            }

            // 准备给碎片的渲染参数，由于 drag 模式底图使用了 coverParams 以消除白边，碎片贴图需对齐 coverParams
            const pieceRenderParams = mode === "drag" ? {
                bgX: this.coverParams.x,
                bgY: this.coverParams.y,
                bgW: this.coverParams.w,
                bgH: this.coverParams.h
            } : {
                bgX: this.bgParams.x,
                bgY: this.bgParams.y,
                bgW: this.bgParams.w,
                bgH: this.bgParams.h
            };

            // 画放置好的碎片 (它们带有自己的遮罩，所以实际上它们是清晰的)
            const srcImg = this.renderer.getImage(levelData.image);
            this.pieces.filter(p => p.state === 'PLACED').forEach(p => {
                const showEdge = blurAlpha > 0;
                this.renderer.drawPiece(p, srcImg, pieceRenderParams, showEdge ? this.config.pieces : null);
            });

            // 绘制非放置状态的所有图块 (包括 MOVING、DRAGGING、RETURNING、FALLING)
            this.pieces.filter(p => p.state !== 'PLACED' && p.state !== 'WAITING')
                .sort((a,b) => a.zIndex - b.zIndex)
                .forEach(p => {
                    this.renderer.drawPiece(p, srcImg, pieceRenderParams, this.config.pieces);
                });

            // 如果处于游玩状态，绘制 UI 进度条
            if (this.currentState === this.STATES.PLAY) {
                // UI 进度条已移除
            }
        }
        else if (this.currentState === this.STATES.END) {
            const now = performance.now();
            const elapsed = now - this.stateStartTime;
            
            const lobbyDuration = 3000;
            const singleImageDuration = 4000; // 1000ms fade in, 2000ms hold, 1000ms fade out
            const allImagesDuration = this.config.levels.length * singleImageDuration;
            const startFadeToBlackTime = lobbyDuration + allImagesDuration;
            
            // 默认画个纯黑底，防止图片切换时闪烁
            this.renderer.ctx.fillStyle = '#000';
            this.renderer.ctx.fillRect(-this.renderer.camera.x, -this.renderer.camera.y, this.renderer.width * 2, this.renderer.height * 2);

            if (elapsed < lobbyDuration) {
                // 1. 回到大厅，全清晰，展示金色边框
                this.renderer.drawLobby(this.config.lobby.wallImage, this.config.levels, this.blurCache, 1, this.config.levels.length, []);
            } 
            else if (elapsed < startFadeToBlackTime) {
                // 2. 依次展示每张图
                const imageIndex = Math.floor((elapsed - lobbyDuration) / singleImageDuration);
                const timeInImage = (elapsed - lobbyDuration) % singleImageDuration;
                
                let alpha = 1;
                if (timeInImage < 1000) {
                    alpha = timeInImage / 1000;
                } else if (timeInImage > 3000) {
                    alpha = 1 - (timeInImage - 3000) / 1000;
                }
                
                if (imageIndex < this.config.levels.length) {
                    const levelData = this.config.levels[imageIndex];
                    this.renderer.drawGameBackground(levelData.image, null, this.bgParams, 0); // 只画清晰
                    
                    this.renderer.restoreCamera(); // UI层不缩放
                    const wordImg = this.renderer.getImage(levelData.successWordImage);
                    if (wordImg) {
                        this.renderer.ctx.save();
                        this.renderer.ctx.globalAlpha = alpha;
                        this.renderer.ctx.globalCompositeOperation = 'source-over';
                        
                        // 确定文本的可用区域 (框)
                        let boxX = this.bgParams.x;
                        let boxY = this.bgParams.y;
                        let boxW = this.bgParams.w;
                        let boxH = this.bgParams.h;

                        // 留白 15% 确保文字完全处于框内
                        const maxW = boxW * 0.85;
                        const maxH = boxH * 0.85;

                        const scale = Math.min(maxW / wordImg.width, maxH / wordImg.height);
                        const targetW = wordImg.width * scale;
                        const targetH = wordImg.height * scale;
                        const targetX = boxX + (boxW - targetW) / 2;
                        let targetY = boxY + (boxH - targetH) / 2;
                        
                        if (levelData.id === 1) {
                            targetY -= boxH / 8;
                        } else if (levelData.id === 4) {
                            targetY -= boxH / 4;
                        }
                        
                        this.renderer.ctx.drawImage(wordImg, targetX, targetY, targetW, targetH);
                        this.renderer.ctx.restore();
                    }
                    this.renderer.applyCamera();
                }
            }
            else {
                // 3. 黑屏与致谢图片
                const fadeTime = elapsed - startFadeToBlackTime;
                const fadeProgress = Math.min(1, fadeTime / this.config.ending.fadeToBlackDuration);
                
                this.renderer.ctx.fillStyle = `rgba(0,0,0,${fadeProgress})`;
                this.renderer.ctx.fillRect(-this.renderer.camera.x, -this.renderer.camera.y, this.renderer.width * 2, this.renderer.height * 2);
                
                if (fadeProgress >= 1) {
                    this.renderer.restoreCamera();
                    const finalImg = this.renderer.getImage(this.config.ending.finalImage);
                    if (finalImg) {
                        const finalParams = this.renderer.getContainDrawParams(finalImg.width, finalImg.height, this.renderer.width, this.renderer.height);
                        
                        // 计算致谢图片的渐明渐暗
                        const timeAfterBlack = fadeTime - this.config.ending.fadeToBlackDuration;
                        let finalAlpha = 0;
                        if (timeAfterBlack < 2000) {
                            finalAlpha = timeAfterBlack / 2000; // 2秒渐明
                        } else if (timeAfterBlack < 5000) {
                            finalAlpha = 1; // 保持3秒
                        } else {
                            finalAlpha = 1 - (timeAfterBlack - 5000) / 2000; // 2秒渐暗
                            if (finalAlpha < 0) finalAlpha = 0;
                        }
                        
                        this.renderer.ctx.save();
                        this.renderer.ctx.globalAlpha = finalAlpha;
                        this.renderer.ctx.drawImage(finalImg, finalParams.x, finalParams.y, finalParams.w, finalParams.h);
                        this.renderer.ctx.restore();
                    }
                    
                    if (fadeTime > this.config.ending.fadeToBlackDuration + 7500) {
                        this.switchState(this.STATES.LOBBY);
                    }
                    
                    this.renderer.drawText("等待或点击返回大厅", this.renderer.width/2, this.renderer.height * 0.95, 16, 0.6);
                    this.renderer.applyCamera();
                }
            }
        }
        else if (this.currentState === this.STATES.VIEW_COMPLETED) {
            const levelData = this.config.levels[this.viewingLevelIndex];
            
            // 使用 getContainDrawParams 绘制完整的原图
            this.renderer.drawGameBackground(levelData.image, null, this.bgParams, 0); 
            
            // 计算时间
            const elapsed = performance.now() - this.stateStartTime;
            if (elapsed > 1000) {
                // 延迟1秒后缓慢出现
                const fadeAlpha = Math.min(1, (elapsed - 1000) / 2000); // 2秒淡入
                
                const wordImg = this.renderer.getImage(levelData.successWordImage);
                if (wordImg) {
                    this.renderer.ctx.save();
                    this.renderer.ctx.globalAlpha = fadeAlpha;
                    this.renderer.ctx.globalCompositeOperation = 'source-over';
                    
                    // 确定文本的可用区域 (框)
                    let boxX = this.bgParams.x;
                    let boxY = this.bgParams.y;
                    let boxW = this.bgParams.w;
                    let boxH = this.bgParams.h;

                    // 在 VIEW_COMPLETED 状态下，背景是原图，本身就是框。
                    // 留白 15% 确保文字完全处于框内
                    const maxW = boxW * 0.85;
                    const maxH = boxH * 0.85;

                    const scale = Math.min(maxW / wordImg.width, maxH / wordImg.height);
                    const targetW = wordImg.width * scale;
                    const targetH = wordImg.height * scale;
                    const targetX = boxX + (boxW - targetW) / 2;
                    let targetY = boxY + (boxH - targetH) / 2;
                    
                    if (levelData.id === 4 || levelData.id === 1) {
                        targetY -= boxH / 4;
                    }
                    
                    this.renderer.ctx.drawImage(wordImg, targetX, targetY, targetW, targetH);
                    this.renderer.ctx.restore();
                }
            }

            const btnW = 140;
            const btnH = 44;
            const gap = 30;
            const centerY = this.renderer.height - 50;
            
            const backX = this.renderer.width / 2 - gap / 2 - btnW / 2;
            const exportX = this.renderer.width / 2 + gap / 2 + btnW / 2;

            this.renderer.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            this.renderer.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            this.renderer.ctx.lineWidth = 1;
            
            // 绘制返回主页按钮
            this.renderer.ctx.beginPath();
            this.renderer.ctx.roundRect(backX - btnW / 2, centerY - btnH / 2, btnW, btnH, 8);
            this.renderer.ctx.fill();
            this.renderer.ctx.stroke();
            this.renderer.drawText('返回主页', backX, centerY + 2, 16, 1);

            // 绘制导出图片按钮
            this.renderer.ctx.beginPath();
            this.renderer.ctx.roundRect(exportX - btnW / 2, centerY - btnH / 2, btnW, btnH, 8);
            this.renderer.ctx.fill();
            this.renderer.ctx.stroke();
            this.renderer.drawText('导出图片', exportX, centerY + 2, 16, 1);
        }

        this.renderer.restoreCamera();

        // 在 UI 层画文字，不需要缩放
        if (this.currentState === this.STATES.SETTLE) {
            const timeSince = performance.now() - this.stateStartTime;
            if (timeSince > this.config.animation.zoomOut + this.config.animation.blurTransition) {
                const txtTime = timeSince - (this.config.animation.zoomOut + this.config.animation.blurTransition);
                const txtAlpha = txtTime < this.config.animation.textFadeIn 
                    ? txtTime / this.config.animation.textFadeIn 
                    : 1;

                // 绘制成功文案图片 (successWordImage)
                const levelData = this.config.levels[this.currentLevelIndex];
                const wordImg = this.renderer.getImage(levelData.successWordImage);
                if (wordImg) {
                    this.renderer.ctx.save();
                    this.renderer.ctx.globalAlpha = txtAlpha;
                    this.renderer.ctx.globalCompositeOperation = 'source-over';
                    
                    // 确定文本的可用区域 (框)
                    let boxX = this.bgParams.x;
                    let boxY = this.bgParams.y;
                    let boxW = this.bgParams.w;
                    let boxH = this.bgParams.h;

                    // 在 SETTLE 状态下，如果为 drag 模式，bgParams 对应的是带相框的桌布
                    // 需要计算真实的相框区域
                    if (levelData.playMode === 'drag') {
                        const frameRect = this.config.pieces.dragMode.frameRect;
                        boxX += this.bgParams.w * frameRect.x;
                        boxY += this.bgParams.h * frameRect.y;
                        boxW = this.bgParams.w * frameRect.width;
                        boxH = this.bgParams.h * frameRect.height;
                    }

                    // 留白 15% 确保文字完全处于框内
                    const maxW = boxW * 0.85;
                    const maxH = boxH * 0.85;

                    const scale = Math.min(maxW / wordImg.width, maxH / wordImg.height);
                    const targetW = wordImg.width * scale;
                    const targetH = wordImg.height * scale;
                    const targetX = boxX + (boxW - targetW) / 2;
                    let targetY = boxY + (boxH - targetH) / 2;
                    
                    if (levelData.id === 1) {
                        targetY = boxY + boxH * 0.08;
                    } else if (levelData.id === 4) {
                        targetY -= boxH / 4;
                    }
                    
                    this.renderer.ctx.drawImage(wordImg, targetX, targetY, targetW, targetH);
                    this.renderer.ctx.restore();
                }

                // 动画显示完毕后，绘制返回与导出按钮
                if (txtTime > this.config.animation.textFadeIn) {
                    const btnW = 140;
                    const btnH = 44;
                    const gap = 30;
                    const centerY = this.renderer.height - 50;
                    
                    const backX = this.renderer.width / 2 - gap / 2 - btnW / 2;
                    const exportX = this.renderer.width / 2 + gap / 2 + btnW / 2;

                    this.renderer.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    this.renderer.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                    this.renderer.ctx.lineWidth = 1;
                    
                    // 绘制返回主页按钮
                    this.renderer.ctx.beginPath();
                    this.renderer.ctx.roundRect(backX - btnW / 2, centerY - btnH / 2, btnW, btnH, 8);
                    this.renderer.ctx.fill();
                    this.renderer.ctx.stroke();
                    this.renderer.drawText('返回主页', backX, centerY + 2, 16, 1);

                    // 绘制导出图片按钮
                    this.renderer.ctx.beginPath();
                    this.renderer.ctx.roundRect(exportX - btnW / 2, centerY - btnH / 2, btnW, btnH, 8);
                    this.renderer.ctx.fill();
                    this.renderer.ctx.stroke();
                    this.renderer.drawText('导出图片', exportX, centerY + 2, 16, 1);
                }
            }
        }

        // 最后覆盖一层动态雨水效果
        if (this.currentState === this.STATES.LOBBY && this.currentLevelIndex < this.config.levels.length) {
            const params = this.renderer.getContainDrawParams(this.renderer.lobbyCanvas.width, this.renderer.lobbyCanvas.height, this.renderer.width, this.renderer.height);
            this.renderer.drawRain(this.rainParticles, this.config.levels, this.currentLevelIndex, params);
            
            // 绘制探照灯效果
            this.renderer.drawLobbySpotlight(this.input.currentScreenX, this.input.currentScreenY, this.config.levels, this.currentLevelIndex, params, this.config.lobby.spotlightRadiusRatio);
        }
        
        // 当从大厅进入照片时，屏幕从黑渐变亮（温和过渡）
        if (this.currentState === this.STATES.INTRO) {
            const timeSince = performance.now() - this.stateStartTime;
            let introEase = timeSince / this.config.animation.zoomIn;
            if (introEase > 1) introEase = 1;
            
            if (introEase < 1) {
                this.renderer.ctx.save();
                this.renderer.ctx.fillStyle = `rgba(0, 0, 0, ${0.95 * (1 - introEase)})`;
                this.renderer.ctx.fillRect(0, 0, this.renderer.width, this.renderer.height);
                this.renderer.ctx.restore();
            }
        }
    }

    loop(time) {
        try {
            const dt = time - this.lastTime;
            this.lastTime = time;
            
            this.update(dt);
            this.draw();
            
            requestAnimationFrame((t) => this.loop(t));
        } catch (error) {
            console.error(error);
            document.getElementById('uiLayer').innerText = this.config.ui.errorPrompt;
        }
    }
}

// 页面加载完成后自动启动
window.addEventListener('DOMContentLoaded', () => {
    new GameCore();
});

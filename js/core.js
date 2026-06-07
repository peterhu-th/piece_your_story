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
        this.totalPlayTime = 0;

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

        // 音频系统
        this.bgmAudio = new Audio(this.config.audio.bgm);
        this.bgmAudio.loop = true;
        this.drumAudio = new Audio(this.config.audio.drum);

        // 启动游戏
        this.init();
        this.setupPointerEvents();
    }

    async init() {
        try {
            // 收集所有需要预加载的图片
            const imagePaths = [this.config.lobby.wallImage];
            this.config.levels.forEach(l => {
                imagePaths.push(l.image);
            });

            await this.renderer.loadImages(imagePaths);
            
            // 预生成模糊图片，防止游戏过程中卡顿
            this.config.levels.forEach(l => {
                const img = this.renderer.getImage(l.image);
                const blurRadius = this.config.core.lobbyBlurRadius || this.config.core.blurRadius;
                this.blurCache[l.image] = this.renderer.generateBlurredImage(img, blurRadius);
            });

            // 进入大厅
            this.switchState(this.STATES.LOBBY);
            
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
            // 初次随机挑选几个直接 spawn
            const waitingPieces = this.pieces.filter(p => p.state === 'WAITING');
            waitingPieces.sort(() => Math.random() - 0.5);
            const initialCount = Math.min(waitingPieces.length, this.config.pieces.maxConcurrentPieces);
            for(let i=0; i<initialCount; i++) {
                waitingPieces[i].spawn();
            }
            this.isSpawning = false;
        }
        else if (newState === this.STATES.SETTLE) {
            // 结算阶段（不再存储到 localStorage）
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
        const img = this.renderer.getImage(levelData.image);
        // 先计算一次全图显示的参数，以便获得 bgW, bgH, bgX, bgY (现在统一使用 Contain)
        this.bgParams = this.renderer.getContainDrawParams(img.width, img.height, this.renderer.width, this.renderer.height);
        
        // 计算挖空区域 (Cutout) 在屏幕上的真实包围盒
        this.cutoutBox = {
            x: this.bgParams.x + levelData.cutoutBoundary.x * this.bgParams.w,
            y: this.bgParams.y + levelData.cutoutBoundary.y * this.bgParams.h,
            width: levelData.cutoutBoundary.width * this.bgParams.w,
            height: levelData.cutoutBoundary.height * this.bgParams.h
        };

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
        
        // 修正 piece 内的方法作用域
        const mode = levelData.playMode || "timing";
        
        this.pieces.forEach(p => {
            p.spawn = () => {
                if (mode === "drag") {
                    const dragConf = this.config.pieces.dragMode;
                    const scatterMinY = this.renderer.height * dragConf.scatterAreaY.min;
                    const scatterMaxY = this.renderer.height * dragConf.scatterAreaY.max;
                    
                    const spawnY = scatterMinY + Math.random() * (scatterMaxY - scatterMinY);
                    
                    // 计算最终放大后的相机参数
                    const targetCenterX = this.cutoutBox.x + this.cutoutBox.width / 2 - this.renderer.width / 2;
                    const targetCenterY = this.cutoutBox.y + this.cutoutBox.height / 2 - this.renderer.height / 2;
                    const scaleW = this.renderer.width / this.cutoutBox.width;
                    const scaleH = this.renderer.height / this.cutoutBox.height;
                    const targetScale = Math.min(Math.min(scaleW, scaleH) * 0.45, 1.8);

                    const spawnX = Math.random() * (this.renderer.width - p.width * targetScale);
                    
                    const cw = this.renderer.canvas.clientWidth;
                    const ch = this.renderer.canvas.clientHeight;
                    
                    let wx = spawnX - cw / 2;
                    let wy = spawnY - ch / 2;
                    wx = wx / targetScale;
                    wy = wy / targetScale;
                    wx = wx + cw / 2 + targetCenterX;
                    wy = wy + ch / 2 + targetCenterY;

                    p.state = 'MOVING'; // 在拖拽模式下，MOVING表示自由散落状态
                    p.currentX = wx;
                    p.currentY = wy;
                    p.spawnX = wx;
                    p.spawnY = wy;
                    p.rotation = (dragConf.scatterRotation.min + Math.random() * (dragConf.scatterRotation.max - dragConf.scatterRotation.min)) * Math.PI / 180;
                } else {
                    const conf = this.config.pieces;
                    const trackY = this.renderer.height * conf.yPositionTracks[Math.floor(Math.random() * conf.yPositionTracks.length)];
                    const speed = conf.speedRange.min + Math.random() * (conf.speedRange.max - conf.speedRange.min);
                    const isLeft = Math.random() < conf.directionProb;

                    const worldPosLeft = this.input.screenToWorld(-p.width - 100, trackY);
                    const worldPosRight = this.input.screenToWorld(this.renderer.width + 100, trackY);

                    p.state = 'MOVING';
                    const safeY = Math.min(worldPosLeft.y, this.cutoutBox.y - p.height - 20);
                    p.currentY = safeY;
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
                    // Timing 模式：点击下落
                    let hitPieces = this.pieces.filter(p => p.state === 'MOVING' && this.input.isPointInPiece(wx, wy, p));
                    if (hitPieces.length > 0) {
                        hitPieces.forEach(p => {
                            p.state = 'FALLING';
                            p.speedX = 0;
                            p.speedY = 0;
                        });
                    }
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
        if (this.currentState === this.STATES.LOBBY) {
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
                this.showToast("按顺序来吧");
            } else if (clickedIndex < this.currentLevelIndex) {
                this.viewingLevelIndex = clickedIndex;
                this.switchState(this.STATES.VIEW_COMPLETED);
            }
            return;
        }
        else if (this.currentState === this.STATES.VIEW_COMPLETED) {
            this.switchState(this.STATES.LOBBY);
            return;
        }
        else if (this.currentState === this.STATES.PLAY) {
            // 检测点击到的 moving 状态的碎片
            const hitPieces = this.pieces.filter(p => p.state === 'MOVING' && this.input.isPointInPiece(worldX, worldY, p));
            if (hitPieces.length > 0) {
                // 根据 zIndex 策略选取
                if (this.config.core.overlapZIndexStrategy === 'highest') {
                    hitPieces.sort((a, b) => b.zIndex - a.zIndex);
                }
                const target = hitPieces[0];
                target.state = 'FALLING';
                target.speedX = 0;
                target.speedY = 0; // 初始下落速度
            }
        }
        else if (this.currentState === this.STATES.SETTLE) {
            // Settle 结束且提示文字展示完毕后，点击进入下一关或结局
            const timeSince = performance.now() - this.stateStartTime;
            if (timeSince > this.config.animation.zoomOut) {
                this.currentLevelIndex++;
                if (this.currentLevelIndex < this.config.levels.length) {
                    this.switchState(this.STATES.INTRO);
                } else {
                    this.switchState(this.STATES.END);
                }
            }
        }
    }

    /**
     * 主循环更新
     */
    update(dt) {
        if (this.currentState === this.STATES.PLAY) {
            this.totalPlayTime += dt / 1000;
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
            const targetCenterX = this.cutoutBox.x + this.cutoutBox.width / 2 - this.renderer.width / 2;
            const targetCenterY = this.cutoutBox.y + this.cutoutBox.height / 2 - this.renderer.height / 2;
            
            // 计算屏幕需要缩放多大才能包含整个 cutout，为了看清周围内容，不要过度放大
            const scaleW = this.renderer.width / this.cutoutBox.width;
            const scaleH = this.renderer.height / this.cutoutBox.height;
            const targetScale = Math.min(Math.min(scaleW, scaleH) * 0.45, 1.8); // 留较多边距，最高放大1.8倍

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
            const startX = this.cutoutBox.x + this.cutoutBox.width / 2 - this.renderer.width / 2;
            const startY = this.cutoutBox.y + this.cutoutBox.height / 2 - this.renderer.height / 2;
            const scaleW = this.renderer.width / this.cutoutBox.width;
            const scaleH = this.renderer.height / this.cutoutBox.height;
            const startScale = Math.min(Math.min(scaleW, scaleH) * 0.45, 1.8);

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

        if (this.currentState === this.STATES.LOBBY) {
            this.renderer.drawLobby(this.config.lobby.wallImage, this.config.levels, this.blurCache, 1, this.currentLevelIndex);
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

            this.renderer.drawGameBackground(levelData.image, this.blurCache[levelData.image], this.bgParams, blurAlpha);

            // 如果不是结算完成状态，画边框
            if (this.currentState !== this.STATES.SETTLE || blurAlpha > 0) {
                this.renderer.drawCutoutBorder(this.cutoutBox);
            }

            // 画放置好的碎片 (它们带有自己的遮罩，所以实际上它们是清晰的)
            const srcImg = this.renderer.getImage(levelData.image);
            this.pieces.filter(p => p.state === 'PLACED').forEach(p => {
                // 如果已经完全拼好且变清晰，可以不再单独渲染边框
                const showEdge = blurAlpha > 0;
                this.renderer.drawPiece(p, srcImg, this.bgParams, showEdge ? this.config.pieces : null);
            });

            // 绘制非放置状态的所有图块 (包括 MOVING、DRAGGING、RETURNING、FALLING)
            // 根据 zIndex 排序，让被拖拽或在上方的图块覆盖其他图块
            this.pieces.filter(p => p.state !== 'PLACED' && p.state !== 'WAITING')
                .sort((a,b) => a.zIndex - b.zIndex)
                .forEach(p => {
                    this.renderer.drawPiece(p, srcImg, this.bgParams, this.config.pieces);
                });
        }
        else if (this.currentState === this.STATES.END) {
            // 结局幻灯片
            const now = performance.now();
            const elapsed = now - this.endingLastSlideTime;
            
            if (elapsed > this.config.ending.slideshowInterval && this.endingSlideIndex < this.config.levels.length) {
                this.endingSlideIndex++;
                this.endingLastSlideTime = now;
            }

            if (this.endingSlideIndex < this.config.levels.length) {
                const levelData = this.config.levels[this.endingSlideIndex];
                this.renderer.drawGameBackground(levelData.image, null, this.bgParams, 0); // 纯清晰
                this.renderer.drawText(levelData.successText, this.renderer.width/2, this.renderer.height * 0.8, 24);
            } else {
                // 黑屏致谢
                const fadeProgress = Math.min(1, (now - this.endingLastSlideTime) / this.config.ending.fadeToBlackDuration);
                this.renderer.ctx.fillStyle = `rgba(0,0,0,${fadeProgress})`;
                this.renderer.ctx.fillRect(-this.renderer.camera.x, -this.renderer.camera.y, this.renderer.width * 2, this.renderer.height * 2);
                
                if (fadeProgress >= 1) {
                    this.config.ending.finalTexts.forEach((txt, i) => {
                        this.renderer.drawText(txt, this.renderer.width/2, this.renderer.height/2 + i * 40 - 40, 24, 1);
                    });
                    
                    // 显示总耗时
                    const timeStr = `累计用时：${Math.ceil(this.totalPlayTime / 1000)} 秒`;
                    this.renderer.drawText(timeStr, this.renderer.width/2, this.renderer.height/2 + this.config.ending.finalTexts.length * 40, 18, 1);
                }
            }
        }
        else if (this.currentState === this.STATES.VIEW_COMPLETED) {
            const levelData = this.config.levels[this.viewingLevelIndex];
            
            // 使用 getContainDrawParams 绘制完整的原图
            this.renderer.drawGameBackground(levelData.image, null, this.bgParams, 0); 
            
            // 绘制文字蒙版
            this.renderer.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            this.renderer.ctx.fillRect(0, 0, this.renderer.width, this.renderer.height);

            // 绘制当前关卡的成功文案
            this.renderer.drawText(levelData.successText, this.renderer.width/2, this.renderer.height * 0.2, 28, 1);

            // 绘制返回提示
            this.renderer.drawText('点击任意处返回', this.renderer.width/2, this.renderer.height * 0.9, 18, 1);
        }

        this.renderer.restoreCamera();

        // 在 UI 层画文字，不需要缩放
        if (this.currentState === this.STATES.SETTLE) {
            const timeSince = performance.now() - this.stateStartTime;
            if (timeSince > this.config.animation.zoomOut + this.config.animation.blurTransition) {
                // 开始显示文案
                const textTime = timeSince - (this.config.animation.zoomOut + this.config.animation.blurTransition);
                let alpha = 0;
                if (textTime < this.config.animation.textFadeIn) {
                    alpha = textTime / this.config.animation.textFadeIn;
                } else if (textTime < this.config.animation.textFadeIn + this.config.animation.textDuration) {
                    alpha = 1;
                } else {
                    const fadeOutTime = textTime - (this.config.animation.textFadeIn + this.config.animation.textDuration);
                    alpha = Math.max(0, 1 - fadeOutTime / this.config.animation.textFadeOut);
                }
                
                const levelData = this.config.levels[this.currentLevelIndex];
                this.renderer.drawText(levelData.successText, this.renderer.width/2, this.renderer.height * 0.2, 28, alpha);
                
                // 提示下一关
                if (alpha > 0.5 && textTime > this.config.animation.textFadeIn) {
                    this.renderer.drawText(this.config.ui.nextLevelPrompt, this.renderer.width/2, this.renderer.height * 0.9, 18, alpha);
                }
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

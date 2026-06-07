/**
 * 全局配置文件
 * 严格禁止在业务逻辑中硬编码，所有变动参数均在此处调整
 */

const GameConfig = {
    // ==========================================
    // 1. 系统与物理核心配置
    // ==========================================
    core: {
        fps: 60,                        // 目标帧率
        snapTolerance: 50,              // 判定吸附的容错距离（像素），数值越大越容易吸附
        overlapZIndexStrategy: 'highest', // 多碎片重叠时，点击判定的层级策略：'highest' 为最上层优先
        blurRadius: 10,                 // 挖空区域的模糊滤镜半径 (px)
        lobbyBlurRadius: 20             // 大厅中未拼好画作的极度模糊半径 (px)
    },

    // ==========================================
    // 2. 碎片生成与移动规则
    // ==========================================
    pieces: {
        // 碎片在屏幕上方作为选项时的状态
        maxConcurrentPieces: 4,             // 同一时刻出现的图块数量上限
        speedRange: { min: 2.0, max: 5.5 }, // 移动速度的随机区间 (像素/帧)
        directionProb: 0.5,                 // 生成方向概率 (0.5 = 50%向左，50%向右)
        spawnDelay: { min: 600, max: 1500 }, // 碎片生成间隔(ms)
        
        // 碎片在上方移动时的Y轴轨道设定 (使用屏幕高度的百分比，适配不同手机)
        yPositionTracks: [0.05, 0.12, 0.18], 
        
        // 物理掉落
        fallAcceleration: 0.25,             // 碎片被点击后的垂直下落重力加速度
        
        // 视觉呈现
        showOriginalSizeInTrack: true,      // 碎片在上方轨道移动时，是否保持真实裁剪比例（否则缩放为统一大小）
        edgeStrokeColor: 'rgba(255, 255, 255, 0.4)', // 碎片边缘的半透明描边颜色，用于区分重叠图块
        edgeStrokeWidth: 2,                 // 碎片边缘描边宽度

        // 拖拽模式专属配置
        dragMode: {
            backgroundImage: "./resources/images/piece.png",
            frameRect: { x: 0.1, y: 0.05, width: 0.8, height: 0.55 }, // 相框在 piece.png 上的相对坐标，可根据实际底图调整
            scatterAreaY: { min: 0.65, max: 0.95 }, // 碎片在 piece.png 上的散落区域 Y 比例（相框下方）
            scatterRotation: { min: -15, max: 15 }, // 散落时的随机旋转角度
            returnSpeed: 0.15                       // 松手后飞回原位的插值系数
        }
    },

    // ==========================================
    // 3. 动画与镜头过渡时长 (单位：毫秒 ms)
    // ==========================================
    animation: {
        blurTransition: 1200,   // 拼图完成后，画面由模糊变清晰的渐变时间
        zoomIn: 1800,           // 进入关卡时，镜头向挖空区域推进放大的时间
        zoomOut: 1800,          // 关卡完成后，镜头拉远缩回画框的时间
        textFadeIn: 1500,       // 优美文字浮现的淡入时间
        textDuration: 3000,     // 文字在屏幕上方停留展示的时间
        textFadeOut: 1000       // 文字消失的淡出时间
    },

    // 音频配置
    audio: {
        bgm: "./resources/audio/piano.mp3",
        drum: "./resources/audio/drum.mp3"
    },

    // ==========================================
    // 4. UI 提示与文案
    // ==========================================
    ui: {
        clickToStart: "点击画面开始",
        nextLevelPrompt: "点击任意处继续",
        endText: "The End",
        errorPrompt: "哎呀，出错了，请重启试试吧~"
    },

    // ==========================================
    // 5. 大厅与关卡剧本数据 (核心裁剪与文案配置)
    // ==========================================
    lobby: {
        wallImage: "./resources/images/wall.png",
        allowFreeSelection: true, // 设置为 true 允许玩家点击任意未解锁画作
        spotlightRadiusRatio: 0.25 // 鼠标探照灯及发光画作的光照半径系数（基于屏幕最大边）
    },

    levels: [
        {
            id: 1,
            image: "./resources/images/1.png", 
            // 在大厅 wall.png 上的画框坐标百分比和宽高比例（基于 wall 图片自身的宽高）
            lobbyFrameRect: { x: 0.12, y: 0.155, width: 0.35, height: 0.28 },
            // 目标区域：海边小屋（避开左下角小孩）
            cutoutBoundary: { x: 0.3, y: 0.50, width: 0.60, height: 0.336 },
            grid: { cols: 2, rows: 2 }, // 七巧板其实不需要grid，但这保留备用
            shapeTemplate: "tangram", // 第一张使用七巧板
            playMode: "drag", // 使用拖拽模式
            targetTime: 40, // 三星评价目标时间（秒）
            targetMoves: 12, // 三星评价目标步数
            successText: "傍晚的海边最好看，太阳掉进海里之前，会把整面墙染成橘色。我那时不懂，以为这样的光，天天都会有。"
        },
        {
            id: 2,
            image: "./resources/images/2.png",
            lobbyFrameRect: { x: 0.56, y: 0.26, width: 0.30, height: 0.22 },
            // 目标区域：小孩与墓碑 (中央偏下)
            cutoutBoundary: { x: 0.30, y: 0.50, width: 0.675, height: 0.252 },
            grid: { cols: 3, rows: 2 }, // 6块 (3x2)
            shapeTemplate: "classic_jigsaw",
            playMode: "timing", // 使用时机掉落模式
            targetTime: 30,
            targetMoves: 10,
            successText: "湖边总是雾蒙蒙的，塔顶那点光，远得像够不着。我盯着它走了好几年，竟没发现——雾里其实也有光，只是很轻。"
        },
        {
            id: 3,
            image: "./resources/images/3.png",
            lobbyFrameRect: { x: 0.11, y: 0.51, width: 0.35, height: 0.30 },
            // 目标区域：巨大的桥拱 (左上方)
            cutoutBoundary: { x: 0.05, y: 0.10, width: 0.35, height: 0.29 },
            grid: { cols: 2, rows: 3 }, // 6块 (2x3)
            shapeTemplate: "classic_jigsaw",
            playMode: "drag", // 使用时机掉落模式
            targetTime: 30,
            targetMoves: 10,
            successText: "巨大的桥拱，连接着昨日与今朝。"
        },
        {
            id: 4,
            image: "./resources/images/4.png",
            lobbyFrameRect: { x: 0.54, y: 0.55, width: 0.345, height: 0.30 },
            // 目标区域：全屏扣掉
            cutoutBoundary: { x: 0.0, y: 0.0, width: 1.0, height: 1.0 },
            grid: { cols: 4, rows: 3 }, // 12块 (4x3)
            shapeTemplate: "classic_jigsaw",
            playMode: "drag", // 使用拖拽模式
            noRotation: true, // 不允许倾斜
            targetTime: 50,
            targetMoves: 20,
            successText: "兜兜转转，我停在一条点着灯的小街。家家窗里都暖着，有人慢慢走回家。我没再往前追。这条街的光，刚好够我看清回家的路。"
        }
    ],

    // ==========================================
    // 5. 终局与 UI 文案配置
    // ==========================================
    ending: {
        slideshowInterval: 3500,      // 结局时，每张图片轮播展示的间隔时长(ms)
        fadeToBlackDuration: 2500,    // 最后屏幕逐渐变黑的过渡时长(ms)
        finalTexts: [
            "感谢你",
            "寻回这些遗失的时光",
            "晚安。"
        ]
    },
    
    ui: {
        clickToStart: "点击画面开始",
        nextLevelPrompt: "点击进入下一段回忆",
        errorPrompt: "哎呀，出错了，请重启试试吧~"
    }
};

// 兼容 ES6 模块导出与传统 <script> 标签引入
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameConfig;
}

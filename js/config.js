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
        snapTolerance: 20,              // 判定吸附的容错距离（像素），数值越大越容易吸附
        overlapZIndexStrategy: 'highest', // 多碎片重叠时，点击判定的层级策略：'highest' 为最上层优先
        blurRadius: 10                  // 挖空区域的模糊滤镜半径 (px)
    },

    // ==========================================
    // 2. 碎片生成与移动规则
    // ==========================================
    pieces: {
        // 碎片在屏幕上方作为选项时的状态
        speedRange: { min: 2.0, max: 5.5 }, // 移动速度的随机区间 (像素/帧)
        directionProb: 0.5,                 // 生成方向概率 (0.5 = 50%向左，50%向右)
        spawnDelay: { min: 600, max: 1500 }, // 碎片掉落出界后，重新在上方生成的延迟随机区间(ms)
        
        // 碎片在上方移动时的Y轴轨道设定 (使用屏幕高度的百分比，适配不同手机)
        yPositionTracks: [0.08, 0.15, 0.22], 
        
        // 物理掉落
        fallAcceleration: 0.25,             // 碎片被点击后的垂直下落重力加速度
        
        // 视觉呈现
        showOriginalSizeInTrack: true,      // 碎片在上方轨道移动时，是否保持真实裁剪比例（否则缩放为统一大小）
        edgeStrokeColor: 'rgba(255, 255, 255, 0.4)', // 碎片边缘的半透明描边颜色，用于区分重叠图块
        edgeStrokeWidth: 2                  // 碎片边缘描边宽度
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

    // ==========================================
    // 4. 大厅与关卡剧本数据 (核心裁剪与文案配置)
    // ==========================================
    lobby: {
        wallImage: "./images/wall.png", // 引导大厅的背景墙图片
    },

    levels: [
        {
            id: 1,
            image: "./images/1.png", 
            // 在大厅 wall.png 上的画框坐标百分比和宽高比例（基于 wall 图片自身的宽高）
            lobbyFrameRect: { x: 0.10, y: 0.16, width: 0.35, height: 0.28 },
            // 目标区域：海边小屋（避开左下角小孩）
            cutoutBoundary: { x: 0.45, y: 0.50, width: 0.45, height: 0.35 },
            grid: { cols: 3, rows: 3 }, // 房屋区域近似方形，采用 3x3 切割
            shapeTemplate: "classic_jigsaw", // 使用凹凸经典拼图模板
            successText: "夕阳的余晖，拼凑出今天的温柔。"
        },
        {
            id: 2,
            image: "./images/2.png",
            lobbyFrameRect: { x: 0.51, y: 0.26, width: 0.37, height: 0.22 },
            // 目标区域：小孩与墓碑 (中央偏下)
            cutoutBoundary: { x: 0.40, y: 0.55, width: 0.25, height: 0.20 },
            grid: { cols: 3, rows: 2 }, // 区域较小且偏宽，采用 3x2 切割
            shapeTemplate: "classic_jigsaw",
            successText: "微风拂过水面，带走岁月的尘埃。"
        },
        {
            id: 3,
            image: "./images/3.png",
            lobbyFrameRect: { x: 0.10, y: 0.51, width: 0.32, height: 0.30 },
            // 目标区域：巨大的桥拱 (左上方)
            cutoutBoundary: { x: 0.05, y: 0.10, width: 0.40, height: 0.60 },
            grid: { cols: 2, rows: 4 }, // 狭长区域，采用 2x4 切割
            shapeTemplate: "classic_jigsaw",
            successText: "巨大的桥拱，连接着昨日与今朝。"
        },
        {
            id: 4,
            image: "./images/4.png",
            lobbyFrameRect: { x: 0.49, y: 0.55, width: 0.39, height: 0.31 },
            // 目标区域：街道、灯光与栏杆 (右下角)
            cutoutBoundary: { x: 0.50, y: 0.60, width: 0.50, height: 0.40 },
            grid: { cols: 4, rows: 2 }, // 宽扁区域，采用 4x2 切割
            shapeTemplate: "classic_jigsaw",
            successText: "华灯初上，照亮归家的小径。"
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

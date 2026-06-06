/**
 * templates.js
 * 负责生成拼图碎片的形状路径 (Path2D)
 */

class Templates {
    /**
     * 生成经典凹凸拼图的贝塞尔曲线路径
     * @param {number} width 图块的真实渲染宽度
     * @param {number} height 图块的真实渲染高度
     * @param {object} edges 边缘属性 {top: 1|-1|0, right: 1|-1|0, bottom: 1|-1|0, left: 1|-1|0} 1=凸, -1=凹, 0=平
     * @returns {Path2D} 
     */
    static getJigsawPath(width, height, edges) {
        const path = new Path2D();
        
        // 相对凸起/凹陷的比例控制点
        // 使用实际宽高来动态拉伸曲线比例，而不是写死像素
        const earSizeW = width * 0.15; // 凸起占宽度的 15%
        const earSizeH = height * 0.15; // 凸起占高度的 15%
        
        path.moveTo(0, 0);

        // 顶部边缘
        if (edges.top !== 0) {
            const dir = edges.top; // 1 (上凸) or -1 (下凹)
            path.lineTo(width * 0.35, 0);
            // 绘制贝塞尔曲线形成凹凸
            path.bezierCurveTo(width * 0.35, -dir * earSizeH, width * 0.40, -dir * (earSizeH * 2), width * 0.50, -dir * (earSizeH * 2));
            path.bezierCurveTo(width * 0.60, -dir * (earSizeH * 2), width * 0.65, -dir * earSizeH, width * 0.65, 0);
            path.lineTo(width, 0);
        } else {
            path.lineTo(width, 0);
        }

        // 右侧边缘
        if (edges.right !== 0) {
            const dir = edges.right; // 1 (右凸) or -1 (左凹)
            path.lineTo(width, height * 0.35);
            path.bezierCurveTo(width + dir * earSizeW, height * 0.35, width + dir * (earSizeW * 2), height * 0.40, width + dir * (earSizeW * 2), height * 0.50);
            path.bezierCurveTo(width + dir * (earSizeW * 2), height * 0.60, width + dir * earSizeW, height * 0.65, width, height * 0.65);
            path.lineTo(width, height);
        } else {
            path.lineTo(width, height);
        }

        // 底部边缘 (从右向左画)
        if (edges.bottom !== 0) {
            const dir = edges.bottom; // 1 (下凸) or -1 (上凹)
            path.lineTo(width * 0.65, height);
            path.bezierCurveTo(width * 0.65, height + dir * earSizeH, width * 0.60, height + dir * (earSizeH * 2), width * 0.50, height + dir * (earSizeH * 2));
            path.bezierCurveTo(width * 0.40, height + dir * (earSizeH * 2), width * 0.35, height + dir * earSizeH, width * 0.35, height);
            path.lineTo(0, height);
        } else {
            path.lineTo(0, height);
        }

        // 左侧边缘 (从下向上画)
        if (edges.left !== 0) {
            const dir = edges.left; // 1 (左凸) or -1 (右凹)
            path.lineTo(0, height * 0.65);
            path.bezierCurveTo(-dir * earSizeW, height * 0.65, -dir * (earSizeW * 2), height * 0.60, -dir * (earSizeW * 2), height * 0.50);
            path.bezierCurveTo(-dir * (earSizeW * 2), height * 0.40, -dir * earSizeW, height * 0.35, 0, height * 0.35);
            path.lineTo(0, 0);
        } else {
            path.lineTo(0, 0);
        }

        path.closePath();
        return path;
    }
}

// 兼容导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Templates;
}

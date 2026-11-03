# postprocessing：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

已工作的 Three.js 场景和兼容包版本。输入场景颜色、深度或法线缓冲，输出全屏后处理画面。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 渲染链 | EffectComposer、RenderPass、EffectPass | 先渲染场景，再叠加画面效果 |
| 发光与轮廓 | BloomEffect、SelectiveBloomEffect、OutlineEffect | 让选中物体描边，只让指定对象发光 |
| 景深与遮蔽 | DepthOfFieldEffect、SSAOEffect | 镜头聚焦主体，增加接触区域明暗层次 |
| 色彩与风格 | ColorAverage/色彩调整、LUT、Vignette、Noise | 给场景统一调色并添加暗角 |
| 屏幕扭曲 | ChromaticAberrationEffect、GlitchEffect | 点击命中时短暂色散和故障反馈 |
| 抗锯齿 | SMAAEffect、FXAAEffect | 比较边缘质量与负载 |
| 自定义与性能 | Effect 子类、缓冲精度、Pass 组织 | 编写自己的全屏效果并评估缓冲成本 |

## 最小实现路径

composer 添加 RenderPass → 加单个 EffectPass → 循环调用 composer.render → 同步尺寸 → 对比开关效果。

## 展开用例：只给选中物体发光

输入已可见的 Three.js 场景；输出受选中状态控制的发光。

RenderPass 建底图 → 按当前 Selection 接口选对象 → SelectiveBloomEffect → EffectPass → composer.render。

关键参数与验收：先调发光强度/阈值和缓冲精度；分别检查未选物体、遮挡、透明背景与色调映射。

## 边界与常见问题

不要把 Three.js addons 的同名 Composer/Pass 与本库类型混接。HDR、色彩空间、顺序与深度依赖须检查；多效果并非零成本。

## 验证

比较前后亮度、边缘与透明区域；检查 resize、设备性能和释放。

## 官方入口

- https://github.com/pmndrs/postprocessing
- https://pmndrs.github.io/postprocessing/public/docs/

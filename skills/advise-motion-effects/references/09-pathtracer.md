# Three GPU Pathtracer：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

核对项目版本与后端。2026-11-03 阅读的 main 采用 WebGPU；不能与旧 WebGLPathTracer 教程混用。输入场景与镜头，输出逐步收敛的路径追踪画面。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 基础路径追踪 | WebGPUPathTracer、setScene、renderSample | 静止产品镜头累积采样直到噪点满足要求 |
| 物理材质 | MeshStandardMaterial、MeshPhysicalMaterial | 比较金属、粗糙介质和透射表面 |
| 光照与环境 | 环境贴图、MIS、灯光支持表 | 用 HDR 环境和面积光塑造反射 |
| 镜头景深 | Depth of Field 示例与 API | 让前景零件清晰、背景虚化 |
| 图像质量与加速 | maxSamples、降噪/升采样文档、BlurredEnvMapGenerator | 在速度、噪点和反射清晰度间取舍 |
| 变更同步 | update*、reset | 相机或材质变化后更新追踪状态并重新累积 |
| 动画与交付 | Animation Rendering 示例 | 每帧设定场景状态，等待对应采样再捕获 |
| 诊断与释放 | renderSampleDensity、getRenderTime、dispose | 定位收敛慢区域，释放 GPU 资源 |

## 最小实现路径

先跑当前仓库的 Basic Setup → 检查 GPU 后端 → setScene → 静态采样 → 改参数并重置 → 短动画逐帧验证。

## 展开用例：写实产品静帧

输入受支持材质场景与环境贴图；输出收敛后的图像。

检查 WebGPU → 初始化 renderer → WebGPUPathTracer.setScene → renderSample 累积 → 静止达到所选采样门槛 → 捕获。

关键参数与验收：先调 maxSamples、材质粗糙度和镜头；变化后按 API 更新或 reset。图像捕获是额外步骤，不将样本数直接等同质量。

## 边界与常见问题

当前 main 要求 WebGPU，材质支持有限；部分灯光依赖 MIS。运动期间反复重置会阻止收敛，不能直接承诺实时流畅。

## 验证

检查静止时噪点减少；变化后无旧画面残留；逐帧输出没有不同采样质量造成的闪烁。

## 官方入口

- https://github.com/gkjohnson/three-gpu-pathtracer
- https://github.com/gkjohnson/three-gpu-pathtracer/blob/main/src/webgpu/API.md

# Three.quarks：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

Three.js 场景、粒子材质和时间循环。输入发射器与生命周期参数，输出实时粒子；React 集成另有 quarks.r3f。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 发射形状 | 点、球、半球、锥、圆、网格表面、网格排列 | 锥形喷口产生喷射火花 |
| 发射节奏 | ParticleSystem、emissionOverTime、emissionBursts、duration、looping | 持续烟雾与一次性爆发分别配置 |
| 渲染模式 | Billboard、Stretched Billboard、Mesh、Trail | 烟雾面片、拉伸火星、碎片和尾迹分别选模式 |
| 生命周期 | Color/Size/Rotation over lifetime | 火星逐渐缩小变暗，烟雾扩大后消失 |
| 运动行为 | force fields、orbital motion、custom behaviors | 粒子被风吹偏或绕中心旋转 |
| 贴图动画与混合 | texture atlas、blending、材质设置 | 用序列贴图表达火焰变化 |
| 复合特效 | sub-emitters | 主粒子结束时触发次级火花 |
| 编辑与集成 | BatchedRenderer、编辑器 JSON 导出、quarks.r3f | 读取已设计粒子效果，挂到飞行物体上 |

## 最小实现路径

先用当前版本官方最小示例 → 添加系统和批次渲染 → 用统一 delta 更新 → 调形状/生命周期 → 增加复合行为。

## 展开用例：一次火花爆发

输入发射位置和一次点击事件；输出短寿命火花。

从官方例子建立 ParticleSystem → 选择锥形或点发射 → 设置 burst 和非循环 → 配速度/寿命/颜色/大小 → 加入 BatchedRenderer 并更新。

关键参数与验收：先调数量、寿命、速度和锥角；低数量验证重复触发与透明材质，再提高复杂度。

## 边界与常见问题

具体构造参数随版本核对。粒子近似不等于真实流体；透明粒子过绘会成为瓶颈。编辑器数据与运行包版本须对应。

单次爆发的起点配置：`looping: false`、持续发射为 `new ConstantValue(0)`，`emissionBursts` 设 time 为 0、cycle 为 1。初始化先停止，点击时 `restart()`，不要每次新建无限系统。`BatchedRenderer.update(deltaSeconds)` 驱动更新，发射器也须加入 scene。

## 验证

低帧率时粒子寿命仍正确；检查透明排序、尾迹、暂停恢复和资源销毁。

## 官方入口

- https://github.com/Alchemist0823/three.quarks
- https://quarks.art/
- https://docs.quarks.art/docs/core-components/particle-system
- https://docs.quarks.art/docs/core-components/renderers

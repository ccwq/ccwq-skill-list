# Jolt Physics：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

原生 C++ 库；浏览器通过已核验的 JS/WASM 绑定接入。输入碰撞形状、物体状态、约束和力，输出物理状态，渲染由其他工具完成。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 刚体与形状 | BodyInterface、BodyCreationSettings、Shape | 球落到地面并弹跳，渲染网格同步位姿 |
| 碰撞查询 | RayCast、ShapeCast、形状重叠查询 | 鼠标拾取或检测运动路径是否撞墙 |
| 碰撞层与触发 | Object Layers、Sensors、ContactListener | 触发区域播放粒子，过滤不参与碰撞的对象 |
| 关节与驱动 | Hinge、Slider、Distance、SixDOF、motors | 制作铰链门、弹簧摆和机械滑块 |
| 角色与布娃娃 | Character/CharacterVirtual、Ragdoll | 人物与平台交互，或绑定受力骨架 |
| 软体与车辆 | SoftBody、Vehicle 示例 | 评估柔性物体或悬挂系统；先用原生示例确认边界 |
| 毛发与浮力 | GPU strand hair、buoyancy 文档 | 评估毛发随运动摆动或物体在水面受力；先核对平台和绑定支持 |
| 运行与调试 | PhysicsSystem.Update、debug renderer、determinism 文档 | 固定步长模拟，记录输入以比较重复播放 |

## 最小实现路径

选原生或 WASM 路线 → 建静态地面和动态物体 → 固定步长推进 → 同步渲染 → 增加约束。

## 展开用例：碰撞触发火花

输入球与地面；输出物理位姿和接触事件。

建形状/刚体/碰撞层 → 固定步长 PhysicsSystem.Update → 读取位姿更新网格 → ContactListener 通知业务 → 过滤重复事件后发一次粒子。

关键参数与验收：先调形状尺度、重力、摩擦、恢复系数和子步；碰撞位置按对应坐标空间换算。

## 边界与常见问题

各绑定暴露功能不同，不把 C++ 能力直接承诺给 JS。用于视觉模拟，不替代工程有限元求解。确定性有构建和平台条件。

## 验证

不同显示帧率下模拟速度一致；检查穿透、形状比例、碰撞层及约束稳定性。

## 官方入口

- https://github.com/jrouwe/JoltPhysics
- https://jrouwe.github.io/JoltPhysics/

# 按效果检索

先读目标行，再读取工具指南。组合为建议路线，未经统一工程运行验证。只有明确需要某一环节时才加入其工具。

| 目标效果 / 问题关键词 | 主线及具体能力 | 工程逻辑与最小用例 |
| --- | --- | --- |
| 淡入、展开、按钮反馈 | 原生 CSS；复杂状态选 Motion 属性/手势 | 点击改变状态，定义起止值、时长和减少动态效果版本 |
| 多元素错峰、复杂片头 | Anime.js 时间线/stagger | 标题后依次出现内容，明确重播和取消策略 |
| 退出动画被截断 | Motion AnimatePresence | 保留退出节点到完成，检查 key 与条件渲染 |
| 列表重排、卡片变详情 | Motion layout/layoutId | 同一对象身份保持稳定，检查滚动容器与尺寸 |
| 阅读进度、视差、滚动叙事 | Motion scroll/useScroll；Anime.js onScroll | 区分滚动连续映射与进入视口触发 |
| 路径描边、沿曲线移动 | Anime.js SVG；数学图形选 Manim | 先定义路径，再同步位置、方向与时间 |
| 已有 AE 图标、成功态动画 | Lottie loadAnimation/playSegments | 保留实际素材，状态变化映射到片段 |
| 数据驱动短视频、批量标题 | Remotion 合成/props/帧函数 | JSON 数据→组件→Composition→渲染 |
| 公式变形、曲线/几何讲解 | Manim MathTex/Transform/Axes/ValueTracker | 数据或参数→图形→逐步说明；科学结论另核实 |
| 镜头切换、视频转场 | Remotion Sequence/Series/transitions | 定义镜头区间和转场重叠，核对总时长 |
| 3D 产品、模型展示与点选 | Three.js GLTFLoader/材质/Raycaster | 资产→场景→镜头→交互；检查比例与资源路径 |
| 离线建模、布光与转台 | Blender；需要智能体控制时用 Blender MCP | 桥接操作→Blender 场景→渲染/导出，检查镜头 |
| 写实反射、透射、静态产品镜头 | Pathtracer 物理材质/环境/累积采样 | 确认后端，静止采样→调整后重置→再采样 |
| 景深、接触阴影、电影调色 | postprocessing DOF/SSAO/LUT | 先检查深度和色彩，再逐项加效果 |
| 霓虹光晕、选中轮廓 | postprocessing Bloom/SelectiveBloom/Outline | 定义发光/选中对象，检查亮度与遮挡 |
| 命中色散、短暂故障反馈 | postprocessing Glitch/ChromaticAberration | 业务事件控制效果强度包络，及时恢复 |
| 烟雾、火焰、火花、爆发 | Three.quarks 发射/生命周期/贴图 | 选择持续或 burst，配置寿命、颜色与大小曲线 |
| 拖尾、飞行轨迹、带状尾迹 | Three.quarks Trail/Stretched Billboard | 发射器跟随对象，统一 delta，检查低帧率表现 |
| 点云、大量重复对象 | Three.js Points/InstancedMesh | 先用批次表达，不为每个点创建完整对象 |
| 弹跳、机械关节、触发区域 | Jolt 刚体/约束/sensor；Three.js 渲染 | 固定步长模拟→同步位姿→碰撞事件驱动效果 |
| 实时调色/镜头/粒子参数 | Tweakpane bindings/events | 面板值→工程参数→保存配置→重载检查 |
| 生成背景、重绘、视频或3D素材 | ComfyUI 对应模型模板 | 核对权重与节点→出小样→保存工作流→导出素材 |
| 旁白、授权声线、情绪控制 | CosyVoice 对应推理分支 | 文案→语音→试听→以真实时长排镜头 |
| 随音乐律动、自动候选卡点 | librosa beat/onset/RMS/频谱 | 特征帧→秒→动作包络，人工抽查切点 |
| 自动字幕、逐词高亮、访谈标签 | WhisperX transcribe/align/diarize | 音频→词时间→字幕布局；高亮由渲染端实现 |
| 桌面演示、直播、多源录制 | OBS 捕获/场景/轨道/编码 | 先分清应用音和麦克风，再录短片检查 |
| 快剪录屏、保留多个片段 | LosslessCut segments/merge | 核对关键帧切点，导出后检查首尾 |
| 转码、烧字幕、混音、序列出片 | FFmpeg map/filter/codec；ffprobe | 探测输入→短样片→逐项验收→批量输出 |

工具入口及 API 见 SKILL.md 的工具表。跨工具的时间、素材和输出契约见 workflows.md。

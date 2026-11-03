# Three.js：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

浏览器 JavaScript 项目、匹配版本 addons 和可用图形后端。输入几何、模型、材质、状态，输出实时三维画面。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 场景与镜头 | Scene、Object3D/Group、PerspectiveCamera、OrthographicCamera | 搭建产品层级并设置透视或正交展示 |
| 几何与材质 | BufferGeometry、Mesh、MeshStandardMaterial、MeshPhysicalMaterial | 构造网格，调整金属度/粗糙度/透射 |
| 灯光与纹理 | Lights、TextureLoader、环境贴图、阴影 | 给模型补光并检查颜色空间 |
| 模型与动画 | GLTFLoader、AnimationMixer | 加载 GLB，播放其自带动画片段 |
| 交互与控制 | Raycaster、OrbitControls | 点选部件并显示信息，拖动环绕观察 |
| 粒子与复用 | Points、InstancedMesh | 生成点云背景或复用大量相同几何 |
| 定制渲染 | ShaderMaterial；WebGPU/TSL 另查对应文档 | 让顶点随时间位移，或制作自定义材质 |
| 资源与性能 | renderer.info、dispose、分辨率与裁剪 | 评估绘制调用和内存，卸载场景时释放自有资源 |

## 最小实现路径

建 renderer/scene/camera → 加一个可见网格 → 设置循环与 resize → 加模型/交互 → 测目标设备。

## 展开用例：GLB 模型点选

输入 GLB 与部件名称；输出可旋转点选的三维场景。

GLTFLoader 加载 → scene.add → OrbitControls 配目标 → pointer 坐标归一化 → Raycaster 求交 → 将命中对象映射到业务部件。

关键参数与验收：先调模型尺度、camera near/far 与控制范围；Canvas 不是全屏时按其 bounding rect 换算指针。

## 边界与常见问题

光照、材质和后端兼容性按版本核对。图形库不自动提供刚体碰撞或视频导出。共享资源须按所有权释放。

## 验证

检查模型比例、相机裁剪、材质、纹理请求；重复进入页面后内存和循环数量稳定。

## 官方入口

- https://threejs.org/manual/pages/fundamentals.html
- https://threejs.org/manual/pages/loading-3d-models.html
- https://threejs.org/docs/

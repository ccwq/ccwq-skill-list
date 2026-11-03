# 最小实现片段

以下为本技能编写的教学片段，不是完整工程，也未执行各依赖的端到端运行测试。导入与版本在使用前核对。先用短场景，再补错误处理、卸载和素材加载。

## Remotion：按帧淡入

前提：函数作为 Composition 内的组件；帧率和总帧数由 Composition 定义。

```tsx
import {interpolate, useCurrentFrame} from 'remotion';
export const Title = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return <h1 style={{opacity}}>实验结果</h1>;
};
```

验证：跳转第 0、9、18 帧检查透明度。需要延后出现时放进 Sequence；其后代帧号相对 Sequence 起点。

## Anime.js：错峰出现

前提：当前模块化 API，DOM 已挂载并存在 `.result-item`。

```js
import {animate, stagger} from 'animejs';
const animation = animate('.result-item', {
  opacity: [0, 1],
  translateY: [16, 0],
  delay: stagger(70),
  duration: 420,
});
// 卸载时调用 animation.cancel()；复杂组件考虑 scope 管理。
```

验证：元素按顺序出现；重复挂载不叠加实例。时间单位按该工具文档，为毫秒。

## Motion：滚动触发，区别于滚动同步

前提：原生 JS API，元素已挂载。这里是进入视口触发，不是连续滚动进度映射。

```js
import {animate, inView} from 'motion';
const active = new Set();
const stopObserve = inView('.chapter', (element) => {
  const a = animate(element, {opacity: [0, 1]}, {duration: 0.4});
  active.add(a);
  return () => { a.stop(); active.delete(a); };
});
// 页面卸载：stopObserve(); active.forEach(a => a.stop());
```

Vue 工程先查 motion-v 文档；React 查 motion/react。上例 duration 为秒，不能直接复制 Anime.js 的数值。

## Manim：形状变化

前提：文件保存为 demo.py，已安装 Manim Community。这里不使用 LaTeX。

```python
from manim import Scene, Circle, Square, Create, Transform
class ShapeDemo(Scene):
    def construct(self):
        shape = Circle()
        self.play(Create(shape))
        self.play(Transform(shape, Square()))
        self.wait(0.5)
```

用 `manim -ql demo.py ShapeDemo` 预览。检查形状位置和变形过程，再调整质量。

## Lottie：由业务状态播放片段

前提：JSON 含对应帧区间，页面有容器，待 DOMLoaded 后触发。0–40 只是示例区间，必须改为素材的实际范围。

```js
import lottie from 'lottie-web';
const player = lottie.loadAnimation({
  container: document.querySelector('#status'),
  renderer: 'svg', loop: false, autoplay: false, path: '/status.json',
});
player.addEventListener('DOMLoaded', () => player.playSegments([0, 40], true));
// 组件卸载：player.destroy();
```

验证：关闭 autoplay 后不会提前播放；容器尺寸、字体和图片正确。

## Three.js：基于时间旋转

前提：renderer、scene、camera、mesh 已创建且可见。完整工程须补 resize 和资源释放。

```js
renderer.setAnimationLoop((milliseconds) => {
  mesh.rotation.y = milliseconds * 0.001;
  renderer.render(scene, camera);
});
// 卸载：renderer.setAnimationLoop(null)，再按所有权释放资源。
```

这段是绝对时间函数。物理和粒子若依赖历史状态，须使用增量更新、固定步长或预模拟，不能直接跳到任意帧。

## postprocessing：最小发光链

前提：WebGL Three.js 场景与本库版本兼容；以下变量已存在。不要与 Three.js addons 的同名 Composer 混用。

```js
import {BloomEffect, EffectComposer, EffectPass, RenderPass} from 'postprocessing';
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera, new BloomEffect()));
// 在唯一渲染循环中调用 composer.render(deltaSeconds)。
// resize 时同步 composer；卸载时释放自有 composer 和效果资源。
```

验证：先对比无发光画面；再核对亮度、色调映射和 buffer 精度。路径追踪/WebGPU 接入不能默认直接套此链。

## Tweakpane：调参并显式应用

前提：Tweakpane v4 与 ESM；把 applyIntensity 替换为实际工程函数。

```js
import {Pane} from 'tweakpane';
const params = {intensity: 0.8};
const pane = new Pane();
pane.addBinding(params, 'intensity', {min: 0, max: 3, step: 0.05})
  .on('change', ({value}) => applyIntensity(value));
// 保存工程数据：JSON.stringify(params)，由项目选择保存位置。
// 卸载：pane.dispose();
```

验证：刷新后用保存参数初始化画面；不能只确认滑块显示正确。

## librosa：起音时间交给画面端

前提：已安装 librosa，有 input.wav。输出秒时间，非 Remotion 帧号。

```python
import json
import librosa
wave, sr = librosa.load('input.wav', sr=None)
hop = 512
frames = librosa.onset.onset_detect(y=wave, sr=sr, hop_length=hop)
seconds = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
with open('events.json', 'w', encoding='utf-8') as f:
    json.dump({'unit': 'seconds', 'sr': sr, 'hop_length': hop,
               'onsets': seconds.tolist()}, f)
```

画面端先按 `round(t * fps)` 作候选帧，人工试听修正。高亮、爆发、缩放曲线由画面端设计。

## WhisperX：先完成小样转写

前提：CLI 及所需模型就绪；CPU 路线仅作为资源受限时的起点。

```bash
whisperx input.wav --device cpu --compute_type int8
```

核对生成文本与对齐结果后，再依据当前帮助选择字幕格式和词高亮。说话人分离另外配置模型访问，不在命令中写真实 token。

## FFmpeg：序列帧合成与媒体探测

前提：当前构建含 libx264，输入 `frame_0000.png` 起连续编号，尺寸为偶数。30 fps 是示例规格。

```bash
ffmpeg -n -framerate 30 -start_number 0 -i frame_%04d.png -c:v libx264 -pix_fmt yuv420p sample.mp4
ffprobe -v error -show_entries stream=codec_name,width,height,avg_frame_rate -show_entries format=duration -of json sample.mp4
```

`-n` 防止覆盖已有文件；输入序列帧率与输出 `-r` 含义不同。再接旁白时明确 `-map`、起点及长短轨处理，不自动加 `-shortest` 掩盖时长不匹配。

## 桌面与模型工具：不用伪代码冒充可运行接口

- Blender MCP：在空场景读取对象 → 创建一个对象 → 修改材质 → 截图检查 → 保存副本。工具名从当前服务发现读取。
- Jolt：按目标 C++/WASM 官方示例建立地面与球 → 固定步长模拟 → 同步渲染；绑定未确认时不写虚构 JS 导入。
- Three.quarks：复制安装版本官方基本示例的发射器 → 改为单次 burst → 改颜色/大小生命周期 → 绑定点击。具体构造参数读该版本示例。
- ComfyUI：导入官方模型模板 → 核对权重/节点 → 调小尺寸与固定 seed → 执行 → 保存工作流。模型不明确时不生成虚构可运行 JSON。
- CosyVoice：选定模型 → 从对应 example.py 选择合成分支 → 先推理短句 → 试听 → 保存实际音频及参数。不同代际不混用函数。
- OBS：创建场景 → 只加一个窗口源 → 配一条声音 → 录短片并回放。
- LosslessCut：导入原片 → 标两段 → 选择保留与合并 → 导出 → 比较首尾和音轨。
- Remotion Skills：读取相应子规则 → 在现有 Remotion 项目应用 → 预览或导出；技能包不直接产出视频。

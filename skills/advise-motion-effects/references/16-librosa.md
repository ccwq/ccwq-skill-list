# librosa：能力分支与简单用例

资料核对日期：2026-11-03。以下用例是建议路线，未作为完整工程运行验证。API 和安装写法按项目锁定版本再次核对。

## 前提与输入输出

Python 与可解码音频。输入波形和实际采样率，输出特征数组、事件时间或变换后的波形；动画映射由工程实现。

## 主要能力树

每行是一条能力分支。先按任务找到分支，再用入口查官方细节；不把所有入口视作同一版本、模型或后端均可用。

| 能力分支 | 功能 / API / 文档入口 | 简单用例 |
| --- | --- | --- |
| 载入与时间换算 | load、get_duration、frames_to_time | 统一采样率，并把特征帧转为秒 |
| 节拍与速度 | beat.beat_track、beat.tempo | 提取候选鼓点用于镜头切换，再人工校正 |
| 起音与强度 | onset.onset_detect/onset_strength、feature.rms | 检测短促击打，驱动一次粒子爆发 |
| 频谱与音色 | stft、feature.melspectrogram、mfcc、spectral_centroid | 按低频能量改变发光强度 |
| 音高与和声 | yin/pyin、chroma_stft、effects.harmonic/percussive | 分析旋律走势或拆分节奏成分 |
| 声音变换 | effects.time_stretch、pitch_shift、trim | 调整短素材节奏或裁掉静音，再试听 |
| 显示与导出数据 | display.specshow/waveshow；自行保存 JSON | 画频谱检查检测结果，把时间点交给动画 |

## 最小实现路径

读取音频并保留 sr → 选特征和 hop_length → 提取数组 → 换算秒 → 试听比对 → 导出带单位数据。

## 展开用例：节拍驱动镜头切换

输入音乐；输出候选秒时间列表。

load 保留 sr → beat_track 提取帧 → frames_to_time 使用相同 sr/hop_length → 保存 JSON → 试听校正 → 转成画面帧。

关键参数与验收：先调 hop_length 和检测设置；裁切音乐后保留偏移，候选时间必须落在实际音频时长内。

## 边界与常见问题

hop_length、sr 和 center 设置影响时间对应。RMS 不是感知响度标准化，节拍检测不是语音对齐。自动点位不等于创作切点。

## 验证

抽查音乐开中尾的检测点；检查时间单位及偏移，映射后音画同步。

## 官方入口

- https://librosa.org/doc/latest/index.html
- https://librosa.org/doc/latest/api/core.html
- https://librosa.org/doc/latest/api/feature.html
- https://librosa.org/doc/latest/api/onset.html

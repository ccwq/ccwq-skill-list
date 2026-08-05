import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMirrorUrl, mirrorId, normalizeImageReference, buildProxyImage } from '../scripts/lib/normalize.mjs';
import { buildPullCommand } from '../scripts/lib/command-builder.mjs';

/**
 * Given：大小写混合且含路径前缀的镜像 URL
 * When：规范化 URL 并生成镜像标识
 * Then：域名统一且不同路径前缀保持可区分
 * 防回归：避免把不同代理路径误合并为同一个候选
 */
test('normalizes mirror URLs while preserving meaningful path prefixes', () => {
  assert.equal(normalizeMirrorUrl('Docker.Example.COM/dockerhub/'), 'https://docker.example.com/dockerhub');
  assert.equal(mirrorId('https://docker.example.com/dockerhub/'), 'docker.example.com/dockerhub');
  assert.notEqual(mirrorId('https://docker.example.com/dockerhub'), mirrorId('https://docker.example.com/ghcr'));
});

/**
 * Given：Docker Hub 与非 Docker Hub 的镜像引用
 * When：规范化并构造代理镜像地址
 * Then：仅允许重写 Docker Hub 引用
 * 防回归：避免把其他 Registry 的镜像错误发送到公共镜像代理
 */
test('normalizes Docker Hub image references and rejects non-Hub rewrites', () => {
  assert.deepEqual(normalizeImageReference('nginx:1.27'), {
    isDockerHub: true,
    registry: 'docker.io',
    repository: 'library/nginx',
    reference: '1.27',
    canonical: 'docker.io/library/nginx:1.27',
    original: 'nginx:1.27'
  });
  assert.equal(buildProxyImage('https://mirror.example/dockerhub', 'docker.io/library/busybox@sha256:abc'), 'https://mirror.example/dockerhub/library/busybox@sha256:abc');
  assert.equal(normalizeImageReference('ghcr.io/acme/app:1').isDockerHub, false);
  assert.throws(() => buildProxyImage('https://mirror.example', 'ghcr.io/acme/app:1'), /Only Docker Hub/);
});

/**
 * Given：同一镜像在 Linux 与 Windows 的命令输出需求
 * When：构造 docker pull 命令
 * Then：各平台获得正确转义且命令不被执行
 * 防回归：避免推荐命令引入不兼容引号或副作用
 */
test('builds platform-appropriate commands without executing them', () => {
  assert.equal(buildPullCommand('https://mirror.example', 'nginx:1.27', 'linux'), "docker pull 'https://mirror.example/library/nginx:1.27'");
  assert.equal(buildPullCommand('https://mirror.example', 'nginx:1.27', 'win32'), 'docker pull https://mirror.example/library/nginx:1.27');
});

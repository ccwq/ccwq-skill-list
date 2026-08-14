#!/usr/bin/env python3
"""从已登录浏览器 Tab 导出当前页面可访问的图像资源。"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from run_agent_browser import (
    CdpConfigurationError,
    CdpConnectionError,
    build_command,
    cdp_setup_guidance,
    load_project_env,
    parse_cdp,
    resolve_cdp,
    session_for_cdp,
    verify_cdp_connection,
)


EXPORT_EXPRESSION = r"""
(target => (async () => {
  const imageSource = node => {
    if (node instanceof HTMLImageElement) return node.currentSrc || node.src;
    if (node instanceof HTMLSourceElement) return node.src || node.srcset;
    if (node instanceof HTMLAnchorElement) return node.href;
    return node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('data-src');
  };
  const source = target.kind === 'selector'
    ? (() => {
        const candidates = Array.from(document.querySelectorAll(target.value)).filter(node => {
          const rect = node.getBoundingClientRect();
          const intersectsViewport = rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
          return Boolean(imageSource(node)) && intersectsViewport && Boolean(rect.width || rect.height || node.getClientRects().length);
        });
        if (!candidates.length) throw new Error(`找不到可见图像 selector: ${target.value}`);
        const composer = document.querySelector('textarea, [contenteditable="true"]');
        if (!composer) return imageSource(candidates[candidates.length - 1]);
        const composerRect = composer.getBoundingClientRect();
        const distance = node => {
          const rect = node.getBoundingClientRect();
          if (rect.bottom < composerRect.top) return composerRect.top - rect.bottom;
          if (rect.top > composerRect.bottom) return rect.top - composerRect.bottom;
          return 0;
        };
        candidates.sort((a, b) => distance(a) - distance(b));
        return imageSource(candidates[0]);
      })()
    : target.value;
  if (!source) throw new Error('目标元素没有可用图像 URL');
  const url = new URL(source, location.href).href;
  const response = await fetch(url, {credentials: 'include'});
  if (!response.ok) throw new Error(`图像响应失败: HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error(`响应不是图像: ${contentType || 'unknown'}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return JSON.stringify({url, contentType, byteLength: bytes.length, data: btoa(binary)});
})())(%s)
"""

SELECT_AND_OPEN_EXPRESSION = r"""
(selector => (() => {
  const sourceOf = node => node.currentSrc || node.src || node.getAttribute('data-src') || node.href;
  const visible = node => { const r = node.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && Boolean(r.width || r.height); };
  const nodes = Array.from(document.querySelectorAll(selector)).filter(node => visible(node) && sourceOf(node));
  if (!nodes.length) throw new Error(`找不到可见图像 selector: ${selector}`);
  const composer = document.querySelector('textarea, [contenteditable="true"]');
  const c = composer?.getBoundingClientRect();
  const distance = node => { const r = node.getBoundingClientRect(); return c ? Math.max(c.top - r.bottom, r.top - c.bottom, 0) : -r.bottom; };
  nodes.sort((a, b) => distance(a) - distance(b));
  const picked = nodes[0];
  picked.closest('[role="button"]')?.click();
  return JSON.stringify({selected: sourceOf(picked), candidateCount: nodes.length});
})())(%s)
"""

CLICK_SAVE_EXPRESSION = r"""
(() => {
  const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent.trim() === 'Save');
  if (!button) throw new Error('图像查看器中找不到 Save 按钮');
  button.click();
  return JSON.stringify({clicked: true});
})()
"""

HAS_SAVE_EXPRESSION = r"""
(() => JSON.stringify({hasSave: Array.from(document.querySelectorAll('button')).some(node => node.textContent.trim() === 'Save')}))()
"""


def parse_result(output: str, required_keys: set[str] | None = None) -> dict[str, object]:
    decoder = json.JSONDecoder()
    for index, char in enumerate(output):
        if char not in '[{"':
            continue
        try:
            value, _ = decoder.raw_decode(output[index:])
        except json.JSONDecodeError:
            continue
        found = find_result(value, required_keys)
        if found is not None:
            return found
    raise ValueError('无法解析 agent-browser 图像导出结果')


def find_result(value: object, required_keys: set[str] | None = None) -> dict[str, object] | None:
    if isinstance(value, str):
        try:
            return find_result(json.loads(value), required_keys)
        except json.JSONDecodeError:
            return None
    if isinstance(value, dict):
        expected = required_keys or {'url', 'contentType', 'byteLength', 'data'}
        if expected <= value.keys():
            return value
        for nested in value.values():
            found = find_result(nested, required_keys)
            if found is not None:
                return found
    if isinstance(value, list):
        for nested in value:
            found = find_result(nested, required_keys)
            if found is not None:
                return found
    return None


def run_eval(session: str | None, cdp: str, tab: str, expression: str, download_path: Path | None = None, required_keys: set[str] | None = None) -> dict[str, object]:
    command = build_command(session, cdp, ['--json', 'eval', '--stdin'])
    if download_path:
        command[1:1] = ['--download-path', str(download_path)]
    selected = subprocess.run(build_command(session, cdp, ['tab', tab]), text=True, encoding='utf-8', errors='replace', capture_output=True, check=False)
    if selected.returncode != 0:
        raise RuntimeError(selected.stderr.strip() or selected.stdout.strip() or f'无法切换到 tab {tab}')
    result = subprocess.run(command, input=expression, text=True, encoding='utf-8', errors='replace', capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f'agent-browser exit {result.returncode}')
    return parse_result(result.stdout, required_keys)


def download_via_save(session: str | None, cdp: str, tab: str, selector: str, destination: Path, timeout: float = 30) -> dict[str, object]:
    temp_dir = Path(tempfile.mkdtemp(prefix='chatgpt-image-download-'))
    try:
        has_save = run_eval(session, cdp, tab, HAS_SAVE_EXPRESSION, temp_dir, {'hasSave'})
        opened = {'selected': None, 'candidateCount': None}
        if not has_save['hasSave']:
            opened = run_eval(session, cdp, tab, SELECT_AND_OPEN_EXPRESSION % json.dumps(selector, ensure_ascii=False), temp_dir, {'selected', 'candidateCount'})
        run_eval(session, cdp, tab, CLICK_SAVE_EXPRESSION, temp_dir, {'clicked'})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            candidates = [path for path in temp_dir.iterdir() if path.is_file() and not path.name.endswith(('.crdownload', '.tmp')) and path.stat().st_size > 0]
            if candidates:
                downloaded = max(candidates, key=lambda path: path.stat().st_mtime)
                destination.parent.mkdir(parents=True, exist_ok=True)
                downloaded.replace(destination)
                return {'ok': True, 'selected': opened.get('selected'), 'candidate_count': opened.get('candidateCount'), 'bytes': destination.stat().st_size, 'output': str(destination)}
            time.sleep(0.25)
        raise RuntimeError(f'Save 点击后 {timeout:g}s 内未发现已完成下载文件')
    finally:
        for path in temp_dir.glob('*'):
            try:
                path.unlink()
            except OSError:
                pass
        try:
            temp_dir.rmdir()
        except OSError:
            pass


def main() -> int:
    load_project_env()
    parser = argparse.ArgumentParser(description='在当前登录浏览器上下文中导出图像。')
    parser.add_argument('--cdp', '-c', type=parse_cdp, help='CDP 端口或 http(s) URL。')
    parser.add_argument('--session', default=session_for_cdp())
    parser.add_argument('--tab', required=True, help='实时 tab ID。')
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--selector', help='当前页面中 img/source/a 或带 src 的元素 CSS selector。')
    source.add_argument('--url', help='图像 URL；在当前 Tab 页面上下文中 fetch。')
    parser.add_argument('--output', required=True, help='目标文件路径。')
    args = parser.parse_args()
    try:
        args.cdp = resolve_cdp(args.cdp)
        verify_cdp_connection(args.session, args.cdp)
    except (CdpConfigurationError, CdpConnectionError, argparse.ArgumentTypeError) as error:
        print(json.dumps({'ok': False, 'error': f'{error}\n{cdp_setup_guidance()}'}, ensure_ascii=False))
        return 2
    try:
        destination = Path(args.output).expanduser().resolve()
        target = {'kind': 'selector' if args.selector else 'url', 'value': args.selector or args.url}
        payload = run_eval(args.session, args.cdp, args.tab, EXPORT_EXPRESSION % json.dumps(target, ensure_ascii=False), required_keys={'url', 'contentType', 'byteLength', 'data'})
        data = base64.b64decode(str(payload['data']), validate=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=f'.{destination.name}.', suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(data)
        temporary.replace(destination)
        print(json.dumps({'ok': True, 'url': payload['url'], 'content_type': payload['contentType'], 'bytes': len(data), 'output': str(destination)}, ensure_ascii=False))
        return 0
    except (OSError, RuntimeError, ValueError, base64.binascii.Error) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False))
        return 1


if __name__ == '__main__':
    sys.exit(main())

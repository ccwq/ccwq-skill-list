export function resolveImportTargetUrl(_bundle, targetUrl) {
  const parsed = new URL(targetUrl);
  return parsed.toString();
}

function toCdpCookie(cookie, targetUrl) {
  const target = new URL(targetUrl);
  const domain = String(cookie.domain || '').replace(/^\./, '');
  if (!domain || (target.hostname !== domain && !target.hostname.endsWith(`.${domain}`))) throw new Error(`Cookie ${cookie.name || '(无名称)'} 不属于目标域。`);
  if (cookie.partitionKey) throw new Error(`Cookie ${cookie.name || '(无名称)'} 是分区 Cookie，自动迁移已拒绝。`);
  const details = { name: cookie.name, value: String(cookie.value ?? ''), url: target.origin, path: cookie.path || '/' };
  if (cookie.domain?.startsWith('.')) details.domain = cookie.domain;
  if (cookie.secure) details.secure = true;
  if (cookie.httpOnly) details.httpOnly = true;
  if (cookie.sameSite && cookie.sameSite !== 'Unspecified') details.sameSite = cookie.sameSite;
  if (cookie.expires && cookie.expires > 0) details.expires = cookie.expires;
  return details;
}

export function planCdpCookies(cookies, targetUrl) {
  const writable = [];
  const skipped = [];
  for (const cookie of cookies) {
    try { writable.push(toCdpCookie(cookie, targetUrl)); }
    catch (error) { skipped.push({ name: cookie.name || '(无名称)', reason: error.message }); }
  }
  return { writable, skipped };
}

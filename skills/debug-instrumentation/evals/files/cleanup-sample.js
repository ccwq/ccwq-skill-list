export async function refreshSession(refreshToken) {
  console.log('[DBG_auth-flow_q7m2] refresh requested', { hasRefreshToken: Boolean(refreshToken) });

  if (!refreshToken) {
    console.log('[DBG_auth-flow_q7m2] refresh blocked: missing token');
    return null;
  }

  return requestRefresh(refreshToken);
}

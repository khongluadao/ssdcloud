export function clampShareTtlSeconds(ttlSeconds, config) {
  const fallback = config.downloadLinkDefaultTtlSeconds;
  const raw = typeof ttlSeconds === "number" && Number.isFinite(ttlSeconds) ? ttlSeconds : fallback;
  const bounded = Math.max(config.downloadLinkMinTtlSeconds, Math.min(config.downloadLinkMaxTtlSeconds, raw));
  return Math.floor(bounded);
}

export function isShareExpired(expiresAt, nowMs = Date.now()) {
  if (!expiresAt) {
    return true;
  }
  return new Date(expiresAt).getTime() <= nowMs;
}

export function computeSignedDownloadTtlSeconds(expiresAt, maxTtlSeconds, nowMs = Date.now()) {
  const remainingSeconds = Math.max(1, Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000));
  return Math.min(maxTtlSeconds, remainingSeconds);
}

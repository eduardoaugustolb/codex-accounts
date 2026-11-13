export const hostedPanelOrigin = "https://ca.eduardoaugusto.work";

/** The fragment is consumed in the browser and is not sent to the hosting server. */
export function hostedPanelUrl(localUrl: string): string {
  const local = new URL(localUrl);
  return `${hostedPanelOrigin}/#${local.port}.${local.pathname.slice(1, -1)}`;
}

export function hostedPanelCors(request: Request): Record<string, string> {
  if (request.headers.get("origin") !== hostedPanelOrigin) return {};
  return {
    "access-control-allow-origin": hostedPanelOrigin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-allow-private-network": "true",
    vary: "Origin",
  };
}

/**
 * Schneidet das lokale DNS-Suffix (z.B. "fritz.box") vom Client-Namen ab,
 * damit "iPhone.fritz.box" als "iPhone" angezeigt wird. Nackte IPs und Namen
 * mit anderem Suffix bleiben unverändert.
 */
export function stripDnsSuffix(name: string, suffix: string): string {
  if (!suffix) return name;
  const dotted = "." + suffix.replace(/^\.+/, "");
  return name.toLowerCase().endsWith(dotted.toLowerCase())
    ? name.slice(0, -dotted.length)
    : name;
}

export interface DonutSegment {
  color: string;
  dash: number; // Arc-Länge in Pixeln (Umfangsanteil)
  rotate: number; // Startwinkel in Grad
}

export interface DonutCounts {
  cache: number;
  unbound: number;
  blocked: number;
  total: number;
}

/** Drei Ring-Segmente (Cache/Unbound/Blocked) als Arc-Länge + Startwinkel. */
export function donutSegments(counts: DonutCounts, circumference: number): DonutSegment[] {
  const t = counts.total > 0 ? counts.total : 1;
  const order = [
    { value: counts.cache, color: "var(--allowed)" },
    { value: counts.unbound, color: "var(--forwarded)" },
    { value: counts.blocked, color: "var(--blocked)" },
  ];
  let acc = 0;
  return order.map((s) => {
    const seg: DonutSegment = {
      color: s.color,
      dash: (s.value / t) * circumference,
      rotate: (acc / t) * 360,
    };
    acc += s.value;
    return seg;
  });
}

// src/points.js — Système de points

export function computePoints(pronostic, result) {
  if (!result || !pronostic) return 0;
  const { home_score: ph, away_score: pa } = pronostic;
  const { home: rh, away: ra } = result;

  // Score exact → 5 pts
  if (ph === rh && pa === ra) return 5;

  // Écart ±1 but sur chaque équipe → 3 pts
  if (Math.abs(ph - rh) <= 1 && Math.abs(pa - ra) <= 1) return 3;

  // Bonne tendance (victoire / nul / défaite) → 1 pt
  const trend = (h, a) => (h > a ? "H" : h < a ? "A" : "N");
  if (trend(ph, pa) === trend(rh, ra)) return 1;

  return 0;
}

export function pointBadge(pts) {
  if (pts === 5) return { label: "Score exact !", color: "#22c55e", bg: "#052e16" };
  if (pts === 3) return { label: "Très proche",   color: "#f59e0b", bg: "#2d1d00" };
  if (pts === 1) return { label: "Bonne tendance", color: "#60a5fa", bg: "#0c1a2e" };
  return           { label: "Raté",              color: "#6b7280", bg: "#0d0d0d" };
}

// src/points.js — Système de points (fichier Excel Moses Consulting)
// Score exact (victoire ou nul)    = 3 pts
// Bonne tendance victoire           = 1 pt
// Match nul exact                   = 3 pts (déjà couvert par score exact)
// Bonne tendance nul (peu importe score) = 1 pt
// Mauvais résultat                  = 0 pt

export function computePoints(pronostic, result) {
  if (!result || !pronostic) return 0;

  const ph = pronostic.home_score;
  const pa = pronostic.away_score;
  const rh = result.home;
  const ra = result.away;

  const trend = (h, a) => h > a ? "H" : h < a ? "A" : "N";
  const pronoTrend  = trend(ph, pa);
  const resultTrend = trend(rh, ra);

  // Score exact (victoire ou nul) → 3 pts
  if (ph === rh && pa === ra) return 3;

  // Bonne tendance (victoire ou nul correct) → 1 pt
  if (pronoTrend === resultTrend) return 1;

  // Mauvais résultat → 0 pt
  return 0;
}

export function pointBadge(pts) {
  if (pts === 3) return { label: "Score exact !",    color: "#22c55e", bg: "#052e16" };
  if (pts === 1) return { label: "Bonne tendance",   color: "#f59e0b", bg: "#2d1d00" };
  return           { label: "Raté",                  color: "#6b7280", bg: "#0d0d0d" };
}

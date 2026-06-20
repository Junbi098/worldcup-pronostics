// api/matches.js — Vercel Serverless Function
// Proxy vers football-data.org, cache la clé API
// Route : GET /api/matches

const COMPETITION_ID = 2000; // FIFA World Cup 2026
const API_BASE = "https://api.football-data.org/v4";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Méthode non autorisée" });

  const apiKey = process.env.FOOTBALL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Clé API manquante" });

  try {
    const response = await fetch(
      `${API_BASE}/competitions/${COMPETITION_ID}/matches?status=SCHEDULED,TIMED,LIVE,IN_PLAY,PAUSED,FINISHED`,
      { headers: { "X-Auth-Token": apiKey } }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const data = await response.json();

    // Normalisation des matchs pour le frontend
    const matches = (data.matches || []).map((m) => ({
      id: m.id,
      stage: m.stage || null,           // GROUP_STAGE | LAST_32 | LAST_16 | QUARTER_FINALS | SEMI_FINALS | THIRD_PLACE | FINAL
      group: m.group || null,           // GROUP_A...GROUP_L ou null pour knockout
      matchday: m.matchday || null,     // 1, 2, 3 pour phase de poules, null pour knockout
      home: {
        name: m.homeTeam?.name || "À déterminer",
        shortName: m.homeTeam?.shortName || "TBD",
        crest: m.homeTeam?.crest || null,
      },
      away: {
        name: m.awayTeam?.name || "À déterminer",
        shortName: m.awayTeam?.shortName || "TBD",
        crest: m.awayTeam?.crest || null,
      },
      kickoff: m.utcDate,
      status: normalizeStatus(m.status),
      minute: m.minute || null,
      score:
        m.score?.fullTime?.home !== null && m.score?.fullTime?.home !== undefined
          ? { home: m.score.fullTime.home, away: m.score.fullTime.away }
          : m.score?.halfTime?.home !== null && m.score?.halfTime?.home !== undefined
          ? { home: m.score.halfTime.home, away: m.score.halfTime.away }
          : null,
    }));

    // Cache 30 secondes en prod (évite de brûler le quota)
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ matches });
  } catch (error) {
    console.error("Erreur API football:", error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}

function normalizeStatus(status) {
  if (["IN_PLAY", "PAUSED", "LIVE", "HALFTIME"].includes(status)) return "live";
  if (["FINISHED", "AWARDED"].includes(status)) return "finished";
  return "upcoming"; // SCHEDULED, TIMED, POSTPONED, etc.
}
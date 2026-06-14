// src/App.jsx
import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { computePoints, pointBadge } from "./points";

const POLL_INTERVAL_MS = 60_000;
const POLL_LIVE_MS     = 30_000;

// ─── UTILITAIRES ─────────────────────────────────────────────────────────────

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit",
  });
}

function timeUntil(iso) {
  const diff = new Date(iso) - Date.now();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `dans ${h}h${String(m).padStart(2, "0")}`;
  if (m > 0) return `dans ${m}m${String(s).padStart(2, "0")}s`;
  return `dans ${s}s`;
}

function isGroupStage(stage) {
  return !stage || stage === "GROUP_STAGE" || stage.startsWith("Groupe") || stage.startsWith("Group");
}

function stageLabel(stage) {
  const map = {
    "ROUND_OF_16":    "16èmes de finale",
    "QUARTER_FINALS": "Quarts de finale",
    "SEMI_FINALS":    "Demi-finales",
    "THIRD_PLACE":    "Petite finale",
    "FINAL":          "Finale",
  };
  return map[stage] || stage;
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "mc2026salt");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── HOOKS ───────────────────────────────────────────────────────────────────

function useMatches() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const fetchMatches = useCallback(async () => {
    try {
      const res = await fetch("/api/matches");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { matches } = await res.json();
      setMatches(matches || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMatches(); }, [fetchMatches]);

  useEffect(() => {
    const hasLive = matches.some(m => m.status === "live");
    const timer = setInterval(fetchMatches, hasLive ? POLL_LIVE_MS : POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [matches, fetchMatches]);

  return { matches, loading, error };
}

function usePronostics(participantId) {
  const [pronostics, setPronostics] = useState({});

  const loadPronostics = useCallback(async () => {
    if (!participantId) return;
    const { data } = await supabase
      .from("pronostics")
      .select("match_id, home_score, away_score")
      .eq("participant_id", participantId);
    if (data) {
      const map = {};
      data.forEach(p => { map[p.match_id] = p; });
      setPronostics(map);
    }
  }, [participantId]);

  useEffect(() => { loadPronostics(); }, [loadPronostics]);

  const savePronostic = useCallback(async (matchId, homeScore, awayScore) => {
    if (!participantId) return false;
    const { error } = await supabase.from("pronostics").upsert(
      { participant_id: participantId, match_id: matchId, home_score: homeScore, away_score: awayScore },
      { onConflict: "participant_id,match_id" }
    );
    if (!error) {
      setPronostics(prev => ({ ...prev, [matchId]: { home_score: homeScore, away_score: awayScore } }));
    }
    return !error;
  }, [participantId]);

  return { pronostics, savePronostic };
}

function useLeaderboard(matches) {
  const [board, setBoard] = useState([]);

  const refresh = useCallback(async () => {
    const finished = matches.filter(m => m.status === "finished");
    if (!finished.length) { setBoard([]); return; }
    const { data: participants } = await supabase.from("participants").select("id, name");
    const { data: allPronostics } = await supabase
      .from("pronostics")
      .select("participant_id, match_id, home_score, away_score")
      .in("match_id", finished.map(m => m.id));
    if (!participants || !allPronostics) return;
    const scores = participants.map(p => {
      const myProno = allPronostics.filter(x => x.participant_id === p.id);
      let total = 0, exact = 0, close = 0, trend = 0;
      finished.forEach(m => {
        const prono = myProno.find(x => x.match_id === m.id);
        if (!prono || !m.score) return;
        const pts = computePoints(prono, m.score);
        total += pts;
        if (pts === 5) exact++;
        else if (pts === 3) close++;
        else if (pts === 1) trend++;
      });
      return { name: p.name, total, exact, close, trend };
    });
    setBoard(scores.sort((a, b) => b.total - a.total || b.exact - a.exact || b.close - a.close));
  }, [matches]);

  useEffect(() => { refresh(); }, [refresh]);
  return board;
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [name, setName]         = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState("");

  const handleLogin = async () => {
    const trimmed = name.trim();
    if (!trimmed || !password) return;
    setLoading(true); setErr("");

    const { data } = await supabase
      .from("participants")
      .select("id, name, password")
      .eq("name", trimmed)
      .maybeSingle();

    const hashed = await hashPassword(password);

    if (data) {
      if (!data.password) {
        // Existant sans mot de passe → définit le mot de passe
        const { error } = await supabase
          .from("participants")
          .update({ password: hashed })
          .eq("id", data.id);
        if (error) { setErr("Erreur, réessaie."); setLoading(false); return; }
        onLogin({ id: data.id, name: data.name });
      } else if (data.password === hashed) {
        // Bon mot de passe
        onLogin({ id: data.id, name: data.name });
      } else {
        setErr("Mot de passe incorrect.");
      }
    } else {
      // Nouveau participant
      if (password.length < 4) {
        setErr("Mot de passe trop court (min. 4 caractères).");
        setLoading(false); return;
      }
      const { data: newUser, error } = await supabase
        .from("participants")
        .insert({ name: trimmed, password: hashed })
        .select("id, name")
        .single();
      if (error || !newUser) { setErr("Erreur, réessaie."); setLoading(false); return; }
      onLogin(newUser);
    }

    setLoading(false);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#030712",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', system-ui, sans-serif", padding: 24,
    }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      <div style={{ marginBottom: 8, textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#d97706", fontWeight: 800, letterSpacing: 3, textTransform: "uppercase" }}>
          Moses Consulting
        </div>
        <div style={{ width: 40, height: 2, background: "#d97706", margin: "6px auto" }} />
      </div>
      <div style={{ fontSize: 56, marginBottom: 8 }}>⚽</div>
      <h1 style={{ fontWeight: 900, fontSize: 28, color: "#f9fafb", letterSpacing: -1, margin: "0 0 4px", textAlign: "center" }}>
        Pronostics
      </h1>
      <div style={{ color: "#d97706", fontWeight: 700, fontSize: 13, letterSpacing: 3, marginBottom: 36, textTransform: "uppercase" }}>
        Coupe du Monde 2026
      </div>

      <div style={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 16, padding: 28, width: "100%", maxWidth: 380 }}>
        <label style={{ color: "#9ca3af", fontSize: 13, display: "block", marginBottom: 6 }}>Prénom</label>
        <input
          value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && document.getElementById("pwd").focus()}
          placeholder="Ex : Junbi, Thierry…"
          disabled={loading}
          style={{
            width: "100%", background: "#1f2937", border: "1px solid #374151",
            borderRadius: 10, color: "#f9fafb", fontSize: 16, fontWeight: 600,
            padding: "12px 14px", outline: "none", boxSizing: "border-box", marginBottom: 12,
          }}
        />
        <label style={{ color: "#9ca3af", fontSize: 13, display: "block", marginBottom: 6 }}>Mot de passe</label>
        <input
          id="pwd" type="password"
          value={password} onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleLogin()}
          placeholder="••••••••"
          disabled={loading}
          style={{
            width: "100%", background: "#1f2937", border: "1px solid #374151",
            borderRadius: 10, color: "#f9fafb", fontSize: 16,
            padding: "12px 14px", outline: "none", boxSizing: "border-box",
          }}
        />
        <div style={{ fontSize: 11, color: "#4b5563", marginTop: 6, marginBottom: 4 }}>
          Nouveau ? Entre ton prénom et choisis un mot de passe pour créer ton compte.
        </div>
        {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 4 }}>{err}</div>}
        <button onClick={handleLogin} disabled={loading || !name.trim() || !password} style={{
          width: "100%", background: name.trim() && password ? "#d97706" : "#374151",
          color: "#fff", border: "none", borderRadius: 10,
          padding: "13px 0", fontSize: 15, fontWeight: 800,
          cursor: name.trim() && password ? "pointer" : "not-allowed", marginTop: 12,
        }}>
          {loading ? "Connexion…" : "Entrer →"}
        </button>
      </div>
    </div>
  );
}

// ─── MATCH CARD ───────────────────────────────────────────────────────────────

function StatusBadge({ status, minute }) {
  if (status === "live") return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "#7f1d1d", color: "#fca5a5",
      fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 99,
      letterSpacing: 1, textTransform: "uppercase",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f87171", animation: "pulse 1s infinite" }} />
      LIVE {minute ? `${minute}'` : ""}
    </span>
  );
  if (status === "finished") return (
    <span style={{
      background: "#1a1a2e", color: "#6b7280",
      fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 99,
      letterSpacing: 1, textTransform: "uppercase",
    }}>Terminé</span>
  );
  return null;
}

function MatchCard({ match, pronostic, onSave }) {
  const locked = match.status === "live" || match.status === "finished";
  const [h, setH]           = useState(pronostic?.home_score ?? "");
  const [a, setA]           = useState(pronostic?.away_score ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [, setTick]         = useState(0);

  useEffect(() => {
    if (match.status !== "upcoming") return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [match.status]);

  useEffect(() => {
    if (pronostic) { setH(pronostic.home_score); setA(pronostic.away_score); }
  }, [pronostic]);

  const pts   = match.status === "finished" && pronostic && match.score
    ? computePoints(pronostic, match.score) : null;
  const badge = pts !== null ? pointBadge(pts) : null;

  const handleSave = async () => {
    if (isNaN(+h) || isNaN(+a) || +h < 0 || +a < 0) return;
    setSaving(true);
    const ok = await onSave(match.id, +h, +a);
    setSaving(false);
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
  };

  const canSave = h !== "" && a !== "" && !isNaN(+h) && !isNaN(+a) && +h >= 0 && +a >= 0 && !locked;

  return (
    <div style={{
      background: "linear-gradient(135deg,#111827,#1a1f2e)",
      border: `1px solid ${match.status === "live" ? "#7f1d1d" : "#1f2937"}`,
      borderRadius: 14, padding: "18px 20px", marginBottom: 12,
      boxShadow: match.status === "live" ? "0 0 18px rgba(248,113,113,.12)" : "none",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: "#4b5563", textTransform: "uppercase", letterSpacing: 1 }}>
          {isGroupStage(match.stage) ? match.group : stageLabel(match.stage)}
        </span>
        <StatusBadge status={match.status} minute={match.minute} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, textAlign: "right" }}>
          {match.home.crest
            ? <img src={match.home.crest} alt="" style={{ width: 36, height: 36, objectFit: "contain" }} />
            : <div style={{ fontSize: 28 }}>🏳️</div>}
          <div style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 13, marginTop: 4 }}>
            {match.home.shortName || match.home.name}
          </div>
        </div>

        <div style={{ textAlign: "center", minWidth: 88 }}>
          {match.score ? (
            <div style={{ fontSize: 34, fontWeight: 900, color: "#f9fafb", letterSpacing: 2, fontFamily: "monospace" }}>
              {match.score.home}<span style={{ color: "#374151" }}> – </span>{match.score.away}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: "#6b7280" }}>{formatTime(match.kickoff)}</div>
              {timeUntil(match.kickoff) && (
                <div style={{ fontSize: 11, color: "#d97706", fontWeight: 600, marginTop: 2 }}>
                  {timeUntil(match.kickoff)}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ flex: 1, textAlign: "left" }}>
          {match.away.crest
            ? <img src={match.away.crest} alt="" style={{ width: 36, height: 36, objectFit: "contain" }} />
            : <div style={{ fontSize: 28 }}>🏳️</div>}
          <div style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 13, marginTop: 4 }}>
            {match.away.shortName || match.away.name}
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 11, color: "#6b7280", marginTop: 6 }}>
        {formatDate(match.kickoff)}
      </div>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #1f2937", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {locked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#6b7280", fontSize: 12 }}>Mon pronostic :</span>
            {pronostic ? (
              <span style={{ fontWeight: 800, fontSize: 20, color: "#e5e7eb", fontFamily: "monospace" }}>
                {pronostic.home_score} – {pronostic.away_score}
              </span>
            ) : (
              <span style={{ color: "#4b5563", fontSize: 13, fontStyle: "italic" }}>Aucun pronostic</span>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "#9ca3af", fontSize: 12 }}>Mon pronostic :</span>
            {[{ val: h, set: setH }, { val: a, set: setA }].map((inp, i) => (
              <input key={i} type="number" min="0" max="20" value={inp.val}
                onChange={e => inp.set(e.target.value)}
                style={{
                  width: 42, textAlign: "center", background: "#1f2937",
                  border: "1px solid #374151", borderRadius: 6, color: "#f9fafb",
                  fontSize: 18, fontWeight: 800, padding: "4px 0", fontFamily: "monospace", outline: "none",
                }}
              />
            ))}
            <button onClick={handleSave} disabled={!canSave || saving} style={{
              background: canSave ? (saved ? "#16a34a" : "#d97706") : "#374151",
              color: canSave ? "#fff" : "#6b7280",
              border: "none", borderRadius: 6, padding: "5px 12px",
              fontSize: 12, fontWeight: 700, cursor: canSave ? "pointer" : "not-allowed",
            }}>
              {saving ? "…" : saved ? "✓ Sauvegardé" : "✓ Valider"}
            </button>
          </div>
        )}
        {badge && (
          <div style={{
            background: badge.bg, color: badge.color,
            padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 700,
            border: `1px solid ${badge.color}33`,
          }}>
            {badge.label} · +{pts} pts
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ONGLET PRONOSTICS (lecture seule, responsive) ────────────────────────────

function AllPronostics({ matches, currentUser }) {
  const [allPronostics, setAllPronostics] = useState([]);
  const [participants, setParticipants]   = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    const load = async () => {
      const [{ data: parts }, { data: pronos }] = await Promise.all([
        supabase.from("participants").select("id, name").order("name"),
        supabase.from("pronostics").select("participant_id, match_id, home_score, away_score"),
      ]);
      setParticipants(parts || []);
      setAllPronostics(pronos || []);
      setLoading(false);
    };
    load();
  }, []);

  const relevantMatches = matches.filter(m =>
    m.status === "finished" || m.status === "live" ||
    allPronostics.some(p => p.match_id === m.id)
  );

  const getProno = (participantId, matchId) =>
    allPronostics.find(p => p.participant_id === participantId && p.match_id === matchId);

  if (loading) return <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Chargement…</div>;

  if (!relevantMatches.length) return (
    <div style={{ color: "#4b5563", textAlign: "center", padding: 40, fontSize: 14 }}>
      Aucun pronostic enregistré pour l'instant
    </div>
  );

  const active = selectedMatch
    ? relevantMatches.filter(m => m.id === selectedMatch)
    : relevantMatches;

  return (
    <div>
      {/* Filtre par match — scroll horizontal sur mobile */}
      <div style={{ overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, minWidth: "max-content" }}>
          <button onClick={() => setSelectedMatch(null)} style={{
            background: !selectedMatch ? "#d97706" : "#1f2937",
            color: !selectedMatch ? "#fff" : "#9ca3af",
            border: "none", borderRadius: 8, padding: "6px 12px",
            fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
          }}>Tous</button>
          {relevantMatches.map(m => (
            <button key={m.id} onClick={() => setSelectedMatch(m.id === selectedMatch ? null : m.id)} style={{
              background: selectedMatch === m.id ? "#d97706" : "#1f2937",
              color: selectedMatch === m.id ? "#fff" : "#9ca3af",
              border: "none", borderRadius: 8, padding: "6px 10px",
              fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
            }}>
              {m.home.shortName || m.home.name} vs {m.away.shortName || m.away.name}
            </button>
          ))}
        </div>
      </div>

      {/* Matchs */}
      {active.map(m => {
        const matchPronos = participants
          .map(p => ({ participant: p, prono: getProno(p.id, m.id) }))
          .filter(x => x.prono);

        return (
          <div key={m.id} style={{ marginBottom: 24 }}>
            {/* En-tête match — responsive */}
            <div style={{
              background: "#111827", border: "1px solid #1f2937",
              borderRadius: 12, padding: "12px 16px", marginBottom: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {m.home.crest && <img src={m.home.crest} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />}
                  <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 14 }}>
                    {m.home.shortName || m.home.name}
                  </span>
                  {m.score ? (
                    <span style={{ fontWeight: 900, color: "#f9fafb", fontFamily: "monospace", fontSize: 20, margin: "0 4px" }}>
                      {m.score.home} – {m.score.away}
                    </span>
                  ) : (
                    <span style={{ color: "#6b7280", fontSize: 13, margin: "0 4px" }}>vs</span>
                  )}
                  <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 14 }}>
                    {m.away.shortName || m.away.name}
                  </span>
                  {m.away.crest && <img src={m.away.crest} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />}
                </div>
                <StatusBadge status={m.status} minute={m.minute} />
              </div>
              <div style={{ fontSize: 11, color: "#4b5563", marginTop: 4 }}>{formatDate(m.kickoff)}</div>
            </div>

            {/* Pronostics — grille responsive */}
            {matchPronos.length === 0 ? (
              <div style={{ color: "#4b5563", fontSize: 13, padding: "8px 16px", fontStyle: "italic" }}>
                Aucun pronostic pour ce match
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                gap: 8,
              }}>
                {matchPronos.map(({ participant, prono }) => {
                  const pts   = m.status === "finished" && m.score
                    ? computePoints(prono, m.score) : null;
                  const badge = pts !== null ? pointBadge(pts) : null;
                  const isMe  = participant.name === currentUser;

                  return (
                    <div key={participant.id} style={{
                      background: isMe ? "rgba(217,119,6,.12)" : "#0d1117",
                      border: `1px solid ${isMe ? "#d97706" : "#1f2937"}`,
                      borderRadius: 10, padding: "12px 14px",
                    }}>
                      {/* Nom */}
                      <div style={{ fontSize: 12, color: isMe ? "#fbbf24" : "#9ca3af", fontWeight: isMe ? 800 : 500, marginBottom: 6 }}>
                        {isMe ? "👤 " : ""}{participant.name}
                      </div>
                      {/* Score pronostiqué */}
                      <div style={{ fontWeight: 900, color: "#f9fafb", fontFamily: "monospace", fontSize: 22, marginBottom: 6 }}>
                        {prono.home_score} – {prono.away_score}
                      </div>
                      {/* Badge points */}
                      {badge && (
                        <div style={{
                          display: "inline-block",
                          background: badge.bg, color: badge.color,
                          padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 700,
                          border: `1px solid ${badge.color}33`,
                        }}>
                          +{pts} pts · {badge.label}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── CLASSEMENT PAR POULE ────────────────────────────────────────────────────

function GroupStandings({ matches }) {
  const groups = [...new Set(
    matches.filter(m => isGroupStage(m.stage) && m.group).map(m => m.group)
  )].sort();

  if (!groups.length) return (
    <div style={{ color: "#4b5563", textAlign: "center", padding: 40, fontSize: 14 }}>
      Les poules apparaîtront au début de la compétition
    </div>
  );

  return (
    <div>
      {groups.map(group => {
        const groupMatches = matches.filter(m => m.group === group);
        const teams = {};
        groupMatches.forEach(m => {
          [m.home, m.away].forEach(team => {
            if (!teams[team.name]) {
              teams[team.name] = { name: team.name, crest: team.crest, shortName: team.shortName, j: 0, g: 0, n: 0, p: 0, bp: 0, bc: 0, pts: 0 };
            }
          });
          if (m.status !== "finished" || !m.score) return;
          const { home: sh, away: sa } = m.score;
          const hn = m.home.name, an = m.away.name;
          teams[hn].j++; teams[an].j++;
          teams[hn].bp += sh; teams[hn].bc += sa;
          teams[an].bp += sa; teams[an].bc += sh;
          if (sh > sa)      { teams[hn].g++; teams[hn].pts += 3; teams[an].p++; }
          else if (sh < sa) { teams[an].g++; teams[an].pts += 3; teams[hn].p++; }
          else              { teams[hn].n++; teams[hn].pts++; teams[an].n++; teams[an].pts++; }
        });

        const sorted = Object.values(teams).sort((a, b) =>
          b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp
        );

        return (
          <div key={group} style={{ marginBottom: 24 }}>
            <div style={{ color: "#d97706", fontWeight: 800, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
              {group}
            </div>
            <div style={{ background: "#111827", borderRadius: 12, overflow: "hidden", border: "1px solid #1f2937" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 28px 28px 28px 28px 36px 36px", gap: 2, padding: "8px 12px", borderBottom: "1px solid #1f2937" }}>
                {["Équipe","J","G","N","P","DB","Pts"].map(h => (
                  <div key={h} style={{ fontSize: 10, color: "#4b5563", fontWeight: 700, textAlign: h === "Équipe" ? "left" : "center" }}>{h}</div>
                ))}
              </div>
              {sorted.map((t, i) => (
                <div key={t.name} style={{
                  display: "grid", gridTemplateColumns: "1fr 28px 28px 28px 28px 36px 36px",
                  gap: 2, padding: "10px 12px",
                  background: i < 2 ? "rgba(217,119,6,.08)" : "transparent",
                  borderBottom: i < sorted.length - 1 ? "1px solid #1a1a2e" : "none",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    {i < 2 && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#d97706", flexShrink: 0 }} />}
                    {t.crest && <img src={t.crest} alt="" style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0 }} />}
                    <span style={{ fontWeight: 700, color: "#e5e7eb", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.shortName || t.name}
                    </span>
                  </div>
                  {[t.j, t.g, t.n, t.p].map((v, vi) => (
                    <div key={vi} style={{ textAlign: "center", fontSize: 12, color: "#9ca3af" }}>{v}</div>
                  ))}
                  <div style={{ textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
                    {t.bp - t.bc > 0 ? `+${t.bp - t.bc}` : t.bp - t.bc}
                  </div>
                  <div style={{ textAlign: "center", fontSize: 13, color: "#fbbf24", fontWeight: 800 }}>{t.pts}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "#4b5563", marginTop: 8 }}>🟠 = qualifiés · DB = différence de buts</div>
    </div>
  );
}

// ─── BRACKET ─────────────────────────────────────────────────────────────────

const KNOCKOUT_ORDER = ["ROUND_OF_16","QUARTER_FINALS","SEMI_FINALS","THIRD_PLACE","FINAL"];

function BracketMatch({ match }) {
  if (!match) return (
    <div style={{ background: "#0d1117", border: "1px dashed #1f2937", borderRadius: 10, padding: "10px 12px", minWidth: 190 }}>
      <div style={{ color: "#374151", fontSize: 12, fontStyle: "italic" }}>À déterminer</div>
    </div>
  );
  const finished = match.status === "finished";
  const live     = match.status === "live";
  return (
    <div style={{
      background: "linear-gradient(135deg,#111827,#1a1f2e)",
      border: `1px solid ${live ? "#7f1d1d" : "#374151"}`,
      borderRadius: 10, padding: "10px 12px", minWidth: 200,
      boxShadow: live ? "0 0 12px rgba(248,113,113,.15)" : "none",
    }}>
      {[{ team: match.home, score: match.score?.home }, { team: match.away, score: match.score?.away }].map((row, i) => {
        const winner = finished && match.score && (
          (i === 0 && match.score.home > match.score.away) ||
          (i === 1 && match.score.away > match.score.home)
        );
        return (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "4px 0", borderBottom: i === 0 ? "1px solid #1f2937" : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {row.team.crest && <img src={row.team.crest} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />}
              <span style={{ fontSize: 12, fontWeight: winner ? 800 : 500, color: winner ? "#fbbf24" : "#e5e7eb" }}>
                {row.team.shortName || row.team.name}
              </span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, color: winner ? "#fbbf24" : "#6b7280", fontFamily: "monospace", marginLeft: 10 }}>
              {row.score ?? (live ? "–" : "")}
            </span>
          </div>
        );
      })}
      {live && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171", animation: "pulse 1s infinite" }} />
          <span style={{ fontSize: 10, color: "#f87171", fontWeight: 700 }}>LIVE {match.minute}'</span>
        </div>
      )}
      {!live && !finished && (
        <div style={{ marginTop: 4, fontSize: 10, color: "#6b7280" }}>{formatDate(match.kickoff)}</div>
      )}
    </div>
  );
}

function Bracket({ matches }) {
  const knockout = matches.filter(m => !isGroupStage(m.stage));
  if (!knockout.length) return (
    <div style={{ color: "#4b5563", textAlign: "center", padding: 40, fontSize: 14 }}>
      Le tableau apparaîtra à partir des 16èmes de finale
    </div>
  );
  const byStage = {};
  KNOCKOUT_ORDER.forEach(s => { byStage[s] = knockout.filter(m => m.stage === s); });
  const stages = KNOCKOUT_ORDER.filter(s => byStage[s]?.length > 0);
  return (
    <div style={{ overflowX: "auto", paddingBottom: 16 }}>
      <div style={{ display: "flex", gap: 24, minWidth: "max-content", alignItems: "flex-start" }}>
        {stages.map(stage => (
          <div key={stage} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ color: "#d97706", fontWeight: 800, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4, textAlign: "center" }}>
              {stageLabel(stage)}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {byStage[stage].map(m => <BracketMatch key={m.id} match={m} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

function Leaderboard({ board }) {
  const medals = ["🥇","🥈","🥉"];
  if (!board.length) return (
    <div style={{ color: "#4b5563", textAlign: "center", padding: 48, fontSize: 14 }}>
      Le classement apparaîtra après la fin des premiers matchs
    </div>
  );
  return (
    <div>
      {board.map((p, i) => (
        <div key={p.name} style={{
          background: i === 0 ? "linear-gradient(135deg,#1c1400,#2d2000)" : "#111827",
          border: `1px solid ${i === 0 ? "#d97706" : "#1f2937"}`,
          borderRadius: 12, padding: "14px 18px", marginBottom: 10,
          display: "flex", alignItems: "center", gap: 14,
          boxShadow: i === 0 ? "0 0 20px rgba(217,119,6,.2)" : "none",
        }}>
          <div style={{ fontSize: i < 3 ? 26 : 18, minWidth: 34, textAlign: "center" }}>
            {i < 3 ? medals[i] : <span style={{ color: "#6b7280", fontWeight: 700 }}>#{i+1}</span>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, color: i === 0 ? "#fbbf24" : "#e5e7eb", fontSize: 16 }}>{p.name}</div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ color: "#22c55e" }}>⚡ {p.exact} exact</span>
              <span style={{ color: "#f59e0b" }}>≈ {p.close} proche</span>
              <span style={{ color: "#60a5fa" }}>↗ {p.trend} tendance</span>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: i === 0 ? "#fbbf24" : "#e5e7eb", fontFamily: "monospace" }}>
            {p.total}<span style={{ fontSize: 13, color: "#6b7280", fontWeight: 400 }}> pts</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [participant, setParticipant] = useState(null);
  const [tab, setTab] = useState("matches");

  const { matches, loading, error } = useMatches();
  const { pronostics, savePronostic } = usePronostics(participant?.id);
  const board = useLeaderboard(matches);

  const liveCount     = matches.filter(m => m.status === "live").length;
  const finishedCount = matches.filter(m => m.status === "finished").length;

  if (!participant) return <LoginScreen onLogin={setParticipant} />;

  const TABS = [
    { key: "matches",     label: "⚽ Matchs" },
    { key: "pronos",      label: "👁 Pronos" },
    { key: "groups",      label: "📊 Poules" },
    { key: "bracket",     label: "🏆 Tableau" },
    { key: "leaderboard", label: "🎖 Classement" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#030712", fontFamily: "'Segoe UI',system-ui,sans-serif", color: "#f9fafb" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none} *{box-sizing:border-box}`}</style>

      {/* Header */}
      <div style={{
        background: "#030712", borderBottom: "1px solid #111827",
        padding: "12px 20px", position: "sticky", top: 0, zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 10, color: "#d97706", fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>Moses Consulting</div>
          <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: -0.5 }}>Pronostics CDM 2026</div>
          <div style={{ fontSize: 11, color: "#6b7280" }}>
            {liveCount > 0 && <span style={{ color: "#f87171" }}>● {liveCount} en direct · </span>}
            {finishedCount} terminé{finishedCount > 1 ? "s" : ""}
          </div>
        </div>
        <button onClick={() => setParticipant(null)} style={{
          background: "#1f2937", border: "none", color: "#9ca3af",
          borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer",
        }}>
          👤 {participant.name}
        </button>
      </div>

      {/* Navigation */}
      <div style={{ display: "flex", borderBottom: "1px solid #111827", background: "#030712", overflowX: "auto" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flex: 1, background: "none", border: "none", whiteSpace: "nowrap",
            color: tab === t.key ? "#d97706" : "#6b7280",
            fontWeight: tab === t.key ? 800 : 500,
            fontSize: 12, padding: "13px 8px", cursor: "pointer",
            borderBottom: tab === t.key ? "2px solid #d97706" : "2px solid transparent",
            transition: "all .2s",
          }}>{t.label}</button>
        ))}
      </div>

      {/* Contenu */}
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "20px 16px" }}>
        {tab === "matches" && (
          <>
            {loading && <div style={{ color: "#6b7280", textAlign: "center", padding: 40 }}>Chargement des matchs…</div>}
            {error && <div style={{ color: "#f87171", textAlign: "center", padding: 20, fontSize: 14 }}>Erreur : {error}</div>}
            {["live", "upcoming", "finished"].map(status => {
              const group = matches.filter(m => m.status === status);
              if (!group.length) return null;
              const labels = { live: "🔴 En direct", upcoming: "⏰ À venir", finished: "✅ Terminés" };
              const colors = { live: "#f87171", upcoming: "#d97706", finished: "#4b5563" };
              return (
                <div key={status} style={{ marginBottom: 24 }}>
                  <div style={{ color: colors[status], fontWeight: 800, fontSize: 13, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>
                    {labels[status]}
                  </div>
                  {group.map(m => (
                    <MatchCard key={m.id} match={m} pronostic={pronostics[m.id]} onSave={savePronostic} />
                  ))}
                </div>
              );
            })}
          </>
        )}

        {tab === "pronos" && (
          <>
            <h2 style={{ color: "#f9fafb", fontWeight: 900, fontSize: 20, marginBottom: 4 }}>👁 Pronostics de tous</h2>
            <p style={{ color: "#6b7280", fontSize: 13, marginBottom: 16 }}>Lecture seule — les pronostics à venir sont visibles après le coup d'envoi.</p>
            <AllPronostics matches={matches} currentUser={participant.name} />
          </>
        )}

        {tab === "groups" && (
          <>
            <h2 style={{ color: "#f9fafb", fontWeight: 900, fontSize: 20, marginBottom: 16 }}>📊 Classements par poule</h2>
            <GroupStandings matches={matches} />
          </>
        )}

        {tab === "bracket" && (
          <>
            <h2 style={{ color: "#f9fafb", fontWeight: 900, fontSize: 20, marginBottom: 16 }}>🏆 Tableau des phases finales</h2>
            <Bracket matches={matches} />
          </>
        )}

        {tab === "leaderboard" && (
          <>
            <h2 style={{ color: "#f9fafb", fontWeight: 900, fontSize: 20, marginBottom: 16 }}>🎖 Classement général</h2>
            <Leaderboard board={board} />
          </>
        )}
      </div>

      {/* Légende */}
      <div style={{
        background: "#0a0f1a", borderTop: "1px solid #111827",
        padding: "12px 20px", display: "flex", justifyContent: "center", gap: 20, flexWrap: "wrap",
      }}>
        {[
          { pts: 3, label: "Score exact",    color: "#22c55e" },
          { pts: 1, label: "Bonne tendance", color: "#f59e0b" },
          { pts: 0, label: "Raté",           color: "#4b5563" },
        ].map(r => (
          <div key={r.pts} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <span style={{ fontWeight: 800, color: r.color }}>{r.pts} pts</span>
            <span style={{ color: "#6b7280" }}>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

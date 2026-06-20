-- ============================================================
-- SCHEMA SUPABASE — Pronostics Coupe du Monde 2026
-- À coller dans : Supabase > SQL Editor > New Query > Run
-- ============================================================

-- ─── Table des participants ──────────────────────────────────
CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  password TEXT,                                -- hash SHA-256 + salt (nullable pour comptes historiques)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Table des pronostics ────────────────────────────────────
CREATE TABLE IF NOT EXISTS pronostics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL,                    -- ID du match côté football-data.org
  home_score INTEGER NOT NULL CHECK (home_score >= 0),
  away_score INTEGER NOT NULL CHECK (away_score >= 0),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (participant_id, match_id)             -- 1 pronostic par personne par match
);

CREATE INDEX IF NOT EXISTS idx_pronostics_match ON pronostics(match_id);
CREATE INDEX IF NOT EXISTS idx_pronostics_participant ON pronostics(participant_id);

-- Mise à jour automatique de updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pronostics_updated_at ON pronostics;
CREATE TRIGGER trg_pronostics_updated_at
BEFORE UPDATE ON pronostics
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Table des abonnements push (notifications) ──────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE UNIQUE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_participant ON push_subscriptions(participant_id);

-- ============================================================
-- RLS (Row Level Security) — tout le monde lit, tout le monde écrit
-- (app interne bureau, pas besoin d'auth stricte)
-- ============================================================
ALTER TABLE participants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pronostics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- participants
DROP POLICY IF EXISTS "Lecture publique participants" ON participants;
DROP POLICY IF EXISTS "Insertion participants"        ON participants;
DROP POLICY IF EXISTS "Modification participants"     ON participants;
CREATE POLICY "Lecture publique participants" ON participants FOR SELECT USING (true);
CREATE POLICY "Insertion participants"        ON participants FOR INSERT WITH CHECK (true);
CREATE POLICY "Modification participants"     ON participants FOR UPDATE USING (true);

-- pronostics
DROP POLICY IF EXISTS "Lecture publique pronostics" ON pronostics;
DROP POLICY IF EXISTS "Insertion pronostics"        ON pronostics;
DROP POLICY IF EXISTS "Modification pronostics"     ON pronostics;
CREATE POLICY "Lecture publique pronostics" ON pronostics FOR SELECT USING (true);
CREATE POLICY "Insertion pronostics"        ON pronostics FOR INSERT WITH CHECK (true);
CREATE POLICY "Modification pronostics"     ON pronostics FOR UPDATE USING (true);

-- push_subscriptions
DROP POLICY IF EXISTS "Lecture push"      ON push_subscriptions;
DROP POLICY IF EXISTS "Insertion push"    ON push_subscriptions;
DROP POLICY IF EXISTS "Modification push" ON push_subscriptions;
DROP POLICY IF EXISTS "Suppression push"  ON push_subscriptions;
CREATE POLICY "Lecture push"      ON push_subscriptions FOR SELECT USING (true);
CREATE POLICY "Insertion push"    ON push_subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Modification push" ON push_subscriptions FOR UPDATE USING (true);
CREATE POLICY "Suppression push"  ON push_subscriptions FOR DELETE USING (true);
# 🚀 Guide de déploiement — Pronostics CDM 2026

## Ce qu'on va faire (30 minutes)

```
football-data.org (matchs) → Vercel (app + proxy API) → Supabase (base de données)
```

---

## Étape 1 — Récupérer les fichiers

Clone ou télécharge ce projet, puis dans ton terminal :

```bash
npm install
```

---

## Étape 2 — Supabase (base de données)

1. Va sur **supabase.com** → ton projet (ou crée-en un nouveau gratuit)
2. Menu gauche : **SQL Editor** → **New Query**
3. Colle le contenu de `supabase_schema.sql` et clique **Run**
4. Tu dois voir : `participants` et `pronostics` dans **Table Editor**
5. Récupère tes clés : **Project Settings → API**
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon / public key` → `VITE_SUPABASE_ANON_KEY`

---

## Étape 3 — football-data.org (clé API gratuite)

1. Va sur **football-data.org**
2. Clique **"Get API Key"** en haut
3. Inscris-toi avec ton email (gratuit, sans carte)
4. Tu reçois ta clé par email → c'est `FOOTBALL_API_KEY`

> **Note :** La CDM 2026 commence le **11 juin 2026**. L'ID de compétition
> est `2000` (FIFA World Cup), déjà configuré dans `api/matches.js`.

---

## Étape 4 — Déployer sur Vercel

### 4a — Push sur GitHub

```bash
git init
git add .
git commit -m "init pronostics CDM 2026"
# Crée un repo sur github.com, puis :
git remote add origin https://github.com/TON_USER/worldcup-pronostics.git
git push -u origin main
```

### 4b — Connecter à Vercel

1. Va sur **vercel.com** → **Add New Project**
2. Importe ton repo GitHub
3. Framework Preset : **Vite**
4. **Environment Variables** — ajoute ces 3 variables :

| Nom | Valeur |
|-----|--------|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` |
| `FOOTBALL_API_KEY` | `ton_token_football_data` |

5. Clique **Deploy** → Vercel te donne une URL publique ! 🎉

---

## Étape 5 — Test final

1. Ouvre l'URL Vercel
2. Saisis ton prénom → tu arrives dans l'app
3. Les matchs CDM apparaissent en temps réel
4. Envoie le lien à tous tes collègues → ils s'inscrivent et font leurs pronostics

---

## Résumé des coûts

| Service | Plan | Coût |
|---------|------|------|
| Vercel | Hobby (gratuit) | 0 € |
| Supabase | Free tier (500 MB, 50k requêtes/mois) | 0 € |
| football-data.org | Free (10 req/min) | 0 € |
| **Total** | | **0 €** |

---

## FAQ

**Q : Les pronostics sont partagés entre tous ?**
Oui, Supabase stocke tout centralement. Chacun voit les pronostics des autres après le match.

**Q : La clé API est-elle exposée ?**
Non. `FOOTBALL_API_KEY` est utilisée uniquement dans `api/matches.js` (Vercel serverless),
jamais envoyée au navigateur. Seules les variables `VITE_*` sont publiques.

**Q : Que se passe-t-il si le quota de 100 req/jour est dépassé ?**
L'app affiche une erreur temporaire. En pratique, avec un polling toutes les 60s et
~4 matchs/jour max, tu consommes ~24 requêtes/jour. Très en dessous de la limite.

**Q : Comment mettre à jour l'app ?**
`git push` → Vercel redéploie automatiquement en 1 minute.

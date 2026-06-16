// api/notify.js
import webpush from "web-push";

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  const { subscriptions, title, body, url } = req.body;
  if (!subscriptions?.length) return res.status(400).json({ error: "Aucun abonnement" });

  const payload = JSON.stringify({ title, body, url: url || "/" });

  const results = await Promise.allSettled(
    subscriptions.map(sub => webpush.sendNotification(sub, payload))
  );

  const failed = results.filter(r => r.status === "rejected").length;
  return res.status(200).json({ sent: results.length - failed, failed });
}

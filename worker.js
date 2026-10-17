// MYChat push sender (Cloudflare Worker).
// Holds the OneSignal REST key privately and sends a push to everyone in a room except the sender.
//
// Variables to set in Cloudflare (Settings -> Variables and Secrets):
//   ONESIGNAL_APP_ID    (type: Text)
//   ONESIGNAL_REST_KEY  (type: Secret)
//
const FIREBASE_DB_URL = "https://ipchat-b0294-default-rtdb.firebaseio.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const reply = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

// Same rule the chat app uses to build Firebase keys.
const safeId = (raw) => String(raw).trim().replace(/[.#$\[\]\/]/g, "_");

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return reply({ ok: true, info: "MYChat push server" });

    let data;
    try { data = await request.json(); } catch (e) { return reply({ error: "bad json" }, 400); }

    const room = String(data.room || "").slice(0, 100);
    const user = String(data.user || "").slice(0, 60);
    const body = String(data.body || "New message").slice(0, 200);
    if (!room || !user) return reply({ error: "room and user required" }, 400);

    // Only allow pushes from someone who is actually a member of that room.
    try {
      const url = `${FIREBASE_DB_URL}/rooms/${encodeURIComponent(room)}/members/${encodeURIComponent(safeId(user))}.json`;
      const r = await fetch(url);
      if (r.ok) {
        const member = await r.json();
        if (member === null) return reply({ error: "not a room member" }, 403);
      }
    } catch (e) { /* if Firebase can't be reached, continue */ }

    const res = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Key " + env.ONESIGNAL_REST_KEY,
      },
      body: JSON.stringify({
        app_id: env.ONESIGNAL_APP_ID,
        target_channel: "push",
        filters: [
          { field: "tag", key: "room", relation: "=", value: room },
          { operator: "AND" },
          { field: "tag", key: "user", relation: "!=", value: user },
        ],
        headings: { en: user + " • MYChat" },
        contents: { en: body },
        android_group: "mychat-" + room,
        ttl: 3600,
      }),
    });
    const text = await res.text();
    return reply({ ok: res.ok, status: res.status, onesignal: text.slice(0, 300) }, res.ok ? 200 : 502);
  },
};

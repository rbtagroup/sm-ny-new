const json = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export default function handler(_req, res) {
  json(res, 200, {
    ok: true,
    supabaseUrl: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
    serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    vapidPublicKey: Boolean(process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY),
    vapidPrivateKey: Boolean(process.env.VAPID_PRIVATE_KEY),
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:prace@rbgroup.cz',
  })
}

const json = (res, status, payload) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

export default function handler(_req, res) {
  const configured =
    Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
    Boolean(process.env.VAPID_PUBLIC_KEY || process.env.VITE_VAPID_PUBLIC_KEY) &&
    Boolean(process.env.VAPID_PRIVATE_KEY)
  json(res, configured ? 200 : 503, { ok: configured })
}

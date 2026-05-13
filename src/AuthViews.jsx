import { useState } from 'react'

function Field({ label, children, className = '' }) {
  return <div className={`field ${className}`}><label>{label}</label>{children}</div>
}

export function AuthGate({ supabase }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      const payload = { email, password }
      const res = mode === 'signup' ? await supabase.auth.signUp(payload) : await supabase.auth.signInWithPassword(payload)
      if (res.error) throw res.error
      setMsg(mode === 'signup' ? 'Účet je vytvořený. Pokud Supabase vyžaduje potvrzení e-mailu, potvrď ho a potom se přihlas.' : 'Přihlášeno.')
    } catch (err) {
      setMsg(err.message || String(err))
    }
    setBusy(false)
  }
  return <div className="auth-shell"><div className="card auth-card"><div className="brand"><div className="logo">RB</div><div><h1>RBSHIFT</h1><small>Online přihlášení</small></div></div><form className="stack" onSubmit={submit}><Field label="E-mail"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field><Field label="Heslo"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field><button className="primary" disabled={busy}>{busy ? 'Pracuji…' : mode === 'login' ? 'Přihlásit' : 'Vytvořit účet'}</button></form><div className="row-actions" style={{ marginTop: 12 }}><button onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Vytvořit účet' : 'Mám účet – přihlásit'}</button></div>{msg && <p className="hintline">{msg}</p>}</div></div>
}

export function MissingProfile({ supabase, session, error, reload }) {
  const [name, setName] = useState(session?.user?.email?.split('@')[0] || '')
  const [busy, setBusy] = useState(false)
  const createDriverProfile = async () => {
    setBusy(true)
    const { error: rpcError } = await supabase.rpc('rb_ensure_driver_signup_profile', { display_name: name || null, phone_number: null })
    if (rpcError) alert(rpcError.message)
    await reload()
    setBusy(false)
  }
  return <div className="auth-shell"><div className="card auth-card"><h2>Chybí profil uživatele</h2><p className="muted">Přihlášení existuje, ale v tabulce <b>profiles</b> není záznam pro tento účet.</p>{error && <div className="alert bad">{error}</div>}<Field label="Jméno pro profil řidiče"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><div className="row-actions" style={{ marginTop: 12 }}><button className="primary" disabled={busy} onClick={createDriverProfile}>Vytvořit profil řidiče</button><button onClick={reload}>Zkusit načíst znovu</button><button onClick={() => supabase.auth.signOut()}>Odhlásit</button></div></div></div>
}

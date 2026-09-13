import { useState } from 'react'
import { Field } from './AppUi.jsx'
import { appFriendlyError } from './lib/errors.js'

export function AuthGate({ supabase }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const switchMode = (nextMode) => {
    setMode(nextMode)
    setMsg('')
  }
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` })
        if (error) throw error
        setMsg('Pokud účet s tímto e-mailem existuje, poslali jsme odkaz pro nastavení nového hesla.')
      } else {
        const payload = { email, password }
        const res = mode === 'signup' ? await supabase.auth.signUp(payload) : await supabase.auth.signInWithPassword(payload)
        if (res.error) throw res.error
        setMsg(mode === 'signup' ? 'Účet je vytvořený. Potvrď e-mail a přihlas se. Pokud tvůj e-mail dispečink ještě neeviduje, účet počká na schválení.' : 'Přihlášeno.')
      }
    } catch (err) {
      setMsg(appFriendlyError(err.message || String(err)))
    }
    setBusy(false)
  }
  const submitLabel = { login: 'Přihlásit', signup: 'Vytvořit účet', reset: 'Poslat odkaz na nové heslo' }[mode]
  return <div className="auth-shell"><div className="card auth-card"><div className="brand"><div className="logo">RB</div><div><h1>RBSHIFT</h1><small>{mode === 'reset' ? 'Obnova hesla' : 'Online přihlášení'}</small></div></div><form className="stack" onSubmit={submit}><Field label="E-mail"><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>{mode !== 'reset' && <Field label="Heslo"><input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field>}{mode === 'signup' && <p className="hintline">Registrace je pro řidiče. Účet s e-mailem, který dispečink neeviduje, bude čekat na schválení.</p>}{mode === 'reset' && <p className="hintline">Pošleme ti e-mail s odkazem. Po otevření odkazu si nastavíš nové heslo.</p>}<button className="primary" disabled={busy}>{busy ? 'Pracuji…' : submitLabel}</button></form><div className="row-actions" style={{ marginTop: 12 }}>{mode === 'login' ? <><button type="button" onClick={() => switchMode('signup')}>Vytvořit účet</button><button type="button" onClick={() => switchMode('reset')}>Zapomenuté heslo</button></> : <button type="button" onClick={() => switchMode('login')}>Zpět na přihlášení</button>}</div>{msg && <p className="hintline" role="status">{msg}</p>}</div></div>
}

export function PasswordRecovery({ supabase, onDone }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    if (password !== confirmation) {
      setMsg('Hesla se neshodují. Zadej obě pole stejně.')
      return
    }
    setBusy(true)
    setMsg('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setMsg(appFriendlyError(error.message || String(error)))
      return
    }
    onDone?.()
  }
  return <div className="auth-shell"><div className="card auth-card"><div className="brand"><div className="logo">RB</div><div><h1>Nové heslo</h1><small>RBSHIFT</small></div></div><form className="stack" onSubmit={submit}><Field label="Nové heslo"><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></Field><Field label="Nové heslo znovu"><input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={6} /></Field><button className="primary" disabled={busy}>{busy ? 'Ukládám…' : 'Uložit nové heslo'}</button></form>{msg && <p className="hintline" role="status">{msg}</p>}</div></div>
}

export function MissingProfile({ supabase, session, error, reload }) {
  const [name, setName] = useState(session?.user?.email?.split('@')[0] || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const createDriverProfile = async () => {
    setBusy(true)
    setMessage('')
    try {
      const { error: rpcError } = await supabase.rpc('rb_ensure_driver_signup_profile', { display_name: name || null, phone_number: null })
      if (rpcError) {
        setMessage(appFriendlyError(rpcError.message))
        setBusy(false)
        return
      }
      await reload()
    } catch (err) {
      setMessage(appFriendlyError(err.message || String(err)))
    }
    setBusy(false)
  }
  return <div className="auth-shell"><div className="card auth-card"><h2>Chybí profil uživatele</h2><p className="muted">Přihlášení existuje, ale aplikace pro něj ještě nemá řidičský profil.</p>{error && <div className="alert bad">{appFriendlyError(error)}</div>}{message && <div className="alert warn">{message}</div>}<Field label="Jméno pro profil řidiče"><input value={name} onChange={(e) => setName(e.target.value)} /></Field><div className="row-actions" style={{ marginTop: 12 }}><button className="primary" disabled={busy} onClick={createDriverProfile}>Vytvořit profil řidiče</button><button onClick={reload} disabled={busy}>Zkusit načíst znovu</button><button onClick={() => supabase.auth.signOut()} disabled={busy}>Odhlásit</button></div></div></div>
}

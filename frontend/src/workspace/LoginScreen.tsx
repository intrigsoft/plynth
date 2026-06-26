import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEMO_USERS, useAuth } from '../lib/session';
import { ArrowRight, Avatar, ChevronRight, Logo, Shield, Warn } from '../lib/icons';

export function LoginScreen() {
  const { login, loginAs } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    const err = login(email, password);
    if (err) setError(err);
    else nav('/');
  };

  return (
    <div className="dot-surface dot-surface--login" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '28px 16px', overflow: 'auto' }}>
      <div style={{ width: 394, background: '#fff', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 18px 50px rgba(16,20,27,.13)', padding: '32px 30px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <Logo size={27} />
          <span style={{ fontWeight: 800, fontSize: 18 }}>Plynth</span>
        </div>
        <h1 style={{ fontSize: 21, fontWeight: 800, margin: '0 0 5px' }}>Sign in</h1>
        <p style={{ fontSize: 13.5, color: 'var(--muted-3)', margin: '0 0 20px', lineHeight: 1.5 }}>
          Your projects, documents, and an assistant that works inside your session.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label-mono">Email</span>
            <input className="input" type="email" placeholder="you@company.com" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="label-mono">Password</span>
            <input className="input" type="password" placeholder="••••••••" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && submit()} />
          </label>
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff4ec', border: '1px solid #fed7aa', color: '#c2410c', borderRadius: 9, padding: '9px 11px', fontSize: 12.5, marginTop: 12 }}>
            <Warn size={16} /> {error}
          </div>
        )}

        <button className="btn btn--primary" onClick={submit} style={{ width: '100%', justifyContent: 'center', height: 42, marginTop: 16 }}>
          Sign in <ArrowRight size={16} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 12px' }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--faint)' }}>DEMO ACCOUNTS</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {DEMO_USERS.map((u) => (
            <button key={u.email} onClick={() => { loginAs(u); nav('/'); }}
              style={{ display: 'flex', alignItems: 'center', gap: 11, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 11px' }}>
              <Avatar user={u} size={34} />
              <span style={{ flex: 1, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{u.name}</span>
                <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted-3)' }}>{u.email}</span>
              </span>
              <ChevronRight size={16} color="var(--faint)" />
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 18, fontSize: 11, color: 'var(--muted-3)' }}>
          <Shield size={14} color="var(--teal)" /> Credentials stay in your browser · credential-blind
        </div>
      </div>
    </div>
  );
}

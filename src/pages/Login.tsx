import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Mail, AlertCircle, ShieldCheck } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA step-up
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const navigate = useNavigate();

  const finish = () => {
    navigate('/', { replace: true });
    setLoading(false);
  };

  const checkMfaThenFinish = async () => {
    // If the account has a verified factor, Supabase requires AAL2 before access.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === 'verified');
      if (totp) {
        setMfaFactorId(totp.id);
        setMfaRequired(true);
        setLoading(false);
        return;
      }
    }
    finish();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (data?.session) {
      const { data: check } = await supabase.auth.getSession();
      if (!check.session) {
        setError('Sign-in succeeded but session was not stored. Please try again.');
        setLoading(false);
        return;
      }
    }

    await checkMfaThenFinish();
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaFactorId) return;
    setError('');
    setLoading(true);

    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: mfaFactorId });
    if (chErr || !ch) {
      setError(chErr?.message ?? 'Could not start verification');
      setLoading(false);
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: ch.id,
      code: mfaCode.trim(),
    });
    if (vErr) {
      setError(vErr.message || 'Invalid code');
      setLoading(false);
      return;
    }
    finish();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="glass-panel p-8">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
              {mfaRequired ? <ShieldCheck className="h-7 w-7 text-primary" /> : <Lock className="h-7 w-7 text-primary" />}
            </div>
            <h1 className="text-2xl font-semibold text-foreground">Expense Memory</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {mfaRequired ? 'Enter your authenticator code' : 'Private access only'}
            </p>
          </div>

          {!mfaRequired ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="glass-input pl-10 h-11"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="glass-input pl-10 h-11"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full h-11" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleMfaSubmit} className="space-y-4">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="glass-input h-11 tracking-widest text-center"
                autoFocus
                required
              />

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full h-11" disabled={loading || mfaCode.length !== 6}>
                {loading ? 'Verifying...' : 'Verify'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ShieldCheck, ShieldAlert, Loader2, Trash2 } from 'lucide-react';

type Factor = { id: string; friendly_name?: string | null; status: string };

/**
 * TOTP multi-factor enrollment + management.
 * Lives in Settings. Enrolling requires verifying a code so the factor becomes
 * "verified" and will be enforced at the next login.
 */
export function MfaCard() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error && data) {
      setFactors((data.totp ?? []) as Factor[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const verified = factors.filter((f) => f.status === 'verified');

  const startEnroll = async () => {
    setEnrolling(true);
    setCode('');
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
    if (error || !data) {
      toast.error(error?.message ?? 'Could not start enrollment');
      setEnrolling(false);
      return;
    }
    setFactorId(data.id);
    setQr(data.totp.qr_code);
    setSecret(data.totp.secret);
  };

  const cancelEnroll = async () => {
    if (factorId) await supabase.auth.mfa.unenroll({ factorId }).catch(() => {});
    setEnrolling(false);
    setQr(null);
    setSecret(null);
    setFactorId(null);
    setCode('');
  };

  const verifyEnroll = async () => {
    if (!factorId) return;
    setVerifying(true);
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !ch) {
      toast.error(chErr?.message ?? 'Challenge failed');
      setVerifying(false);
      return;
    }
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
    if (error) {
      toast.error(error.message || 'Invalid code');
      setVerifying(false);
      return;
    }
    toast.success('Two-factor authentication enabled');
    setVerifying(false);
    setEnrolling(false);
    setQr(null);
    setSecret(null);
    setFactorId(null);
    setCode('');
    refresh();
  };

  const removeFactor = async (id: string) => {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) { toast.error(error.message); return; }
    toast.success('Two-factor removed');
    refresh();
  };

  return (
    <div className="glass-panel p-4 space-y-4">
      <div className="flex items-center gap-2">
        {verified.length > 0
          ? <ShieldCheck className="h-4 w-4 text-primary" />
          : <ShieldAlert className="h-4 w-4 text-muted-foreground" />}
        <h3 className="text-sm font-medium text-foreground">Two-Factor Authentication (2FA)</h3>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Add an authenticator app (Google Authenticator, 1Password, Authy) for a second layer of
        protection. Once enabled, you'll enter a 6-digit code at every sign-in.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {verified.length > 0 && (
            <div className="space-y-2">
              {verified.map((f) => (
                <div key={f.id} className="flex items-center justify-between glass-panel-sm p-2">
                  <span className="text-xs text-foreground">
                    {f.friendly_name || 'Authenticator app'} · <span className="text-primary">active</span>
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-destructive" onClick={() => removeFactor(f.id)}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          {!enrolling && (
            <Button size="sm" variant={verified.length > 0 ? 'outline' : 'default'} onClick={startEnroll}>
              {verified.length > 0 ? 'Add another device' : 'Enable 2FA'}
            </Button>
          )}

          {enrolling && (
            <div className="glass-panel-sm p-3 space-y-3">
              {qr && (
                <div className="flex flex-col items-center gap-2">
                  <img src={qr} alt="Scan this QR code with your authenticator app" className="h-44 w-44 rounded-lg bg-white p-2" />
                  {secret && (
                    <p className="text-[10px] text-muted-foreground break-all text-center">
                      Or enter this key manually: <span className="font-mono text-foreground">{secret}</span>
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground">Enter the 6-digit code from your app</label>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="glass-input h-10 tracking-widest text-center"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={verifyEnroll} disabled={verifying || code.length !== 6}>
                  {verifying ? 'Verifying…' : 'Verify & enable'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEnroll} disabled={verifying}>Cancel</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

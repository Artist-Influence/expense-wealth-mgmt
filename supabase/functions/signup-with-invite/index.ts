import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const BodySchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
  inviteCode: z.string().trim().min(1, 'Invite code is required').max(64),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    const first =
      Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? 'Invalid input';
    return json({ error: first }, 400);
  }

  const { email, password, displayName, inviteCode } = parsed.data;

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Validate invite code (case-insensitive, must be active).
  const normalized = inviteCode.trim().toUpperCase();
  const { data: codeRow, error: codeErr } = await admin
    .from('invite_codes')
    .select('id, is_active')
    .ilike('code', normalized)
    .maybeSingle();

  if (codeErr) {
    console.error('invite code lookup failed', codeErr);
    return json({ error: 'Could not verify invite code. Please try again.' }, 500);
  }

  if (!codeRow || !codeRow.is_active) {
    return json({ error: 'Invalid or inactive invite code.' }, 403);
  }

  // 2. Create the account (email auto-confirmed for instant access).
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (createErr) {
    const msg = (createErr.message ?? '').toLowerCase();
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return json({ error: 'An account with this email already exists.' }, 409);
    }
    console.error('createUser failed', createErr);
    return json({ error: 'Could not create account. Please try again.' }, 400);
  }

  return json({ success: true });
});

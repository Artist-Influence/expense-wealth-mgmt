import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data } = await admin.auth.admin.listUsers();
  const u = data?.users?.find((x) => x.email === 'friend.test@example.com');
  if (u) await admin.auth.admin.deleteUser(u.id);
  return new Response(JSON.stringify({ deleted: !!u }));
});

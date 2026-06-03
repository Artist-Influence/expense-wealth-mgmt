import { supabase } from '@/integrations/supabase/client';

export const RECEIPT_BUCKET = 'receipts';
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const RECEIPT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const SIGNED_URL_TTL_SECONDS = 60; // short-lived

function randomName(ext: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '');
  return `${rand}.${ext}`;
}

function extFor(type: string): string {
  switch (type) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'application/pdf': return 'pdf';
    default: return 'bin';
  }
}

/**
 * Uploads a receipt to the private bucket under the current user's folder.
 * Returns the storage path (NOT a public URL — there are none).
 * Validates type + size client-side; storage RLS enforces ownership server-side.
 */
export async function uploadReceipt(file: File): Promise<{ path: string } | { error: string }> {
  if (!RECEIPT_ALLOWED_TYPES.includes(file.type)) {
    return { error: 'Only JPG, PNG, WEBP, or PDF files are allowed.' };
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return { error: 'File is too large (max 10MB).' };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  // Non-guessable path, scoped to the user's own folder (matches storage RLS).
  const path = `${user.id}/${randomName(extFor(file.type))}`;

  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) return { error: error.message };
  return { path };
}

/** Creates a short-lived signed URL to view a receipt the user owns. */
export async function getReceiptUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/** Permanently removes a receipt file. */
export async function deleteReceipt(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
  return !error;
}

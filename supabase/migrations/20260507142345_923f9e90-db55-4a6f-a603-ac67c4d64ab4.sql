
-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('owner', 'investor');

-- 2. Create user_roles table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Security-definer function to check roles without recursion
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 4. RLS policies
CREATE POLICY "Users can read own role"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owner can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'owner'))
  WITH CHECK (public.has_role(auth.uid(), 'owner'));

-- 5. Seed Jared as owner
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'owner'::app_role
FROM auth.users
WHERE email = 'jared@artistinfluence.com'
ON CONFLICT (user_id, role) DO NOTHING;

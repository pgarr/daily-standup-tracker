-- Replaces the RLS UPDATE path with a SECURITY DEFINER function that:
--   1. Locks the row (FOR UPDATE) to serialize concurrent accept attempts.
--   2. Performs workspace_member INSERT + accepted_at UPDATE atomically.
--   3. Prevents column-mutation attacks that bypassed the old UPDATE policy.
-- Phase 3's accept-invite endpoint calls supabase.rpc('accept_invitation', {p_token}).

DROP POLICY IF EXISTS "invited user can accept invitation" ON workspace_invitation;

CREATE OR REPLACE FUNCTION accept_invitation(p_token text)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS
$$
DECLARE
  v_inv workspace_invitation;
BEGIN
  SELECT * INTO v_inv
  FROM workspace_invitation
  WHERE token = p_token
    AND email = (auth.jwt() ->> 'email')
    AND accepted_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or expired invitation';
  END IF;

  IF EXISTS (SELECT 1 FROM workspace_member WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'already a member of a workspace';
  END IF;

  INSERT INTO workspace_member (workspace_id, user_id, role)
  VALUES (v_inv.workspace_id, auth.uid(), v_inv.role);

  UPDATE workspace_invitation SET accepted_at = now() WHERE id = v_inv.id;
END;
$$;

GRANT EXECUTE ON FUNCTION accept_invitation(text) TO authenticated;

-- get_invitation_by_token is intentionally callable by anon: the pre-auth
-- accept-invite page must look up invite details before the user signs in.
-- The token is the access credential; email exposure for UX pre-fill is intentional.
GRANT EXECUTE ON FUNCTION get_invitation_by_token(text) TO anon, authenticated;

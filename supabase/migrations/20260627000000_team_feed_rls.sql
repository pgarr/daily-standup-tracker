-- S-05: Team Feed — add Team Lead SELECT policy on standup_entries (deferred from S-03)
-- and a SECURITY DEFINER helper that returns (user_id, email) for all workspace members.

CREATE POLICY "team lead can view all standup entries in workspace"
  ON standup_entries FOR SELECT TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Returns (user_id, email) for every workspace_member in the caller's workspace.
-- Only returns rows when the caller is a team_lead; members get empty results.
-- STABLE: reads auth.users identity data, which is stable per session.
-- auth.users is fully qualified so SET search_path = public does not shadow it.
CREATE OR REPLACE FUNCTION get_workspace_member_emails()
  RETURNS TABLE(user_id uuid, email text)
  LANGUAGE sql SECURITY DEFINER STABLE
  SET search_path = public
AS $$
  SELECT wm.user_id, u.email::text
  FROM workspace_member wm
  JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = auth_user_workspace_id()
    AND auth_user_is_team_lead();
$$;

GRANT EXECUTE ON FUNCTION get_workspace_member_emails() TO authenticated;

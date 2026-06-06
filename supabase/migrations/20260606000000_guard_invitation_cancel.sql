-- Restrict the Team Lead DELETE policy to pending invitations only.
-- Accepted invitations must not be deletable — doing so would remove the member
-- from the members list while their workspace_member row survives (ghost member).
DROP POLICY IF EXISTS "team lead can cancel invitation" ON workspace_invitation;

CREATE POLICY "team lead can cancel invitation"
  ON workspace_invitation FOR DELETE TO authenticated
  USING (
    auth_user_is_team_lead()
    AND workspace_id = auth_user_workspace_id()
    AND accepted_at IS NULL
  );

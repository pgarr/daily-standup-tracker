-- S-06: Standup Entry Edit & Delete — add UPDATE and DELETE RLS policies
-- FR-007 (edit own entry) and FR-008 (delete own entry), deferred from S-03.

CREATE POLICY "members can update own standup entries"
  ON standup_entries FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND workspace_id = auth_user_workspace_id());

CREATE POLICY "members can delete own standup entries"
  ON standup_entries FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

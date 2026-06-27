-- Tighten UPDATE and DELETE RLS USING clauses to match INSERT policy defence-in-depth.
-- The original USING (auth.uid() = user_id) allowed a workspace-migrated user
-- to row-select their old-workspace entries. For UPDATE the WITH CHECK vetoed
-- the write, but for DELETE (no WITH CHECK) the gap was the sole RLS gate.

DROP POLICY "members can update own standup entries" ON standup_entries;
DROP POLICY "members can delete own standup entries" ON standup_entries;

CREATE POLICY "members can update own standup entries"
  ON standup_entries FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND workspace_id = auth_user_workspace_id())
  WITH CHECK (auth.uid() = user_id AND workspace_id = auth_user_workspace_id());

CREATE POLICY "members can delete own standup entries"
  ON standup_entries FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND workspace_id = auth_user_workspace_id());

-- Drop the stale "invited user can join workspace as member" INSERT policy on workspace_member.
-- This policy was designed for the original two-statement accept flow (Phase 3 plan).
-- Migration 20260605000001 replaced it with accept_invitation() SECURITY DEFINER, which
-- atomically handles the INSERT + accepted_at stamp in one transaction.
-- Leaving the policy active allows a raw Supabase client call to INSERT without stamping
-- accepted_at, creating a ghost-pending invitation state.
DROP POLICY IF EXISTS "invited user can join workspace as member" ON workspace_member;

-- Worry Meter — run once in Supabase SQL editor

CREATE TABLE IF NOT EXISTS wm_people (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name      text NOT NULL,
  relation  text NOT NULL DEFAULT '',
  emoji     text NOT NULL DEFAULT '😟',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wm_worries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES wm_people(id) ON DELETE CASCADE,
  category   text NOT NULL DEFAULT 'other',
  description text NOT NULL DEFAULT '',
  intensity  int  NOT NULL DEFAULT 5 CHECK (intensity BETWEEN 1 AND 10),
  logged_at  timestamptz DEFAULT now(),
  outcome    text DEFAULT NULL  -- 'happened' | 'didnt_happen' | null
);

ALTER TABLE wm_people  ENABLE ROW LEVEL SECURITY;
ALTER TABLE wm_worries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wm_people_own"  ON wm_people  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wm_worries_own" ON wm_worries USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

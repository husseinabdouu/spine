-- backbone_conversations: shared conversation history for the Backbone AI
-- Used by both the dashboard mini-chat widget and the full Insights page.

CREATE TABLE IF NOT EXISTS backbone_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users NOT NULL,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backbone_conversations_user_created
  ON backbone_conversations (user_id, created_at);

ALTER TABLE backbone_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access own conversations only"
  ON backbone_conversations FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE learners (
  id UUID PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','provisional','merged')),
  suspected_of UUID REFERENCES learners(id),
  merged_into UUID REFERENCES learners(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX learners_name_unique ON learners (canonical_name) WHERE status <> 'merged';

CREATE TABLE learner_aliases (
  id BIGSERIAL PRIMARY KEY,
  learner_id UUID NOT NULL REFERENCES learners(id),
  entered_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE learner_emails (
  learner_id UUID NOT NULL REFERENCES learners(id),
  email TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (learner_id, email)
);

CREATE TABLE attempts (
  id UUID PRIMARY KEY,
  learner_id UUID NOT NULL REFERENCES learners(id),
  attempt_no SMALLINT NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','submitted')),
  started_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  submit_reason TEXT CHECK (submit_reason IN ('logout','deadline')),
  option_orders JSONB NOT NULL,
  score NUMERIC(5,2),
  UNIQUE (learner_id, attempt_no)
);
CREATE UNIQUE INDEX attempts_one_active ON attempts (learner_id) WHERE status = 'active';

CREATE TABLE attempt_work (
  attempt_id UUID PRIMARY KEY REFERENCES attempts(id),
  revision INTEGER NOT NULL DEFAULT 0,
  tickets JSONB NOT NULL DEFAULT '{}',
  articles JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attempt_scores (
  attempt_id UUID PRIMARY KEY REFERENCES attempts(id),
  total NUMERIC(5,2) NOT NULL,
  register_total NUMERIC(5,2) NOT NULL,
  articles_total NUMERIC(5,2) NOT NULL,
  detail JSONB NOT NULL,
  key_version TEXT NOT NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attempt_events (
  id BIGSERIAL PRIMARY KEY,
  learner_id UUID NOT NULL REFERENCES learners(id),
  attempt_id UUID REFERENCES attempts(id),
  kind TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}',
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE assessor_throttle (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  failures INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);

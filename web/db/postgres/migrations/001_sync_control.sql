BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_sync_status') THEN
    CREATE TYPE shop_sync_status AS ENUM (
      'PENDING',
      'BOOTSTRAPPING',
      'HEALTHY',
      'DEGRADED',
      'FAILED',
      'UNINSTALLED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_run_mode') THEN
    CREATE TYPE sync_run_mode AS ENUM (
      'BOOTSTRAP',
      'DELTA',
      'RECONCILE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_run_phase') THEN
    CREATE TYPE sync_run_phase AS ENUM (
      'BULK_PRODUCTS_CORE',
      'BULK_VARIANTS_CORE',
      'BULK_COLLECTION_MEMBERSHIP',
      'BULK_INVENTORY_LEVELS',
      'ROLLUP_REBUILD_CORE'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_run_status') THEN
    CREATE TYPE sync_run_status AS ENUM (
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'webhook_event_status') THEN
    CREATE TYPE webhook_event_status AS ENUM (
      'RECEIVED',
      'DEDUPED',
      'ENQUEUED',
      'PROCESSED',
      'FAILED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shop (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain VARCHAR(255) NOT NULL UNIQUE,
  shop_gid VARCHAR(255) UNIQUE,
  access_token TEXT NOT NULL,
  access_scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  api_version VARCHAR(32) NOT NULL,
  sync_status shop_sync_status NOT NULL DEFAULT 'PENDING',
  installed_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ(6),
  last_successful_sync_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  phase sync_run_phase NOT NULL,
  mode sync_run_mode NOT NULL,
  status sync_run_status NOT NULL DEFAULT 'QUEUED',
  bulk_operation_gid VARCHAR(255),
  bulk_operation_status VARCHAR(64),
  bulk_result_url TEXT,
  object_count BIGINT,
  file_size_bytes BIGINT,
  started_at TIMESTAMPTZ(6),
  completed_at TIMESTAMPTZ(6),
  error_code VARCHAR(128),
  error_message TEXT,
  stats_json JSONB,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_event_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  topic VARCHAR(255) NOT NULL,
  webhook_id VARCHAR(255),
  api_version VARCHAR(32),
  payload_hash CHAR(64) NOT NULL,
  status webhook_event_status NOT NULL DEFAULT 'RECEIVED',
  resource_gid VARCHAR(255),
  raw_headers_json JSONB,
  raw_body_json JSONB,
  received_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ(6),
  error_message TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_webhook_event_shop_topic_payload_hash UNIQUE (shop_id, topic, payload_hash)
);

CREATE INDEX IF NOT EXISTS idx_sync_run_shop_status
  ON sync_run (shop_id, status);

CREATE INDEX IF NOT EXISTS idx_sync_run_shop_phase_mode
  ON sync_run (shop_id, phase, mode);

CREATE INDEX IF NOT EXISTS idx_sync_run_shop_created_at
  ON sync_run (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_event_shop_status_received_at
  ON webhook_event_ledger (shop_id, status, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_event_shop_resource_gid
  ON webhook_event_ledger (shop_id, resource_gid);

COMMIT;
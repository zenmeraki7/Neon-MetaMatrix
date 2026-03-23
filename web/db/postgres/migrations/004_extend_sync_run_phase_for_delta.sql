BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'sync_run_phase'
      AND e.enumlabel = 'REFRESH_PRODUCT'
  ) THEN
    ALTER TYPE sync_run_phase ADD VALUE 'REFRESH_PRODUCT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'sync_run_phase'
      AND e.enumlabel = 'REFRESH_VARIANT'
  ) THEN
    ALTER TYPE sync_run_phase ADD VALUE 'REFRESH_VARIANT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'sync_run_phase'
      AND e.enumlabel = 'REFRESH_INVENTORY_ITEM'
  ) THEN
    ALTER TYPE sync_run_phase ADD VALUE 'REFRESH_INVENTORY_ITEM';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'sync_run_phase'
      AND e.enumlabel = 'REFRESH_COLLECTION_MEMBERSHIP'
  ) THEN
    ALTER TYPE sync_run_phase ADD VALUE 'REFRESH_COLLECTION_MEMBERSHIP';
  END IF;
END $$;

COMMIT;
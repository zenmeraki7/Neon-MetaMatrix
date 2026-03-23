BEGIN;

CREATE TABLE IF NOT EXISTS product_mirror (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  product_gid VARCHAR(255) NOT NULL,
  legacy_product_id BIGINT,
  title TEXT NOT NULL,
  handle VARCHAR(255) NOT NULL,
  description_text TEXT,
  vendor VARCHAR(255),
  product_type VARCHAR(255),
  status VARCHAR(64),
  template_suffix VARCHAR(255),
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at_shopify TIMESTAMPTZ(6),
  updated_at_shopify TIMESTAMPTZ(6),
  published_at_shopify TIMESTAMPTZ(6),
  has_images BOOLEAN NOT NULL DEFAULT FALSE,
  variant_count_rollup INTEGER NOT NULL DEFAULT 0,
  total_inventory_rollup INTEGER NOT NULL DEFAULT 0,
  min_price_rollup NUMERIC(18, 4),
  max_price_rollup NUMERIC(18, 4),
  min_compare_at_price_rollup NUMERIC(18, 4),
  max_compare_at_price_rollup NUMERIC(18, 4),
  option1_name VARCHAR(255),
  option2_name VARCHAR(255),
  option3_name VARCHAR(255),
  shopify_updated_at TIMESTAMPTZ(6),
  last_observed_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_mirror_shop_product_gid UNIQUE (shop_id, product_gid)
);

CREATE TABLE IF NOT EXISTS variant_mirror (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  variant_gid VARCHAR(255) NOT NULL,
  product_gid VARCHAR(255) NOT NULL,
  inventory_item_gid VARCHAR(255),
  legacy_variant_id BIGINT,
  title TEXT,
  sku VARCHAR(255),
  barcode VARCHAR(255),
  price NUMERIC(18, 4),
  compare_at_price NUMERIC(18, 4),
  cost NUMERIC(18, 4),
  taxable BOOLEAN,
  requires_shipping BOOLEAN,
  inventory_policy VARCHAR(64),
  inventory_tracked BOOLEAN,
  inventory_quantity_rollup INTEGER NOT NULL DEFAULT 0,
  option1_value VARCHAR(255),
  option2_value VARCHAR(255),
  option3_value VARCHAR(255),
  weight NUMERIC(18, 6),
  weight_unit VARCHAR(32),
  weight_grams INTEGER,
  country_of_origin VARCHAR(8),
  hs_tariff_code VARCHAR(64),
  shopify_updated_at TIMESTAMPTZ(6),
  last_observed_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_variant_mirror_shop_variant_gid UNIQUE (shop_id, variant_gid),
  CONSTRAINT fk_variant_mirror_product
    FOREIGN KEY (shop_id, product_gid)
    REFERENCES product_mirror(shop_id, product_gid)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_raw_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  product_gid VARCHAR(255) NOT NULL,
  raw_document JSONB NOT NULL,
  raw_metafields JSONB,
  raw_publications JSONB,
  raw_seo JSONB,
  document_hash CHAR(64),
  shopify_updated_at TIMESTAMPTZ(6),
  last_observed_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_raw_snapshot_shop_product_gid UNIQUE (shop_id, product_gid),
  CONSTRAINT fk_product_raw_snapshot_product
    FOREIGN KEY (shop_id, product_gid)
    REFERENCES product_mirror(shop_id, product_gid)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS variant_raw_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  variant_gid VARCHAR(255) NOT NULL,
  product_gid VARCHAR(255) NOT NULL,
  raw_document JSONB NOT NULL,
  raw_metafields JSONB,
  raw_inventory_item JSONB,
  document_hash CHAR(64),
  shopify_updated_at TIMESTAMPTZ(6),
  last_observed_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_variant_raw_snapshot_shop_variant_gid UNIQUE (shop_id, variant_gid),
  CONSTRAINT fk_variant_raw_snapshot_variant
    FOREIGN KEY (shop_id, variant_gid)
    REFERENCES variant_mirror(shop_id, variant_gid)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_status
  ON product_mirror (shop_id, status);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_vendor
  ON product_mirror (shop_id, vendor);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_product_type
  ON product_mirror (shop_id, product_type);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_created_at_shopify
  ON product_mirror (shop_id, created_at_shopify DESC);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_updated_at_shopify
  ON product_mirror (shop_id, updated_at_shopify DESC);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_published_at_shopify
  ON product_mirror (shop_id, published_at_shopify DESC);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_has_images
  ON product_mirror (shop_id, has_images);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_total_inventory
  ON product_mirror (shop_id, total_inventory_rollup);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_min_price
  ON product_mirror (shop_id, min_price_rollup);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_max_price
  ON product_mirror (shop_id, max_price_rollup);

CREATE INDEX IF NOT EXISTS idx_product_mirror_shop_handle
  ON product_mirror (shop_id, handle);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_product_gid
  ON variant_mirror (shop_id, product_gid);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_inventory_item_gid
  ON variant_mirror (shop_id, inventory_item_gid);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_sku
  ON variant_mirror (shop_id, sku);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_barcode
  ON variant_mirror (shop_id, barcode);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_price
  ON variant_mirror (shop_id, price);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_compare_at_price
  ON variant_mirror (shop_id, compare_at_price);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_inventory_qty
  ON variant_mirror (shop_id, inventory_quantity_rollup);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_inventory_policy
  ON variant_mirror (shop_id, inventory_policy);

CREATE INDEX IF NOT EXISTS idx_variant_mirror_shop_weight_grams
  ON variant_mirror (shop_id, weight_grams);

CREATE INDEX IF NOT EXISTS idx_product_raw_snapshot_shop_last_observed
  ON product_raw_snapshot (shop_id, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_variant_raw_snapshot_shop_product_gid
  ON variant_raw_snapshot (shop_id, product_gid);

CREATE INDEX IF NOT EXISTS idx_variant_raw_snapshot_shop_last_observed
  ON variant_raw_snapshot (shop_id, last_observed_at DESC);

COMMIT;
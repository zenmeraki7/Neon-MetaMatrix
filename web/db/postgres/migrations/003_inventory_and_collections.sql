BEGIN;

CREATE TABLE IF NOT EXISTS inventory_level_mirror (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  inventory_item_gid VARCHAR(255) NOT NULL,
  variant_gid VARCHAR(255),
  location_gid VARCHAR(255) NOT NULL,
  location_name VARCHAR(255),
  available INTEGER,
  on_hand INTEGER,
  updated_at_shopify TIMESTAMPTZ(6),
  last_observed_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_level_shop_item_location UNIQUE (shop_id, inventory_item_gid, location_gid),
  CONSTRAINT fk_inventory_level_variant
    FOREIGN KEY (shop_id, variant_gid)
    REFERENCES variant_mirror(shop_id, variant_gid)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS product_collection_membership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shop(id) ON DELETE CASCADE,
  product_gid VARCHAR(255) NOT NULL,
  collection_gid VARCHAR(255) NOT NULL,
  collection_title VARCHAR(255),
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  last_observed_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_product_collection_membership UNIQUE (shop_id, product_gid, collection_gid),
  CONSTRAINT fk_pcm_product
    FOREIGN KEY (shop_id, product_gid)
    REFERENCES product_mirror(shop_id, product_gid)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_inventory_level_shop_location_available
  ON inventory_level_mirror (shop_id, location_gid, available);

CREATE INDEX IF NOT EXISTS idx_inventory_level_shop_variant_location
  ON inventory_level_mirror (shop_id, variant_gid, location_gid);

CREATE INDEX IF NOT EXISTS idx_pcm_shop_collection_gid
  ON product_collection_membership (shop_id, collection_gid);

CREATE INDEX IF NOT EXISTS idx_pcm_shop_product_gid
  ON product_collection_membership (shop_id, product_gid);

CREATE INDEX IF NOT EXISTS idx_pcm_shop_is_manual
  ON product_collection_membership (shop_id, is_manual);

COMMIT;
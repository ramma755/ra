ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS business_type VARCHAR(30);

ALTER TABLE platform_users
  DROP CONSTRAINT IF EXISTS platform_users_business_type_check;

ALTER TABLE platform_users
  ADD CONSTRAINT platform_users_business_type_check
  CHECK (
    business_type IS NULL
    OR business_type IN ('WHOLESALE', 'RETAILER', 'RESTAURANT', 'GENERAL_SERVICES')
  );

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS business_type VARCHAR(30) NOT NULL DEFAULT 'WHOLESALE';

ALTER TABLE catalog_items
  DROP CONSTRAINT IF EXISTS catalog_items_business_type_check;

ALTER TABLE catalog_items
  ADD CONSTRAINT catalog_items_business_type_check
  CHECK (business_type IN ('WHOLESALE', 'RETAILER', 'RESTAURANT', 'GENERAL_SERVICES'));

ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS catalog_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE catalog_items c
SET business_type = COALESCE(u.business_type, 'WHOLESALE')
FROM platform_users u
WHERE u.masked_id = c.seller_masked_id
  AND (c.business_type IS NULL OR c.business_type = 'WHOLESALE');

CREATE INDEX IF NOT EXISTS idx_platform_users_business_type
  ON platform_users(business_type);

CREATE INDEX IF NOT EXISTS idx_catalog_items_business_type
  ON catalog_items(business_type, is_active);

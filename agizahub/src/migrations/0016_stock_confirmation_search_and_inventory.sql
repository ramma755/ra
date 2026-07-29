ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS stock_quantity INT NOT NULL DEFAULT 100 CHECK (stock_quantity >= 0);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS catalog_item_id BIGINT REFERENCES catalog_items(id);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS seller_stock_status TEXT NOT NULL DEFAULT 'PENDING';

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_seller_stock_status_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_seller_stock_status_check
  CHECK (seller_stock_status IN ('PENDING', 'IN_STOCK', 'OUT_OF_STOCK'));

CREATE INDEX IF NOT EXISTS idx_catalog_items_search
  ON catalog_items (commodity_name, price_per_unit, stock_quantity, is_active);

CREATE INDEX IF NOT EXISTS idx_orders_supplier_stock_status
  ON orders (supplier_masked_id, seller_stock_status, payment_status, created_at);

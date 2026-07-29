INSERT INTO industries (name)
VALUES ('Fresh Produce')
ON CONFLICT (name) DO NOTHING;

INSERT INTO products (industry_id, name, unit)
SELECT i.id, 'Tomatoes', 'kg'
FROM industries i
WHERE i.name = 'Fresh Produce'
ON CONFLICT (industry_id, name) DO NOTHING;

INSERT INTO products (industry_id, name, unit)
SELECT i.id, 'Onions', 'kg'
FROM industries i
WHERE i.name = 'Fresh Produce'
ON CONFLICT (industry_id, name) DO NOTHING;

INSERT INTO product_slang (product_id, phrase)
SELECT p.id, 'nyanya'
FROM products p
WHERE p.name = 'Tomatoes'
ON CONFLICT (phrase) DO NOTHING;

INSERT INTO product_slang (product_id, phrase)
SELECT p.id, 'kitunguu'
FROM products p
WHERE p.name = 'Onions'
ON CONFLICT (phrase) DO NOTHING;

INSERT INTO vendors (name, contact_phone, wallet_type, mpesa_identifier, account_reference)
VALUES
  ('Gikomba Fresh Paybill', '254700111222', 'PAYBILL', '400200', 'AGIZAHUB-PB'),
  ('Wakulima Till Shop', '254700333444', 'TILL', '854321', 'AGIZAHUB-TILL'),
  ('Direct Farmer Msisdn', '254700555666', 'PHONE', '254700555666', 'AGIZAHUB-PHONE')
ON CONFLICT DO NOTHING;

INSERT INTO vendor_inventory (vendor_id, product_id, price_kes, quantity_available, location_label)
SELECT v.id, p.id, 95, 2000, 'Gikomba'
FROM vendors v
CROSS JOIN products p
WHERE v.name = 'Gikomba Fresh Paybill'
  AND p.name = 'Tomatoes'
ON CONFLICT DO NOTHING;

INSERT INTO vendor_inventory (vendor_id, product_id, price_kes, quantity_available, location_label)
SELECT v.id, p.id, 110, 1500, 'Wakulima'
FROM vendors v
CROSS JOIN products p
WHERE v.name = 'Wakulima Till Shop'
  AND p.name = 'Tomatoes'
ON CONFLICT DO NOTHING;

INSERT INTO transporters (name, phone, vehicle_type)
VALUES ('Agiza Rider 1', '254711123456', 'Motorbike')
ON CONFLICT (phone) DO NOTHING;

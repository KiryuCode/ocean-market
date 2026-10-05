-- Replace bottom three catalog items with herbs (sort_order 3,4,5 after top three).
DELETE FROM products WHERE id IN ('harbor-notebook','nautilus-print','deep-blue-hoodie','basil','rosemary','thyme');

INSERT INTO products (id, name, price, description, image, qty_available, sort_order, created_at) VALUES
('basil', 'basil', 9.99, 'Fresh sweet basil grown in Ohio — fragrant leaves for pesto, salads, and finishing.', 'https://images.unsplash.com/photo-1618375569909-3c8616cf7733?w=600&h=600&fit=crop', 25, 3, NOW()),
('rosemary', 'rosemary', 9.99, 'Woody rosemary sprigs with piney aroma — great for roast meats and bread.', 'https://images.unsplash.com/photo-1515586000433-45406d8e6662?w=600&h=600&fit=crop', 25, 4, NOW()),
('thyme', 'thyme', 8.99, 'Delicate thyme sprigs with earthy, lemony notes — a kitchen staple herb.', 'https://images.unsplash.com/photo-1556682851-c0583ebe6f2f?w=600&h=600&fit=crop', 25, 5, NOW());

-- Ensure top three keep sort_order 0,1,2
UPDATE products SET sort_order = 0 WHERE id = 'wave-mug';
UPDATE products SET sort_order = 1 WHERE id = 'tide-tote';
UPDATE products SET sort_order = 2 WHERE id = 'coral-candle';

SELECT id, name, price, sort_order, LEFT(description, 70) AS d FROM products ORDER BY sort_order ASC, name ASC;

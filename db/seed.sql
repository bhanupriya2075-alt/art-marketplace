-- =====================================================================
--  Reference data: art supply categories.
--  Run after schema.sql:  psql -U marketplace_app -d marketplace_db -f db/seed.sql
-- =====================================================================

BEGIN;

INSERT INTO categories (name, description) VALUES
  ('Paints',        'Acrylics, oils, watercolours, gouache and inks'),
  ('Brushes',       'Paint brushes, palette knives and applicators'),
  ('Canvases',      'Stretched canvases, canvas boards and panels'),
  ('Sketchbooks',   'Sketchbooks, drawing pads and loose paper'),
  ('Drawing Tools', 'Pencils, charcoal, pastels, pens and markers'),
  ('Easels',        'Tabletop, studio and travel easels'),
  ('Craft Supplies','Clay, moulds, adhesives and mixed-media materials'),
  ('Frames & Display', 'Frames, mounts and display stands'),
  ('Other',         'Anything else art-related')
ON CONFLICT (name) DO NOTHING;

COMMIT;

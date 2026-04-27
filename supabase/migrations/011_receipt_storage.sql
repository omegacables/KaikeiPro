-- Receipt file metadata columns
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS original_filename text;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS file_size integer;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS mime_type text;

-- Create storage bucket for receipts (run via Supabase dashboard or CLI)
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('receipts', 'receipts', false, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']);

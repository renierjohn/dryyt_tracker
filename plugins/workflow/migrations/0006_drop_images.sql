-- Transaction photos (and their OCR/camera capture) were removed. Drops the
-- table added in 0003_images.sql; the R2 objects it pointed at are not
-- touched here — empty/delete the TRANSACTION_IMAGES bucket separately.
DROP INDEX IF EXISTS idx_workflow_transaction_images_txn;
DROP TABLE IF EXISTS workflow_transaction_images;

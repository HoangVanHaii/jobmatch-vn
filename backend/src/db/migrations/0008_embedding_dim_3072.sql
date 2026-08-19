-- ============================================================================
-- Migration 0008: Chuẩn hóa embedding dimension → 768
-- (Tên file "_dim_3072" là lịch sử — flow thật: thử 3072 → fail HNSW → truncate 768)
--
-- Lý do cuối cùng:
--   - gemini-embedding-001 default = 3072-dim (Matryoshka representation)
--   - HNSW index (pgvector) max 2000-dim → KHÔNG dùng được 3072
--   - 768 là dim chuẩn cho retrieval (text-embedding-004 cũ cũng 768, đủ tốt)
--   - App layer dùng raw SDK + `outputDimensionality=768` để Gemini truncate
--
-- An toàn vì bảng embeddings đang rỗng (chưa có data thật).
-- ============================================================================

-- Bước 1: Revert cột về 768 (nếu DB hiện đang 3072 do migration partial trước)
DROP INDEX IF EXISTS idx_embeddings_hnsw;
ALTER TABLE embeddings ALTER COLUMN vector TYPE vector(768);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON embeddings USING HNSW (vector vector_cosine_ops);

COMMENT ON COLUMN embeddings.vector IS
  '768-dim — Matryoshka truncated output of gemini-embedding-001 (max HNSW = 2000)';

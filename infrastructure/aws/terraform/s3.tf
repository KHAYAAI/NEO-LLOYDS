# Claims evidence storage -- MinIO locally (infrastructure/docker), S3
# here, same API. security-model.md §7: "Evidence in object storage,
# encrypted, accessed by pre-signed URL with short expiry." Encryption and
# public-access blocking are enforced here; short-expiry pre-signed URLs
# are an application-code contract this bucket doesn't and can't enforce
# by itself -- confirm apps/api's evidence-URL code actually sets a short
# expiry before relying on this comment as a control.
resource "aws_s3_bucket" "evidence" {
  bucket = "neo-lloyds-${var.environment}-evidence"

  tags = {
    Project     = "neo-lloyds"
    Environment = var.environment
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  versioning_configuration {
    status = "Enabled" # Claims evidence is exactly the kind of record you do not want silently overwritten.
  }
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "neo-lloyds-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
}

# A single-node cluster -- Redis is provisioned (docker-compose.yml has it
# too) but not yet used by any application code beyond being available;
# see docs/security-model.md and apps/api for what would actually consume
# it (rate-limit state, session caching) before sizing this for real
# traffic or turning on cluster mode.
resource "aws_elasticache_cluster" "this" {
  cluster_id         = "neo-lloyds-${var.environment}"
  engine             = "redis"
  engine_version     = "7.1"
  node_type          = var.redis_node_type
  num_cache_nodes    = 1
  port               = 6379
  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.redis.id]
  apply_immediately  = var.environment != "production"

  tags = {
    Project     = "neo-lloyds"
    Environment = var.environment
  }
}

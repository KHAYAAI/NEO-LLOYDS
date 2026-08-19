# Every value apps/api and the portals currently read from a local .env
# file (see the root .env.example and each portal's own .env.example)
# moves here. No application code changes are needed for this: ECS task
# definitions map a Secrets Manager ARN directly onto a container's
# environment variable name (see ecs_api.tf / ecs_portals.tf's
# `secrets` blocks) -- the app still just reads `process.env.DATABASE_URL`
# etc., unaware of where the value came from. This is the standard ECS
# pattern, not something Neo-Lloyds-specific.

resource "aws_secretsmanager_secret" "database_url" {
  name = "neo-lloyds/${var.environment}/database-url"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.postgres.address}:5432/${var.db_name}?schema=public"
}

resource "aws_secretsmanager_secret" "redis_url" {
  name = "neo-lloyds/${var.environment}/redis-url"
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "redis://${aws_elasticache_cluster.this.cache_nodes[0].address}:6379"
}

resource "random_password" "credential_salt_pepper" {
  # Not currently consumed by apps/api (credential salts are generated
  # per-credential at issuance time, apps/api/src/common/auth.ts
  # generateCredential) -- reserved here for a future global pepper if
  # one is ever added, rather than invented as a real control today.
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  count = var.anthropic_api_key != "" ? 1 : 0
  name  = "neo-lloyds/${var.environment}/anthropic-api-key"
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  count         = var.anthropic_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.anthropic_api_key[0].id
  secret_string = var.anthropic_api_key
}

# WORKOS_COOKIE_PASSWORD (>= 32 chars, per every portal's .env.example) is
# a symmetric key encrypting AuthKit's own session cookie -- it has no
# meaning to a human operator, so it's generated here rather than asked
# of you, the same way random_password.db is.
resource "random_password" "workos_cookie_password" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "workos_cookie_password" {
  name = "neo-lloyds/${var.environment}/workos-cookie-password"
}

resource "aws_secretsmanager_secret_version" "workos_cookie_password" {
  secret_id     = aws_secretsmanager_secret.workos_cookie_password.id
  secret_string = random_password.workos_cookie_password.result
}

resource "aws_secretsmanager_secret" "workos_api_key" {
  count = var.workos_api_key != "" ? 1 : 0
  name  = "neo-lloyds/${var.environment}/workos-api-key"
}

resource "aws_secretsmanager_secret_version" "workos_api_key" {
  count         = var.workos_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.workos_api_key[0].id
  secret_string = var.workos_api_key
}

resource "aws_ecs_cluster" "this" {
  name = "neo-lloyds-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/neo-lloyds/${var.environment}/api"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "portals" {
  for_each          = local.portals
  name              = "/neo-lloyds/${var.environment}/${each.key}"
  retention_in_days = 30
}

# --- IAM ---

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "neo-lloyds-${var.environment}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The execution role (pulls images, writes logs) needs read access to the
# specific secrets each task definition references -- least privilege,
# not a blanket secretsmanager:* grant.
data "aws_iam_policy_document" "read_secrets" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      aws_secretsmanager_secret.database_url.arn,
      aws_secretsmanager_secret.redis_url.arn,
      aws_secretsmanager_secret.workos_cookie_password.arn,
      var.anthropic_api_key != "" ? aws_secretsmanager_secret.anthropic_api_key[0].arn : "",
      var.workos_api_key != "" ? aws_secretsmanager_secret.workos_api_key[0].arn : "",
    ])
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "read-secrets"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.read_secrets.json
}

# The task role (what the running app can do via the AWS SDK, if it ever
# needs to) currently only needs S3 access for claims evidence.
resource "aws_iam_role" "ecs_task_api" {
  name               = "neo-lloyds-${var.environment}-ecs-task-api"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

data "aws_iam_policy_document" "evidence_bucket_access" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.evidence.arn]
  }
}

resource "aws_iam_role_policy" "ecs_task_api_s3" {
  name   = "evidence-bucket-access"
  role   = aws_iam_role.ecs_task_api.id
  policy = data.aws_iam_policy_document.evidence_bucket_access.json
}

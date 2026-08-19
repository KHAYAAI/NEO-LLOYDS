resource "aws_ecs_task_definition" "api" {
  family                   = "neo-lloyds-${var.environment}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_api.arn

  container_definitions = jsonencode([
    {
      name         = "api"
      image        = var.api_image
      essential    = true
      portMappings = [{ containerPort = 3001, protocol = "tcp" }]

      environment = concat(
        [
          { name = "NODE_ENV", value = "production" },
          { name = "API_PORT", value = "3001" },
          { name = "SIMULATION_MODE", value = "true" },
          { name = "OIDC_JWKS_URL", value = var.oidc_jwks_url },
          # No S3/evidence-bucket env var here: checked apps/api's source
          # before writing this, and claims evidence today is only a
          # free-text `evidenceRef` string (ClaimsController's EvidenceDto)
          # -- there is no upload/storage integration in application code
          # yet to configure, in local dev (MinIO, provisioned but unused)
          # or here. aws_s3_bucket.evidence exists ready for when that's
          # built; wire its name in here at that point, not before.
        ],
        var.oidc_issuer_url != "" ? [{ name = "OIDC_ISSUER_URL", value = var.oidc_issuer_url }] : [],
      )

      secrets = concat(
        [
          { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
          { name = "REDIS_URL", valueFrom = aws_secretsmanager_secret.redis_url.arn },
        ],
        var.anthropic_api_key != "" ? [{ name = "ANTHROPIC_API_KEY", valueFrom = aws_secretsmanager_secret.anthropic_api_key[0].arn }] : [],
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_service.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  service_registries {
    registry_arn = aws_service_discovery_service.api.arn
  }

  # Migrations are not run by this service on boot -- see
  # infrastructure/aws/README.md for the deploy-time migration step
  # (`prisma migrate deploy` as a one-off ECS task, not baked into the
  # long-running service's startup, so a bad migration can't crash-loop
  # the whole fleet).
  depends_on = [aws_lb_listener.http_redirect]
}

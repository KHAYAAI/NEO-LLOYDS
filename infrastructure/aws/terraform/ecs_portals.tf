resource "aws_iam_role" "ecs_task_portal" {
  name               = "neo-lloyds-${var.environment}-ecs-task-portal"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_ecs_task_definition" "portal" {
  for_each                 = local.portals
  family                   = "neo-lloyds-${var.environment}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_portal.arn

  container_definitions = jsonencode([
    {
      name         = each.key
      image        = each.value.image
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      environment = concat(
        [
          { name = "NODE_ENV", value = "production" },
          # Internal service-discovery DNS, not the public ALB -- see
          # service_discovery.tf.
          { name = "NEO_LLOYDS_API_URL", value = "http://${aws_service_discovery_service.api.name}.${aws_service_discovery_private_dns_namespace.this.name}:3001" },
        ],
        var.workos_client_id != "" ? [
          { name = "WORKOS_CLIENT_ID", value = var.workos_client_id },
          { name = "WORKOS_ORGANIZATION_ID", value = var.workos_organization_id },
          {
            name  = "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
            value = var.domain_name != null ? "https://${each.value.host}.${var.domain_name}/auth/callback" : ""
          },
        ] : [],
      )

      secrets = concat(
        [{ name = "WORKOS_COOKIE_PASSWORD", valueFrom = aws_secretsmanager_secret.workos_cookie_password.arn }],
        var.workos_api_key != "" ? [{ name = "WORKOS_API_KEY", valueFrom = aws_secretsmanager_secret.workos_api_key[0].arn }] : [],
      )

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.portals[each.key].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = each.key
        }
      }
    }
  ])
}

resource "aws_ecs_service" "portal" {
  for_each        = local.portals
  name            = each.key
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.portal[each.key].arn
  desired_count   = var.portal_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs_service.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.portal[each.key].arn
    container_name   = each.key
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http_redirect]
}

# A one-off task, not a service: run manually (or as a CI deploy step)
# before rolling the API service to a new image, so a bad migration fails
# loudly and doesn't crash-loop every running API task.
#
#   aws ecs run-task --cluster <cluster> --task-definition neo-lloyds-<env>-migrate \
#     --launch-type FARGATE --network-configuration '...'
#
# Same image as the API service (apps/api/Dockerfile already runs
# `prisma migrate deploy` via the database workspace's own script), just a
# different container command.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "neo-lloyds-${var.environment}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task_api.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = var.api_image
      essential = true
      command   = ["npx", "prisma", "migrate", "deploy", "--schema=packages/database/prisma/schema.prisma"]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])
}

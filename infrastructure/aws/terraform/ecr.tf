locals {
  ecr_repos = toset([
    "api",
    "broker-portal",
    "capital-portal",
    "corporate-portal",
    "admin-portal",
    "claims-admin-portal",
  ])
}

resource "aws_ecr_repository" "this" {
  for_each             = local.ecr_repos
  name                 = "neo-lloyds/${each.key}"
  image_tag_mutability = "IMMUTABLE" # A deployed tag can never silently change underneath a running task.

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Project     = "neo-lloyds"
    Environment = var.environment
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = local.ecr_repos
  repository = aws_ecr_repository.this[each.key].name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images, expire the rest"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

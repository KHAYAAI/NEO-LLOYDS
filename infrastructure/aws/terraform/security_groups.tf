resource "aws_security_group" "alb" {
  name_prefix = "neo-lloyds-${var.environment}-alb-"
  vpc_id      = aws_vpc.this.id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "HTTP (redirected to HTTPS below)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "neo-lloyds-${var.environment}-alb" }
}

resource "aws_security_group" "ecs_service" {
  name_prefix = "neo-lloyds-${var.environment}-ecs-"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "From the ALB only"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "neo-lloyds-${var.environment}-ecs" }
}

resource "aws_security_group" "rds" {
  name_prefix = "neo-lloyds-${var.environment}-rds-"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Postgres from ECS services only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_service.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "neo-lloyds-${var.environment}-rds" }
}

resource "aws_security_group" "redis" {
  name_prefix = "neo-lloyds-${var.environment}-redis-"
  vpc_id      = aws_vpc.this.id

  ingress {
    description     = "Redis from ECS services only"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_service.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "neo-lloyds-${var.environment}-redis" }
}

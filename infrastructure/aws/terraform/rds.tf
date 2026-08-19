# The DB password is generated here and stored only in Secrets Manager
# (secrets.tf) -- it is never a plain Terraform variable, so it never ends
# up in a .tfvars file or shell history the way var.workos_api_key could if
# misused.
resource "random_password" "db" {
  length  = 32
  special = false # RDS' allowed special-character set is narrower than random_password's default; keep this simple and avoid fighting it.
}

resource "aws_db_subnet_group" "this" {
  name       = "neo-lloyds-${var.environment}"
  subnet_ids = aws_subnet.database[*].id
}

resource "aws_db_instance" "postgres" {
  identifier     = "neo-lloyds-${var.environment}"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100 # Storage autoscaling headroom -- revisit once real usage is observed.
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  multi_az                  = var.environment == "production"
  backup_retention_period   = var.environment == "production" ? 7 : 1
  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "neo-lloyds-${var.environment}-final" : null

  tags = {
    Project     = "neo-lloyds"
    Environment = var.environment
  }
}

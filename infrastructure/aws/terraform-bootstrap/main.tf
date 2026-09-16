# Bootstrap stack -- run this FIRST, with local state (there is no S3
# backend yet; that's what this creates), before infrastructure/aws/terraform.
#
#   cd infrastructure/aws/terraform-bootstrap
#   terraform init
#   terraform apply -var="github_repo=KHAYAAI/NEO-LLOYDS"
#
# Never run `terraform destroy` here casually -- destroying the state
# bucket after the main stack has real state in it orphans that state.

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "github_repo" {
  description = "owner/repo, e.g. KHAYAAI/NEO-LLOYDS -- scopes the OIDC trust policy so only this repo's Actions runs can assume the role."
  type        = string
}

variable "github_branch" {
  description = "Branch allowed to assume the deploy role via OIDC. Restricts deploys to pushes/merges on this branch only."
  type        = string
  default     = "main"
}

# --- 1. Terraform state backend ---

resource "aws_s3_bucket" "terraform_state" {
  bucket = "neo-lloyds-terraform-state"

  lifecycle {
    prevent_destroy = true # This bucket holds every environment's state -- destroying it is not a normal operation.
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  versioning_configuration {
    status = "Enabled" # A bad `apply` overwriting state should be recoverable from a prior version.
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "neo-lloyds-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# --- 2. GitHub -> AWS OIDC role (for .github/workflows/build-and-push.yml) ---

# GitHub's own OIDC thumbprint, published at
# https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-based-deployments-to-aws/
# -- GitHub rotated to a certificate chain AWS's root CAs already trust,
# so this thumbprint is a formality AWS still requires, not a live check.
data "tls_certificate" "github_oidc" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_oidc.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_oidc_assume_role" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      # Scoped to one repo and one branch -- a PR from a fork, or a push
      # to any other branch, cannot assume this role.
      values = ["repo:${var.github_repo}:ref:refs/heads/${var.github_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "neo-lloyds-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_assume_role.json
}

# Scoped to ECR push on the neo-lloyds/* repositories the main stack
# creates (infrastructure/aws/terraform/ecr.tf), plus the login action's
# GetAuthorizationToken (which AWS does not let you scope to a resource --
# it's always "*"). Nothing else: this role cannot touch RDS, ECS, IAM,
# or any other service.
data "aws_iam_policy_document" "github_deploy_ecr" {
  statement {
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]
    resources = ["arn:aws:ecr:${var.aws_region}:*:repository/neo-lloyds/*"]
  }
}

resource "aws_iam_role_policy" "github_deploy_ecr" {
  name   = "ecr-push"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy_ecr.json
}

output "state_bucket" {
  value = aws_s3_bucket.terraform_state.bucket
}

output "lock_table" {
  value = aws_dynamodb_table.terraform_locks.name
}

output "github_deploy_role_arn" {
  description = "Set as the AWS_ROLE_ARN repo secret for .github/workflows/build-and-push.yml."
  value       = aws_iam_role.github_deploy.arn
}

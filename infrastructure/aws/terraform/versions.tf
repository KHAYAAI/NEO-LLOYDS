terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Not configured by default -- run infrastructure/aws/terraform-bootstrap/
  # first (creates exactly the bucket/table named below, plus the GitHub
  # OIDC deploy role), then uncomment this block for every apply after
  # that. Local state is fine for `terraform plan` review, not for
  # anything you intend to keep.
  #
  # backend "s3" {
  #   bucket         = "neo-lloyds-terraform-state"
  #   key            = "neo-lloyds/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "neo-lloyds-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
}

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Not configured: pick a real backend (S3 + DynamoDB lock table) before
  # the first `terraform apply` against a real AWS account. Local state is
  # fine for `terraform plan` review, not for anything you intend to keep.
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

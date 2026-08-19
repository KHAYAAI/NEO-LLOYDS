variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name, used as a resource-name/tag suffix. Matches the WorkOS environment this deployment should point at (see apps/admin-portal/README.md) -- staging or production."
  type        = string
  default     = "staging"
}

variable "vpc_cidr" {
  type    = string
  default = "10.42.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro" # Right-size before production traffic -- this is a dev/staging default, not a capacity plan.
}

variable "db_name" {
  type    = string
  default = "neolloyds"
}

variable "db_username" {
  type    = string
  default = "neolloyds"
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

variable "api_image" {
  description = "Full ECR image URI:tag for apps/api (built from apps/api/Dockerfile). Set by CI after it pushes -- see .github/workflows/deploy.yml."
  type        = string
}

variable "portal_images" {
  description = "Full ECR image URI:tag per portal (built from infrastructure/aws/portal.Dockerfile)."
  type = object({
    broker_portal       = string
    capital_portal      = string
    corporate_portal    = string
    admin_portal        = string
    claims_admin_portal = string
  })
}

variable "api_desired_count" {
  type    = number
  default = 1
}

variable "portal_desired_count" {
  type    = number
  default = 1
}

variable "domain_name" {
  description = "Root domain for this environment, e.g. staging.neo-lloyds.example. Leave null to skip Route53/ACM/CloudFront wiring entirely -- see infrastructure/aws/README.md; this is genuinely optional until a real domain exists (the same reason apps/admin-portal/README.md left WorkOS Production's redirect URIs unconfigured)."
  type        = string
  default     = null
}

variable "anthropic_api_key" {
  description = "Optional. Unset -> the AI analyst degrades to NullAnalystProvider, same as local dev (docs/reports/phase-2.md). Stored in Secrets Manager, never in a task definition's plain environment block."
  type        = string
  default     = ""
  sensitive   = true
}

variable "workos_api_key" {
  description = "Optional. Unset -> the 'Sign in with WorkOS' button doesn't render in any portal (see apps/admin-portal/README.md). Never commit a real value -- pass via -var or TF_VAR_workos_api_key at apply time."
  type        = string
  default     = ""
  sensitive   = true
}

variable "workos_client_id" {
  type    = string
  default = ""
}

variable "workos_organization_id" {
  type    = string
  default = ""
}

variable "oidc_issuer_url" {
  description = "Unset until a real WorkOS access token's `iss` claim is decoded and confirmed (apps/admin-portal/README.md) -- setting a guessed value here would make apps/api reject every real token."
  type        = string
  default     = ""
}

variable "oidc_jwks_url" {
  description = "Confirmed real value for WorkOS, read from @workos-inc/node's own source -- see .env.example."
  type        = string
  default     = "https://api.workos.com/sso/jwks/REPLACE_WITH_REAL_CLIENT_ID"
}
